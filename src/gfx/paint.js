// Outils de dessin pixel-art pour générer les textures 16x16
import { mulberry32, hashString } from '../core/noise.js';

export function hex(c) {
  if (Array.isArray(c)) return c;
  const n = parseInt(c.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];
}

export function shade(c, f) {
  c = hex(c);
  return [Math.min(255, c[0] * f) | 0, Math.min(255, c[1] * f) | 0, Math.min(255, c[2] * f) | 0, c[3] ?? 255];
}

export function mix(a, b, t) {
  a = hex(a); b = hex(b);
  return [
    (a[0] + (b[0] - a[0]) * t) | 0,
    (a[1] + (b[1] - a[1]) * t) | 0,
    (a[2] + (b[2] - a[2]) * t) | 0,
    ((a[3] ?? 255) + ((b[3] ?? 255) - (a[3] ?? 255)) * t) | 0,
  ];
}

export class Painter {
  constructor(name, size = 16) {
    this.size = size;
    this.data = new Uint8ClampedArray(size * size * 4);
    this.rng = mulberry32(hashString(name));
  }
  r() { return this.rng(); }
  ri(n) { return Math.floor(this.rng() * n); }
  set(x, y, c) {
    const s = this.size;
    if (x < 0 || y < 0 || x >= s || y >= s) return;
    c = hex(c);
    const i = (y * s + x) * 4;
    this.data[i] = c[0]; this.data[i + 1] = c[1]; this.data[i + 2] = c[2]; this.data[i + 3] = c[3] ?? 255;
  }
  get(x, y) {
    const s = this.size;
    x = ((x % s) + s) % s; y = ((y % s) + s) % s;
    const i = (y * s + x) * 4;
    return [this.data[i], this.data[i + 1], this.data[i + 2], this.data[i + 3]];
  }
  alpha(x, y) {
    const s = this.size;
    if (x < 0 || y < 0 || x >= s || y >= s) return 0;
    return this.data[(y * s + x) * 4 + 3];
  }
  fill(c) {
    for (let y = 0; y < this.size; y++) for (let x = 0; x < this.size; x++) this.set(x, y, c);
    return this;
  }
  clear() { this.data.fill(0); return this; }
  // Bruit de luminosité par pixel
  noise(c, amp = 0.1, x0 = 0, y0 = 0, w = this.size, h = this.size) {
    c = hex(c);
    for (let y = y0; y < y0 + h; y++)
      for (let x = x0; x < x0 + w; x++) this.set(x, y, shade(c, 1 + (this.r() * 2 - 1) * amp));
    return this;
  }
  rect(x, y, w, h, c) {
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, c);
    return this;
  }
  rectNoise(x, y, w, h, c, amp = 0.08) { return this.noise(c, amp, x, y, w, h); }
  speckle(c, count, size = 1, pred) {
    for (let n = 0; n < count; n++) {
      const x = this.ri(this.size), y = this.ri(this.size);
      if (pred && !pred(x, y)) continue;
      for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) this.set(x + i, y + j, shade(c, 0.9 + this.r() * 0.2));
    }
    return this;
  }
  // Blob (tâche de minerai)
  blobs(c, count, minSize = 2, maxSize = 4, margin = 1) {
    const cc = hex(c);
    for (let n = 0; n < count; n++) {
      let x = margin + this.ri(this.size - margin * 2), y = margin + this.ri(this.size - margin * 2);
      const size = minSize + this.ri(maxSize - minSize + 1);
      for (let k = 0; k < size; k++) {
        this.set(x, y, shade(cc, 0.85 + this.r() * 0.3));
        const d = this.ri(4);
        if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else y--;
        x = Math.max(margin, Math.min(this.size - 1 - margin, x));
        y = Math.max(margin, Math.min(this.size - 1 - margin, y));
      }
    }
    return this;
  }
  hline(x, y, w, c) { return this.rect(x, y, w, 1, c); }
  vline(x, y, h, c) { return this.rect(x, y, 1, h, c); }
  border(c, x = 0, y = 0, w = this.size, h = this.size) {
    this.hline(x, y, w, c); this.hline(x, y + h - 1, w, c);
    this.vline(x, y, h, c); this.vline(x + w - 1, y, h, c);
    return this;
  }
  // Biseau : bord clair en haut/gauche, sombre en bas/droite
  bevel(light, dark, x = 0, y = 0, w = this.size, h = this.size) {
    this.hline(x, y, w, light); this.vline(x, y, h, light);
    this.hline(x, y + h - 1, w, dark); this.vline(x + w - 1, y, h, dark);
    return this;
  }
  // Dessin ASCII avec palette ; '.' = inchangé
  ascii(rows, pal, ox = 0, oy = 0) {
    for (let y = 0; y < rows.length; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const ch = row[x];
        if (ch === '.' || ch === ' ') continue;
        const c = pal[ch];
        if (c === undefined) continue;
        if (c === null) this.set(ox + x, oy + y, [0, 0, 0, 0]);
        else this.set(ox + x, oy + y, typeof c === 'function' ? c(ox + x, oy + y) : c);
      }
    }
    return this;
  }
  // Ajoute un contour sombre autour des pixels opaques (icônes)
  outline(c = [30, 22, 18, 255], diag = false) {
    const s = this.size;
    const add = [];
    for (let y = 0; y < s; y++)
      for (let x = 0; x < s; x++) {
        if (this.alpha(x, y) > 0) continue;
        let near = this.alpha(x - 1, y) > 0 || this.alpha(x + 1, y) > 0 || this.alpha(x, y - 1) > 0 || this.alpha(x, y + 1) > 0;
        if (!near && diag)
          near = this.alpha(x - 1, y - 1) > 0 || this.alpha(x + 1, y + 1) > 0 || this.alpha(x - 1, y + 1) > 0 || this.alpha(x + 1, y - 1) > 0;
        if (near) add.push(x, y);
      }
    for (let i = 0; i < add.length; i += 2) this.set(add[i], add[i + 1], c);
    return this;
  }
  // Copie depuis un autre painter
  blit(src, ox = 0, oy = 0) {
    for (let y = 0; y < src.size; y++)
      for (let x = 0; x < src.size; x++) {
        const c = src.get(x, y);
        if (c[3] > 0) this.set(x + ox, y + oy, c);
      }
    return this;
  }
  copyFrom(src) { this.data.set(src.data); return this; }
  // Convertit en niveaux de gris (pour les textures teintées par biome)
  gray(f = 1) {
    for (let i = 0; i < this.data.length; i += 4) {
      const g = (this.data[i] * 0.3 + this.data[i + 1] * 0.59 + this.data[i + 2] * 0.11) * f;
      this.data[i] = this.data[i + 1] = this.data[i + 2] = g;
    }
    return this;
  }
  map(fn) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const c = this.get(x, y);
        const r = fn(c, x, y);
        if (r) this.set(x, y, r);
      }
    return this;
  }
  flipX() {
    const s = this.size, d = new Uint8ClampedArray(this.data);
    for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) for (let k = 0; k < 4; k++) this.data[(y * s + x) * 4 + k] = d[(y * s + (s - 1 - x)) * 4 + k];
    return this;
  }
  line(x0, y0, x1, y1, c) {
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.set(x0, y0, typeof c === 'function' ? c(x0, y0) : c);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
    return this;
  }
  circle(cx, cy, r, c) {
    for (let y = 0; y < this.size; y++)
      for (let x = 0; x < this.size; x++) {
        const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
        if (d <= r) this.set(x, y, typeof c === 'function' ? c(x, y, d) : c);
      }
    return this;
  }
}
