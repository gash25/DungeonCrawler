import * as THREE from 'three';
import type { Biome, DecorKind } from '../game/theme';
import { T, type Feature, type FloorData, type Rarity } from '../game/types';
import { RNG } from '../game/rng';
import type { Fx } from './fx';
import { patchMaterial } from './materials';
import { makeFloorTextures, makeHazardTexture, makeWallTextures } from './textures';
import { buildMerchant, type Rig } from './models';

export const WALL_H = 2.1;

export const RARITY_COLOR: Record<Rarity, number> = {
  common: 0xd8d0c0, magic: 0x5a9aff, rare: 0xffd040, epic: 0xc060ff, artifact: 0xff7a20,
};

interface FeatureView {
  obj: THREE.Object3D;
  lid?: THREE.Object3D;
  glow?: THREE.Mesh;
  light?: THREE.PointLight;
  open?: number;
}

export class WorldView {
  readonly group = new THREE.Group();
  private torchSpots: THREE.Vector3[] = [];
  private flameSpots: { pos: THREE.Vector3; color: number; big: boolean }[] = [];
  private torchLights: THREE.PointLight[] = [];
  private hazardMat: THREE.MeshStandardMaterial | null = null;
  private hazardTiles: THREE.Vector3[] = [];
  private featureViews = new Map<number, FeatureView>();
  private stairs: THREE.Group;
  private stairsLight: THREE.PointLight;
  private stairsRing: THREE.Mesh;
  private time = 0;
  private emitAcc = 0;
  merchant: Rig | null = null;
  private disposables: { dispose(): void }[] = [];

  constructor(private floor: FloorData, private biome: Biome, seed: number, private fx: Fx, quality: 'low' | 'high') {
    const { w, h, tiles } = floor;
    const rng = new RNG(seed);
    const shadows = quality === 'high';

    // ---- materials
    const floorTex = makeFloorTextures(biome.floorStyle, biome.floor, seed);
    const wallTex = makeWallTextures(biome.wallStyle, biome.wall, seed);
    for (const t of [floorTex, wallTex]) this.disposables.push(t.map, t.normalMap, t.roughnessMap);
    const floorMat = patchMaterial(new THREE.MeshStandardMaterial({
      map: floorTex.map, normalMap: floorTex.normalMap, roughnessMap: floorTex.roughnessMap, roughness: 1, metalness: 0.05,
      normalScale: new THREE.Vector2(1.2, 1.2),
    }), { fow: true, worldUv: 0.5 });
    const wallSide = patchMaterial(new THREE.MeshStandardMaterial({
      map: wallTex.map, normalMap: wallTex.normalMap, roughnessMap: wallTex.roughnessMap, roughness: 1, color: biome.wallStyle === 'ice' ? 0x9aa4b0 : 0xd0d0d0,
      metalness: biome.wallStyle === 'ice' ? 0.2 : 0.02, normalScale: new THREE.Vector2(1.4, 1.4),
    }), { fow: true, worldUv: 0.5, cutout: true });
    const wallTop = patchMaterial(new THREE.MeshStandardMaterial({
      map: wallTex.map, color: 0x161616, roughness: 1,
    }), { fow: true, worldUv: 0.5, cutout: true });
    this.disposables.push(floorMat, wallSide, wallTop);

    // ---- floor tiles
    let nFloor = 0, nWall = 0, nHaz = 0;
    const isWall = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || tiles[y * w + x] === T.Wall;
    const pillarSet = new Set(floor.features.filter((f) => f.kind === 'pillar').map((f) => f.y * w + f.x));
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        if (t === T.Floor || (t === T.Stairs) || pillarSet.has(y * w + x)) nFloor++;
        else if (t === T.Hazard) nHaz++;
        else if (t === T.Wall && !pillarSet.has(y * w + x)) {
          let edge = false;
          for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWall(x + dx, y + dy)) { edge = true; break; }
          if (edge) nWall++;
        }
      }
    }
    const floorGeo = new THREE.BoxGeometry(1, 0.3, 1);
    const floorMesh = new THREE.InstancedMesh(floorGeo, floorMat, nFloor);
    floorMesh.receiveShadow = true;
    const wallGeo = new THREE.BoxGeometry(1, WALL_H, 1);
    const wallMesh = new THREE.InstancedMesh(wallGeo, [wallSide, wallSide, wallTop, wallTop, wallSide, wallSide], nWall);
    wallMesh.castShadow = false;
    wallMesh.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let fi = 0, wi = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tiles[y * w + x];
        const isPillar = pillarSet.has(y * w + x);
        if (t === T.Floor || isPillar) {
          const jitter = rng.range(-0.02, 0.012);
          m4.compose(new THREE.Vector3(x, -0.15 + jitter, y), q.identity(), new THREE.Vector3(1, 1, 1));
          floorMesh.setMatrixAt(fi, m4);
          const v = rng.range(0.8, 1.08);
          floorMesh.setColorAt(fi++, col.setRGB(v, v, v * rng.range(0.96, 1.04)));
        } else if (t === T.Stairs) {
          m4.compose(new THREE.Vector3(x, -10, y), q.identity(), new THREE.Vector3(0.001, 0.001, 0.001));
          floorMesh.setMatrixAt(fi, m4);
          floorMesh.setColorAt(fi++, col.setRGB(1, 1, 1));
        } else if (t === T.Hazard) {
          this.hazardTiles.push(new THREE.Vector3(x, 0, y));
        } else if (t === T.Wall) {
          let edge = false;
          for (let dy = -1; dy <= 1 && !edge; dy++) for (let dx = -1; dx <= 1; dx++) if (!isWall(x + dx, y + dy)) { edge = true; break; }
          if (!edge) continue;
          const rough = biome.wallStyle === 'cave' || biome.wallStyle === 'ice';
          const hh = 1 + (rough ? rng.range(-0.12, 0.25) : rng.range(-0.04, 0.08));
          if (rough) q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(-0.35, 0.35));
          else q.identity();
          const sxz = rough ? rng.range(1.02, 1.18) : 1;
          m4.compose(new THREE.Vector3(x, (WALL_H * hh) / 2 - 0.02, y), q, new THREE.Vector3(sxz, hh, sxz));
          wallMesh.setMatrixAt(wi, m4);
          const v = rng.range(0.82, 1.1);
          wallMesh.setColorAt(wi++, col.setRGB(v, v, v));
        }
      }
    }
    floorMesh.instanceMatrix.needsUpdate = true;
    wallMesh.instanceMatrix.needsUpdate = true;
    this.group.add(floorMesh, wallMesh);
    this.disposables.push(floorGeo, wallGeo);

    // ---- hazard pools
    if (nHaz > 0) {
      const htex = makeHazardTexture(biome.hazard, biome.hazardColor, seed);
      this.disposables.push(htex);
      const kind = biome.hazard;
      const emissiveI = kind === 'lava' ? 3.2 : kind === 'acid' ? 1.6 : kind === 'void' ? 2.2 : kind === 'water' ? 0.6 : 0.5;
      this.hazardMat = patchMaterial(new THREE.MeshStandardMaterial({
        color: kind === 'water' ? 0x0a2a30 : kind === 'ice' ? 0xa8d8f0 : 0x111111, emissive: 0xffffff, emissiveMap: htex, emissiveIntensity: emissiveI,
        roughness: kind === 'water' || kind === 'ice' ? 0.06 : 0.6, metalness: kind === 'ice' ? 0.3 : 0,
        transparent: kind === 'water', opacity: 0.92,
      }), { fow: true, worldUv: 0.25 });
      this.disposables.push(this.hazardMat);
      const hg = new THREE.BoxGeometry(1, 0.1, 1);
      const hm = new THREE.InstancedMesh(hg, this.hazardMat, nHaz);
      hm.receiveShadow = true;
      this.hazardTiles.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, -0.2, p.z), q.identity(), new THREE.Vector3(1, 1, 1));
        hm.setMatrixAt(i, m4);
      });
      this.group.add(hm);
      this.disposables.push(hg);
      // a basin under hazards so pools look sunken
      const bg = new THREE.BoxGeometry(1, 0.1, 1);
      const bm = new THREE.InstancedMesh(bg, floorMat, nHaz);
      this.hazardTiles.forEach((p, i) => {
        m4.compose(new THREE.Vector3(p.x, -0.42, p.z), q.identity(), new THREE.Vector3(1, 1, 1));
        bm.setMatrixAt(i, m4);
      });
      this.group.add(bm);
      this.disposables.push(bg);
      // pool glow lights (fixed count per floor)
      const centers = this.clusterCenters(3);
      for (const c of centers) {
        const l = new THREE.PointLight(biome.hazardColor, kind === 'lava' ? 14 : 6, 7, 2);
        l.position.set(c.x, 0.6, c.z);
        this.group.add(l);
      }
    }

    // ---- torch light pool (fixed size)
    for (let i = 0; i < 6; i++) {
      const l = new THREE.PointLight(biome.torch, 0, 8, 1.8);
      this.torchLights.push(l);
      this.group.add(l);
    }

    // ---- features
    const propMat = (color: number, rough = 0.7, metal = 0.1, emissive = 0, ei = 0) =>
      patchMaterial(new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity: ei }), { fow: true });
    const stoneMat = patchMaterial(new THREE.MeshStandardMaterial({ map: wallTex.map, normalMap: wallTex.normalMap, roughness: 0.9 }), { fow: true, worldUv: 0.5 });
    const ironMat = propMat(0x3a3a40, 0.45, 0.9);
    const woodMat = propMat(0x5a3a22, 0.8, 0.05);
    const goldMat = propMat(0xd8a84a, 0.3, 1);
    const flameColor = biome.torch;

    floor.features.forEach((f, index) => {
      const g = new THREE.Group();
      g.position.set(f.x, 0, f.y);
      const add = (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s: [number, number, number] = [1, 1, 1], r: [number, number, number] = [0, 0, 0], parent: THREE.Object3D = g) => {
        const m = new THREE.Mesh(geo, mat);
        m.position.set(...p);
        m.scale.set(...s);
        m.rotation.set(...r);
        m.castShadow = shadows;
        m.receiveShadow = true;
        parent.add(m);
        return m;
      };
      const view: FeatureView = { obj: g };
      switch (f.kind) {
        case 'torch': {
          const d = [[0, -1], [1, 0], [0, 1], [-1, 0]][f.dir ?? 0];
          g.position.set(f.x + d[0] * 0.56, 0, f.y + d[1] * 0.56);
          add(new THREE.BoxGeometry(0.08, 0.3, 0.08), ironMat, [0, 1.35, 0]);
          add(new THREE.CylinderGeometry(0.07, 0.04, 0.22, 8), woodMat, [d[0] * 0.08, 1.55, d[1] * 0.08], [1, 1, 1], [d[1] * 0.4, 0, -d[0] * 0.4]);
          const fl = add(new THREE.SphereGeometry(0.08, 8, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(flameColor).multiplyScalar(5) }), [d[0] * 0.12, 1.72, d[1] * 0.12], [1, 1.6, 1]);
          fl.castShadow = false;
          const p = new THREE.Vector3(f.x + d[0] * 0.7, 1.72, f.y + d[1] * 0.7);
          this.torchSpots.push(p);
          this.flameSpots.push({ pos: p, color: flameColor, big: false });
          break;
        }
        case 'brazier': {
          add(new THREE.CylinderGeometry(0.12, 0.2, 0.9, 10), ironMat, [0, 0.45, 0]);
          add(new THREE.CylinderGeometry(0.42, 0.25, 0.25, 12), ironMat, [0, 1.0, 0]);
          add(new THREE.SphereGeometry(0.26, 10, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff8a30).multiplyScalar(4) }), [0, 1.12, 0], [1, 0.4, 1]).castShadow = false;
          const p = new THREE.Vector3(f.x, 1.3, f.y);
          this.torchSpots.push(p);
          this.flameSpots.push({ pos: p, color: 0xff7a30, big: true });
          break;
        }
        case 'pillar': {
          add(new THREE.CylinderGeometry(0.32, 0.36, WALL_H + 0.2, 16), stoneMat, [0, WALL_H / 2, 0]);
          add(new THREE.BoxGeometry(0.85, 0.2, 0.85), stoneMat, [0, 0.1, 0]);
          add(new THREE.BoxGeometry(0.85, 0.2, 0.85), stoneMat, [0, WALL_H + 0.1, 0]);
          break;
        }
        case 'chest': {
          const trim = f.rarity === 'epic' ? propMat(0xc070ff, 0.3, 0.8, 0x8040ff, 1.5) : f.rarity === 'rare' ? goldMat : ironMat;
          add(new THREE.BoxGeometry(0.7, 0.42, 0.48), woodMat, [0, 0.21, 0]);
          add(new THREE.BoxGeometry(0.74, 0.06, 0.52), trim, [0, 0.4, 0]);
          add(new THREE.BoxGeometry(0.74, 0.06, 0.52), trim, [0, 0.03, 0]);
          const lid = new THREE.Group();
          lid.position.set(0, 0.42, -0.24);
          g.add(lid);
          add(new THREE.CylinderGeometry(0.24, 0.24, 0.7, 12, 1, false, 0, Math.PI), woodMat, [0, 0, 0.24], [1, 1, 1], [0, 0, Math.PI / 2], lid);
          add(new THREE.BoxGeometry(0.12, 0.14, 0.04), goldMat, [0, 0.0, 0.5], [1, 1, 1], [0, 0, 0], lid);
          const glow = add(new THREE.SphereGeometry(0.2, 10, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(RARITY_COLOR[f.rarity ?? 'common']).multiplyScalar(3), transparent: true, opacity: 0 }), [0, 0.5, 0], [1.4, 0.4, 0.9]);
          glow.castShadow = false;
          view.lid = lid;
          view.glow = glow;
          view.open = f.used ? 1 : 0;
          g.rotation.y = rng.pick([0, Math.PI / 2, Math.PI, -Math.PI / 2]);
          break;
        }
        case 'shrine': {
          const colors = [0xff3040, 0xffd040, 0x60a0ff, 0xb0b0b0];
          const c = colors[f.variant ?? 0];
          add(new THREE.CylinderGeometry(0.45, 0.55, 0.3, 8), stoneMat, [0, 0.15, 0]);
          add(new THREE.CylinderGeometry(0.16, 0.26, 1.3, 4), stoneMat, [0, 0.95, 0], [1, 1, 1], [0, Math.PI / 4, 0]);
          const crystal = add(new THREE.OctahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: f.used ? 0.1 : 3, roughness: 0.2 }), [0, 1.9, 0], [1, 1.6, 1]);
          crystal.castShadow = false;
          view.glow = crystal;
          if (!f.used) this.flameSpots.push({ pos: new THREE.Vector3(f.x, 1.9, f.y), color: c, big: false });
          break;
        }
        case 'fountain': {
          add(new THREE.CylinderGeometry(0.48, 0.52, 0.4, 20), stoneMat, [0, 0.2, 0]);
          add(new THREE.CylinderGeometry(0.1, 0.14, 0.9, 10), stoneMat, [0, 0.6, 0]);
          add(new THREE.CylinderGeometry(0.25, 0.2, 0.12, 14), stoneMat, [0, 1.05, 0]);
          const water = add(new THREE.CylinderGeometry(0.42, 0.42, 0.04, 20), new THREE.MeshStandardMaterial({ color: 0x103040, emissive: 0x40d0ff, emissiveIntensity: f.used ? 0.05 : 1.6, roughness: 0.05 }), [0, 0.38, 0]);
          water.castShadow = false;
          view.glow = water;
          break;
        }
        case 'trap': {
          const plate = add(new THREE.BoxGeometry(0.7, 0.04, 0.7), ironMat, [0, 0.01, 0]);
          const rune = add(new THREE.RingGeometry(0.14, 0.2, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(f.variant === 1 ? 0xff5020 : f.variant === 2 ? 0xc040ff : 0xff2020).multiplyScalar(1.4) }), [0, 0.04, 0], [1, 1, 1], [-Math.PI / 2, 0, 0]);
          rune.castShadow = false;
          plate.receiveShadow = true;
          g.visible = !f.hidden;
          break;
        }
        case 'decor':
          this.buildDecor(g, biome.decor[f.variant ?? 0] ?? 'rubble', rng, add, propMat, stoneMat, f);
          break;
        case 'merchant': {
          this.merchant = buildMerchant();
          this.merchant.root.position.set(f.x, 0, f.y);
          this.group.add(this.merchant.root);
          break;
        }
        default:
      }
      this.group.add(g);
      this.featureViews.set(index, view);
    });

    // ---- stairs
    this.stairs = new THREE.Group();
    const s = floor.stairs;
    this.stairs.position.set(s.x, 0, s.y);
    const stepMat = stoneMat;
    for (let i = 0; i < 5; i++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.12, 0.18), stepMat);
      step.position.set(0, -0.08 - i * 0.16, -0.36 + i * 0.18);
      step.receiveShadow = true;
      this.stairs.add(step);
    }
    const pit = new THREE.Mesh(new THREE.BoxGeometry(0.98, 1.2, 0.98), new THREE.MeshBasicMaterial({ color: 0x000000, side: THREE.BackSide }));
    pit.position.y = -0.6;
    this.stairs.add(pit);
    const ringMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(biome.accent).multiplyScalar(3), transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    this.stairsRing = new THREE.Mesh(new THREE.RingGeometry(0.62, 0.72, 40), ringMat);
    this.stairsRing.rotation.x = -Math.PI / 2;
    this.stairsRing.position.y = 0.03;
    this.stairs.add(this.stairsRing);
    this.stairsLight = new THREE.PointLight(biome.accent, 0, 5, 2);
    this.stairsLight.position.y = 0.8;
    this.stairs.add(this.stairsLight);
    this.group.add(this.stairs);
    this.setStairsVisible(tiles[s.y * w + s.x] === T.Stairs);
  }

  private clusterCenters(max: number): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    const tiles = this.hazardTiles.slice();
    while (tiles.length && out.length < max) {
      const seed = tiles[0];
      const near = tiles.filter((t) => t.distanceTo(seed) < 4);
      const c = near.reduce((a, b) => a.add(b), new THREE.Vector3()).multiplyScalar(1 / near.length);
      out.push(c);
      for (const n of near) tiles.splice(tiles.indexOf(n), 1);
    }
    return out;
  }

  private buildDecor(
    g: THREE.Group, kind: DecorKind, rng: RNG,
    add: (geo: THREE.BufferGeometry, mat: THREE.Material, p: [number, number, number], s?: [number, number, number], r?: [number, number, number]) => THREE.Mesh,
    propMat: (c: number, r?: number, m?: number, e?: number, ei?: number) => THREE.Material,
    stoneMat: THREE.Material, f: Feature,
  ): void {
    const ox = rng.range(-0.25, 0.25), oz = rng.range(-0.25, 0.25);
    g.rotation.y = (f.dir ?? 0) * (Math.PI / 2) + rng.range(-0.4, 0.4);
    const boneMat = propMat(0xd8d0b8, 0.7);
    switch (kind) {
      case 'bones':
        for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(0.025, 0.03, rng.range(0.25, 0.45), 6), boneMat, [ox + rng.range(-0.2, 0.2), 0.03, oz + rng.range(-0.2, 0.2)], [1, 1, 1], [Math.PI / 2, rng.range(0, 3), 0]);
        break;
      case 'skull':
        add(new THREE.SphereGeometry(0.11, 12, 8), boneMat, [ox, 0.1, oz], [1, 0.9, 1.1]);
        add(new THREE.BoxGeometry(0.12, 0.06, 0.1), boneMat, [ox, 0.03, oz + 0.06]);
        for (let i = 0; i < 3; i++) add(new THREE.CylinderGeometry(0.02, 0.025, 0.3, 6), boneMat, [ox + rng.range(-0.2, 0.2), 0.02, oz + rng.range(-0.2, 0.2)], [1, 1, 1], [Math.PI / 2, rng.range(0, 3), 0]);
        break;
      case 'rubble':
        for (let i = 0; i < 5; i++) {
          const s = rng.range(0.08, 0.2);
          add(new THREE.DodecahedronGeometry(s, 0), stoneMat, [ox + rng.range(-0.25, 0.25), s * 0.6, oz + rng.range(-0.25, 0.25)], [1, rng.range(0.6, 1), 1], [rng.range(0, 3), rng.range(0, 3), 0]);
        }
        break;
      case 'crystal': {
        const c = this.biome.accent;
        for (let i = 0; i < rng.int(2, 4); i++) {
          const hh = rng.range(0.3, 0.8);
          const m = add(new THREE.OctahedronGeometry(0.12, 0), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.6, roughness: 0.15, metalness: 0.1 }), [ox + rng.range(-0.15, 0.15), hh / 2, oz + rng.range(-0.15, 0.15)], [1, hh * 4, 1], [rng.range(-0.3, 0.3), 0, rng.range(-0.3, 0.3)]);
          m.castShadow = false;
        }
        this.flameSpots.push({ pos: new THREE.Vector3(f.x + ox, 0.5, f.y + oz), color: c, big: false });
        break;
      }
      case 'mushroom': {
        const c = rng.pick([0xc070ff, 0x60ffc0, 0xff70b0, this.biome.accent]);
        for (let i = 0; i < rng.int(2, 5); i++) {
          const hh = rng.range(0.15, 0.6);
          const px = ox + rng.range(-0.25, 0.25), pz = oz + rng.range(-0.25, 0.25);
          add(new THREE.CylinderGeometry(0.03, 0.05, hh, 8), propMat(0xe0d8c8, 0.8), [px, hh / 2, pz]);
          const cap = add(new THREE.SphereGeometry(0.1 + hh * 0.25, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 1.4, roughness: 0.5 }), [px, hh, pz]);
          cap.castShadow = false;
        }
        this.flameSpots.push({ pos: new THREE.Vector3(f.x + ox, 0.4, f.y + oz), color: 0xc8ff90, big: false });
        break;
      }
      case 'candles':
        for (let i = 0; i < rng.int(3, 6); i++) {
          const hh = rng.range(0.08, 0.3);
          const px = ox + rng.range(-0.2, 0.2), pz = oz + rng.range(-0.2, 0.2);
          add(new THREE.CylinderGeometry(0.03, 0.03, hh, 8), propMat(0xe8e0c8, 0.6), [px, hh / 2, pz]);
          add(new THREE.SphereGeometry(0.025, 6, 4), new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffb050).multiplyScalar(5) }), [px, hh + 0.04, pz], [1, 1.8, 1]).castShadow = false;
        }
        break;
      case 'coral':
        for (let i = 0; i < 4; i++) {
          const c = rng.pick([0xff7a6a, 0xffa040, 0x40d0c0]);
          add(new THREE.ConeGeometry(0.05, rng.range(0.25, 0.55), 6), propMat(c, 0.7, 0, c, 0.3), [ox + rng.range(-0.2, 0.2), 0.2, oz + rng.range(-0.2, 0.2)], [1, 1, 1], [rng.range(-0.4, 0.4), 0, rng.range(-0.4, 0.4)]);
        }
        break;
      case 'rune': {
        const c = this.biome.accent;
        const m = add(new THREE.RingGeometry(0.22, 0.32, 6), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(2), transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), [ox, 0.02, oz], [1, 1, 1], [-Math.PI / 2, 0, 0]);
        m.castShadow = false;
        break;
      }
      case 'urn': {
        const pts: THREE.Vector2[] = [];
        for (let i = 0; i <= 10; i++) {
          const t = i / 10;
          pts.push(new THREE.Vector2(0.1 + Math.sin(t * Math.PI) * 0.12 - (t > 0.85 ? 0.04 : 0), t * 0.5));
        }
        add(new THREE.LatheGeometry(pts, 14), propMat(rng.pick([0x8a4a2a, 0x6a6a5a, 0x4a5a6a]), 0.6, 0.1), [ox, 0, oz]);
        break;
      }
      case 'chains':
        for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.05, 0.015, 6, 12), propMat(0x4a4a50, 0.4, 0.9), [ox + i * 0.07, 0.02, oz], [1, 1, 1], [Math.PI / 2, 0, i % 2 ? 0 : Math.PI / 2]);
        break;
    }
  }

  setStairsVisible(v: boolean): void {
    this.stairs.visible = v;
    this.stairsLight.intensity = v ? 6 : 0;
  }

  onFeature(index: number, f: Feature): void {
    const v = this.featureViews.get(index);
    if (!v) return;
    if (f.kind === 'trap') v.obj.visible = !f.hidden;
    if (f.kind === 'shrine' && v.glow) {
      ((v.glow.material as THREE.MeshStandardMaterial)).emissiveIntensity = 0.1;
      this.flameSpots = this.flameSpots.filter((s) => !(Math.abs(s.pos.x - f.x) < 0.01 && Math.abs(s.pos.z - f.y) < 0.01));
    }
    if (f.kind === 'fountain' && v.glow) (v.glow.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.05;
  }

  hideFeature(index: number): void {
    const v = this.featureViews.get(index);
    if (v) v.obj.visible = false;
  }

  update(dt: number, player: THREE.Vector3, visibleAt: (x: number, y: number) => number): void {
    this.time += dt;
    const t = this.time;
    if (this.hazardMat?.emissiveMap) {
      const off = this.hazardMat.emissiveMap.offset;
      off.x = Math.sin(t * 0.05) * 0.2 + t * 0.01;
      off.y = t * 0.015;
      if (this.biome.hazard === 'lava') this.hazardMat.emissiveIntensity = 3.2 + Math.sin(t * 1.3) * 0.5;
    }
    // assign torch lights to nearest visible torches
    const spots = this.torchSpots
      .filter((s) => visibleAt(Math.round(s.x), Math.round(s.z)) > 0.05)
      .sort((a, b) => a.distanceToSquared(player) - b.distanceToSquared(player));
    for (let i = 0; i < this.torchLights.length; i++) {
      const l = this.torchLights[i];
      const s = spots[i];
      if (s) {
        l.position.copy(s);
        const flick = 0.82 + Math.sin(t * 13 + i * 3.1) * 0.08 + Math.sin(t * 27 + i) * 0.06 + Math.random() * 0.05;
        l.intensity = 14 * flick * Math.min(1, visibleAt(Math.round(s.x), Math.round(s.z)) * 1.5);
      } else l.intensity = 0;
    }
    // flame particles near the player
    this.emitAcc += dt;
    if (this.emitAcc > 0.045) {
      this.emitAcc = 0;
      for (const f of this.flameSpots) {
        if (f.pos.distanceToSquared(player) > 200) continue;
        const vis = visibleAt(Math.round(f.pos.x), Math.round(f.pos.z));
        if (vis < 0.5) continue;
        this.fx.particles.emit(f.pos, {
          count: f.big ? 3 : 1, color: f.color, color2: 0xffe0a0, speed: 0.15, spread: 1, up: f.big ? 1.2 : 0.7,
          life: [0.3, 0.7], size: f.big ? [0.2, 0.4] : [0.1, 0.22], gravity: -0.6, radius: f.big ? 0.15 : 0.04, intensity: 3,
        });
      }
      // hazard bubbles / sparks
      if (this.hazardTiles.length && Math.random() < 0.6) {
        const h = this.hazardTiles[(Math.random() * this.hazardTiles.length) | 0];
        if (h.distanceToSquared(player) < 160 && visibleAt(h.x, h.z) > 0.5) {
          const c = this.biome.hazardColor;
          this.fx.particles.emit(new THREE.Vector3(h.x + Math.random() - 0.5, 0, h.z + Math.random() - 0.5), {
            count: this.biome.hazard === 'lava' ? 3 : 1, color: c, color2: 0xffffff, speed: 0.3, up: this.biome.hazard === 'lava' ? 1.8 : 0.5,
            life: [0.4, 1.0], size: [0.06, 0.16], gravity: this.biome.hazard === 'lava' ? 2.5 : -0.2, intensity: this.biome.hazard === 'water' ? 0.6 : 3,
          });
        }
      }
      if (this.stairs.visible && visibleAt(this.floor.stairs.x, this.floor.stairs.y) > 0.5) {
        this.fx.particles.emit(new THREE.Vector3(this.floor.stairs.x, -0.2, this.floor.stairs.y), {
          count: 1, color: this.biome.accent, speed: 0.1, up: 0.8, life: [0.6, 1.2], size: [0.06, 0.14], gravity: -0.3, radius: 0.4, intensity: 3,
        });
      }
    }
    this.stairsRing.rotation.z = t * 0.4;
    (this.stairsRing.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.sin(t * 2) * 0.25;
    // chest lids & shrine crystals
    this.featureViews.forEach((v, idx) => {
      const f = this.floor.features[idx];
      if (f.kind === 'chest' && v.lid) {
        const target = f.used ? 1 : 0;
        v.open = (v.open ?? 0) + (target - (v.open ?? 0)) * Math.min(1, dt * 6);
        v.lid.rotation.x = -v.open * 1.9;
        if (v.glow) (v.glow.material as THREE.MeshBasicMaterial).opacity = f.used ? Math.max(0, 1 - (v.open ?? 0)) * 0.9 : 0;
      }
      if (f.kind === 'shrine' && v.glow) {
        v.glow.rotation.y = t * 1.2;
        v.glow.position.y = 1.9 + Math.sin(t * 2 + idx) * 0.08;
      }
    });
    if (this.merchant) {
      this.merchant.body.position.y = Math.sin(t * 1.5) * 0.02;
      if (this.merchant.light) this.merchant.light.intensity = 5 + Math.sin(t * 9) * 0.6;
    }
  }

  dispose(): void {
    this.group.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry) m.geometry.dispose();
      const mat = m.material as THREE.Material | THREE.Material[] | undefined;
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
      else mat?.dispose();
    });
    for (const d of this.disposables) d.dispose();
  }
}
