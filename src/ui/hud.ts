import { ABILITIES } from '../game/abilities';
import { ABILITY_UNLOCK, CLASSES } from '../game/classes';
import { INV_MAX, REST_CAP, type Game } from '../game/game';
import { CONSUMABLES, STAT_LABEL, itemScore } from '../game/items';
import { perkDef } from '../game/perks';
import type { RunTheme } from '../game/theme';
import { T, type EquipSlot, type GEvent, type Item, type Stats } from '../game/types';
import type { Renderer } from '../render/renderer';
import { CLASS_ICON, STATUS_INFO, esc, itemIcon } from './icons';
import * as THREE from 'three';

export interface HudCallbacks {
  onAbility(slot: number): void;
  onQuick(kind: 'heal' | 'mana'): void;
  onWait(): void;
  onRest(): void;
  onExplore(): void;
  onRotate(d: number): void;
  onPause(): void;
  onUseItem(uid: number): void;
  onDescend(): void;
  onHelp(): void;
}

const KIND_TXT: Record<string, string> = {
  phys: '#ffffff', fire: '#ff8a40', ice: '#9fe0ff', poison: '#8aff50', holy: '#ffe890', arcane: '#d090ff', lightning: '#b0d0ff', shadow: '#b080ff',
};

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor', 'helm', 'ring', 'amulet'];
const SLOT_NAME: Record<EquipSlot, string> = { weapon: 'Weapon', armor: 'Armor', helm: 'Head', ring: 'Ring', amulet: 'Amulet' };

export function applyUiTheme(theme: RunTheme): void {
  const r = document.documentElement.style;
  const u = theme.ui;
  r.setProperty('--accent', u.accent);
  r.setProperty('--accent2', u.accent2);
  r.setProperty('--bg', u.bg);
  r.setProperty('--panel', u.panel);
  r.setProperty('--border', u.border);
  r.setProperty('--text', u.text);
  r.setProperty('--dim', u.dim);
  r.setProperty('--head-font', u.headFont);
  r.setProperty('--body-font', u.bodyFont);
  document.body.className = `frame-${u.frame}`;
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(n < 1 ? 2 : 1);
}

export function itemTooltip(it: Item, cmp: Item | null, cls: string): string {
  const lines: string[] = [];
  const keys = new Set<keyof Stats>([...(Object.keys(it.stats) as (keyof Stats)[]), ...(cmp ? (Object.keys(cmp.stats) as (keyof Stats)[]) : [])]);
  for (const k of keys) {
    const v = it.stats[k] ?? 0;
    const c = cmp?.stats[k] ?? 0;
    if (!v && !c) continue;
    const diff = v - c;
    const d = cmp && Math.abs(diff) > 0.001 ? ` <span class="${diff > 0 === (k !== 'speed' || diff > 0) ? 'up' : 'down'}">(${diff > 0 ? '+' : ''}${fmt(+diff.toFixed(2))})</span>` : '';
    lines.push(`<div class="stat"><span>${STAT_LABEL[k]}</span><span>${v ? (v > 0 ? '+' : '') + fmt(v) : '—'}${d}</span></div>`);
  }
  const slotName = it.slot === 'consumable' ? 'Consumable' : SLOT_NAME[it.slot as EquipSlot];
  let body = lines.join('');
  if (it.consumable) body = `<div>${esc(CONSUMABLES[it.consumable].desc)}</div>`;
  const score = it.slot !== 'consumable' && cmp ? itemScore(it, cls) - itemScore(cmp, cls) : 0;
  const verdict = it.slot === 'consumable' ? '' : !cmp ? '<div class="up" style="margin-top:6px">Empty slot — equip it!</div>' : score > 1 ? '<div class="up" style="margin-top:6px">▲ Likely an upgrade</div>' : score < -1 ? '<div class="down" style="margin-top:6px">▼ Likely a downgrade</div>' : '';
  return `<h3 class="r-${it.rarity}">${esc(it.name)}${it.count && it.count > 1 ? ` ×${it.count}` : ''}</h3>
    <div class="sub">${it.rarity.toUpperCase()} ${slotName}${it.slot !== 'consumable' ? ` · ilvl ${it.level}` : ''}</div>
    ${body}${it.artifactDesc ? `<div class="art">✦ ${esc(it.artifactDesc)}</div>` : ''}${verdict}
    ${cmp ? `<div class="dim" style="margin-top:6px;font-size:13px">Compared to: ${esc(cmp.name)}</div>` : ''}`;
}

export class Hud {
  game: Game | null = null;
  private el: HTMLElement;
  private hudEl: HTMLElement | null = null;
  private floatLayer: HTMLElement;
  private barLayer: HTMLElement;
  private tooltip: HTMLElement;
  private modalEl: HTMLElement | null = null;
  private bars = new Map<number, HTMLElement>();
  private logLines: { text: string; cls?: string }[] = [];
  private mini: HTMLCanvasElement | null = null;
  private miniVersion = -1;
  private miniTimer = 0;
  private last: Record<string, string> = {};
  private bigMap: HTMLElement | null = null;
  activeSlot = -1;
  targetHint = '';
  modalOpen = false;
  shopOpen = false;
  onModalClose: (() => void) | null = null;
  private selUid: number | null = null;

  constructor(root: HTMLElement, private renderer: Renderer, private cb: HudCallbacks) {
    this.el = root;
    this.floatLayer = document.createElement('div');
    this.floatLayer.className = 'float-layer passive';
    this.barLayer = document.createElement('div');
    this.barLayer.className = 'bar-layer passive';
    this.tooltip = document.createElement('div');
    this.tooltip.className = 'tooltip panel passive';
    this.tooltip.style.display = 'none';
    root.append(this.barLayer, this.floatLayer, this.tooltip);
  }

  // ------------------------------------------------------------------ build
  setGame(game: Game | null): void {
    this.game = game;
    this.hudEl?.remove();
    this.hudEl = null;
    this.closeModal();
    for (const b of this.bars.values()) b.remove();
    this.bars.clear();
    this.logLines = [];
    this.last = {};
    if (!game) return;
    applyUiTheme(game.theme);
    const p = game.player;
    const c = CLASSES[p.cls];
    const h = document.createElement('div');
    h.className = 'hud';
    h.innerHTML = `
      <div class="hud-top-left panel">
        <div class="portrait">${CLASS_ICON[p.cls]}<span class="lvl" data-k="lvl">1</span></div>
        <div class="bars">
          <div class="name"><span>${c.name}</span> <span class="gold" data-k="gold"></span></div>
          <div class="bar hp"><div class="ghost" data-k="hpghost"></div><div class="fill" data-k="hpfill"></div><div class="txt" data-k="hptxt"></div></div>
          <div class="bar mp"><div class="fill" data-k="mpfill"></div><div class="txt" data-k="mptxt"></div></div>
          <div class="bar xp"><div class="fill" data-k="xpfill"></div></div>
          <div class="statuses" data-k="status"></div>
        </div>
      </div>
      <div class="hud-top-center">
        <div class="floor-title" data-k="floor"></div>
        <div class="boss-bar panel" data-k="boss" style="display:none">
          <div class="bname" data-k="bossname"></div>
          <div class="bar hp"><div class="fill" data-k="bossfill"></div></div>
        </div>
      </div>
      <div class="hud-top-right">
        <div class="minimap panel"><canvas data-k="mini" data-act="bigmap"></canvas></div>
        <div class="icon-row">
          <button class="btn icon-btn" data-act="rotl" title="Rotate camera (Q)">⟲</button>
          <button class="btn icon-btn" data-act="rotr" title="Rotate camera (E)">⟳</button>
          <button class="btn icon-btn" data-act="inv" title="Inventory (I)">🎒</button>
          <button class="btn icon-btn" data-act="help" title="Help (?)">?</button>
          <button class="btn icon-btn" data-act="pause" title="Menu (Esc)">☰</button>
        </div>
      </div>
      <div class="toast-wrap" data-k="toasts"></div>
      <div class="log" data-k="log"></div>
      <div class="target-hint panel" data-k="hint" style="display:none"></div>
      <div class="hud-bottom panel">
        ${c.abilities.map((a, i) => `<button class="btn slot" data-act="ab" data-i="${i}" data-tip="ab:${a}"><span class="key">${i + 1}</span><span class="glyph">${ABILITIES[a].icon}</span><span class="cost">${ABILITIES[a].mp}</span><span class="cd" data-k="cd${i}" style="display:none"></span></button>`).join('')}
        <div class="sep"></div>
        <button class="btn slot small" data-act="heal" data-tip="q:heal"><span class="key">5</span>🧪<span class="count" data-k="nheal"></span></button>
        <button class="btn slot small" data-act="mana" data-tip="q:mana"><span class="key">6</span>💧<span class="count" data-k="nmana"></span></button>
        <div class="sep"></div>
        <button class="btn slot small" data-act="wait" data-tip="t:Wait a turn (Space)">⌛</button>
        <button class="btn slot small" data-act="rest" data-tip="t:Rest until recovered (R) — natural healing only reaches ${Math.round(REST_CAP * 100)}% life">☾</button>
        <button class="btn slot small" data-act="explore" data-tip="t:Auto-explore (X)">🧭</button>
        <button class="btn slot small" data-act="descend" data-k="descend" data-tip="t:Descend the stairs (Enter)" style="display:none;border-color:var(--accent)">⬇</button>
      </div>`;
    h.addEventListener('click', (ev) => this.onClick(ev));
    h.addEventListener('pointermove', (ev) => this.onHoverTip(ev));
    h.addEventListener('pointerleave', () => this.hideTip());
    this.el.appendChild(h);
    this.hudEl = h;
    this.mini = h.querySelector('[data-k=mini]');
    this.miniVersion = -1;
  }

  private q(k: string): HTMLElement {
    return this.hudEl!.querySelector(`[data-k="${k}"]`) as HTMLElement;
  }

  private set(k: string, prop: 'text' | 'html' | 'width' | 'display' | 'scale', v: string): void {
    const key = k + prop;
    if (this.last[key] === v) return;
    this.last[key] = v;
    const e = this.q(k);
    if (!e) return;
    if (prop === 'text') e.textContent = v;
    else if (prop === 'html') e.innerHTML = v;
    else if (prop === 'width') e.style.width = v;
    else if (prop === 'scale') e.style.transform = `scaleX(${v})`;
    else e.style.display = v;
  }

  private onClick(ev: MouseEvent): void {
    const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
    if (!t) return;
    ev.stopPropagation();
    const a = t.dataset.act!;
    switch (a) {
      case 'ab': this.cb.onAbility(Number(t.dataset.i)); break;
      case 'heal': this.cb.onQuick('heal'); break;
      case 'mana': this.cb.onQuick('mana'); break;
      case 'wait': this.cb.onWait(); break;
      case 'rest': this.cb.onRest(); break;
      case 'explore': this.cb.onExplore(); break;
      case 'descend': this.cb.onDescend(); break;
      case 'rotl': this.cb.onRotate(-1); break;
      case 'rotr': this.cb.onRotate(1); break;
      case 'inv': this.openInventory(); break;
      case 'pause': this.cb.onPause(); break;
      case 'help': this.cb.onHelp(); break;
      case 'bigmap': this.toggleBigMap(); break;
    }
  }

  private onHoverTip(ev: PointerEvent): void {
    if (ev.pointerType === 'touch') return;
    const t = (ev.target as HTMLElement).closest('[data-tip]') as HTMLElement | null;
    if (!t || !this.game) return this.hideTip();
    const tip = t.dataset.tip!;
    let html = '';
    if (tip.startsWith('ab:')) {
      const a = ABILITIES[tip.slice(3)];
      const g = this.game;
      const unlocked = g.player.abilities.includes(a.key);
      const lvl = ABILITY_UNLOCK[CLASSES[g.player.cls].abilities.indexOf(a.key)];
      html = `<h3>${a.icon} ${a.name}</h3><div class="sub">${g.abilityCost(a.key)} ${CLASSES[g.player.cls].resource} · Cooldown ${g.abilityCd(a.key)} · ${a.target === 'self' ? 'Self' : `Range ${a.range}`}</div><div>${esc(a.desc)}</div>${unlocked ? '' : `<div class="down" style="margin-top:6px">Unlocks at level ${lvl}</div>`}`;
    } else if (tip.startsWith('q:')) {
      const k = tip.slice(2) as 'heal' | 'mana';
      html = `<h3>${CONSUMABLES[k].name}</h3><div>${CONSUMABLES[k].desc}</div>`;
    } else if (tip.startsWith('t:')) html = `<div>${esc(tip.slice(2))}</div>`;
    this.showTip(html, ev.clientX, ev.clientY);
  }

  showTip(html: string, x: number, y: number): void {
    this.tooltip.innerHTML = html;
    this.tooltip.style.display = 'block';
    const r = this.tooltip.getBoundingClientRect();
    let left = x + 18, top = y + 18;
    if (left + r.width > window.innerWidth - 8) left = x - r.width - 18;
    if (top + r.height > window.innerHeight - 8) top = y - r.height - 18;
    this.tooltip.style.left = `${Math.max(8, left)}px`;
    this.tooltip.style.top = `${Math.max(8, top)}px`;
  }

  hideTip(): void {
    this.tooltip.style.display = 'none';
  }

  // ------------------------------------------------------------------ events
  onEvent(e: GEvent, wp: THREE.Vector3 | null): void {
    const g = this.game;
    if (!g) return;
    switch (e.t) {
      case 'log':
        this.log(e.text, e.cls);
        break;
      case 'damage':
        if (wp) this.float(wp, String(e.amount), e.id === g.player.id ? '#ff5a4a' : KIND_TXT[e.kind], e.crit ? 'crit' : '');
        break;
      case 'miss':
        if (wp) this.float(wp, 'miss', '#a0a0a0', 'small');
        break;
      case 'heal':
        if (wp && e.amount > 0) this.float(wp, `+${e.amount}`, e.mana ? '#80b0ff' : '#70ff90', 'small');
        break;
      case 'status':
        if (wp) this.float(wp, STATUS_INFO[e.kind].name, STATUS_INFO[e.kind].bad ? '#ffb070' : '#a0ffc0', 'small');
        break;
      case 'pickup':
        this.toast(e.text, e.rarity);
        break;
      case 'floor':
        this.banner();
        break;
    }
  }

  log(text: string, cls?: string): void {
    this.logLines.push({ text, cls });
    if (this.logLines.length > 8) this.logLines.shift();
    if (!this.hudEl) return;
    const el = this.q('log');
    el.innerHTML = this.logLines.map((l) => `<div class="${l.cls ?? ''}">${esc(l.text)}</div>`).join('');
  }

  private float(wp: THREE.Vector3, text: string, color: string, cls: string): void {
    const s = this.renderer.worldToScreen(wp);
    if (!s.on) return;
    const d = document.createElement('div');
    d.className = `ftxt ${cls}`;
    d.textContent = text;
    d.style.left = `${s.x + (Math.random() - 0.5) * 24}px`;
    d.style.top = `${s.y}px`;
    if (cls !== 'crit') d.style.color = color;
    this.floatLayer.appendChild(d);
    setTimeout(() => d.remove(), 1200);
  }

  toast(text: string, rarity?: string): void {
    if (!this.hudEl) return;
    const d = document.createElement('div');
    d.className = `toast ${rarity ? 'r-' + rarity : ''}`;
    d.textContent = text;
    if (rarity) d.style.borderLeftColor = `var(--r-${rarity})`;
    this.q('toasts').appendChild(d);
    setTimeout(() => d.remove(), 2700);
  }

  banner(): void {
    const g = this.game;
    if (!g || !this.hudEl) return;
    this.hudEl.querySelectorAll('.banner').forEach((b) => b.remove());
    const b = document.createElement('div');
    b.className = 'banner passive';
    b.innerHTML = `<div class="d">${g.theme.ui.ornament} Depth ${g.depth} ${g.theme.ui.ornament}</div><div class="n">${esc(g.floor.name)}</div><div class="line"></div>`;
    this.hudEl.appendChild(b);
    setTimeout(() => b.remove(), 4200);
  }

  // ------------------------------------------------------------------ per-frame
  update(dt: number): void {
    const g = this.game;
    if (!g || !this.hudEl) return;
    const p = g.player;
    const c = CLASSES[p.cls];
    this.set('lvl', 'text', String(p.level));
    this.set('gold', 'text', `◆ ${p.gold}`);
    const hpF = Math.max(0, p.hp / p.stats.maxHp);
    this.set('hpfill', 'scale', hpF.toFixed(3));
    this.set('hpghost', 'scale', hpF.toFixed(3));
    this.set('hptxt', 'text', `${Math.ceil(Math.max(0, p.hp))} / ${p.stats.maxHp}`);
    this.set('mpfill', 'scale', (p.stats.maxMp ? p.mp / p.stats.maxMp : 0).toFixed(3));
    this.set('mptxt', 'text', `${Math.floor(p.mp)} / ${p.stats.maxMp} ${c.resource}`);
    this.set('xpfill', 'scale', (p.xp / p.xpNext).toFixed(3));
    this.set('floor', 'text', `${g.theme.dungeonName} · Depth ${g.depth}/10`);
    this.set('status', 'html', p.statuses.filter((s) => s.turns > 0).map((s) => {
      const i = STATUS_INFO[s.kind];
      return `<span class="status-ic ${i.bad ? 'bad' : 'good'}">${i.name}${s.turns < 100 ? ' ' + s.turns : ''}${s.kind === 'shield' ? ` (${s.power})` : ''}</span>`;
    }).join(''));
    // abilities
    c.abilities.forEach((a, i) => {
      const unlocked = p.abilities.includes(a);
      const cd = p.cds[a] ?? 0;
      const btn = this.hudEl!.querySelector(`[data-act=ab][data-i="${i}"]`) as HTMLElement;
      const cls = `btn slot${unlocked ? '' : ' locked'}${p.mp < g.abilityCost(a) ? ' nomana' : ''}${this.activeSlot === i ? ' active' : ''}`;
      if (btn.className !== cls) btn.className = cls;
      const costEl = btn.querySelector('.cost') as HTMLElement;
      const cost = String(g.abilityCost(a));
      if (costEl.textContent !== cost) costEl.textContent = cost;
      this.set(`cd${i}`, 'display', cd > 0 && unlocked ? 'grid' : 'none');
      this.set(`cd${i}`, 'text', String(cd));
    });
    const cnt = (k: string) => p.inv.find((it) => it.consumable === k)?.count ?? 0;
    this.set('nheal', 'text', String(cnt('heal')));
    this.set('nmana', 'text', String(cnt('mana')));
    this.set('descend', 'display', g.tile(p.x, p.y) === T.Stairs && !g.over ? 'grid' : 'none');
    this.set('hint', 'display', this.targetHint ? 'block' : 'none');
    this.set('hint', 'text', this.targetHint);
    // boss
    const boss = g.actors.find((a) => a.boss && !a.dead && a.alerted);
    this.set('boss', 'display', boss ? 'block' : 'none');
    if (boss) {
      this.set('bossname', 'text', boss.name + (boss.phase && boss.phase > 1 ? ` — Phase ${boss.phase}` : ''));
      this.set('bossfill', 'scale', (boss.hp / boss.stats.maxHp).toFixed(3));
    }
    this.updateBars();
    this.miniTimer -= dt;
    if (this.miniVersion !== g.fovVersion || this.miniTimer <= 0) {
      this.miniVersion = g.fovVersion;
      this.miniTimer = 0.3;
      this.drawMinimap(this.mini!, 4);
      if (this.bigMap) this.drawMinimap(this.bigMap.querySelector('canvas')!, 12);
    }
  }

  private updateBars(): void {
    const g = this.game!;
    const seen = new Set<number>();
    for (const a of g.actors) {
      if (a.isPlayer || a.dead || a.boss) continue;
      const s = this.renderer.actorScreenPos(a.id);
      if (!s || !s.visible || !s.on) continue;
      seen.add(a.id);
      let el = this.bars.get(a.id);
      const elite = !!a.elite?.length;
      if (!el) {
        el = document.createElement('div');
        el.className = `mbar${elite ? ' elite' : ''}`;
        el.innerHTML = `<div class="f"></div>${elite || a.name.startsWith('Mimic') ? `<div class="lbl">${esc(a.name)}</div>` : ''}`;
        this.barLayer.appendChild(el);
        this.bars.set(a.id, el);
      }
      el.style.left = `${s.x}px`;
      el.style.top = `${s.y}px`;
      const f = el.firstElementChild as HTMLElement;
      const w = `${Math.max(0, Math.min(100, (s.hp / a.stats.maxHp) * 100)).toFixed(1)}%`;
      if (f.style.width !== w) f.style.width = w;
      el.style.opacity = a.hp < a.stats.maxHp || a.alerted || elite ? '1' : '0.35';
    }
    for (const [id, el] of this.bars) {
      if (!seen.has(id)) {
        el.remove();
        this.bars.delete(id);
      }
    }
  }

  drawMinimap(cv: HTMLCanvasElement, scale: number): void {
    const g = this.game!;
    const { w, h } = g;
    if (cv.width !== w * scale) {
      cv.width = w * scale;
      cv.height = h * scale;
    }
    const ctx = cv.getContext('2d')!;
    ctx.fillStyle = '#050505';
    ctx.fillRect(0, 0, cv.width, cv.height);
    const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#6fe3c4';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (!g.explored[i]) continue;
        const t = g.tiles[i];
        const vis = g.visible[i];
        let col: string;
        if (t === T.Wall) col = vis ? '#6a6458' : '#3a362e';
        else if (t === T.Hazard) col = vis ? '#a04020' : '#5a2a1a';
        else if (t === T.Stairs) col = accent;
        else col = vis ? '#a8a090' : '#58534a';
        ctx.fillStyle = col;
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
    const dot = (x: number, y: number, c: string, r = 1) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.arc(x * scale + scale / 2, y * scale + scale / 2, scale * 0.5 * r + 0.5, 0, Math.PI * 2);
      ctx.fill();
    };
    for (const f of g.floor.features) {
      if (!g.explored[f.y * g.w + f.x]) continue;
      if (f.kind === 'chest' && !f.used) dot(f.x, f.y, '#ffc040');
      else if (f.kind === 'shrine' && !f.used) dot(f.x, f.y, '#c060ff');
      else if (f.kind === 'fountain' && !f.used) dot(f.x, f.y, '#40d0ff');
      else if (f.kind === 'merchant') dot(f.x, f.y, '#60ff80', 1.3);
      else if (f.kind === 'trap' && !f.hidden && !f.used) dot(f.x, f.y, '#ff3020', 0.7);
    }
    for (const gi of g.ground) if (g.explored[gi.y * g.w + gi.x]) dot(gi.x, gi.y, gi.gold ? '#ffd060' : '#ffffff', 0.6);
    for (const a of g.actors) {
      if (a.dead || a.isPlayer || !g.isVisible(a.x, a.y)) continue;
      dot(a.x, a.y, a.boss ? '#ff2010' : a.elite?.length ? '#ff9020' : '#ff4a3a', a.boss ? 1.6 : 1);
    }
    dot(g.player.x, g.player.y, '#ffffff', 1.5);
    // camera direction indicator
    const yaw = this.renderer.camYaw;
    ctx.strokeStyle = 'rgba(255,255,255,.6)';
    ctx.lineWidth = Math.max(1, scale / 4);
    ctx.beginPath();
    const px = g.player.x * scale + scale / 2, py = g.player.y * scale + scale / 2;
    ctx.moveTo(px, py);
    ctx.lineTo(px - Math.sin(yaw) * scale * 3, py - Math.cos(yaw) * scale * 3);
    ctx.stroke();
  }

  toggleBigMap(): void {
    if (this.bigMap) {
      this.bigMap.remove();
      this.bigMap = null;
      return;
    }
    const d = document.createElement('div');
    d.className = 'bigmap';
    d.innerHTML = '<canvas></canvas>';
    d.addEventListener('click', () => this.toggleBigMap());
    this.el.appendChild(d);
    this.bigMap = d;
    this.drawMinimap(d.querySelector('canvas')!, 12);
  }

  get bigMapOpen(): boolean {
    return !!this.bigMap;
  }

  // ------------------------------------------------------------------ modals
  openModal(html: string, onClick: (act: string, el: HTMLElement) => void, wide = false, closable = true): HTMLElement {
    this.closeModal();
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal panel" style="${wide ? '' : 'width:min(620px,94vw)'}">${closable ? '<button class="btn icon-btn close" data-act="close">✕</button>' : ''}${html}</div>`;
    bg.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (ev.target === bg && closable) return this.closeModal();
      if (!t) return;
      if (t.dataset.act === 'close') return this.closeModal();
      onClick(t.dataset.act!, t);
    });
    this.el.appendChild(bg);
    this.modalEl = bg;
    this.modalOpen = true;
    return bg;
  }

  closeModal(): void {
    if (!this.modalEl) return;
    this.modalEl.remove();
    this.modalEl = null;
    this.modalOpen = false;
    this.shopOpen = false;
    this.hideTip();
    const cb = this.onModalClose;
    this.onModalClose = null;
    cb?.();
  }

  openPerks(): void {
    const g = this.game!;
    if (!g.perkChoices) return;
    const cards = g.perkChoices.map((k) => {
      const d = perkDef(k)!;
      return `<div class="perk-card panel" data-act="perk" data-k="${k}"><div class="ic">${d.icon}</div><h3>${esc(d.name)}</h3><div class="dim">${esc(d.desc)}</div></div>`;
    }).join('');
    this.openModal(`<h2 style="justify-content:center"><span class="orn">${g.theme.ui.ornament}</span>Level ${g.player.level} — Choose a Perk<span class="orn">${g.theme.ui.ornament}</span></h2><div class="perks">${cards}</div>`, (act, el) => {
      if (act !== 'perk') return;
      g.choosePerk(el.dataset.k!);
      this.closeModal();
      if (g.perkChoices) this.openPerks();
    }, true, false);
  }

  private statRows(): string {
    const g = this.game!;
    const s = g.player.stats;
    const red = Math.round((1 - 100 / (100 + s.armor * 5)) * 100);
    const rows: [string, string][] = [
      ['Life', `${Math.ceil(g.player.hp)} / ${s.maxHp}`],
      [CLASSES[g.player.cls].resource, `${Math.floor(g.player.mp)} / ${s.maxMp}`],
      ['Damage', `${s.dmgMin} – ${s.dmgMax}`],
      ['Armor', `${s.armor} (−${red}% dmg)`],
      ['Accuracy', fmt(s.acc)],
      ['Evasion', fmt(s.eva)],
      ['Critical', `${fmt(s.crit)}% ×${fmt(+s.critMul.toFixed(2))}`],
      ['Speed', fmt(s.speed)],
      ['Spell Power', `+${fmt(s.spellPower)}%`],
      ['Life Steal', `${fmt(s.lifesteal)}%`],
      ['Thorns', fmt(s.thorns)],
      ['Regen (life / mana)', `${fmt(+s.hpRegen.toFixed(2))} / ${fmt(+s.mpRegen.toFixed(2))}`],
      ['Fire on hit', fmt(s.fireOnHit)],
      ['Sight', fmt(s.sight)],
      ['XP', `${g.player.xp} / ${g.player.xpNext}`],
      ['Kills', String(g.stats.kills)],
    ];
    return rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
  }

  openInventory(sell = false): void {
    const g = this.game!;
    const p = g.player;
    const render = () => {
      const equip = EQUIP_SLOTS.map((s) => {
        const it = p.equip[s];
        return it ? `<div class="islot ${it.rarity}" data-act="sel" data-uid="${it.uid}" data-eq="${s}">${itemIcon(it)}</div>` : `<div class="islot empty">${SLOT_NAME[s]}</div>`;
      }).join('');
      const inv = Array.from({ length: INV_MAX }, (_, i) => {
        const it = p.inv[i];
        if (!it) return '<div class="islot empty"></div>';
        const cur = it.slot !== 'consumable' ? p.equip[it.slot as EquipSlot] : null;
        const up = it.slot !== 'consumable' && (!cur || itemScore(it, p.cls) > itemScore(cur, p.cls) + 1);
        return `<div class="islot ${it.rarity}${this.selUid === it.uid ? ' sel' : ''}" data-act="sel" data-uid="${it.uid}" style="${this.selUid === it.uid ? 'border-color:#fff' : ''}">${itemIcon(it)}${it.count && it.count > 1 ? `<span class="cnt">${it.count}</span>` : ''}${up ? '<span class="up">▲</span>' : ''}</div>`;
      }).join('');
      const perks = p.perks.map((k) => `<span class="perk-chip">${perkDef(k)?.icon ?? ''} ${esc(perkDef(k)?.name ?? k)}</span>`).join('');
      const sel = this.findItem(this.selUid);
      let info = '<span class="dim">Select an item. Double-click to equip or use.</span>';
      let actions = '';
      if (sel) {
        const eqSlot = EQUIP_SLOTS.find((s) => p.equip[s]?.uid === sel.uid);
        const cmp = !eqSlot && sel.slot !== 'consumable' ? p.equip[sel.slot as EquipSlot] : null;
        info = itemTooltip(sel, cmp, p.cls);
        if (eqSlot) actions = `<button class="btn" data-act="unequip" data-s="${eqSlot}">Unequip</button>`;
        else {
          actions = `<button class="btn primary" data-act="use">${sel.slot === 'consumable' ? 'Use' : 'Equip'}</button>`;
          actions += this.shopOpen ? `<button class="btn" data-act="sell">Sell (${g.sellPrice(sel) * (sel.count ?? 1)}◆)</button>` : `<button class="btn" data-act="drop">Drop</button><button class="btn" data-act="salvage">Salvage (${Math.max(1, Math.floor(sel.value / 5))}◆)</button>`;
        }
      }
      return `<h2>🎒 Inventory <span class="gold" style="margin-left:auto;margin-right:40px">◆ ${p.gold}</span></h2>
        <div class="inv-layout">
          <div>
            <div class="dim" style="font-family:var(--head-font);font-size:13px;margin-bottom:4px">EQUIPPED</div>
            <div class="equip-grid">${equip}</div>
            <div class="dim" style="font-family:var(--head-font);font-size:13px;margin-bottom:4px">PACK (${p.inv.length}/${INV_MAX})</div>
            <div class="inv-grid">${inv}</div>
            <div class="item-actions">${actions}</div>
          </div>
          <div class="statlist">
            <div class="sel-info">${info}</div>
            <h3 style="margin:12px 0 6px">${CLASS_ICON[p.cls]} ${CLASSES[p.cls].name} · Level ${p.level}</h3>
            ${this.statRows()}
            <div class="perk-list">${perks}</div>
          </div>
        </div>`;
    };
    let lastClick = 0;
    const modal = this.openModal(render(), (act, el) => {
      const sel = this.findItem(this.selUid);
      if (act === 'sel') {
        const uid = Number(el.dataset.uid);
        const now = performance.now();
        if (this.selUid === uid && now - lastClick < 400) {
          if (el.dataset.eq) g.unequip(el.dataset.eq as EquipSlot);
          else return this.useFromInv(uid);
        }
        lastClick = now;
        this.selUid = uid;
      } else if (act === 'use' && sel) {
        return this.useFromInv(sel.uid);
      } else if (act === 'unequip') g.unequip(el.dataset.s as EquipSlot);
      else if (act === 'drop' && sel) {
        g.drop(sel.uid);
        this.selUid = null;
      } else if (act === 'salvage' && sel) {
        g.salvage(sel.uid);
        this.selUid = null;
      } else if (act === 'sell' && sel) {
        g.sell(sel.uid);
        this.selUid = null;
      }
      rerender();
    }, true);
    const rerender = () => {
      (modal.querySelector('.modal') as HTMLElement).innerHTML = '<button class="btn icon-btn close" data-act="close">✕</button>' + render();
    };
    if (sell) {
      this.shopOpen = true;
      rerender();
    }
    modal.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch') return;
      const t = (ev.target as HTMLElement).closest('[data-uid]') as HTMLElement | null;
      const it = t ? this.findItem(Number(t.dataset.uid)) : null;
      if (!it) return this.hideTip();
      const eq = EQUIP_SLOTS.find((s) => p.equip[s]?.uid === it.uid);
      this.showTip(itemTooltip(it, !eq && it.slot !== 'consumable' ? p.equip[it.slot as EquipSlot] : null, p.cls), ev.clientX, ev.clientY);
    });
  }

  private useFromInv(uid: number): void {
    this.closeModal();
    this.selUid = null;
    this.cb.onUseItem(uid);
  }

  private findItem(uid: number | null): Item | null {
    if (uid === null || !this.game) return null;
    const p = this.game.player;
    return p.inv.find((i) => i.uid === uid) ?? Object.values(p.equip).find((i) => i?.uid === uid) ?? null;
  }

  openShop(): void {
    const g = this.game!;
    const p = g.player;
    const render = () => {
      const items = g.shop.map((it, i) => {
        const price = g.shopPrice(it);
        return `<div class="shop-item" data-act="buy" data-i="${i}" data-uid="${it.uid}" style="${p.gold < price ? 'opacity:.5' : ''}"><div class="islot ${it.rarity}" style="width:44px;height:44px;font-size:20px">${itemIcon(it)}</div><div><div class="r-${it.rarity}">${esc(it.name)}</div><div class="dim" style="font-size:13px">${it.slot === 'consumable' ? 'Consumable' : SLOT_NAME[it.slot as EquipSlot]}</div></div><div class="price">${price} ◆</div></div>`;
      }).join('') || '<div class="dim">Sold out.</div>';
      return `<h2>⚖ The Wandering Merchant</h2><div class="dim" style="margin-bottom:10px">"Coin for comfort, traveler. The deep does not forgive the unprepared." — You have <span class="gold">◆ ${p.gold}</span></div>
        <div class="shop-grid">${items}</div>
        <div style="margin-top:14px;display:flex;gap:8px"><button class="btn primary" data-act="sellmode">Sell items…</button></div>`;
    };
    const modal = this.openModal(render(), (act, el) => {
      if (act === 'buy') {
        g.buy(Number(el.dataset.i));
        (modal.querySelector('.modal') as HTMLElement).innerHTML = '<button class="btn icon-btn close" data-act="close">✕</button>' + render();
      } else if (act === 'sellmode') {
        this.openInventory(true);
        this.onModalClose = () => this.openShop();
      }
    }, true);
    modal.addEventListener('pointermove', (ev) => {
      if (ev.pointerType === 'touch') return;
      const t = (ev.target as HTMLElement).closest('[data-uid]') as HTMLElement | null;
      const it = t ? g.shop.find((s) => s.uid === Number(t.dataset.uid)) : null;
      if (!it) return this.hideTip();
      this.showTip(itemTooltip(it, it.slot !== 'consumable' ? p.equip[it.slot as EquipSlot] : null, p.cls), ev.clientX, ev.clientY);
    });
  }
}
