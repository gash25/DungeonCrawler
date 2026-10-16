import { ABILITIES } from './abilities';
import { CLASSES } from './classes';
import type { RNG } from './rng';
import type { ClassKey, Player, Stats } from './types';

export interface PerkDef {
  key: string;
  name: string;
  desc: string;
  icon: string;
  stats?: Partial<Stats>;
  max: number;
  classes?: ClassKey[];
  weight: number;
}

const BASE_PERKS: PerkDef[] = [
  { key: 'tough', name: 'Toughness', icon: '❤', desc: '+12 max life.', stats: { maxHp: 12 }, max: 5, weight: 10 },
  { key: 'brutal', name: 'Brutality', icon: '⚒', desc: '+2 min and +3 max damage.', stats: { dmgMin: 2, dmgMax: 3 }, max: 5, weight: 9 },
  { key: 'precise', name: 'Precision', icon: '◎', desc: '+7% critical chance, +8 accuracy.', stats: { crit: 7, acc: 8 }, max: 4, weight: 7 },
  { key: 'agile', name: 'Agility', icon: '➹', desc: '+7 evasion.', stats: { eva: 7 }, max: 4, weight: 7 },
  { key: 'ironskin', name: 'Ironskin', icon: '⛊', desc: '+2 armor.', stats: { armor: 2 }, max: 5, weight: 8 },
  { key: 'leech', name: 'Vampirism', icon: '♆', desc: '+6% life steal.', stats: { lifesteal: 6 }, max: 3, weight: 5 },
  { key: 'mind', name: 'Arcane Mind', icon: '✶', desc: '+12 max mana and +15% spell power.', stats: { maxMp: 12, spellPower: 15 }, max: 4, weight: 7 },
  { key: 'medit', name: 'Meditation', icon: '☯', desc: '+0.25 mana per turn.', stats: { mpRegen: 0.25 }, max: 3, weight: 6 },
  { key: 'troll', name: 'Troll Blood', icon: '♨', desc: '+0.2 life per turn.', stats: { hpRegen: 0.2 }, max: 3, weight: 6 },
  { key: 'swift', name: 'Fleet Foot', icon: '»', desc: '+10 speed (act more often).', stats: { speed: 10 }, max: 2, weight: 4 },
  { key: 'thorns', name: 'Barbed Hide', icon: '✹', desc: '+4 thorns damage to melee attackers.', stats: { thorns: 4 }, max: 3, weight: 4 },
  { key: 'ember', name: 'Ember Touch', icon: '♨', desc: '+3 fire damage on every hit.', stats: { fireOnHit: 3 }, max: 3, weight: 5 },
  { key: 'savage', name: 'Savagery', icon: '✷', desc: '+0.4 critical multiplier.', stats: { critMul: 0.4 }, max: 2, weight: 4 },
  { key: 'eagle', name: 'Eagle Eye', icon: '◉', desc: '+2 sight radius; traps reveal more often.', stats: { sight: 2 }, max: 1, weight: 3 },
  { key: 'executioner', name: 'Executioner', icon: '☠', desc: '+50% damage against enemies below 30% life.', max: 1, weight: 4 },
  { key: 'laststand', name: 'Last Stand', icon: '⛉', desc: 'Once per floor, a lethal blow leaves you at 1 life instead.', max: 1, weight: 4 },
  { key: 'bloodlust', name: 'Bloodlust', icon: '⚔', desc: 'Heal 5 life whenever you slay an enemy.', max: 2, weight: 5 },
  { key: 'alchemist', name: 'Alchemist', icon: '⚗', desc: 'Potions are 50% stronger.', max: 1, weight: 4 },
  { key: 'fortune', name: 'Fortune', icon: '✪', desc: '+50% gold and better loot.', max: 2, weight: 4 },
  { key: 'focus', name: 'Focus', icon: '⌛', desc: 'All ability cooldowns -1 turn.', max: 2, weight: 4 },
];

export function perkDef(key: string): PerkDef | undefined {
  if (key.startsWith('emp:')) {
    const ab = ABILITIES[key.slice(4)];
    if (!ab) return undefined;
    return { key, name: `Empowered ${ab.name}`, icon: ab.icon, desc: `${ab.name} is 40% stronger and costs 2 less.`, max: 2, weight: 6 };
  }
  return BASE_PERKS.find((p) => p.key === key);
}

export function rollPerks(rng: RNG, p: Player, count: number): string[] {
  const pool: PerkDef[] = [...BASE_PERKS];
  for (const a of CLASSES[p.cls].abilities) if (p.abilities.includes(a)) pool.push(perkDef('emp:' + a)!);
  const avail = pool.filter((d) => p.perks.filter((k) => k === d.key).length < d.max && (!d.classes || d.classes.includes(p.cls)));
  const out: string[] = [];
  while (out.length < count && avail.length) {
    const d = rng.weighted(avail.map((x) => [x, x.weight] as const));
    out.push(d.key);
    avail.splice(avail.indexOf(d), 1);
  }
  return out;
}

export function perkCount(p: Player, key: string): number {
  let n = 0;
  for (const k of p.perks) if (k === key) n++;
  return n;
}
