import { RNG } from './rng';
import type { Archetype, BodyPlan, DmgKind, MonsterDef, Trait } from './types';
import { Biome, shiftColor } from './theme';

interface ArchSpec {
  hp: number;
  dmg: [number, number];
  armor: number;
  acc: number;
  eva: number;
  speed: number;
  range: number;
  xp: number;
  bodies: BodyPlan[];
  abilities: string[][]; // ability pool per tier (index tier-1), one may be picked
  cost: number;
  desc: string;
}

const ARCH: Record<Archetype, ArchSpec> = {
  brute: { hp: 24, dmg: [3, 6], armor: 1, acc: 82, eva: 0, speed: 85, range: 1, xp: 8, bodies: ['biped', 'golem', 'beast'],
    abilities: [[], ['charge'], ['slam', 'charge'], ['slam']], cost: 2.2, desc: 'Slow and hulking. Hits like a falling wall.' },
  skirmisher: { hp: 12, dmg: [2, 4], armor: 0, acc: 88, eva: 12, speed: 130, range: 1, xp: 5, bodies: ['beast', 'spider'],
    abilities: [[], [], ['web'], ['web', 'charge']], cost: 1.3, desc: 'Quick and relentless; hunts in packs.' },
  archer: { hp: 11, dmg: [2, 4], armor: 0, acc: 86, eva: 6, speed: 100, range: 6, xp: 6, bodies: ['biped', 'spider'],
    abilities: [['arrow'], ['arrow'], ['arrow', 'web'], ['arrow']], cost: 1.6, desc: 'Keeps its distance and peppers you from afar.' },
  caster: { hp: 10, dmg: [2, 5], armor: 0, acc: 90, eva: 8, speed: 100, range: 5, xp: 8, bodies: ['floater', 'wraith', 'biped'],
    abilities: [['bolt'], ['bolt', 'curse'], ['bolt', 'summon', 'heal', 'blink'], ['bolt', 'summon', 'curse']], cost: 1.9, desc: 'Weaves foul magic from the shadows.' },
  swarm: { hp: 6, dmg: [1, 3], armor: 0, acc: 85, eva: 8, speed: 115, range: 1, xp: 2, bodies: ['blob', 'spider', 'beast'],
    abilities: [[], [], [], []], cost: 0.6, desc: 'Weak alone. Never alone.' },
  tank: { hp: 30, dmg: [2, 4], armor: 4, acc: 80, eva: 0, speed: 80, range: 1, xp: 9, bodies: ['golem', 'blob'],
    abilities: [[], [], ['slam'], ['slam']], cost: 2.2, desc: 'A walking bulwark. Blades skitter off its hide.' },
  assassin: { hp: 11, dmg: [3, 6], armor: 0, acc: 95, eva: 20, speed: 110, range: 1, xp: 9, bodies: ['wraith', 'biped', 'spider'],
    abilities: [['blink'], ['blink'], ['blink', 'curse'], ['blink']], cost: 2.0, desc: 'Strikes from nowhere and vanishes again.' },
};

const NOUNS: Record<BodyPlan, string[]> = {
  biped: ['Ghoul', 'Cultist', 'Reaver', 'Husk', 'Knight', 'Shaman', 'Thrall', 'Zealot', 'Ravager', 'Warden'],
  beast: ['Hound', 'Stalker', 'Ravager', 'Lurker', 'Maw', 'Gnasher', 'Prowler'],
  blob: ['Ooze', 'Slime', 'Gel', 'Mire', 'Pudding', 'Sludge'],
  floater: ['Eye', 'Wisp', 'Watcher', 'Orb', 'Beholder', 'Lantern'],
  spider: ['Crawler', 'Weaver', 'Skitterer', 'Broodling', 'Creeper'],
  wraith: ['Shade', 'Wraith', 'Specter', 'Phantom', 'Banshee', 'Revenant'],
  golem: ['Golem', 'Sentinel', 'Colossus', 'Construct', 'Juggernaut', 'Effigy'],
};

const TRAIT_POOL: Trait[] = ['poisonous', 'vampiric', 'explosive', 'splitter', 'regenerating', 'armored', 'swift', 'ethereal', 'burning', 'freezing', 'thorny'];

const BIOME_DMG: Record<string, DmgKind> = {
  crypt: 'shadow', frost: 'ice', forge: 'fire', fungal: 'poison', temple: 'arcane', void: 'arcane',
};

export const TRAIT_DESC: Record<Trait, string> = {
  poisonous: 'Attacks poison', vampiric: 'Drains life', explosive: 'Explodes on death', splitter: 'Splits when slain',
  regenerating: 'Regenerates', armored: 'Heavily armored', swift: 'Very fast', ethereal: 'Hard to hit',
  burning: 'Attacks burn', freezing: 'Attacks may freeze', thorny: 'Reflects damage',
};

const SYL_A = ['Vor', 'Mal', 'Ka', 'Zul', 'Gor', 'Ith', 'Xan', 'Mor', 'Thra', 'Ul', 'Ner', 'Sha', 'Bel', 'Dra', 'Az', 'Kry', 'Vel', 'Oth'];
const SYL_B = ['gath', 'ek', 'zor', 'imar', 'oth', 'rax', 'uun', 'iel', 'ghast', 'nus', 'vex', 'moth', 'ar', 'ith', 'oloth', 'akar'];
const TITLES = ['the Hollow King', 'Mother of Rot', 'the Unbound', 'Devourer of Light', 'the Last Warden', 'Eater of Names',
  'the Burning Saint', 'the Pale Tyrant', 'Who Waits Below', 'the Chained God', 'Lord of the Deep', 'the Weeping Titan'];

export function properName(rng: RNG): string {
  return rng.pick(SYL_A) + rng.pick(SYL_B) + (rng.chance(0.3) ? rng.pick(['', "'", '-']) + rng.pick(SYL_B) : '');
}

function makeDef(rng: RNG, biome: Biome, tier: number, arch: Archetype, used: Set<string>): MonsterDef {
  const spec = ARCH[arch];
  const body = rng.pick(spec.bodies);
  let name = '';
  for (let i = 0; i < 10; i++) {
    name = `${rng.pick(biome.adjectives)} ${rng.pick(NOUNS[body])}`;
    if (!used.has(name)) break;
  }
  used.add(name);
  const traits: Trait[] = [];
  const traitCount = tier >= 3 ? rng.int(1, 2) : tier === 2 ? rng.int(0, 1) : rng.chance(0.3) ? 1 : 0;
  const pool = TRAIT_POOL.filter((t) => !(t === 'splitter' && arch !== 'swarm' && arch !== 'tank'));
  while (traits.length < traitCount) {
    const t = rng.pick(pool);
    if (!traits.includes(t)) traits.push(t);
  }
  const abilPool = spec.abilities[Math.min(3, tier - 1)];
  const abilities: string[] = [];
  if (arch === 'archer') abilities.push('arrow');
  if (arch === 'caster') abilities.push('bolt');
  const extra = abilPool.filter((a) => !abilities.includes(a));
  if (extra.length && (tier >= 2 || rng.chance(0.4))) abilities.push(rng.pick(extra));

  const tierMul = [1, 1.4, 1.9, 2.5][tier - 1];
  const v = () => rng.range(0.88, 1.15);
  const hue = rng.range(-0.15, 0.15);
  const primary = shiftColor(biome.wall, hue + rng.range(-0.1, 0.1), 1.6, rng.range(0.8, 1.3));
  const secondary = shiftColor(biome.accent, hue, 0.9, 0.7);
  const eye = rng.pick([0xff3020, 0xffd040, 0x40ffd0, 0xff40ff, biome.accent, 0xffffff]);
  const scaleBase = arch === 'swarm' ? 0.6 : arch === 'brute' || arch === 'tank' ? 1.15 : 0.9;
  const dmgKind: DmgKind = arch === 'caster' ? BIOME_DMG[biome.key] ?? 'arcane' : traits.includes('burning') ? 'fire' : traits.includes('poisonous') ? 'poison' : 'phys';

  const def: MonsterDef = {
    key: `${biome.key}-${tier}-${arch}-${name}`,
    name,
    body,
    arch,
    tier,
    hp: Math.round(spec.hp * tierMul * v()),
    dmg: [Math.max(1, Math.round(spec.dmg[0] * tierMul * v())), Math.round(spec.dmg[1] * tierMul * v())],
    armor: spec.armor + (traits.includes('armored') ? 3 : 0) + (tier >= 3 ? 1 : 0),
    acc: spec.acc + tier * 2,
    eva: spec.eva + (traits.includes('ethereal') ? 18 : 0),
    speed: spec.speed + (traits.includes('swift') ? 35 : 0),
    range: spec.range,
    xp: Math.round(spec.xp * tierMul * (1 + traits.length * 0.25)),
    traits,
    abilities,
    colors: { primary, secondary, eye },
    scale: scaleBase * rng.range(0.9, 1.1),
    dmgKind,
    desc: spec.desc,
    seed: rng.int(0, 1e9),
  };
  if (def.dmg[1] < def.dmg[0]) def.dmg[1] = def.dmg[0];
  return def;
}

export interface Roster {
  /** monsters available per depth (1..10) */
  byDepth: MonsterDef[][];
  bosses: Record<number, MonsterDef>;
}

/** Build the run's monster roster. Each act (biome) gets its own families. */
export function makeRoster(rng: RNG, biomes: Biome[]): Roster {
  const used = new Set<string>();
  const byDepth: MonsterDef[][] = [];
  const archs: Archetype[] = ['brute', 'skirmisher', 'archer', 'caster', 'swarm', 'tank', 'assassin'];
  const tierDefs: MonsterDef[][] = [];
  // tiers 1..4; biome per tier: t1 act1, t2 act1/2, t3 act2/3, t4 act3
  const tierBiome = [biomes[0], biomes[1], biomes[2], biomes[2]];
  for (let tier = 1; tier <= 4; tier++) {
    const list: MonsterDef[] = [];
    const picks = rng.shuffle([...archs]).slice(0, tier === 1 ? 4 : 5);
    if (tier === 1 && !picks.includes('brute') && !picks.includes('skirmisher')) picks[0] = 'skirmisher';
    for (const a of picks) list.push(makeDef(rng, tierBiome[tier - 1], tier, a, used));
    tierDefs.push(list);
  }
  for (let d = 1; d <= 10; d++) {
    const list: MonsterDef[] = [];
    if (d <= 4) list.push(...tierDefs[0]);
    if (d >= 3 && d <= 7) list.push(...tierDefs[1]);
    if (d >= 6) list.push(...tierDefs[2]);
    if (d >= 8) list.push(...tierDefs[3]);
    byDepth[d] = list;
  }
  const bosses: Record<number, MonsterDef> = {};
  bosses[5] = makeBoss(rng, biomes[1], 5, used);
  bosses[10] = makeBoss(rng, biomes[2], 10, used);
  return { byDepth, bosses };
}

function makeBoss(rng: RNG, biome: Biome, depth: number, used: Set<string>): MonsterDef {
  const final = depth === 10;
  const body: BodyPlan = rng.pick(final ? ['golem', 'wraith', 'floater', 'biped'] : ['biped', 'beast', 'golem', 'spider', 'wraith']);
  const name = `${properName(rng)}, ${rng.pick(TITLES)}`;
  used.add(name);
  const abilities = final
    ? ['slam', 'beam', 'rain', 'summon', 'blink']
    : rng.shuffle(['slam', 'beam', 'rain', 'summon', 'charge']).slice(0, 3);
  if (!abilities.includes('slam')) abilities[0] = 'slam';
  const traits: Trait[] = final ? [rng.pick(['vampiric', 'burning', 'freezing', 'poisonous'] as Trait[])] : [];
  return {
    key: `boss-${depth}`,
    name,
    body,
    arch: 'brute',
    tier: final ? 5 : 3,
    hp: final ? 820 : 240,
    dmg: final ? [17, 26] : [8, 13],
    armor: final ? 5 : 3,
    acc: 92,
    eva: 5,
    speed: final ? 105 : 95,
    range: 1,
    xp: final ? 400 : 120,
    traits,
    abilities,
    colors: { primary: shiftColor(biome.wall, rng.range(-0.2, 0.2), 1.8, 1.1), secondary: biome.accent, eye: rng.pick([0xff2010, 0xffe040, biome.accent]) },
    scale: final ? 2.0 : 1.7,
    dmgKind: BIOME_DMG[biome.key] ?? 'shadow',
    desc: final ? 'The heart of the dungeon. All paths ended here.' : 'Guardian of the lower gate.',
    boss: true,
    seed: rng.int(0, 1e9),
  };
}

export function monsterCost(def: MonsterDef): number {
  return ARCH[def.arch].cost * (0.75 + def.tier * 0.25);
}
