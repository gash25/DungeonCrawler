import type { ClassKey, Item, StatusKind } from '../game/types';

const BASE_ICON: Record<string, string> = {
  sword: '🗡️', axe: '🪓', mace: '🔨', dagger: '🔪', spear: '🔱', hammer: '⚒️', staff: '🪄', wand: '✨',
  robe: '👘', leather: '🦺', chain: '⛓️', plate: '🛡️', helm: '⛑️', hood: '🎭', circlet: '👑', ring: '💍', amulet: '📿',
  heal: '🧪', mana: '💧', teleport: '🌀', mapping: '🗺️', fire: '🔥', frost: '❄️', bomb: '💣', elixir: '⚗️',
};

export function itemIcon(it: Item): string {
  return BASE_ICON[it.base] ?? '❔';
}

export const CLASS_ICON: Record<ClassKey, string> = { warrior: '⚔️', rogue: '🗡️', mage: '🔮', cleric: '☀️' };

export const STATUS_INFO: Record<StatusKind, { name: string; bad: boolean }> = {
  poison: { name: 'Poisoned', bad: true }, burn: { name: 'Burning', bad: true }, bleed: { name: 'Bleeding', bad: true },
  stun: { name: 'Stunned', bad: true }, freeze: { name: 'Frozen', bad: true }, slow: { name: 'Slowed', bad: true },
  root: { name: 'Rooted', bad: true }, weak: { name: 'Weakened', bad: true }, vuln: { name: 'Vulnerable', bad: true },
  regen: { name: 'Regenerating', bad: false }, shield: { name: 'Shielded', bad: false }, haste: { name: 'Hasted', bad: false },
  stealth: { name: 'Stealthed', bad: false }, enrage: { name: 'Enraged', bad: false },
};

export function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}
