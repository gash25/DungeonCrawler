import { audio } from './audio';
import { Game } from './game/game';
import { randomSeed } from './game/rng';
import { biomeForDepth } from './game/theme';
import type { ClassKey, GEvent } from './game/types';
import { loadMeta, loadRun, metaBonuses, saveMeta, saveRun, shardsForRun } from './meta';
import { Renderer } from './render/renderer';
import { Hud, applyUiTheme } from './ui/hud';
import { Controller } from './ui/input';
import { Menus } from './ui/menus';

const stage = document.getElementById('stage')!;
const ui = document.getElementById('ui')!;
const meta = loadMeta();

function loading(text: string): HTMLElement {
  const d = document.createElement('div');
  d.className = 'loading';
  d.textContent = text;
  document.body.appendChild(d);
  return d;
}

function webglOk(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!c.getContext('webgl2');
  } catch {
    return false;
  }
}

if (!webglOk()) {
  ui.innerHTML = '<div class="title-screen"><div class="logo"><div class="t1">Depths Unbound</div></div><p style="max-width:480px;text-align:center">This game needs WebGL 2. Please use a recent version of Chrome, Edge, Firefox or Safari with hardware acceleration enabled.</p></div>';
  throw new Error('WebGL2 not supported');
}

const renderer = new Renderer(stage, meta.settings.quality);
let game: Game | null = null;
let endShown = false;

const hud = new Hud(ui, renderer, {
  onAbility: (i) => ctrl.ability(i),
  onQuick: (k) => ctrl.quick(k),
  onWait: () => game && !renderer.busy && game.playerWait(),
  onRest: () => ctrl.startRest(),
  onExplore: () => ctrl.startExplore(),
  onRotate: (d) => renderer.rotate(d),
  onPause: () => menus.pause(),
  onUseItem: (uid) => ctrl.useItem(uid),
  onDescend: () => ctrl.descend(),
  onHelp: () => menus.help(true),
});

const ctrl = new Controller(renderer.gl.domElement, renderer, hud, () => {
  if (game && !game.over) menus.pause();
});

const menus = new Menus(ui, meta, hud, {
  newRun: (cls) => startRun(cls),
  continueRun: () => continueRun(),
  hasSave: () => !!loadRun(),
  toTitle: () => showTitle(),
  applySettings: (reload) => {
    audio.setVolumes(meta.settings.music, meta.settings.sfx);
    if (reload) location.reload();
  },
});
menus.abandon = () => {
  if (!game) return;
  game.over = true;
  finishRun(game);
};

audio.setVolumes(meta.settings.music, meta.settings.sfx);
const unlockAudio = () => {
  audio.init();
  audio.setVolumes(meta.settings.music, meta.settings.sfx);
  if (game) audio.startMusic(biomeForDepth(game.theme, game.depth).key);
  window.removeEventListener('pointerdown', unlockAudio);
  window.removeEventListener('keydown', unlockAudio);
};
window.addEventListener('pointerdown', unlockAudio);
window.addEventListener('keydown', unlockAudio);

// ------------------------------------------------------------------ sounds & event glue (runs in sync with animation)
renderer.listeners.push((e: GEvent, wp) => {
  hud.onEvent(e, wp);
  const g = game;
  if (!g || renderer.demo) return;
  const pid = g.player.id;
  switch (e.t) {
    case 'move':
      if (e.id === pid) audio.play('step');
      if (e.mode === 'blink' && (e.id === pid || g.isVisible(e.x, e.y))) audio.play('spell', 'arcane');
      break;
    case 'attack':
      audio.play('swing');
      break;
    case 'damage':
      if (e.id === pid) audio.play('hurt');
      else if (e.crit) audio.play('crit');
      else audio.play('hit');
      break;
    case 'miss': audio.play('miss'); break;
    case 'death': audio.play('death'); break;
    case 'projectile': audio.play('spell', e.kind); break;
    case 'aoe': if (e.radius > 0) audio.play(e.kind === 'fire' && e.radius === 1 ? 'boom' : 'spell', e.kind); break;
    case 'heal': if (e.id === pid && e.amount > 2) audio.play('heal'); break;
    case 'pickup':
      if (!e.rarity) audio.play('coin');
      else if (e.rarity === 'rare' || e.rarity === 'epic' || e.rarity === 'artifact') audio.play('loot');
      else audio.play('pickup');
      break;
    case 'levelup': audio.play('levelup'); break;
    case 'feature': audio.play('chest'); break;
    case 'trap': audio.play('trap'); break;
    case 'telegraph': audio.play('warn'); break;
    case 'log': if (e.cls === 'boss') audio.play('roar'); break;
    case 'shop': hud.openShop(); break;
    case 'floor':
      audio.play('stairs');
      audio.startMusic(biomeForDepth(g.theme, g.depth).key);
      break;
    case 'gameover':
      audio.play(e.win ? 'victory' : 'gameover');
      setTimeout(() => finishRun(g), e.win ? 2500 : 1800);
      break;
    default:
  }
});

// ------------------------------------------------------------------ flow
function attach(g: Game): void {
  game = g;
  endShown = false;
  menus.hide();
  renderer.demo = false;
  renderer.setGame(g);
  hud.setGame(g);
  ctrl.game = g;
  ctrl.cancel();
  g.autoSave = (gg) => saveRun(gg.toSave());
  hud.banner();
  hud.log(`${g.theme.dungeonName}. Ten floors below lies its heart.`, 'floor');
  hud.log('Press ? for help. Red tiles mean: move!', 'dim');
  audio.startMusic(biomeForDepth(g.theme, g.depth).key);
}

function startRun(cls: ClassKey): void {
  const l = loading('FORGING THE DUNGEON…');
  setTimeout(() => {
    const g = Game.newRun(randomSeed(), cls, metaBonuses(meta));
    saveRun(g.toSave());
    meta.runs++;
    saveMeta(meta);
    attach(g);
    l.remove();
  }, 30);
}

function continueRun(): void {
  const s = loadRun();
  if (!s) return;
  const l = loading('RETURNING TO THE DEPTHS…');
  setTimeout(() => {
    try {
      attach(Game.load(s));
    } catch (err) {
      console.error(err);
      saveRun(null);
      showTitle();
    }
    l.remove();
  }, 30);
}

function finishRun(g: Game): void {
  if (endShown || game !== g) return;
  endShown = true;
  saveRun(null);
  const shards = shardsForRun(g.stats, g.depth, g.won);
  meta.shards += shards;
  meta.bestDepth = Math.max(meta.bestDepth, g.depth);
  if (g.won) {
    meta.wins++;
    meta.winsByClass[g.player.cls] = (meta.winsByClass[g.player.cls] ?? 0) + 1;
  }
  saveMeta(meta);
  hud.closeModal();
  ctrl.game = null;
  menus.end(g, shards);
}

function showTitle(): void {
  game = null;
  ctrl.game = null;
  hud.setGame(null);
  // A live, slowly orbiting demo floor behind the title screen
  const demo = Game.newRun(randomSeed(), (['warrior', 'rogue', 'mage'] as ClassKey[])[Math.floor(Math.random() * 3)], metaBonuses(meta));
  renderer.setGame(demo);
  renderer.demo = true;
  applyUiTheme(demo.theme);
  menus.title();
  audio.startMusic(biomeForDepth(demo.theme, 1).key);
}

// ------------------------------------------------------------------ loop
let lastT = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.1, (t - lastT) / 1000);
  lastT = t;
  const g = game;
  if (g) {
    ctrl.update(dt);
    if (g.perkChoices && !hud.modalOpen && !renderer.busy && !g.over) hud.openPerks();
    audio.setCombat(g.visibleEnemies().some((a) => a.alerted));
  }
  renderer.update(dt);
  hud.update(dt);
  requestAnimationFrame(frame);
}

// Keep keyboard focus off HUD buttons so Space/Enter never double-trigger them
document.addEventListener('click', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('button')) (document.activeElement as HTMLElement | null)?.blur?.();
});

window.addEventListener('resize', () => renderer.resize(stage.clientWidth, stage.clientHeight));
document.addEventListener('visibilitychange', () => {
  lastT = performance.now();
});

const boot = loading('LIGHTING THE TORCHES…');
setTimeout(() => {
  showTitle();
  boot.remove();
  requestAnimationFrame(frame);
}, 30);

// Debug/test handle (used by automated screenshot tests)
(window as unknown as { __dc: unknown }).__dc = { get game() { return game; }, renderer, ctrl };
