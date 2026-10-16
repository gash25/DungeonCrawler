import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import type { Game } from '../game/game';
import { biomeForDepth, type Biome } from '../game/theme';
import { T, type Actor, type GEvent, type Vec } from '../game/types';
import { Fx, KIND_COLOR } from './fx';
import { FowTexture, shared } from './materials';
import { buildMonster, buildPlayer, type Rig } from './models';
import { setTextureSize } from './textures';
import { RARITY_COLOR, WorldView } from './world';

export type Quality = 'low' | 'high';

interface ActorView {
  id: number;
  actor: Actor;
  rig: Rig;
  pos: THREE.Vector3;
  from: THREE.Vector3;
  to: THREE.Vector3;
  moveT: number;
  moveDur: number;
  mode: 'walk' | 'blink' | 'charge';
  yaw: number;
  yawTarget: number;
  lunge: number;
  flash: number;
  flashColor: THREE.Color;
  recoil: number;
  dying: number;
  hp: number;
  scale: number;
  shadow: THREE.Mesh;
  statusAcc: number;
  appear: number;
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uHurt: { value: 0 },
    uLowHp: { value: 0 },
    uTint: { value: new THREE.Color(1, 1, 1) },
    uAberration: { value: 0.00025 },
    uGrain: { value: 0.035 },
    uRes: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uHurt, uLowHp, uAberration, uGrain; uniform vec3 uTint; uniform vec2 uRes;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c,c);
      vec2 off = c * r2 * uAberration * 40.0;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      col *= uTint;
      float vig = smoothstep(0.85, 0.18, r2 * uVignette * 1.6);
      col *= mix(0.25, 1.0, vig);
      float pulse = 0.5 + 0.5 * sin(uTime * 4.0);
      float edge = smoothstep(0.12, 0.45, r2);
      col = mix(col, vec3(0.6, 0.02, 0.02) * (0.5 + col), edge * clamp(uHurt + uLowHp * pulse * 0.6, 0.0, 0.85));
      col += (hash(vUv * uRes + fract(uTime) * 100.0) - 0.5) * uGrain * (0.3 + dot(col, vec3(0.33)));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }`,
};

const TELE_VERT = /* glsl */ `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position,1.0); }`;
const TELE_FRAG = /* glsl */ `
  uniform float uTime; uniform vec3 uColor; varying vec2 vUv;
  void main(){
    vec2 c = abs(vUv - 0.5) * 2.0;
    float e = max(c.x, c.y);
    float border = smoothstep(0.75, 0.95, e);
    float pulse = 0.55 + 0.45 * sin(uTime * 8.0);
    float stripes = step(0.5, fract((vUv.x + vUv.y) * 4.0 - uTime * 1.5)) * 0.25;
    float a = (border * 0.9 + 0.25 + stripes) * pulse;
    gl_FragColor = vec4(uColor * a * 2.5, a);
  }`;

export class Renderer {
  readonly gl: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private composer: EffectComposer;
  private bloom: UnrealBloomPass;
  private grade: ShaderPass;
  readonly fx = new Fx();
  private world: WorldView | null = null;
  game: Game | null = null;
  private views = new Map<number, ActorView>();
  private groundViews = new Map<number, THREE.Object3D>();
  private queue: GEvent[] = [];
  private block = 0;
  private hemi: THREE.HemisphereLight;
  private dir: THREE.DirectionalLight;
  private playerLight: THREE.PointLight;
  private fow: FowTexture | null = null;
  private teleMesh: THREE.InstancedMesh;
  private teleMat: THREE.ShaderMaterial;
  private cursor: THREE.Mesh;
  private pathDots: THREE.InstancedMesh;
  private targetMarks: THREE.InstancedMesh;
  private shadowTex: THREE.Texture;
  private shadowGeo = new THREE.PlaneGeometry(1, 1);
  private beamGeo = new THREE.CylinderGeometry(0.16, 0.16, 3, 16, 1, true);
  private beamMat: THREE.ShaderMaterial;
  private time = 0;
  camYaw = Math.PI / 4;
  private camYawTarget = Math.PI / 4;
  private camDist = 10.5;
  private camDistTarget = 10.5;
  private camTarget = new THREE.Vector3();
  private shake = 0;
  private hurt = 0;
  demo = false;
  quality: Quality;
  private unsub: (() => void) | null = null;
  private lastFloorVersion = -1;
  listeners: ((e: GEvent, worldPos: THREE.Vector3 | null) => void)[] = [];
  private raycaster = new THREE.Raycaster();
  private groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);

  constructor(container: HTMLElement, quality: Quality) {
    this.quality = quality;
    setTextureSize(quality === 'high' ? 512 : 256);
    this.gl = new THREE.WebGLRenderer({ antialias: quality === 'high', powerPreference: 'high-performance' });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
    this.gl.setSize(container.clientWidth, container.clientHeight);
    this.gl.shadowMap.enabled = quality === 'high';
    this.gl.shadowMap.type = THREE.PCFSoftShadowMap;
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.toneMappingExposure = 1.15;
    this.gl.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.gl.domElement);

    this.camera = new THREE.PerspectiveCamera(36, container.clientWidth / container.clientHeight, 0.1, 120);
    this.scene.add(this.fx.group);

    this.hemi = new THREE.HemisphereLight(0x8090a0, 0x101010, 0.6);
    this.scene.add(this.hemi);
    this.dir = new THREE.DirectionalLight(0x8090b0, 0.35);
    this.dir.position.set(-10, 20, -6);
    this.scene.add(this.dir);
    this.scene.add(this.dir.target);
    this.playerLight = new THREE.PointLight(0xffd0a0, 22, 16, 1.4);
    if (quality === 'high') {
      this.playerLight.castShadow = true;
      this.playerLight.shadow.mapSize.set(1024, 1024);
      this.playerLight.shadow.bias = -0.002;
      this.playerLight.shadow.normalBias = 0.02;
      this.playerLight.shadow.camera.near = 0.3;
      this.playerLight.shadow.camera.far = 14;
    }
    this.scene.add(this.playerLight);

    // Telegraph danger tiles
    this.teleMat = new THREE.ShaderMaterial({
      vertexShader: TELE_VERT, fragmentShader: TELE_FRAG, uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(1, 0.12, 0.05) } },
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const tg = new THREE.PlaneGeometry(0.96, 0.96);
    tg.rotateX(-Math.PI / 2);
    this.teleMesh = new THREE.InstancedMesh(tg, this.teleMat, 300);
    this.teleMesh.count = 0;
    this.teleMesh.frustumCulled = false;
    this.teleMesh.renderOrder = 5;
    this.scene.add(this.teleMesh);

    // Cursor and path preview
    const cg = new THREE.RingGeometry(0.38, 0.47, 4, 1);
    cg.rotateX(-Math.PI / 2);
    cg.rotateY(Math.PI / 4);
    this.cursor = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.cursor.renderOrder = 6;
    this.cursor.visible = false;
    this.scene.add(this.cursor);
    const dg = new THREE.CircleGeometry(0.07, 10);
    dg.rotateX(-Math.PI / 2);
    this.pathDots = new THREE.InstancedMesh(dg, new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.7).multiplyScalar(1.5), transparent: true, opacity: 0.7, depthWrite: false }), 80);
    this.pathDots.count = 0;
    this.pathDots.frustumCulled = false;
    this.scene.add(this.pathDots);
    const mg = new THREE.PlaneGeometry(0.9, 0.9);
    mg.rotateX(-Math.PI / 2);
    this.targetMarks = new THREE.InstancedMesh(mg, new THREE.MeshBasicMaterial({ color: 0x40a0ff, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }), 300);
    this.targetMarks.count = 0;
    this.targetMarks.frustumCulled = false;
    this.scene.add(this.targetMarks);

    // Blob shadow texture
    const sc = document.createElement('canvas');
    sc.width = sc.height = 64;
    const sx = sc.getContext('2d')!;
    const grd = sx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grd.addColorStop(0, 'rgba(0,0,0,0.65)');
    grd.addColorStop(1, 'rgba(0,0,0,0)');
    sx.fillStyle = grd;
    sx.fillRect(0, 0, 64, 64);
    this.shadowTex = new THREE.CanvasTexture(sc);

    this.beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color(1, 1, 1) }, uTime: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uColor; uniform float uTime; varying vec2 vUv;
        void main(){ float a = pow(1.0 - vUv.y, 2.2) * (0.55 + 0.15 * sin(uTime * 3.0 + vUv.y * 10.0)); gl_FragColor = vec4(uColor * a * 2.0, a); }`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });

    // Post-processing
    const size = new THREE.Vector2(container.clientWidth, container.clientHeight);
    this.composer = new EffectComposer(this.gl);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(size.clone().multiplyScalar(0.5), quality === 'high' ? 0.75 : 0.55, 0.55, 0.78);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize(container.clientWidth, container.clientHeight);
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.gl.setSize(w, h);
    this.composer.setSize(w, h);
    (this.grade.uniforms.uRes.value as THREE.Vector2).set(w, h);
    this.fx.particles.mat.uniforms.uScale.value = h * this.gl.getPixelRatio() * 0.9;
  }

  // ------------------------------------------------------------------ game binding
  setGame(game: Game | null): void {
    this.unsub?.();
    this.unsub = null;
    this.game = game;
    this.queue = [];
    this.block = 0;
    if (!game) return;
    this.unsub = game.on((e) => this.queue.push(e));
    this.buildFloor();
  }

  private buildFloor(): void {
    const g = this.game!;
    this.lastFloorVersion = g.floorVersion;
    // clear old
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    for (const v of this.views.values()) this.removeView(v);
    this.views.clear();
    for (const o of this.groundViews.values()) this.scene.remove(o);
    this.groundViews.clear();
    this.fx.clear();
    this.queue = [];
    this.block = 0;

    const biome = biomeForDepth(g.theme, g.depth);
    this.applyBiome(biome);
    this.world = new WorldView(g.floor, biome, g.runSeed + g.depth * 101, this.fx, this.quality);
    this.scene.add(this.world.group);
    this.fow = new FowTexture(g.w, g.h);
    shared.uFow.value = this.fow.tex;
    shared.uFowSize.value.set(g.w, g.h);
    this.fow.update(g.visible, g.explored, 1, true);
    for (const a of g.actors) this.addView(a);
    for (const gi of g.ground) this.addGroundView(gi.gid);
    const p = g.player;
    this.camTarget.set(p.x, 0, p.y);
  }

  private applyBiome(b: Biome): void {
    this.scene.background = new THREE.Color(b.fog).multiplyScalar(0.6);
    this.scene.fog = new THREE.FogExp2(b.fog, b.fogDensity * 0.55);
    this.hemi.color.setHex(b.hemiSky);
    this.hemi.groundColor.setHex(b.hemiGround);
    this.hemi.intensity = 0.55;
    this.dir.color.setHex(b.hemiSky);
    this.playerLight.color.setHex(b.torch).lerp(new THREE.Color(0xfff0dd), 0.55);
    const tint = new THREE.Color(b.accent).lerp(new THREE.Color(1, 1, 1), 0.88);
    (this.grade.uniforms.uTint.value as THREE.Color).copy(tint);
  }

  private addView(a: Actor): void {
    if (this.views.has(a.id) || a.dead) return;
    const rig = a.isPlayer ? buildPlayer((this.game!.player).cls) : buildMonster(a.def!, !!a.elite?.length);
    let scale = a.isPlayer ? 1 : a.def!.scale * 1.15;
    if (a.split) scale *= 0.7;
    if (a.summoned) scale *= 0.85;
    rig.root.scale.setScalar(scale);
    const pos = new THREE.Vector3(a.x, 0, a.y);
    rig.root.position.copy(pos);
    this.scene.add(rig.root);
    const shadow = new THREE.Mesh(this.shadowGeo, new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2;
    shadow.scale.setScalar(scale * (a.boss ? 1.6 : 1.1));
    shadow.renderOrder = 1;
    this.scene.add(shadow);
    const yaw = Math.random() * Math.PI * 2;
    this.views.set(a.id, {
      id: a.id, actor: a, rig, pos, from: pos.clone(), to: pos.clone(), moveT: 1, moveDur: 0.14, mode: 'walk', yaw, yawTarget: yaw,
      lunge: 0, flash: 0, flashColor: new THREE.Color(1, 1, 1), recoil: 0, dying: -1, hp: a.hp, scale, shadow, statusAcc: 0, appear: a.isPlayer ? 1 : 0,
    });
  }

  private removeView(v: ActorView): void {
    this.scene.remove(v.rig.root);
    this.scene.remove(v.shadow);
    (v.shadow.material as THREE.Material).dispose();
    for (const m of v.rig.mats) m.dispose();
  }

  private addGroundView(gid: number): void {
    const gi = this.game!.ground.find((g) => g.gid === gid);
    if (!gi || this.groundViews.has(gid)) return;
    const grp = new THREE.Group();
    // offset several items on the same tile slightly
    const sameTile = [...this.groundViews.values()].filter((o) => o.userData.tx === gi.x && o.userData.ty === gi.y).length;
    const ang = sameTile * 2.1;
    grp.position.set(gi.x + Math.cos(ang) * 0.22 * Math.min(1, sameTile), 0, gi.y + Math.sin(ang) * 0.22 * Math.min(1, sameTile));
    grp.userData = { tx: gi.x, ty: gi.y, t: 0 };
    if (gi.gold) {
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xffc040, metalness: 1, roughness: 0.25, emissive: 0x402000, emissiveIntensity: 0.5 });
      const n = Math.min(6, 2 + Math.floor(gi.gold / 30));
      for (let i = 0; i < n; i++) {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.025, 12), goldMat);
        c.position.set((Math.random() - 0.5) * 0.18, 0.015 + i * 0.026, (Math.random() - 0.5) * 0.18);
        c.castShadow = true;
        grp.add(c);
      }
    } else if (gi.item) {
      const color = RARITY_COLOR[gi.item.rarity];
      const isCons = gi.item.slot === 'consumable';
      const gem = new THREE.Mesh(
        isCons ? new THREE.CapsuleGeometry(0.07, 0.12, 4, 8) : new THREE.OctahedronGeometry(0.13, 0),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: isCons ? 1.2 : 2, roughness: 0.2, metalness: 0.4 }),
      );
      gem.position.y = 0.35;
      gem.castShadow = true;
      grp.add(gem);
      grp.userData.gem = gem;
      if (gi.item.rarity !== 'common' || isCons) {
        const mat = this.beamMat.clone();
        mat.uniforms.uColor.value = new THREE.Color(color);
        const beam = new THREE.Mesh(this.beamGeo, mat);
        beam.position.y = 1.5;
        beam.scale.set(gi.item.rarity === 'artifact' ? 1.6 : 1, gi.item.rarity === 'artifact' ? 1.6 : isCons ? 0.4 : 1, gi.item.rarity === 'artifact' ? 1.6 : 1);
        grp.add(beam);
        grp.userData.beam = mat;
      }
    }
    this.scene.add(grp);
    this.groundViews.set(gid, grp);
  }

  private removeGroundView(gid: number): void {
    const o = this.groundViews.get(gid);
    if (!o) return;
    this.scene.remove(o);
    o.traverse((c) => {
      const m = c as THREE.Mesh;
      if (m.geometry && m.geometry !== this.beamGeo) m.geometry.dispose();
    });
    this.groundViews.delete(gid);
  }

  // ------------------------------------------------------------------ events
  get busy(): boolean {
    return this.queue.length > 0 || this.block > 0.0001;
  }

  private viewPos(id: number): THREE.Vector3 | null {
    const v = this.views.get(id);
    return v ? v.to.clone() : null;
  }

  private process(e: GEvent): number {
    const g = this.game!;
    let wp: THREE.Vector3 | null = null;
    let wait = 0;
    switch (e.t) {
      case 'floor':
        if (g.floorVersion !== this.lastFloorVersion) this.buildFloor();
        break;
      case 'spawn': {
        const a = g.actors.find((x) => x.id === e.id);
        if (a) {
          this.addView(a);
          const v = this.views.get(a.id);
          if (v && g.isVisible(a.x, a.y)) this.fx.ring(v.pos, 0.3, 'shadow');
        }
        break;
      }
      case 'move': {
        const v = this.views.get(e.id);
        if (!v) break;
        v.from.copy(v.pos);
        v.to.set(e.x, 0, e.y);
        v.mode = e.mode ?? 'walk';
        v.moveT = 0;
        v.moveDur = v.mode === 'blink' ? 0.02 : v.mode === 'charge' ? 0.16 : v.actor.isPlayer ? 0.13 : 0.16;
        const dx = e.x - e.fx, dz = e.y - e.fy;
        if (dx || dz) v.yawTarget = Math.atan2(dx, dz);
        if (v.mode === 'blink') {
          this.fx.particles.emit(v.from.clone().setY(0.8), { count: 26, color: 0xb070ff, color2: 0xffffff, speed: 1.5, up: 1, life: [0.3, 0.7], size: [0.1, 0.25], radius: 0.3, height: 1.2, intensity: 3 });
          this.fx.particles.emit(v.to.clone().setY(0.8), { count: 26, color: 0xb070ff, color2: 0xffffff, speed: 1.5, up: 1, life: [0.3, 0.7], size: [0.1, 0.25], radius: 0.3, height: 1.2, intensity: 3 });
        }
        if (v.mode === 'charge') {
          wait = 0.14;
          this.fx.particles.emit(v.from.clone().setY(0.2), { count: 16, color: 0xc0b090, speed: 1.4, up: 0.6, life: [0.3, 0.6], size: [0.15, 0.35], gravity: 1, intensity: 0.6 });
        }
        if (v.actor.isPlayer) wp = v.to.clone();
        break;
      }
      case 'attack': {
        const v = this.views.get(e.id);
        if (!v) break;
        const dx = e.tx - v.to.x, dz = e.ty - v.to.z;
        if (dx || dz) v.yawTarget = Math.atan2(dx, dz);
        v.lunge = 1;
        if (g.isVisible(Math.round(v.to.x), Math.round(v.to.z))) wait = 0.11;
        break;
      }
      case 'projectile': {
        const from = new THREE.Vector3(e.from.x, 0.9, e.from.y);
        const to = new THREE.Vector3(e.to.x, 0.8, e.to.y);
        const visible = g.isVisible(e.from.x, e.from.y) || g.isVisible(e.to.x, e.to.y);
        if (visible) wait = this.fx.projectile(from, to, e.kind);
        break;
      }
      case 'damage': {
        const v = this.views.get(e.id);
        if (!v) break;
        v.hp -= e.amount;
        v.flash = 1;
        v.flashColor.setHex(e.kind === 'phys' ? 0xffffff : KIND_COLOR[e.kind]);
        v.recoil = 1;
        wp = v.pos.clone().setY(v.rig.height * v.scale);
        if (g.isVisible(Math.round(v.to.x), Math.round(v.to.z))) {
          this.fx.burst(v.pos.clone().setY(0.8 * v.scale), e.kind, e.crit ? 26 : 12);
          if (e.crit) this.shake = Math.max(this.shake, 0.18);
        }
        if (v.actor.isPlayer) this.hurt = Math.min(1, this.hurt + 0.35 + e.amount / v.actor.stats.maxHp);
        break;
      }
      case 'miss': {
        const v = this.views.get(e.id);
        if (v) wp = v.pos.clone().setY(v.rig.height * v.scale);
        break;
      }
      case 'heal': {
        const v = this.views.get(e.id);
        if (!v) break;
        if (!e.mana) v.hp += e.amount;
        wp = v.pos.clone().setY(v.rig.height * v.scale);
        this.fx.particles.emit(v.pos.clone().setY(0.3), { count: 14, color: e.mana ? 0x60a0ff : 0x60ff90, speed: 0.4, up: 1.6, life: [0.5, 1], size: [0.1, 0.2], radius: 0.35, gravity: -0.5, intensity: 3 });
        break;
      }
      case 'death': {
        const v = this.views.get(e.id);
        if (!v) break;
        v.dying = 0;
        wp = v.pos.clone();
        if (g.isVisible(Math.round(v.to.x), Math.round(v.to.z))) {
          const c = v.actor.def?.colors.eye ?? 0xff4020;
          this.fx.particles.emit(v.pos.clone().setY(0.6), { count: v.actor.boss ? 140 : 40, color: c, color2: v.actor.def?.colors.primary ?? 0x808080, speed: v.actor.boss ? 4 : 2, up: 2, life: [0.4, 1.2], size: [0.1, 0.3], gravity: 3, radius: 0.3, height: 1, intensity: 2.5 });
          this.fx.flash(v.pos.clone().setY(1), c, v.actor.boss ? 60 : 12, 0.5);
        }
        break;
      }
      case 'aoe': {
        const p = new THREE.Vector3(e.x, 0, e.y);
        if (g.isVisible(e.x, e.y) || g.explored[e.y * g.w + e.x]) this.fx.ring(p, e.radius, e.kind);
        wait = e.radius > 0 ? 0.12 : 0.02;
        break;
      }
      case 'ground':
        if (e.added) this.addGroundView(e.gid);
        else this.removeGroundView(e.gid);
        break;
      case 'feature': {
        const f = g.floor.features[e.index];
        this.world?.onFeature(e.index, f);
        if (f.kind === 'chest' && !g.blocked[f.y * g.w + f.x]) this.world?.hideFeature(e.index);
        if (f.kind === 'chest' && f.used) {
          this.fx.particles.emit(new THREE.Vector3(f.x, 0.6, f.y), { count: 30, color: RARITY_COLOR[f.rarity ?? 'common'], color2: 0xffe080, speed: 1, up: 2.2, life: [0.5, 1.1], size: [0.08, 0.2], gravity: 2, intensity: 3 });
        }
        break;
      }
      case 'stairs':
        this.world?.setStairsVisible(true);
        this.fx.ring(new THREE.Vector3(g.floor.stairs.x, 0, g.floor.stairs.y), 2, 'arcane');
        break;
      case 'trap':
        this.fx.burst(new THREE.Vector3(e.x, 0.3, e.y), 'phys', 20);
        this.shake = Math.max(this.shake, 0.25);
        break;
      case 'shake':
        this.shake = Math.max(this.shake, e.power);
        break;
      case 'levelup': {
        const v = this.views.get(g.player.id);
        if (v) {
          this.fx.ring(v.pos, 1.5, 'holy');
          this.fx.particles.emit(v.pos.clone().setY(0.2), { count: 60, color: 0xffe080, color2: 0xffffff, speed: 0.6, up: 3, life: [0.6, 1.4], size: [0.1, 0.25], radius: 0.6, gravity: -0.4, intensity: 4 });
        }
        break;
      }
      case 'status': {
        const v = this.views.get(e.id);
        if (v) wp = v.pos.clone().setY(v.rig.height * v.scale);
        break;
      }
      default:
    }
    for (const l of this.listeners) l(e, wp);
    return wait;
  }

  // ------------------------------------------------------------------ input helpers
  pickTile(clientX: number, clientY: number): Vec | null {
    const rect = this.gl.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = new THREE.Vector3();
    if (!this.raycaster.ray.intersectPlane(this.groundPlane, hit)) return null;
    // Try to snap to an actor if the ray passes near one (makes clicking tall monsters easy)
    if (this.game) {
      let best: { d: number; v: Vec } | null = null;
      for (const v of this.views.values()) {
        if (!v.rig.root.visible || v.actor.isPlayer || v.dying >= 0) continue;
        const center = v.pos.clone().setY(v.rig.height * v.scale * 0.5);
        const d = this.raycaster.ray.distanceToPoint(center);
        if (d < 0.45 * Math.max(1, v.scale) && (!best || d < best.d)) best = { d, v: { x: v.actor.x, y: v.actor.y } };
      }
      if (best) return best.v;
    }
    return { x: Math.round(hit.x), y: Math.round(hit.z) };
  }

  worldToScreen(p: THREE.Vector3): { x: number; y: number; on: boolean } {
    const v = p.clone().project(this.camera);
    const rect = this.gl.domElement.getBoundingClientRect();
    return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top, on: v.z < 1 && Math.abs(v.x) < 1.2 && Math.abs(v.y) < 1.2 };
  }

  actorScreenPos(id: number): { x: number; y: number; on: boolean; visible: boolean; hp: number } | null {
    const v = this.views.get(id);
    if (!v) return null;
    const s = this.worldToScreen(v.pos.clone().setY(v.rig.height * v.scale + 0.35));
    return { ...s, visible: v.rig.root.visible && v.dying < 0, hp: v.hp };
  }

  rotate(dir: number): void {
    this.camYawTarget += (dir * Math.PI) / 2;
  }

  zoom(delta: number): void {
    this.camDistTarget = Math.max(7, Math.min(22, this.camDistTarget + delta));
  }

  setHover(tile: Vec | null, kind: 'move' | 'enemy' | 'target' | 'none'): void {
    if (!tile || kind === 'none') {
      this.cursor.visible = false;
      return;
    }
    this.cursor.visible = true;
    this.cursor.position.set(tile.x, 0.03, tile.y);
    const c = kind === 'enemy' ? 0xff4030 : kind === 'target' ? 0x60c0ff : 0xfff0d0;
    (this.cursor.material as THREE.MeshBasicMaterial).color.setHex(c).multiplyScalar(2);
  }

  setPath(path: Vec[] | null): void {
    const m4 = new THREE.Matrix4();
    const n = path ? Math.min(path.length, 80) : 0;
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(path![i].x, 0.03, path![i].y);
      this.pathDots.setMatrixAt(i, m4);
    }
    this.pathDots.count = n;
    this.pathDots.instanceMatrix.needsUpdate = true;
  }

  setTargets(tiles: Vec[] | null, color = 0x40a0ff): void {
    const m4 = new THREE.Matrix4();
    const n = tiles ? Math.min(tiles.length, 300) : 0;
    for (let i = 0; i < n; i++) {
      m4.makeTranslation(tiles![i].x, 0.025, tiles![i].y);
      this.targetMarks.setMatrixAt(i, m4);
    }
    this.targetMarks.count = n;
    this.targetMarks.instanceMatrix.needsUpdate = true;
    (this.targetMarks.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  // ------------------------------------------------------------------ frame
  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    this.time += dt;
    shared.uTime.value = this.time;
    this.teleMat.uniforms.uTime.value = this.time;
    this.beamMat.uniforms.uTime.value = this.time;
    const g = this.game;
    if (!g) {
      this.composer.render(dt);
      return;
    }
    if (g.floorVersion !== this.lastFloorVersion) this.buildFloor();

    // event queue
    this.block = Math.max(0, this.block - dt);
    let guard = 0;
    while (this.block <= 0 && this.queue.length && guard++ < 200) {
      const e = this.queue.shift()!;
      this.block += this.process(e);
    }
    if (!this.queue.length && this.block <= 0) {
      for (const v of this.views.values()) if (v.dying < 0) v.hp = v.actor.hp;
    }

    this.fow?.update(g.visible, g.explored, dt);
    const fowAt = (x: number, y: number) => this.fow?.value(x, y) ?? 0;

    // actors
    const pv = this.views.get(g.player.id);
    for (const v of [...this.views.values()]) this.animateView(v, dt, fowAt);

    // camera
    const target = pv ? pv.pos : new THREE.Vector3(g.player.x, 0, g.player.y);
    if (this.demo) this.camYawTarget += dt * 0.08;
    this.camTarget.lerp(target, 1 - Math.exp(-dt * 8));
    this.camYaw += (this.camYawTarget - this.camYaw) * (1 - Math.exp(-dt * 9));
    this.camDist += (this.camDistTarget - this.camDist) * (1 - Math.exp(-dt * 8));
    const pitch = 0.98;
    const cx = this.camTarget.x + Math.sin(this.camYaw) * Math.cos(pitch) * this.camDist;
    const cz = this.camTarget.z + Math.cos(this.camYaw) * Math.cos(pitch) * this.camDist;
    const cy = Math.sin(pitch) * this.camDist;
    this.shake = Math.max(0, this.shake - dt * 1.8);
    const s = this.shake * this.shake * 0.5;
    this.camera.position.set(cx + (Math.random() - 0.5) * s, cy + (Math.random() - 0.5) * s, cz + (Math.random() - 0.5) * s);
    this.camera.lookAt(this.camTarget.x, 0.6, this.camTarget.z);
    shared.uCam.value.copy(this.camera.position);
    shared.uPlayer.value.set(target.x, 0.9, target.z);
    shared.uCutRadius.value = this.demo ? 0 : 2.4 + this.camDist * 0.04;

    this.playerLight.position.set(target.x, 3.0, target.z);
    const flick = 1 + Math.sin(this.time * 9) * 0.03 + Math.sin(this.time * 23) * 0.02;
    this.playerLight.intensity = 22 * flick;
    this.dir.position.set(target.x - 8, 18, target.z - 5);
    this.dir.target.position.set(target.x, 0, target.z);

    this.world?.update(dt, target, fowAt);
    this.fx.update(dt);

    // telegraphs
    const m4 = new THREE.Matrix4();
    let n = 0;
    for (const a of g.actors) {
      if (!a.telegraph || a.dead) continue;
      for (const t of a.telegraph.tiles) {
        if (n >= 300) break;
        m4.makeTranslation(t.x, 0.04, t.y);
        this.teleMesh.setMatrixAt(n++, m4);
      }
    }
    this.teleMesh.count = n;
    this.teleMesh.instanceMatrix.needsUpdate = true;

    // ground items
    for (const o of this.groundViews.values()) {
      const vis = fowAt(o.userData.tx, o.userData.ty);
      o.visible = vis > 0.2;
      const gem = o.userData.gem as THREE.Mesh | undefined;
      if (gem) {
        gem.rotation.y += dt * 1.5;
        gem.position.y = 0.35 + Math.sin(this.time * 2.5 + o.userData.tx) * 0.06;
      }
    }

    // post
    this.hurt = Math.max(0, this.hurt - dt * 1.5);
    const p = g.player;
    const lowHp = p.hp / p.stats.maxHp < 0.3 && !g.over ? 1 : 0;
    this.grade.uniforms.uTime.value = this.time;
    this.grade.uniforms.uHurt.value = this.hurt * 0.6;
    this.grade.uniforms.uLowHp.value = lowHp;
    this.composer.render(dt);
  }

  private animateView(v: ActorView, dt: number, fowAt: (x: number, y: number) => number): void {
    const r = v.rig;
    const t = this.time;
    // movement
    if (v.moveT < 1) {
      v.moveT = Math.min(1, v.moveT + dt / v.moveDur);
      const k = v.moveT;
      const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
      v.pos.lerpVectors(v.from, v.to, v.mode === 'blink' ? 1 : e);
    } else v.pos.copy(v.to);
    const moving = v.moveT < 1 && v.mode === 'walk';
    let dy = moving ? Math.sin(v.moveT * Math.PI) * 0.1 : 0;
    // facing
    let dyaw = v.yawTarget - v.yaw;
    while (dyaw > Math.PI) dyaw -= Math.PI * 2;
    while (dyaw < -Math.PI) dyaw += Math.PI * 2;
    v.yaw += dyaw * Math.min(1, dt * 14);
    r.root.position.copy(v.pos);
    r.root.rotation.y = v.yaw;
    // idle / float
    if (r.floating) dy += 0.18 + Math.sin(t * 2.2 + v.id) * 0.08;
    const breathe = 1 + Math.sin(t * 2.4 + v.id * 1.7) * 0.02;
    r.body.scale.set(1, breathe, 1);
    // lunge
    let fwd = 0;
    if (v.lunge > 0) {
      v.lunge = Math.max(0, v.lunge - dt / 0.22);
      fwd = Math.sin((1 - v.lunge) * Math.PI) * 0.38;
      if (r.arms[1]) r.arms[1].rotation.x = -0.3 - Math.sin((1 - v.lunge) * Math.PI) * 1.6;
    } else if (r.arms[1]) r.arms[1].rotation.x += (-0.3 - r.arms[1].rotation.x) * Math.min(1, dt * 10);
    // recoil
    if (v.recoil > 0) {
      v.recoil = Math.max(0, v.recoil - dt / 0.2);
      fwd -= Math.sin(v.recoil * Math.PI) * 0.12;
    }
    r.body.position.set(0, dy, fwd);
    // limbs
    const swing = moving ? Math.sin(v.moveT * Math.PI * 2) * 0.7 : Math.sin(t * 1.5 + v.id) * 0.04;
    r.legs.forEach((l, i) => (l.rotation.x = (i % 2 ? swing : -swing)));
    if (r.arms[0] && v.lunge <= 0) r.arms[0].rotation.x = -0.3 + (moving ? swing * 0.5 : 0);
    for (const s of r.spin) s.rotation.y += dt * 1.2;
    // hit flash & telegraph glow
    const tele = !!v.actor.telegraph && !v.actor.dead;
    if (v.flash > 0 || tele || v.dying >= 0) {
      v.flash = Math.max(0, v.flash - dt * 5);
      const pulse = tele ? 0.6 + 0.4 * Math.sin(t * 14) : 0;
      for (const m of r.mats) {
        const base = m.userData.baseEmissive as THREE.Color;
        const bi = m.userData.baseEmissiveIntensity as number;
        if (v.flash > 0) {
          m.emissive.copy(v.flashColor);
          m.emissiveIntensity = Math.max(bi, v.flash * 2.5);
        } else if (tele) {
          m.emissive.setRGB(1, 0.15, 0.05);
          m.emissiveIntensity = Math.max(bi, pulse * 1.6);
        } else {
          m.emissive.copy(base);
          m.emissiveIntensity = bi;
        }
      }
    }
    // dying
    if (v.dying >= 0) {
      v.dying += dt;
      const k = Math.min(1, v.dying / 0.6);
      r.root.scale.setScalar(v.scale * (1 - k * 0.85));
      r.root.position.y -= k * 0.4;
      r.root.rotation.z = k * 1.2;
      if (k >= 1) {
        this.removeView(v);
        this.views.delete(v.id);
        return;
      }
    }
    // visibility (fog of war); the player is always visible
    const vis = v.actor.isPlayer ? 1 : fowAt(Math.round(v.to.x), Math.round(v.to.z));
    const show = v.actor.isPlayer || vis > 0.55;
    v.appear += ((show ? 1 : 0) - v.appear) * Math.min(1, dt * 10);
    r.root.visible = v.appear > 0.05;
    if (v.dying < 0) r.root.scale.setScalar(v.scale * (0.6 + 0.4 * v.appear));
    v.shadow.visible = r.root.visible;
    v.shadow.position.set(v.pos.x, 0.015, v.pos.z);
    if (v.actor.isPlayer && this.game && this.game.hasStatus(v.actor, 'stealth')) {
      r.root.visible = Math.sin(t * 20) > -0.6;
    }
    // status particles
    v.statusAcc += dt;
    if (v.statusAcc > 0.18 && r.root.visible && v.dying < 0) {
      v.statusAcc = 0;
      const st = v.actor.statuses;
      const at = v.pos.clone().setY(0.6 * v.scale);
      for (const s of st) {
        if (s.kind === 'burn') this.fx.particles.emit(at, { count: 2, color: 0xff6020, color2: 0xffd040, speed: 0.2, up: 1.2, life: [0.3, 0.6], size: [0.1, 0.22], radius: 0.25, height: 0.8, gravity: -0.5, intensity: 3 });
        else if (s.kind === 'poison') this.fx.particles.emit(at, { count: 1, color: 0x70ff30, speed: 0.1, up: 0.6, life: [0.4, 0.8], size: [0.08, 0.15], radius: 0.25, height: 0.8, gravity: -0.2, intensity: 2 });
        else if (s.kind === 'freeze') this.fx.particles.emit(at, { count: 2, color: 0xa0e0ff, color2: 0xffffff, speed: 0.2, up: 0.2, life: [0.3, 0.6], size: [0.06, 0.14], radius: 0.35, height: 1, gravity: 0.5, intensity: 3 });
        else if (s.kind === 'stun') this.fx.particles.emit(v.pos.clone().setY(v.rig.height * v.scale + 0.2), { count: 1, color: 0xffe060, speed: 0.6, up: 0.1, life: [0.3, 0.5], size: [0.08, 0.14], radius: 0.25, intensity: 3 });
        else if (s.kind === 'shield') this.fx.particles.emit(at, { count: 1, color: 0x80c0ff, speed: 0.4, up: 0.4, life: [0.3, 0.6], size: [0.06, 0.12], radius: 0.5, height: 1.2, intensity: 2 });
        else if (s.kind === 'bleed') this.fx.particles.emit(at, { count: 1, color: 0xa01010, speed: 0.2, up: 0.1, life: [0.3, 0.6], size: [0.06, 0.12], radius: 0.2, gravity: 4, intensity: 1 });
      }
      if (v.actor.asleep && Math.random() < 0.3) this.fx.particles.emit(v.pos.clone().setY(v.rig.height * v.scale), { count: 1, color: 0x8090ff, speed: 0.1, up: 0.5, life: [0.8, 1.2], size: [0.08, 0.12], gravity: -0.1, intensity: 2 });
    }
    if (r.light && v.actor.isPlayer === false) r.light.intensity = 6 + Math.sin(t * 5) * 1.5;
  }

  dispose(): void {
    this.setGame(null);
    this.gl.dispose();
  }
}

export function tileIsStairs(g: Game, x: number, y: number): boolean {
  return g.tile(x, y) === T.Stairs;
}
