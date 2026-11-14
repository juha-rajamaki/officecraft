// Procedural sound effects: everything is synthesised with Web Audio, no audio files.
// Browsers only allow audio after a user gesture, so call unlock() from a click/keypress.
import {
  GRASS, DIRT, STONE, COBBLE, SAND, LOG, LEAVES, PLANKS, GLASS, BRICK, SNOW, BEDROCK,
  COAL_ORE, IRON_ORE, GRAVEL, LAMP,
} from './blocks.js';

// block id -> material family
const MAT = [];
for (const id of [GRASS, DIRT, LEAVES]) MAT[id] = 'grass';
for (const id of [STONE, COBBLE, BRICK, BEDROCK, COAL_ORE, IRON_ORE]) MAT[id] = 'stone';
for (const id of [LOG, PLANKS]) MAT[id] = 'wood';
MAT[SAND] = 'sand';
MAT[GRAVEL] = 'gravel';
MAT[SNOW] = 'snow';
MAT[GLASS] = 'glass';
MAT[LAMP] = 'glass';

// f = band-pass centre, q = resonance, dur = decay (s), g = loudness, tone = optional pitched knock (Hz)
const MATS = {
  grass:  { f: 900,  q: 0.7, dur: 0.12, g: 0.55 },
  stone:  { f: 2000, q: 1.4, dur: 0.07, g: 0.6, tone: 190 },
  wood:   { f: 650,  q: 2.2, dur: 0.09, g: 0.65, tone: 150 },
  sand:   { f: 3000, q: 0.6, dur: 0.14, g: 0.4 },
  gravel: { f: 1500, q: 0.7, dur: 0.13, g: 0.55 },
  snow:   { f: 2500, q: 0.5, dur: 0.16, g: 0.35 },
  glass:  { f: 3800, q: 3.5, dur: 0.06, g: 0.45, tone: 1700 },
};
const mat = (id) => MATS[MAT[id] || 'stone'];

const HEARING = 32;   // blocks: positional sounds beyond this are skipped
const MAX_VOICES = 48; // cap on simultaneous one-shot sounds

export class Sound {
  constructor(volume = 0.7) {
    this.ctx = null;
    this.volume = volume;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.cricketT = 2;
    this.active = 0;   // one-shot voices currently playing
    this.disposed = false;
    this.ambTarget = -1;
    this.windTarget = -1;
  }

  /** only make sounds while the context is actually running (a suspended one would queue them all) */
  get ready() {
    return !!this.ctx && this.ctx.state === 'running' && this.active < MAX_VOICES;
  }

  /** create / resume the AudioContext; must run inside a user gesture */
  unlock() {
    if (this.disposed) return;
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = (this.ctx = new AC());

    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(ctx.destination);
    // everything goes through this low-pass, which closes when underwater
    this.muffle = ctx.createBiquadFilter();
    this.muffle.type = 'lowpass';
    this.muffle.frequency.value = 20000;
    this.muffle.connect(this.master);

    // 2 s of white noise, reused by every noisy sound
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // ambient wind: looping noise through a slowly wobbling low-pass
    this.ambient = ctx.createGain();
    this.ambient.gain.value = 0;
    this.ambient.connect(this.muffle);
    const wind = ctx.createBufferSource();
    wind.buffer = this.noiseBuf;
    wind.loop = true;
    const wf = ctx.createBiquadFilter();
    wf.type = 'lowpass';
    wf.frequency.value = 420;
    wf.Q.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 220;
    lfo.connect(lfoAmt).connect(wf.frequency);
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    wind.connect(wf).connect(this.windGain).connect(this.ambient);
    wind.start();
    lfo.start();
  }

  dispose() {
    this.disposed = true;
    if (this.ctx) this.ctx.close().catch(() => {});
    this.ctx = null;
  }

  setVolume(v) {
    v = Math.min(1, Math.max(0, +v || 0));
    this.volume = v;
    if (this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  /** pause all audio (hidden tab) / bring it back */
  suspend() {
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended' && !this.disposed) this.ctx.resume().catch(() => {});
  }

  setUnderwater(on) {
    if (this.ctx) this.muffle.frequency.setTargetAtTime(on ? 550 : 20000, this.ctx.currentTime, 0.08);
  }

  setListener(pos, eyeY, yaw) {
    const l = this.listener;
    l.x = pos.x; l.y = pos.y + eyeY; l.z = pos.z; l.yaw = yaw;
  }

  /** per-frame ambience: wind grows with altitude, crickets chirp at night */
  update(dt, { height, night, paused, underground }) {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const t = this.ctx.currentTime;
    // only schedule automation when the target actually changes
    const amb = paused ? 0 : 1;
    if (amb !== this.ambTarget) { this.ambTarget = amb; this.ambient.gain.setTargetAtTime(amb, t, 0.3); }
    const alt = Math.min(1, Math.max(0, (height - 40) / 45));
    const wind = Math.round((underground ? 0.01 : 0.025 + alt * 0.09) * 200) / 200;
    if (wind !== this.windTarget) { this.windTarget = wind; this.windGain.gain.setTargetAtTime(wind, t, 0.5); }
    if (paused || underground || night < 0.5) return;
    this.cricketT -= dt;
    if (this.cricketT <= 0) {
      this.cricketT = 0.6 + Math.random() * 2.5;
      const f = 4200 + Math.random() * 600;
      for (let i = 0; i < 3; i++) {
        this.tone({ type: 'sine', f0: f, f1: f, dur: 0.035, gain: 0.025 * night, at: i * 0.06, dest: this.ambient });
      }
    }
  }

  // ---------------- building blocks ----------------
  /** output node for a sound: plain, or panned + attenuated if it has a world position */
  out(pos, dest) {
    const ctx = this.ctx;
    const target = dest || this.muffle;
    if (!pos) return target;
    const l = this.listener;
    const dx = pos.x - l.x, dy = (pos.y ?? l.y) - l.y, dz = pos.z - l.z;
    const dist = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(dist) || dist > HEARING) return null;
    const g = ctx.createGain();
    g.gain.value = 1 / (1 + dist * 0.18);
    const pan = ctx.createStereoPanner();
    // camera right vector is (cos yaw, -sin yaw); pan by how far to the side the source is
    const hd = Math.hypot(dx, dz);
    const side = hd > 0.01 ? (dx * Math.cos(l.yaw) - dz * Math.sin(l.yaw)) / hd : 0;
    pan.pan.value = Math.max(-1, Math.min(1, side)) * 0.8;
    g.connect(pan).connect(target);
    return g;
  }

  /** filtered noise burst */
  /** count a voice while it plays, so MAX_VOICES can cap pile-ups */
  track(node) {
    this.active++;
    node.onended = () => { this.active--; };
  }

  noise({ f = 1000, q = 1, type = 'bandpass', dur = 0.1, gain = 0.5, attack = 0.003, sweep, at = 0, pos, dest }) {
    if (!this.ready) return;
    const o = this.out(pos, dest);
    if (!o) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.setValueAtTime(f, t);
    if (sweep) flt.frequency.exponentialRampToValueAtTime(sweep, t + dur);
    flt.Q.value = q;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(env).connect(o);
    this.track(src);
    src.start(t, Math.random() * Math.max(0, 1.9 - dur)); // random offset, but never past the buffer end
    src.stop(t + dur + 0.05);
  }

  /** pitched blip with a frequency glide */
  tone({ type = 'sine', f0 = 440, f1 = f0, dur = 0.1, gain = 0.3, attack = 0.005, at = 0, pos, dest }) {
    if (!this.ready) return;
    const o = this.out(pos, dest);
    if (!o) return;
    const ctx = this.ctx, t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(gain, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(env).connect(o);
    this.track(osc);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  /** material "knock": noise + optional pitched body */
  hit(id, { gain = 1, dur = 1, pitch = 1, at = 0 } = {}) {
    const m = mat(id);
    const r = 0.9 + Math.random() * 0.2;
    this.noise({ f: m.f * pitch * r, q: m.q, dur: m.dur * dur, gain: m.g * gain, at });
    if (m.tone) this.tone({ type: 'triangle', f0: m.tone * pitch * r, f1: m.tone * pitch * 0.6, dur: m.dur * dur, gain: m.g * gain * 0.5, at });
  }

  // ---------------- game events ----------------
  step(id) {
    this.stepSide = !this.stepSide; // left/right feet sound slightly different
    this.hit(id, { gain: 0.35, dur: 0.9, pitch: this.stepSide ? 1.06 : 0.94 });
  }
  land(id, strength) { this.hit(id, { gain: 0.5 + Math.min(0.6, strength * 0.12), dur: 1.6, pitch: 0.7 }); }
  mineHit(id) { this.hit(id, { gain: 0.5, dur: 0.8, pitch: 1.15 }); }

  breakBlock(id) {
    if (MAT[id] === 'glass') {
      for (let i = 0; i < 5; i++) this.tone({ type: 'sine', f0: 2500 + Math.random() * 2500, f1: 1800, dur: 0.12, gain: 0.12, at: i * 0.025 });
      this.noise({ f: 5000, q: 0.8, type: 'highpass', dur: 0.3, gain: 0.35 });
      return;
    }
    this.hit(id, { gain: 0.9, dur: 2.2, pitch: 0.8 });
    this.hit(id, { gain: 0.5, dur: 1.5, pitch: 0.6, at: 0.04 });
  }

  place(id) { this.hit(id, { gain: 0.7, dur: 1.3, pitch: 0.9 }); }

  pickup() {
    this.tone({ type: 'sine', f0: 700, f1: 1300, dur: 0.08, gain: 0.12, at: 0.06 });
  }

  swing() { this.noise({ f: 600, q: 1.2, dur: 0.18, gain: 0.3, attack: 0.05, sweep: 2400 }); }

  hitEnemy(pos) {
    this.noise({ f: 300, q: 1, type: 'lowpass', dur: 0.15, gain: 0.7, pos });
    this.tone({ type: 'sawtooth', f0: 160, f1: 70, dur: 0.22, gain: 0.25, pos });
  }

  enemyDie(pos, quiet = false) {
    const g = quiet ? 0.4 : 1;
    this.tone({ type: 'sawtooth', f0: 240, f1: 40, dur: 0.8, gain: 0.25 * g, attack: 0.02, pos });
    this.noise({ f: 800, q: 0.7, type: 'lowpass', dur: 0.7, gain: 0.3 * g, sweep: 120, attack: 0.05, pos });
  }

  growl(pos) {
    const f = 70 + Math.random() * 30;
    this.tone({ type: 'sawtooth', f0: f, f1: f * 0.7, dur: 0.7, gain: 0.18, attack: 0.12, pos });
    this.noise({ f: 250, q: 3, dur: 0.6, gain: 0.15, attack: 0.15, pos });
  }

  enemyAttack(pos) { this.tone({ type: 'square', f0: 220, f1: 90, dur: 0.15, gain: 0.15, pos }); }

  bonk(pos) {
    this.tone({ type: 'sine', f0: 900, f1: 300, dur: 0.18, gain: 0.35, pos });
    this.tone({ type: 'triangle', f0: 1300, f1: 1700, dur: 0.1, gain: 0.12, at: 0.08, pos });
  }

  hop(pos) { this.tone({ type: 'sine', f0: 380, f1: 720, dur: 0.09, gain: 0.12, pos }); }

  hurt() {
    this.tone({ type: 'square', f0: 330, f1: 150, dur: 0.18, gain: 0.18 });
    this.noise({ f: 400, q: 0.8, type: 'lowpass', dur: 0.12, gain: 0.4 });
  }

  death() {
    [392, 330, 262, 196].forEach((f, i) => this.tone({ type: 'triangle', f0: f, f1: f * 0.97, dur: 0.35, gain: 0.2, at: i * 0.22 }));
  }

  respawn() {
    [262, 330, 392, 523].forEach((f, i) => this.tone({ type: 'sine', f0: f, dur: 0.18, gain: 0.15, at: i * 0.07 }));
  }

  splash(strength = 1) {
    this.noise({ f: 1200, q: 0.5, dur: 0.35 + strength * 0.2, gain: 0.25 + strength * 0.25, attack: 0.01, sweep: 400 });
    this.tone({ type: 'sine', f0: 500, f1: 180, dur: 0.12, gain: 0.08 * strength });
  }

  swim() { this.noise({ f: 700, q: 0.8, type: 'lowpass', dur: 0.25, gain: 0.12, attack: 0.06 }); }

  click() { this.tone({ type: 'square', f0: 1400, f1: 1200, dur: 0.025, gain: 0.05 }); }
  invOpen() { this.noise({ f: 1800, q: 0.9, dur: 0.12, gain: 0.25, sweep: 900 }); }
  craft() {
    this.pickup();
    [784, 988, 1175].forEach((f, i) => this.tone({ type: 'triangle', f0: f, dur: 0.16, gain: 0.09, at: 0.05 + i * 0.06 }));
  }
  invClose() { this.noise({ f: 900, q: 0.9, dur: 0.1, gain: 0.25, sweep: 1800 }); }

  fly(on) {
    this.noise({ f: on ? 400 : 1600, q: 1, dur: 0.45, gain: 0.25, attack: 0.08, sweep: on ? 1800 : 350 });
  }
}
