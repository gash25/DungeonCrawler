import { ABILITIES } from '../game/abilities';
import { CLASSES } from '../game/classes';
import { chebyshev } from '../game/fov';
import type { Game } from '../game/game';
import { T, type Vec } from '../game/types';
import type { Renderer } from '../render/renderer';
import type { Hud } from './hud';
import { esc } from './icons';

type Auto =
  | { kind: 'path'; goal: Vec; targetId?: number; bump?: Vec; seen: Set<number>; hp: number }
  | { kind: 'explore'; seen: Set<number>; hp: number }
  | { kind: 'rest'; hp: number };

type Targeting = { kind: 'ability'; key: string; slot: number } | { kind: 'item'; uid: number };

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [1, 0], ArrowUp: [1, 0], KeyS: [-1, 0], ArrowDown: [-1, 0], KeyA: [0, -1], ArrowLeft: [0, -1], KeyD: [0, 1], ArrowRight: [0, 1],
  Numpad8: [1, 0], Numpad2: [-1, 0], Numpad4: [0, -1], Numpad6: [0, 1], Numpad7: [1, -1], Numpad9: [1, 1], Numpad1: [-1, -1], Numpad3: [-1, 1],
};

export class Controller {
  game: Game | null = null;
  private auto: Auto | null = null;
  private targeting: Targeting | null = null;
  private hover: Vec | null = null;
  private stepTimer = 0;
  private held = new Set<string>();
  private holdTimer = 0;
  private chordTimer = -1;
  private buffered: (() => void) | null = null;
  private pointers = new Map<number, { x: number; y: number; sx: number; sy: number; t: number }>();
  private pinch: { d: number; a: number; rotAcc: number } | null = null;
  private longPress: number | null = null;
  private longPressed = false;
  enabled = true;
  onDescendPrompt: (() => void) | null = null;

  constructor(private canvas: HTMLCanvasElement, private renderer: Renderer, private hud: Hud, private onEsc: () => void) {
    canvas.addEventListener('pointerdown', (e) => this.pointerDown(e));
    window.addEventListener('pointermove', (e) => this.pointerMove(e));
    window.addEventListener('pointerup', (e) => this.pointerUp(e));
    window.addEventListener('pointercancel', (e) => this.pointers.delete(e.pointerId));
    canvas.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      this.cancel();
    });
    canvas.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.renderer.zoom(e.deltaY * 0.01);
    }, { passive: false });
    window.addEventListener('keydown', (e) => this.keyDown(e));
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  private ready(): boolean {
    const g = this.game;
    return !!g && this.enabled && !g.over && !g.perkChoices && !this.hud.modalOpen && !this.renderer.busy;
  }

  private canQueue(): boolean {
    const g = this.game;
    return !!g && this.enabled && !g.over && !g.perkChoices && !this.hud.modalOpen;
  }

  /** Run now if ready, otherwise remember the latest intent and run it when animations finish. */
  private act(fn: () => void): void {
    if (!this.canQueue()) return;
    if (this.ready()) fn();
    else this.buffered = fn;
  }

  stopAuto(): void {
    this.auto = null;
  }

  cancel(): void {
    this.targeting = null;
    this.hud.activeSlot = -1;
    this.hud.targetHint = '';
    this.renderer.setTargets(null);
    this.stopAuto();
  }

  get isTargeting(): boolean {
    return !!this.targeting;
  }

  // ------------------------------------------------------------------ keyboard
  private keyDown(e: KeyboardEvent): void {
    if (!this.game || !this.enabled) return;
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    if (code === 'Escape') {
      if (this.hud.bigMapOpen) return this.hud.toggleBigMap();
      if (this.hud.modalOpen) return this.hud.closeModal();
      if (this.targeting || this.auto) return this.cancel();
      return this.onEsc();
    }
    if (this.hud.modalOpen) {
      if (code === 'KeyI' && !this.game.perkChoices) this.hud.closeModal();
      return;
    }
    if (MOVE_KEYS[code]) {
      e.preventDefault();
      if (e.repeat) return;
      this.held.add(code);
      this.stopAuto();
      if (this.chordTimer < 0) this.chordTimer = 0.045;
      return;
    }
    const g = this.game;
    switch (code) {
      case 'KeyQ': this.renderer.rotate(-1); break;
      case 'KeyE': this.renderer.rotate(1); break;
      case 'Space': case 'Period': case 'Numpad5':
        e.preventDefault();
        this.act(() => g.playerWait());
        break;
      case 'KeyR': this.startRest(); break;
      case 'KeyX': this.startExplore(); break;
      case 'KeyI': case 'KeyC': case 'Tab':
        e.preventDefault();
        this.cancel();
        this.hud.openInventory();
        break;
      case 'KeyM': this.hud.toggleBigMap(); break;
      case 'Enter': case 'NumpadEnter': this.descend(); break;
      case 'Digit1': case 'Digit2': case 'Digit3': case 'Digit4':
        this.ability(Number(code.slice(5)) - 1);
        break;
      case 'Digit5': case 'KeyH': this.quick('heal'); break;
      case 'Digit6': case 'KeyG': this.quick('mana'); break;
      case 'Slash': this.onEsc(); break;
      case 'Equal': case 'NumpadAdd': this.renderer.zoom(-2); break;
      case 'Minus': case 'NumpadSubtract': this.renderer.zoom(2); break;
      default:
        if (e.key === '>') this.descend();
    }
  }

  private heldDir(): Vec | null {
    let f = 0, r = 0;
    for (const k of this.held) {
      const m = MOVE_KEYS[k];
      if (m) {
        f += m[0];
        r += m[1];
      }
    }
    if (!f && !r) return null;
    const yaw = this.renderer.camYaw;
    // screen-up on the ground plane = -(sin yaw, cos yaw); screen-right = (cos yaw, -sin yaw)
    const wx = -Math.sin(yaw) * f + Math.cos(yaw) * r;
    const wz = -Math.cos(yaw) * f - Math.sin(yaw) * r;
    const ang = Math.round(Math.atan2(wz, wx) / (Math.PI / 4)) * (Math.PI / 4);
    return { x: Math.round(Math.cos(ang)), y: Math.round(Math.sin(ang)) };
  }

  private step(d: Vec): void {
    const g = this.game!;
    if (this.targeting) this.cancel();
    if (!g.playerStep(d.x, d.y)) {
      // allow sliding along walls for diagonals
      if (d.x && d.y && !g.playerStep(d.x, 0)) g.playerStep(0, d.y);
    }
  }

  // ------------------------------------------------------------------ pointer
  private pointerDown(e: PointerEvent): void {
    this.canvas.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, t: performance.now() });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), a: Math.atan2(b.y - a.y, b.x - a.x), rotAcc: 0 };
      if (this.longPress) clearTimeout(this.longPress);
    } else if (e.pointerType === 'touch') {
      this.longPressed = false;
      this.longPress = window.setTimeout(() => {
        this.longPressed = true;
        this.inspect(e.clientX, e.clientY);
      }, 480);
    }
  }

  private pointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (p) {
      p.x = e.clientX;
      p.y = e.clientY;
      if (Math.hypot(p.x - p.sx, p.y - p.sy) > 10 && this.longPress) {
        clearTimeout(this.longPress);
        this.longPress = null;
      }
    }
    if (this.pinch && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const ang = Math.atan2(b.y - a.y, b.x - a.x);
      this.renderer.zoom((this.pinch.d - d) * 0.03);
      let da = ang - this.pinch.a;
      if (da > Math.PI) da -= Math.PI * 2;
      if (da < -Math.PI) da += Math.PI * 2;
      this.pinch.rotAcc += da;
      if (Math.abs(this.pinch.rotAcc) > 0.6) {
        this.renderer.rotate(this.pinch.rotAcc > 0 ? -1 : 1);
        this.pinch.rotAcc = 0;
      }
      this.pinch.d = d;
      this.pinch.a = ang;
      return;
    }
    if (e.pointerType === 'mouse' && e.target === this.canvas) this.updateHover(e.clientX, e.clientY);
    else if (e.pointerType === 'mouse' && e.target !== this.canvas) {
      this.renderer.setHover(null, 'none');
      this.renderer.setPath(null);
    }
  }

  private pointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    if (this.longPress) {
      clearTimeout(this.longPress);
      this.longPress = null;
    }
    if (this.pinch) {
      if (this.pointers.size === 0) this.pinch = null;
      return;
    }
    if (!p || e.target !== this.canvas && e.pointerType === 'mouse') return;
    if (this.longPressed) {
      this.longPressed = false;
      setTimeout(() => this.hud.hideTip(), 1800);
      return;
    }
    if (e.button === 2) return;
    if (Math.hypot(p.x - p.sx, p.y - p.sy) > 12) return;
    const tile = this.renderer.pickTile(e.clientX, e.clientY);
    if (tile) this.click(tile);
  }

  private inspect(x: number, y: number): void {
    const g = this.game;
    if (!g) return;
    const t = this.renderer.pickTile(x, y);
    if (!t) return;
    const html = this.describeTile(t);
    if (html) this.hud.showTip(html, x, y);
  }

  private describeTile(t: Vec): string | null {
    const g = this.game!;
    const a = g.actorAt(t.x, t.y);
    if (a && !a.isPlayer && g.isVisible(a.x, a.y)) {
      const traits = g.describeMonster(a);
      const st = a.statuses.map((s) => s.kind).join(', ');
      return `<h3 style="color:${a.boss ? '#ff6a50' : a.elite?.length ? '#ffb040' : 'inherit'}">${esc(a.name)}</h3>
        <div class="sub">${a.boss ? 'BOSS' : a.elite?.length ? 'ELITE' : `Tier ${a.def?.tier ?? 1}`} · ${Math.ceil(a.hp)}/${a.stats.maxHp} life · ${a.stats.dmgMin}-${a.stats.dmgMax} dmg · armor ${a.stats.armor}</div>
        ${traits.map((x, i) => `<div class="${i ? 'trait' : 'dim'}">${esc(x)}</div>`).join('')}
        ${a.asleep ? '<div class="dim">💤 Asleep</div>' : a.alerted ? '<div class="down">Hunting you</div>' : '<div class="dim">Unaware</div>'}
        ${st ? `<div class="dim">${esc(st)}</div>` : ''}`;
    }
    if (!g.explored[t.y * g.w + t.x]) return null;
    const f = g.featureAt(t.x, t.y);
    if (f) {
      const names: Record<string, string> = {
        chest: f.used ? 'Opened chest' : `Chest (${f.rarity})`, fountain: f.used ? 'Dry fountain' : 'Fountain of Renewal — fully restores you',
        merchant: 'Wandering Merchant — trade gold for supplies', shrine: f.used ? 'Spent shrine' : ['Shrine of Blood — sacrifice life for power', 'Shrine of Fortune — a gamble', 'Shrine of Wisdom — knowledge and insight', 'Shrine of Stone — endurance'][f.variant ?? 0],
        trap: f.hidden ? '' : f.used ? 'Sprung trap' : 'Trap! Avoid this tile', brazier: 'Brazier',
      };
      if (names[f.kind]) return `<div>${esc(names[f.kind])}</div>`;
    }
    const items = g.ground.filter((gi) => gi.x === t.x && gi.y === t.y);
    if (items.length) return items.map((gi) => (gi.gold ? `<div class="gold">${gi.gold} gold</div>` : `<div class="r-${gi.item!.rarity}">${esc(gi.item!.name)}</div>`)).join('');
    const tile = g.tile(t.x, t.y);
    if (tile === T.Stairs) return '<div>Stairs down</div>';
    if (tile === T.Hazard) return `<div class="down">Hazard — ${g.theme.biomes.find((b) => b.key === g.floor.biome)?.hazard}</div>`;
    return null;
  }

  private updateHover(x: number, y: number): void {
    const g = this.game;
    if (!g || g.over) return;
    const t = this.renderer.pickTile(x, y);
    this.hover = t;
    if (!t || !g.inBounds(t.x, t.y) || !g.explored[t.y * g.w + t.x]) {
      this.renderer.setHover(null, 'none');
      this.renderer.setPath(null);
      this.hud.hideTip();
      return;
    }
    const a = g.actorAt(t.x, t.y);
    const enemy = a && !a.isPlayer && g.isVisible(a.x, a.y);
    if (this.targeting) {
      this.renderer.setHover(t, this.validTarget(t) ? 'target' : 'none');
      this.renderer.setPath(null);
    } else {
      this.renderer.setHover(t, enemy ? 'enemy' : g.isPassable(t.x, t.y) || g.featureAt(t.x, t.y) ? 'move' : 'none');
      const path = !enemy && g.isPassable(t.x, t.y) && !this.auto ? g.playerPath(t) : null;
      this.renderer.setPath(path);
    }
    const html = this.describeTile(t);
    if (html) this.hud.showTip(html, x, y);
    else this.hud.hideTip();
  }

  // ------------------------------------------------------------------ actions
  private validTarget(t: Vec): boolean {
    const g = this.game!;
    const tg = this.targeting!;
    if (tg.kind === 'ability') return g.isValidTarget(ABILITIES[tg.key], t.x, t.y);
    const p = g.player;
    return chebyshev(p, t) <= 5 && g.isVisible(t.x, t.y) && g.los(p, t) && !g.isWall(t.x, t.y);
  }

  private fireTarget(t: Vec): void {
    const g = this.game!;
    const tg = this.targeting!;
    if (!this.validTarget(t)) {
      g.log('Invalid target.', 'warn');
      return;
    }
    this.cancel();
    if (tg.kind === 'ability') g.useAbility(tg.key, t.x, t.y);
    else g.useItem(tg.uid, t.x, t.y);
  }

  click(t: Vec): void {
    const g = this.game;
    if (!g || !this.canQueue()) return;
    if (this.targeting) return this.act(() => this.fireTarget(t));
    this.stopAuto();
    const p = g.player;
    if (t.x === p.x && t.y === p.y) {
      if (g.tile(p.x, p.y) === T.Stairs) return this.descend();
      return this.act(() => g.playerWait());
    }
    if (!g.inBounds(t.x, t.y)) return;
    const a = g.actorAt(t.x, t.y);
    if (a && !a.isPlayer && g.isVisible(a.x, a.y)) {
      if (chebyshev(a, p) === 1) return this.act(() => g.playerStep(a.x - p.x, a.y - p.y));
      this.auto = { kind: 'path', goal: { x: a.x, y: a.y }, targetId: a.id, seen: this.visibleIds(), hp: p.hp };
      return;
    }
    if (!g.explored[t.y * g.w + t.x]) return;
    const f = g.featureAt(t.x, t.y);
    if (f && g.blocked[t.y * g.w + t.x]) {
      if (chebyshev(f, p) === 1) return this.act(() => g.playerStep(f.x - p.x, f.y - p.y));
      // walk next to it, then bump
      let best: Vec | null = null;
      let bestLen = Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const n = { x: f.x + dx, y: f.y + dy };
        if ((dx || dy) && g.isWalkable(n.x, n.y)) {
          const path = g.playerPath(n);
          if (path && path.length < bestLen) {
            bestLen = path.length;
            best = n;
          }
        }
      }
      if (best) this.auto = { kind: 'path', goal: best, bump: { x: f.x, y: f.y }, seen: this.visibleIds(), hp: p.hp };
      return;
    }
    if (!g.isPassable(t.x, t.y)) return;
    if (chebyshev(t, p) === 1 && g.tile(t.x, t.y) !== T.Hazard) return this.act(() => this.step({ x: t.x - p.x, y: t.y - p.y }));
    this.auto = { kind: 'path', goal: t, seen: this.visibleIds(), hp: p.hp };
  }

  private visibleIds(): Set<number> {
    return new Set(this.game!.visibleEnemies().map((a) => a.id));
  }

  ability(slot: number): void {
    const g = this.game;
    if (!g || !this.canQueue()) return;
    const p = g.player;
    const key = CLASSES[p.cls].abilities[slot];
    if (!p.abilities.includes(key)) {
      g.log(`${ABILITIES[key].name} is not learned yet.`, 'warn');
      return;
    }
    const blocked = g.abilityBlocked(key);
    if (blocked) {
      g.log(blocked, 'warn');
      return;
    }
    const def = ABILITIES[key];
    this.stopAuto();
    if (def.target === 'self') {
      this.cancel();
      this.act(() => g.useAbility(key, p.x, p.y));
      return;
    }
    const valid = g.validTargets(key);
    if (this.targeting?.kind === 'ability' && this.targeting.slot === slot) {
      // second press: auto-target the nearest valid enemy
      const near = valid.filter((v) => g.actorAt(v.x, v.y)).sort((a, b) => chebyshev(a, p) - chebyshev(b, p))[0];
      if (near) {
        this.cancel();
        this.act(() => g.useAbility(key, near.x, near.y));
      }
      return;
    }
    if (!valid.length) {
      g.log(def.target === 'enemy' ? 'No valid targets in range.' : 'Nowhere to go.', 'warn');
      return;
    }
    this.targeting = { kind: 'ability', key, slot };
    this.hud.activeSlot = slot;
    this.hud.targetHint = `${def.name}: choose a target · press ${slot + 1} again for nearest · Esc / right-click to cancel`;
    this.renderer.setTargets(valid, def.target === 'tile' ? 0x9a60ff : 0xff6040);
  }

  useItem(uid: number): void {
    const g = this.game;
    if (!g) return;
    const it = g.player.inv.find((i) => i.uid === uid);
    if (!it) return;
    if (it.consumable === 'bomb') {
      const p = g.player;
      const tiles: Vec[] = [];
      for (let y = p.y - 5; y <= p.y + 5; y++) for (let x = p.x - 5; x <= p.x + 5; x++) {
        if (g.inBounds(x, y) && g.isVisible(x, y) && !g.isWall(x, y) && g.los(p, { x, y })) tiles.push({ x, y });
      }
      this.targeting = { kind: 'item', uid };
      this.hud.targetHint = 'Throw bomb: choose a tile · Esc to cancel';
      this.renderer.setTargets(tiles, 0xff8030);
      return;
    }
    this.act(() => g.useItem(uid));
  }

  quick(kind: 'heal' | 'mana'): void {
    const g = this.game;
    if (!g) return;
    const it = g.player.inv.find((i) => i.consumable === kind);
    if (!it) {
      g.log(`No ${kind === 'heal' ? 'healing' : 'mana'} draughts left.`, 'warn');
      return;
    }
    this.stopAuto();
    this.act(() => g.useItem(it.uid));
  }

  descend(): void {
    const g = this.game;
    if (!g) return;
    if (g.tile(g.player.x, g.player.y) !== T.Stairs) {
      g.log('You are not standing on stairs.', 'dim');
      return;
    }
    this.cancel();
    this.act(() => g.descend());
  }

  startRest(): void {
    const g = this.game;
    if (!g) return;
    if (g.visibleEnemies().length) {
      g.log('You cannot rest with enemies in sight.', 'warn');
      return;
    }
    if (!g.canRest()) {
      g.log(g.player.hp >= g.player.stats.maxHp * 0.5 ? 'Your wounds need more than rest. (Natural recovery stops at 50%.)' : 'You feel rested.', 'dim');
      return;
    }
    this.cancel();
    this.auto = { kind: 'rest', hp: g.player.hp };
  }

  startExplore(): void {
    const g = this.game;
    if (!g) return;
    if (g.visibleEnemies().length) {
      g.log('Enemies are near!', 'warn');
      return;
    }
    this.cancel();
    this.auto = { kind: 'explore', seen: this.visibleIds(), hp: g.player.hp };
  }

  // ------------------------------------------------------------------ frame
  update(dt: number): void {
    const g = this.game;
    if (!g) return;
    // chord / held movement
    if (this.chordTimer >= 0) {
      this.chordTimer -= dt;
      if (this.chordTimer < 0) {
        const d = this.heldDir();
        if (d) this.act(() => this.step(d));
        this.holdTimer = 0.24;
      }
    } else if (this.held.size) {
      this.holdTimer -= dt;
      if (this.holdTimer <= 0 && this.ready()) {
        const d = this.heldDir();
        if (d) this.step(d);
        this.holdTimer = 0.12;
      }
    }
    if (this.buffered && this.ready()) {
      const fn = this.buffered;
      this.buffered = null;
      fn();
      return;
    }
    this.stepTimer -= dt;
    if (!this.auto || !this.ready() || this.stepTimer > 0) return;
    this.stepTimer = 0.07;
    const p = g.player;
    const a = this.auto;
    // interruptions
    if (p.hp < a.hp - 0.01) {
      this.stopAuto();
      return;
    }
    a.hp = p.hp;
    if (a.kind !== 'rest') {
      const vis = g.visibleEnemies();
      if (vis.some((m) => !a.seen.has(m.id))) {
        g.log('You spot an enemy!', 'warn');
        this.stopAuto();
        return;
      }
    }
    if (a.kind === 'rest') {
      if (!g.canRest() || g.visibleEnemies().length) {
        this.stopAuto();
        g.log('You finish resting.', 'dim');
        return;
      }
      this.stepTimer = 0.012;
      g.playerWait();
      return;
    }
    if (a.kind === 'explore') {
      const target = g.exploreTarget();
      if (!target) {
        this.stopAuto();
        const s = g.floor.stairs;
        g.log(g.tile(s.x, s.y) === T.Stairs ? 'Nothing left to explore. Find the stairs.' : 'Explored. Something powerful still guards this floor.', 'info');
        return;
      }
      const path = g.playerPath(target);
      if (!path || !path.length) {
        this.stopAuto();
        return;
      }
      this.step({ x: path[0].x - p.x, y: path[0].y - p.y });
      return;
    }
    // path
    if (a.targetId !== undefined) {
      const t = g.actors.find((x) => x.id === a.targetId && !x.dead);
      if (!t || !g.isVisible(t.x, t.y)) {
        this.stopAuto();
        return;
      }
      if (chebyshev(t, p) === 1) {
        this.stopAuto();
        g.playerStep(t.x - p.x, t.y - p.y);
        return;
      }
      a.goal = { x: t.x, y: t.y };
    }
    if (p.x === a.goal.x && p.y === a.goal.y) {
      this.stopAuto();
      if (a.bump) g.playerStep(a.bump.x - p.x, a.bump.y - p.y);
      return;
    }
    const path = g.playerPath(a.goal, true);
    if (!path || !path.length) {
      this.stopAuto();
      return;
    }
    const next = path[0];
    const moved = g.playerStep(next.x - p.x, next.y - p.y);
    if (!moved) this.stopAuto();
  }

  get autoActive(): boolean {
    return !!this.auto;
  }
}
