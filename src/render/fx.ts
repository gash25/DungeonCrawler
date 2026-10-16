import * as THREE from 'three';
import type { DmgKind } from '../game/types';

export const KIND_COLOR: Record<DmgKind, number> = {
  phys: 0xffe0c0, fire: 0xff6a20, ice: 0x80d8ff, poison: 0x7aff40, holy: 0xffe080, arcane: 0xc070ff, lightning: 0xa0c8ff, shadow: 0x9a50ff,
};

const PVERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
uniform float uScale;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / -mv.z;
  gl_Position = projectionMatrix * mv;
}`;
const PFRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec2 c = gl_PointCoord - 0.5;
  float d = dot(c, c) * 4.0;
  if (d > 1.0) discard;
  float a = pow(1.0 - d, 2.0) * vAlpha;
  gl_FragColor = vec4(vColor * a, a);
}`;

export interface EmitOpts {
  count: number;
  color: number | THREE.Color;
  color2?: number;
  speed?: number;
  spread?: number; // horizontal randomness
  up?: number; // initial upward velocity
  life?: [number, number];
  size?: [number, number];
  gravity?: number;
  drag?: number;
  radius?: number; // spawn radius
  height?: number; // spawn height jitter
  intensity?: number; // HDR multiplier
}

export class Particles {
  readonly points: THREE.Points;
  private max: number;
  private pos: Float32Array;
  private col: Float32Array;
  private size: Float32Array;
  private alpha: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private maxLife: Float32Array;
  private baseSize: Float32Array;
  private grav: Float32Array;
  private drag: Float32Array;
  private cursor = 0;
  private geom: THREE.BufferGeometry;
  readonly mat: THREE.ShaderMaterial;

  constructor(max = 4000) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.baseSize = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.geom = new THREE.BufferGeometry();
    this.geom.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geom.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.mat = new THREE.ShaderMaterial({
      vertexShader: PVERT, fragmentShader: PFRAG, uniforms: { uScale: { value: 300 } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    this.points = new THREE.Points(this.geom, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
  }

  emit(at: THREE.Vector3, o: EmitOpts): void {
    const c1 = new THREE.Color(o.color);
    const c2 = new THREE.Color(o.color2 ?? (o.color as number));
    const inten = o.intensity ?? 2.5;
    const tmp = new THREE.Color();
    for (let n = 0; n < o.count; n++) {
      const i = this.cursor;
      this.cursor = (this.cursor + 1) % this.max;
      const r = (o.radius ?? 0.1) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      this.pos[i * 3] = at.x + Math.cos(a) * r;
      this.pos[i * 3 + 1] = at.y + (Math.random() - 0.5) * (o.height ?? 0.1);
      this.pos[i * 3 + 2] = at.z + Math.sin(a) * r;
      const sp = (o.speed ?? 1) * (0.4 + Math.random() * 0.6);
      const da = Math.random() * Math.PI * 2;
      const spread = o.spread ?? 1;
      this.vel[i * 3] = Math.cos(da) * sp * spread;
      this.vel[i * 3 + 1] = (o.up ?? 1) * (0.5 + Math.random() * 0.8);
      this.vel[i * 3 + 2] = Math.sin(da) * sp * spread;
      const [l0, l1] = o.life ?? [0.4, 0.9];
      this.maxLife[i] = this.life[i] = l0 + Math.random() * (l1 - l0);
      const [s0, s1] = o.size ?? [0.15, 0.35];
      this.baseSize[i] = s0 + Math.random() * (s1 - s0);
      this.grav[i] = o.gravity ?? 0;
      this.drag[i] = o.drag ?? 1.5;
      tmp.copy(c1).lerp(c2, Math.random()).multiplyScalar(inten);
      this.col[i * 3] = tmp.r;
      this.col[i * 3 + 1] = tmp.g;
      this.col[i * 3 + 2] = tmp.b;
    }
  }

  update(dt: number): void {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) {
        if (this.alpha[i] !== 0) {
          this.alpha[i] = 0;
          this.size[i] = 0;
        }
        continue;
      }
      this.life[i] -= dt;
      const k = Math.max(0, this.life[i] / this.maxLife[i]);
      const d = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= d;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * d - this.grav[i] * dt;
      this.vel[i * 3 + 2] *= d;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      if (this.pos[i * 3 + 1] < 0.02) {
        this.pos[i * 3 + 1] = 0.02;
        this.vel[i * 3 + 1] *= -0.3;
      }
      this.alpha[i] = Math.min(1, k * 2.5) * Math.min(1, (1 - k) * 12 + 0.2);
      this.size[i] = this.baseSize[i] * (0.5 + k * 0.5);
    }
    (this.geom.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aColor as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aSize as THREE.BufferAttribute).needsUpdate = true;
    (this.geom.attributes.aAlpha as THREE.BufferAttribute).needsUpdate = true;
  }

  clear(): void {
    this.life.fill(0);
  }
}

interface Projectile {
  mesh: THREE.Mesh;
  from: THREE.Vector3;
  to: THREE.Vector3;
  t: number;
  dur: number;
  kind: DmgKind;
  light: THREE.PointLight | null;
  delay: number;
}

interface Ring {
  mesh: THREE.Mesh;
  t: number;
  dur: number;
  radius: number;
}

/** Transient visual effects. Uses a fixed light pool so light count never changes (avoids shader recompiles). */
export class Fx {
  readonly group = new THREE.Group();
  readonly particles = new Particles();
  private projectiles: Projectile[] = [];
  private rings: Ring[] = [];
  private lights: THREE.PointLight[] = [];
  private lightLife: number[] = [];
  private lightMax: number[] = [];
  private projGeo = new THREE.SphereGeometry(0.12, 12, 8);
  private ringGeo = new THREE.RingGeometry(0.85, 1, 48);
  private boltGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true);
  private bolts: { mesh: THREE.Mesh; t: number }[] = [];

  constructor() {
    this.group.add(this.particles.points);
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 6, 2);
      this.group.add(l);
      this.lights.push(l);
      this.lightLife.push(0);
      this.lightMax.push(1);
    }
  }

  flash(pos: THREE.Vector3, color: number, intensity: number, dur = 0.35): THREE.PointLight {
    let idx = this.lightLife.indexOf(Math.min(...this.lightLife));
    if (idx < 0) idx = 0;
    const l = this.lights[idx];
    l.position.copy(pos);
    l.color.setHex(color);
    l.userData.peak = intensity;
    l.intensity = intensity;
    this.lightLife[idx] = dur;
    this.lightMax[idx] = dur;
    return l;
  }

  projectile(from: THREE.Vector3, to: THREE.Vector3, kind: DmgKind, delay = 0): number {
    const color = KIND_COLOR[kind];
    if (kind === 'lightning') {
      this.lightning(from, to);
      return 0.05;
    }
    const m = new THREE.Mesh(this.projGeo, new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(4), toneMapped: true }));
    m.position.copy(from);
    m.visible = delay <= 0;
    this.group.add(m);
    const dist = from.distanceTo(to);
    const dur = Math.max(0.12, dist / (kind === 'phys' ? 22 : 16));
    this.projectiles.push({ mesh: m, from: from.clone(), to: to.clone(), t: 0, dur, kind, light: null, delay });
    return dur + delay;
  }

  lightning(from: THREE.Vector3, to: THREE.Vector3): void {
    // jagged chain of thin cylinders
    const pts: THREE.Vector3[] = [from.clone()];
    const segs = 7;
    for (let i = 1; i < segs; i++) {
      const p = from.clone().lerp(to, i / segs);
      p.x += (Math.random() - 0.5) * 0.5;
      p.y += (Math.random() - 0.5) * 0.4;
      p.z += (Math.random() - 0.5) * 0.5;
      pts.push(p);
    }
    pts.push(to.clone());
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xb0d0ff).multiplyScalar(6), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const mesh = new THREE.Mesh(this.boltGeo, mat);
      mesh.position.copy(a).add(b).multiplyScalar(0.5);
      mesh.scale.set(1, a.distanceTo(b), 1);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
      this.group.add(mesh);
      this.bolts.push({ mesh, t: 0.22 });
    }
    this.flash(to, 0xa0c0ff, 25, 0.25);
    this.particles.emit(to, { count: 18, color: 0xc0e0ff, speed: 3, up: 1.5, life: [0.2, 0.5], size: [0.1, 0.22], gravity: 2, intensity: 4 });
  }

  ring(pos: THREE.Vector3, radius: number, kind: DmgKind): void {
    const color = KIND_COLOR[kind];
    const mat = new THREE.MeshBasicMaterial({
      color: new THREE.Color(color).multiplyScalar(3), transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
    });
    const mesh = new THREE.Mesh(this.ringGeo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.copy(pos).setY(0.06);
    this.group.add(mesh);
    const r = Math.max(0.6, radius + 0.5);
    this.rings.push({ mesh, t: 0, dur: 0.45, radius: r });
    const n = Math.round(20 + r * r * 14);
    this.particles.emit(pos.clone().setY(0.3), {
      count: n, color, color2: 0xffffff, speed: 2.2 * r, spread: 1, up: kind === 'fire' ? 2.4 : 1.2, life: [0.35, 0.9], size: [0.14, 0.36],
      gravity: kind === 'ice' ? 3 : kind === 'fire' ? -0.5 : 1, radius: 0.3, intensity: 3,
    });
    this.flash(pos.clone().setY(1), color, 18 + r * 8, 0.4);
  }

  burst(pos: THREE.Vector3, kind: DmgKind, count = 14): void {
    const color = KIND_COLOR[kind];
    this.particles.emit(pos, { count, color, color2: kind === 'phys' ? 0x801010 : 0xffffff, speed: 2.4, up: 1.6, life: [0.25, 0.6], size: [0.08, 0.2], gravity: 6, radius: 0.15, intensity: kind === 'phys' ? 1.2 : 3 });
  }

  update(dt: number): void {
    this.particles.update(dt);
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      if (p.delay > 0) {
        p.delay -= dt;
        if (p.delay <= 0) p.mesh.visible = true;
        continue;
      }
      p.t += dt;
      const k = Math.min(1, p.t / p.dur);
      p.mesh.position.lerpVectors(p.from, p.to, k);
      p.mesh.position.y += Math.sin(k * Math.PI) * (p.kind === 'phys' ? 0.25 : 0.4);
      const c = KIND_COLOR[p.kind];
      this.particles.emit(p.mesh.position, { count: 2, color: c, speed: 0.3, up: 0.3, life: [0.15, 0.35], size: [0.1, 0.22], intensity: 3 });
      if (k >= 1) {
        this.group.remove(p.mesh);
        (p.mesh.material as THREE.Material).dispose();
        this.burst(p.to, p.kind, 16);
        if (p.kind !== 'phys') this.flash(p.to, c, 14, 0.3);
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.t += dt;
      const k = r.t / r.dur;
      const s = r.radius * (0.2 + 0.8 * Math.sqrt(k));
      r.mesh.scale.set(s, s, s);
      (r.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, 1 - k);
      if (k >= 1) {
        this.group.remove(r.mesh);
        (r.mesh.material as THREE.Material).dispose();
        this.rings.splice(i, 1);
      }
    }
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      b.t -= dt;
      (b.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, b.t / 0.22);
      if (b.t <= 0) {
        this.group.remove(b.mesh);
        this.bolts.splice(i, 1);
      }
    }
    for (let i = 0; i < this.lights.length; i++) {
      if (this.lightLife[i] > 0) {
        this.lightLife[i] -= dt;
        const k = Math.max(0, this.lightLife[i] / this.lightMax[i]);
        this.lights[i].intensity = (this.lights[i].userData.peak ?? 10) * k * k;
      } else this.lights[i].intensity = 0;
    }
  }

  get busy(): boolean {
    return this.projectiles.length > 0;
  }

  clear(): void {
    for (const p of this.projectiles) this.group.remove(p.mesh);
    for (const r of this.rings) this.group.remove(r.mesh);
    for (const b of this.bolts) this.group.remove(b.mesh);
    this.projectiles = [];
    this.rings = [];
    this.bolts = [];
    this.particles.clear();
  }
}
