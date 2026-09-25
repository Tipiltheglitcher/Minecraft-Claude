// Moteur audio procédural (Web Audio API) : bruitages et musique générative
import { BLOCKS } from '../data/blocks.js';

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.musicTimer = 20 * 30;
    this.playing = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
    } catch (e) {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    // bruit blanc
    const len = ctx.sampleRate * 2;
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    // réverbération
    this.reverb = ctx.createConvolver();
    const rl = ctx.sampleRate * 3;
    const ir = ctx.createBuffer(2, rl, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < rl; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / rl, 3);
    }
    this.reverb.buffer = ir;
    this.reverbGain = ctx.createGain();
    this.reverbGain.gain.value = 0.35;
    this.reverb.connect(this.reverbGain);
    this.reverbGain.connect(this.master);
    this.applyVolumes();
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.game.settings;
    this.master.gain.value = s.volume;
    this.sfx.gain.value = s.sfxVolume;
    this.musicGain.gain.value = s.musicVolume * 0.5;
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  // ---------- primitives ----------
  out(x, y, z, vol, range = 16) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    let v = vol;
    let pan = 0;
    if (x !== undefined && x !== null) {
      const L = this.listener;
      const dx = x - L.x, dy = y - L.y, dz = z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > range) return null;
      v *= Math.max(0, 1 - d / range);
      // panoramique : projection sur le vecteur droite
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.8 : 0;
    }
    if (v < 0.01) return null;
    g.gain.value = v;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
    } else g.connect(this.sfx);
    return g;
  }

  noiseBurst(dest, t0, dur, { type = 'bandpass', freq = 1000, q = 1, vol = 1, attack = 0.005, freqEnd, rate = 1 } = {}) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = rate;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(dest);
    src.start(t0, Math.random() * 1.5);
    src.stop(t0 + dur + 0.05);
  }

  tone(dest, t0, dur, { type = 'sine', freq = 440, freqEnd, vol = 0.5, attack = 0.005, vibrato = 0, vibRate = 6, filter, release } = {}) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (freqEnd) o.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + dur);
    if (vibrato) {
      const l = ctx.createOscillator();
      const lg = ctx.createGain();
      l.frequency.value = vibRate;
      lg.gain.value = vibrato;
      l.connect(lg); lg.connect(o.frequency);
      l.start(t0); l.stop(t0 + dur + 0.1);
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + (release || dur));
    let last = o;
    if (filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = filter;
      o.connect(f);
      last = f;
    }
    last.connect(g);
    g.connect(dest);
    o.start(t0);
    o.stop(t0 + (release || dur) + 0.05);
  }

  // ---------- sons ----------
  play(name, x, y, z, vol = 1, pitch = 1) {
    if (!this.ctx || !this.game.settings) return;
    if (this.playing > 40) return;
    const gen = SOUNDS[name];
    if (!gen) return;
    const range = BIG.has(name) ? 64 : name.startsWith('dragon') ? 128 : 16;
    const dest = this.out(x, y, z, vol, range);
    if (!dest) return;
    const t0 = this.ctx.currentTime + 0.01;
    this.playing++;
    setTimeout(() => this.playing--, 300);
    try {
      gen(this, dest, t0, pitch * (0.95 + Math.random() * 0.1));
    } catch (e) {
      // ignore
    }
  }

  ui(name) {
    this.play(name, null, null, null, 0.6, 1);
  }

  blockSound(material, action, x, y, z) {
    const m = material || 'stone';
    const vol = action === 'step' ? 0.25 : action === 'hit' ? 0.2 : action === 'place' ? 0.7 : 0.8;
    this.play('mat_' + m + (action === 'step' || action === 'hit' ? '_step' : ''), x, y, z, vol, action === 'place' ? 0.85 : action === 'hit' ? 0.6 : 1);
  }

  step(blockId, x, y, z) {
    const d = BLOCKS[blockId];
    if (!d) return;
    this.blockSound(d.sound, 'step', x, y, z);
  }

  // ---------- musique ----------
  tickMusic() {
    if (!this.ctx || this.game.settings.musicVolume <= 0) return;
    if (--this.musicTimer > 0) return;
    this.musicTimer = 20 * (60 + Math.random() * 120);
    this.playPiece(this.game.world ? this.game.world.dim : 'overworld');
  }

  playPiece(dim) {
    const ctx = this.ctx;
    const scales = {
      overworld: [[0, 2, 4, 7, 9], [0, 3, 5, 7, 10], [0, 2, 4, 5, 7, 9, 11]],
      nether: [[0, 1, 5, 6, 8], [0, 3, 6, 8, 11]],
      end: [[0, 2, 3, 7, 8], [0, 5, 7, 10]],
      menu: [[0, 4, 7, 9, 11, 14]],
    };
    const sc = scales[dim] || scales.overworld;
    const scale = sc[Math.floor(Math.random() * sc.length)];
    const root = dim === 'nether' ? 45 : dim === 'end' ? 50 : 52 + Math.floor(Math.random() * 7);
    const n = 10 + Math.floor(Math.random() * 16);
    let t = ctx.currentTime + 0.5;
    let deg = Math.floor(Math.random() * scale.length);
    const dest = ctx.createGain();
    dest.gain.value = 0.9;
    dest.connect(this.musicGain);
    dest.connect(this.reverb);
    for (let i = 0; i < n; i++) {
      deg += Math.floor(Math.random() * 5) - 2;
      deg = Math.max(0, Math.min(scale.length * 2 - 1, deg));
      const oct = Math.floor(deg / scale.length);
      const midi = root + scale[deg % scale.length] + oct * 12;
      this.pianoNote(dest, t, midi, 0.18 + Math.random() * 0.08, dim);
      if (Math.random() < 0.3) this.pianoNote(dest, t, midi - 12, 0.1, dim);
      if (Math.random() < 0.15) this.pianoNote(dest, t, midi + (scale[(deg + 2) % scale.length] - scale[deg % scale.length]), 0.08, dim);
      t += [0.5, 0.75, 1, 1, 1.5, 2][Math.floor(Math.random() * 6)] * (dim === 'end' ? 1.4 : 1);
    }
  }

  pianoNote(dest, t0, midi, vol, dim) {
    const ctx = this.ctx;
    const f = 440 * Math.pow(2, (midi - 69) / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(vol * 0.4, t0 + 0.3);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + 3.5);
    g.connect(dest);
    const types = dim === 'nether' ? ['triangle', 'sawtooth'] : ['sine', 'triangle'];
    types.forEach((type, i) => {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * (i ? 2.001 : 1);
      const og = ctx.createGain();
      og.gain.value = i ? 0.15 : 1;
      if (type === 'sawtooth') {
        const fl = ctx.createBiquadFilter();
        fl.type = 'lowpass'; fl.frequency.value = 900;
        o.connect(fl); fl.connect(og);
      } else o.connect(og);
      og.connect(g);
      o.start(t0);
      o.stop(t0 + 3.6);
    });
  }

  // Jingle de victoire (générique)
  playCredits() {
    if (!this.ctx) return;
    const dest = this.ctx.createGain();
    dest.gain.value = 1;
    dest.connect(this.musicGain);
    dest.connect(this.reverb);
    const prog = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];
    let t = this.ctx.currentTime + 0.5;
    for (let r = 0; r < 8; r++)
      for (const chord of prog) {
        for (const m of chord) this.pianoNote(dest, t, m, 0.08, 'overworld');
        this.pianoNote(dest, t + 0.75, chord[2] + 12, 0.1, 'overworld');
        this.pianoNote(dest, t + 1.5, chord[1] + 12, 0.08, 'overworld');
        t += 2.4;
      }
  }
}

const BIG = new Set(['explode', 'ghast', 'ghast_shoot', 'ghast_warn', 'ghast_death', 'levelup', 'portal_travel', 'thunder', 'end_portal', 'enderman_scream']);

// Générateurs : (audio, destination, t0, pitch)
const SOUNDS = {
  mat_stone: (a, d, t, p) => { a.noiseBurst(d, t, 0.15, { freq: 1800 * p, q: 1.5, vol: 0.8 }); a.noiseBurst(d, t + 0.02, 0.1, { freq: 800 * p, q: 2, vol: 0.4 }); },
  mat_stone_step: (a, d, t, p) => a.noiseBurst(d, t, 0.08, { freq: 1600 * p, q: 1.2, vol: 0.7 }),
  mat_wood: (a, d, t, p) => { a.noiseBurst(d, t, 0.12, { type: 'lowpass', freq: 900 * p, vol: 0.7 }); a.tone(d, t, 0.15, { type: 'triangle', freq: 220 * p, freqEnd: 150 * p, vol: 0.5 }); },
  mat_wood_step: (a, d, t, p) => { a.noiseBurst(d, t, 0.07, { type: 'lowpass', freq: 800 * p, vol: 0.6 }); a.tone(d, t, 0.08, { type: 'triangle', freq: 200 * p, vol: 0.3 }); },
  mat_gravel: (a, d, t, p) => { for (let i = 0; i < 4; i++) a.noiseBurst(d, t + i * 0.025, 0.06, { type: 'lowpass', freq: 700 * p, vol: 0.7 }); },
  mat_gravel_step: (a, d, t, p) => { for (let i = 0; i < 2; i++) a.noiseBurst(d, t + i * 0.03, 0.05, { type: 'lowpass', freq: 600 * p, vol: 0.6 }); },
  mat_grass: (a, d, t, p) => a.noiseBurst(d, t, 0.15, { type: 'highpass', freq: 1500 * p, vol: 0.5, freqEnd: 3000 }),
  mat_grass_step: (a, d, t, p) => a.noiseBurst(d, t, 0.09, { type: 'bandpass', freq: 2500 * p, q: 0.7, vol: 0.4 }),
  mat_sand: (a, d, t, p) => a.noiseBurst(d, t, 0.15, { type: 'highpass', freq: 2500 * p, vol: 0.5 }),
  mat_sand_step: (a, d, t, p) => a.noiseBurst(d, t, 0.08, { type: 'highpass', freq: 2200 * p, vol: 0.4 }),
  mat_glass: (a, d, t, p) => { for (let i = 0; i < 5; i++) a.tone(d, t + i * 0.02, 0.3, { freq: (1500 + Math.random() * 2500) * p, vol: 0.15 }); a.noiseBurst(d, t, 0.2, { type: 'highpass', freq: 4000, vol: 0.4 }); },
  mat_glass_step: (a, d, t, p) => a.noiseBurst(d, t, 0.06, { freq: 3000 * p, q: 2, vol: 0.4 }),
  mat_cloth: (a, d, t, p) => a.noiseBurst(d, t, 0.12, { type: 'lowpass', freq: 500 * p, vol: 0.6 }),
  mat_cloth_step: (a, d, t, p) => a.noiseBurst(d, t, 0.08, { type: 'lowpass', freq: 400 * p, vol: 0.5 }),
  mat_snow: (a, d, t, p) => { for (let i = 0; i < 3; i++) a.noiseBurst(d, t + i * 0.03, 0.07, { freq: 1200 * p, q: 0.8, vol: 0.4 }); },
  mat_snow_step: (a, d, t, p) => a.noiseBurst(d, t, 0.08, { freq: 1100 * p, q: 0.8, vol: 0.4 }),
  mat_metal: (a, d, t, p) => { a.tone(d, t, 0.4, { freq: 900 * p, vol: 0.25 }); a.tone(d, t, 0.35, { freq: 1370 * p, vol: 0.15 }); a.noiseBurst(d, t, 0.1, { freq: 3000, q: 3, vol: 0.4 }); },
  mat_metal_step: (a, d, t, p) => { a.tone(d, t, 0.15, { freq: 800 * p, vol: 0.12 }); a.noiseBurst(d, t, 0.06, { freq: 2500, q: 3, vol: 0.3 }); },
  pop: (a, d, t, p) => a.tone(d, t, 0.08, { freq: 500 * p, freqEnd: 1000 * p, vol: 0.4 }),
  click: (a, d, t) => { a.tone(d, t, 0.04, { type: 'square', freq: 1800, vol: 0.15 }); },
  player_hurt: (a, d, t, p) => { a.tone(d, t, 0.2, { type: 'sawtooth', freq: 200 * p, freqEnd: 110 * p, vol: 0.5, filter: 900 }); a.noiseBurst(d, t, 0.08, { type: 'lowpass', freq: 600, vol: 0.4 }); },
  fall_small: (a, d, t) => a.noiseBurst(d, t, 0.15, { type: 'lowpass', freq: 400, vol: 0.8 }),
  fall_big: (a, d, t) => { a.noiseBurst(d, t, 0.3, { type: 'lowpass', freq: 300, vol: 1 }); a.tone(d, t, 0.3, { freq: 80, freqEnd: 40, vol: 0.6 }); },
  pig: (a, d, t, p) => { a.tone(d, t, 0.18, { type: 'square', freq: 260 * p, freqEnd: 180 * p, vol: 0.25, filter: 1200, vibrato: 30, vibRate: 30 }); a.tone(d, t + 0.22, 0.14, { type: 'square', freq: 240 * p, freqEnd: 170 * p, vol: 0.2, filter: 1200, vibrato: 30, vibRate: 30 }); },
  pig_hurt: (a, d, t, p) => a.tone(d, t, 0.25, { type: 'square', freq: 500 * p, freqEnd: 300 * p, vol: 0.3, filter: 2000, vibrato: 40, vibRate: 25 }),
  cow: (a, d, t, p) => a.tone(d, t, 1.0, { type: 'sawtooth', freq: 130 * p, freqEnd: 105 * p, vol: 0.35, filter: 700, attack: 0.1, vibrato: 3, vibRate: 5 }),
  cow_hurt: (a, d, t, p) => a.tone(d, t, 0.4, { type: 'sawtooth', freq: 180 * p, freqEnd: 120 * p, vol: 0.4, filter: 900 }),
  sheep: (a, d, t, p) => a.tone(d, t, 0.6, { type: 'sawtooth', freq: 320 * p, freqEnd: 290 * p, vol: 0.25, filter: 1500, vibrato: 25, vibRate: 12, attack: 0.05 }),
  chicken: (a, d, t, p) => { for (let i = 0; i < 3; i++) a.tone(d, t + i * 0.09, 0.06, { type: 'square', freq: (900 + i * 100) * p, freqEnd: 700 * p, vol: 0.12, filter: 3000 }); },
  chicken_hurt: (a, d, t, p) => a.tone(d, t, 0.15, { type: 'square', freq: 1200 * p, freqEnd: 800 * p, vol: 0.2, filter: 3000 }),
  zombie: (a, d, t, p) => a.tone(d, t, 1.1, { type: 'sawtooth', freq: 95 * p, freqEnd: 75 * p, vol: 0.35, filter: 500, attack: 0.2, vibrato: 8, vibRate: 4 }),
  zombie_hurt: (a, d, t, p) => a.tone(d, t, 0.35, { type: 'sawtooth', freq: 140 * p, freqEnd: 90 * p, vol: 0.4, filter: 700, vibrato: 10, vibRate: 12 }),
  zombie_death: (a, d, t, p) => a.tone(d, t, 0.9, { type: 'sawtooth', freq: 120 * p, freqEnd: 50 * p, vol: 0.4, filter: 600 }),
  skeleton: (a, d, t, p) => { for (let i = 0; i < 6; i++) a.noiseBurst(d, t + i * 0.05, 0.03, { freq: 2500 * p, q: 5, vol: 0.4 }); },
  skeleton_hurt: (a, d, t, p) => { for (let i = 0; i < 4; i++) a.noiseBurst(d, t + i * 0.03, 0.03, { freq: 3000 * p, q: 4, vol: 0.5 }); },
  skeleton_death: (a, d, t, p) => { for (let i = 0; i < 10; i++) a.noiseBurst(d, t + i * 0.04, 0.03, { freq: (2000 + Math.random() * 1500) * p, q: 5, vol: 0.4 }); },
  creeper_hurt: (a, d, t, p) => a.noiseBurst(d, t, 0.3, { freq: 1500 * p, q: 0.8, vol: 0.4 }),
  hiss: (a, d, t) => a.noiseBurst(d, t, 1.4, { type: 'highpass', freq: 2500, vol: 0.5, attack: 0.3, freqEnd: 5000 }),
  fuse: (a, d, t) => a.noiseBurst(d, t, 1.2, { type: 'highpass', freq: 3000, vol: 0.4, attack: 0.1 }),
  spider: (a, d, t, p) => { for (let i = 0; i < 3; i++) a.noiseBurst(d, t + i * 0.07, 0.06, { freq: 1800 * p, q: 3, vol: 0.4 }); },
  spider_death: (a, d, t, p) => a.noiseBurst(d, t, 0.5, { freq: 1500 * p, q: 2, vol: 0.5, freqEnd: 500 }),
  enderman: (a, d, t, p) => { a.tone(d, t, 0.6, { freq: 300 * p, freqEnd: 150 * p, vol: 0.25, vibrato: 40, vibRate: 7 }); a.tone(d, t + 0.3, 0.5, { freq: 150 * p, freqEnd: 350 * p, vol: 0.2 }); },
  enderman_hurt: (a, d, t, p) => a.tone(d, t, 0.4, { type: 'sawtooth', freq: 400 * p, freqEnd: 200 * p, vol: 0.3, filter: 1500, vibrato: 50, vibRate: 20 }),
  enderman_death: (a, d, t, p) => a.tone(d, t, 1.2, { type: 'sawtooth', freq: 300 * p, freqEnd: 60 * p, vol: 0.4, filter: 1200, vibrato: 30, vibRate: 10 }),
  enderman_scream: (a, d, t, p) => { a.tone(d, t, 1.0, { type: 'sawtooth', freq: 700 * p, freqEnd: 900 * p, vol: 0.3, filter: 3000, vibrato: 80, vibRate: 15 }); a.noiseBurst(d, t, 0.8, { freq: 2000, q: 1, vol: 0.2 }); },
  teleport: (a, d, t, p) => { a.tone(d, t, 0.35, { freq: 200 * p, freqEnd: 800 * p, vol: 0.3 }); a.tone(d, t + 0.1, 0.3, { freq: 800 * p, freqEnd: 200 * p, vol: 0.2 }); },
  blaze: (a, d, t, p) => a.noiseBurst(d, t, 0.8, { type: 'lowpass', freq: 600 * p, vol: 0.5, attack: 0.2, freqEnd: 300 }),
  blaze_hurt: (a, d, t, p) => a.noiseBurst(d, t, 0.3, { freq: 1200 * p, q: 1, vol: 0.5 }),
  blaze_death: (a, d, t, p) => a.noiseBurst(d, t, 1, { type: 'lowpass', freq: 1500 * p, vol: 0.6, freqEnd: 100 }),
  blaze_charge: (a, d, t) => a.noiseBurst(d, t, 0.6, { type: 'lowpass', freq: 400, vol: 0.5, attack: 0.3, freqEnd: 1200 }),
  blaze_shoot: (a, d, t, p) => { a.noiseBurst(d, t, 0.3, { freq: 900 * p, q: 0.7, vol: 0.6 }); a.tone(d, t, 0.2, { type: 'sawtooth', freq: 150, freqEnd: 60, vol: 0.2, filter: 600 }); },
  ghast: (a, d, t, p) => a.tone(d, t, 1.4, { freq: 420 * p, freqEnd: 260 * p, vol: 0.3, vibrato: 30, vibRate: 3, attack: 0.3 }),
  ghast_hurt: (a, d, t, p) => a.tone(d, t, 0.6, { type: 'sawtooth', freq: 700 * p, freqEnd: 400 * p, vol: 0.3, filter: 2000 }),
  ghast_death: (a, d, t, p) => a.tone(d, t, 1.6, { type: 'sawtooth', freq: 600 * p, freqEnd: 100 * p, vol: 0.4, filter: 2000, vibrato: 20, vibRate: 6 }),
  ghast_warn: (a, d, t, p) => a.tone(d, t, 0.8, { type: 'sawtooth', freq: 900 * p, freqEnd: 1300 * p, vol: 0.3, filter: 3000, vibrato: 60, vibRate: 12 }),
  ghast_shoot: (a, d, t) => { a.noiseBurst(d, t, 0.4, { type: 'lowpass', freq: 1200, vol: 0.7, freqEnd: 200 }); },
  piglin: (a, d, t, p) => { a.tone(d, t, 0.2, { type: 'square', freq: 180 * p, freqEnd: 140 * p, vol: 0.25, filter: 900, vibrato: 20, vibRate: 25 }); },
  piglin_hurt: (a, d, t, p) => a.tone(d, t, 0.3, { type: 'square', freq: 350 * p, freqEnd: 200 * p, vol: 0.3, filter: 1500, vibrato: 30, vibRate: 25 }),
  piglin_angry: (a, d, t, p) => a.tone(d, t, 0.5, { type: 'sawtooth', freq: 250 * p, freqEnd: 400 * p, vol: 0.35, filter: 1500, vibrato: 30, vibRate: 25 }),
  villager: (a, d, t, p) => a.tone(d, t, 0.35, { type: 'square', freq: 260 * p, freqEnd: 200 * p, vol: 0.15, filter: 900, vibrato: 10, vibRate: 8 }),
  villager_hurt: (a, d, t, p) => a.tone(d, t, 0.3, { type: 'square', freq: 350 * p, freqEnd: 220 * p, vol: 0.2, filter: 1200 }),
  golem_hurt: (a, d, t) => { a.tone(d, t, 0.3, { freq: 120, freqEnd: 80, vol: 0.4 }); a.noiseBurst(d, t, 0.2, { freq: 800, q: 3, vol: 0.3 }); },
  golem_attack: (a, d, t) => a.noiseBurst(d, t, 0.3, { type: 'lowpass', freq: 500, vol: 0.8 }),
  slime: (a, d, t, p) => { a.noiseBurst(d, t, 0.12, { type: 'lowpass', freq: 500 * p, vol: 0.5 }); a.tone(d, t, 0.12, { freq: 150 * p, freqEnd: 90 * p, vol: 0.3 }); },
  explode: (a, d, t) => {
    a.noiseBurst(d, t, 1.8, { type: 'lowpass', freq: 1200, vol: 1, freqEnd: 60 });
    a.tone(d, t, 1.2, { freq: 70, freqEnd: 25, vol: 0.8 });
  },
  bow: (a, d, t, p) => { a.tone(d, t, 0.2, { type: 'triangle', freq: 400 * p, freqEnd: 150 * p, vol: 0.4 }); a.noiseBurst(d, t, 0.15, { type: 'highpass', freq: 2000, vol: 0.3 }); },
  arrow_hit: (a, d, t, p) => a.noiseBurst(d, t, 0.1, { type: 'lowpass', freq: 800 * p, vol: 0.5 }),
  ding: (a, d, t) => a.tone(d, t, 0.3, { freq: 1400, vol: 0.3 }),
  eat: (a, d, t, p) => { for (let i = 0; i < 3; i++) a.noiseBurst(d, t + i * 0.06, 0.05, { freq: 1200 * p, q: 1, vol: 0.4 }); },
  burp: (a, d, t) => a.tone(d, t, 0.3, { type: 'sawtooth', freq: 110, freqEnd: 80, vol: 0.3, filter: 500, vibrato: 15, vibRate: 30 }),
  drink: (a, d, t) => { for (let i = 0; i < 3; i++) a.tone(d, t + i * 0.12, 0.08, { freq: 300 + i * 80, freqEnd: 500, vol: 0.2 }); },
  levelup: (a, d, t) => { [60, 64, 67, 72].forEach((m, i) => a.tone(d, t + i * 0.08, 0.5, { type: 'triangle', freq: 440 * Math.pow(2, (m - 57) / 12), vol: 0.25 })); },
  xp: (a, d, t, p) => a.tone(d, t, 0.15, { freq: 1200 * p, freqEnd: 1600 * p, vol: 0.12 }),
  door_open: (a, d, t) => { a.noiseBurst(d, t, 0.25, { type: 'lowpass', freq: 700, vol: 0.5 }); a.tone(d, t, 0.2, { type: 'triangle', freq: 180, freqEnd: 220, vol: 0.3 }); },
  door_close: (a, d, t) => { a.noiseBurst(d, t, 0.15, { type: 'lowpass', freq: 600, vol: 0.6 }); a.tone(d, t, 0.12, { type: 'triangle', freq: 150, vol: 0.4 }); },
  chest_open: (a, d, t) => { a.tone(d, t, 0.4, { type: 'sawtooth', freq: 180, freqEnd: 260, vol: 0.15, filter: 800 }); a.noiseBurst(d, t, 0.3, { type: 'lowpass', freq: 500, vol: 0.3 }); },
  chest_close: (a, d, t) => { a.noiseBurst(d, t, 0.15, { type: 'lowpass', freq: 500, vol: 0.6 }); },
  fizz: (a, d, t) => a.noiseBurst(d, t, 0.5, { type: 'highpass', freq: 3000, vol: 0.5, freqEnd: 6000 }),
  splash: (a, d, t) => a.noiseBurst(d, t, 0.5, { type: 'bandpass', freq: 1200, q: 0.5, vol: 0.6, freqEnd: 400 }),
  swim: (a, d, t) => a.noiseBurst(d, t, 0.3, { type: 'bandpass', freq: 900, q: 0.7, vol: 0.4 }),
  glass: (a, d, t) => SOUNDS.mat_glass(a, d, t, 1),
  item_break: (a, d, t) => { a.noiseBurst(d, t, 0.2, { freq: 2500, q: 2, vol: 0.5 }); a.tone(d, t, 0.2, { freq: 900, freqEnd: 500, vol: 0.2 }); },
  portal: (a, d, t) => a.tone(d, t, 3, { type: 'sawtooth', freq: 60, freqEnd: 90, vol: 0.2, filter: 400, vibrato: 10, vibRate: 2, attack: 0.5 }),
  portal_travel: (a, d, t) => { a.tone(d, t, 4, { type: 'sawtooth', freq: 80, freqEnd: 400, vol: 0.3, filter: 1200, vibrato: 20, vibRate: 3, attack: 1 }); a.noiseBurst(d, t, 3, { type: 'bandpass', freq: 500, q: 0.5, vol: 0.3, freqEnd: 3000, attack: 1 }); },
  end_portal: (a, d, t) => { a.tone(d, t, 3, { freq: 110, freqEnd: 55, vol: 0.5, attack: 0.05 }); a.noiseBurst(d, t, 2, { type: 'lowpass', freq: 800, vol: 0.6, freqEnd: 100 }); [45, 52, 57, 64].forEach((m, i) => a.tone(d, t + i * 0.15, 3, { type: 'triangle', freq: 440 * Math.pow(2, (m - 69) / 12), vol: 0.15 })); },
  eye_place: (a, d, t) => { a.tone(d, t, 0.6, { freq: 600, freqEnd: 900, vol: 0.2 }); a.noiseBurst(d, t, 0.2, { freq: 2000, q: 3, vol: 0.3 }); },
  milk: (a, d, t) => a.noiseBurst(d, t, 0.4, { freq: 800, q: 1, vol: 0.4 }),
  shear: (a, d, t) => { a.noiseBurst(d, t, 0.08, { freq: 4000, q: 2, vol: 0.5 }); a.noiseBurst(d, t + 0.1, 0.08, { freq: 4000, q: 2, vol: 0.5 }); },
  fire: (a, d, t) => { for (let i = 0; i < 5; i++) a.noiseBurst(d, t + Math.random() * 0.6, 0.03, { freq: 3000 + Math.random() * 2000, q: 2, vol: 0.2 }); },
  ignite: (a, d, t) => { a.noiseBurst(d, t, 0.15, { freq: 3500, q: 3, vol: 0.6 }); a.noiseBurst(d, t + 0.05, 0.4, { type: 'lowpass', freq: 1500, vol: 0.4 }); },
  dragon_growl: (a, d, t, p) => { a.tone(d, t, 1.6, { type: 'sawtooth', freq: 70 * p, freqEnd: 55 * p, vol: 0.6, filter: 500, vibrato: 6, vibRate: 9, attack: 0.2 }); a.noiseBurst(d, t, 1.2, { type: 'lowpass', freq: 500, vol: 0.4, attack: 0.3 }); },
  dragon_flap: (a, d, t) => a.noiseBurst(d, t, 0.5, { type: 'lowpass', freq: 350, vol: 0.7, attack: 0.1 }),
  dragon_hurt: (a, d, t, p) => a.tone(d, t, 0.6, { type: 'sawtooth', freq: 160 * p, freqEnd: 90 * p, vol: 0.6, filter: 900, vibrato: 12, vibRate: 15 }),
  dragon_shoot: (a, d, t) => { a.noiseBurst(d, t, 0.6, { type: 'bandpass', freq: 700, q: 0.7, vol: 0.7, freqEnd: 250 }); },
  dragon_breath: (a, d, t) => a.noiseBurst(d, t, 1.5, { type: 'bandpass', freq: 900, q: 0.5, vol: 0.6, attack: 0.2 }),
  dragon_death: (a, d, t) => {
    a.tone(d, t, 8, { type: 'sawtooth', freq: 60, freqEnd: 300, vol: 0.5, filter: 1200, vibrato: 10, vibRate: 5, attack: 0.5 });
    a.noiseBurst(d, t, 8, { type: 'lowpass', freq: 400, vol: 0.5, freqEnd: 2000, attack: 1 });
  },
  toast: (a, d, t) => { a.tone(d, t, 0.25, { type: 'triangle', freq: 880, vol: 0.2 }); a.tone(d, t + 0.12, 0.35, { type: 'triangle', freq: 1320, vol: 0.2 }); },
  challenge: (a, d, t) => { [67, 71, 74, 79, 83].forEach((m, i) => a.tone(d, t + i * 0.1, 0.8, { type: 'triangle', freq: 440 * Math.pow(2, (m - 69) / 12), vol: 0.2 })); },
  anvil: (a, d, t) => { a.tone(d, t, 0.5, { freq: 700, vol: 0.3 }); a.tone(d, t, 0.5, { freq: 1100, vol: 0.2 }); },
  enchant: (a, d, t) => { for (let i = 0; i < 6; i++) a.tone(d, t + i * 0.07, 0.4, { freq: 800 + Math.random() * 1200, vol: 0.1 }); },
  brew: (a, d, t) => { for (let i = 0; i < 4; i++) a.tone(d, t + i * 0.1, 0.15, { freq: 400 + i * 100, freqEnd: 700, vol: 0.12 }); },
  thunder: (a, d, t) => { a.noiseBurst(d, t, 3, { type: 'lowpass', freq: 400, vol: 1, freqEnd: 40, attack: 0.05 }); },
};
