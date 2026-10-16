import { ABILITIES, type AbilityDef } from './abilities';
import { ABILITY_UNLOCK, CLASSES } from './classes';
import { bfs, BOSS_FLOORS, FINAL_DEPTH, generateFloor } from './dungeon';
import { astar, chebyshev, computeFov, hasLos, lineTiles } from './fov';
import {
  genArtifact, genConsumable, genEquipment, makeBaseItem, peekUid, randomConsumable, setUidCounter,
} from './items';
import { makeRoster, TRAIT_DESC, type Roster } from './monsters';
import { perkCount, perkDef, rollPerks } from './perks';
import { RNG } from './rng';
import { biomeForDepth, makeRunTheme, type RunTheme } from './theme';
import {
  T, baseStats, type Actor, type ClassKey, type DmgKind, type EquipSlot, type Feature, type FloorData, type GEvent,
  type GroundItem, type Item, type MonsterDef, type Player, type Stats, type StatusKind, type Trait, type Vec,
} from './types';

export interface MetaBonuses {
  bonusHp: number;
  startPotions: number;
  lootBoost: number;
  perkChoices: number;
}

export interface RunStats {
  kills: number;
  dmgDealt: number;
  dmgTaken: number;
  gold: number;
  bosses: number;
  turns: number;
  items: number;
}

export interface SaveData {
  v: 1;
  runSeed: number;
  depth: number;
  player: Player;
  stats: RunStats;
  uid: number;
  turn: number;
  meta: MetaBonuses;
  artifactsSeen: string[];
}

export const INV_MAX = 20;
export const REST_CAP = 0.5;

interface AttackOpts {
  mult?: number;
  kind?: DmgKind;
  noMiss?: boolean;
  forceCrit?: boolean;
  ability?: boolean;
  ranged?: boolean;
}

const ELITE_TRAITS: Trait[] = ['vampiric', 'regenerating', 'armored', 'swift', 'ethereal', 'burning', 'freezing', 'thorny', 'poisonous', 'explosive'];
const ELITE_NAMES: Record<Trait, string> = {
  poisonous: 'Venomous', vampiric: 'Vampiric', explosive: 'Volatile', splitter: 'Dividing', regenerating: 'Undying',
  armored: 'Ironclad', swift: 'Frenzied', ethereal: 'Phasing', burning: 'Blazing', freezing: 'Frostborn', thorny: 'Barbed',
};

export function xpFor(level: number): number {
  return Math.round(20 * Math.pow(level, 1.5));
}

function addStats(s: Stats, add: Partial<Stats>): void {
  for (const k in add) {
    const key = k as keyof Stats;
    s[key] += add[key] ?? 0;
  }
}

export class Game {
  readonly runSeed: number;
  readonly theme: RunTheme;
  readonly roster: Roster;
  meta: MetaBonuses;
  rng: RNG;
  depth = 0;
  floor!: FloorData;
  tiles!: Uint8Array;
  w = 0;
  h = 0;
  blocked!: Uint8Array;
  explored!: Uint8Array;
  visible!: Uint8Array;
  fovVersion = 0;
  floorVersion = 0;
  actors: Actor[] = [];
  player!: Player;
  ground: GroundItem[] = [];
  turn = 0;
  over = false;
  won = false;
  perkChoices: string[] | null = null;
  pendingLevels = 0;
  stats: RunStats = { kills: 0, dmgDealt: 0, dmgTaken: 0, gold: 0, bosses: 0, turns: 0, items: 0 };
  shop: Item[] = [];
  artifactsSeen: string[] = [];
  autoSave?: (g: Game) => void;
  private nextId = 1;
  private nextGid = 1;
  private listeners: ((e: GEvent) => void)[] = [];

  constructor(runSeed: number, meta: MetaBonuses) {
    this.runSeed = runSeed >>> 0;
    this.meta = meta;
    const root = new RNG(this.runSeed);
    this.theme = makeRunTheme(root.fork('theme'));
    this.roster = makeRoster(root.fork('roster'), this.theme.biomes);
    this.rng = new RNG((this.runSeed ^ ((Math.random() * 4294967296) >>> 0)) >>> 0);
  }

  static newRun(seed: number, cls: ClassKey, meta: MetaBonuses): Game {
    const g = new Game(seed, meta);
    g.player = g.createPlayer(cls);
    g.enterFloor(1);
    return g;
  }

  static load(save: SaveData): Game {
    const g = new Game(save.runSeed, save.meta);
    g.player = save.player;
    g.player.id = g.nextId++;
    g.stats = save.stats;
    g.turn = save.turn;
    g.artifactsSeen = save.artifactsSeen ?? [];
    setUidCounter(save.uid);
    g.recalc();
    g.enterFloor(save.depth, true);
    return g;
  }

  toSave(): SaveData {
    return {
      v: 1, runSeed: this.runSeed, depth: this.depth, player: JSON.parse(JSON.stringify(this.player)),
      stats: { ...this.stats }, uid: peekUid(), turn: this.turn, meta: this.meta, artifactsSeen: this.artifactsSeen,
    };
  }

  on(fn: (e: GEvent) => void): () => void {
    this.listeners.push(fn);
    return () => (this.listeners = this.listeners.filter((l) => l !== fn));
  }

  emit(e: GEvent): void {
    for (const l of this.listeners) l(e);
  }

  log(text: string, cls?: string): void {
    this.emit({ t: 'log', text, cls });
  }

  // ------------------------------------------------------------------ setup
  private createPlayer(cls: ClassKey): Player {
    const c = CLASSES[cls];
    const base = baseStats({ ...c.base });
    base.maxHp += this.meta.bonusHp;
    const p: Player = {
      id: this.nextId++, isPlayer: true, name: c.name, x: 0, y: 0, hp: base.maxHp, mp: base.maxMp, base, stats: { ...base },
      energy: 100, statuses: [], dead: false, cds: {}, cls, level: 1, xp: 0, xpNext: xpFor(1), gold: 0, inv: [],
      equip: { weapon: makeBaseItem(c.weapon, 1), armor: makeBaseItem(c.armor, 1), helm: null, ring: null, amulet: null },
      abilities: c.abilities.slice(0, 2), perks: [], flags: {}, kills: 0, mpAcc: 0, hpAcc: 0, lastStandUsed: false, phoenixUsed: false,
    };
    p.inv.push(genConsumable('heal', 2 + this.meta.startPotions));
    p.inv.push(genConsumable(cls === 'mage' || cls === 'cleric' ? 'mana' : 'bomb', 1));
    this.player = p;
    this.recalc();
    p.hp = p.stats.maxHp;
    p.mp = p.stats.maxMp;
    return p;
  }

  hasArtifact(key: string): boolean {
    const e = this.player.equip;
    return !!(e.weapon?.artifact === key || e.armor?.artifact === key || e.helm?.artifact === key || e.ring?.artifact === key || e.amulet?.artifact === key);
  }

  recalc(): void {
    const p = this.player;
    const s: Stats = { ...p.base };
    for (const it of Object.values(p.equip)) if (it) addStats(s, it.stats);
    for (const k of p.perks) {
      const d = perkDef(k);
      if (d?.stats) addStats(s, d.stats);
    }
    if (this.hasArtifact('glass')) s.maxHp *= 0.7;
    s.maxHp = Math.max(1, Math.round(s.maxHp));
    s.maxMp = Math.max(0, Math.round(s.maxMp));
    s.dmgMin = Math.max(1, Math.round(s.dmgMin));
    s.dmgMax = Math.max(s.dmgMin, Math.round(s.dmgMax));
    s.armor = Math.max(0, Math.round(s.armor));
    s.eva = Math.max(0, s.eva);
    s.speed = Math.max(50, s.speed);
    p.stats = s;
    p.hp = Math.min(p.hp, s.maxHp);
    p.mp = Math.min(p.mp, s.maxMp);
  }

  enterFloor(depth: number, fromLoad = false): void {
    this.depth = depth;
    const biome = biomeForDepth(this.theme, depth);
    const frng = new RNG(this.runSeed).fork('floor' + depth);
    const name = depth === FINAL_DEPTH ? 'The Heart of the Dungeon' : `The ${frng.pick(biome.placeAdj)} ${frng.pick(biome.placeNouns)}`;
    this.floor = generateFloor(frng, { depth, biome, roster: this.roster, floorName: name });
    const { w, h } = this.floor;
    this.w = w;
    this.h = h;
    this.tiles = this.floor.tiles;
    this.explored = new Uint8Array(w * h);
    this.visible = new Uint8Array(w * h);
    this.blocked = new Uint8Array(w * h);
    for (const f of this.floor.features) {
      if (f.kind === 'chest' || f.kind === 'shrine' || f.kind === 'fountain' || f.kind === 'merchant' || f.kind === 'brazier') {
        this.blocked[f.y * w + f.x] = 1;
      }
    }
    const p = this.player;
    p.x = this.floor.start.x;
    p.y = this.floor.start.y;
    p.energy = 100;
    p.statuses = [];
    p.lastStandUsed = false;
    this.actors = [p];
    this.ground = [];
    this.perkChoices = this.pendingLevels > 0 ? rollPerks(this.rng, p, 3 + this.meta.perkChoices) : null;
    for (const s of this.floor.spawns) this.spawnMonster(s.def, s.x, s.y, s.elite, s.asleep);
    this.shop = [];
    if (this.floor.features.some((f) => f.kind === 'merchant')) this.makeShop();
    if (this.hasArtifact('aegis')) this.addStatus(p, 'shield', 15, 8 + p.level);
    if (this.hasArtifact('eye')) this.revealMap(false);
    this.updateFov();
    this.floorVersion++;
    this.emit({ t: 'floor' });
    this.log(`${this.floor.name} — depth ${depth}`, 'floor');
    if (BOSS_FLOORS.includes(depth)) this.log('A terrible presence stirs somewhere on this floor...', 'warn');
    if (!fromLoad || true) this.autoSave?.(this);
  }

  private makeShop(): void {
    const r = this.rng;
    const d = this.depth;
    this.shop = [genConsumable('heal'), genConsumable('heal'), genConsumable('mana'), randomConsumable(r)];
    for (let i = 0; i < 4; i++) this.shop.push(genEquipment(r, d + 1, 0.6 + this.meta.lootBoost));
    if (r.chance(0.35)) this.shop.push(genConsumable('elixir'));
  }

  shopPrice(it: Item): number {
    return Math.round(it.value * (it.slot === 'consumable' ? 1 + this.depth * 0.12 : 1.1));
  }

  sellPrice(it: Item): number {
    return Math.max(1, Math.floor(it.value / 3));
  }

  spawnMonster(def: MonsterDef, x: number, y: number, elite: boolean, asleep: boolean, summoned = false): Actor {
    const dm = def.boss ? 1 : 1 + 0.13 * (this.depth - 1);
    const eliteTraits: Trait[] = [];
    if (elite) {
      const n = this.depth >= 6 ? 2 : 1;
      while (eliteTraits.length < n) {
        const t = this.rng.pick(ELITE_TRAITS);
        if (!def.traits.includes(t) && !eliteTraits.includes(t)) eliteTraits.push(t);
      }
    }
    const traits = [...def.traits, ...eliteTraits];
    const dmDmg = def.boss ? 1 : 1 + 0.25 * (this.depth - 1);
    const hp = Math.round(def.hp * dm * (elite ? 1.8 : 1) * (summoned ? 0.6 : 1));
    const dmul = dmDmg * (elite ? 1.25 : 1);
    const st = baseStats({
      maxHp: hp, dmgMin: Math.round(def.dmg[0] * dmul), dmgMax: Math.round(def.dmg[1] * dmul), armor: def.armor + (eliteTraits.includes('armored') ? 3 : 0),
      acc: def.acc + this.depth, eva: def.eva + (eliteTraits.includes('ethereal') ? 18 : 0), speed: def.speed + (eliteTraits.includes('swift') ? 35 : 0),
      crit: 5 + def.tier, sight: def.boss ? 12 : 7,
      thorns: traits.includes('thorny') ? Math.round(2 + this.depth * 0.6) : 0,
      hpRegen: traits.includes('regenerating') ? Math.max(0.5, hp * 0.03) : 0,
      lifesteal: traits.includes('vampiric') ? 35 : 0,
    });
    const name = elite ? `${ELITE_NAMES[eliteTraits[0]]} ${def.name}` : def.name;
    const a: Actor = {
      id: this.nextId++, isPlayer: false, name, x, y, hp, mp: 0, base: st, stats: { ...st }, energy: this.rng.int(0, 90), statuses: [],
      dead: false, cds: {}, def, alerted: !asleep && summoned, asleep, lastSeen: null, elite: eliteTraits, boss: def.boss, summoned,
      telegraph: null, phase: 1, regenAcc: 0, lostTurns: 0,
    };
    for (const ab of def.abilities) a.cds[ab] = this.rng.int(0, 3);
    this.actors.push(a);
    this.emit({ t: 'spawn', id: a.id });
    return a;
  }

  traitsOf(a: Actor): Trait[] {
    return a.def ? [...a.def.traits, ...(a.elite ?? [])] : [];
  }

  describeMonster(a: Actor): string[] {
    const out: string[] = [];
    if (a.def) out.push(a.def.desc);
    for (const t of this.traitsOf(a)) out.push(TRAIT_DESC[t]);
    if (a.def && a.def.range > 1) out.push(`Ranged (${a.def.range})`);
    return out;
  }

  // ------------------------------------------------------------------ queries
  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.w && y < this.h;
  }

  tile(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tiles[y * this.w + x] : T.Wall;
  }

  isWall(x: number, y: number): boolean {
    return this.tile(x, y) === T.Wall;
  }

  isPassable(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.tiles[y * this.w + x] !== T.Wall && !this.blocked[y * this.w + x];
  }

  isWalkable(x: number, y: number): boolean {
    return this.isPassable(x, y) && !this.actorAt(x, y);
  }

  actorAt(x: number, y: number): Actor | undefined {
    for (const a of this.actors) if (!a.dead && a.x === x && a.y === y) return a;
    return undefined;
  }

  isVisible(x: number, y: number): boolean {
    return this.inBounds(x, y) && this.visible[y * this.w + x] === 1;
  }

  los(a: Vec, b: Vec): boolean {
    return hasLos(this.tiles, this.w, a, b);
  }

  hasStatus(a: Actor, k: StatusKind): boolean {
    return a.statuses.some((s) => s.kind === k && s.turns > 0);
  }

  featureAt(x: number, y: number): Feature | undefined {
    return this.floor.features.find((f) => f.x === x && f.y === y && f.kind !== 'torch' && f.kind !== 'decor' && f.kind !== 'pillar');
  }

  enemiesInRadius(x: number, y: number, r: number, of: Actor, needLos = false): Actor[] {
    return this.actors.filter((a) => !a.dead && a.isPlayer !== of.isPlayer && chebyshev(a, { x, y }) <= r && (!needLos || this.los({ x, y }, a)));
  }

  visibleEnemies(): Actor[] {
    return this.actors.filter((a) => !a.dead && !a.isPlayer && this.isVisible(a.x, a.y));
  }

  canAct(): boolean {
    return !this.over && !this.perkChoices;
  }

  updateFov(): void {
    const p = this.player;
    computeFov(this.tiles, this.w, this.h, p.x, p.y, Math.round(p.stats.sight), this.visible);
    for (let i = 0; i < this.visible.length; i++) if (this.visible[i]) this.explored[i] = 1;
    this.fovVersion++;
  }

  revealMap(traps: boolean): void {
    const { w, h } = this;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (this.tiles[i] !== T.Wall) {
          this.explored[i] = 1;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.inBounds(x + dx, y + dy)) this.explored[(y + dy) * w + x + dx] = 1;
        }
      }
    }
    if (traps) {
      this.floor.features.forEach((f, i) => {
        if (f.kind === 'trap' && f.hidden) {
          f.hidden = false;
          this.emit({ t: 'feature', index: i });
        }
      });
    }
    this.fovVersion++;
  }

  // ------------------------------------------------------------------ status & damage
  addStatus(a: Actor, kind: StatusKind, turns: number, power: number): void {
    if (a.dead) return;
    const cc = kind === 'stun' || kind === 'freeze' || kind === 'root';
    if (cc && (a.cds.ccImmune ?? 0) > 0) return;
    if (cc && a.boss) turns = Math.min(turns, 1);
    const ex = a.statuses.find((s) => s.kind === kind);
    if (ex) {
      ex.turns = Math.max(ex.turns, turns);
      ex.power = kind === 'shield' ? ex.power + power : Math.max(ex.power, power);
    } else a.statuses.push({ kind, turns, power });
    if (cc) a.cds.ccImmune = turns + (a.boss ? 4 : a.isPlayer ? 2 : 1);
    if (kind === 'freeze' && a.isPlayer) this.log('You are frozen solid!', 'bad');
    this.emit({ t: 'status', id: a.id, kind });
  }

  heal(a: Actor, amount: number): void {
    if (a.dead || amount <= 0) return;
    const before = a.hp;
    a.hp = Math.min(a.stats.maxHp, a.hp + Math.round(amount));
    if (a.hp > before) this.emit({ t: 'heal', id: a.id, amount: a.hp - before });
  }

  empower(u: Actor, key: string): number {
    return u.isPlayer ? 1 + 0.4 * perkCount(this.player, 'emp:' + key) : 1;
  }

  spellScale(u: Actor, key: string): number {
    if (!u.isPlayer) return 1;
    return (1 + u.stats.spellPower / 100) * (1 + 0.09 * (this.player.level - 1)) * this.empower(u, key);
  }

  private modDamage(att: Actor, tgt: Actor, dmg: number): number {
    if (this.hasStatus(att, 'weak')) dmg *= 0.7;
    if (this.hasStatus(att, 'enrage')) dmg *= 1.3;
    if (this.hasStatus(tgt, 'vuln')) dmg *= 1.3;
    if (att.isPlayer) {
      if (this.hasArtifact('glass')) dmg *= 1.5;
      if (this.hasArtifact('berserk')) dmg *= 1 + 0.8 * (1 - att.hp / att.stats.maxHp);
      if (this.player.perks.includes('executioner') && tgt.hp < tgt.stats.maxHp * 0.3) dmg *= 1.5;
    }
    return dmg;
  }

  attack(att: Actor, tgt: Actor, o: AttackOpts = {}): number {
    if (tgt.dead || att.dead) return -1;
    if (!o.ranged) this.emit({ t: 'attack', id: att.id, tx: tgt.x, ty: tgt.y });
    const hitChance = Math.max(10, Math.min(97, att.stats.acc - tgt.stats.eva));
    const wasAsleep = tgt.asleep;
    if (tgt.asleep) {
      tgt.asleep = false;
      tgt.alerted = true;
    }
    if (!o.noMiss && !wasAsleep && this.rng.next() * 100 >= hitChance) {
      this.emit({ t: 'miss', id: tgt.id });
      if (att.isPlayer) this.log(`You miss the ${tgt.name}.`, 'dim');
      return -1;
    }
    let dmg = this.rng.int(Math.round(att.stats.dmgMin), Math.round(att.stats.dmgMax)) * (o.mult ?? 1);
    let crit = !!o.forceCrit || this.rng.next() * 100 < att.stats.crit;
    if (att.isPlayer && (this.player.flags.nextCrit ?? -1) >= this.turn) {
      crit = true;
      this.player.flags.nextCrit = -1;
    }
    if (crit) dmg *= att.stats.critMul;
    dmg = this.modDamage(att, tgt, dmg);
    dmg *= 100 / (100 + tgt.stats.armor * 5);
    dmg = Math.max(1, Math.round(dmg));
    const kind: DmgKind = o.kind ?? (att.def?.dmgKind ?? 'phys');
    const dealt = this.damage(tgt, dmg, kind, crit, att);
    this.onHit(att, tgt, dealt, !!o.ranged);
    return dealt;
  }

  private onHit(att: Actor, tgt: Actor, dealt: number, ranged: boolean): void {
    if (dealt <= 0) return;
    if (att.stats.lifesteal > 0) this.heal(att, Math.max(1, Math.round((dealt * att.stats.lifesteal) / 100)));
    if (att.stats.fireOnHit > 0 && !tgt.dead) this.damage(tgt, Math.round(att.stats.fireOnHit), 'fire', false, att);
    if (att.isPlayer) {
      const p = this.player;
      if (p.cls === 'warrior') p.mp = Math.min(p.stats.maxMp, p.mp + 1);
      if (!tgt.dead && this.hasArtifact('storm') && this.rng.chance(0.25)) this.chainLightning(att, tgt, 6 + p.level * 1.5, 3);
      if (!tgt.dead && this.hasArtifact('frostbite') && this.rng.chance(0.2)) this.addStatus(tgt, 'freeze', 1, 0);
      if (!tgt.dead && !tgt.boss && this.hasArtifact('executioner') && tgt.hp < tgt.stats.maxHp * 0.15) {
        this.log(`You execute the ${tgt.name}!`, 'good');
        this.damage(tgt, tgt.hp, 'phys', true, att);
      }
    } else {
      const tr = this.traitsOf(att);
      const pw = Math.round(1 + this.depth / 3);
      if (tr.includes('poisonous')) this.addStatus(tgt, 'poison', 3, pw);
      if (tr.includes('burning')) this.addStatus(tgt, 'burn', 3, pw);
      if (tr.includes('freezing') && this.rng.chance(0.15)) this.addStatus(tgt, 'freeze', 1, 0);
    }
    if (!ranged && !att.dead) {
      let reflect = tgt.stats.thorns;
      if (tgt.isPlayer && this.hasArtifact('thornmail')) reflect += dealt * 0.4;
      if (reflect > 0) this.damage(att, Math.max(1, Math.round(reflect)), 'phys', false, tgt);
    }
  }

  spellHit(att: Actor, tgt: Actor, amount: number, kind: DmgKind): number {
    if (tgt.dead) return 0;
    let dmg = amount;
    const crit = this.rng.next() * 100 < att.stats.crit / 2;
    if (crit) dmg *= att.stats.critMul;
    dmg = this.modDamage(att, tgt, dmg);
    dmg *= 100 / (100 + tgt.stats.armor * 3);
    if (tgt.asleep) {
      tgt.asleep = false;
      tgt.alerted = true;
    }
    return this.damage(tgt, Math.max(1, Math.round(dmg)), kind, crit, att);
  }

  chainLightning(att: Actor, first: Actor, amount: number, jumps: number): void {
    const hit = new Set<number>();
    let cur: Actor | undefined = first;
    let from: Vec = { x: att.x, y: att.y };
    let dmg = amount;
    for (let i = 0; i < jumps && cur; i++) {
      hit.add(cur.id);
      this.emit({ t: 'projectile', from, to: { x: cur.x, y: cur.y }, kind: 'lightning' });
      this.spellHit(att, cur, dmg, 'lightning');
      from = { x: cur.x, y: cur.y };
      dmg *= 0.85;
      const prev: Actor = cur;
      cur = this.actors
        .filter((a) => !a.dead && !a.isPlayer && !hit.has(a.id) && chebyshev(a, prev) <= 3 && this.los(prev, a))
        .sort((a, b) => chebyshev(a, prev) - chebyshev(b, prev))[0];
    }
  }

  damage(tgt: Actor, amount: number, kind: DmgKind, crit: boolean, src?: Actor): number {
    if (tgt.dead) return 0;
    amount = Math.max(0, Math.round(amount));
    const sh = tgt.statuses.find((s) => s.kind === 'shield');
    if (sh && sh.power > 0) {
      const ab = Math.min(sh.power, amount);
      sh.power -= ab;
      amount -= ab;
      if (sh.power <= 0) sh.turns = 0;
    }
    tgt.hp -= amount;
    this.emit({ t: 'damage', id: tgt.id, amount, crit, kind });
    if (tgt.isPlayer) this.stats.dmgTaken += amount;
    else if (src?.isPlayer) this.stats.dmgDealt += amount;
    if (!tgt.isPlayer && src?.isPlayer) {
      tgt.alerted = true;
      tgt.asleep = false;
      tgt.lastSeen = { x: src.x, y: src.y };
    }
    if (tgt.isPlayer && amount > tgt.stats.maxHp * 0.15) this.emit({ t: 'shake', power: Math.min(0.6, amount / tgt.stats.maxHp) });
    if (tgt.hp <= 0) {
      if (tgt.isPlayer) {
        const p = this.player;
        if (p.perks.includes('laststand') && !p.lastStandUsed) {
          p.lastStandUsed = true;
          p.hp = 1;
          this.log('LAST STAND! You refuse to fall.', 'good');
          return amount;
        }
        if (this.hasArtifact('phoenix') && !p.phoenixUsed) {
          p.phoenixUsed = true;
          p.hp = Math.round(p.stats.maxHp / 2);
          this.log('The phoenix flame consumes you... and you rise again!', 'good');
          this.emit({ t: 'aoe', x: p.x, y: p.y, radius: 2, kind: 'fire' });
          for (const e of this.enemiesInRadius(p.x, p.y, 2, p)) this.damage(e, 10 + p.level * 2, 'fire', false, p);
          return amount;
        }
      }
      this.kill(tgt, src);
    }
    return amount;
  }

  private kill(a: Actor, src?: Actor): void {
    a.dead = true;
    a.hp = 0;
    a.telegraph = null;
    this.emit({ t: 'death', id: a.id });
    if (a.isPlayer) {
      this.over = true;
      this.won = false;
      this.log(`You have been slain${src ? ` by the ${src.name}` : ''}.`, 'bad');
      this.emit({ t: 'gameover', win: false });
      return;
    }
    const p = this.player;
    const tr = this.traitsOf(a);
    if (!a.summoned) {
      this.stats.kills++;
      p.kills++;
      const xp = Math.round((a.def?.xp ?? 5) * (1 + 0.2 * (this.depth - 1)) * (a.elite?.length ? 2 : 1) * (a.split ? 0.3 : 1));
      this.gainXp(xp);
      this.dropLoot(a);
    }
    if (perkCount(p, 'bloodlust')) this.heal(p, 5 * perkCount(p, 'bloodlust'));
    if (this.hasArtifact('bloodpact')) this.heal(p, 4);
    if (tr.includes('explosive')) {
      this.emit({ t: 'aoe', x: a.x, y: a.y, radius: 1, kind: 'fire' });
      this.emit({ t: 'shake', power: 0.3 });
      for (const t of this.actors) {
        if (!t.dead && t !== a && chebyshev(t, a) <= 1) this.damage(t, Math.round(4 + this.depth * 1.3), 'fire', false);
      }
    }
    if (tr.includes('splitter') && !a.split && a.def) {
      let made = 0;
      for (let dy = -1; dy <= 1 && made < 2; dy++) {
        for (let dx = -1; dx <= 1 && made < 2; dx++) {
          if (this.isWalkable(a.x + dx, a.y + dy)) {
            const c = this.spawnMonster(a.def, a.x + dx, a.y + dy, false, false);
            c.split = true;
            c.base.maxHp = c.stats.maxHp = Math.max(3, Math.round(c.stats.maxHp * 0.45));
            c.hp = c.stats.maxHp;
            c.alerted = true;
            made++;
          }
        }
      }
      if (made) this.log(`The ${a.name} splits apart!`, 'warn');
    }
    if (a.boss) {
      this.stats.bosses++;
      if (this.depth >= FINAL_DEPTH) {
        this.won = true;
        this.over = true;
        this.log(`${a.name} is destroyed. The dungeon falls silent. You are victorious!`, 'good');
        this.emit({ t: 'gameover', win: true });
        return;
      }
      const s = this.floor.stairs;
      this.tiles[s.y * this.w + s.x] = T.Stairs;
      this.log(`${a.name} falls! A stairway grinds open in the arena.`, 'good');
      this.emit({ t: 'stairs' });
      this.emit({ t: 'shake', power: 0.8 });
    }
  }

  private gainXp(n: number): void {
    const p = this.player;
    p.xp += n;
    while (p.xp >= p.xpNext) {
      p.xp -= p.xpNext;
      p.level++;
      p.xpNext = xpFor(p.level);
      const c = CLASSES[p.cls];
      p.base.maxHp += c.hpPerLevel;
      p.base.maxMp += c.mpPerLevel;
      p.base.dmgMin += 0.4;
      p.base.dmgMax += 0.7;
      p.base.acc += 1;
      this.recalc();
      this.heal(p, p.stats.maxHp * 0.35);
      p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * 0.5);
      for (let i = 0; i < ABILITY_UNLOCK.length; i++) {
        const key = c.abilities[i];
        if (p.level >= ABILITY_UNLOCK[i] && !p.abilities.includes(key)) {
          p.abilities.push(key);
          this.log(`New ability learned: ${ABILITIES[key].name}!`, 'good');
        }
      }
      this.pendingLevels++;
      this.log(`You reached level ${p.level}!`, 'good');
      this.emit({ t: 'levelup' });
    }
    if (this.pendingLevels > 0 && !this.perkChoices) this.perkChoices = rollPerks(this.rng, p, 3 + this.meta.perkChoices);
  }

  choosePerk(key: string): void {
    if (!this.perkChoices?.includes(key)) return;
    const p = this.player;
    const before = p.stats.maxHp;
    p.perks.push(key);
    this.recalc();
    if (p.stats.maxHp > before) p.hp += p.stats.maxHp - before;
    this.pendingLevels--;
    this.perkChoices = this.pendingLevels > 0 ? rollPerks(this.rng, p, 3 + this.meta.perkChoices) : null;
    this.log(`Perk gained: ${perkDef(key)?.name}.`, 'good');
  }

  // ------------------------------------------------------------------ loot
  private lootBoost(): number {
    return this.meta.lootBoost + perkCount(this.player, 'fortune') * 0.25 + (this.hasArtifact('midas') ? 0.3 : 0);
  }

  private goldMul(): number {
    return (1 + perkCount(this.player, 'fortune') * 0.5) * (this.hasArtifact('midas') ? 2 : 1);
  }

  addGround(x: number, y: number, item: Item | null, gold = 0): void {
    const g: GroundItem = { gid: this.nextGid++, x, y, item, gold };
    this.ground.push(g);
    this.emit({ t: 'ground', gid: g.gid, added: true });
  }

  private dropLoot(a: Actor): void {
    const r = this.rng;
    const d = this.depth;
    const boost = this.lootBoost();
    if (a.boss) {
      this.addGround(a.x, a.y, this.makeArtifact());
      this.addGround(a.x, a.y, genEquipment(r, d + 2, 1.5, undefined, 'epic'));
      this.addGround(a.x, a.y, genConsumable('heal', 2));
      this.addGround(a.x, a.y, null, Math.round(r.int(60, 100) * d * this.goldMul()));
      return;
    }
    const elite = !!a.elite?.length;
    if (r.chance(0.45 + (elite ? 0.4 : 0))) this.addGround(a.x, a.y, null, Math.round(r.int(2, 6) * (1 + d * 0.6) * this.goldMul()));
    if (r.chance(0.08 + (elite ? 0.3 : 0))) this.addGround(a.x, a.y, randomConsumable(r));
    if (r.chance(0.08 + boost * 0.05 + (elite ? 0.6 : 0))) this.addGround(a.x, a.y, genEquipment(r, d + (elite ? 1 : 0), boost + (elite ? 0.6 : 0)));
    if (elite && r.chance(0.04 + boost * 0.02)) this.addGround(a.x, a.y, this.makeArtifact());
  }

  makeArtifact(): Item {
    const it = genArtifact(this.rng, this.depth + 1, this.artifactsSeen);
    this.artifactsSeen.push(it.artifact!);
    return it;
  }

  private giveItem(it: Item): boolean {
    const p = this.player;
    if (it.slot === 'consumable') {
      const stack = p.inv.find((x) => x.consumable === it.consumable);
      if (stack) {
        stack.count = (stack.count ?? 1) + (it.count ?? 1);
        return true;
      }
    }
    if (p.inv.length >= INV_MAX) return false;
    p.inv.push(it);
    return true;
  }

  private pickupAt(x: number, y: number): void {
    const here = this.ground.filter((g) => g.x === x && g.y === y);
    for (const g of here) {
      if (g.gold) {
        this.player.gold += g.gold;
        this.stats.gold += g.gold;
        this.emit({ t: 'pickup', text: `+${g.gold} gold` });
      } else if (g.item) {
        if (!this.giveItem(g.item)) {
          this.log('Your pack is full.', 'warn');
          continue;
        }
        this.stats.items++;
        const n = g.item.count && g.item.count > 1 ? ` x${g.item.count}` : '';
        this.emit({ t: 'pickup', text: g.item.name + n, rarity: g.item.rarity });
        this.log(`Picked up ${g.item.name}${n}.`, g.item.rarity);
      }
      this.ground.splice(this.ground.indexOf(g), 1);
      this.emit({ t: 'ground', gid: g.gid, added: false });
    }
  }

  // ------------------------------------------------------------------ movement
  moveActor(a: Actor, x: number, y: number, mode: 'walk' | 'blink' | 'charge' = 'walk'): void {
    const fx = a.x, fy = a.y;
    a.x = x;
    a.y = y;
    this.emit({ t: 'move', id: a.id, x, y, fx, fy, mode });
    if (a.isPlayer) this.afterPlayerMove();
    else if (this.tile(x, y) === T.Hazard) this.applyHazard(a);
  }

  private afterPlayerMove(): void {
    const p = this.player;
    this.pickupAt(p.x, p.y);
    const feats = this.floor.features;
    const searchChance = (p.cls === 'rogue' ? 0.4 : 0.15) + (p.perks.includes('eagle') ? 0.25 : 0);
    for (let i = 0; i < feats.length; i++) {
      const f = feats[i];
      if (f.kind !== 'trap' || f.used) continue;
      if (f.x === p.x && f.y === p.y) {
        this.triggerTrap(f, i);
      } else if (f.hidden && chebyshev(f, p) <= 2 && this.rng.chance(searchChance)) {
        f.hidden = false;
        this.emit({ t: 'feature', index: i });
        this.log('You spot a hidden trap.', 'warn');
      }
    }
    if (this.tile(p.x, p.y) === T.Stairs) this.log(this.depth >= FINAL_DEPTH ? 'Stairs.' : 'Stairs lead down. Press Enter or click them again to descend.', 'info');
  }

  private triggerTrap(f: Feature, idx: number): void {
    const p = this.player;
    f.used = true;
    f.hidden = false;
    this.emit({ t: 'trap', x: f.x, y: f.y });
    this.emit({ t: 'feature', index: idx });
    const d = this.depth;
    if (f.variant === 0) {
      this.log('Spikes burst from the floor!', 'bad');
      this.damage(p, 5 + d * 2, 'phys', false);
      this.addStatus(p, 'bleed', 4, Math.round(1 + d / 3));
    } else if (f.variant === 1) {
      this.log('A gout of flame erupts!', 'bad');
      this.emit({ t: 'aoe', x: f.x, y: f.y, radius: 1, kind: 'fire' });
      for (const a of this.actors) if (!a.dead && chebyshev(a, f) <= 1) this.damage(a, 4 + d * 2, 'fire', false);
      if (!p.dead) this.addStatus(p, 'burn', 3, Math.round(1 + d / 3));
    } else {
      this.log('An alarm glyph shrieks! The dungeon knows where you are.', 'bad');
      for (const m of this.actors) {
        if (m.isPlayer || m.dead || chebyshev(m, p) > 16) continue;
        m.asleep = false;
        m.alerted = true;
        m.lastSeen = { x: p.x, y: p.y };
      }
    }
  }

  applyHazard(a: Actor): void {
    const biome = biomeForDepth(this.theme, this.depth);
    const d = this.depth;
    switch (biome.hazard) {
      case 'lava':
        this.damage(a, Math.round(5 + d * 1.5), 'fire', false);
        this.addStatus(a, 'burn', 2, Math.round(1 + d / 3));
        if (a.isPlayer) this.log('The lava sears you!', 'bad');
        break;
      case 'acid':
        this.damage(a, 2 + Math.floor(d / 2), 'poison', false);
        this.addStatus(a, 'poison', 3, Math.round(1 + d / 3));
        if (a.isPlayer) this.log('Caustic sludge burns your skin.', 'bad');
        break;
      case 'void':
        this.damage(a, Math.round(3 + d), 'arcane', false);
        a.mp = Math.max(0, a.mp - 5);
        if (a.isPlayer) this.log('The void gnaws at your mind.', 'bad');
        break;
      case 'water':
        this.addStatus(a, 'slow', 2, 0);
        a.statuses = a.statuses.filter((s) => s.kind !== 'burn');
        break;
      case 'ice':
        this.addStatus(a, 'slow', 2, 0);
        break;
      default:
    }
  }

  // ------------------------------------------------------------------ player actions
  playerStep(dx: number, dy: number): boolean {
    if (!this.canAct()) return false;
    const p = this.player;
    const nx = p.x + dx, ny = p.y + dy;
    if (!this.inBounds(nx, ny)) return false;
    const t = this.actorAt(nx, ny);
    if (t && !t.isPlayer) {
      this.attack(p, t, {});
      this.wakeNearby(p, 4);
      this.endTurn();
      return true;
    }
    const f = this.featureAt(nx, ny);
    if (f && this.blocked[ny * this.w + nx]) {
      if (this.interact(f)) this.endTurn();
      return true;
    }
    if (this.isWall(nx, ny)) return false;
    if (dx && dy && (this.isWall(p.x + dx, p.y) || this.isWall(p.x, p.y + dy))) return false;
    if (this.hasStatus(p, 'root')) {
      this.log('You are rooted in place!', 'bad');
      return false;
    }
    this.moveActor(p, nx, ny);
    this.endTurn();
    return true;
  }

  playerWait(): boolean {
    if (!this.canAct()) return false;
    const p = this.player;
    if (!this.visibleEnemies().length && !this.actors.some((a) => a.alerted && !a.dead && chebyshev(a, p) < 10)) {
      // Resting: recover slowly, but only up to REST_CAP without real healing.
      const cap = p.stats.maxHp * REST_CAP;
      if (p.hp < cap) p.hp = Math.min(cap, p.hp + Math.max(0.5, p.stats.maxHp * 0.01));
      p.mp = Math.min(p.stats.maxMp, p.mp + Math.max(0.3, p.stats.maxMp * 0.02));
    }
    this.endTurn();
    return true;
  }

  canRest(): boolean {
    const p = this.player;
    return !this.visibleEnemies().length && (p.hp < p.stats.maxHp * REST_CAP - 0.5 || p.mp < p.stats.maxMp - 0.5);
  }

  private wakeNearby(src: Vec, r: number): void {
    for (const m of this.actors) {
      if (m.isPlayer || m.dead || !m.asleep) continue;
      if (chebyshev(m, src) <= r && this.rng.chance(0.3)) {
        m.asleep = false;
        m.alerted = true;
        m.lastSeen = { x: src.x, y: src.y };
      }
    }
  }

  private interact(f: Feature): boolean {
    const p = this.player;
    const idx = this.floor.features.indexOf(f);
    const r = this.rng;
    const d = this.depth;
    if (f.kind === 'merchant') {
      this.emit({ t: 'shop' });
      return false;
    }
    if (f.used) {
      this.log('Nothing more here.', 'dim');
      return false;
    }
    if (f.kind === 'chest') {
      f.used = true;
      this.emit({ t: 'feature', index: idx });
      if (r.chance(0.06 + d * 0.006)) {
        this.blocked[f.y * this.w + f.x] = 0;
        const def = r.pick(this.roster.byDepth[d]);
        const m = this.spawnMonster(def, f.x, f.y, true, false);
        m.name = `Mimic ${def.name}`;
        m.alerted = true;
        this.log('The chest was a MIMIC!', 'bad');
        this.emit({ t: 'shake', power: 0.4 });
        return true;
      }
      const rarityBoost = { common: 0, magic: 0.4, rare: 0.9, epic: 1.6, artifact: 2 }[f.rarity ?? 'common'] + this.lootBoost();
      const gold = Math.round(r.int(8, 20) * (1 + d * 0.7) * this.goldMul());
      p.gold += gold;
      this.stats.gold += gold;
      this.emit({ t: 'pickup', text: `+${gold} gold` });
      const n = f.rarity === 'epic' || f.rarity === 'rare' ? 2 : 1;
      for (let i = 0; i < n; i++) {
        const it = f.rarity === 'epic' && i === 0 && r.chance(0.35) ? this.makeArtifact() : genEquipment(r, d + 1, rarityBoost);
        this.addGround(p.x, p.y, it);
      }
      if (r.chance(0.4)) this.addGround(p.x, p.y, randomConsumable(r));
      this.log('You open the chest.', 'info');
      this.pickupAt(p.x, p.y);
      return true;
    }
    if (f.kind === 'fountain') {
      f.used = true;
      this.emit({ t: 'feature', index: idx });
      this.heal(p, p.stats.maxHp);
      p.mp = p.stats.maxMp;
      p.statuses = p.statuses.filter((s) => !['poison', 'burn', 'bleed', 'weak', 'vuln', 'slow'].includes(s.kind));
      this.emit({ t: 'aoe', x: f.x, y: f.y, radius: 1, kind: 'holy' });
      this.log('You drink from the fountain. Body and mind are restored.', 'good');
      return true;
    }
    if (f.kind === 'shrine') {
      f.used = true;
      this.emit({ t: 'feature', index: idx });
      this.emit({ t: 'aoe', x: f.x, y: f.y, radius: 1, kind: 'arcane' });
      switch (f.variant) {
        case 0: {
          const cost = Math.round(p.stats.maxHp * 0.25);
          if (p.hp <= cost + 1) {
            f.used = false;
            this.log('The Shrine of Blood demands more life than you have.', 'warn');
            return false;
          }
          p.hp -= cost;
          p.base.dmgMin += 1;
          p.base.dmgMax += 2;
          this.recalc();
          this.log(`The Shrine of Blood drinks ${cost} life. Your strikes grow crueler (+1/+2 damage).`, 'good');
          break;
        }
        case 1:
          if (r.chance(0.6)) {
            this.addGround(p.x, p.y, genEquipment(r, d + 2, 1.2, undefined, r.chance(0.3) ? 'epic' : 'rare'));
            this.pickupAt(p.x, p.y);
            this.log('The Shrine of Fortune smiles upon you.', 'good');
          } else {
            this.log('The Shrine of Fortune shrieks! Monsters answer its call.', 'bad');
            let n = 0;
            for (let dy = -2; dy <= 2 && n < 2 + Math.floor(d / 4); dy++) {
              for (let dx = -2; dx <= 2 && n < 2 + Math.floor(d / 4); dx++) {
                if (chebyshev({ x: dx, y: dy }, { x: 0, y: 0 }) === 2 && this.isWalkable(p.x + dx, p.y + dy) && r.chance(0.5)) {
                  const m = this.spawnMonster(r.pick(this.roster.byDepth[d]), p.x + dx, p.y + dy, false, false);
                  m.alerted = true;
                  n++;
                }
              }
            }
          }
          break;
        case 2:
          this.log('The Shrine of Wisdom fills your mind with visions.', 'good');
          this.revealMap(true);
          this.gainXp(Math.round(p.xpNext * 0.4));
          break;
        default:
          p.base.armor += 1;
          p.base.maxHp += 6;
          this.recalc();
          this.heal(p, 6);
          this.log('The Shrine of Stone hardens your skin (+1 armor, +6 life).', 'good');
      }
      return true;
    }
    return false;
  }

  descend(): boolean {
    const p = this.player;
    if (!this.canAct() || this.tile(p.x, p.y) !== T.Stairs) return false;
    if (this.depth >= FINAL_DEPTH) return false;
    this.enterFloor(this.depth + 1);
    return true;
  }

  // ------------------------------------------------------------------ abilities
  abilityCost(key: string): number {
    return Math.max(0, ABILITIES[key].mp - 2 * perkCount(this.player, 'emp:' + key));
  }

  abilityCd(key: string): number {
    return Math.max(0, ABILITIES[key].cd - perkCount(this.player, 'focus'));
  }

  abilityBlocked(key: string): string | null {
    const p = this.player;
    if ((p.cds[key] ?? 0) > 0) return `${ABILITIES[key].name} is on cooldown.`;
    if (p.mp < this.abilityCost(key)) return `Not enough ${CLASSES[p.cls].resource}.`;
    return null;
  }

  isValidTarget(def: AbilityDef, tx: number, ty: number): boolean {
    const p = this.player;
    if (def.target === 'self') return true;
    const d = chebyshev(p, { x: tx, y: ty });
    if (d > def.range || d < (def.minRange ?? 1)) return false;
    if (!this.isVisible(tx, ty)) return false;
    if (def.needsLos && !this.los(p, { x: tx, y: ty })) return false;
    if (def.target === 'enemy') {
      const a = this.actorAt(tx, ty);
      return !!a && !a.isPlayer;
    }
    return this.isWalkable(tx, ty);
  }

  validTargets(key: string): Vec[] {
    const def = ABILITIES[key];
    const p = this.player;
    const out: Vec[] = [];
    if (def.target === 'self') return out;
    for (let y = p.y - def.range; y <= p.y + def.range; y++) {
      for (let x = p.x - def.range; x <= p.x + def.range; x++) if (this.inBounds(x, y) && this.isValidTarget(def, x, y)) out.push({ x, y });
    }
    return out;
  }

  useAbility(key: string, tx: number, ty: number): boolean {
    if (!this.canAct()) return false;
    const p = this.player;
    if (!p.abilities.includes(key)) return false;
    const def = ABILITIES[key];
    const blocked = this.abilityBlocked(key);
    if (blocked) {
      this.log(blocked, 'warn');
      return false;
    }
    if (!this.isValidTarget(def, tx, ty)) {
      this.log('Invalid target.', 'warn');
      return false;
    }
    if (!def.exec(this, p, tx, ty)) {
      this.log(def.target === 'self' ? 'No enemies in reach.' : 'That will not work here.', 'warn');
      return false;
    }
    p.mp -= this.abilityCost(key);
    p.cds[key] = this.hasArtifact('echo') && this.rng.chance(0.3) ? 0 : this.abilityCd(key);
    if (p.cds[key] === 0 && def.cd > 0 && this.hasArtifact('echo')) this.log('Echo! The ability resonates and is ready again.', 'good');
    this.wakeNearby(p, 5);
    this.endTurn();
    return true;
  }

  // ------------------------------------------------------------------ items
  useItem(uid: number, tx?: number, ty?: number): boolean {
    if (!this.canAct()) return false;
    const p = this.player;
    const it = p.inv.find((i) => i.uid === uid);
    if (!it) return false;
    if (it.slot !== 'consumable') return this.equip(uid);
    const d = this.depth;
    const alch = p.perks.includes('alchemist') ? 1.5 : 1;
    switch (it.consumable) {
      case 'heal':
        this.heal(p, (p.stats.maxHp * 0.4 + 10) * alch);
        p.statuses = p.statuses.filter((s) => s.kind !== 'poison' && s.kind !== 'bleed');
        this.log('You drink a healing draught.', 'good');
        break;
      case 'mana':
        p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.maxMp * 0.6 * alch);
        this.emit({ t: 'heal', id: p.id, amount: Math.round(p.stats.maxMp * 0.6 * alch), mana: true });
        this.log('Arcane vigor floods your veins.', 'good');
        break;
      case 'teleport': {
        const dist = bfs(this.tiles, this.w, this.h, p);
        const cands: Vec[] = [];
        for (let i = 0; i < dist.length; i++) {
          const x = i % this.w, y = (i / this.w) | 0;
          if (dist[i] > 12 && this.tiles[i] === T.Floor && this.isWalkable(x, y)) cands.push({ x, y });
        }
        if (!cands.length) return false;
        const c = this.rng.pick(cands);
        this.moveActor(p, c.x, c.y, 'blink');
        this.log('Reality folds around you.', 'info');
        break;
      }
      case 'mapping':
        this.revealMap(true);
        this.log('The layout of the floor blooms in your mind.', 'info');
        break;
      case 'fire': {
        const foes = this.enemiesInRadius(p.x, p.y, 3, p, true);
        this.emit({ t: 'aoe', x: p.x, y: p.y, radius: 3, kind: 'fire' });
        this.emit({ t: 'shake', power: 0.4 });
        for (const f of foes) {
          this.damage(f, Math.round(12 + d * 3), 'fire', false, p);
          if (!f.dead) this.addStatus(f, 'burn', 3, 2 + Math.floor(d / 2));
        }
        break;
      }
      case 'frost':
        for (const f of this.visibleEnemies()) {
          this.addStatus(f, 'freeze', 3, 0);
          this.emit({ t: 'aoe', x: f.x, y: f.y, radius: 0, kind: 'ice' });
        }
        this.log('A killing frost grips your foes.', 'info');
        break;
      case 'bomb': {
        if (tx === undefined || ty === undefined) return false;
        if (chebyshev(p, { x: tx, y: ty }) > 5 || !this.isVisible(tx, ty) || !this.los(p, { x: tx, y: ty }) || this.isWall(tx, ty)) {
          this.log('You cannot throw it there.', 'warn');
          return false;
        }
        this.emit({ t: 'projectile', from: p, to: { x: tx, y: ty }, kind: 'phys' });
        this.emit({ t: 'aoe', x: tx, y: ty, radius: 1, kind: 'fire' });
        this.emit({ t: 'shake', power: 0.5 });
        for (const a of this.actors.slice()) {
          if (!a.dead && chebyshev(a, { x: tx, y: ty }) <= 1) this.damage(a, Math.round(14 + d * 4), 'fire', false, p);
        }
        break;
      }
      case 'elixir':
        p.base.maxHp += 8;
        p.base.maxMp += 5;
        this.recalc();
        this.heal(p, 8);
        this.log('Power surges through you. (+8 life, +5 mana permanently)', 'good');
        break;
    }
    it.count = (it.count ?? 1) - 1;
    if (it.count <= 0) p.inv.splice(p.inv.indexOf(it), 1);
    if (!this.over) this.endTurn();
    return true;
  }

  equip(uid: number): boolean {
    if (!this.canAct()) return false;
    const p = this.player;
    const it = p.inv.find((i) => i.uid === uid);
    if (!it || it.slot === 'consumable') return false;
    const slot = it.slot as EquipSlot;
    const prev = p.equip[slot];
    p.inv.splice(p.inv.indexOf(it), 1);
    if (prev) p.inv.push(prev);
    p.equip[slot] = it;
    const hpFrac = p.hp / p.stats.maxHp;
    this.recalc();
    p.hp = Math.max(1, Math.min(p.stats.maxHp, Math.round(hpFrac * p.stats.maxHp)));
    this.log(`Equipped ${it.name}.`, it.rarity);
    if (this.visibleEnemies().length) this.endTurn();
    return true;
  }

  unequip(slot: EquipSlot): boolean {
    const p = this.player;
    const it = p.equip[slot];
    if (!it || p.inv.length >= INV_MAX || !this.canAct()) return false;
    p.equip[slot] = null;
    p.inv.push(it);
    this.recalc();
    return true;
  }

  drop(uid: number): void {
    const p = this.player;
    const it = p.inv.find((i) => i.uid === uid);
    if (!it) return;
    p.inv.splice(p.inv.indexOf(it), 1);
    this.addGround(p.x, p.y, it);
  }

  salvage(uid: number): void {
    const p = this.player;
    const it = p.inv.find((i) => i.uid === uid);
    if (!it) return;
    p.inv.splice(p.inv.indexOf(it), 1);
    const g = Math.max(1, Math.floor(it.value / 5));
    p.gold += g;
    this.log(`Salvaged ${it.name} for ${g} gold.`, 'dim');
  }

  buy(index: number): boolean {
    const it = this.shop[index];
    const p = this.player;
    if (!it) return false;
    const price = this.shopPrice(it);
    if (p.gold < price) {
      this.log('Not enough gold.', 'warn');
      return false;
    }
    if (!this.giveItem(it)) {
      this.log('Your pack is full.', 'warn');
      return false;
    }
    p.gold -= price;
    this.shop.splice(index, 1);
    this.log(`Bought ${it.name}.`, it.rarity);
    return true;
  }

  sell(uid: number): void {
    const p = this.player;
    const it = p.inv.find((i) => i.uid === uid);
    if (!it) return;
    const price = this.sellPrice(it) * (it.count ?? 1);
    p.inv.splice(p.inv.indexOf(it), 1);
    p.gold += price;
    this.log(`Sold ${it.name} for ${price} gold.`, 'dim');
  }

  // ------------------------------------------------------------------ pathing helpers (player)
  playerPath(goal: Vec, allowHazard = false): Vec[] | null {
    const p = this.player;
    const traps = new Set(this.floor.features.filter((f) => f.kind === 'trap' && !f.hidden && !f.used).map((f) => f.y * this.w + f.x));
    return astar(this.w, this.h, p, goal, (x, y) => {
      const i = y * this.w + x;
      if (!this.explored[i] || !this.isPassable(x, y)) return Infinity;
      if (traps.has(i)) return 40;
      if (this.tiles[i] === T.Hazard) return allowHazard ? 15 : 60;
      const a = this.actorAt(x, y);
      if (a && !a.isPlayer) return Infinity;
      return 1;
    }, (x, y) => this.isWall(x, y), 6000);
  }

  exploreTarget(): Vec | null {
    const p = this.player;
    const { w, h } = this;
    // nearest reachable explored tile next to unexplored space, or with loot
    const dist = new Int32Array(w * h).fill(-1);
    const q = [p.y * w + p.x];
    dist[q[0]] = 0;
    const lootTiles = new Set(this.ground.filter((g) => this.explored[g.y * w + g.x]).map((g) => g.y * w + g.x));
    const traps = new Set(this.floor.features.filter((f) => f.kind === 'trap' && !f.hidden && !f.used).map((f) => f.y * w + f.x));
    for (let qi = 0; qi < q.length; qi++) {
      const c = q[qi];
      const cx = c % w, cy = (c / w) | 0;
      if (c !== q[0]) {
        if (lootTiles.has(c) && this.player.inv.length < INV_MAX) return { x: cx, y: cy };
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const n = (cy + dy) * w + cx + dx;
          if (this.inBounds(cx + dx, cy + dy) && !this.explored[n]) return { x: cx, y: cy };
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = cx + dx, ny = cy + dy;
          if (!this.inBounds(nx, ny)) continue;
          const n = ny * w + nx;
          if (dist[n] >= 0 || !this.explored[n] || !this.isPassable(nx, ny) || this.tiles[n] === T.Hazard || traps.has(n)) continue;
          if (dx && dy && (this.isWall(cx + dx, cy) || this.isWall(cx, cy + dy))) continue;
          dist[n] = dist[c] + 1;
          q.push(n);
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ turn engine
  private speedOf(a: Actor): number {
    let s = a.stats.speed;
    if (this.hasStatus(a, 'slow')) s *= 0.5;
    if (this.hasStatus(a, 'haste')) s *= 1.4;
    return s;
  }

  endTurn(cost = 100): void {
    const p = this.player;
    this.turn++;
    this.stats.turns++;
    p.energy -= cost;
    if (this.tile(p.x, p.y) === T.Hazard) this.applyHazard(p);
    if (this.over) return;
    let guard = 0;
    for (;;) {
      while (p.energy < 100 && guard++ < 5000) {
        for (const a of this.actors) if (!a.dead) a.energy += this.speedOf(a) / 10;
        for (const a of this.actors.slice()) {
          if (a.isPlayer || a.dead || a.energy < 100) continue;
          a.energy -= 100;
          this.monsterTurn(a);
          if (this.over) return;
        }
      }
      this.actors = this.actors.filter((a) => !a.dead);
      const skip = this.playerTurnStart();
      if (this.over) return;
      this.updateFov();
      if (!skip) break;
      this.log('You cannot act!', 'bad');
      p.energy -= 100;
      this.turn++;
    }
  }

  /** Returns true when the actor is incapacitated this turn. */
  private tickStatuses(a: Actor): boolean {
    let skip = false;
    for (const s of a.statuses) {
      if (s.turns <= 0) continue;
      switch (s.kind) {
        case 'poison': this.damage(a, s.power, 'poison', false); break;
        case 'burn': this.damage(a, s.power, 'fire', false); break;
        case 'bleed': this.damage(a, s.power, 'phys', false); break;
        case 'regen': this.heal(a, s.power); break;
        case 'stun':
        case 'freeze': skip = true; break;
        default:
      }
      if (a.dead) return true;
      s.turns--;
    }
    a.statuses = a.statuses.filter((s) => s.turns > 0 && !(s.kind === 'shield' && s.power <= 0));
    if (a.cds.ccImmune) a.cds.ccImmune--;
    return skip;
  }

  private playerTurnStart(): boolean {
    const p = this.player;
    const skip = this.tickStatuses(p);
    if (p.dead) return true;
    if (!this.hasArtifact('bloodpact')) {
      p.hpAcc += p.stats.hpRegen;
      if (p.hpAcc >= 1) {
        const n = Math.floor(p.hpAcc);
        p.hpAcc -= n;
        p.hp = Math.min(p.stats.maxHp, p.hp + n);
      }
    }
    p.mp = Math.min(p.stats.maxMp, p.mp + p.stats.mpRegen);
    for (const k in p.cds) if (p.cds[k] > 0 && k !== 'ccImmune') p.cds[k]--;
    if (this.hasArtifact('aegis') && this.turn % 15 === 0) this.addStatus(p, 'shield', 15, 8 + p.level);
    return skip;
  }

  private monsterTurn(m: Actor): void {
    if (this.tickStatuses(m)) return;
    if (m.dead) return;
    for (const k in m.cds) if (m.cds[k] > 0 && k !== 'ccImmune') m.cds[k]--;
    if (m.stats.hpRegen > 0 && m.hp < m.stats.maxHp) {
      m.regenAcc = (m.regenAcc ?? 0) + m.stats.hpRegen;
      if (m.regenAcc >= 1) {
        const n = Math.floor(m.regenAcc);
        m.regenAcc -= n;
        m.hp = Math.min(m.stats.maxHp, m.hp + n);
      }
    }
    if (m.telegraph) {
      if (this.turn > m.telegraph.armed) this.resolveTelegraph(m);
      return;
    }
    const p = this.player;
    const def = m.def!;
    const d = chebyshev(m, p);
    const stealthed = this.hasStatus(p, 'stealth');
    const inView = this.visible[m.y * this.w + m.x] === 1 && d <= m.stats.sight;
    const canSee = inView && (!stealthed || (d <= 1 && this.rng.chance(0.35)));

    if (m.asleep) {
      const wakeP = stealthed ? 0.03 : d <= 2 ? 0.5 : d <= 5 ? 0.18 : 0.04;
      if (inView && this.rng.chance(wakeP)) {
        m.asleep = false;
        m.alerted = true;
        m.lastSeen = { x: p.x, y: p.y };
        if (m.boss) this.bossIntro(m);
      } else return;
    }
    if (canSee) {
      if (!m.alerted && m.boss) this.bossIntro(m);
      m.alerted = true;
      m.lastSeen = { x: p.x, y: p.y };
      m.lostTurns = 0;
    }
    if (!m.alerted) {
      if (this.rng.chance(0.2)) {
        const dx = this.rng.int(-1, 1), dy = this.rng.int(-1, 1);
        if ((dx || dy) && this.isWalkable(m.x + dx, m.y + dy) && this.tile(m.x + dx, m.y + dy) !== T.Hazard) this.moveActor(m, m.x + dx, m.y + dy);
      }
      return;
    }
    if (m.boss) this.bossPhase(m);
    if (canSee && this.monsterAbility(m, d)) return;

    if (canSee && def.range > 1 && d > 1 && d <= def.range && this.los(m, p)) {
      if (d <= 2 && def.arch !== 'caster' && this.rng.chance(0.35) && this.stepAway(m)) return;
      this.emit({ t: 'attack', id: m.id, tx: p.x, ty: p.y });
      this.emit({ t: 'projectile', from: { x: m.x, y: m.y }, to: { x: p.x, y: p.y }, kind: def.dmgKind === 'phys' ? 'phys' : def.dmgKind });
      this.attack(m, p, { ranged: true });
      return;
    }
    if (d === 1 && (canSee || !stealthed)) {
      if (def.range > 1 && this.rng.chance(0.4) && this.stepAway(m)) return;
      this.attack(m, p, {});
      return;
    }
    const goal = canSee ? p : m.lastSeen;
    if (!goal || (m.x === goal.x && m.y === goal.y)) {
      m.lostTurns = (m.lostTurns ?? 0) + 1;
      if (m.lostTurns > 3) {
        m.alerted = false;
        m.lastSeen = null;
      }
      return;
    }
    const step = this.pathStep(m, goal);
    if (step) this.moveActor(m, step.x, step.y);
  }

  private stepAway(m: Actor): boolean {
    const p = this.player;
    let best: Vec | null = null;
    let bd = chebyshev(m, p);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = m.x + dx, ny = m.y + dy;
        if (!this.isWalkable(nx, ny) || this.tile(nx, ny) === T.Hazard) continue;
        const nd = chebyshev({ x: nx, y: ny }, p);
        if (nd > bd) {
          bd = nd;
          best = { x: nx, y: ny };
        }
      }
    }
    if (best) this.moveActor(m, best.x, best.y);
    return !!best;
  }

  private pathStep(m: Actor, goal: Vec): Vec | null {
    const path = astar(this.w, this.h, m, goal, (x, y) => {
      if (!this.isPassable(x, y)) return Infinity;
      const i = y * this.w + x;
      let c = this.tiles[i] === T.Hazard ? 12 : 1;
      const a = this.actorAt(x, y);
      if (a && !a.isPlayer) c += 6;
      return c;
    }, (x, y) => this.isWall(x, y), 1200);
    if (!path || !path.length) return null;
    const next = path[0];
    if (this.isWalkable(next.x, next.y)) return next;
    // blocked by an ally: sidestep toward goal
    const cur = chebyshev(m, goal);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const nx = m.x + dx, ny = m.y + dy;
        if ((dx || dy) && this.isWalkable(nx, ny) && this.tile(nx, ny) !== T.Hazard && chebyshev({ x: nx, y: ny }, goal) < cur) return { x: nx, y: ny };
      }
    }
    return null;
  }

  private bossIntro(m: Actor): void {
    if (m.cds.introDone) return;
    m.cds.introDone = 999;
    this.log(`${m.name} awakens!`, 'boss');
    this.emit({ t: 'shake', power: 0.7 });
  }

  private bossPhase(m: Actor): void {
    const frac = m.hp / m.stats.maxHp;
    if (m.phase === 1 && frac < 0.5) {
      m.phase = 2;
      m.stats.speed += 15;
      this.addStatus(m, 'enrage', 999, 0);
      m.cds.summon = 0;
      this.log(`${m.name} roars in fury! (Phase 2)`, 'boss');
      this.emit({ t: 'shake', power: 0.8 });
    } else if (m.phase === 2 && frac < 0.25 && this.depth >= FINAL_DEPTH) {
      m.phase = 3;
      m.cds.rain = 0;
      m.cds.beam = 0;
      this.addStatus(m, 'haste', 999, 0);
      this.log(`${m.name} tears at reality itself! (Final phase)`, 'boss');
      this.emit({ t: 'shake', power: 1 });
    }
  }

  private telegraph(m: Actor, ability: string, tiles: Vec[], mult: number, text: string): void {
    const avg = (m.stats.dmgMin + m.stats.dmgMax) / 2;
    m.telegraph = {
      ability, tiles: tiles.filter((t) => this.inBounds(t.x, t.y) && !this.isWall(t.x, t.y)),
      dmg: Math.round(avg * mult), kind: m.def?.dmgKind ?? 'phys', armed: this.turn,
    };
    this.emit({ t: 'telegraph', id: m.id });
    this.log(text, 'warn');
  }

  private resolveTelegraph(m: Actor): void {
    const tg = m.telegraph!;
    m.telegraph = null;
    const set = new Set(tg.tiles.map((t) => t.y * this.w + t.x));
    this.emit({ t: 'attack', id: m.id, tx: m.x, ty: m.y });
    if (tg.ability === 'slam') this.emit({ t: 'aoe', x: m.x, y: m.y, radius: m.boss ? 2 : 1, kind: tg.kind });
    else for (const t of tg.tiles) this.emit({ t: 'aoe', x: t.x, y: t.y, radius: 0, kind: tg.kind });
    this.emit({ t: 'shake', power: 0.5 });
    const p = this.player;
    if (set.has(p.y * this.w + p.x)) {
      const dmg = Math.round(tg.dmg * (100 / (100 + p.stats.armor * 4)));
      this.damage(p, dmg, tg.kind, false, m);
      if (tg.ability === 'slam' && !p.dead) this.addStatus(p, 'stun', 1, 0);
    }
  }

  private monsterAbility(m: Actor, d: number): boolean {
    const def = m.def!;
    const p = this.player;
    const ready = (k: string) => (m.cds[k] ?? 0) <= 0;
    const abilities = this.rng.shuffle(def.abilities.filter((a) => a !== 'arrow' && a !== 'bolt' && ready(a)));
    for (const ab of abilities) {
      switch (ab) {
        case 'slam': {
          const r = m.boss ? 2 : 1;
          if (d > r || !this.rng.chance(m.boss ? 0.7 : 0.5)) break;
          const tiles: Vec[] = [];
          for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) if (dx || dy) tiles.push({ x: m.x + dx, y: m.y + dy });
          this.telegraph(m, 'slam', tiles, m.boss ? 1.6 : 1.8, `The ${m.name} rears up for a crushing slam!`);
          m.cds.slam = m.boss ? 4 : 6;
          return true;
        }
        case 'beam': {
          if (d > 9 || d < 2 || !this.los(m, p) || !this.rng.chance(0.6)) break;
          const far = { x: m.x + (p.x - m.x) * 3, y: m.y + (p.y - m.y) * 3 };
          this.telegraph(m, 'beam', lineTiles(m, far, 10), 1.8, `${m.name} gathers a beam of power!`);
          m.cds.beam = 6;
          return true;
        }
        case 'rain': {
          if (d > 9 || !this.rng.chance(0.6)) break;
          const tiles: Vec[] = [{ x: p.x, y: p.y }];
          const want = m.phase === 3 ? 12 : 8;
          for (let i = 0; i < 40 && tiles.length < want; i++) {
            const t = { x: p.x + this.rng.int(-2, 2), y: p.y + this.rng.int(-2, 2) };
            if (!tiles.some((q) => q.x === t.x && q.y === t.y)) tiles.push(t);
          }
          this.telegraph(m, 'rain', tiles, 1.3, `Ruin gathers above you!`);
          m.cds.rain = m.phase === 3 ? 4 : 7;
          return true;
        }
        case 'charge': {
          if (d < 2 || d > 5 || !this.los(m, p)) break;
          const path = lineTiles(m, p);
          let stop: Vec | null = null;
          let ok = true;
          for (const t of path) {
            if (t.x === p.x && t.y === p.y) break;
            if (!this.isWalkable(t.x, t.y)) {
              ok = false;
              break;
            }
            stop = t;
          }
          if (!ok || !stop || chebyshev(stop, p) > 1) break;
          this.moveActor(m, stop.x, stop.y, 'charge');
          this.log(`The ${m.name} charges!`, 'warn');
          this.attack(m, p, { mult: 1.4 });
          m.cds.charge = 6;
          return true;
        }
        case 'summon': {
          const alive = this.actors.filter((a) => a.summoned && !a.dead).length;
          if (alive >= (m.boss ? 5 : 3) || !this.rng.chance(0.5)) break;
          const pool = this.roster.byDepth[Math.max(1, this.depth - 2)];
          const minion = pool.reduce((a, b) => (b.hp < a.hp ? b : a), pool[0]);
          let n = 0;
          const want = m.boss ? 3 : 2;
          for (let dy = -1; dy <= 1 && n < want; dy++) {
            for (let dx = -1; dx <= 1 && n < want; dx++) {
              if (this.isWalkable(m.x + dx, m.y + dy) && this.tile(m.x + dx, m.y + dy) !== T.Hazard) {
                const s = this.spawnMonster(minion, m.x + dx, m.y + dy, false, false, true);
                s.alerted = true;
                s.lastSeen = { x: p.x, y: p.y };
                n++;
              }
            }
          }
          if (!n) break;
          this.emit({ t: 'aoe', x: m.x, y: m.y, radius: 1, kind: 'shadow' });
          this.log(`The ${m.name} summons help!`, 'warn');
          m.cds.summon = m.boss ? 8 : 10;
          return true;
        }
        case 'heal': {
          const ally = this.actors.find((a) => !a.dead && !a.isPlayer && a !== m && a.hp < a.stats.maxHp * 0.6 && chebyshev(a, m) <= 5);
          if (!ally) break;
          this.heal(ally, ally.stats.maxHp * 0.35);
          this.emit({ t: 'projectile', from: m, to: ally, kind: 'holy' });
          this.log(`The ${m.name} mends the ${ally.name}.`, 'warn');
          m.cds.heal = 6;
          return true;
        }
        case 'web': {
          if (d < 2 || d > 6 || !this.los(m, p) || !this.rng.chance(0.5)) break;
          this.emit({ t: 'projectile', from: m, to: p, kind: 'poison' });
          this.addStatus(p, 'root', 2, 0);
          this.log(`The ${m.name} pins you with sticky webbing!`, 'bad');
          m.cds.web = 8;
          return true;
        }
        case 'blink': {
          if (def.arch === 'caster' || def.arch === 'archer') {
            if (d > 1) break;
            const spots: Vec[] = [];
            for (let dy = -5; dy <= 5; dy++) for (let dx = -5; dx <= 5; dx++) {
              const t = { x: m.x + dx, y: m.y + dy };
              if (chebyshev(t, p) >= 4 && this.isWalkable(t.x, t.y) && this.tile(t.x, t.y) !== T.Hazard && this.los(t, p)) spots.push(t);
            }
            if (!spots.length) break;
            const s = this.rng.pick(spots);
            this.moveActor(m, s.x, s.y, 'blink');
          } else {
            if (d < 3 || d > 8) break;
            const spots: Vec[] = [];
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (this.isWalkable(p.x + dx, p.y + dy)) spots.push({ x: p.x + dx, y: p.y + dy });
            if (!spots.length) break;
            const s = this.rng.pick(spots);
            this.moveActor(m, s.x, s.y, 'blink');
            this.log(`The ${m.name} appears beside you!`, 'warn');
          }
          m.cds.blink = 6;
          return true;
        }
        case 'curse': {
          if (d > 6 || !this.los(m, p) || !this.rng.chance(0.4)) break;
          const kind = this.rng.chance(0.5) ? 'vuln' : 'weak';
          this.emit({ t: 'projectile', from: m, to: p, kind: 'shadow' });
          this.addStatus(p, kind, 4, 0);
          this.log(`The ${m.name} curses you! (${kind === 'vuln' ? 'Vulnerable' : 'Weakened'})`, 'bad');
          m.cds.curse = 9;
          return true;
        }
        default:
      }
    }
    return false;
  }
}
