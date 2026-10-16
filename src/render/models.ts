import * as THREE from 'three';
import { RNG } from '../game/rng';
import type { BodyPlan, ClassKey, MonsterDef } from '../game/types';

export interface Rig {
  root: THREE.Group; // positioned at tile; rotated to face
  body: THREE.Group; // bobbing / lunging part
  legs: THREE.Object3D[];
  arms: THREE.Object3D[];
  spin: THREE.Object3D[]; // continuously rotating parts
  mats: THREE.MeshStandardMaterial[]; // for hit flash
  height: number;
  floating: boolean;
  light?: THREE.PointLight;
}

const geoCache = new Map<string, THREE.BufferGeometry>();
function geo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  let g = geoCache.get(key) as T | undefined;
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

const G = {
  sphere: () => geo('sphere', () => new THREE.SphereGeometry(0.5, 24, 16)),
  lowSphere: () => geo('lowSphere', () => new THREE.IcosahedronGeometry(0.5, 1)),
  capsule: () => geo('capsule', () => new THREE.CapsuleGeometry(0.5, 1, 6, 14)),
  box: () => geo('box', () => new THREE.BoxGeometry(1, 1, 1)),
  rbox: () => geo('rbox', () => roundedBox(1, 1, 1, 0.12)),
  cyl: () => geo('cyl', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 16)),
  cone: () => geo('cone', () => new THREE.ConeGeometry(0.5, 1, 16)),
  cone4: () => geo('cone4', () => new THREE.ConeGeometry(0.5, 1, 4)),
  torus: () => geo('torus', () => new THREE.TorusGeometry(0.5, 0.08, 8, 32)),
  octa: () => geo('octa', () => new THREE.OctahedronGeometry(0.5, 0)),
  robe: () => geo('robe', () => new THREE.CylinderGeometry(0.22, 0.5, 1, 18, 1, true)),
};

function roundedBox(w: number, h: number, d: number, r: number): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d, 4, 4, 4);
  const pos = g.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  const inner = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const c = new THREE.Vector3(
      Math.max(-inner.x, Math.min(inner.x, v.x)),
      Math.max(-inner.y, Math.min(inner.y, v.y)),
      Math.max(-inner.z, Math.min(inner.z, v.z)),
    );
    const dir = v.clone().sub(c);
    if (dir.lengthSq() > 0) dir.normalize().multiplyScalar(r);
    pos.setXYZ(i, c.x + dir.x, c.y + dir.y, c.z + dir.z);
  }
  g.computeVertexNormals();
  return g;
}

class Builder {
  mats: THREE.MeshStandardMaterial[] = [];
  mat(color: number, rough = 0.6, metal = 0.1, emissive = 0, emissiveIntensity = 0, opts: Partial<THREE.MeshStandardMaterialParameters> = {}): THREE.MeshStandardMaterial {
    const m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, emissive, emissiveIntensity, ...opts });
    m.userData.baseEmissive = new THREE.Color(emissive);
    m.userData.baseEmissiveIntensity = emissiveIntensity;
    this.mats.push(m);
    return m;
  }
  glow(color: number, intensity = 3): THREE.MeshStandardMaterial {
    return this.mat(0x000000, 0.4, 0, color, intensity);
  }
  mesh(parent: THREE.Object3D, g: THREE.BufferGeometry, m: THREE.Material, pos: [number, number, number], scale: [number, number, number], rot: [number, number, number] = [0, 0, 0]): THREE.Mesh {
    const mesh = new THREE.Mesh(g, m);
    mesh.position.set(...pos);
    mesh.scale.set(...scale);
    mesh.rotation.set(...rot);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    parent.add(mesh);
    return mesh;
  }
}

function limb(b: Builder, parent: THREE.Object3D, m: THREE.Material, x: number, y: number, z: number, len: number, thick: number): THREE.Group {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, z);
  b.mesh(pivot, G.capsule(), m, [0, -len / 2, 0], [thick, len / 2, thick]);
  parent.add(pivot);
  return pivot;
}

function eyes(b: Builder, parent: THREE.Object3D, color: number, y: number, z: number, spread: number, size: number, count = 2): void {
  const m = b.glow(color, 6);
  for (let i = 0; i < count; i++) {
    const x = count === 1 ? 0 : (i / (count - 1) - 0.5) * spread * 2;
    b.mesh(parent, G.sphere(), m, [x, y, z], [size, size * 0.8, size * 0.6]).castShadow = false;
  }
}

// ---------------------------------------------------------------- player
export function buildPlayer(cls: ClassKey): Rig {
  const b = new Builder();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const skin = b.mat(0xd8a888, 0.7);
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  let cloth: THREE.MeshStandardMaterial;
  let accent: THREE.MeshStandardMaterial;
  const metal = b.mat(0xb8bcc4, 0.28, 0.95);
  const dark = b.mat(0x2a2420, 0.8, 0.1);
  const gold = b.mat(0xd8a84a, 0.3, 1);
  switch (cls) {
    case 'warrior': cloth = b.mat(0x7a1e1a, 0.75); accent = metal; break;
    case 'rogue': cloth = b.mat(0x1e3a2c, 0.85); accent = b.mat(0x3a3028, 0.7); break;
    case 'mage': cloth = b.mat(0x1e2e6a, 0.7); accent = gold; break;
    default: cloth = b.mat(0xe8e0cc, 0.75); accent = gold;
  }
  // legs
  legs.push(limb(b, body, dark, -0.11, 0.5, 0, 0.42, 0.11));
  legs.push(limb(b, body, dark, 0.11, 0.5, 0, 0.42, 0.11));
  // torso
  if (cls === 'mage' || cls === 'cleric') {
    b.mesh(body, G.robe(), cloth, [0, 0.45, 0], [0.62, 0.8, 0.62]);
  }
  b.mesh(body, G.capsule(), cls === 'warrior' ? metal : cloth, [0, 0.82, 0], [0.34, 0.22, 0.26]);
  b.mesh(body, G.cyl(), accent, [0, 0.62, 0], [0.36, 0.06, 0.28]); // belt
  // head
  const head = new THREE.Group();
  head.position.set(0, 1.22, 0);
  body.add(head);
  b.mesh(head, G.sphere(), skin, [0, 0, 0], [0.24, 0.27, 0.24]);
  // arms
  arms.push(limb(b, body, cls === 'warrior' ? metal : cloth, -0.24, 1.02, 0, 0.42, 0.1));
  arms.push(limb(b, body, cls === 'warrior' ? metal : cloth, 0.24, 1.02, 0, 0.42, 0.1));
  let light: THREE.PointLight | undefined;
  if (cls === 'warrior') {
    b.mesh(head, G.cyl(), metal, [0, 0.04, 0], [0.27, 0.26, 0.27]);
    b.mesh(head, G.box(), dark, [0, 0.02, 0.13], [0.2, 0.04, 0.04]);
    b.mesh(head, G.box(), cloth, [0, 0.24, -0.02], [0.04, 0.16, 0.3], [-0.2, 0, 0]);
    b.mesh(body, G.sphere(), metal, [-0.26, 1.08, 0], [0.18, 0.14, 0.18]);
    b.mesh(body, G.sphere(), metal, [0.26, 1.08, 0], [0.18, 0.14, 0.18]);
    // sword in right hand
    const sword = new THREE.Group();
    sword.position.set(0, -0.42, 0.05);
    arms[1].add(sword);
    b.mesh(sword, G.box(), metal, [0, 0, 0.36], [0.05, 0.02, 0.72]);
    b.mesh(sword, G.box(), gold, [0, 0, 0], [0.22, 0.04, 0.05]);
    b.mesh(sword, G.box(), b.glow(0xffb070, 1.2), [0, 0.012, 0.38], [0.012, 0.01, 0.62]).castShadow = false;
    // shield on left arm
    const shield = b.mesh(arms[0], G.cyl(), cloth, [-0.06, -0.25, 0.08], [0.42, 0.05, 0.42], [0, 0, Math.PI / 2]);
    b.mesh(shield, G.torus(), metal, [0, 0.5, 0], [0.95, 0.95, 4], [Math.PI / 2, 0, 0]);
    b.mesh(shield, G.sphere(), gold, [0, 0.55, 0], [0.25, 0.3, 0.25]);
  } else if (cls === 'rogue') {
    b.mesh(head, G.cone(), cloth, [0, 0.12, -0.03], [0.34, 0.5, 0.34]);
    b.mesh(head, G.box(), dark, [0, -0.02, 0.15], [0.26, 0.1, 0.06]);
    eyes(b, head, 0x9fffd0, 0.03, 0.2, 0.06, 0.03);
    b.mesh(body, G.cone(), cloth, [0, 0.72, -0.12], [0.5, 0.9, 0.2], [0.15, 0, 0]);
    for (const a of arms) {
      const dg = new THREE.Group();
      dg.position.set(0, -0.42, 0.05);
      a.add(dg);
      b.mesh(dg, G.cone4(), metal, [0, 0, 0.2], [0.05, 0.36, 0.02], [Math.PI / 2, 0, 0]);
      b.mesh(dg, G.box(), dark, [0, 0, -0.02], [0.04, 0.04, 0.12]);
    }
  } else if (cls === 'mage') {
    b.mesh(head, G.cone(), cloth, [0, 0.3, -0.03], [0.4, 0.62, 0.4], [-0.15, 0, 0]);
    b.mesh(head, G.cyl(), cloth, [0, 0.1, 0], [0.6, 0.03, 0.6]);
    b.mesh(head, G.cone(), b.mat(0xdddddd, 0.9), [0, -0.2, 0.12], [0.18, 0.3, 0.1], [Math.PI, 0, 0]);
    const staff = new THREE.Group();
    staff.position.set(0, -0.4, 0.05);
    arms[1].add(staff);
    b.mesh(staff, G.cyl(), b.mat(0x4a3020, 0.8), [0, 0.35, 0], [0.04, 1.5, 0.04]);
    const orb = b.mesh(staff, G.sphere(), b.glow(0x7ab0ff, 5), [0, 1.15, 0], [0.13, 0.13, 0.13]);
    orb.castShadow = false;
    const ring = b.mesh(staff, G.torus(), gold, [0, 1.15, 0], [0.32, 0.32, 0.32]);
    ring.rotation.x = Math.PI / 2;
    light = new THREE.PointLight(0x7ab0ff, 2.5, 4, 2);
    light.position.set(0, 1.15, 0);
    staff.add(light);
  } else {
    b.mesh(head, G.capsule(), cloth, [0, 0.03, -0.03], [0.28, 0.16, 0.28]);
    const halo = b.mesh(head, G.torus(), b.glow(0xffd070, 4), [0, 0.36, -0.05], [0.42, 0.42, 0.42], [Math.PI / 2 - 0.3, 0, 0]);
    halo.castShadow = false;
    b.mesh(body, G.box(), b.mat(0xc8a040, 0.4, 0.8), [0, 0.84, 0.15], [0.16, 0.36, 0.02]);
    const mace = new THREE.Group();
    mace.position.set(0, -0.42, 0.05);
    arms[1].add(mace);
    b.mesh(mace, G.cyl(), b.mat(0x5a4030, 0.7), [0, 0, 0.25], [0.04, 0.5, 0.04], [Math.PI / 2, 0, 0]);
    b.mesh(mace, G.octa(), gold, [0, 0, 0.52], [0.2, 0.2, 0.2]);
    light = new THREE.PointLight(0xffd080, 2, 4, 2);
    light.position.set(0, 1.6, 0);
    body.add(light);
  }
  for (const a of arms) a.rotation.x = -0.3;
  return { root, body, legs, arms, spin: [], mats: b.mats, height: 1.6, floating: false, light };
}

// ---------------------------------------------------------------- monsters
export function buildMonster(def: MonsterDef, elite: boolean): Rig {
  const b = new Builder();
  const rng = new RNG(def.seed);
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const legs: THREE.Object3D[] = [];
  const arms: THREE.Object3D[] = [];
  const spin: THREE.Object3D[] = [];
  const c = def.colors;
  const skin = b.mat(c.primary, rng.range(0.45, 0.8), rng.range(0, 0.3));
  const second = b.mat(c.secondary, 0.6, rng.range(0.1, 0.6));
  const darkMat = b.mat(0x1a1614, 0.85);
  const bone = b.mat(0xd8cfb8, 0.6);
  let height = 1.4;
  let floating = false;
  const plan: BodyPlan = def.body;

  if (plan === 'biped') {
    const hunch = rng.range(0, 0.35);
    legs.push(limb(b, body, darkMat, -0.14, 0.52, 0, 0.45, 0.13));
    legs.push(limb(b, body, darkMat, 0.14, 0.52, 0, 0.45, 0.13));
    const torso = new THREE.Group();
    torso.position.set(0, 0.55, 0);
    torso.rotation.x = hunch;
    body.add(torso);
    b.mesh(torso, G.capsule(), skin, [0, 0.35, 0], [0.42, 0.24, 0.3]);
    if (rng.chance(0.5)) b.mesh(torso, G.rbox(), second, [0, 0.38, 0.02], [0.5, 0.35, 0.36]);
    const head = new THREE.Group();
    head.position.set(0, 0.8, 0.06);
    torso.add(head);
    const skull = rng.chance(0.5);
    b.mesh(head, skull ? G.sphere() : G.rbox(), skull ? bone : skin, [0, 0, 0], [0.3, 0.3, 0.3]);
    eyes(b, head, c.eye, 0.03, 0.14, 0.07, 0.045);
    if (rng.chance(0.55)) {
      b.mesh(head, G.cone(), bone, [-0.13, 0.17, 0], [0.06, 0.3, 0.06], [0, 0, 0.5]);
      b.mesh(head, G.cone(), bone, [0.13, 0.17, 0], [0.06, 0.3, 0.06], [0, 0, -0.5]);
    }
    arms.push(limb(b, torso, skin, -0.3, 0.55, 0, 0.5, 0.11));
    arms.push(limb(b, torso, skin, 0.3, 0.55, 0, 0.5, 0.11));
    if (def.arch === 'archer') {
      const bow = b.mesh(arms[0], G.torus(), b.mat(0x5a3a20, 0.7), [0, -0.5, 0.1], [0.6, 0.9, 0.6], [0, Math.PI / 2, 0]);
      bow.scale.set(0.6, 0.9, 0.6);
    } else if (def.arch === 'caster') {
      const orb = b.mesh(arms[1], G.sphere(), b.glow(c.secondary, 5), [0, -0.55, 0.1], [0.14, 0.14, 0.14]);
      spin.push(orb);
    } else {
      const wpn = rng.pick(['club', 'blade', 'axe']);
      if (wpn === 'club') b.mesh(arms[1], G.cone(), b.mat(0x4a3424, 0.8), [0, -0.6, 0.15], [0.14, 0.6, 0.14], [Math.PI / 2.4, 0, 0]);
      else if (wpn === 'blade') b.mesh(arms[1], G.box(), b.mat(0x8a8e94, 0.3, 0.9), [0, -0.52, 0.32], [0.05, 0.03, 0.6]);
      else {
        b.mesh(arms[1], G.cyl(), b.mat(0x4a3424, 0.8), [0, -0.52, 0.25], [0.04, 0.6, 0.04], [Math.PI / 2, 0, 0]);
        b.mesh(arms[1], G.box(), b.mat(0x8a8e94, 0.3, 0.9), [0, -0.45, 0.5], [0.04, 0.25, 0.18]);
      }
    }
    if (rng.chance(0.4)) {
      for (const s of [-1, 1]) b.mesh(torso, G.cone(), bone, [s * 0.28, 0.6, 0], [0.08, 0.25, 0.08], [0, 0, -s * 0.6]);
    }
    height = 1.6;
  } else if (plan === 'beast') {
    const bodyLen = rng.range(0.7, 1.0);
    b.mesh(body, G.capsule(), skin, [0, 0.55, 0], [0.38, bodyLen / 2, 0.36], [Math.PI / 2, 0, 0]);
    for (const [x, z] of [[-0.16, 0.3], [0.16, 0.3], [-0.16, -0.3], [0.16, -0.3]]) legs.push(limb(b, body, skin, x, 0.5, z * bodyLen * 1.3, 0.45, 0.1));
    const head = new THREE.Group();
    head.position.set(0, 0.72, 0.55 * bodyLen + 0.12);
    body.add(head);
    b.mesh(head, G.capsule(), skin, [0, 0, 0.05], [0.3, 0.12, 0.28], [Math.PI / 2, 0, 0]);
    const jaw = b.mesh(head, G.box(), second, [0, -0.1, 0.12], [0.22, 0.06, 0.3]);
    arms.push(jaw);
    eyes(b, head, c.eye, 0.08, 0.2, 0.09, 0.04);
    for (let i = 0; i < 4; i++) b.mesh(head, G.cone(), bone, [(i - 1.5) * 0.05, -0.05, 0.27], [0.025, 0.08, 0.025], [Math.PI, 0, 0]);
    b.mesh(body, G.cone(), skin, [0, 0.62, -0.62 * bodyLen], [0.1, 0.6, 0.1], [-Math.PI / 2.6, 0, 0]);
    const spikes = rng.int(0, 5);
    for (let i = 0; i < spikes; i++) b.mesh(body, G.cone(), second, [0, 0.85, (i / Math.max(1, spikes - 1) - 0.5) * bodyLen * 0.8], [0.06, 0.22, 0.06]);
    height = 1.0;
  } else if (plan === 'blob') {
    const gel = b.mat(c.primary, 0.12, 0.05, c.primary, 0.35, { transparent: true, opacity: 0.78 });
    const blob = b.mesh(body, G.sphere(), gel, [0, 0.38, 0], [0.85, 0.7, 0.85]);
    blob.castShadow = true;
    arms.push(blob);
    const core = b.mesh(body, G.lowSphere(), b.glow(c.secondary, 2.5), [0, 0.38, 0], [0.28, 0.28, 0.28]);
    spin.push(core);
    eyes(b, body, c.eye, 0.55, 0.36, 0.12, 0.06);
    for (let i = 0; i < 4; i++) {
      const bub = b.mesh(body, G.sphere(), gel, [rng.range(-0.3, 0.3), rng.range(0.15, 0.6), rng.range(-0.3, 0.3)], [0.12, 0.12, 0.12]);
      bub.castShadow = false;
    }
    height = 0.9;
  } else if (plan === 'floater') {
    floating = true;
    const eyeBall = new THREE.Group();
    eyeBall.position.set(0, 1.1, 0);
    body.add(eyeBall);
    b.mesh(eyeBall, G.sphere(), skin, [0, 0, 0], [0.7, 0.7, 0.7]);
    b.mesh(eyeBall, G.sphere(), b.mat(0xf0e8e0, 0.2), [0, 0, 0.2], [0.42, 0.42, 0.36]);
    b.mesh(eyeBall, G.sphere(), b.glow(c.eye, 5), [0, 0, 0.37], [0.2, 0.2, 0.1]);
    b.mesh(eyeBall, G.sphere(), b.mat(0x000000, 0.1), [0, 0, 0.42], [0.08, 0.12, 0.04]);
    const ring = new THREE.Group();
    ring.position.set(0, 1.1, 0);
    body.add(ring);
    spin.push(ring);
    const n = rng.int(4, 7);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      b.mesh(ring, G.cone(), second, [Math.cos(a) * 0.45, -0.35, Math.sin(a) * 0.45], [0.06, 0.7, 0.06], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5 + Math.PI]);
    }
    const halo = b.mesh(ring, G.torus(), b.glow(c.secondary, 2), [0, 0, 0], [1.1, 1.1, 1.1], [Math.PI / 2, 0, 0]);
    halo.castShadow = false;
    arms.push(eyeBall);
    height = 1.6;
  } else if (plan === 'spider') {
    b.mesh(body, G.sphere(), skin, [0, 0.42, 0.18], [0.36, 0.3, 0.38]);
    const abdomen = b.mesh(body, G.sphere(), second, [0, 0.5, -0.3], [0.55, 0.48, 0.6]);
    arms.push(abdomen);
    if (rng.chance(0.6)) b.mesh(abdomen, G.sphere(), b.glow(c.eye, 2), [0, 0.35, -0.1], [0.3, 0.12, 0.4]).castShadow = false;
    eyes(b, body, c.eye, 0.5, 0.36, 0.1, 0.035, 4);
    for (let i = 0; i < 8; i++) {
      const side = i < 4 ? -1 : 1;
      const k = i % 4;
      const pivot = new THREE.Group();
      pivot.position.set(side * 0.15, 0.45, 0.25 - k * 0.15);
      pivot.rotation.set(0, side * (0.4 - k * 0.35), 0);
      body.add(pivot);
      const upper = b.mesh(pivot, G.capsule(), darkMat, [side * 0.22, 0.12, 0], [0.04, 0.2, 0.04], [0, 0, side * 1.1]);
      upper.castShadow = true;
      b.mesh(pivot, G.capsule(), darkMat, [side * 0.46, -0.12, 0], [0.035, 0.22, 0.035], [0, 0, -side * 0.5]);
      legs.push(pivot);
    }
    height = 0.8;
  } else if (plan === 'wraith') {
    floating = true;
    const robe = b.mat(c.primary, 0.9, 0, c.secondary, 0.25, { transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    b.mesh(body, G.robe(), robe, [0, 0.85, 0], [0.75, 1.3, 0.75]);
    const head = new THREE.Group();
    head.position.set(0, 1.6, 0.02);
    body.add(head);
    b.mesh(head, G.cone(), robe, [0, 0.12, -0.04], [0.42, 0.55, 0.42]);
    b.mesh(head, G.sphere(), b.mat(0x050505, 1), [0, 0, 0.06], [0.24, 0.26, 0.2]);
    eyes(b, head, c.eye, 0.0, 0.15, 0.06, 0.04);
    arms.push(limb(b, body, robe, -0.32, 1.4, 0.05, 0.6, 0.08));
    arms.push(limb(b, body, robe, 0.32, 1.4, 0.05, 0.6, 0.08));
    for (const a of arms) b.mesh(a, G.cone(), bone, [0, -0.66, 0.05], [0.08, 0.2, 0.08], [Math.PI, 0, 0]);
    height = 1.9;
  } else {
    // golem
    const stone = b.mat(c.primary, 0.85, 0.05);
    const rune = b.glow(c.eye, 3);
    legs.push(limb(b, body, stone, -0.2, 0.55, 0, 0.42, 0.18));
    legs.push(limb(b, body, stone, 0.2, 0.55, 0, 0.42, 0.18));
    b.mesh(body, G.rbox(), stone, [0, 0.95, 0], [0.8, 0.65, 0.55]);
    b.mesh(body, G.box(), rune, [0, 1.0, 0.28], [0.12, 0.3, 0.02]).castShadow = false;
    b.mesh(body, G.rbox(), stone, [0, 1.42, 0.05], [0.36, 0.3, 0.34]);
    eyes(b, body, c.eye, 1.45, 0.22, 0.08, 0.05);
    for (const s of [-1, 1]) {
      const arm = new THREE.Group();
      arm.position.set(s * 0.52, 1.18, 0);
      body.add(arm);
      b.mesh(arm, G.rbox(), stone, [0, -0.3, 0], [0.24, 0.6, 0.24]);
      b.mesh(arm, G.rbox(), stone, [0, -0.7, 0.05], [0.34, 0.32, 0.34]);
      arms.push(arm);
    }
    if (rng.chance(0.5)) for (let i = 0; i < 3; i++) b.mesh(body, G.octa(), b.glow(c.secondary, 2), [rng.range(-0.3, 0.3), 1.3 + rng.range(0, 0.2), -0.25], [0.12, 0.2, 0.12]);
    height = 1.8;
  }

  let light: THREE.PointLight | undefined;
  if (elite || def.boss) {
    const aura = b.mesh(root, G.torus(), b.glow(def.boss ? 0xff3020 : c.eye, def.boss ? 3 : 2), [0, 0.04, 0], [1.3, 1.3, 1.3], [Math.PI / 2, 0, 0]);
    aura.castShadow = false;
    spin.push(aura);
  }
  if (def.boss) {
    light = new THREE.PointLight(c.eye, 6, 7, 2);
    light.position.set(0, height * 0.8, 0.4);
    body.add(light);
    // crown of spikes
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.mesh(body, G.cone(), b.mat(0x1a1010, 0.4, 0.8), [Math.cos(a) * 0.2, height + 0.05, Math.sin(a) * 0.2], [0.07, 0.35, 0.07], [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]);
    }
  }
  return { root, body, legs, arms, spin, mats: b.mats, height, floating, light };
}

// ---------------------------------------------------------------- merchant
export function buildMerchant(): Rig {
  const b = new Builder();
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const robe = b.mat(0x4a2a5a, 0.85);
  b.mesh(body, G.robe(), robe, [0, 0.55, 0], [0.8, 1.1, 0.8]);
  b.mesh(body, G.capsule(), robe, [0, 1.1, -0.15], [0.42, 0.3, 0.42], [0.6, 0, 0]);
  const head = new THREE.Group();
  head.position.set(0, 1.25, 0.05);
  body.add(head);
  b.mesh(head, G.cone(), robe, [0, 0.15, 0], [0.4, 0.55, 0.4]);
  b.mesh(head, G.sphere(), b.mat(0x050505, 1), [0, 0, 0.08], [0.22, 0.24, 0.2]);
  eyes(b, head, 0xffd060, 0, 0.16, 0.06, 0.035);
  const lantern = new THREE.Group();
  lantern.position.set(0.4, 0.9, 0.3);
  body.add(lantern);
  b.mesh(lantern, G.cyl(), b.mat(0x2a2a2a, 0.5, 0.8), [0, 0, 0], [0.16, 0.24, 0.16]);
  b.mesh(lantern, G.sphere(), b.glow(0xffb040, 5), [0, 0, 0], [0.12, 0.16, 0.12]).castShadow = false;
  const light = new THREE.PointLight(0xffb050, 6, 6, 2);
  lantern.add(light);
  // pack of goods
  b.mesh(root, G.rbox(), b.mat(0x6a4a2a, 0.8), [-0.45, 0.25, -0.2], [0.5, 0.5, 0.45]);
  b.mesh(root, G.rbox(), b.mat(0x5a3a1a, 0.8), [-0.4, 0.62, -0.25], [0.35, 0.28, 0.3]);
  return { root, body, legs: [], arms: [], spin: [], mats: b.mats, height: 1.5, floating: false, light };
}
