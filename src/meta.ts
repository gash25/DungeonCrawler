import type { MetaBonuses, RunStats, SaveData } from './game/game';
import type { ClassKey } from './game/types';

export interface MetaUpgrade {
  key: string;
  name: string;
  desc: string;
  costs: number[]; // cost per rank
}

export const UPGRADES: MetaUpgrade[] = [
  { key: 'cleric', name: 'The Lantern Order', desc: 'Unlock the Cleric class.', costs: [40] },
  { key: 'vitality', name: 'Vitality', desc: '+6 starting max life per rank.', costs: [15, 35, 70] },
  { key: 'potion', name: 'Provisions', desc: '+1 starting Healing Draught per rank.', costs: [20, 50] },
  { key: 'treasure', name: 'Treasure Sense', desc: 'Better item rarity per rank.', costs: [25, 60] },
  { key: 'insight', name: 'Insight', desc: 'Choose from 4 perks on level up instead of 3.', costs: [80] },
];

export interface Settings {
  quality: 'low' | 'high';
  music: number;
  sfx: number;
  showGrid: boolean;
}

export interface MetaState {
  shards: number;
  ranks: Record<string, number>;
  runs: number;
  wins: number;
  bestDepth: number;
  winsByClass: Partial<Record<ClassKey, number>>;
  settings: Settings;
}

const META_KEY = 'dc.meta.v1';
const SAVE_KEY = 'dc.save.v1';

function isMobile(): boolean {
  return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && window.innerWidth < 900);
}

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, val: string | null): void {
  try {
    if (val === null) localStorage.removeItem(key);
    else localStorage.setItem(key, val);
  } catch {
    /* storage unavailable */
  }
}

export function loadMeta(): MetaState {
  const def: MetaState = {
    shards: 0, ranks: {}, runs: 0, wins: 0, bestDepth: 0, winsByClass: {},
    settings: { quality: isMobile() ? 'low' : 'high', music: 0.5, sfx: 0.7, showGrid: false },
  };
  const raw = safeGet(META_KEY);
  if (!raw) return def;
  try {
    const m = JSON.parse(raw) as Partial<MetaState>;
    return { ...def, ...m, settings: { ...def.settings, ...(m.settings ?? {}) } };
  } catch {
    return def;
  }
}

export function saveMeta(m: MetaState): void {
  safeSet(META_KEY, JSON.stringify(m));
}

export function metaBonuses(m: MetaState): MetaBonuses {
  const r = (k: string) => m.ranks[k] ?? 0;
  return { bonusHp: r('vitality') * 6, startPotions: r('potion'), lootBoost: r('treasure') * 0.2, perkChoices: r('insight') };
}

export function shardsForRun(stats: RunStats, depth: number, won: boolean): number {
  return Math.round(depth * 4 + stats.kills / 4 + stats.bosses * 15 + (won ? 60 : 0));
}

export function loadRun(): SaveData | null {
  const raw = safeGet(SAVE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as SaveData;
  } catch {
    return null;
  }
}

export function saveRun(s: SaveData | null): void {
  safeSet(SAVE_KEY, s ? JSON.stringify(s) : null);
}
