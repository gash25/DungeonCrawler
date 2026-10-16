// Fully procedural audio: no asset files. Ambient music + combat layer + synthesized SFX.
import type { DmgKind } from './game/types';

const SCALES: Record<string, { root: number; steps: number[] }> = {
  crypt: { root: 38, steps: [0, 1, 3, 5, 7, 8, 10] }, // D phrygian
  frost: { root: 40, steps: [0, 2, 3, 5, 7, 8, 10] }, // E aeolian
  forge: { root: 36, steps: [0, 1, 4, 5, 7, 8, 10] }, // C phrygian dominant
  fungal: { root: 42, steps: [0, 2, 3, 5, 7, 9, 10] }, // F# dorian
  temple: { root: 45, steps: [0, 2, 3, 5, 7, 8, 11] }, // A harmonic minor
  void: { root: 35, steps: [0, 1, 3, 5, 6, 8, 10] }, // B locrian
};

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

export class Audio {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private music!: GainNode;
  private sfx!: GainNode;
  private reverb!: ConvolverNode;
  private reverbIn!: GainNode;
  private noiseBuf!: AudioBuffer;
  private drone: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private timer: number | null = null;
  private nextBar = 0;
  private bar = 0;
  private scale = SCALES.crypt;
  private combat = 0;
  private combatTarget = 0;
  private musicVol = 0.5;
  private sfxVol = 0.7;
  private lastStep = 0;

  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    this.ctx = ctx;
    this.master = ctx.createGain();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);
    this.music = ctx.createGain();
    this.sfx = ctx.createGain();
    this.music.gain.value = this.musicVol * 0.5;
    this.sfx.gain.value = this.sfxVol;
    this.music.connect(this.master);
    this.sfx.connect(this.master);
    // reverb impulse
    const len = ctx.sampleRate * 3.2;
    const imp = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = imp.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6);
    }
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = imp;
    this.reverbIn = ctx.createGain();
    this.reverbIn.gain.value = 0.7;
    this.reverbIn.connect(this.reverb).connect(this.master);
    this.noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  setVolumes(music: number, sfx: number): void {
    this.musicVol = music;
    this.sfxVol = sfx;
    if (!this.ctx) return;
    this.music.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.2);
    this.sfx.gain.setTargetAtTime(sfx, this.ctx.currentTime, 0.1);
  }

  // ------------------------------------------------------------------ music
  startMusic(biome: string): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    this.scale = SCALES[biome] ?? SCALES.crypt;
    this.stopDrone();
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 260;
    filter.Q.value = 3;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 120;
    lfo.connect(lfoG).connect(filter.frequency);
    lfo.start();
    const oscs: OscillatorNode[] = [lfo];
    for (const [det, type] of [[-7, 'sawtooth'], [6, 'sawtooth'], [0, 'triangle']] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = mtof(this.scale.root - 12);
      o.detune.value = det;
      o.connect(filter);
      o.start();
      oscs.push(o);
    }
    const fifth = ctx.createOscillator();
    fifth.type = 'sine';
    fifth.frequency.value = mtof(this.scale.root - 5);
    const fg = ctx.createGain();
    fg.gain.value = 0.4;
    fifth.connect(fg).connect(filter);
    fifth.start();
    oscs.push(fifth);
    filter.connect(gain);
    gain.connect(this.music);
    gain.connect(this.reverbIn);
    this.drone = { osc: oscs, gain, filter };
    this.nextBar = ctx.currentTime + 0.5;
    if (this.timer === null) this.timer = window.setInterval(() => this.schedule(), 200);
  }

  private stopDrone(): void {
    if (!this.drone || !this.ctx) return;
    const d = this.drone;
    d.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.8);
    setTimeout(() => d.osc.forEach((o) => o.stop()), 4000);
    this.drone = null;
  }

  stopMusic(): void {
    this.stopDrone();
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  setCombat(on: boolean): void {
    this.combatTarget = on ? 1 : 0;
  }

  private note(deg: number, oct = 0): number {
    const s = this.scale.steps;
    const o = Math.floor(deg / s.length);
    const i = ((deg % s.length) + s.length) % s.length;
    return this.scale.root + s[i] + 12 * (o + oct);
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.combat += (this.combatTarget - this.combat) * 0.15;
    const barLen = this.combat > 0.5 ? 2.4 : 4.8;
    while (this.nextBar < ctx.currentTime + 0.6) {
      const t = this.nextBar;
      this.bar++;
      // pad chord every 2 bars
      if (this.bar % 2 === 0) {
        const roots = [0, 5, 3, 4, 0, 2, 5, 6];
        const r = roots[(this.bar / 2) % roots.length];
        for (const d of [r, r + 2, r + 4]) this.pad(mtof(this.note(d, 1)), t, barLen * 2, 0.035);
      }
      // bell melody fragments
      if (Math.random() < 0.7) {
        const n = 1 + Math.floor(Math.random() * 3);
        let deg = Math.floor(Math.random() * 7);
        for (let i = 0; i < n; i++) {
          this.bell(mtof(this.note(deg, 2)), t + i * (barLen / 4) + Math.random() * 0.1, 0.05);
          deg += Math.random() < 0.5 ? 1 : -2;
        }
      }
      // combat percussion
      if (this.combat > 0.3) {
        for (let i = 0; i < 4; i++) {
          this.thump(t + i * (barLen / 4), i === 0 ? 0.5 : 0.25 * this.combat);
          if (i % 2 === 1) this.hat(t + i * (barLen / 4) + barLen / 8, 0.06 * this.combat);
        }
      }
      if (this.drone) this.drone.filter.frequency.setTargetAtTime(220 + this.combat * 500, t, 1);
      this.nextBar += barLen;
    }
  }

  private pad(freq: number, t: number, dur: number, vol: number): void {
    const ctx = this.ctx!;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.35);
    g.gain.linearRampToValueAtTime(0, t + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 1200;
    for (const det of [-8, 8]) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = freq;
      o.detune.value = det;
      o.connect(f);
      o.start(t);
      o.stop(t + dur + 0.1);
    }
    f.connect(g);
    g.connect(this.music);
    g.connect(this.reverbIn);
  }

  private bell(freq: number, t: number, vol: number): void {
    const ctx = this.ctx!;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const mg = ctx.createGain();
    car.frequency.value = freq;
    mod.frequency.value = freq * 3.5;
    mg.gain.setValueAtTime(freq * 2, t);
    mg.gain.exponentialRampToValueAtTime(1, t + 1.5);
    mod.connect(mg).connect(car.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    car.connect(g);
    g.connect(this.music);
    g.connect(this.reverbIn);
    car.start(t);
    mod.start(t);
    car.stop(t + 3.1);
    mod.stop(t + 3.1);
  }

  private thump(t: number, vol: number): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 0.25);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(g).connect(this.music);
    o.start(t);
    o.stop(t + 0.45);
  }

  private hat(t: number, vol: number): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = 6000;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.08);
    s.connect(f).connect(g).connect(this.music);
    s.start(t, Math.random());
    s.stop(t + 0.1);
  }

  // ------------------------------------------------------------------ sfx
  private noise(t: number, dur: number, vol: number, type: BiquadFilterType, freq: number, freqEnd?: number, q = 1, reverb = 0.2): void {
    const ctx = this.ctx!;
    const s = ctx.createBufferSource();
    s.buffer = this.noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(f).connect(g);
    g.connect(this.sfx);
    if (reverb) {
      const rg = this.ctx!.createGain();
      rg.gain.value = reverb;
      g.connect(rg).connect(this.reverbIn);
    }
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + 0.05);
  }

  private tone(t: number, dur: number, vol: number, type: OscillatorType, f0: number, f1?: number, reverb = 0.25): void {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(this.sfx);
    if (reverb) {
      const rg = ctx.createGain();
      rg.gain.value = reverb;
      g.connect(rg).connect(this.reverbIn);
    }
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  play(name: string, kind?: DmgKind): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.005;
    const r = () => 0.9 + Math.random() * 0.2;
    switch (name) {
      case 'step':
        if (t - this.lastStep < 0.08) return;
        this.lastStep = t;
        this.noise(t, 0.07, 0.08, 'lowpass', 500 * r(), 200, 1, 0.05);
        break;
      case 'swing':
        this.noise(t, 0.16, 0.12, 'bandpass', 900 * r(), 3000, 2, 0.05);
        break;
      case 'hit':
        this.noise(t, 0.12, 0.35, 'lowpass', 1800 * r(), 300, 1, 0.15);
        this.tone(t, 0.15, 0.3, 'sine', 140 * r(), 50, 0.1);
        break;
      case 'crit':
        this.noise(t, 0.2, 0.45, 'lowpass', 3000, 300, 1, 0.3);
        this.tone(t, 0.25, 0.35, 'square', 90, 40, 0.2);
        this.tone(t, 0.4, 0.12, 'sine', 1800 * r(), 1200, 0.5);
        break;
      case 'miss':
        this.noise(t, 0.2, 0.1, 'bandpass', 2400 * r(), 600, 3, 0.05);
        break;
      case 'hurt':
        this.tone(t, 0.25, 0.25, 'sawtooth', 220 * r(), 90, 0.1);
        this.noise(t, 0.15, 0.25, 'lowpass', 1200, 200, 1, 0.1);
        break;
      case 'death':
        this.tone(t, 0.6, 0.25, 'sawtooth', 300 * r(), 40, 0.4);
        this.noise(t, 0.5, 0.2, 'lowpass', 1500, 100, 1, 0.4);
        break;
      case 'spell': {
        const k = kind ?? 'arcane';
        if (k === 'fire') {
          this.noise(t, 0.5, 0.35, 'bandpass', 400, 1800, 1.2, 0.4);
          this.tone(t, 0.4, 0.12, 'sawtooth', 120, 60, 0.3);
        } else if (k === 'ice') {
          for (let i = 0; i < 4; i++) this.tone(t + i * 0.04, 0.6, 0.06, 'sine', 2000 + Math.random() * 1600, undefined, 0.6);
          this.noise(t, 0.4, 0.15, 'highpass', 4000, 8000, 1, 0.5);
        } else if (k === 'lightning') {
          for (let i = 0; i < 5; i++) this.noise(t + i * 0.03, 0.06, 0.3, 'highpass', 1500 + Math.random() * 3000, undefined, 1, 0.3);
          this.tone(t, 0.3, 0.12, 'square', 80, 40, 0.3);
        } else if (k === 'holy') {
          for (const f of [523, 659, 784, 1046]) this.tone(t, 1.2, 0.06, 'triangle', f * r(), undefined, 0.7);
        } else if (k === 'poison') {
          this.noise(t, 0.3, 0.2, 'bandpass', 700, 300, 6, 0.2);
        } else if (k === 'shadow') {
          this.tone(t, 0.6, 0.15, 'sawtooth', 110, 55, 0.6);
          this.noise(t, 0.6, 0.1, 'lowpass', 600, 150, 2, 0.6);
        } else {
          this.tone(t, 0.4, 0.12, 'sine', 600, 1400, 0.5);
          this.tone(t, 0.4, 0.08, 'triangle', 900, 300, 0.5);
        }
        break;
      }
      case 'boom':
        this.noise(t, 0.8, 0.6, 'lowpass', 1200, 60, 1, 0.5);
        this.tone(t, 0.6, 0.5, 'sine', 90, 30, 0.3);
        break;
      case 'coin':
        this.tone(t, 0.12, 0.12, 'square', 1320, undefined, 0.2);
        this.tone(t + 0.07, 0.25, 0.12, 'square', 1760, undefined, 0.3);
        break;
      case 'pickup':
        this.tone(t, 0.18, 0.12, 'triangle', 660, 990, 0.3);
        break;
      case 'loot': // rare+
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.07, 0.6, 0.08, 'triangle', [784, 988, 1175, 1568][i], undefined, 0.6);
        break;
      case 'levelup':
        for (let i = 0; i < 6; i++) this.tone(t + i * 0.08, 0.9, 0.09, 'triangle', mtof(this.note(i * 2, 2)), undefined, 0.7);
        break;
      case 'chest':
        this.noise(t, 0.4, 0.15, 'bandpass', 300, 900, 4, 0.2);
        this.tone(t + 0.25, 0.5, 0.1, 'triangle', 880, undefined, 0.5);
        break;
      case 'stairs':
        for (let i = 0; i < 5; i++) this.noise(t + i * 0.14, 0.12, 0.12, 'lowpass', 600 - i * 80, 200, 1, 0.3);
        this.tone(t, 1.6, 0.1, 'sine', 220, 110, 0.6);
        break;
      case 'trap':
        this.noise(t, 0.25, 0.4, 'highpass', 2000, 500, 1, 0.2);
        this.tone(t, 0.2, 0.2, 'square', 300, 900, 0.2);
        break;
      case 'roar':
        this.tone(t, 1.6, 0.35, 'sawtooth', 70, 45, 0.6);
        this.tone(t, 1.6, 0.25, 'sawtooth', 73, 47, 0.6);
        this.noise(t, 1.4, 0.3, 'lowpass', 500, 120, 3, 0.6);
        break;
      case 'warn':
        this.tone(t, 0.5, 0.15, 'sawtooth', 160, 150, 0.3);
        this.tone(t + 0.2, 0.5, 0.15, 'sawtooth', 150, 140, 0.3);
        break;
      case 'click':
        this.tone(t, 0.05, 0.08, 'triangle', 1200, 900, 0);
        break;
      case 'heal':
        for (const f of [440, 554, 659]) this.tone(t, 0.7, 0.07, 'sine', f, f * 1.5, 0.5);
        break;
      case 'gameover':
        for (let i = 0; i < 4; i++) this.tone(t + i * 0.45, 1.6, 0.14, 'triangle', mtof(this.note(4 - i * 2, 1)), undefined, 0.8);
        break;
      case 'victory':
        for (let i = 0; i < 8; i++) this.tone(t + i * 0.12, 1.5, 0.1, 'triangle', mtof(this.scale.root + 24 + [0, 4, 7, 12, 7, 12, 16, 19][i]), undefined, 0.8);
        break;
      default:
    }
  }
}

export const audio = new Audio();
