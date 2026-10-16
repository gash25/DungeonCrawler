// Headless balance simulation: a simple bot plays full runs per class.
// Usage: npm run sim -- [runsPerClass]
import { ABILITIES } from '../src/game/abilities';
import { chebyshev } from '../src/game/fov';
import { Game } from '../src/game/game';
import { itemScore } from '../src/game/items';
import { T, type ClassKey, type EquipSlot, type Vec } from '../src/game/types';

declare const process: { argv: string[] };

function botTurn(g: Game): boolean {
  const p = g.player;
  if (g.perkChoices) {
    const pref = ['tough', 'brutal', 'ironskin', 'leech', 'mind', 'troll'];
    g.choosePerk(g.perkChoices.find((k) => pref.includes(k)) ?? g.perkChoices[0]);
    return true;
  }
  const enemies = g.visibleEnemies();
  // gear
  if (!enemies.length) {
    for (const it of p.inv.slice()) {
      if (it.slot === 'consumable') continue;
      const cur = p.equip[it.slot as EquipSlot];
      if (!cur || itemScore(it, p.cls) > itemScore(cur, p.cls) + 1) g.equip(it.uid);
    }
    for (const it of p.inv.slice()) {
      if (it.slot !== 'consumable' && p.inv.length > 14) g.sell(it.uid);
    }
    if (g.shop.length) {
      for (let i = g.shop.length - 1; i >= 0; i--) {
        if (g.shop[i].consumable === 'heal' && p.gold >= g.shopPrice(g.shop[i])) g.buy(i);
      }
    }
  }
  const potion = p.inv.find((i) => i.consumable === 'heal');
  if (p.hp < p.stats.maxHp * 0.35 && potion && enemies.length) return g.useItem(potion.uid);
  const elixir = p.inv.find((i) => i.consumable === 'elixir');
  if (elixir) return g.useItem(elixir.uid);

  // dodge telegraphs
  const danger = new Set<number>();
  for (const a of g.actors) if (a.telegraph) for (const t of a.telegraph.tiles) danger.add(t.y * g.w + t.x);
  if (danger.has(p.y * g.w + p.x)) {
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const nx = p.x + dx, ny = p.y + dy;
      if (g.isWalkable(nx, ny) && !danger.has(ny * g.w + nx) && g.tile(nx, ny) !== T.Hazard && g.playerStep(dx, dy)) return true;
    }
  }

  if (enemies.length) {
    enemies.sort((a, b) => chebyshev(a, p) - chebyshev(b, p));
    const tgt = enemies[0];
    const d = chebyshev(tgt, p);
    if (p.hp < p.stats.maxHp * 0.5 && p.abilities.includes('heal') && !g.abilityBlocked('heal')) return g.useAbility('heal', p.x, p.y);
    if (p.hp < p.stats.maxHp * 0.3 && p.abilities.includes('smoke') && !g.abilityBlocked('smoke')) return g.useAbility('smoke', p.x, p.y);
    for (const key of p.abilities.slice().reverse()) {
      const def = ABILITIES[key];
      if (g.abilityBlocked(key) || key === 'blink' || key === 'heal' || key === 'smoke') continue;
      if (def.target === 'self') {
        const n = g.enemiesInRadius(p.x, p.y, def.radius ?? 1, p).length;
        if (n >= (key === 'warcry' ? 2 : 1)) if (g.useAbility(key, p.x, p.y)) return true;
      } else if (g.isValidTarget(def, tgt.x, tgt.y)) {
        if (g.useAbility(key, tgt.x, tgt.y)) return true;
      }
    }
    if (d === 1 && g.playerStep(Math.sign(tgt.x - p.x), Math.sign(tgt.y - p.y))) return true;
    const path = g.playerPath(tgt, true);
    if (path && path.length) {
      const s = path[0];
      if (g.playerStep(s.x - p.x, s.y - p.y)) return true;
    }
    return g.playerWait();
  }
  if (g.canRest() && p.hp < p.stats.maxHp * 0.55) return g.playerWait();
  // stairs / explore
  if (g.tile(p.x, p.y) === T.Stairs && g.descend()) return true;
  const target: Vec | null = g.exploreTarget();
  let goal = target;
  if (!goal) {
    const s = g.floor.stairs;
    if (g.tile(s.x, s.y) === T.Stairs) goal = s;
    else {
      const boss = g.actors.find((a) => a.boss && !a.dead);
      if (boss) goal = boss;
    }
  }
  if (!goal) return g.playerWait();
  const path = g.playerPath(goal, true);
  if (path && path.length) {
    const s = path[0];
    if (g.playerStep(s.x - p.x, s.y - p.y)) return true;
  }
  return g.playerWait();
}

const runs = Number(process.argv[2] ?? 40);
const classes: ClassKey[] = ['warrior', 'rogue', 'mage', 'cleric'];
for (const cls of classes) {
  const depths: number[] = [];
  let wins = 0, totalLvl = 0, stuck = 0;
  const killers: Record<string, number> = {};
  for (let r = 0; r < runs; r++) {
    const g = Game.newRun(1000 + r * 7919, cls, { bonusHp: 0, startPotions: 0, lootBoost: 0, perkChoices: 0 });
    let lastKiller = '';
    g.on((e) => {
      if (e.t === 'log' && e.cls === 'bad' && e.text.startsWith('You have been slain')) lastKiller = e.text;
    });
    let steps = 0;
    let lastDepth = 0;
    const curve: string[] = [];
    let lastTurn = -1, same = 0;
    while (!g.over && steps < 40000) {
      botTurn(g);
      steps++;
      if (g.depth !== lastDepth && process.argv[3] === 'curve' && r < 2) {
        lastDepth = g.depth;
        const p = g.player;
        const ms = g.actors.filter((a) => !a.isPlayer);
        const avgHp = ms.reduce((a, m) => a + m.stats.maxHp, 0) / Math.max(1, ms.length);
        const avgDmg = ms.reduce((a, m) => a + (m.stats.dmgMin + m.stats.dmgMax) / 2, 0) / Math.max(1, ms.length);
        const pots = p.inv.find((i) => i.consumable === 'heal')?.count ?? 0;
        curve.push(`d${g.depth} L${p.level} hp${p.stats.maxHp} dmg${p.stats.dmgMin}-${p.stats.dmgMax} ar${p.stats.armor} sp${p.stats.spellPower} pots${pots} gold${p.gold} | mobs ${ms.length} hp${avgHp.toFixed(0)} dmg${avgDmg.toFixed(1)}`);
      }
      if (g.turn === lastTurn) {
        if (++same > 50) {
          stuck++; if (process.argv[3]) { const p = g.player; const near = g.actors.filter(a=>!a.isPlayer && chebyshev(a,p)<4).map(a=>`${a.name}@${a.x},${a.y} vis=${g.isVisible(a.x,a.y)} asleep=${a.asleep}`); console.log("STUCK", cls, "d", g.depth, "p", p.x, p.y, "hp", p.hp, "tile", g.tile(p.x,p.y), "explore", JSON.stringify(g.exploreTarget()), "stairs", JSON.stringify(g.floor.stairs), g.tile(g.floor.stairs.x,g.floor.stairs.y), "enemies", g.visibleEnemies().length, near.join(";"), "perk", !!g.perkChoices); }
          break;
        }
      } else same = 0;
      lastTurn = g.turn;
    }
    if (curve.length) console.log(cls, r, '\n  ' + curve.join('\n  '));
    if (g.won) wins++;
    depths.push(g.depth);
    totalLvl += g.player.level;
    if (!g.won && lastKiller) {
      const k = lastKiller.replace(/^You have been slain( by the )?/, '').replace(/\.$/, '') + ` (d${g.depth})`;
      killers[k] = (killers[k] ?? 0) + 1;
    }
  }
  const hist: Record<number, number> = {};
  for (const d of depths) hist[d] = (hist[d] ?? 0) + 1;
  console.log(`\n== ${cls}: wins ${wins}/${runs}, avg depth ${(depths.reduce((a, b) => a + b, 0) / runs).toFixed(1)}, avg level ${(totalLvl / runs).toFixed(1)}, stuck ${stuck}`);
  console.log('   death depth histogram:', JSON.stringify(hist));
  console.log('   top killers:', Object.entries(killers).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([k, v]) => `${k}×${v}`).join('; '));
}
