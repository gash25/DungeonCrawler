import type { ClassKey, Stats } from './types';

export interface ClassDef {
  key: ClassKey;
  name: string;
  title: string;
  desc: string;
  base: Partial<Stats>;
  hpPerLevel: number;
  mpPerLevel: number;
  abilities: string[]; // unlock at levels 1,1,3,6
  weapon: string;
  armor: string;
  resource: string;
  color: number;
  playstyle: string;
}

export const ABILITY_UNLOCK = [1, 1, 3, 6];

export const CLASSES: Record<ClassKey, ClassDef> = {
  warrior: {
    key: 'warrior', name: 'Warrior', title: 'Oathsworn Blade', resource: 'Fury', color: 0xd04a3a,
    desc: 'Heavy armor, high life. Builds Fury by striking foes.',
    playstyle: 'Forgiving frontliner. Wade in, stun the dangerous ones, cleave the rest.',
    base: { maxHp: 58, maxMp: 20, dmgMin: 1, dmgMax: 2, armor: 0, acc: 88, eva: 4, crit: 5, mpRegen: 0.15, hpRegen: 0.06 },
    hpPerLevel: 8, mpPerLevel: 1, abilities: ['cleave', 'bash', 'charge', 'warcry'], weapon: 'sword', armor: 'chain',
  },
  rogue: {
    key: 'rogue', name: 'Rogue', title: 'Knife in the Dark', resource: 'Energy', color: 0x4ad08a,
    desc: 'Fast and evasive. Devastating opening strikes and poison.',
    playstyle: 'High risk. Strike sleeping or stunned foes, vanish when cornered.',
    base: { maxHp: 54, maxMp: 30, dmgMin: 1, dmgMax: 2, armor: 1, acc: 94, eva: 14, crit: 12, speed: 108, mpRegen: 0.4, hpRegen: 0.04 },
    hpPerLevel: 7, mpPerLevel: 2, abilities: ['backstab', 'shadowstep', 'poisonfan', 'smoke'], weapon: 'dagger', armor: 'leather',
  },
  mage: {
    key: 'mage', name: 'Mage', title: 'Scholar of Ruin', resource: 'Mana', color: 0x5a8aff,
    desc: 'Fragile, but commands fire, frost and lightning from afar.',
    playstyle: 'Kite and control. Freeze what reaches you, burn everything else.',
    base: { maxHp: 40, maxMp: 50, dmgMin: 0, dmgMax: 1, armor: 0, acc: 90, eva: 8, crit: 6, spellPower: 0, mpRegen: 0.55, hpRegen: 0.03, sight: 9 },
    hpPerLevel: 5, mpPerLevel: 5, abilities: ['firebolt', 'frostnova', 'blink', 'chain'], weapon: 'staff', armor: 'robe',
  },
  cleric: {
    key: 'cleric', name: 'Cleric', title: 'Lantern of the Faith', resource: 'Faith', color: 0xf0c050,
    desc: 'Durable holy warrior who heals through punishment.',
    playstyle: 'Sustain. Smite at range, heal through the grind, judge the strong.',
    base: { maxHp: 50, maxMp: 36, dmgMin: 1, dmgMax: 2, armor: 1, acc: 90, eva: 5, crit: 5, mpRegen: 0.35, hpRegen: 0.05 },
    hpPerLevel: 7, mpPerLevel: 3, abilities: ['smite', 'heal', 'sanctuary', 'judgment'], weapon: 'mace', armor: 'chain',
  },
};
