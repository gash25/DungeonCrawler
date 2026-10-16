import * as THREE from 'three';

/** Uniforms shared by every patched world material. */
export const shared = {
  uFow: { value: null as THREE.Texture | null },
  uFowSize: { value: new THREE.Vector2(1, 1) },
  uPlayer: { value: new THREE.Vector3() },
  uCam: { value: new THREE.Vector3() },
  uTime: { value: 0 },
  uCutRadius: { value: 2.6 },
};

export interface PatchOpts {
  fow?: boolean;
  worldUv?: number; // uv scale (texture repeats per 1/scale world units)
  cutout?: boolean;
}

/**
 * Inject fog-of-war, world-space UVs and camera-occlusion cutout into a built-in material.
 * Works with MeshStandardMaterial / MeshPhysicalMaterial / MeshLambertMaterial, instanced or not.
 */
export function patchMaterial<M extends THREE.Material>(mat: M, opts: PatchOpts): M {
  const defines: Record<string, string> = {};
  if (opts.fow) defines.DC_FOW = '';
  if (opts.worldUv) {
    defines.DC_WORLDUV = '';
    defines.DC_UVSCALE = opts.worldUv.toFixed(4);
  }
  if (opts.cutout) defines.DC_CUTOUT = '';
  (mat as THREE.Material & { defines?: Record<string, string> }).defines = {
    ...((mat as THREE.Material & { defines?: Record<string, string> }).defines ?? {}),
    ...defines,
  };
  mat.customProgramCacheKey = () => `dc-${!!opts.fow}-${opts.worldUv ?? 0}-${!!opts.cutout}`;
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.uFow = shared.uFow;
    shader.uniforms.uFowSize = shared.uFowSize;
    shader.uniforms.uPlayer = shared.uPlayer;
    shader.uniforms.uCam = shared.uCam;
    shader.uniforms.uTime = shared.uTime;
    shader.uniforms.uCutRadius = shared.uCutRadius;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vDcWP;')
      .replace(
        '#include <uv_vertex>',
        `#include <uv_vertex>
#ifdef DC_WORLDUV
{
  vec4 wp0 = vec4(position, 1.0);
  vec3 nW = normal;
  #ifdef USE_INSTANCING
    wp0 = instanceMatrix * wp0;
    nW = mat3(instanceMatrix) * normal;
  #endif
  wp0 = modelMatrix * wp0;
  nW = normalize(mat3(modelMatrix) * nW);
  vec2 wuv;
  if (abs(nW.y) > 0.5) wuv = wp0.xz + 0.5;
  else if (abs(nW.x) > 0.5) wuv = vec2(wp0.z + 0.5, -wp0.y);
  else wuv = vec2(wp0.x + 0.5, -wp0.y);
  wuv *= DC_UVSCALE;
  #ifdef USE_MAP
    vMapUv = wuv;
  #endif
  #ifdef USE_NORMALMAP
    vNormalMapUv = wuv;
  #endif
  #ifdef USE_ROUGHNESSMAP
    vRoughnessMapUv = wuv;
  #endif
  #ifdef USE_EMISSIVEMAP
    vEmissiveMapUv = wuv;
  #endif
}
#endif`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
{
  vec4 dcW = vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    dcW = instanceMatrix * dcW;
  #endif
  vDcWP = (modelMatrix * dcW).xyz;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vDcWP;
uniform sampler2D uFow;
uniform vec2 uFowSize;
uniform vec3 uPlayer;
uniform vec3 uCam;
uniform float uTime;
uniform float uCutRadius;
float dcBayer(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  int i = int(q.x) + int(q.y) * 4;
  float m[16] = float[16](0.0,8.0,2.0,10.0,12.0,4.0,14.0,6.0,3.0,11.0,1.0,9.0,15.0,7.0,13.0,5.0);
  return (m[i] + 0.5) / 16.0;
}`,
      )
      .replace(
        'void main() {',
        `void main() {
#ifdef DC_CUTOUT
{
  vec3 toCam = uCam - uPlayer;
  vec3 dir = normalize(toCam);
  vec3 rel = vDcWP - uPlayer;
  float t = dot(rel, dir);
  if (t > 0.9 && vDcWP.y > 0.02) {
    float perp = length(rel - dir * t);
    float a = smoothstep(uCutRadius, uCutRadius - 1.1, perp);
    if (a > dcBayer(gl_FragCoord.xy)) discard;
  }
}
#endif`,
      )
      .replace(
        '#include <opaque_fragment>',
        `#ifdef DC_FOW
{
  vec2 fuv = (vDcWP.xz + 0.5) / uFowSize;
  float fv = texture2D(uFow, fuv).r;
  if (fv < 0.02) discard;
  float lum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
  vec3 mem = vec3(lum) * vec3(0.5, 0.6, 0.85) * 1.3;
  outgoingLight = mix(mem, outgoingLight, smoothstep(0.32, 0.95, fv)) * fv;
}
#endif
#include <opaque_fragment>`,
      );
  };
  mat.needsUpdate = true;
  return mat;
}

/** Fog-of-war texture holder with smooth per-tile fading. */
export class FowTexture {
  readonly tex: THREE.DataTexture;
  private cur: Float32Array;
  private data: Uint8Array;
  constructor(readonly w: number, readonly h: number) {
    this.data = new Uint8Array(w * h);
    this.cur = new Float32Array(w * h);
    this.tex = new THREE.DataTexture(this.data, w, h, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = THREE.LinearFilter;
    this.tex.minFilter = THREE.LinearFilter;
    this.tex.needsUpdate = true;
  }
  update(visible: Uint8Array, explored: Uint8Array, dt: number, instant = false): void {
    const k = instant ? 1 : Math.min(1, dt * 7);
    let changed = false;
    for (let i = 0; i < this.cur.length; i++) {
      const target = visible[i] ? 1 : explored[i] ? 0.3 : 0;
      const c = this.cur[i];
      if (c !== target) {
        let n = c + (target - c) * k;
        if (Math.abs(n - target) < 0.01) n = target;
        this.cur[i] = n;
        const b = Math.round(n * 255);
        if (this.data[i] !== b) {
          this.data[i] = b;
          changed = true;
        }
      }
    }
    if (changed) this.tex.needsUpdate = true;
  }
  value(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return 0;
    return this.cur[y * this.w + x];
  }
}
