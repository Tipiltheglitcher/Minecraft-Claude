// Moteur audio (Web Audio API) : bruitages pré-calculés, ambiances et musique générative
import { BLOCKS } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { synth, synthLoop, variantCount, SOUND_NAMES, pianoNote, PIANO_RATE } from './sfx.js';

// Ordre de pré-calcul : les sons les plus fréquents d'abord
const PRIORITY = ['click', 'pop', 'mat_grass_step', 'mat_stone_step', 'mat_gravel_step', 'mat_wood_step', 'mat_sand_step', 'mat_grass', 'mat_stone', 'mat_gravel', 'mat_wood', 'player_hurt', 'eat', 'burp', 'xp', 'swim', 'splash'];
const BIG = new Set(['explode', 'ghast', 'ghast_shoot', 'ghast_warn', 'ghast_death', 'levelup', 'portal_travel', 'thunder', 'end_portal', 'enderman_scream', 'cave']);
// Gain de base par son (les échantillons sont tous normalisés)
const GAIN = {
  hiss: 0.6, fuse: 0.55, fire: 0.45, portal: 0.5, portal_travel: 0.6, explode: 1.1, thunder: 1.1, cave: 0.5,
  click: 0.5, pop: 0.55, xp: 0.45, levelup: 0.6, toast: 0.55, challenge: 0.6, eat: 0.6, drink: 0.6,
  blaze: 0.55, dragon_flap: 0.8, swim: 0.5, rain: 0.35, mat_cloth: 0.8, mat_cloth_step: 0.8, fizz: 0.5,
};

export class Audio {
  constructor(game) {
    this.game = game;
    this.ctx = null;
    this.listener = { x: 0, y: 0, z: 0, yaw: 0 };
    this.musicTimer = 20 * 30;
    this.playing = 0;
    this.data = new Map();     // nom -> [données par variante]
    this.buffers = new Map();  // nom -> [AudioBuffer]
    this.piano = new Map();    // note MIDI -> Float32Array
    this.pianoBufs = new Map();
    this.loops = {};
    this.queue = [];
    this.pumping = false;
    this.envState = { under: false, reverb: 0.1 };
    // pré-calcul en tâche de fond pendant l'écran titre
    const order = [...PRIORITY, ...SOUND_NAMES.filter((n) => !PRIORITY.includes(n))];
    for (const n of order) for (let v = 0; v < variantCount(n); v++) this.queue.push(() => this.ensureData(n, v));
    for (const m of [48, 52, 55, 57, 60, 62, 64, 67, 69, 72]) this.queue.push(() => this.ensurePiano(m));
    setTimeout(() => this.pump(), 200);
  }

  pump() {
    this.pumping = true;
    const t0 = performance.now();
    const budget = this.game.state === 'playing' ? 4 : 12;
    while (this.queue.length && performance.now() - t0 < budget) {
      try { this.queue.shift()(); } catch (e) { console.warn(e); }
    }
    if (this.queue.length) setTimeout(() => this.pump(), 16);
    else this.pumping = false;
  }

  enqueue(fn) {
    this.queue.push(fn);
    if (!this.pumping) setTimeout(() => this.pump(), 0);
  }

  ensureData(name, v) {
    let arr = this.data.get(name);
    if (!arr) { arr = []; this.data.set(name, arr); }
    if (!arr[v]) arr[v] = synth(name, v);
    return arr[v];
  }

  ensurePiano(m) {
    if (!this.piano.has(m)) this.piano.set(m, pianoNote(m, 0.7));
    return this.piano.get(m);
  }

  toBuffer(d) {
    const b = this.ctx.createBuffer(d.channels.length, d.channels[0].length, d.rate);
    d.channels.forEach((c, i) => b.copyToChannel ? b.copyToChannel(c, i) : b.getChannelData(i).set(c));
    return b;
  }

  getBuffer(name, v) {
    let arr = this.buffers.get(name);
    if (!arr) { arr = []; this.buffers.set(name, arr); }
    if (!arr[v]) arr[v] = this.toBuffer(this.ensureData(name, v));
    return arr[v];
  }

  pianoBuffer(m) {
    let b = this.pianoBufs.get(m);
    if (!b) {
      const d = this.ensurePiano(m);
      b = this.ctx.createBuffer(1, d.length, PIANO_RATE);
      b.getChannelData(0).set(d);
      this.pianoBufs.set(m, b);
    }
    return b;
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
    // master -> compresseur -> sortie
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 12; this.comp.ratio.value = 4;
    this.comp.attack.value = 0.004; this.comp.release.value = 0.2;
    this.comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.connect(this.comp);
    // bus des bruitages : filtre (sous l'eau) + envoi vers la réverbération
    this.sfx = ctx.createGain();
    this.lowpass = ctx.createBiquadFilter();
    this.lowpass.type = 'lowpass';
    this.lowpass.frequency.value = 20000;
    this.sfx.connect(this.lowpass);
    this.lowpass.connect(this.master);
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(2.6);
    this.reverbOut = ctx.createGain();
    this.reverbOut.gain.value = 1;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.master);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = 0.1;
    this.lowpass.connect(this.sfxSend);
    this.sfxSend.connect(this.reverb);
    // ambiances en boucle
    this.amb = ctx.createGain();
    this.amb.connect(this.lowpass);
    // musique
    this.musicGain = ctx.createGain();
    this.musicGain.connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = 0.35;
    this.musicGain.connect(this.musicSend);
    this.musicSend.connect(this.reverb);
    this.applyVolumes();
  }

  // Réponse impulsionnelle : bruit stéréo à décroissance exponentielle, qui s'assombrit
  makeImpulse(sec) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const ir = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < n; i++) {
        const u = i / n;
        const k = 0.9 - 0.8 * u; // filtre passe-bas de plus en plus fermé
        lp += ((Math.random() * 2 - 1) - lp) * k;
        ch[i] = lp * Math.exp(-u * 6.5) * (i < 200 ? i / 200 : 1);
      }
    }
    return ir;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const s = this.game.settings;
    this.master.gain.value = s.volume;
    this.sfx.gain.value = s.sfxVolume;
    this.amb.gain.value = s.sfxVolume * (s.ambientVolume ?? 1);
    this.musicGain.gain.value = s.musicVolume * 0.55;
  }

  setListener(x, y, z, yaw) {
    this.listener.x = x; this.listener.y = y; this.listener.z = z; this.listener.yaw = yaw;
  }

  // ---------- environnement (appelé à chaque image) ----------
  update() {
    const ctx = this.ctx;
    if (!ctx) return;
    const g = this.game, now = ctx.currentTime;
    const playing = (g.state === 'playing' || g.state === 'credits') && g.world && g.player && !g.paused;
    let under = false, reverb = 0.08, rain = 0, dimLoop = null, dimVol = 0;
    if (playing) {
      const p = g.player, w = g.world;
      const hx = Math.floor(p.x), hy = Math.floor(p.y + p.eyeHeight()), hz = Math.floor(p.z);
      const hid = w.getBlock(hx, hy, hz);
      under = hid === B.water || hid === B.lava;
      if (w.dim === 'overworld') {
        const sky = w.getSky(hx, hy, hz);
        const enclosed = 1 - sky / 15;
        reverb = 0.06 + 0.55 * enclosed * enclosed;
        rain = g.weather.strength * Math.min(1, sky / 12) * (under ? 0.3 : 1);
      } else if (w.dim === 'nether') { reverb = 0.35; dimLoop = 'nether'; dimVol = 0.55; }
      else { reverb = 0.28; dimLoop = 'end'; dimVol = 0.45; }
    }
    const st = this.envState;
    if (under !== st.under) {
      st.under = under;
      this.lowpass.frequency.setTargetAtTime(under ? 650 : 20000, now, 0.06);
    }
    if (Math.abs(reverb - st.reverb) > 0.01) {
      st.reverb = reverb;
      this.sfxSend.gain.setTargetAtTime(reverb, now, 0.4);
    }
    this.setLoop('rain', rain * 0.9);
    this.setLoop('nether', dimLoop === 'nether' ? dimVol : 0);
    this.setLoop('end', dimLoop === 'end' ? dimVol : 0);
    this.setLoop('underwater', under ? 0.8 : 0);
  }

  setLoop(name, vol) {
    let L = this.loops[name];
    if (!L) {
      if (vol <= 0.001) return;
      L = this.loops[name] = { vol: 0, pending: true };
      this.enqueue(() => {
        const d = synthLoop(name);
        const src = this.ctx.createBufferSource();
        src.buffer = this.toBuffer(d);
        src.loop = true;
        const gn = this.ctx.createGain();
        gn.gain.value = 0;
        src.connect(gn);
        gn.connect(this.amb);
        src.start();
        L.src = src; L.gain = gn; L.pending = false; L.vol = -1;
      });
      return;
    }
    if (L.pending) return;
    const v = vol * (GAIN[name] ?? 1);
    if (Math.abs(v - L.vol) > 0.005) {
      L.vol = v;
      L.gain.gain.setTargetAtTime(v, this.ctx.currentTime, 0.5);
    }
  }

  // ---------- lecture ----------
  out(x, y, z, vol, range = 16) {
    const ctx = this.ctx;
    let v = vol;
    let pan = 0;
    if (x !== undefined && x !== null) {
      const L = this.listener;
      const dx = x - L.x, dy = y - L.y, dz = z - L.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > range) return null;
      // atténuation linéaire façon Minecraft, adoucie près de la source
      v *= Math.max(0, 1 - d / range);
      const rx = Math.cos(L.yaw), rz = -Math.sin(L.yaw);
      pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d)) * 0.75 : 0;
    }
    if (v < 0.005) return null;
    const g = ctx.createGain();
    g.gain.value = v;
    if (ctx.createStereoPanner) {
      const p = ctx.createStereoPanner();
      p.pan.value = pan;
      g.connect(p);
      p.connect(this.sfx);
      g._p = p;
    } else g.connect(this.sfx);
    return g;
  }

  play(name, x, y, z, vol = 1, pitch = 1) {
    if (!this.ctx || this.ctx.state === 'closed' || !this.game.settings) return;
    if (this.playing > 48) return;
    const nv = variantCount(name);
    if (!nv) return;
    const range = name.startsWith('dragon') ? 128 : BIG.has(name) ? 64 : 16;
    const dest = this.out(x, y, z, vol * (GAIN[name] ?? 1), range);
    if (!dest) return;
    let buffer;
    try {
      buffer = this.getBuffer(name, Math.floor(Math.random() * nv));
    } catch (e) {
      return;
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = pitch * (0.94 + Math.random() * 0.12);
    src.connect(dest);
    this.playing++;
    src.onended = () => {
      this.playing--;
      src.disconnect();
      dest.disconnect();
      if (dest._p) dest._p.disconnect();
    };
    src.start(this.ctx.currentTime + 0.005);
  }

  ui(name) {
    this.play(name, null, null, null, 0.8, 1);
  }

  // Sons de blocs : même logique que Minecraft (casser/poser, pas, frappe pendant le minage)
  blockSound(material, action, x, y, z) {
    const m = material || 'stone';
    const step = action === 'step' || action === 'hit';
    const vol = action === 'step' ? 0.3 : action === 'hit' ? 0.3 : 0.9;
    const pitch = action === 'hit' ? 0.6 : action === 'step' ? 1 : 0.85;
    this.play('mat_' + m + (step ? '_step' : ''), x, y, z, vol, pitch);
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
    this.musicTimer = 20 * (90 + Math.random() * 150);
    this.playPiece(this.game.world ? this.game.world.dim : 'overworld');
  }

  playPiece(dim) {
    const piece = compose(dim);
    this.schedule(piece);
  }

  // Prépare les notes nécessaires en tâche de fond, puis programme le morceau
  schedule(piece) {
    for (const m of new Set(piece.notes.map((n) => n.m))) if (!this.piano.has(m)) this.enqueue(() => this.ensurePiano(m));
    this.enqueue(() => {
      const ctx = this.ctx;
      if (!ctx) return;
      const t0 = ctx.currentTime + 0.4;
      const dest = ctx.createGain();
      dest.gain.value = 1;
      dest.connect(this.musicGain);
      for (const n of piece.notes) {
        const src = ctx.createBufferSource();
        src.buffer = this.pianoBuffer(n.m);
        const g = ctx.createGain();
        g.gain.value = n.v;
        src.connect(g);
        g.connect(dest);
        src.start(t0 + n.t);
        src.onended = () => { src.disconnect(); g.disconnect(); };
      }
      for (const p of piece.pads) this.pad(dest, t0 + p.t, p.d, p.ms, p.v);
    });
  }

  // Nappe douce : dents de scie désaccordées, filtre fermé, attaque lente
  pad(dest, t0, dur, midis, vol) {
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + dur * 0.35);
    g.gain.setValueAtTime(vol, t0 + dur * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t0 + dur);
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = 700;
    f.Q.value = 0.5;
    f.connect(g);
    g.connect(dest);
    for (const m of midis) {
      for (const det of [-6, 5]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = 440 * Math.pow(2, (m - 69) / 12);
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = 0.08 / midis.length;
        o.connect(og);
        og.connect(f);
        o.start(t0);
        o.stop(t0 + dur + 0.1);
      }
    }
  }

  // Thème du générique
  playCredits() {
    if (!this.ctx) return;
    this.schedule(compose('credits'));
  }
}

// ---------- composition ----------
const MODES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  minor: [0, 2, 3, 5, 7, 8, 10],
  phrygian: [0, 1, 3, 5, 7, 8, 10],
};
const PROGS = {
  major: [[0, 4, 5, 3], [0, 5, 3, 4], [3, 0, 4, 5], [0, 3, 0, 4], [5, 3, 0, 4], [0, 2, 3, 3], [3, 4, 2, 5]],
  minor: [[0, 5, 2, 6], [0, 3, 4, 0], [0, 6, 5, 6], [0, 5, 3, 4], [0, 3, 5, 4]],
};

export function compose(dim) {
  const R = Math.random;
  const pick = (a) => a[Math.floor(R() * a.length)];
  let mode, root, bpm, bars, padChance, melodyChance;
  if (dim === 'nether') { mode = pick(['phrygian', 'minor']); root = 45 + Math.floor(R() * 4); bpm = 52 + R() * 10; padChance = 0.9; melodyChance = 0.5; }
  else if (dim === 'end') { mode = pick(['minor', 'dorian']); root = 47 + Math.floor(R() * 4); bpm = 46 + R() * 8; padChance = 1; melodyChance = 0.4; }
  else if (dim === 'credits') { mode = 'major'; root = 50; bpm = 68; padChance = 1; melodyChance = 1; }
  else { mode = pick(['major', 'major', 'lydian', 'dorian', 'minor']); root = 48 + Math.floor(R() * 7); bpm = 60 + R() * 18; padChance = 0.3; melodyChance = 0.85; }
  const sc = MODES[mode];
  const minorish = mode === 'minor' || mode === 'dorian' || mode === 'phrygian';
  const prog = pick(minorish ? PROGS.minor : PROGS.major);
  const beat = 60 / bpm;
  const reps = dim === 'credits' ? 6 : 3 + Math.floor(R() * 2);
  bars = prog.length * reps;
  const deg = (d) => root + sc[((d % 7) + 7) % 7] + 12 * Math.floor(d / 7);
  const notes = [], pads = [];
  const hum = () => (R() - 0.5) * 0.03;
  // motif mélodique (rythme + contour) réutilisé d'une mesure à l'autre
  const rhythms = [[0, 1.5, 2, 3], [0, 2, 3], [0, 1, 2, 3.5], [0, 3], [1, 2, 2.5, 3], [0, 0.5, 2]];
  const motif = [pick(rhythms), pick(rhythms)];
  const pattern = pick(['arp', 'arp', 'block', 'sparse']);
  let mel = 7 + 2 + Math.floor(R() * 3);
  for (let b = 0; b < bars; b++) {
    const chord = prog[b % prog.length];
    const t = b * 4 * beat;
    const ch = [chord, chord + 2, chord + 4];
    const bass = deg(chord) - 12;
    const lv = 0.32;
    // main gauche
    if (pattern === 'arp') {
      [[0, bass], [1, deg(chord + 4) - 12], [2, deg(chord + 2)], [3, deg(chord + 4) - 12]].forEach(([bt, m], i) => notes.push({ t: t + bt * beat + hum(), m, v: lv * (i === 0 ? 1 : 0.7) }));
    } else if (pattern === 'block') {
      notes.push({ t: t + hum(), m: bass, v: lv });
      notes.push({ t: t + hum(), m: deg(chord + 4) - 12, v: lv * 0.7 });
      notes.push({ t: t + 2 * beat + hum(), m: deg(chord + 2), v: lv * 0.6 });
    } else {
      notes.push({ t: t + hum(), m: bass, v: lv });
      if (b % 2) notes.push({ t: t + 2 * beat + hum(), m: deg(chord + 2), v: lv * 0.6 });
    }
    // nappe
    if (R() < padChance && b % 2 === 0) pads.push({ t, d: 8 * beat, ms: ch.map((d) => deg(d)), v: dim === 'overworld' ? 0.18 : 0.26 });
    // main droite : entre après la première répétition
    const playMel = b >= prog.length && R() < melodyChance;
    if (playMel) {
      const rh = motif[b % 2];
      rh.forEach((bt, i) => {
        if (R() < 0.15) return;
        mel += pick([-2, -1, -1, 0, 1, 1, 2]);
        mel = Math.max(7, Math.min(16, mel));
        // temps forts : on se pose sur une note de l'accord
        if (bt === 0 || bt === 2) {
          let best = mel, bd = 99;
          for (const c of ch) for (const o of [7, 14]) { const cand = c + o; if (Math.abs(cand - mel) < bd) { bd = Math.abs(cand - mel); best = cand; } }
          mel = best;
        }
        notes.push({ t: t + bt * beat + hum(), m: deg(mel), v: 0.45 * (i === 0 ? 1 : 0.85) });
      });
    }
  }
  // accord final
  const endT = bars * 4 * beat;
  [0, 4, 7 + 2].forEach((d, i) => notes.push({ t: endT + i * 0.08, m: deg(prog[0] + d) - (i === 0 ? 12 : 0), v: 0.35 }));
  return { notes, pads };
}
