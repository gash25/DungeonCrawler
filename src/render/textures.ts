import * as THREE from 'three';
import { RNG } from '../game/rng';
import type { FloorStyle, HazardKind, WallStyle } from '../game/theme';

// Procedural textures: color + normal + roughness generated from height fields on the CPU.

class Noise {
  private perm: Uint8Array;
  constructor(seed: number) {
    const r = new RNG(seed);
    const p = Array.from({ length: 256 }, (_, i) => i);
    r.shuffle(p);
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }
  private grad(h: number, x: number, y: number): number {
    const u = h & 1 ? x : -x;
    const v = h & 2 ? y : -y;
    return (h & 4 ? u + v : u - v) * 0.7;
  }
  /** Tileable 2D gradient noise with period `per`. */
  noise(x: number, y: number, per: number): number {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
    const u = fade(xf), v = fade(yf);
    const P = this.perm;
    const X0 = ((xi % per) + per) % per, Y0 = ((yi % per) + per) % per;
    const X1 = (X0 + 1) % per, Y1 = (Y0 + 1) % per;
    const aa = P[P[X0] + Y0], ab = P[P[X0] + Y1], ba = P[P[X1] + Y0], bb = P[P[X1] + Y1];
    const x1 = this.grad(aa, xf, yf) + u * (this.grad(ba, xf - 1, yf) - this.grad(aa, xf, yf));
    const x2 = this.grad(ab, xf, yf - 1) + u * (this.grad(bb, xf - 1, yf - 1) - this.grad(ab, xf, yf - 1));
    return x1 + v * (x2 - x1);
  }
  fbm(x: number, y: number, per: number, oct = 4): number {
    let a = 0.5, f = 1, s = 0;
    for (let i = 0; i < oct; i++) {
      s += a * this.noise(x * f, y * f, per * f);
      a *= 0.5;
      f *= 2;
    }
    return s;
  }
}

export interface TexSet {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  roughnessMap: THREE.Texture;
}

let SIZE = 512;
export function setTextureSize(n: number): void {
  SIZE = n;
}

function toTextures(height: Float32Array, color: Float32Array, rough: Float32Array, strength: number): TexSet {
  const n = SIZE;
  const cData = new Uint8Array(n * n * 4);
  const nData = new Uint8Array(n * n * 4);
  const rData = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const i = y * n + x;
      const hl = height[y * n + ((x - 1 + n) % n)], hr = height[y * n + ((x + 1) % n)];
      const hu = height[((y - 1 + n) % n) * n + x], hd = height[((y + 1) % n) * n + x];
      let nx = (hl - hr) * strength, ny = (hu - hd) * strength;
      const nz = 1;
      const len = Math.hypot(nx, ny, nz);
      nx /= len;
      ny /= len;
      nData[i * 4] = (nx * 0.5 + 0.5) * 255;
      nData[i * 4 + 1] = (ny * 0.5 + 0.5) * 255;
      nData[i * 4 + 2] = (nz / len * 0.5 + 0.5) * 255;
      nData[i * 4 + 3] = 255;
      for (let c = 0; c < 3; c++) cData[i * 4 + c] = Math.max(0, Math.min(255, color[i * 3 + c] * 255));
      cData[i * 4 + 3] = 255;
      const r = Math.max(0, Math.min(255, rough[i] * 255));
      rData[i * 4] = r;
      rData[i * 4 + 1] = r;
      rData[i * 4 + 2] = r;
      rData[i * 4 + 3] = 255;
    }
  }
  const mk = (d: Uint8Array, srgb: boolean) => {
    const t = new THREE.DataTexture(d, n, n, THREE.RGBAFormat);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.magFilter = THREE.LinearFilter;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.generateMipmaps = true;
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  };
  return { map: mk(cData, true), normalMap: mk(nData, false), roughnessMap: mk(rData, false) };
}

/** Voronoi-ish cell distance for stone / cobble patterns (tileable). */
function cells(rng: RNG, count: number): [number, number][] {
  const pts: [number, number][] = [];
  for (let i = 0; i < count; i++) pts.push([rng.next(), rng.next()]);
  return pts;
}

function nearestTwo(pts: [number, number][], u: number, v: number): [number, number, number] {
  let d1 = 9, d2 = 9, id = 0;
  for (let k = 0; k < pts.length; k++) {
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const dx = pts[k][0] + ox - u, dy = pts[k][1] + oy - v;
        const d = dx * dx + dy * dy;
        if (d < d1) {
          d2 = d1;
          d1 = d;
          id = k;
        } else if (d < d2) d2 = d;
      }
    }
  }
  return [Math.sqrt(d1), Math.sqrt(d2), id];
}

function rgb(c: number): [number, number, number] {
  return [((c >> 16) & 255) / 255, ((c >> 8) & 255) / 255, (c & 255) / 255];
}

export function makeFloorTextures(style: FloorStyle, base: number, seed: number): TexSet {
  const n = SIZE;
  const rng = new RNG(seed);
  const nz = new Noise(seed);
  const H = new Float32Array(n * n), C = new Float32Array(n * n * 3), R = new Float32Array(n * n);
  const [br, bg, bb] = rgb(base);
  const pts = cells(rng, style === 'cobble' ? 22 : 10);
  const tint: number[] = Array.from({ length: 64 }, () => rng.range(0.82, 1.12));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const i = y * n + x;
      const grain = nz.fbm(u * 16, v * 16, 16, 4);
      const big = nz.fbm(u * 4, v * 4, 4, 3);
      let h = 0.5, shade = 1, rough = 0.85;
      if (style === 'slab' || style === 'tiles') {
        // texture covers 2x2 tiles: grid of slabs, 'tiles' uses 4x4 smaller tiles
        const cellsN = style === 'slab' ? 2 : 4;
        const gx = u * cellsN, gy = v * cellsN;
        const fx = gx - Math.floor(gx), fy = gy - Math.floor(gy);
        const id = (Math.floor(gx) + Math.floor(gy) * 7) & 63;
        const edge = Math.min(fx, fy, 1 - fx, 1 - fy);
        const groove = style === 'slab' ? 0.025 : 0.04;
        const bevel = Math.min(1, edge / groove);
        h = 0.35 + 0.5 * Math.sqrt(bevel) + grain * 0.15 + big * 0.1;
        shade = tint[id] * (0.75 + 0.25 * bevel);
        // cracks
        // worn centers and stains
        shade *= 0.92 + 0.08 * Math.min(1, edge * 6);
        if (edge < groove * 0.6) {
          shade *= 0.45;
          rough = 1;
        }
      } else if (style === 'cobble') {
        const [d1, d2, id] = nearestTwo(pts, u * 2 % 1, v * 2 % 1);
        const e = d2 - d1;
        h = Math.min(1, e * 9) * 0.7 + grain * 0.2 + 0.1;
        shade = tint[id & 63] * (0.6 + 0.4 * Math.min(1, e * 12));
      } else {
        // rough cave floor
        const [d1, d2] = nearestTwo(pts, u, v);
        const e = d2 - d1;
        h = 0.5 + big * 0.6 + grain * 0.3 + Math.min(1, e * 6) * 0.15;
        shade = 0.8 + big * 0.5 + grain * 0.2;
        rough = 0.75 + grain * 0.2;
      }
      // grime & moss/puddle tint
      const grime = nz.fbm(u * 3 + 11, v * 3 + 7, 3, 3);
      shade *= 1 - Math.max(0, grime) * 0.5;
      if (grime < -0.25) rough = 0.35; // damp spots
      H[i] = h;
      C[i * 3] = br * shade;
      C[i * 3 + 1] = bg * shade;
      C[i * 3 + 2] = bb * shade;
      R[i] = rough;
    }
  }
  return toTextures(H, C, R, style === 'rough' ? 5 : 7);
}

export function makeWallTextures(style: WallStyle, base: number, seed: number): TexSet {
  const n = SIZE;
  const rng = new RNG(seed + 99);
  const nz = new Noise(seed + 99);
  const H = new Float32Array(n * n), C = new Float32Array(n * n * 3), R = new Float32Array(n * n);
  const [br, bg, bb] = rgb(base);
  const tint: number[] = Array.from({ length: 128 }, () => rng.range(0.78, 1.15));
  const pts = cells(rng, 14);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const i = y * n + x;
      const grain = nz.fbm(u * 20, v * 20, 20, 3);
      const big = nz.fbm(u * 3, v * 3, 3, 3);
      let h = 0.5, shade = 1, rough = 0.9;
      if (style === 'brick' || style === 'block') {
        const rows = style === 'brick' ? 8 : 4;
        const cols = style === 'brick' ? 4 : 2;
        const ry = v * rows;
        const row = Math.floor(ry);
        const off = row % 2 ? 0.5 : 0;
        const rx = u * cols + off;
        const fx = rx - Math.floor(rx), fy = ry - row;
        const id = (Math.floor(rx) * 13 + row * 7) & 127;
        const mortar = style === 'brick' ? 0.07 : 0.04;
        const edge = Math.min(fx * (cols / rows) * 2, fy, (1 - fx) * (cols / rows) * 2, 1 - fy);
        const bevel = Math.min(1, edge / mortar);
        h = 0.3 + 0.55 * Math.sqrt(bevel) + grain * 0.12 + big * 0.08;
        shade = tint[id] * (0.7 + 0.3 * bevel);
        if (edge < mortar * 0.5) {
          shade *= 0.4;
          rough = 1;
        }
        // chipped corners
        const chip = nz.fbm(u * 10 + id, v * 10, 10, 2);
        if (chip > 0.32) {
          h -= 0.2;
          shade *= 0.8;
        }
      } else if (style === 'ice') {
        const [d1, d2] = nearestTwo(pts, u, v);
        const e = d2 - d1;
        h = 0.4 + big * 0.5 + Math.min(1, e * 8) * 0.3;
        shade = 0.85 + big * 0.4 + (e < 0.02 ? 0.4 : 0);
        rough = 0.15 + Math.max(0, grain) * 0.4;
      } else {
        // cave rock
        const [d1, d2] = nearestTwo(pts, u, v);
        const e = d2 - d1;
        h = 0.4 + big * 0.7 + grain * 0.3 + Math.min(1, e * 5) * 0.25;
        shade = 0.75 + big * 0.55 + grain * 0.2;
        rough = 0.85;
      }
      // vertical streaks of grime (v=0 top)
      const streak = nz.fbm(u * 24, v * 2, 24, 2);
      shade *= 1 - Math.max(0, streak) * 0.35 * v;
      H[i] = h;
      C[i * 3] = br * shade;
      C[i * 3 + 1] = bg * shade;
      C[i * 3 + 2] = bb * shade;
      R[i] = rough;
    }
  }
  return toTextures(H, C, R, style === 'cave' ? 5 : 8);
}

/** Animated emissive pattern for hazard pools. */
export function makeHazardTexture(kind: HazardKind, color: number, seed: number): THREE.Texture {
  const n = 256;
  const nz = new Noise(seed + 7);
  const data = new Uint8Array(n * n * 4);
  const [r, g, b] = rgb(color);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const u = x / n, v = y / n;
      const i = (y * n + x) * 4;
      let f = nz.fbm(u * 4, v * 4, 4, 5);
      if (kind === 'lava') {
        const cr = Math.abs(nz.fbm(u * 6 + 3, v * 6, 6, 4));
        f = Math.pow(1 - Math.min(1, cr * 5), 3) * 0.9 + 0.25 + f * 0.3;
      } else if (kind === 'water' || kind === 'ice') {
        const caust = Math.abs(nz.fbm(u * 8, v * 8, 8, 3));
        f = 0.3 + Math.pow(1 - Math.min(1, caust * 4), 4) * 0.7;
      } else {
        f = 0.4 + Math.max(0, f) * 1.4 + Math.pow(Math.abs(nz.fbm(u * 10, v * 10, 10, 2)), 0.5) * 0.2;
      }
      data[i] = Math.min(255, r * f * 255 * 1.2);
      data[i + 1] = Math.min(255, g * f * 255 * 1.2);
      data[i + 2] = Math.min(255, b * f * 255 * 1.2);
      data[i + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** Soft round sprite used by particles. */
export function makeGlowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.7)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  return t;
}
