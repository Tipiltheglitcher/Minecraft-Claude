// Synthèse hors ligne des bruitages : chaque son est calculé une seule fois
// dans un Float32Array (plusieurs variantes), puis rejoué depuis un AudioBuffer.
// Techniques : grains de bruit filtré (matières), synthèse modale (bois, métal,
// verre, cloches), synthèse vocale à formants (créatures), Karplus-Strong (corde).
import { mulberry32 } from '../core/noise.js';

export const RATE = 44100;
const TAU = Math.PI * 2;

// ---------- outils DSP ----------
class Rand {
  constructor(seed) { this.f = mulberry32(seed >>> 0); }
  next() { return this.f(); }
  bi() { return this.f() * 2 - 1; }
  range(a, b) { return a + (b - a) * this.f(); }
  pick(a) { return a[Math.floor(this.f() * a.length)]; }
}

// Filtre biquad (formules RBJ), réglable pendant le traitement
class Biquad {
  constructor(type, f, q = 0.707, gain = 0) {
    this.type = type;
    this.x1 = this.x2 = this.y1 = this.y2 = 0;
    this.set(f, q, gain);
  }

  set(f, q = this.q, gain = this.gain) {
    this.q = q; this.gain = gain;
    const w = TAU * Math.max(10, Math.min(f, RATE * 0.45)) / RATE;
    const cs = Math.cos(w), sn = Math.sin(w), al = sn / (2 * q);
    let b0, b1, b2, a0, a1, a2;
    switch (this.type) {
      case 'hp': b0 = (1 + cs) / 2; b1 = -(1 + cs); b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'bp': b0 = al; b1 = 0; b2 = -al; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al; break;
      case 'peak': {
        const A = Math.pow(10, gain / 40);
        b0 = 1 + al * A; b1 = -2 * cs; b2 = 1 - al * A; a0 = 1 + al / A; a1 = -2 * cs; a2 = 1 - al / A; break;
      }
      case 'hs': {
        const A = Math.pow(10, gain / 40), sq = 2 * Math.sqrt(A) * al;
        b0 = A * ((A + 1) + (A - 1) * cs + sq); b1 = -2 * A * ((A - 1) + (A + 1) * cs); b2 = A * ((A + 1) + (A - 1) * cs - sq);
        a0 = (A + 1) - (A - 1) * cs + sq; a1 = 2 * ((A - 1) - (A + 1) * cs); a2 = (A + 1) - (A - 1) * cs - sq; break;
      }
      default: b0 = (1 - cs) / 2; b1 = 1 - cs; b2 = b0; a0 = 1 + al; a1 = -2 * cs; a2 = 1 - al;
    }
    this.b0 = b0 / a0; this.b1 = b1 / a0; this.b2 = b2 / a0; this.a1 = a1 / a0; this.a2 = a2 / a0;
  }

  p(x) {
    const y = this.b0 * x + this.b1 * this.x1 + this.b2 * this.x2 - this.a1 * this.y1 - this.a2 * this.y2;
    this.x2 = this.x1; this.x1 = x; this.y2 = this.y1; this.y1 = y;
    return y;
  }
}

const buf = (sec) => new Float32Array(Math.max(1, Math.ceil(sec * RATE)));
const sm = (x) => x * x * (3 - 2 * x);

function peak(a) {
  let m = 0;
  for (let i = 0; i < a.length; i++) { const v = Math.abs(a[i]); if (v > m) m = v; }
  return m;
}

function norm(a, p = 1) {
  const m = peak(a);
  if (m > 0) { const k = p / m; for (let i = 0; i < a.length; i++) a[i] *= k; }
  return a;
}

function mix(out, src, gain = 1, at = 0) {
  const i0 = Math.floor(at * RATE);
  for (let i = 0; i < src.length && i0 + i < out.length; i++) out[i0 + i] += src[i] * gain;
  return out;
}

function filt(a, type, f, q) {
  const b = new Biquad(type, f, q);
  for (let i = 0; i < a.length; i++) a[i] = b.p(a[i]);
  return a;
}

// filtre dont la fréquence suit une courbe fn(u) (u = 0..1)
function sweep(a, type, fn, q = 0.707) {
  const b = new Biquad(type, fn(0), q);
  for (let i = 0; i < a.length; i++) {
    if ((i & 31) === 0) b.set(fn(i / a.length), q);
    a[i] = b.p(a[i]);
  }
  return a;
}

function envelope(a, fn) {
  for (let i = 0; i < a.length; i++) a[i] *= fn(i / a.length, i / RATE);
  return a;
}

function fadeEdges(a, inSec = 0.002, outSec = 0.02) {
  const ni = Math.floor(inSec * RATE), no = Math.floor(outSec * RATE);
  for (let i = 0; i < ni && i < a.length; i++) a[i] *= i / ni;
  for (let i = 0; i < no && i < a.length; i++) a[a.length - 1 - i] *= i / no;
  return a;
}

function saturate(a, drive) {
  const k = Math.tanh(drive);
  for (let i = 0; i < a.length; i++) a[i] = Math.tanh(a[i] * drive) / k;
  return a;
}

function white(r, sec) {
  const a = buf(sec);
  for (let i = 0; i < a.length; i++) a[i] = r.bi();
  return a;
}

function pink(r, sec) {
  const a = buf(sec);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < a.length; i++) {
    const w = r.bi();
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    a[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
    b6 = w * 0.115926;
  }
  return a;
}

function brown(r, sec) {
  const a = buf(sec);
  let v = 0;
  for (let i = 0; i < a.length; i++) { v = (v + 0.02 * r.bi()) / 1.02; a[i] = v * 3.5; }
  return a;
}

// Grain de bruit filtré (craquement élémentaire)
function grain(out, r, t, dur, f, q, amp, attack = 0.0005) {
  const i0 = Math.floor(t * RATE), n = Math.floor(dur * RATE), na = Math.max(1, Math.floor(attack * RATE));
  if (i0 >= out.length) return;
  const b = new Biquad('bp', f, q);
  const tau = n * 0.3;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const e = Math.exp(-i / tau) * (i < na ? i / na : 1);
    out[i0 + i] += b.p(r.bi()) * e * amp;
  }
}

// Nuée de grains : densité répartie selon une courbe en cloche
function grains(out, r, { t0 = 0, span, count, fmin, fmax, q = 3, dmin = 0.004, dmax = 0.014, amp = 1, shape = 1.6 }) {
  for (let k = 0; k < count; k++) {
    const u = Math.pow(r.next(), shape);
    const f = fmin * Math.pow(fmax / fmin, r.next());
    const a = amp * (0.35 + 0.65 * r.next()) * (1 - 0.6 * u);
    grain(out, r, t0 + u * span, r.range(dmin, dmax), f, q, a);
  }
  return out;
}

// Banc de résonateurs (synthèse modale) excité par exc
function modal(out, exc, modes, at = 0) {
  const i0 = Math.floor(at * RATE);
  for (const [f, t60, amp] of modes) {
    if (f >= RATE * 0.45) continue;
    const w = TAU * f / RATE, rr = Math.pow(0.001, 1 / (t60 * RATE));
    const c1 = 2 * rr * Math.cos(w), c2 = -rr * rr;
    const g = amp * Math.sin(w);
    let y1 = 0, y2 = 0;
    const len = Math.min(out.length - i0, Math.ceil(t60 * 1.1 * RATE) + exc.length);
    for (let i = 0; i < len; i++) {
      const y = c1 * y1 + c2 * y2 + (i < exc.length ? exc[i] : 0) * g;
      y2 = y1; y1 = y;
      out[i0 + i] += y;
    }
  }
  return out;
}

// Impulsion d'excitation (bruit très court, éventuellement filtré)
function strike(r, sec, lp = 0) {
  const e = white(r, sec);
  envelope(e, (u) => Math.pow(1 - u, 2));
  if (lp) filt(e, 'lp', lp, 0.7);
  return e;
}

// Glissando sinusoïdal amorti (bulles, pops, gouttes)
function chirp(out, t, dur, f0, f1, amp, curve = 'exp') {
  const i0 = Math.floor(t * RATE), n = Math.floor(dur * RATE);
  let ph = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const u = i / n;
    const f = curve === 'exp' ? f0 * Math.pow(f1 / f0, u) : f0 + (f1 - f0) * u;
    ph += TAU * f / RATE;
    const e = Math.min(1, i / 40) * Math.pow(1 - u, 2);
    out[i0 + i] += Math.sin(ph) * e * amp;
  }
}

function bubble(out, r, t, size = 1, amp = 1) {
  const f = r.range(500, 1300) / size;
  chirp(out, t, r.range(0.02, 0.06) * size, f, f * r.range(1.6, 2.4), amp);
}

// Oscillateur en dents de scie à bande limitée (polyBLEP)
function blep(t, dt) {
  if (t < dt) { t /= dt; return t + t - t * t - 1; }
  if (t > 1 - dt) { t = (t - 1) / dt; return t * t + t + t + 1; }
  return 0;
}

// Voix : source glottique (dent de scie + souffle) filtrée par des formants.
// f0(u) en Hz, formants(u) -> [[freq, q, gain], ...], env(u) -> amplitude
function voice(r, { dur, f0, formants, env, jitter = 0.01, breath = 0.05, fry = 0, vib = 0, vibRate = 5, tremolo = 0, tremRate = 20 }) {
  const out = buf(dur);
  const n = out.length;
  const F = formants(0).map(([f, q]) => new Biquad('bp', f, q));
  let ph = 0, jit = 0, jitT = 0, period = 0, cur = formants(0);
  const asp = new Biquad('hp', 1500, 0.7);
  for (let i = 0; i < n; i++) {
    const u = i / n;
    if ((i & 63) === 0) {
      cur = formants(u);
      for (let k = 0; k < F.length; k++) F[k].set(cur[k][0], cur[k][1]);
      jitT = r.bi() * jitter;
    }
    jit += (jitT - jit) * 0.01;
    const f = Math.max(20, f0(u) * (1 + jit + vib * Math.sin(TAU * vibRate * i / RATE)));
    const dt = f / RATE;
    ph += dt;
    if (ph >= 1) { ph -= 1; period++; }
    let s = (2 * ph - 1) - blep(ph, dt);
    if (fry) s *= 1 + fry * ((period & 1) ? 0.6 : -0.6) * (0.5 + 0.5 * r.next());
    // souffle modulé par la phase (plus présent à l'ouverture de la glotte)
    const nz = asp.p(r.bi()) * breath * (0.4 + 0.6 * (1 - ph));
    const src = s + nz;
    let y = 0;
    for (let k = 0; k < F.length; k++) y += F[k].p(src) * cur[k][2];
    let e = env(u, i / RATE);
    if (tremolo) e *= 1 - tremolo * (0.5 + 0.5 * Math.sin(TAU * tremRate * i / RATE));
    out[i] = y * e;
  }
  filt(out, 'lp', 4200, 0.6);
  return fadeEdges(out, 0.004, 0.02);
}

// Corde pincée (Karplus-Strong)
function pluck(r, f, dur, damp = 0.995) {
  const out = buf(dur);
  const N = Math.max(2, Math.round(RATE / f));
  const line = new Float32Array(N);
  for (let i = 0; i < N; i++) line[i] = r.bi();
  let idx = 0;
  for (let i = 0; i < out.length; i++) {
    const nx = (idx + 1) % N;
    const v = damp * 0.5 * (line[idx] + line[nx]);
    out[i] = line[idx];
    line[idx] = v;
    idx = nx;
  }
  return out;
}

// Cloche / carillon (partiels inharmoniques)
function bell(out, r, t, f, dur, amp = 1, bright = 1) {
  const e = strike(r, 0.002);
  const modes = [[f, dur, 1], [f * 2.0, dur * 0.6, 0.45 * bright], [f * 2.76, dur * 0.4, 0.3 * bright], [f * 4.07, dur * 0.25, 0.18 * bright], [f * 5.4, dur * 0.15, 0.1 * bright]];
  const tmp = buf(t + dur * 1.1);
  modal(tmp, e, modes.map(([a, b, c]) => [a, b, c * amp]), t);
  return mix(out, tmp, 1);
}

// Ton simple avec enveloppe (pour les jingles)
function toneAdd(out, t, dur, f, amp, { type = 'sine', attack = 0.005, vib = 0 } = {}) {
  const i0 = Math.floor(t * RATE), n = Math.floor(dur * RATE);
  let ph = 0;
  for (let i = 0; i < n && i0 + i < out.length; i++) {
    const u = i / n;
    ph += (f * (1 + vib * Math.sin(TAU * 5 * i / RATE))) / RATE;
    const x = ph % 1;
    const s = type === 'tri' ? 1 - 4 * Math.abs(x - 0.5) : Math.sin(TAU * x);
    out[i0 + i] += s * amp * Math.min(1, i / (attack * RATE)) * Math.pow(1 - u, 2);
  }
}

// Formants de voyelles (voix « moyenne » ; décalées selon la créature)
const V = {
  a: [[800, 6, 1], [1200, 8, 0.5], [2600, 10, 0.18]],
  e: [[450, 6, 1], [1900, 10, 0.35], [2600, 10, 0.2]],
  i: [[300, 6, 1], [2300, 12, 0.3], [3000, 12, 0.2]],
  o: [[500, 6, 1], [850, 8, 0.45], [2500, 10, 0.1]],
  u: [[330, 6, 1], [800, 8, 0.25], [2300, 10, 0.07]],
  uh: [[620, 6, 1], [1150, 8, 0.4], [2500, 10, 0.12]],
  m: [[260, 5, 1], [1100, 10, 0.05], [2300, 12, 0.03]],
};

function lerpF(A, B, t, shift = 1) {
  return A.map((a, k) => [(a[0] + (B[k][0] - a[0]) * t) * shift, a[1], a[2] + (B[k][2] - a[2]) * t]);
}

// ---------- matières (casser/poser et pas/frappe) ----------
const MAT = {
  stone(r, step) {
    const dur = step ? 0.16 : 0.3;
    const out = buf(dur);
    grain(out, r, 0, 0.006, 3500, 0.8, 1.2);
    grains(out, r, { span: step ? 0.05 : 0.12, count: step ? 7 : 22, fmin: 900, fmax: 4200, q: 2.2, dmin: 0.004, dmax: 0.018, amp: 0.9 });
    const body = buf(dur);
    modal(body, strike(r, 0.004, 3000), [[r.range(420, 520), 0.05, 0.7], [r.range(900, 1100), 0.035, 0.5], [r.range(1600, 1900), 0.03, 0.4]]);
    mix(out, norm(body), 0.5);
    const thud = buf(0.08);
    chirp(thud, 0, 0.07, 150, 70, 1);
    mix(out, thud, step ? 0.25 : 0.4);
    return out;
  },
  wood(r, step) {
    const dur = step ? 0.18 : 0.35;
    const out = buf(dur);
    const f = r.range(170, 240) * (step ? 1.2 : 1);
    modal(out, strike(r, 0.006, 2500), [[f, step ? 0.07 : 0.12, 1], [f * 2.32, 0.06, 0.6], [f * 3.9, 0.04, 0.4], [f * 5.6, 0.03, 0.25], [f * 8.1, 0.02, 0.15]]);
    norm(out);
    const cr = buf(dur);
    grains(cr, r, { span: step ? 0.03 : 0.09, count: step ? 3 : 10, fmin: 1200, fmax: 3500, q: 3, amp: 0.5 });
    mix(out, cr, step ? 0.25 : 0.45);
    grain(out, r, 0, 0.004, 2500, 1, 0.6);
    return out;
  },
  gravel(r, step) {
    const dur = step ? 0.16 : 0.3;
    const out = buf(dur);
    grains(out, r, { span: step ? 0.09 : 0.2, count: step ? 26 : 70, fmin: 350, fmax: 2400, q: 2, dmin: 0.003, dmax: 0.012, amp: 1 });
    const body = pink(r, dur);
    filt(body, 'lp', 500, 0.7);
    envelope(body, (u) => Math.exp(-u * 7) * Math.min(1, u * 40));
    mix(out, norm(body), 0.35);
    return out;
  },
  grass(r, step) {
    const dur = step ? 0.16 : 0.28;
    const out = buf(dur);
    grains(out, r, { span: step ? 0.09 : 0.18, count: step ? 40 : 110, fmin: 1200, fmax: 4800, q: 2.2, dmin: 0.003, dmax: 0.009, amp: 1 });
    const body = white(r, dur);
    filt(body, 'hp', 1200, 0.7);
    filt(body, 'lp', 5000, 0.7);
    envelope(body, (u) => Math.exp(-u * 6) * Math.min(1, u * 25));
    mix(out, norm(body), 0.25);
    return out;
  },
  sand(r, step) {
    const dur = step ? 0.15 : 0.25;
    const out = pink(r, dur);
    filt(out, 'hp', 1400, 0.6);
    filt(out, 'lp', 7000, 0.6);
    envelope(out, (u) => Math.min(1, u * 12) * Math.pow(1 - u, 2.2));
    norm(out, 0.6);
    grains(out, r, { span: dur * 0.6, count: step ? 20 : 45, fmin: 2500, fmax: 8000, q: 1.5, dmin: 0.002, dmax: 0.005, amp: 0.5 });
    return out;
  },
  snow(r, step) {
    const dur = step ? 0.16 : 0.26;
    const out = buf(dur);
    grains(out, r, { span: step ? 0.1 : 0.18, count: step ? 30 : 70, fmin: 900, fmax: 3200, q: 4, dmin: 0.003, dmax: 0.01, amp: 1 });
    for (let k = 0; k < (step ? 2 : 4); k++) { const f = r.range(700, 1200); chirp(out, r.range(0, dur * 0.5), 0.015, f, f * 1.1, 0.12); }
    const body = white(r, dur);
    filt(body, 'lp', 1500, 0.7);
    envelope(body, (u) => Math.exp(-u * 8) * Math.min(1, u * 30));
    mix(out, norm(body), 0.2);
    return out;
  },
  glass(r, step) {
    if (step) {
      const out = buf(0.15);
      modal(out, strike(r, 0.002), [[r.range(2400, 2800), 0.06, 1], [r.range(4100, 4600), 0.04, 0.6], [r.range(6200, 6800), 0.03, 0.4]]);
      norm(out);
      grain(out, r, 0, 0.004, 4000, 1, 0.4);
      return out;
    }
    const out = buf(0.7);
    const crash = white(r, 0.45);
    filt(crash, 'hp', 2500, 0.7);
    envelope(crash, (u) => Math.exp(-u * 6));
    mix(out, norm(crash), 0.55);
    for (let k = 0; k < 16; k++) {
      const t = Math.pow(r.next(), 1.8) * 0.3;
      const f = r.range(2200, 9000);
      const tmp = buf(0.25);
      modal(tmp, strike(r, 0.001), [[f, r.range(0.05, 0.18), 1], [f * r.range(1.4, 2.7), 0.05, 0.4]]);
      mix(out, norm(tmp), r.range(0.15, 0.4) * (1 - t * 1.5), t);
    }
    const thud = buf(0.08);
    chirp(thud, 0, 0.06, 180, 90, 1);
    mix(out, thud, 0.3);
    return out;
  },
  cloth(r, step) {
    const dur = step ? 0.14 : 0.22;
    const out = pink(r, dur);
    filt(out, 'lp', step ? 700 : 900, 0.7);
    filt(out, 'hp', 120, 0.7);
    envelope(out, (u) => Math.min(1, u * 10) * Math.pow(1 - u, 2.5));
    return out;
  },
  metal(r, step) {
    const dur = step ? 0.25 : 0.9;
    const out = buf(dur);
    const f = r.range(520, 640) * (step ? 1.3 : 1);
    const t = step ? 0.12 : 0.6;
    modal(out, strike(r, 0.003), [[f, t, 1], [f * 2.76, t * 0.7, 0.6], [f * 5.4, t * 0.5, 0.4], [f * 8.93, t * 0.35, 0.25], [f * 1.51, t * 0.8, 0.3]]);
    norm(out);
    grain(out, r, 0, 0.006, 3000, 1, 0.5);
    grains(out, r, { span: 0.04, count: step ? 3 : 8, fmin: 1500, fmax: 4000, q: 3, amp: 0.3 });
    return out;
  },
};

// ---------- catalogue ----------
// Chaque entrée : [nombre de variantes, générateur(r) -> Float32Array | [L, R]]
const DEF = {};
for (const m of Object.keys(MAT)) {
  DEF['mat_' + m] = [4, (r) => MAT[m](r, false)];
  DEF['mat_' + m + '_step'] = [4, (r) => MAT[m](r, true)];
}

Object.assign(DEF, {
  click: [1, (r) => {
    const out = buf(0.05);
    grain(out, r, 0, 0.006, 3200, 1.2, 1);
    modal(out, strike(r, 0.001), [[1250, 0.02, 0.6], [2600, 0.012, 0.3]]);
    return out;
  }],
  pop: [3, (r) => {
    const out = buf(0.12);
    chirp(out, 0, 0.09, r.range(330, 380), r.range(820, 950), 1);
    chirp(out, 0.004, 0.05, 180, 300, 0.3);
    return out;
  }],
  player_hurt: [2, (r) => {
    const out = voice(r, {
      dur: 0.24, f0: (u) => 210 - 70 * u + r.range(-5, 5), jitter: 0.02, breath: 0.25,
      formants: (u) => lerpF(V.u, V.o, sm(u), 1.05), env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.5),
    });
    norm(out);
    const hit = buf(0.08);
    chirp(hit, 0, 0.07, 140, 60, 1);
    mix(out, hit, 0.4);
    return out;
  }],
  fall_small: [2, (r) => {
    const out = brown(r, 0.18);
    filt(out, 'lp', 500, 0.7);
    envelope(out, (u) => Math.min(1, u * 60) * Math.exp(-u * 6));
    norm(out);
    chirp(out, 0, 0.1, 120, 55, 0.6);
    return out;
  }],
  fall_big: [2, (r) => {
    const out = brown(r, 0.4);
    filt(out, 'lp', 400, 0.7);
    envelope(out, (u) => Math.min(1, u * 80) * Math.exp(-u * 5));
    norm(out);
    chirp(out, 0, 0.2, 110, 40, 0.8);
    grains(out, r, { span: 0.12, count: 25, fmin: 400, fmax: 2000, q: 2, amp: 0.4 });
    return out;
  }],

  // --- animaux ---
  pig: [3, (r) => {
    const out = buf(0.55);
    const n = r.next() < 0.5 ? 2 : 3;
    let t = 0;
    for (let k = 0; k < n; k++) {
      const d = r.range(0.1, 0.16);
      const f = r.range(95, 125);
      const g = voice(r, {
        dur: d, f0: (u) => f * (1.15 - 0.3 * u), jitter: 0.06, fry: 0.8, breath: 0.35,
        formants: () => [[300, 4, 1], [1000, 6, 0.5], [2400, 8, 0.2]], env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1.2),
      });
      const sn = white(r, d);
      filt(sn, 'bp', 900, 1.5);
      envelope(sn, (u) => Math.min(1, u * 30) * Math.pow(1 - u, 3));
      mix(g, norm(sn), 0.35 * peak(g));
      mix(out, g, 1, t);
      t += d + r.range(0.03, 0.08);
    }
    return out;
  }],
  pig_hurt: [2, (r) => voice(r, {
    dur: 0.35, f0: (u) => 620 - 200 * u, jitter: 0.03, breath: 0.2, vib: 0.03, vibRate: 22,
    formants: () => lerpF(V.i, V.e, 0.3, 1.1), env: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 1.3),
  })],
  cow: [3, (r) => {
    const base = r.range(95, 115);
    const dur = r.range(0.9, 1.25);
    return voice(r, {
      dur, f0: (u) => base * (1 + 0.18 * Math.sin(Math.PI * Math.min(1, u * 1.4)) - 0.12 * u), jitter: 0.015, breath: 0.08, vib: 0.01, vibRate: 4,
      formants: (u) => u < 0.15 ? lerpF(V.m, V.u, u / 0.15, 0.8) : lerpF(V.u, V.o, sm((u - 0.15) / 0.85), 0.8),
      env: (u) => Math.min(1, u * 6) * (u > 0.75 ? Math.pow((1 - u) / 0.25, 1.5) : 1),
    });
  }],
  cow_hurt: [2, (r) => voice(r, {
    dur: 0.4, f0: (u) => 150 - 40 * u, jitter: 0.03, breath: 0.15, fry: 0.3,
    formants: (u) => lerpF(V.uh, V.o, u, 0.85), env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.4),
  })],
  sheep: [3, (r) => {
    const base = r.range(230, 280);
    return voice(r, {
      dur: r.range(0.55, 0.75), f0: (u) => base * (1.05 - 0.1 * u), jitter: 0.02, breath: 0.12, tremolo: 0.75, tremRate: r.range(17, 23),
      formants: (u) => u < 0.1 ? lerpF(V.m, V.a, u / 0.1, 1) : lerpF(V.a, V.e, u * 0.4, 1),
      env: (u) => Math.min(1, u * 12) * (u > 0.7 ? Math.pow((1 - u) / 0.3, 1.3) : 1),
    });
  }],
  chicken: [3, (r) => {
    const out = buf(0.5);
    let t = 0;
    const n = 2 + Math.floor(r.next() * 3);
    for (let k = 0; k < n; k++) {
      const d = r.range(0.04, 0.08);
      const f = r.range(480, 650) * (k === n - 1 ? 1.3 : 1);
      mix(out, voice(r, {
        dur: d, f0: (u) => f * (1.1 - 0.25 * u), jitter: 0.03, breath: 0.2,
        formants: () => lerpF(V.a, V.e, 0.5, 1.5), env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1.5),
      }), 1, t);
      t += d + r.range(0.02, 0.07);
    }
    return out;
  }],
  chicken_hurt: [2, (r) => voice(r, {
    dur: 0.22, f0: (u) => 760 - 200 * u, jitter: 0.05, breath: 0.3, fry: 0.3,
    formants: () => lerpF(V.a, V.i, 0.3, 1.5), env: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 1.2),
  })],
  villager: [3, (r) => {
    const f = r.range(150, 185);
    const up = r.next() < 0.5;
    return voice(r, {
      dur: r.range(0.35, 0.5), f0: (u) => f * (up ? 1 + 0.25 * Math.sin(Math.PI * u) : 1.15 - 0.25 * u), jitter: 0.01, breath: 0.05,
      formants: (u) => lerpF(V.m, V.uh, 0.25 * Math.sin(Math.PI * u), 1), env: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 0.8),
    });
  }],
  villager_hurt: [2, (r) => voice(r, {
    dur: 0.25, f0: (u) => 230 - 60 * u, jitter: 0.02, breath: 0.15,
    formants: (u) => lerpF(V.m, V.uh, Math.min(1, u * 3), 1), env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.2),
  })],

  // --- monstres ---
  zombie: [3, (r) => {
    const f = r.range(70, 90);
    return voice(r, {
      dur: r.range(1.0, 1.4), f0: (u) => f * (1 + 0.12 * Math.sin(Math.PI * u * r.range(1, 2)) - 0.1 * u), jitter: 0.06, fry: 0.7, breath: 0.35,
      formants: (u) => lerpF(V.uh, V.o, sm(u), 0.9), env: (u) => Math.min(1, u * 4) * (u > 0.6 ? Math.pow((1 - u) / 0.4, 1.2) : 1),
    });
  }],
  zombie_hurt: [2, (r) => voice(r, {
    dur: 0.4, f0: (u) => 120 - 30 * u, jitter: 0.07, fry: 0.8, breath: 0.4,
    formants: (u) => lerpF(V.a, V.uh, u, 0.9), env: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 1.3),
  })],
  zombie_death: [1, (r) => voice(r, {
    dur: 1.2, f0: (u) => 110 * (1 - 0.5 * u), jitter: 0.07, fry: 0.9, breath: 0.4,
    formants: (u) => lerpF(V.a, V.u, sm(u), 0.9), env: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.1),
  })],
  skeleton: [3, (r) => {
    const out = buf(0.5);
    let t = 0;
    const n = 5 + Math.floor(r.next() * 5);
    for (let k = 0; k < n; k++) {
      const tmp = buf(0.06);
      const f = r.range(1100, 2400);
      modal(tmp, strike(r, 0.001), [[f, 0.025, 1], [f * 1.7, 0.018, 0.5], [f * 2.9, 0.012, 0.3]]);
      mix(out, norm(tmp), r.range(0.5, 1), t);
      t += r.range(0.02, 0.06) * (k % 3 === 2 ? 2 : 1);
    }
    return out;
  }],
  skeleton_hurt: [2, (r) => {
    const out = buf(0.3);
    for (let k = 0; k < 5; k++) {
      const tmp = buf(0.05);
      const f = r.range(1400, 2800);
      modal(tmp, strike(r, 0.001), [[f, 0.02, 1], [f * 1.8, 0.015, 0.5]]);
      mix(out, norm(tmp), r.range(0.6, 1), k * r.range(0.018, 0.03));
    }
    grain(out, r, 0, 0.01, 1800, 1, 0.6);
    return out;
  }],
  skeleton_death: [1, (r) => {
    const out = buf(1.1);
    let t = 0;
    for (let k = 0; k < 16; k++) {
      const tmp = buf(0.06);
      const f = r.range(900, 2600) * (1 - k * 0.025);
      modal(tmp, strike(r, 0.001), [[f, 0.03, 1], [f * 1.7, 0.02, 0.5]]);
      mix(out, norm(tmp), r.range(0.4, 1) * (1 - k / 20), t);
      t += r.range(0.02, 0.05) * (1 + k * 0.08);
    }
    return out;
  }],
  creeper_hurt: [2, (r) => {
    const out = buf(0.35);
    grains(out, r, { span: 0.25, count: 60, fmin: 600, fmax: 2500, q: 1.5, dmin: 0.004, dmax: 0.02, amp: 1 });
    const h = white(r, 0.35);
    filt(h, 'bp', 1400, 0.8);
    envelope(h, (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.5));
    mix(out, norm(h), 0.5);
    return out;
  }],
  hiss: [1, (r) => {
    const out = pink(r, 1.5);
    sweep(out, 'bp', (u) => 1500 + 1300 * u, 0.9);
    filt(out, 'hp', 700, 0.7);
    envelope(out, (u) => Math.pow(Math.min(1, u * 1.3), 1.5) * (u > 0.92 ? (1 - u) / 0.08 : 1));
    return out;
  }],
  fuse: [1, (r) => {
    const out = pink(r, 1.3);
    filt(out, 'bp', 2200, 0.8);
    envelope(out, (u) => Math.min(1, u * 10) * (0.7 + 0.3 * Math.sin(u * 60)) * (u > 0.9 ? (1 - u) / 0.1 : 1));
    norm(out, 0.6);
    for (let k = 0; k < 30; k++) grain(out, r, r.range(0, 1.2), 0.003, r.range(3000, 7000), 1.5, r.range(0.3, 0.9));
    return out;
  }],
  spider: [3, (r) => {
    const out = buf(0.45);
    const h = white(r, 0.35);
    filt(h, 'bp', r.range(2000, 3000), 1.2);
    envelope(h, (u) => Math.min(1, u * 8) * Math.pow(1 - u, 1.5));
    mix(out, norm(h), 0.5);
    const rate = r.range(28, 40);
    for (let t = 0; t < 0.4; t += 1 / rate) grain(out, r, t + r.range(0, 0.005), 0.004, r.range(2500, 4500), 3, r.range(0.4, 1) * (1 - t * 1.8));
    return out;
  }],
  spider_death: [1, (r) => {
    const out = buf(0.9);
    const h = white(r, 0.8);
    sweep(h, 'bp', (u) => 2500 - 1800 * u, 1.2);
    envelope(h, (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.2));
    mix(out, norm(h), 0.6);
    for (let t = 0; t < 0.6; t += 1 / 25) grain(out, r, t, 0.005, r.range(1500, 3500), 3, (1 - t / 0.6) * 0.8);
    return out;
  }],
  enderman: [3, (r) => {
    const out = buf(1.0);
    const f = r.range(130, 180);
    const v = voice(r, {
      dur: 0.9, f0: (u) => f * (1 + 0.6 * Math.sin(TAU * u * r.range(1, 2.5))), jitter: 0.03, breath: 0.2, vib: 0.08, vibRate: 7,
      formants: (u) => lerpF(V.o, V.i, 0.5 + 0.5 * Math.sin(TAU * u * 2), 0.9), env: (u) => Math.pow(Math.sin(Math.PI * u), 1.5),
    });
    // modulation en anneau : timbre « d'un autre monde »
    const rm = r.range(50, 90);
    for (let i = 0; i < v.length; i++) v[i] *= 0.5 + 0.5 * Math.sin(TAU * rm * i / RATE);
    return mix(out, v);
  }],
  enderman_hurt: [2, (r) => {
    const v = voice(r, {
      dur: 0.45, f0: (u) => 380 - 180 * u, jitter: 0.05, breath: 0.3, vib: 0.1, vibRate: 18,
      formants: () => lerpF(V.a, V.i, 0.4, 1), env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.2),
    });
    for (let i = 0; i < v.length; i++) v[i] *= 0.4 + 0.6 * Math.sin(TAU * 60 * i / RATE);
    return v;
  }],
  enderman_death: [1, (r) => {
    const v = voice(r, {
      dur: 1.6, f0: (u) => 300 * Math.pow(0.2, u), jitter: 0.05, breath: 0.3, vib: 0.12, vibRate: 9,
      formants: (u) => lerpF(V.a, V.u, u, 1), env: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.1),
    });
    for (let i = 0; i < v.length; i++) v[i] *= 0.4 + 0.6 * Math.sin(TAU * 55 * i / RATE);
    return v;
  }],
  enderman_scream: [1, (r) => {
    const v = voice(r, {
      dur: 1.1, f0: (u) => 480 + 160 * u, jitter: 0.06, breath: 0.4, vib: 0.06, vibRate: 12,
      formants: () => lerpF(V.a, V.e, 0.5, 1.05), env: (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.8),
    });
    return saturate(norm(v), 1.4);
  }],
  teleport: [2, (r) => {
    const out = buf(0.5);
    let ph = 0, mph = 0;
    for (let i = 0; i < out.length; i++) {
      const u = i / out.length;
      const f = 180 * Math.pow(6, Math.sin(Math.PI * u));
      mph += TAU * 37 / RATE;
      ph += TAU * f * (1 + 0.3 * Math.sin(mph)) / RATE;
      out[i] = Math.sin(ph) * Math.pow(Math.sin(Math.PI * u), 1.2);
    }
    norm(out, 0.6);
    const n = white(r, 0.5);
    sweep(n, 'bp', (u) => 400 + 3000 * Math.sin(Math.PI * u), 2);
    envelope(n, (u) => Math.sin(Math.PI * u));
    mix(out, norm(n), 0.4);
    return out;
  }],
  blaze: [3, (r) => {
    const out = pink(r, 1.2);
    const f = r.range(500, 800);
    sweep(out, 'bp', (u) => f * (1 + 0.8 * Math.sin(TAU * u * 1.5)), 1.2);
    envelope(out, (u) => Math.pow(Math.sin(Math.PI * u), 1.3) * (0.6 + 0.4 * Math.sin(TAU * u * 3)));
    norm(out, 0.8);
    for (let k = 0; k < 25; k++) grain(out, r, r.range(0, 1.1), 0.003, r.range(2000, 6000), 1.5, r.range(0.2, 0.6));
    return out;
  }],
  blaze_hurt: [2, (r) => {
    const out = buf(0.4);
    const v = voice(r, {
      dur: 0.35, f0: (u) => 260 - 80 * u, jitter: 0.08, fry: 0.5, breath: 0.6,
      formants: () => lerpF(V.uh, V.a, 0.5, 1.2), env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.3),
    });
    mix(out, norm(v), 0.8);
    for (let k = 0; k < 12; k++) grain(out, r, r.range(0, 0.3), 0.004, r.range(1500, 5000), 2, 0.5);
    return out;
  }],
  blaze_death: [1, (r) => {
    const out = pink(r, 1.4);
    sweep(out, 'bp', (u) => 1500 * Math.pow(0.1, u), 1);
    envelope(out, (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1.2));
    norm(out);
    for (let k = 0; k < 40; k++) grain(out, r, r.range(0, 1.2), 0.004, r.range(1500, 6000), 2, r.range(0.2, 0.6));
    return out;
  }],
  blaze_charge: [1, (r) => {
    const out = pink(r, 0.9);
    sweep(out, 'lp', (u) => 300 + 2500 * u * u, 1.5);
    envelope(out, (u) => Math.pow(u, 1.5) * (u > 0.9 ? (1 - u) / 0.1 : 1));
    return out;
  }],
  blaze_shoot: [2, (r) => {
    const out = pink(r, 0.5);
    sweep(out, 'lp', (u) => 3000 * Math.pow(0.12, u), 1.2);
    envelope(out, (u) => Math.min(1, u * 40) * Math.pow(1 - u, 1.6));
    norm(out);
    chirp(out, 0, 0.18, 120, 50, 0.6);
    return out;
  }],
  ghast: [3, (r) => {
    const f = r.range(380, 470);
    const out = voice(r, {
      dur: r.range(1.3, 1.8), f0: (u) => f * (1 + 0.2 * Math.sin(Math.PI * u) - 0.3 * u * u), jitter: 0.02, breath: 0.25, vib: 0.025, vibRate: 5,
      formants: (u) => lerpF(V.u, V.o, Math.sin(Math.PI * u), 1.1), env: (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.1)), 1.5),
    });
    return out;
  }],
  ghast_hurt: [2, (r) => voice(r, {
    dur: 0.6, f0: (u) => 650 - 220 * u, jitter: 0.04, breath: 0.3, vib: 0.05, vibRate: 12,
    formants: () => lerpF(V.a, V.i, 0.5, 1.3), env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1.2),
  })],
  ghast_death: [1, (r) => voice(r, {
    dur: 1.8, f0: (u) => 800 * Math.pow(0.25, u), jitter: 0.04, breath: 0.3, vib: 0.05, vibRate: 7,
    formants: (u) => lerpF(V.a, V.u, u, 1.3), env: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 1),
  })],
  ghast_warn: [1, (r) => voice(r, {
    dur: 0.9, f0: (u) => 520 + 300 * u, jitter: 0.03, breath: 0.25, vib: 0.06, vibRate: 13,
    formants: () => lerpF(V.a, V.e, 0.4, 1.3), env: (u) => Math.min(1, u * 6) * Math.pow(1 - u, 0.8),
  })],
  ghast_shoot: [2, (r) => {
    const out = pink(r, 0.7);
    sweep(out, 'lp', (u) => 2500 * Math.pow(0.08, u), 1.5);
    envelope(out, (u) => Math.min(1, u * 30) * Math.pow(1 - u, 1.4));
    norm(out);
    chirp(out, 0, 0.3, 140, 45, 0.7);
    return out;
  }],
  piglin: [3, (r) => {
    const out = buf(0.6);
    let t = 0;
    for (let k = 0; k < 2; k++) {
      const d = r.range(0.12, 0.2);
      mix(out, voice(r, {
        dur: d, f0: (u) => r.range(85, 110) * (1.1 - 0.25 * u), jitter: 0.07, fry: 0.9, breath: 0.35,
        formants: () => lerpF(V.uh, V.o, 0.5, 0.85), env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1.2),
      }), 1, t);
      t += d + r.range(0.05, 0.12);
    }
    return out;
  }],
  piglin_hurt: [2, (r) => voice(r, {
    dur: 0.3, f0: (u) => 300 - 100 * u, jitter: 0.06, fry: 0.6, breath: 0.35,
    formants: () => lerpF(V.a, V.e, 0.4, 1), env: (u) => Math.min(1, u * 25) * Math.pow(1 - u, 1.2),
  })],
  piglin_angry: [1, (r) => saturate(norm(voice(r, {
    dur: 0.6, f0: (u) => 140 + 120 * u, jitter: 0.07, fry: 0.8, breath: 0.4,
    formants: (u) => lerpF(V.uh, V.a, u, 0.9), env: (u) => Math.min(1, u * 10) * Math.pow(1 - u, 0.8),
  })), 2)],
  golem_hurt: [2, (r) => {
    const out = buf(0.35);
    mix(out, norm(MAT.metal(r, true)), 0.7);
    mix(out, norm(voice(r, {
      dur: 0.3, f0: (u) => 75 - 15 * u, jitter: 0.05, fry: 0.5, breath: 0.2,
      formants: () => V.uh, env: (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.3),
    })), 0.6);
    return out;
  }],
  golem_attack: [1, (r) => {
    const out = pink(r, 0.4);
    sweep(out, 'bp', (u) => 300 + 900 * Math.sin(Math.PI * u), 1);
    envelope(out, (u) => Math.sin(Math.PI * u));
    norm(out, 0.6);
    chirp(out, 0.15, 0.2, 110, 45, 1);
    return out;
  }],
  slime: [3, (r) => {
    const out = pink(r, 0.25);
    const f = r.range(250, 400);
    sweep(out, 'bp', (u) => f * (1 + 2.5 * Math.sin(Math.PI * u)), 3);
    envelope(out, (u) => Math.min(1, u * 20) * Math.pow(1 - u, 2));
    norm(out, 0.7);
    chirp(out, 0, 0.12, f * 0.6, f * 0.3, 0.6);
    bubble(out, r, 0.05, 1.5, 0.3);
    return out;
  }],

  // --- combat, objets ---
  explode: [3, (r) => {
    const L = buf(2.6), R = buf(2.6);
    for (const [ch, seed] of [[L, 1], [R, 2]]) {
      const rr = new Rand(r.next() * 1e9 + seed);
      const boom = brown(rr, 2.6);
      sweep(boom, 'lp', (u) => 60 + 900 * Math.pow(1 - u, 4), 0.8);
      envelope(boom, (u, t) => Math.min(1, t * 400) * Math.exp(-t * 2.2));
      mix(ch, norm(boom), 1);
      const crack = white(rr, 0.12);
      filt(crack, 'lp', 5000, 0.7);
      envelope(crack, (u) => Math.pow(1 - u, 4));
      mix(ch, norm(crack), 0.6);
      const deb = buf(1.2);
      grains(deb, rr, { t0: 0.05, span: 0.9, count: 90, fmin: 300, fmax: 3500, q: 1.5, dmin: 0.005, dmax: 0.03, amp: 1, shape: 1.2 });
      mix(ch, norm(deb), 0.25);
    }
    const sub = buf(1.2);
    chirp(sub, 0, 1.1, 70, 28, 1);
    mix(L, sub, 0.7); mix(R, sub, 0.7);
    saturate(L, 1.5); saturate(R, 1.5);
    return [L, R];
  }],
  thunder: [2, (r) => {
    const L = buf(4.5), R = buf(4.5);
    const env = [];
    for (let k = 0; k < 8; k++) env.push([r.range(0.1, 3.2), r.range(0.3, 1)]);
    for (const [ch, seed] of [[L, 3], [R, 4]]) {
      const rr = new Rand(r.next() * 1e9 + seed);
      const rum = brown(rr, 4.5);
      filt(rum, 'lp', 260, 0.7);
      envelope(rum, (u, t) => {
        let e = Math.exp(-t * 0.7) * Math.min(1, t * 20);
        for (const [c, a] of env) e += a * Math.exp(-Math.abs(t - c) * 5) * 0.6;
        return e;
      });
      mix(ch, norm(rum), 1);
      const crack = white(rr, 0.4);
      filt(crack, 'lp', 3500, 0.7);
      envelope(crack, (u) => Math.pow(1 - u, 3) * (0.5 + 0.5 * rr.next()));
      mix(ch, norm(crack), 0.5);
    }
    return [saturate(L, 1.3), saturate(R, 1.3)];
  }],
  bow: [2, (r) => {
    const out = buf(0.35);
    const s = pluck(r, r.range(110, 140), 0.3, 0.992);
    envelope(s, (u) => Math.pow(1 - u, 1.5));
    mix(out, norm(s), 0.7);
    const w = white(r, 0.3);
    sweep(w, 'bp', (u) => 600 + 2500 * u, 1.2);
    envelope(w, (u) => Math.sin(Math.PI * Math.min(1, u * 1.2)) * (1 - u));
    mix(out, norm(w), 0.45);
    return out;
  }],
  arrow_hit: [3, (r) => {
    const out = buf(0.2);
    const f = r.range(260, 340);
    modal(out, strike(r, 0.004, 2000), [[f, 0.06, 1], [f * 2.4, 0.04, 0.5], [f * 4.1, 0.03, 0.3]]);
    norm(out);
    grain(out, r, 0, 0.01, 1200, 1, 0.5);
    return out;
  }],
  ding: [1, (r) => bell(buf(0.8), r, 0, 1560, 0.6, 1, 0.6)],
  eat: [4, (r) => {
    const out = buf(0.18);
    grains(out, r, { span: 0.1, count: 30, fmin: 400, fmax: 2200, q: 1.8, dmin: 0.004, dmax: 0.015, amp: 1 });
    filt(out, 'lp', 2500, 0.7);
    return out;
  }],
  burp: [1, (r) => voice(r, {
    dur: 0.4, f0: (u) => 95 - 20 * u, jitter: 0.08, fry: 0.9, breath: 0.3,
    formants: (u) => lerpF(V.uh, V.o, u, 0.9), env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1),
  })],
  drink: [3, (r) => {
    const out = buf(0.3);
    const f = r.range(200, 280);
    chirp(out, 0, 0.1, f, f * 1.8, 1);
    for (let k = 0; k < 4; k++) bubble(out, r, r.range(0.02, 0.2), 1.3, 0.4);
    const n = pink(r, 0.3);
    filt(n, 'lp', 600, 0.7);
    envelope(n, (u) => Math.pow(1 - u, 2));
    mix(out, norm(n), 0.2);
    return out;
  }],
  levelup: [1, (r) => {
    const out = buf(1.6);
    [72, 76, 79, 84].forEach((m, i) => bell(out, r, i * 0.07, 440 * Math.pow(2, (m - 69) / 12), 1.1, 0.7, 0.5));
    return out;
  }],
  xp: [4, (r) => {
    const out = buf(0.5);
    const f = r.range(1500, 1900);
    bell(out, r, 0, f, 0.35, 1, 0.4);
    bell(out, r, 0.03, f * 1.5, 0.25, 0.4, 0.3);
    return out;
  }],
  door_open: [2, (r) => door(r, true)],
  door_close: [2, (r) => door(r, false)],
  chest_open: [2, (r) => {
    const out = buf(0.6);
    mix(out, creak(r, 0.45, r.range(55, 75), 500), 0.8, 0.02);
    mix(out, norm(MAT.wood(r, true)), 0.5);
    return out;
  }],
  chest_close: [2, (r) => {
    const out = buf(0.4);
    const w = MAT.wood(r, false);
    mix(out, norm(w), 1);
    const th = brown(r, 0.2);
    filt(th, 'lp', 300, 0.7);
    envelope(th, (u) => Math.pow(1 - u, 3));
    mix(out, norm(th), 0.5);
    return out;
  }],
  fizz: [2, (r) => {
    const out = pink(r, 0.7);
    filt(out, 'bp', 1800, 0.7);
    envelope(out, (u) => Math.min(1, u * 30) * Math.pow(1 - u, 1.4));
    norm(out, 0.7);
    for (let k = 0; k < 40; k++) grain(out, r, r.range(0, 0.5), 0.003, r.range(3000, 8000), 2, r.range(0.2, 0.7));
    return out;
  }],
  splash: [3, (r) => {
    const out = buf(0.9);
    const n = white(r, 0.6);
    sweep(n, 'bp', (u) => 2200 - 1400 * u, 0.7);
    envelope(n, (u) => Math.min(1, u * 40) * Math.pow(1 - u, 2));
    mix(out, norm(n), 0.7);
    chirp(out, 0, 0.12, 150, 90, 0.4);
    for (let k = 0; k < 25; k++) bubble(out, r, Math.pow(r.next(), 1.5) * 0.7, r.range(0.6, 1.4), r.range(0.1, 0.3));
    return out;
  }],
  swim: [4, (r) => {
    const out = buf(0.5);
    const n = pink(r, 0.45);
    sweep(n, 'bp', (u) => 500 + 900 * Math.sin(Math.PI * u), 0.8);
    envelope(n, (u) => Math.sin(Math.PI * u));
    mix(out, norm(n), 0.7);
    for (let k = 0; k < 6; k++) bubble(out, r, r.range(0.05, 0.4), r.range(0.8, 1.5), 0.15);
    return out;
  }],
  glass: [3, (r) => MAT.glass(r, false)],
  item_break: [1, (r) => {
    const out = buf(0.5);
    const c = white(r, 0.05);
    envelope(c, (u) => Math.pow(1 - u, 3));
    mix(out, c, 0.8);
    for (let k = 0; k < 6; k++) {
      const tmp = buf(0.3);
      const f = r.range(1800, 5000);
      modal(tmp, strike(r, 0.001), [[f, 0.2, 1], [f * 2.7, 0.1, 0.4]]);
      mix(out, norm(tmp), 0.3, r.range(0, 0.1));
    }
    return out;
  }],
  portal: [2, (r) => {
    const dur = 3.5;
    const L = buf(dur), R = buf(dur);
    for (const [ch, off] of [[L, 0], [R, 1.3]]) {
      const n = pink(new Rand(r.next() * 1e9), dur);
      sweep(n, 'bp', (u) => 400 + 350 * Math.sin(TAU * (u * 1.4 + off)), 4);
      mix(ch, norm(n), 0.6);
      let ph = 0;
      for (let i = 0; i < ch.length; i++) {
        const t = i / RATE;
        ph += TAU * (58 + 3 * Math.sin(t * 1.3 + off)) / RATE;
        ch[i] += (Math.sin(ph) + 0.3 * Math.sin(ph * 2.01 + off)) * 0.25;
      }
      envelope(ch, (u) => Math.sin(Math.PI * u));
    }
    return [L, R];
  }],
  portal_travel: [1, (r) => {
    const dur = 4;
    const L = buf(dur), R = buf(dur);
    for (const [ch, off] of [[L, 0], [R, 0.7]]) {
      const n = pink(new Rand(r.next() * 1e9), dur);
      sweep(n, 'bp', (u) => 300 + 2500 * u * u + 200 * Math.sin(TAU * (u * 5 + off)), 3);
      mix(ch, norm(n), 0.7);
      let ph = 0;
      for (let i = 0; i < ch.length; i++) {
        const u = i / ch.length;
        ph += TAU * (60 + 300 * u * u) * (1 + 0.004 * Math.sin(i / RATE * 6 + off)) / RATE;
        ch[i] += Math.sin(ph) * 0.3;
      }
      envelope(ch, (u) => Math.min(1, u * 1.5) * (u > 0.9 ? (1 - u) / 0.1 : 1));
    }
    return [L, R];
  }],
  end_portal: [1, (r) => {
    const out = buf(4);
    const b = brown(r, 3);
    filt(b, 'lp', 200, 0.7);
    envelope(b, (u, t) => Math.min(1, t * 100) * Math.exp(-t * 1.2));
    mix(out, norm(b), 1);
    chirp(out, 0, 2, 90, 40, 0.8);
    [57, 64, 69, 72, 76].forEach((m, i) => bell(out, r, 0.2 + i * 0.18, 440 * Math.pow(2, (m - 69) / 12), 2.5, 0.35, 0.5));
    return out;
  }],
  eye_place: [2, (r) => {
    const out = buf(1.2);
    const n = white(r, 0.5);
    sweep(n, 'bp', (u) => 1000 + 3000 * u, 2);
    envelope(n, (u) => Math.pow(u, 2));
    mix(out, norm(n), 0.4);
    bell(out, r, 0.45, r.range(880, 990), 0.7, 0.8, 0.6);
    return out;
  }],
  milk: [1, (r) => {
    const out = buf(0.6);
    const n = pink(r, 0.5);
    sweep(n, 'bp', (u) => 400 + 600 * Math.sin(Math.PI * u), 1);
    envelope(n, (u) => Math.sin(Math.PI * u));
    mix(out, norm(n), 0.6);
    for (let k = 0; k < 10; k++) bubble(out, r, r.range(0, 0.45), 1.2, 0.2);
    return out;
  }],
  shear: [2, (r) => {
    const out = buf(0.3);
    for (const t of [0, 0.12]) {
      const tmp = buf(0.1);
      modal(tmp, strike(r, 0.001), [[r.range(2400, 3000), 0.03, 1], [r.range(4200, 4800), 0.02, 0.4]]);
      mix(out, norm(tmp), 0.6, t);
      grain(out, r, t, 0.04, 5000, 1, 0.4);
    }
    return out;
  }],
  fire: [3, (r) => {
    const out = pink(r, 1.2);
    filt(out, 'lp', 400, 0.7);
    envelope(out, (u) => Math.sin(Math.PI * u) * (0.6 + 0.4 * Math.sin(u * 17)));
    norm(out, 0.35);
    for (let k = 0; k < 18; k++) {
      const t = r.range(0, 1.1);
      grain(out, r, t, r.range(0.002, 0.006), r.range(1500, 6000), 1, r.range(0.3, 1));
      if (r.next() < 0.3) grain(out, r, t + 0.004, 0.003, r.range(2000, 5000), 1, 0.3);
    }
    return out;
  }],
  ignite: [2, (r) => {
    const out = buf(0.5);
    const s = white(r, 0.12);
    filt(s, 'bp', 4500, 1.5);
    envelope(s, (u) => Math.sin(Math.PI * u));
    mix(out, norm(s), 0.7);
    for (let k = 0; k < 8; k++) grain(out, r, r.range(0.02, 0.15), 0.003, r.range(3000, 8000), 1.5, 0.5);
    const f = pink(r, 0.4);
    filt(f, 'lp', 900, 0.7);
    envelope(f, (u) => Math.min(1, u * 5) * Math.pow(1 - u, 1.5));
    mix(out, norm(f), 0.35, 0.08);
    return out;
  }],
  dragon_growl: [2, (r) => {
    const out = voice(r, {
      dur: 2.2, f0: (u) => 55 * (1 + 0.3 * Math.sin(Math.PI * u)), jitter: 0.08, fry: 1, breath: 0.6,
      formants: (u) => lerpF(V.o, V.a, Math.sin(Math.PI * u), 0.6), env: (u) => Math.min(1, u * 4) * Math.pow(1 - u, 0.8),
    });
    const n = brown(r, 2.2);
    filt(n, 'lp', 400, 0.7);
    envelope(n, (u) => Math.sin(Math.PI * u));
    mix(norm(out), norm(n), 0.4);
    return saturate(norm(out), 2);
  }],
  dragon_flap: [3, (r) => {
    const out = pink(r, 0.7);
    sweep(out, 'lp', (u) => 200 + 700 * Math.sin(Math.PI * Math.min(1, u * 1.6)), 1);
    envelope(out, (u) => Math.pow(Math.sin(Math.PI * Math.min(1, u * 1.6)), 2) * (u < 0.62 ? 1 : 0.15));
    return out;
  }],
  dragon_hurt: [2, (r) => saturate(norm(voice(r, {
    dur: 0.8, f0: (u) => 120 - 40 * u, jitter: 0.08, fry: 1, breath: 0.5,
    formants: (u) => lerpF(V.a, V.o, u, 0.7), env: (u) => Math.min(1, u * 15) * Math.pow(1 - u, 1),
  })), 2)],
  dragon_shoot: [2, (r) => {
    const out = pink(r, 0.9);
    sweep(out, 'bp', (u) => 900 * Math.pow(0.3, u), 0.8);
    envelope(out, (u) => Math.min(1, u * 20) * Math.pow(1 - u, 1.3));
    norm(out);
    chirp(out, 0, 0.4, 100, 40, 0.6);
    return out;
  }],
  dragon_breath: [1, (r) => {
    const out = white(r, 1.8);
    sweep(out, 'bp', (u) => 700 + 400 * Math.sin(TAU * u * 2), 0.6);
    envelope(out, (u) => Math.min(1, u * 5) * Math.pow(1 - u, 0.8));
    norm(out);
    for (let k = 0; k < 30; k++) grain(out, r, r.range(0, 1.6), 0.004, r.range(1000, 4000), 1.5, 0.4);
    return out;
  }],
  dragon_death: [1, (r) => {
    const L = voice(r, {
      dur: 8, f0: (u) => 60 * Math.pow(5, u), jitter: 0.05, fry: 0.6, breath: 0.4, vib: 0.02, vibRate: 5,
      formants: (u) => lerpF(V.o, V.a, u, 0.8), env: (u) => Math.min(1, u * 4) * (u > 0.85 ? (1 - u) / 0.15 : 1),
    });
    const n = brown(r, 8);
    filt(n, 'lp', 300, 0.7);
    envelope(n, (u) => Math.min(1, u * 2) * (1 - u));
    mix(norm(L), norm(n), 0.5);
    return saturate(norm(L), 1.5);
  }],
  toast: [1, (r) => {
    const out = buf(1.2);
    bell(out, r, 0, 880, 0.9, 0.8, 0.3);
    bell(out, r, 0.12, 1318.5, 0.9, 0.8, 0.3);
    return out;
  }],
  challenge: [1, (r) => {
    const out = buf(2.2);
    [67, 71, 74, 79, 83, 86].forEach((m, i) => bell(out, r, i * 0.1, 440 * Math.pow(2, (m - 69) / 12), 1.4, 0.6, 0.4));
    [55, 62, 67].forEach((m) => toneAdd(out, 0.5, 1.6, 440 * Math.pow(2, (m - 69) / 12), 0.12, { type: 'tri', attack: 0.2, vib: 0.004 }));
    return out;
  }],
  anvil: [2, (r) => MAT.metal(r, false)],
  enchant: [2, (r) => {
    const out = buf(1.6);
    for (let k = 0; k < 9; k++) bell(out, r, r.range(0, 0.6), r.range(1200, 3500), r.range(0.4, 0.9), r.range(0.2, 0.5), 0.3);
    const n = white(r, 1.2);
    sweep(n, 'bp', (u) => 3000 + 3000 * u, 3);
    envelope(n, (u) => Math.sin(Math.PI * u) * 0.5);
    mix(out, norm(n), 0.15);
    return out;
  }],
  brew: [2, (r) => {
    const out = buf(0.8);
    for (let k = 0; k < 14; k++) bubble(out, r, r.range(0, 0.7), r.range(0.8, 1.6), r.range(0.2, 0.5));
    return out;
  }],
  cave: [3, (r) => {
    const dur = 5;
    const out = buf(dur);
    const base = r.range(80, 140);
    for (let k = 0; k < 3; k++) {
      const f = base * [1, 1.5, 2.1][k] * r.range(0.98, 1.02);
      let ph = 0;
      for (let i = 0; i < out.length; i++) {
        const u = i / out.length;
        ph += TAU * f * (1 - 0.1 * u) / RATE;
        out[i] += Math.sin(ph) * 0.2 / (k + 1) * Math.pow(Math.sin(Math.PI * u), 2);
      }
    }
    const n = pink(r, dur);
    sweep(n, 'bp', (u) => 200 + 300 * Math.sin(Math.PI * u), 3);
    envelope(n, (u) => Math.pow(Math.sin(Math.PI * u), 2));
    mix(out, norm(n), 0.3);
    return out;
  }],
});

function door(r, open) {
  const out = buf(0.6);
  if (open) {
    mix(out, creak(r, 0.3, r.range(70, 100), 800), 0.7);
    grain(out, r, 0, 0.006, 2500, 2, 0.6);
    mix(out, norm(MAT.wood(r, true)), 0.4, 0.02);
  } else {
    mix(out, creak(r, 0.15, r.range(90, 120), 900), 0.4);
    mix(out, norm(MAT.wood(r, false)), 1, 0.12);
    grain(out, r, 0.13, 0.006, 3000, 2, 0.5);
  }
  return out;
}

// Grincement : frottement collé-glissé (train d'impulsions irrégulier) dans une résonance
function creak(r, dur, rate, f) {
  const out = buf(dur);
  let t = 0;
  while (t < dur) {
    const u = t / dur;
    const i = Math.floor(t * RATE);
    if (i < out.length) out[i] += (0.5 + 0.5 * r.next()) * Math.sin(Math.PI * u);
    t += 1 / (rate * (1 + 0.5 * Math.sin(u * 7)) * r.range(0.85, 1.15));
  }
  const a = Float32Array.from(out);
  const b1 = new Biquad('bp', f, 8), b2 = new Biquad('bp', f * 2.3, 8), b3 = new Biquad('bp', f * 3.6, 6);
  for (let i = 0; i < out.length; i++) out[i] = b1.p(a[i]) + 0.6 * b2.p(a[i]) + 0.3 * b3.p(a[i]);
  return norm(out);
}

// ---------- boucles d'ambiance (stéréo, raccord sans couture) ----------
function loopify(ch, fade) {
  const n = Math.floor(fade * RATE);
  const len = ch.length - n;
  const out = new Float32Array(len);
  for (let i = 0; i < len; i++) out[i] = ch[i];
  for (let i = 0; i < n; i++) {
    const a = i / n;
    out[i] = ch[i] * Math.sqrt(a) + ch[len + i] * Math.sqrt(1 - a);
  }
  return out;
}

export const LOOPS = {
  rain(r) {
    const dur = 4.5;
    return [0, 1].map((c) => {
      const rr = new Rand(r.next() * 1e9 + c);
      const ch = pink(rr, dur);
      filt(ch, 'hp', 250, 0.7);
      filt(ch, 'lp', 3200, 0.7);
      norm(ch, 0.4);
      for (let k = 0; k < 700; k++) grain(ch, rr, rr.range(0, dur), rr.range(0.003, 0.008), rr.range(900, 3500), 1.2, rr.range(0.04, 0.2));
      for (let k = 0; k < 40; k++) bubble(ch, rr, rr.range(0, dur), rr.range(0.5, 1), 0.05);
      return loopify(norm(ch, 0.8), 0.5);
    });
  },
  nether(r) {
    const dur = 8;
    return [0, 1].map((c) => {
      const rr = new Rand(r.next() * 1e9 + c);
      const ch = brown(rr, dur);
      sweep(ch, 'lp', (u) => 150 + 120 * Math.sin(TAU * (u * 2 + c * 0.3)), 1.5);
      norm(ch, 0.8);
      let ph = 0;
      for (let i = 0; i < ch.length; i++) { ph += TAU * (41 + c * 0.4) / RATE; ch[i] += Math.sin(ph) * 0.15 * (0.6 + 0.4 * Math.sin(i / RATE * 0.8)); }
      for (let k = 0; k < 30; k++) grain(ch, rr, rr.range(0, dur), 0.004, rr.range(800, 3000), 2, rr.range(0.05, 0.15));
      return loopify(norm(ch, 0.8), 1);
    });
  },
  end(r) {
    const dur = 9;
    return [0, 1].map((c) => {
      const rr = new Rand(r.next() * 1e9 + c);
      const ch = pink(rr, dur);
      sweep(ch, 'bp', (u) => 350 + 250 * Math.sin(TAU * (u * 1 + c * 0.5)), 2.5);
      norm(ch, 0.6);
      let ph = 0, ph2 = 0;
      for (let i = 0; i < ch.length; i++) {
        ph += TAU * 55 / RATE; ph2 += TAU * (82.6 + c * 0.3) / RATE;
        ch[i] += (Math.sin(ph) * 0.12 + Math.sin(ph2) * 0.08) * (0.7 + 0.3 * Math.sin(i / RATE * 0.7 + c));
      }
      return loopify(norm(ch, 0.7), 1.2);
    });
  },
  underwater(r) {
    const dur = 5;
    return [0, 1].map((c) => {
      const rr = new Rand(r.next() * 1e9 + c);
      const ch = brown(rr, dur);
      filt(ch, 'lp', 350, 0.7);
      norm(ch, 0.6);
      for (let k = 0; k < 25; k++) bubble(ch, rr, rr.range(0, dur), rr.range(1, 2), rr.range(0.05, 0.15));
      return loopify(norm(ch, 0.7), 0.8);
    });
  },
};

// ---------- piano (musique) ----------
// Synthèse additive : partiels légèrement inharmoniques, deux cordes désaccordées
// (battements), attaque feutrée du marteau. Rendu à mi-fréquence pour économiser la mémoire.
export const PIANO_RATE = 22050;
export function pianoNote(midi, vel = 0.7, seed = 1) {
  const r = new Rand(seed * 7919 + midi);
  const f0 = 440 * Math.pow(2, (midi - 69) / 12);
  const dur = Math.min(6, 2.5 + 3.5 * Math.pow(220 / f0, 0.5));
  const n = Math.ceil(dur * PIANO_RATE);
  const out = new Float32Array(n);
  const B = 0.00025 * Math.pow(f0 / 262, 0.8);
  const bright = 0.4 + 0.6 * vel;
  const baseT = 5.5 * Math.pow(262 / f0, 0.55);
  for (let k = 1; k <= 16; k++) {
    const fk = k * f0 * Math.sqrt(1 + B * k * k);
    if (fk > PIANO_RATE * 0.45) break;
    // spectre du marteau : creux vers le 7e partiel (point de frappe)
    const hammer = Math.abs(Math.sin(Math.PI * k / 7.5)) * 0.8 + 0.2;
    const amp = hammer * Math.pow(k, -1.1 - (1 - bright) * 0.8);
    const t60 = baseT / (1 + 0.35 * (k - 1));
    const dec = Math.log(1000) / t60;
    const det = 1 + (r.next() - 0.5) * 0.0012;
    const w1 = TAU * fk / PIANO_RATE, w2 = w1 * det;
    const c1 = Math.cos(w1), s1 = Math.sin(w1), c2 = Math.cos(w2), s2 = Math.sin(w2);
    const ph = r.next() * TAU;
    let x1 = Math.cos(ph), y1 = Math.sin(ph), x2 = 1, y2 = 0;
    // décroissance double : chute rapide puis résonance longue (comme une vraie corde)
    let ea = 0.65 * amp * 0.5, eb = 0.35 * amp * 0.5;
    const da = Math.exp(-dec * 2.2 / PIANO_RATE), db = Math.exp(-dec / PIANO_RATE);
    for (let i = 0; i < n; i++) {
      out[i] += (ea + eb) * (y1 + y2);
      const nx1 = x1 * c1 - y1 * s1; y1 = x1 * s1 + y1 * c1; x1 = nx1;
      const nx2 = x2 * c2 - y2 * s2; y2 = x2 * s2 + y2 * c2; x2 = nx2;
      ea *= da; eb *= db;
      if (eb < 1e-5) break;
    }
  }
  // attaque du marteau (bruit feutré très court)
  const hn = Math.floor(0.012 * PIANO_RATE);
  let lp = 0;
  for (let i = 0; i < hn; i++) {
    lp += (r.bi() - lp) * 0.2;
    out[i] += lp * 0.25 * vel * Math.pow(1 - i / hn, 2);
  }
  for (let i = 0; i < 64; i++) out[i] *= i / 64;
  const rel = Math.floor(0.3 * PIANO_RATE);
  for (let i = 0; i < rel; i++) out[n - 1 - i] *= i / rel;
  return norm(out, 0.5 + 0.5 * vel);
}

// ---------- génération ----------
export const SOUND_NAMES = Object.keys(DEF);

export function variantCount(name) {
  return DEF[name] ? DEF[name][0] : 0;
}

// ---------- sonie perçue ----------
// Pondération proche de la courbe A (l'oreille est plus sensible entre 1 et 5 kHz),
// puis valeur efficace maximale sur une fenêtre glissante de 100 ms. Résultat en dB.
export function loudness(ch) {
  const hp1 = new Biquad('hp', 400, 0.5), hp2 = new Biquad('hp', 120, 0.7), lp = new Biquad('lp', 9000, 0.7);
  const win = Math.min(ch.length, Math.floor(0.1 * RATE));
  const sq = new Float32Array(ch.length);
  for (let i = 0; i < ch.length; i++) { const a = lp.p(hp2.p(hp1.p(ch[i]))); sq[i] = a * a; }
  let acc = 0, best = 0;
  for (let i = 0; i < ch.length; i++) {
    acc += sq[i];
    if (i >= win) acc -= sq[i - win];
    if (acc > best) best = acc;
  }
  return 20 * Math.log10(Math.sqrt(best / Math.max(1, win)) + 1e-9);
}

// Part d'énergie au-dessus de 3,5 kHz (dureté)
export function harshness(ch) {
  const hp = new Biquad('hp', 3500, 0.7);
  let hi = 0, all = 0;
  for (let i = 0; i < ch.length; i++) { const h = hp.p(ch[i]); hi += h * h; all += ch[i] * ch[i]; }
  return hi / (all + 1e-12);
}

// Sonie visée par son (dB) : les cris aigus, sifflements et sons d'interface sont plus discrets
const TARGET = {
  click: -27, pop: -23, xp: -25, ding: -24, levelup: -21, toast: -22, challenge: -21, enchant: -25, brew: -24, anvil: -21,
  hiss: -24, fuse: -26, fizz: -26, fire: -28, ignite: -24, portal: -26, portal_travel: -22, end_portal: -18, cave: -24, eye_place: -22,
  explode: -15, thunder: -16, fall_big: -19, fall_small: -22, splash: -21, swim: -25, drink: -23, eat: -23, burp: -23, milk: -23,
  ghast: -23, ghast_warn: -23, ghast_hurt: -22, ghast_death: -22, ghast_shoot: -20,
  enderman: -24, enderman_scream: -24, enderman_hurt: -22, enderman_death: -22, teleport: -23,
  chicken: -24, chicken_hurt: -23, pig: -22, pig_hurt: -22, sheep: -22, cow: -21, cow_hurt: -21, villager: -23, villager_hurt: -22,
  glass: -21, shear: -25, bow: -22, arrow_hit: -21, item_break: -21, spider: -23, spider_death: -22, creeper_hurt: -22,
  dragon_growl: -17, dragon_death: -16, dragon_flap: -19, dragon_hurt: -18, dragon_shoot: -19, dragon_breath: -21,
  player_hurt: -19, blaze: -24, golem_attack: -20,
};
function targetFor(name) {
  if (TARGET[name] !== undefined) return TARGET[name];
  if (name.endsWith('_step')) return -21;
  if (name.startsWith('mat_')) return -19;
  return -21;
}

// Adoucit et met au même niveau perçu : passe-bas, aigus atténués selon la dureté,
// attaques adoucies, gain calculé sur la sonie, crête plafonnée.
function finish(name, chans) {
  const hard = harshness(chans[0]);
  for (const c of chans) {
    filt(c, 'lp', 8000, 0.6);
    if (hard > 0.15) {
      const b = new Biquad('hs', 3000, 0.707, -Math.min(9, 4 + hard * 10));
      for (let i = 0; i < c.length; i++) c[i] = b.p(c[i]);
    }
    fadeEdges(c, 0.0015, 0.012);
  }
  let L = -200;
  for (const c of chans) L = Math.max(L, loudness(c));
  let g = Math.pow(10, (targetFor(name) - L) / 20);
  let m = 0;
  for (const c of chans) m = Math.max(m, peak(c));
  if (m * g > 0.85) g = 0.85 / m;
  for (const c of chans) for (let i = 0; i < c.length; i++) c[i] *= g;
  return chans;
}

// Renvoie { channels: [Float32Array...], rate }
export function synth(name, variant) {
  const d = DEF[name];
  if (!d) return null;
  const r = new Rand(((hashName(name) * 31 + variant * 977) >>> 0) + 1);
  const res = d[1](r);
  const chans = Array.isArray(res) ? res : [res];
  return { channels: finish(name, chans), rate: RATE };
}

export function synthLoop(name) {
  const r = new Rand(hashName(name) + 11);
  return { channels: LOOPS[name](r), rate: RATE };
}

function hashName(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
