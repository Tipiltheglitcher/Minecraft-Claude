// Moteur de lumière : lumière du ciel et des blocs (propagation par BFS)
import { OPACITY, EMIT } from '../data/blocks.js';
import { ST_LIT } from './chunk.js';

const QSIZE = 1 << 20;
const DX = [0, 0, -1, 1, 0, 0];
const DY = [0, 0, 0, 0, 1, -1];
const DZ = [-1, 1, 0, 0, 0, 0];

export class LightEngine {
  constructor(world) {
    this.world = world;
    this.q = new Int32Array(QSIZE * 3);
    this.rq = new Int32Array(QSIZE * 4);
    this.current = null; // chunk en cours d'initialisation (écriture autorisée)
    this._c = null;
  }

  chunkAt(x, z) {
    const c = this._c;
    if (c && c.cx === x >> 4 && c.cz === z >> 4) return c;
    const n = this.world.getChunk(x >> 4, z >> 4);
    this._c = n;
    return n;
  }

  writable(c) {
    return c && (c === this.current || c.state >= ST_LIT);
  }

  markDirty(c, x, y, z) {
    const s = y >> 4;
    c.dirty[s] = 1;
    const ly = y & 15, lx = x & 15, lz = z & 15;
    if (ly === 0 && s > 0) c.dirty[s - 1] = 1;
    if (ly === 15 && s < 7) c.dirty[s + 1] = 1;
    if (lx === 0 || lx === 15 || lz === 0 || lz === 15) {
      const w = this.world;
      if (lx === 0) { const n = w.getChunk(c.cx - 1, c.cz); if (n) n.dirty[s] = 1; }
      if (lx === 15) { const n = w.getChunk(c.cx + 1, c.cz); if (n) n.dirty[s] = 1; }
      if (lz === 0) { const n = w.getChunk(c.cx, c.cz - 1); if (n) n.dirty[s] = 1; }
      if (lz === 15) { const n = w.getChunk(c.cx, c.cz + 1); if (n) n.dirty[s] = 1; }
    }
  }

  // ---------- Propagation (ajout) ----------
  // sky = true : lumière du ciel (4 bits hauts)
  propagate(qlen, sky) {
    const q = this.q;
    let head = 0;
    let tail = qlen;
    while (head !== tail) {
      const x = q[head * 3], y = q[head * 3 + 1], z = q[head * 3 + 2];
      head = (head + 1) & (QSIZE - 1);
      const c = this.chunkAt(x, z);
      if (!c) continue;
      const i = (y << 8) | ((z & 15) << 4) | (x & 15);
      const level = sky ? c.light[i] >> 4 : c.light[i] & 15;
      if (level <= 1) continue;
      for (let d = 0; d < 6; d++) {
        const ny = y + DY[d];
        if (ny < 0 || ny > 127) continue;
        const nx = x + DX[d], nz = z + DZ[d];
        const nc = d < 4 ? this.chunkAt(nx, nz) : c;
        if (!this.writable(nc)) continue;
        const ni = (ny << 8) | ((nz & 15) << 4) | (nx & 15);
        const op = OPACITY[nc.blocks[ni]];
        if (op >= 15) continue;
        let nl = level - (op > 1 ? op : 1);
        if (sky && d === 5 && level === 15 && op === 0) nl = 15;
        const cur = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
        if (nl > cur) {
          nc.light[ni] = sky ? (nl << 4) | (nc.light[ni] & 15) : (nc.light[ni] & 0xf0) | nl;
          this.markDirty(nc, nx, ny, nz);
          q[tail * 3] = nx; q[tail * 3 + 1] = ny; q[tail * 3 + 2] = nz;
          tail = (tail + 1) & (QSIZE - 1);
          if (tail === head) { console.warn('Débordement file lumière'); return; }
        }
      }
      if (c !== this._c) this._c = c;
    }
  }

  // ---------- Initialisation d'un chunk ----------
  initChunk(chunk, hasSky) {
    this.current = chunk;
    this._c = null;
    const L = chunk.light, blocks = chunk.blocks;
    L.fill(0);
    const hmap = new Int16Array(256);
    // lumière du ciel verticale
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        let level = hasSky ? 15 : 0;
        let h = -1;
        for (let y = 127; y >= 0; y--) {
          const i = (y << 8) | (lz << 4) | lx;
          const op = OPACITY[blocks[i]];
          if (op) {
            if (h < 0) h = y;
            level = level > op ? level - op : 0;
          }
          if (level) L[i] = level << 4;
          else if (op >= 15) break;
        }
        hmap[lz * 16 + lx] = h;
      }
    const q = this.q;
    let n = 0;
    const ox = chunk.cx * 16, oz = chunk.cz * 16;
    if (hasSky) {
      // graines : cellules éclairées à côté de colonnes plus hautes, ou partiellement éclairées
      for (let lz = 0; lz < 16; lz++)
        for (let lx = 0; lx < 16; lx++) {
          const h = hmap[lz * 16 + lx];
          let maxN = h;
          if (lx > 0) maxN = Math.max(maxN, hmap[lz * 16 + lx - 1]); else maxN = 127;
          if (lx < 15) maxN = Math.max(maxN, hmap[lz * 16 + lx + 1]); else maxN = 127;
          if (lz > 0) maxN = Math.max(maxN, hmap[(lz - 1) * 16 + lx]); else maxN = 127;
          if (lz < 15) maxN = Math.max(maxN, hmap[(lz + 1) * 16 + lx]); else maxN = 127;
          const top = Math.min(127, maxN + 1);
          for (let y = Math.max(0, h - 1); y <= top; y++) {
            const i = (y << 8) | (lz << 4) | lx;
            const l = L[i] >> 4;
            if (l > 1) { q[n * 3] = ox + lx; q[n * 3 + 1] = y; q[n * 3 + 2] = oz + lz; n++; }
          }
          // sous les feuilles / l'eau
          for (let y = h - 2; y >= 0; y--) {
            const i = (y << 8) | (lz << 4) | lx;
            const l = L[i] >> 4;
            if (l === 0) break;
            if (l > 1) { q[n * 3] = ox + lx; q[n * 3 + 1] = y; q[n * 3 + 2] = oz + lz; n++; }
          }
          if (n > QSIZE - 20000) break;
        }
    }
    n = this.pullBorders(chunk, n, true);
    this.propagate(n, true);

    // lumière des blocs
    n = 0;
    for (let i = 0; i < L.length; i++) {
      const e = EMIT[blocks[i]];
      if (e) {
        L[i] = (L[i] & 0xf0) | e;
        q[n * 3] = ox + (i & 15); q[n * 3 + 1] = i >> 8; q[n * 3 + 2] = oz + ((i >> 4) & 15);
        n++;
      }
    }
    n = this.pullBorders(chunk, n, false);
    this.propagate(n, false);
    this.current = null;
    chunk.state = ST_LIT;
  }

  // Chunk déjà éclairé en interne (worker) : raccorde la lumière avec les voisins éclairés,
  // dans les deux sens, en ne semant que les cellules de bord où elle doit passer
  finishChunk(chunk, hasSky) {
    this.current = chunk;
    this._c = null;
    const q = this.q, w = this.world;
    const L = chunk.light, B = chunk.blocks;
    const sides = [[-1, 0], [1, 0], [0, -1], [0, 1]];
    for (const sky of hasSky ? [true, false] : [false]) {
      let n = 0;
      for (const [dx, dz] of sides) {
        const nc = w.getChunk(chunk.cx + dx, chunk.cz + dz);
        if (!nc || nc.state < ST_LIT) continue;
        const NL = nc.light, NB = nc.blocks;
        for (let k = 0; k < 16; k++) {
          // (ax, az) : notre cellule de bord ; (bx, bz) : la cellule voisine en face
          const ax = dx === -1 ? 0 : dx === 1 ? 15 : k, az = dz === -1 ? 0 : dz === 1 ? 15 : k;
          const bx = dx === -1 ? 15 : dx === 1 ? 0 : k, bz = dz === -1 ? 15 : dz === 1 ? 0 : k;
          for (let y = 0; y < 128; y++) {
            const ai = (y << 8) | (az << 4) | ax, bi = (y << 8) | (bz << 4) | bx;
            const la = sky ? L[ai] >> 4 : L[ai] & 15, lb = sky ? NL[bi] >> 4 : NL[bi] & 15;
            if (la > lb + 1 && OPACITY[NB[bi]] < 15) {
              q[n * 3] = chunk.cx * 16 + ax; q[n * 3 + 1] = y; q[n * 3 + 2] = chunk.cz * 16 + az; n++;
            } else if (lb > la + 1 && OPACITY[B[ai]] < 15) {
              q[n * 3] = nc.cx * 16 + bx; q[n * 3 + 1] = y; q[n * 3 + 2] = nc.cz * 16 + bz; n++;
            }
          }
        }
      }
      if (n) this.propagate(n, sky);
    }
    this.current = null;
    chunk.state = ST_LIT;
  }

  // Ajoute à la file les cellules de bord des voisins déjà éclairés
  pullBorders(chunk, n, sky) {
    const w = this.world;
    const q = this.q;
    const sides = [
      [-1, 0, 15, -1], [1, 0, 0, -1], [0, -1, -1, 15], [0, 1, -1, 0],
    ];
    for (const [dx, dz, fx, fz] of sides) {
      const nc = w.getChunk(chunk.cx + dx, chunk.cz + dz);
      if (!nc || nc.state < ST_LIT) continue;
      for (let k = 0; k < 16; k++) {
        const lx = fx >= 0 ? fx : k, lz = fz >= 0 ? fz : k;
        // cellule adjacente dans notre chunk
        const ax = dx === -1 ? 0 : dx === 1 ? 15 : lx;
        const az = dz === -1 ? 0 : dz === 1 ? 15 : lz;
        for (let y = 0; y < 128; y++) {
          const ni = (y << 8) | (lz << 4) | lx;
          const l = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
          if (l <= 1) continue;
          const ai = (y << 8) | (az << 4) | ax;
          if (OPACITY[chunk.blocks[ai]] >= 15) continue;
          const al = sky ? chunk.light[ai] >> 4 : chunk.light[ai] & 15;
          if (al >= l - 1) continue;
          q[n * 3] = nc.cx * 16 + lx; q[n * 3 + 1] = y; q[n * 3 + 2] = nc.cz * 16 + lz;
          n++;
        }
      }
    }
    return n;
  }

  // ---------- Mise à jour après modification d'un bloc ----------
  update(x, y, z, hasSky) {
    this._c = null;
    this.relight(x, y, z, false);
    if (hasSky) this.relight(x, y, z, true);
  }

  relight(x, y, z, sky) {
    const c = this.chunkAt(x, z);
    if (!c || c.state < ST_LIT) return;
    const rq = this.rq, q = this.q;
    const i0 = (y << 8) | ((z & 15) << 4) | (x & 15);
    const old = sky ? c.light[i0] >> 4 : c.light[i0] & 15;
    let rh = 0, rt = 0, an = 0;
    // retrait
    c.light[i0] = sky ? c.light[i0] & 15 : c.light[i0] & 0xf0;
    this.markDirty(c, x, y, z);
    rq[rt * 4] = x; rq[rt * 4 + 1] = y; rq[rt * 4 + 2] = z; rq[rt * 4 + 3] = old; rt++;
    while (rh < rt) {
      const px = rq[rh * 4], py = rq[rh * 4 + 1], pz = rq[rh * 4 + 2], pl = rq[rh * 4 + 3];
      rh++;
      for (let d = 0; d < 6; d++) {
        const ny = py + DY[d];
        if (ny < 0 || ny > 127) continue;
        const nx = px + DX[d], nz = pz + DZ[d];
        const nc = this.chunkAt(nx, nz);
        if (!nc || nc.state < ST_LIT) continue;
        const ni = (ny << 8) | ((nz & 15) << 4) | (nx & 15);
        const nl = sky ? nc.light[ni] >> 4 : nc.light[ni] & 15;
        if (nl === 0) continue;
        if (nl < pl || (sky && d === 5 && pl === 15 && nl === 15)) {
          nc.light[ni] = sky ? nc.light[ni] & 15 : nc.light[ni] & 0xf0;
          this.markDirty(nc, nx, ny, nz);
          if (rt < QSIZE - 1) { rq[rt * 4] = nx; rq[rt * 4 + 1] = ny; rq[rt * 4 + 2] = nz; rq[rt * 4 + 3] = nl; rt++; }
        } else if (an < QSIZE - 1) {
          q[an * 3] = nx; q[an * 3 + 1] = ny; q[an * 3 + 2] = nz; an++;
        }
      }
    }
    // source propre
    const c2 = this.chunkAt(x, z);
    if (!sky) {
      const e = EMIT[c2.blocks[i0]];
      if (e) { c2.light[i0] = (c2.light[i0] & 0xf0) | e; q[an * 3] = x; q[an * 3 + 1] = y; q[an * 3 + 2] = z; an++; }
    } else if (y === 127 || this.isSkyExposed(x, y, z)) {
      const op = OPACITY[c2.blocks[i0]];
      if (op < 15) {
        const l = 15 - op;
        c2.light[i0] = (l << 4) | (c2.light[i0] & 15);
        q[an * 3] = x; q[an * 3 + 1] = y; q[an * 3 + 2] = z; an++;
      }
    }
    // voisins
    for (let d = 0; d < 6; d++) {
      const ny = y + DY[d];
      if (ny < 0 || ny > 127) continue;
      q[an * 3] = x + DX[d]; q[an * 3 + 1] = ny; q[an * 3 + 2] = z + DZ[d]; an++;
    }
    this.propagate(an, sky);
  }

  isSkyExposed(x, y, z) {
    const c = this.chunkAt(x, z);
    if (!c) return false;
    const lx = x & 15, lz = z & 15;
    for (let yy = 127; yy > y; yy--) if (OPACITY[c.blocks[(yy << 8) | (lz << 4) | lx]]) return false;
    return true;
  }
}
