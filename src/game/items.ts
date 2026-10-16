import { RNG } from './rng';
import { properName } from './monsters';
import type { ConsumableKind, EquipSlot, Item, Rarity, Stats } from './types';

let uidCounter = 1;
export function nextUid(): number {
  return uidCounter++;
}
export function setUidCounter(n: number): void {
  uidCounter = Math.max(uidCounter, n);
}

interface BaseType {
  key: string;
  name: string;
  slot: EquipSlot;
  stats: (lvl: number) => Partial<Stats>;
  weight: number;
}

const r1 = (n: number) => Math.round(n);

export const BASES: BaseType[] = [
  { key: 'sword', name: 'Sword', slot: 'weapon', weight: 3, stats: (l) => ({ dmgMin: r1(3 + l * 0.9), dmgMax: r1(6 + l * 1.5) }) },
  { key: 'axe', name: 'Axe', slot: 'weapon', weight: 2, stats: (l) => ({ dmgMin: r1(2 + l * 0.6), dmgMax: r1(8 + l * 2), crit: 3 }) },
  { key: 'mace', name: 'Mace', slot: 'weapon', weight: 2, stats: (l) => ({ dmgMin: r1(4 + l * 1.1), dmgMax: r1(6 + l * 1.3), acc: 4 }) },
  { key: 'dagger', name: 'Dagger', slot: 'weapon', weight: 2, stats: (l) => ({ dmgMin: r1(2 + l * 0.7), dmgMax: r1(4 + l * 1.1), crit: 10, eva: 3 }) },
  { key: 'spear', name: 'Spear', slot: 'weapon', weight: 2, stats: (l) => ({ dmgMin: r1(3 + l * 0.8), dmgMax: r1(7 + l * 1.4), acc: 6 }) },
  { key: 'hammer', name: 'Warhammer', slot: 'weapon', weight: 1, stats: (l) => ({ dmgMin: r1(4 + l * 1.0), dmgMax: r1(9 + l * 1.9), speed: -5 }) },
  { key: 'staff', name: 'Staff', slot: 'weapon', weight: 2, stats: (l) => ({ dmgMin: r1(2 + l * 0.6), dmgMax: r1(4 + l * 1.0), spellPower: r1(10 + l * 4), maxMp: 5 }) },
  { key: 'wand', name: 'Wand', slot: 'weapon', weight: 1, stats: (l) => ({ dmgMin: r1(1 + l * 0.5), dmgMax: r1(3 + l * 0.8), spellPower: r1(15 + l * 5), mpRegen: 0.1 }) },
  { key: 'robe', name: 'Robe', slot: 'armor', weight: 2, stats: (l) => ({ armor: r1(1 + l * 0.3), maxMp: r1(8 + l * 2), spellPower: r1(4 + l) }) },
  { key: 'leather', name: 'Leather Armor', slot: 'armor', weight: 3, stats: (l) => ({ armor: r1(2 + l * 0.6), eva: 4 }) },
  { key: 'chain', name: 'Chainmail', slot: 'armor', weight: 2, stats: (l) => ({ armor: r1(3 + l * 0.9) }) },
  { key: 'plate', name: 'Plate Armor', slot: 'armor', weight: 1, stats: (l) => ({ armor: r1(5 + l * 1.2), eva: -4 }) },
  { key: 'helm', name: 'Helm', slot: 'helm', weight: 2, stats: (l) => ({ armor: r1(1 + l * 0.4) }) },
  { key: 'hood', name: 'Hood', slot: 'helm', weight: 2, stats: (l) => ({ eva: 3, crit: 2, armor: r1(l * 0.2) }) },
  { key: 'circlet', name: 'Circlet', slot: 'helm', weight: 1, stats: (l) => ({ maxMp: r1(5 + l), spellPower: 5 }) },
  { key: 'ring', name: 'Ring', slot: 'ring', weight: 3, stats: () => ({}) },
  { key: 'amulet', name: 'Amulet', slot: 'amulet', weight: 3, stats: () => ({}) },
];

interface Affix {
  stat: keyof Stats;
  prefix: string;
  suffix: string;
  roll: (rng: RNG, lvl: number) => number;
  slots?: EquipSlot[];
}

const AFFIXES: Affix[] = [
  { stat: 'maxHp', prefix: 'Sturdy', suffix: 'of Vigor', roll: (r, l) => r.int(3, 6) + Math.round(l * 1.2) },
  { stat: 'maxMp', prefix: 'Arcane', suffix: 'of the Mind', roll: (r, l) => r.int(4, 8) + l * 2 },
  { stat: 'armor', prefix: 'Warded', suffix: 'of the Bulwark', roll: (r, l) => r.int(1, 2) + Math.floor(l / 3) },
  { stat: 'dmgMax', prefix: 'Cruel', suffix: 'of Ruin', roll: (r, l) => r.int(1, 3) + Math.floor(l / 2), slots: ['weapon', 'ring', 'amulet'] },
  { stat: 'dmgMin', prefix: 'Honed', suffix: 'of Precision', roll: (r, l) => r.int(1, 2) + Math.floor(l / 3), slots: ['weapon', 'ring'] },
  { stat: 'crit', prefix: 'Keen', suffix: 'of Slaughter', roll: (r) => r.int(3, 7) },
  { stat: 'acc', prefix: 'True', suffix: 'of the Hawk', roll: (r) => r.int(4, 10) },
  { stat: 'eva', prefix: 'Nimble', suffix: 'of Shadows', roll: (r) => r.int(3, 7) },
  { stat: 'lifesteal', prefix: 'Vampiric', suffix: 'of the Leech', roll: (r) => r.int(3, 7), slots: ['weapon', 'ring', 'amulet'] },
  { stat: 'thorns', prefix: 'Barbed', suffix: 'of Thorns', roll: (r, l) => r.int(1, 3) + Math.floor(l / 3), slots: ['armor', 'helm', 'amulet'] },
  { stat: 'spellPower', prefix: 'Mystic', suffix: 'of Sorcery', roll: (r, l) => r.int(8, 15) + l * 2 },
  { stat: 'hpRegen', prefix: 'Troll', suffix: 'of Renewal', roll: (r) => +(r.range(0.1, 0.25)).toFixed(2) },
  { stat: 'mpRegen', prefix: 'Flowing', suffix: 'of Clarity', roll: (r) => +(r.range(0.1, 0.25)).toFixed(2) },
  { stat: 'speed', prefix: 'Swift', suffix: 'of Haste', roll: (r) => r.int(4, 8), slots: ['ring', 'amulet', 'armor'] },
  { stat: 'fireOnHit', prefix: 'Blazing', suffix: 'of Embers', roll: (r, l) => r.int(1, 3) + Math.floor(l / 2), slots: ['weapon', 'ring'] },
  { stat: 'critMul', prefix: 'Brutal', suffix: 'of Carnage', roll: (r) => +(r.range(0.15, 0.35)).toFixed(2), slots: ['weapon', 'amulet'] },
];

const RARE_A = ['Doom', 'Soul', 'Grim', 'Blood', 'Storm', 'Night', 'Dread', 'Wraith', 'Gloom', 'Rune', 'Star', 'Viper', 'Ember', 'Ghoul', 'Hate'];
const RARE_B = ['Fang', 'Grasp', 'Song', 'Bane', 'Ward', 'Mark', 'Coil', 'Shard', 'Brand', 'Whisper', 'Edge', 'Veil', 'Spire', 'Heart', 'Thorn'];

export interface ArtifactSpec {
  key: string;
  desc: string;
  slot: EquipSlot;
  stats: (lvl: number) => Partial<Stats>;
}

export const ARTIFACTS: ArtifactSpec[] = [
  { key: 'phoenix', slot: 'amulet', desc: 'Once per run, rise from death with half your life.', stats: (l) => ({ maxHp: 10 + l * 2 }) },
  { key: 'glass', slot: 'ring', desc: '+50% damage dealt. -30% max life.', stats: () => ({ crit: 5 }) },
  { key: 'bloodpact', slot: 'weapon', desc: 'Heal 4 life on every kill. Life regeneration disabled.', stats: (l) => ({ dmgMin: 4 + l, dmgMax: 9 + l * 2, lifesteal: 6 }) },
  { key: 'berserk', slot: 'weapon', desc: 'Deal up to +80% damage as your life drops.', stats: (l) => ({ dmgMin: 3 + l, dmgMax: 10 + l * 2 }) },
  { key: 'storm', slot: 'ring', desc: '25% chance on hit to unleash chain lightning.', stats: (l) => ({ spellPower: 10 + l * 2 }) },
  { key: 'frostbite', slot: 'weapon', desc: '20% chance on hit to freeze the target.', stats: (l) => ({ dmgMin: 3 + l, dmgMax: 7 + l * 1.6 }) },
  { key: 'aegis', slot: 'armor', desc: 'Gain a shield absorbing 8 + level damage each new floor and every 15 turns.', stats: (l) => ({ armor: 4 + l }) },
  { key: 'midas', slot: 'ring', desc: 'Double gold. Enemies drop more loot.', stats: () => ({ eva: 5 }) },
  { key: 'eye', slot: 'helm', desc: 'See the entire floor layout. +3 sight.', stats: (l) => ({ sight: 3, armor: 1 + Math.floor(l / 2) }) },
  { key: 'thornmail', slot: 'armor', desc: 'Reflect 40% of melee damage taken.', stats: (l) => ({ armor: 3 + l, thorns: 2 }) },
  { key: 'echo', slot: 'amulet', desc: 'Abilities have 30% chance to not go on cooldown.', stats: (l) => ({ maxMp: 10 + l * 2 }) },
  { key: 'executioner', slot: 'weapon', desc: 'Instantly slay non-boss enemies under 15% life.', stats: (l) => ({ dmgMin: 3 + l, dmgMax: 8 + l * 1.7, crit: 5 }) },
];

const RARITY_MUL: Record<Rarity, number> = { common: 1, magic: 1.1, rare: 1.2, epic: 1.35, artifact: 1.4 };
const AFFIX_COUNT: Record<Rarity, [number, number]> = { common: [0, 0], magic: [1, 2], rare: [3, 3], epic: [4, 4], artifact: [2, 2] };

export function rollRarity(rng: RNG, boost: number): Rarity {
  return rng.weighted<Rarity>([
    ['common', Math.max(10, 58 - boost * 30)],
    ['magic', 30],
    ['rare', 10 + boost * 15],
    ['epic', 2 + boost * 6],
  ]);
}

function applyAffix(stats: Partial<Stats>, stat: keyof Stats, v: number): void {
  stats[stat] = +(((stats[stat] ?? 0) + v).toFixed(2));
}

export function genEquipment(rng: RNG, level: number, boost = 0, slot?: EquipSlot, rarity?: Rarity): Item {
  const pool = BASES.filter((b) => !slot || b.slot === slot);
  const base = rng.weighted(pool.map((b) => [b, b.weight] as const));
  const rar = rarity ?? rollRarity(rng, boost);
  const mul = RARITY_MUL[rar];
  const stats: Partial<Stats> = {};
  for (const [k, v] of Object.entries(base.stats(level))) {
    const key = k as keyof Stats;
    const scaled = key === 'dmgMin' || key === 'dmgMax' || key === 'armor' || key === 'spellPower' ? Math.round((v as number) * mul) : (v as number);
    applyAffix(stats, key, scaled);
  }
  // Rings and amulets get an implicit
  if (base.slot === 'ring' || base.slot === 'amulet') {
    const imp = rng.pick(AFFIXES.filter((a) => !a.slots || a.slots.includes(base.slot)));
    applyAffix(stats, imp.stat, imp.roll(rng, level));
  }
  const [lo, hi] = AFFIX_COUNT[rar];
  const n = rng.int(lo, hi);
  const chosen: Affix[] = [];
  const candidates = AFFIXES.filter((a) => !a.slots || a.slots.includes(base.slot));
  while (chosen.length < n && chosen.length < candidates.length) {
    const a = rng.pick(candidates);
    if (!chosen.includes(a)) chosen.push(a);
  }
  for (const a of chosen) applyAffix(stats, a.stat, a.roll(rng, level));
  if ((stats.dmgMin ?? 0) > (stats.dmgMax ?? 0) && base.slot === 'weapon') stats.dmgMax = stats.dmgMin;

  let name = base.name;
  if (rar === 'magic' && chosen.length) {
    if (chosen.length === 1) name = rng.chance(0.5) ? `${chosen[0].prefix} ${base.name}` : `${base.name} ${chosen[0].suffix}`;
    else name = `${chosen[0].prefix} ${base.name} ${chosen[1].suffix}`;
  } else if (rar === 'rare' || rar === 'epic') {
    name = `${rng.pick(RARE_A)}${rng.pick(RARE_B).toLowerCase()} ${base.name}`;
  }
  const value = Math.round((10 + level * 6) * { common: 1, magic: 2, rare: 4, epic: 7, artifact: 12 }[rar]);
  return { uid: nextUid(), name, slot: base.slot, rarity: rar, level, base: base.key, stats, value };
}

export function genArtifact(rng: RNG, level: number, exclude: string[] = []): Item {
  const pool = ARTIFACTS.filter((a) => !exclude.includes(a.key));
  const spec = rng.pick(pool.length ? pool : ARTIFACTS);
  const baseChoices = BASES.filter((b) => b.slot === spec.slot);
  const base = rng.pick(baseChoices);
  const stats: Partial<Stats> = {};
  for (const [k, v] of Object.entries(spec.stats(level))) applyAffix(stats, k as keyof Stats, Math.round(v as number));
  const candidates = AFFIXES.filter((a) => !a.slots || a.slots.includes(spec.slot));
  for (let i = 0; i < 2; i++) {
    const a = rng.pick(candidates);
    applyAffix(stats, a.stat, a.roll(rng, level + 2));
  }
  if (spec.slot === 'weapon' && (stats.dmgMin ?? 0) > (stats.dmgMax ?? 0)) stats.dmgMax = stats.dmgMin;
  const owner = properName(rng);
  const nouns: Record<EquipSlot, string[]> = {
    weapon: ['Fang', 'Oathbreaker', 'Requiem', 'Cinderbrand', 'Widowmaker', 'Lament'],
    armor: ['Carapace', 'Shroud', 'Bastion', 'Mantle', 'Hauberk'],
    helm: ['Crown', 'Gaze', 'Diadem', 'Visage'],
    ring: ['Band', 'Loop', 'Seal', 'Signet'],
    amulet: ['Heart', 'Tear', 'Talisman', 'Reliquary', 'Locket'],
  };
  const name = rng.chance(0.5) ? `${owner}'s ${rng.pick(nouns[spec.slot])}` : `The ${rng.pick(['Last', 'Black', 'Hollow', 'Eternal', 'Weeping', 'Forsaken', 'Undying'])} ${rng.pick(nouns[spec.slot])}`;
  return {
    uid: nextUid(), name, slot: spec.slot, rarity: 'artifact', level, base: base.key, stats,
    artifact: spec.key, artifactDesc: spec.desc, value: 150 + level * 30,
  };
}

export const CONSUMABLES: Record<ConsumableKind, { name: string; desc: string; value: number }> = {
  heal: { name: 'Healing Draught', desc: 'Restore 40% of max life +10.', value: 30 },
  mana: { name: 'Mana Draught', desc: 'Restore 60% of max mana.', value: 25 },
  teleport: { name: 'Scroll of Escape', desc: 'Teleport to a random distant spot on this floor.', value: 30 },
  mapping: { name: 'Scroll of Insight', desc: 'Reveal the layout of this floor.', value: 25 },
  fire: { name: 'Scroll of Immolation', desc: 'Engulf all enemies within 3 tiles in flame.', value: 40 },
  frost: { name: 'Scroll of Winter', desc: 'Freeze all visible enemies for 3 turns.', value: 45 },
  bomb: { name: 'Blackpowder Bomb', desc: 'Thrown. Explodes for heavy damage in a radius of 1.', value: 30 },
  elixir: { name: 'Elixir of Ascension', desc: 'Permanently +8 max life and +5 max mana.', value: 120 },
};

export function genConsumable(kind: ConsumableKind, count = 1): Item {
  const c = CONSUMABLES[kind];
  return {
    uid: nextUid(), name: c.name, slot: 'consumable', rarity: kind === 'elixir' ? 'epic' : 'common', level: 1,
    base: kind, stats: {}, consumable: kind, count, value: c.value,
  };
}

export function randomConsumable(rng: RNG): Item {
  const kind = rng.weighted<ConsumableKind>([
    ['heal', 30], ['mana', 16], ['teleport', 8], ['mapping', 6], ['fire', 8], ['frost', 6], ['bomb', 10], ['elixir', 2],
  ]);
  return genConsumable(kind);
}

export const STAT_LABEL: Record<keyof Stats, string> = {
  maxHp: 'Max Life', maxMp: 'Max Mana', dmgMin: 'Min Damage', dmgMax: 'Max Damage', armor: 'Armor', acc: 'Accuracy',
  eva: 'Evasion', crit: 'Crit Chance %', critMul: 'Crit Multiplier', speed: 'Speed', lifesteal: 'Life Steal %',
  thorns: 'Thorns', spellPower: 'Spell Power %', hpRegen: 'Life Regen / turn', mpRegen: 'Mana Regen / turn',
  fireOnHit: 'Fire Damage on Hit', sight: 'Sight',
};

/** Rough score for auto-compare (used by the UI badge and the sim bot). */
export function itemScore(it: Item, cls: string): number {
  const s = it.stats;
  const caster = cls === 'mage' || cls === 'cleric';
  let v = 0;
  v += ((s.dmgMin ?? 0) + (s.dmgMax ?? 0)) * (caster ? 0.6 : 1.4);
  v += (s.armor ?? 0) * 2.2;
  v += (s.maxHp ?? 0) * 0.5;
  v += (s.maxMp ?? 0) * (caster ? 0.5 : 0.1);
  v += (s.spellPower ?? 0) * (caster ? 0.35 : 0.05);
  v += (s.crit ?? 0) * 0.6 + (s.critMul ?? 0) * 8;
  v += (s.acc ?? 0) * 0.3 + (s.eva ?? 0) * 0.7;
  v += (s.lifesteal ?? 0) * 1.2 + (s.thorns ?? 0) * 0.8;
  v += (s.hpRegen ?? 0) * 20 + (s.mpRegen ?? 0) * (caster ? 20 : 4);
  v += (s.speed ?? 0) * 1.2 + (s.fireOnHit ?? 0) * 1.2 + (s.sight ?? 0);
  if (it.artifact) v += 25;
  return v;
}

export function makeBaseItem(key: string, level: number): Item {
  const base = BASES.find((b) => b.key === key)!;
  return { uid: nextUid(), name: base.name, slot: base.slot, rarity: 'common', level, base: key, stats: base.stats(level), value: 8 };
}

export function peekUid(): number {
  return uidCounter;
}
