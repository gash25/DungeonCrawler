import { T, type Vec } from './types';

// Recursive shadowcasting over 8 octants.
const MULT = [
  [1, 0, 0, -1, -1, 0, 0, 1],
  [0, 1, -1, 0, 0, -1, 1, 0],
  [0, 1, 1, 0, 0, -1, -1, 0],
  [1, 0, 0, 1, -1, 0, 0, -1],
];

export function computeFov(
  tiles: Uint8Array, w: number, h: number, ox: number, oy: number, radius: number, out: Uint8Array,
): void {
  out.fill(0);
  out[oy * w + ox] = 1;
  const blocks = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === T.Wall;
  const r2 = radius * radius;
  const cast = (row: number, start: number, end: number, xx: number, xy: number, yx: number, yy: number) => {
    if (start < end) return;
    let newStart = 0;
    for (let j = row; j <= radius; j++) {
      let dx = -j - 1;
      const dy = -j;
      let blocked = false;
      while (dx <= 0) {
        dx++;
        const X = ox + dx * xx + dy * xy;
        const Y = oy + dx * yx + dy * yy;
        const lSlope = (dx - 0.5) / (dy + 0.5);
        const rSlope = (dx + 0.5) / (dy - 0.5);
        if (start < rSlope) continue;
        if (end > lSlope) break;
        if (dx * dx + dy * dy <= r2 && X >= 0 && Y >= 0 && X < w && Y < h) out[Y * w + X] = 1;
        if (blocked) {
          if (blocks(X, Y)) {
            newStart = rSlope;
            continue;
          }
          blocked = false;
          start = newStart;
        } else if (blocks(X, Y) && j < radius) {
          blocked = true;
          cast(j + 1, start, lSlope, xx, xy, yx, yy);
          newStart = rSlope;
        }
      }
      if (blocked) break;
    }
  };
  for (let o = 0; o < 8; o++) cast(1, 1.0, 0.0, MULT[0][o], MULT[1][o], MULT[2][o], MULT[3][o]);
}

/** Bresenham line-of-sight check (walls block, endpoints excluded). */
export function hasLos(tiles: Uint8Array, w: number, a: Vec, b: Vec): boolean {
  let x0 = a.x, y0 = a.y;
  const x1 = b.x, y1 = b.y;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    if (x0 === x1 && y0 === y1) return true;
    if (!(x0 === a.x && y0 === a.y) && tiles[y0 * w + x0] === T.Wall) return false;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
  }
}

export function lineTiles(a: Vec, b: Vec, maxLen = 99): Vec[] {
  const out: Vec[] = [];
  let x0 = a.x, y0 = a.y;
  const dx = Math.abs(b.x - x0), dy = -Math.abs(b.y - y0);
  const sx = x0 < b.x ? 1 : -1, sy = y0 < b.y ? 1 : -1;
  let err = dx + dy;
  while (out.length < maxLen) {
    if (x0 === b.x && y0 === b.y) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y0 += sy;
    }
    out.push({ x: x0, y: y0 });
  }
  return out;
}

export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

/**
 * A* on an 8-connected grid. `cost` returns movement cost or Infinity for blocked.
 * Diagonal moves may not cut wall corners.
 */
export function astar(
  w: number, h: number, start: Vec, goal: Vec,
  cost: (x: number, y: number) => number,
  isWall: (x: number, y: number) => boolean,
  maxNodes = 4000,
): Vec[] | null {
  const N = w * h;
  const g = new Float32Array(N).fill(Infinity);
  const came = new Int32Array(N).fill(-1);
  const closed = new Uint8Array(N);
  const s = start.y * w + start.x, gIdx = goal.y * w + goal.x;
  g[s] = 0;
  // binary heap of [f, idx]
  const heap: number[] = [];
  const fScore: number[] = [];
  const push = (idx: number, f: number) => {
    heap.push(idx);
    fScore.push(f);
    let i = heap.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (fScore[p] <= fScore[i]) break;
      [heap[p], heap[i]] = [heap[i], heap[p]];
      [fScore[p], fScore[i]] = [fScore[i], fScore[p]];
      i = p;
    }
  };
  const pop = (): number => {
    const top = heap[0];
    const lastI = heap.pop()!;
    const lastF = fScore.pop()!;
    if (heap.length) {
      heap[0] = lastI;
      fScore[0] = lastF;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < heap.length && fScore[l] < fScore[m]) m = l;
        if (r < heap.length && fScore[r] < fScore[m]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]];
        [fScore[m], fScore[i]] = [fScore[i], fScore[m]];
        i = m;
      }
    }
    return top;
  };
  const hfn = (x: number, y: number) => {
    const dx = Math.abs(x - goal.x), dy = Math.abs(y - goal.y);
    return Math.max(dx, dy) + 0.4 * Math.min(dx, dy);
  };
  push(s, hfn(start.x, start.y));
  let expanded = 0;
  while (heap.length) {
    const c = pop();
    if (c === gIdx) break;
    if (closed[c]) continue;
    closed[c] = 1;
    if (++expanded > maxNodes) return null;
    const cx = c % w, cy = (c / w) | 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const n = ny * w + nx;
        if (closed[n]) continue;
        if (dx && dy && (isWall(cx + dx, cy) || isWall(cx, cy + dy))) continue;
        const stepCost = n === gIdx ? 1 : cost(nx, ny);
        if (!isFinite(stepCost)) continue;
        const ng = g[c] + stepCost * (dx && dy ? 1.4 : 1);
        if (ng < g[n]) {
          g[n] = ng;
          came[n] = c;
          push(n, ng + hfn(nx, ny));
        }
      }
    }
  }
  if (came[gIdx] < 0 && gIdx !== s) return null;
  const path: Vec[] = [];
  let c = gIdx;
  while (c !== s) {
    path.push({ x: c % w, y: (c / w) | 0 });
    c = came[c];
    if (c < 0) return null;
  }
  path.reverse();
  return path;
}
