import { CLASSES } from '../game/classes';
import type { Game } from '../game/game';
import type { ClassKey } from '../game/types';
import { UPGRADES, saveMeta, type MetaState } from '../meta';
import type { Hud } from './hud';
import { CLASS_ICON, esc } from './icons';

export interface MenuCallbacks {
  newRun(cls: ClassKey): void;
  continueRun(): void;
  hasSave(): boolean;
  toTitle(): void;
  applySettings(reload: boolean): void;
}

export class Menus {
  private overlay: HTMLElement | null = null;

  constructor(private root: HTMLElement, private meta: MetaState, private hud: Hud, private cb: MenuCallbacks) {}

  private show(html: string, onClick: (act: string, el: HTMLElement) => void): HTMLElement {
    this.hide();
    const d = document.createElement('div');
    d.className = 'title-screen';
    d.innerHTML = html;
    d.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest('[data-act]') as HTMLElement | null;
      if (t && !(t as HTMLButtonElement).disabled) onClick(t.dataset.act!, t);
    });
    this.root.appendChild(d);
    this.overlay = d;
    return d;
  }

  hide(): void {
    this.overlay?.remove();
    this.overlay = null;
  }

  title(): void {
    const m = this.meta;
    const save = this.cb.hasSave();
    this.show(`
      <div class="logo"><div class="t1">Depths Unbound</div><div class="t2">Every descent is new</div></div>
      <div class="menu-col">
        ${save ? '<button class="btn primary" data-act="continue">Continue Run</button>' : ''}
        <button class="btn ${save ? '' : 'primary'}" data-act="new">New Descent</button>
        <button class="btn" data-act="upgrades">Soul Altar <span class="accent">(${m.shards} ✦)</span></button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn" data-act="help">How to Play</button>
      </div>
      <div class="title-foot">Runs: ${m.runs} · Victories: ${m.wins} · Deepest: ${m.bestDepth || '—'}<br/>A turn-based roguelike. Ten floors. One life. The dungeon, its monsters, its relics and even its look are reborn every run.</div>`,
    (act) => {
      if (act === 'continue') this.cb.continueRun();
      else if (act === 'new') this.classSelect();
      else if (act === 'upgrades') this.upgrades();
      else if (act === 'settings') this.settings(false);
      else if (act === 'help') this.help(false);
    });
  }

  classSelect(): void {
    const unlocked = (k: ClassKey) => k !== 'cleric' || (this.meta.ranks.cleric ?? 0) > 0;
    const cards = (Object.keys(CLASSES) as ClassKey[]).map((k) => {
      const c = CLASSES[k];
      const ok = unlocked(k);
      const wins = this.meta.winsByClass[k] ?? 0;
      return `<div class="class-card panel ${ok ? '' : 'locked'}" data-act="${ok ? 'pick' : 'locked'}" data-k="${k}">
        <div class="ic">${CLASS_ICON[k]}</div><h3>${c.name}</h3><div class="ttl">${c.title}</div>
        <p>${esc(c.desc)}</p><p style="color:var(--text)">${esc(c.playstyle)}</p>
        <div class="dim" style="font-size:13px">Life ${c.base.maxHp} · ${c.resource} ${c.base.maxMp}${wins ? ` · ${wins} win${wins > 1 ? 's' : ''}` : ''}</div>
        ${ok ? '' : '<div class="accent" style="margin-top:6px;font-size:13px">Unlock at the Soul Altar</div>'}
      </div>`;
    }).join('');
    this.show(`<h2 style="font-size:32px">Choose your Champion</h2><div class="class-grid" style="width:min(980px,94vw)">${cards}</div><button class="btn" data-act="back">Back</button>`, (act, el) => {
      if (act === 'pick') this.cb.newRun(el.dataset.k as ClassKey);
      else if (act === 'back') this.title();
    });
  }

  upgrades(): void {
    const m = this.meta;
    const rows = UPGRADES.map((u) => {
      const rank = m.ranks[u.key] ?? 0;
      const max = u.costs.length;
      const cost = u.costs[rank];
      const pips = Array.from({ length: max }, (_, i) => `<span class="pip ${i < rank ? 'on' : ''}"></span>`).join('');
      return `<div class="upg"><div class="info"><b>${u.name}</b><span class="pips">${pips}</span><div class="dim">${u.desc}</div></div>
        ${rank >= max ? '<span class="accent">MAX</span>' : `<button class="btn" data-act="buy" data-k="${u.key}" ${m.shards < cost ? 'disabled' : ''}>${cost} ✦</button>`}</div>`;
    }).join('');
    this.show(`<div class="panel modal" style="width:min(620px,94vw)"><h2>✦ Soul Altar</h2>
      <div class="dim" style="margin-bottom:8px">Soul shards are earned by every run, win or lose. You have <b class="accent">${m.shards} ✦</b>.</div>${rows}
      <div style="margin-top:14px"><button class="btn" data-act="back">Back</button></div></div>`, (act, el) => {
      if (act === 'buy') {
        const u = UPGRADES.find((x) => x.key === el.dataset.k)!;
        const rank = m.ranks[u.key] ?? 0;
        if (m.shards >= u.costs[rank]) {
          m.shards -= u.costs[rank];
          m.ranks[u.key] = rank + 1;
          saveMeta(m);
        }
        this.upgrades();
      } else if (act === 'back') this.title();
    });
  }

  private settingsHtml(): string {
    const s = this.meta.settings;
    return `<h2>⚙ Settings</h2>
      <div class="setting"><span>Graphics quality</span><span><button class="btn ${s.quality === 'high' ? 'primary' : ''}" data-act="q-high">High</button> <button class="btn ${s.quality === 'low' ? 'primary' : ''}" data-act="q-low">Low</button></span></div>
      <div class="dim" style="font-size:13px">High: dynamic shadows, 512px textures, anti-aliasing. Low: for phones and older GPUs. Changing it reloads the page (your run is kept from the start of the current floor).</div>
      <div class="setting"><span>Music</span><input type="range" min="0" max="1" step="0.05" value="${s.music}" data-k="music"/></div>
      <div class="setting"><span>Sound effects</span><input type="range" min="0" max="1" step="0.05" value="${s.sfx}" data-k="sfx"/></div>`;
  }

  settings(inGame: boolean): void {
    const handler = (act: string) => {
      if (act === 'q-high' || act === 'q-low') {
        const q = act === 'q-high' ? 'high' : 'low';
        if (q !== this.meta.settings.quality) {
          this.meta.settings.quality = q;
          saveMeta(this.meta);
          this.cb.applySettings(true);
        }
      } else if (act === 'back') this.title();
    };
    const bindSliders = (el: HTMLElement) => {
      el.querySelectorAll('input[type=range]').forEach((inp) => {
        inp.addEventListener('input', () => {
          const i = inp as HTMLInputElement;
          if (i.dataset.k === 'music') this.meta.settings.music = Number(i.value);
          else this.meta.settings.sfx = Number(i.value);
          saveMeta(this.meta);
          this.cb.applySettings(false);
        });
      });
    };
    if (inGame) {
      const el = this.hud.openModal(this.settingsHtml(), handler);
      bindSliders(el);
    } else {
      const el = this.show(`<div class="panel modal" style="width:min(560px,94vw)">${this.settingsHtml()}<div style="margin-top:14px"><button class="btn" data-act="back">Back</button></div></div>`, handler);
      bindSliders(el);
    }
  }

  static helpHtml(): string {
    return `<h2>📜 How to Play</h2>
      <p class="dim">Descend ten floors and destroy the heart of the dungeon. Everything is turn-based: nothing moves until you act. Death is permanent, and the run is saved at the start of every floor.</p>
      <div class="help-grid">
        <kbd>Click / Tap</kbd><span>Move, attack, open chests, talk to merchants. Click the stairs while standing on them to descend.</span>
        <kbd>W A S D / Arrows</kbd><span>Move relative to the camera. Press two keys together for diagonals. Numpad works too.</span>
        <kbd>Q / E</kbd><span>Rotate camera (or two-finger twist). Mouse wheel / pinch to zoom.</span>
        <kbd>1 – 4</kbd><span>Abilities. Targeted abilities: press, then click a target. Press again to auto-target the nearest.</span>
        <kbd>5 / H · 6 / G</kbd><span>Drink healing / mana draught.</span>
        <kbd>Space</kbd><span>Wait one turn.</span>
        <kbd>R</kbd><span>Rest. Natural recovery only heals to 50% life; potions, fountains, level-ups and abilities heal further.</span>
        <kbd>X</kbd><span>Auto-explore until something interesting appears.</span>
        <kbd>I / Tab</kbd><span>Inventory and character sheet. Double-click an item to equip or use it.</span>
        <kbd>M</kbd><span>Large map.</span>
        <kbd>Enter</kbd><span>Descend the stairs.</span>
        <kbd>Long-press</kbd><span>(Touch) inspect a monster or object.</span>
        <kbd>Esc</kbd><span>Cancel or open the menu.</span>
      </div>
      <h3 style="margin:14px 0 6px">Survival tips</h3>
      <ul class="dim" style="margin:0;padding-left:18px">
        <li><b style="color:#ff7060">Red tiles</b> are a telegraphed attack. Step out of them before the enemy's next turn.</li>
        <li>Fight in corridors so only one enemy can reach you. Sleeping enemies take extra damage from a Rogue's Backstab.</li>
        <li>Elite monsters (glowing ring, named) are twice as dangerous and drop much better loot.</li>
        <li>Shrines are gambles. Chests can bite. The merchant on floors 3, 6 and 8 sells draughts.</li>
        <li>Bosses guard floors 5 and 10. They have phases and get faster when hurt.</li>
      </ul>`;
  }

  help(inGame: boolean): void {
    if (inGame) {
      this.hud.openModal(Menus.helpHtml(), () => {}, true);
      return;
    }
    this.show(`<div class="panel modal">${Menus.helpHtml()}<div style="margin-top:14px"><button class="btn" data-act="back">Back</button></div></div>`, (act) => {
      if (act === 'back') this.title();
    });
  }

  pause(): void {
    this.hud.openModal(`<h2>☰ Paused</h2>
      <div class="menu-col" style="width:100%">
        <button class="btn primary" data-act="resume">Resume</button>
        <button class="btn" data-act="help">How to Play</button>
        <button class="btn" data-act="settings">Settings</button>
        <button class="btn" data-act="quit">Save &amp; Quit to Title</button>
        <button class="btn" data-act="abandon" style="border-color:#7a2a20">Abandon Run</button>
      </div>
      <p class="dim" style="font-size:13px">The run is saved at the start of each floor. Quitting resumes from the start of this floor.</p>`, (act) => {
      if (act === 'resume') this.hud.closeModal();
      else if (act === 'help') this.help(true);
      else if (act === 'settings') this.settings(true);
      else if (act === 'quit') {
        this.hud.closeModal();
        this.cb.toTitle();
      } else if (act === 'abandon') {
        this.hud.openModal('<h2>Abandon this run?</h2><p class="dim">It will count as a death. Soul shards are still awarded.</p><div style="display:flex;gap:8px"><button class="btn" data-act="no">Keep fighting</button><button class="btn" data-act="yes" style="border-color:#a03020">Abandon</button></div>', (a) => {
          if (a === 'yes') {
            this.hud.closeModal();
            this.abandon?.();
          } else this.pause();
        });
      }
    });
  }

  abandon: (() => void) | null = null;

  end(g: Game, shards: number): void {
    const s = g.stats;
    const p = g.player;
    const win = g.won;
    this.show(`<div class="panel modal" style="text-align:center;width:min(680px,94vw)">
      <h2 style="justify-content:center;font-size:38px;color:${win ? 'var(--accent)' : '#ff6a50'}">${win ? 'Victory' : 'You Have Fallen'}</h2>
      <div class="dim" style="font-size:18px;margin-top:6px">${win ? `The heart of ${esc(g.theme.dungeonName)} is destroyed. Legends will be sung.` : `Your ${CLASSES[p.cls].name.toLowerCase()} fell on depth ${g.depth} of ${esc(g.theme.dungeonName)}.`}</div>
      <div class="end-stats">
        <div><b>${g.depth}</b>Depth</div><div><b>${p.level}</b>Level</div><div><b>${s.kills}</b>Kills</div>
        <div><b>${s.bosses}</b>Bosses</div><div><b>${s.dmgDealt}</b>Damage dealt</div><div><b>${s.turns}</b>Turns</div>
      </div>
      <div style="font-size:20px;margin-bottom:16px">+${shards} <span class="accent">✦ soul shards</span></div>
      <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
        <button class="btn primary" data-act="again">New Descent</button>
        <button class="btn" data-act="altar">Soul Altar</button>
        <button class="btn" data-act="title">Title</button>
      </div></div>`, (act) => {
      if (act === 'again') this.classSelect();
      else if (act === 'altar') this.upgrades();
      else this.cb.toTitle();
    });
  }
}
