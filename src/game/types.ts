export interface Vec {
  x: number;
  y: number;
}

export const T = { Wall: 0, Floor: 1, Hazard: 2, Stairs: 3 } as const;
export type TileId = (typeof T)[keyof typeof T];

export type DmgKind = 'phys' | 'fire' | 'ice' | 'poison' | 'holy' | 'arcane' | 'lightning' | 'shadow';

export interface Stats {
  maxHp: number;
  maxMp: number;
  dmgMin: number;
  dmgMax: number;
  armor: number;
  acc: number;
  eva: number;
  crit: number; // percent
  critMul: number;
  speed: number; // 100 = normal
  lifesteal: number; // percent
  thorns: number;
  spellPower: number; // percent bonus
  hpRegen: number; // hp per turn
  mpRegen: number; // mp per turn
  fireOnHit: number;
  sight: number;
}

export function baseStats(over: Partial<Stats> = {}): Stats {
  return {
    maxHp: 10, maxMp: 0, dmgMin: 1, dmgMax: 3, armor: 0, acc: 90, eva: 5, crit: 5, critMul: 1.75,
    speed: 100, lifesteal: 0, thorns: 0, spellPower: 0, hpRegen: 0, mpRegen: 0, fireOnHit: 0, sight: 8,
    ...over,
  };
}

export type StatusKind =
  | 'poison' | 'burn' | 'bleed' | 'stun' | 'freeze' | 'slow' | 'root' | 'weak' | 'vuln'
  | 'regen' | 'shield' | 'haste' | 'stealth' | 'enrage';

export interface Status {
  kind: StatusKind;
  turns: number;
  power: number;
}

export type BodyPlan = 'biped' | 'beast' | 'blob' | 'floater' | 'spider' | 'wraith' | 'golem';
export type Archetype = 'brute' | 'skirmisher' | 'archer' | 'caster' | 'swarm' | 'tank' | 'assassin';
export type Trait =
  | 'poisonous' | 'vampiric' | 'explosive' | 'splitter' | 'regenerating' | 'armored'
  | 'swift' | 'ethereal' | 'burning' | 'freezing' | 'thorny';

export interface MonsterDef {
  key: string;
  name: string;
  body: BodyPlan;
  arch: Archetype;
  tier: number;
  hp: number;
  dmg: [number, number];
  armor: number;
  acc: number;
  eva: number;
  speed: number;
  range: number;
  xp: number;
  traits: Trait[];
  abilities: string[];
  colors: { primary: number; secondary: number; eye: number };
  scale: number;
  dmgKind: DmgKind;
  desc: string;
  boss?: boolean;
  seed: number; // for procedural model variation
}

export type Slot = 'weapon' | 'armor' | 'helm' | 'ring' | 'amulet' | 'consumable';
export type EquipSlot = 'weapon' | 'armor' | 'helm' | 'ring' | 'amulet';
export type Rarity = 'common' | 'magic' | 'rare' | 'epic' | 'artifact';

export type ConsumableKind = 'heal' | 'mana' | 'teleport' | 'mapping' | 'fire' | 'elixir' | 'bomb' | 'frost';

export interface Item {
  uid: number;
  name: string;
  slot: Slot;
  rarity: Rarity;
  level: number;
  base: string; // base type key, also drives the icon
  stats: Partial<Stats>;
  artifact?: string; // artifact effect key
  artifactDesc?: string;
  consumable?: ConsumableKind;
  count?: number;
  value: number;
  color?: number;
}

export type ClassKey = 'warrior' | 'rogue' | 'mage' | 'cleric';

export interface Actor {
  id: number;
  isPlayer: boolean;
  name: string;
  x: number;
  y: number;
  hp: number;
  mp: number;
  base: Stats;
  stats: Stats;
  energy: number;
  statuses: Status[];
  dead: boolean;
  cds: Record<string, number>;
  // monster-only
  def?: MonsterDef;
  alerted?: boolean;
  asleep?: boolean;
  lastSeen?: Vec | null;
  elite?: Trait[];
  boss?: boolean;
  summoned?: boolean;
  split?: boolean;
  telegraph?: Telegraph | null;
  phase?: number;
  regenAcc?: number;
  lostTurns?: number;
}

export interface Telegraph {
  ability: string;
  tiles: Vec[];
  dmg: number;
  kind: DmgKind;
  armed: number;
}

export interface Player extends Actor {
  cls: ClassKey;
  level: number;
  xp: number;
  xpNext: number;
  gold: number;
  inv: Item[];
  equip: Record<EquipSlot, Item | null>;
  abilities: string[];
  perks: string[];
  flags: Record<string, number>;
  kills: number;
  mpAcc: number;
  hpAcc: number;
  lastStandUsed: boolean;
  phoenixUsed: boolean;
}

export type FeatureKind =
  | 'torch' | 'chest' | 'shrine' | 'fountain' | 'trap' | 'pillar' | 'decor' | 'merchant' | 'brazier';

export interface Feature {
  kind: FeatureKind;
  x: number;
  y: number;
  dir?: number; // torch facing (0..3) or decor rotation
  variant?: number;
  used?: boolean;
  hidden?: boolean;
  rarity?: Rarity; // chests
}

export interface Room {
  x: number;
  y: number;
  w: number;
  h: number;
  cx: number;
  cy: number;
  shape: 'rect' | 'circle' | 'cave' | 'arena';
}

export interface Spawn {
  x: number;
  y: number;
  def: MonsterDef;
  elite: boolean;
  asleep: boolean;
}

export interface FloorData {
  depth: number;
  w: number;
  h: number;
  tiles: Uint8Array;
  rooms: Room[];
  features: Feature[];
  start: Vec;
  stairs: Vec;
  bossRoom: Room | null;
  spawns: Spawn[];
  name: string;
  biome: string;
}

export interface GroundItem {
  gid: number;
  x: number;
  y: number;
  item: Item | null;
  gold: number;
}

export type GEvent =
  | { t: 'move'; id: number; x: number; y: number; fx: number; fy: number; mode?: 'walk' | 'blink' | 'charge' }
  | { t: 'attack'; id: number; tx: number; ty: number }
  | { t: 'damage'; id: number; amount: number; crit: boolean; kind: DmgKind }
  | { t: 'miss'; id: number }
  | { t: 'heal'; id: number; amount: number; mana?: boolean }
  | { t: 'death'; id: number }
  | { t: 'spawn'; id: number }
  | { t: 'projectile'; from: Vec; to: Vec; kind: DmgKind }
  | { t: 'aoe'; x: number; y: number; radius: number; kind: DmgKind }
  | { t: 'status'; id: number; kind: StatusKind }
  | { t: 'log'; text: string; cls?: string }
  | { t: 'pickup'; text: string; rarity?: Rarity }
  | { t: 'ground'; gid: number; added: boolean }
  | { t: 'feature'; index: number }
  | { t: 'telegraph'; id: number }
  | { t: 'levelup' }
  | { t: 'stairs' }
  | { t: 'trap'; x: number; y: number }
  | { t: 'shake'; power: number }
  | { t: 'gameover'; win: boolean }
  | { t: 'shop' }
  | { t: 'floor' };
