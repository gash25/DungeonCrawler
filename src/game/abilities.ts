import type { Game } from './game';
import { chebyshev, lineTiles } from './fov';
import type { Actor, DmgKind } from './types';

export type TargetMode = 'self' | 'enemy' | 'tile';

export interface AbilityDef {
  key: string;
  name: string;
  desc: string;
  mp: number;
  cd: number;
  target: TargetMode;
  range: number;
  minRange?: number;
  radius?: number;
  kind: DmgKind;
  icon: string;
  needsLos?: boolean;
  exec: (g: Game, user: Actor, tx: number, ty: number) => boolean;
}

const rnd = (g: Game, a: number, b: number) => g.rng.range(a, b);

export const ABILITIES: Record<string, AbilityDef> = {
  // ---------------- Warrior
  cleave: {
    key: 'cleave', name: 'Cleave', icon: '⚔', kind: 'phys', mp: 6, cd: 3, target: 'self', range: 0, radius: 1,
    desc: 'Strike every adjacent enemy for 120% weapon damage.',
    exec(g, u) {
      const foes = g.enemiesInRadius(u.x, u.y, 1, u);
      if (!foes.length) return false;
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 1, kind: 'phys' });
      for (const f of foes) g.attack(u, f, { mult: 1.2 * g.empower(u, 'cleave'), ability: true });
      return true;
    },
  },
  bash: {
    key: 'bash', name: 'Shield Bash', icon: '⛨', kind: 'phys', mp: 6, cd: 5, target: 'enemy', range: 1,
    desc: 'Slam an adjacent enemy for 100% weapon damage and stun it for 2 turns.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      const d = g.attack(u, t, { mult: 1.0 * g.empower(u, 'bash'), noMiss: true, ability: true });
      if (d >= 0 && !t.dead) g.addStatus(t, 'stun', t.boss ? 1 : 2, 0);
      g.emit({ t: 'shake', power: 0.25 });
      return true;
    },
  },
  charge: {
    key: 'charge', name: 'Charge', icon: '➶', kind: 'phys', mp: 8, cd: 6, target: 'enemy', range: 5, minRange: 2, needsLos: true,
    desc: 'Rush to an enemy 2-5 tiles away, hitting for 150% and stunning for 1 turn.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      const path = lineTiles(u, t);
      let stop = { x: u.x, y: u.y };
      for (const p of path) {
        if (p.x === t.x && p.y === t.y) break;
        if (!g.isWalkable(p.x, p.y)) return false;
        stop = p;
      }
      if (chebyshev(stop, t) > 1) return false;
      g.moveActor(u, stop.x, stop.y, 'charge');
      g.attack(u, t, { mult: 1.5 * g.empower(u, 'charge'), noMiss: true, ability: true });
      if (!t.dead) g.addStatus(t, 'stun', 1, 0);
      g.emit({ t: 'shake', power: 0.35 });
      return true;
    },
  },
  warcry: {
    key: 'warcry', name: 'War Cry', icon: '♛', kind: 'phys', mp: 10, cd: 12, target: 'self', range: 0, radius: 3,
    desc: 'Weaken enemies within 3 tiles (-30% damage) and gain Enrage (+30% damage) and a shield.',
    exec(g, u) {
      const foes = g.enemiesInRadius(u.x, u.y, 3, u);
      for (const f of foes) g.addStatus(f, 'weak', 5, 0);
      g.addStatus(u, 'enrage', 5, 0);
      g.addStatus(u, 'shield', 8, Math.round((10 + g.player.level * 3) * g.empower(u, 'warcry')));
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 3, kind: 'holy' });
      g.emit({ t: 'shake', power: 0.3 });
      return true;
    },
  },
  // ---------------- Rogue
  backstab: {
    key: 'backstab', name: 'Backstab', icon: '🗡', kind: 'phys', mp: 5, cd: 2, target: 'enemy', range: 1,
    desc: '150% damage. 300% and a guaranteed crit against sleeping, stunned or frozen foes, or from stealth.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      const helpless = t.asleep || g.hasStatus(t, 'stun') || g.hasStatus(t, 'freeze') || g.hasStatus(u, 'stealth') || !t.alerted;
      g.attack(u, t, { mult: (helpless ? 3 : 1.5) * g.empower(u, 'backstab'), forceCrit: helpless, noMiss: helpless, ability: true });
      return true;
    },
  },
  shadowstep: {
    key: 'shadowstep', name: 'Shadow Step', icon: '☾', kind: 'shadow', mp: 8, cd: 6, target: 'enemy', range: 6, needsLos: true,
    desc: 'Vanish and reappear beside an enemy. Your next hit within 2 turns is a critical strike.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      // prefer the tile opposite to us ("behind")
      const dx = Math.sign(t.x - u.x), dy = Math.sign(t.y - u.y);
      const cands = [{ x: t.x + dx, y: t.y + dy }];
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (ox || oy) cands.push({ x: t.x + ox, y: t.y + oy });
      const spot = cands.find((c) => g.isWalkable(c.x, c.y));
      if (!spot) return false;
      g.moveActor(u, spot.x, spot.y, 'blink');
      g.player.flags.nextCrit = g.turn + 2;
      return true;
    },
  },
  poisonfan: {
    key: 'poisonfan', name: 'Venom Fan', icon: '✺', kind: 'poison', mp: 8, cd: 6, target: 'self', range: 0, radius: 2,
    desc: 'Hurl poisoned blades at all enemies within 2 tiles: 60% damage and strong poison.',
    exec(g, u) {
      const foes = g.enemiesInRadius(u.x, u.y, 2, u, true);
      if (!foes.length) return false;
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 2, kind: 'poison' });
      for (const f of foes) {
        g.emit({ t: 'projectile', from: u, to: f, kind: 'poison' });
        g.attack(u, f, { mult: 0.6, noMiss: true, ability: true });
        if (!f.dead) g.addStatus(f, 'poison', 5, Math.round((2 + g.player.level * 0.6) * g.empower(u, 'poisonfan')));
      }
      return true;
    },
  },
  smoke: {
    key: 'smoke', name: 'Smoke Bomb', icon: '☁', kind: 'shadow', mp: 10, cd: 14, target: 'self', range: 0,
    desc: 'Vanish into smoke: enemies lose track of you. Stealth for 5 turns.',
    exec(g, u) {
      g.addStatus(u, 'stealth', 5, 0);
      for (const m of g.actors) {
        if (m.isPlayer || m.dead || m.boss) continue;
        if (chebyshev(m, u) > 1) {
          m.alerted = false;
          m.lastSeen = null;
        }
      }
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 2, kind: 'shadow' });
      return true;
    },
  },
  // ---------------- Mage
  firebolt: {
    key: 'firebolt', name: 'Firebolt', icon: '🔥', kind: 'fire', mp: 5, cd: 0, target: 'enemy', range: 7, needsLos: true,
    desc: 'Launch a bolt of fire (6-10) that sets the target ablaze.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      g.emit({ t: 'projectile', from: u, to: t, kind: 'fire' });
      g.spellHit(u, t, rnd(g, 6, 10) * g.spellScale(u, 'firebolt'), 'fire');
      if (!t.dead) g.addStatus(t, 'burn', 3, Math.round(2 * g.spellScale(u, 'firebolt')));
      return true;
    },
  },
  frostnova: {
    key: 'frostnova', name: 'Frost Nova', icon: '❄', kind: 'ice', mp: 10, cd: 7, target: 'self', range: 0, radius: 2,
    desc: 'Blast of ice around you: 5-9 damage and freeze enemies within 2 tiles for 2 turns.',
    exec(g, u) {
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 2, kind: 'ice' });
      for (const f of g.enemiesInRadius(u.x, u.y, 2, u, true)) {
        g.spellHit(u, f, rnd(g, 5, 9) * g.spellScale(u, 'frostnova'), 'ice');
        if (!f.dead) g.addStatus(f, 'freeze', f.boss ? 1 : 2, 0);
      }
      return true;
    },
  },
  blink: {
    key: 'blink', name: 'Blink', icon: '✧', kind: 'arcane', mp: 6, cd: 5, target: 'tile', range: 6, needsLos: true,
    desc: 'Teleport to a visible tile within 6.',
    exec(g, u, tx, ty) {
      if (!g.isWalkable(tx, ty)) return false;
      g.moveActor(u, tx, ty, 'blink');
      return true;
    },
  },
  chain: {
    key: 'chain', name: 'Chain Lightning', icon: 'ϟ', kind: 'lightning', mp: 14, cd: 4, target: 'enemy', range: 6, needsLos: true,
    desc: 'Lightning (10-16) arcs from the target to up to 3 more enemies.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      g.chainLightning(u, t, rnd(g, 10, 16) * g.spellScale(u, 'chain'), 4);
      return true;
    },
  },
  // ---------------- Cleric
  smite: {
    key: 'smite', name: 'Smite', icon: '☀', kind: 'holy', mp: 5, cd: 1, target: 'enemy', range: 4, needsLos: true,
    desc: 'Holy fire (6-10) strikes the target. Heals you for 35% of damage dealt.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      g.emit({ t: 'projectile', from: u, to: t, kind: 'holy' });
      const d = g.spellHit(u, t, rnd(g, 6, 10) * g.spellScale(u, 'smite'), 'holy');
      if (d > 0) g.heal(u, Math.round(d * 0.35));
      return true;
    },
  },
  heal: {
    key: 'heal', name: 'Mend', icon: '✚', kind: 'holy', mp: 10, cd: 6, target: 'self', range: 0,
    desc: 'Restore 30% of max life (scales with spell power) and cleanse poison, burn and bleed.',
    exec(g, u) {
      g.heal(u, Math.round(u.stats.maxHp * 0.3 * g.spellScale(u, 'heal')));
      u.statuses = u.statuses.filter((s) => !['poison', 'burn', 'bleed'].includes(s.kind));
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 1, kind: 'holy' });
      return true;
    },
  },
  sanctuary: {
    key: 'sanctuary', name: 'Sanctuary', icon: '✟', kind: 'holy', mp: 12, cd: 9, target: 'self', range: 0, radius: 2,
    desc: 'Holy burst (6-10) around you that stuns enemies for 1 turn and shields you.',
    exec(g, u) {
      g.emit({ t: 'aoe', x: u.x, y: u.y, radius: 2, kind: 'holy' });
      for (const f of g.enemiesInRadius(u.x, u.y, 2, u, true)) {
        g.spellHit(u, f, rnd(g, 6, 10) * g.spellScale(u, 'sanctuary'), 'holy');
        if (!f.dead) g.addStatus(f, 'stun', 1, 0);
      }
      g.addStatus(u, 'shield', 8, Math.round((8 + g.player.level * 2.5) * g.spellScale(u, 'sanctuary')));
      return true;
    },
  },
  judgment: {
    key: 'judgment', name: 'Judgment', icon: '⚖', kind: 'holy', mp: 16, cd: 8, target: 'enemy', range: 5, needsLos: true,
    desc: 'Call down judgment (18-28) on one enemy and stun it.',
    exec(g, u, tx, ty) {
      const t = g.actorAt(tx, ty);
      if (!t) return false;
      g.emit({ t: 'aoe', x: t.x, y: t.y, radius: 0, kind: 'holy' });
      g.spellHit(u, t, rnd(g, 18, 28) * g.spellScale(u, 'judgment'), 'holy');
      if (!t.dead) g.addStatus(t, 'stun', 1, 0);
      g.emit({ t: 'shake', power: 0.3 });
      return true;
    },
  },
};
