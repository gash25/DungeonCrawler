import { RNG } from './rng';
import { Biome } from './theme';
import { monsterCost, Roster } from './monsters';
import { T, type Feature, type FloorData, type Room, type Spawn, type Vec } from './types';

export const BOSS_FLOORS = [5, 10];
export const MERCHANT_FLOORS = [3, 6, 8];
export const FINAL_DEPTH = 10;

function carveRoom(tiles: Uint8Array, w: number, room: Room, rng: RNG): void {
  const { x, y, w: rw, h: rh, shape } = room;
  for (let j = y; j < y + rh; j++) {
    for (let i = x; i < x + rw; i++) {
      let inside = true;
      if (shape === 'circle' || shape === 'arena') {
        const dx = (i - (x + (rw - 1) / 2)) / (rw / 2);
        const dy = (j - (y + (rh - 1) / 2)) / (rh / 2);
        inside = dx * dx + dy * dy <= 1.0;
      } else if (shape === 'cave') {
        const dx = (i - (x + (rw - 1) / 2)) / (rw / 2);
        const dy = (j - (y + (rh - 1) / 2)) / (rh / 2);
        inside = dx * dx + dy * dy <= 0.85 + rng.range(-0.2, 0.35);
      }
      if (inside) tiles[j * w + i] = T.Floor;
    }
  }
  // guarantee the center is open
  tiles[room.cy * w + room.cx] = T.Floor;
}

function carveCorridor(tiles: Uint8Array, w: number, a: Vec, b: Vec, rng: RNG, wide: boolean): void {
  let { x, y } = a;
  const horizFirst = rng.chance(0.5);
  const step = (tx: number, ty: number) => {
    while (x !== tx || y !== ty) {
      if (x !== tx) x += Math.sign(tx - x);
      else if (y !== ty) y += Math.sign(ty - y);
      tiles[y * w + x] = T.Floor;
      if (wide) {
        tiles[(y + 1) * w + x] = T.Floor;
        tiles[y * w + x + 1] = T.Floor;
      }
    }
  };
  if (horizFirst) {
    step(b.x, y);
    step(b.x, b.y);
  } else {
    step(x, b.y);
    step(b.x, b.y);
  }
}

export function bfs(tiles: Uint8Array, w: number, h: number, from: Vec): Int32Array {
  const dist = new Int32Array(w * h).fill(-1);
  const q: number[] = [from.y * w + from.x];
  dist[q[0]] = 0;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const cx = c % w, cy = (c / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (dist[n] >= 0 || tiles[n] === T.Wall) continue;
        if (dx && dy && (tiles[cy * w + nx] === T.Wall || tiles[ny * w + cx] === T.Wall)) continue;
        dist[n] = dist[c] + 1;
        q.push(n);
      }
    }
  }
  return dist;
}

export interface FloorGenOpts {
  depth: number;
  biome: Biome;
  roster: Roster;
  floorName: string;
}

export function generateFloor(rng: RNG, opts: FloorGenOpts): FloorData {
  const { depth, biome } = opts;
  const isBoss = BOSS_FLOORS.includes(depth);
  const w = 46 + rng.int(0, 8);
  const h = 46 + rng.int(0, 8);
  const tiles = new Uint8Array(w * h);
  const rooms: Room[] = [];
  const targetRooms = rng.int(9, 13);

  const overlaps = (r: Room) => rooms.some((o) => r.x - 2 < o.x + o.w && r.x + r.w + 2 > o.x && r.y - 2 < o.y + o.h && r.y + r.h + 2 > o.y);

  let bossRoom: Room | null = null;
  if (isBoss) {
    const size = 15;
    const bx = rng.chance(0.5) ? 2 : w - size - 2;
    const by = rng.chance(0.5) ? 2 : h - size - 2;
    bossRoom = { x: bx, y: by, w: size, h: size, cx: bx + (size >> 1), cy: by + (size >> 1), shape: 'arena' };
    rooms.push(bossRoom);
  }

  for (let tries = 0; tries < 400 && rooms.length < targetRooms; tries++) {
    const shape = rng.weighted<Room['shape']>(biome.cave ? [['cave', 6], ['circle', 2], ['rect', 1]] : [['rect', 6], ['circle', 2], ['cave', 1]]);
    const rw = rng.int(5, shape === 'rect' ? 11 : 10);
    const rh = shape === 'circle' ? rw : rng.int(5, 10);
    const x = rng.int(2, w - rw - 3);
    const y = rng.int(2, h - rh - 3);
    const room: Room = { x, y, w: rw, h: rh, cx: x + (rw >> 1), cy: y + (rh >> 1), shape };
    if (!overlaps(room)) rooms.push(room);
  }

  for (const r of rooms) carveRoom(tiles, w, r, rng);

  // Connect rooms with a minimum spanning tree plus a few loops
  const connected = [0];
  const remaining = rooms.map((_, i) => i).slice(1);
  const edges: [number, number][] = [];
  while (remaining.length) {
    let best: [number, number, number] = [0, 0, Infinity];
    for (const a of connected) {
      for (const b of remaining) {
        const d = Math.abs(rooms[a].cx - rooms[b].cx) + Math.abs(rooms[a].cy - rooms[b].cy);
        if (d < best[2]) best = [a, b, d];
      }
    }
    edges.push([best[0], best[1]]);
    connected.push(best[1]);
    remaining.splice(remaining.indexOf(best[1]), 1);
  }
  const loops = rng.int(2, 4);
  for (let i = 0; i < loops; i++) {
    const a = rng.int(0, rooms.length - 1);
    const b = rng.int(0, rooms.length - 1);
    if (a !== b && !(bossRoom && (rooms[a] === bossRoom || rooms[b] === bossRoom))) edges.push([a, b]);
  }
  for (const [a, b] of edges) {
    carveCorridor(tiles, w, { x: rooms[a].cx, y: rooms[a].cy }, { x: rooms[b].cx, y: rooms[b].cy }, rng, rng.chance(0.25));
  }

  // Cave roughening: nibble walls adjacent to floor
  if (biome.cave) {
    const copy = tiles.slice();
    for (let y = 2; y < h - 2; y++) {
      for (let x = 2; x < w - 2; x++) {
        if (copy[y * w + x] !== T.Wall) continue;
        let n = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (copy[(y + dy) * w + x + dx] !== T.Wall) n++;
        if (n >= 4 && rng.chance(0.35)) tiles[y * w + x] = T.Floor;
      }
    }
  }

  // Border safety
  for (let x = 0; x < w; x++) {
    tiles[x] = T.Wall;
    tiles[(h - 1) * w + x] = T.Wall;
  }
  for (let y = 0; y < h; y++) {
    tiles[y * w] = T.Wall;
    tiles[y * w + w - 1] = T.Wall;
  }

  // Start and stairs: start in a non-boss room, stairs in the farthest room
  const normalRooms = rooms.filter((r) => r !== bossRoom);
  const startRoom = isBoss ? normalRooms.reduce((best, r) => (dist2(r, bossRoom!) > dist2(best, bossRoom!) ? r : best), normalRooms[0]) : rng.pick(normalRooms);
  const start = { x: startRoom.cx, y: startRoom.cy };
  const dist = bfs(tiles, w, h, start);
  let stairs: Vec;
  if (bossRoom) {
    stairs = { x: bossRoom.cx, y: bossRoom.cy };
  } else {
    let far = normalRooms[0];
    for (const r of normalRooms) if (dist[r.cy * w + r.cx] > dist[far.cy * w + far.cx]) far = r;
    stairs = { x: far.cx, y: far.cy };
  }
  // Remove anything unreachable (keeps the map clean)
  for (let i = 0; i < w * h; i++) if (tiles[i] !== T.Wall && dist[i] < 0) tiles[i] = T.Wall;
  if (!bossRoom) tiles[stairs.y * w + stairs.x] = T.Stairs;

  const features: Feature[] = [];
  const occupied = new Set<number>();
  const key = (x: number, y: number) => y * w + x;
  occupied.add(key(start.x, start.y));
  occupied.add(key(stairs.x, stairs.y));
  const isFloor = (x: number, y: number) => x > 0 && y > 0 && x < w - 1 && y < h - 1 && tiles[key(x, y)] === T.Floor;

  // Hazard pools in larger rooms (ring of floor kept free so connectivity holds)
  if (biome.hazard !== 'none') {
    for (const r of normalRooms) {
      if (r === startRoom || r.w < 7 || r.h < 7 || !rng.chance(0.45)) continue;
      const pcx = r.cx + rng.int(-1, 1), pcy = r.cy + rng.int(-1, 1);
      const rad = rng.range(1.2, Math.min(r.w, r.h) / 2 - 1.8);
      for (let y = r.y + 2; y < r.y + r.h - 2; y++) {
        for (let x = r.x + 2; x < r.x + r.w - 2; x++) {
          const d = Math.hypot(x - pcx, y - pcy) + rng.range(-0.4, 0.4);
          if (d <= rad && isFloor(x, y) && !occupied.has(key(x, y))) tiles[key(x, y)] = T.Hazard;
        }
      }
      // Never cover the room center (corridors aim there)
      if (tiles[key(r.cx, r.cy)] === T.Hazard) tiles[key(r.cx, r.cy)] = T.Floor;
    }
    // Verify every floor is still reachable without crossing hazards; otherwise revert hazards
    const reach = bfsNoHazard(tiles, w, h, start);
    for (let i = 0; i < w * h; i++) {
      if (tiles[i] === T.Floor && !reach[i]) {
        for (let j = 0; j < w * h; j++) if (tiles[j] === T.Hazard) tiles[j] = T.Floor;
        break;
      }
    }
  }

  // Pillars in big rect rooms
  for (const r of normalRooms) {
    if (r.shape !== 'rect' || r.w < 8 || r.h < 8 || !rng.chance(0.5)) continue;
    for (const [px, py] of [[r.x + 2, r.y + 2], [r.x + r.w - 3, r.y + 2], [r.x + 2, r.y + r.h - 3], [r.x + r.w - 3, r.y + r.h - 3]]) {
      if (isFloor(px, py) && !occupied.has(key(px, py))) {
        tiles[key(px, py)] = T.Wall;
        features.push({ kind: 'pillar', x: px, y: py });
      }
    }
  }
  if (bossRoom) {
    const r = bossRoom;
    for (let a = 0; a < 6; a++) {
      const ang = (a / 6) * Math.PI * 2 + 0.3;
      const px = Math.round(r.cx + Math.cos(ang) * 5), py = Math.round(r.cy + Math.sin(ang) * 5);
      if (isFloor(px, py)) {
        features.push({ kind: 'brazier', x: px, y: py });
        occupied.add(key(px, py));
      }
    }
  }

  // Torches on walls bordering rooms
  const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      if (tiles[key(x, y)] !== T.Wall || features.some((f) => f.kind === 'pillar' && f.x === x && f.y === y)) continue;
      for (let d = 0; d < 4; d++) {
        const nx = x + dirs[d][0], ny = y + dirs[d][1];
        if (isFloor(nx, ny) && rng.chance(0.035)) {
          if (!features.some((f) => f.kind === 'torch' && Math.abs(f.x - x) + Math.abs(f.y - y) < 5)) {
            features.push({ kind: 'torch', x, y, dir: d });
          }
          break;
        }
      }
    }
  }

  const freeIn = (r: Room, margin = 1): Vec | null => {
    for (let t = 0; t < 40; t++) {
      const x = rng.int(r.x + margin, r.x + r.w - 1 - margin);
      const y = rng.int(r.y + margin, r.y + r.h - 1 - margin);
      if (isFloor(x, y) && !occupied.has(key(x, y))) {
        occupied.add(key(x, y));
        return { x, y };
      }
    }
    return null;
  };

  const otherRooms = normalRooms.filter((r) => r !== startRoom);
  // Chests
  const chests = rng.int(2, 3) + (depth % 3 === 0 ? 1 : 0);
  for (let i = 0; i < chests; i++) {
    const r = rng.pick(otherRooms);
    const p = freeIn(r);
    if (p) features.push({ kind: 'chest', ...p, rarity: rng.weighted([['common', 50], ['magic', 30], ['rare', 15], ['epic', 5]] as const) });
  }
  if (rng.chance(0.6)) {
    const p = freeIn(rng.pick(otherRooms));
    if (p) features.push({ kind: 'shrine', ...p, variant: rng.int(0, 3) });
  }
  if (rng.chance(0.45)) {
    const p = freeIn(rng.pick(otherRooms));
    if (p) features.push({ kind: 'fountain', ...p });
  }
  if (MERCHANT_FLOORS.includes(depth)) {
    const r = rng.pick(otherRooms);
    const p = freeIn(r);
    if (p) {
      features.push({ kind: 'merchant', ...p });
      tiles[key(p.x, p.y)] = T.Floor;
    }
  }
  // Traps (hidden) on floors and corridors
  const trapCount = rng.int(3, 5) + Math.floor(depth / 2);
  for (let i = 0; i < trapCount; i++) {
    for (let t = 0; t < 30; t++) {
      const x = rng.int(1, w - 2), y = rng.int(1, h - 2);
      if (isFloor(x, y) && !occupied.has(key(x, y)) && (dist[key(x, y)] ?? 0) > 6) {
        occupied.add(key(x, y));
        features.push({ kind: 'trap', x, y, hidden: true, variant: rng.int(0, 2) });
        break;
      }
    }
  }
  // Decor (non-blocking)
  for (const r of rooms) {
    const n = rng.int(1, 4);
    for (let i = 0; i < n; i++) {
      const x = rng.int(r.x, r.x + r.w - 1), y = rng.int(r.y, r.y + r.h - 1);
      if (!isFloor(x, y) || occupied.has(key(x, y))) continue;
      // prefer near walls
      let nearWall = false;
      for (const [dx, dy] of dirs) if (tiles[key(x + dx, y + dy)] === T.Wall) nearWall = true;
      if (!nearWall && rng.chance(0.7)) continue;
      features.push({ kind: 'decor', x, y, variant: rng.int(0, biome.decor.length - 1), dir: rng.int(0, 3) });
    }
  }

  // Monsters
  const spawns: Spawn[] = [];
  const defs = opts.roster.byDepth[Math.min(depth, 10)];
  let budget = 9 + depth * 2.9;
  const eliteChance = 0.06 + depth * 0.025;
  const spawnRooms = rng.shuffle(otherRooms.slice());
  let guard = 0;
  while (budget > 0 && guard++ < 200 && spawnRooms.length) {
    const r = spawnRooms[guard % spawnRooms.length];
    const def = rng.pick(defs);
    const packSize = def.arch === 'swarm' ? rng.int(3, 5) : def.arch === 'skirmisher' ? rng.int(1, 3) : 1;
    const asleep = rng.chance(0.4);
    for (let i = 0; i < packSize && budget > 0; i++) {
      const p = freeIn(r, 0);
      if (!p) break;
      if (dist[key(p.x, p.y)] >= 0 && dist[key(p.x, p.y)] < 8) continue;
      const elite = def.arch !== 'swarm' && rng.chance(eliteChance);
      spawns.push({ ...p, def, elite, asleep });
      budget -= monsterCost(def) * (elite ? 2.2 : 1);
    }
  }
  if (bossRoom) {
    spawns.push({ x: bossRoom.cx, y: bossRoom.cy, def: opts.roster.bosses[depth], elite: false, asleep: true });
    occupied.add(key(bossRoom.cx, bossRoom.cy));
  }

  return { depth, w, h, tiles, rooms, features, start, stairs, bossRoom, spawns, name: opts.floorName, biome: biome.key };
}

function dist2(a: Room, b: Room): number {
  return (a.cx - b.cx) ** 2 + (a.cy - b.cy) ** 2;
}

function bfsNoHazard(tiles: Uint8Array, w: number, h: number, from: Vec): Uint8Array {
  const seen = new Uint8Array(w * h);
  const q = [from.y * w + from.x];
  seen[q[0]] = 1;
  for (let qi = 0; qi < q.length; qi++) {
    const c = q[qi];
    const cx = c % w, cy = (c / w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (cy + dy) * w + cx + dx;
      if (cx + dx < 0 || cy + dy < 0 || cx + dx >= w || cy + dy >= h) continue;
      if (seen[n] || tiles[n] === T.Wall || tiles[n] === T.Hazard) continue;
      seen[n] = 1;
      q.push(n);
    }
  }
  return seen;
}
