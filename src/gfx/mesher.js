// Construction des maillages des sections de chunk (16x16x16)
import { BLOCKS, OPAQUE, RENDER, R_CUBE, R_CROSS, R_LIQUID, R_MODEL, R_CROP, ROT_FACE, U, D } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { tex } from './textures.js';
import { hash3 } from '../core/noise.js';

export const VSIZE = 20; // octets par sommet

// ---------- Tampon de géométrie extensible ----------
export class GeoBuffer {
  constructor(cap = 4096) {
    this.alloc(cap);
    this.n = 0;
  }
  alloc(cap) {
    const buf = new ArrayBuffer(cap * VSIZE);
    if (this.u8) new Uint8Array(buf).set(this.u8.subarray(0, this.n * VSIZE));
    this.cap = cap;
    this.buf = buf;
    this.i16 = new Int16Array(buf);
    this.u8 = new Uint8Array(buf);
    this.u16 = new Uint16Array(buf);
  }
  reset() { this.n = 0; }
  // x,y,z en 1/16 de bloc ; u,v en pixels (0..16)
  v(x, y, z, u, v, layer, sky, bl, shade, r, g, b, flags) {
    if (this.n >= this.cap) this.alloc(this.cap * 2);
    const n = this.n++;
    const s = n * 10, o = n * 20;
    this.i16[s] = x; this.i16[s + 1] = y; this.i16[s + 2] = z;
    this.u8[o + 8] = u; this.u8[o + 9] = v;
    this.u16[s + 5] = layer;
    this.u8[o + 12] = sky; this.u8[o + 13] = bl; this.u8[o + 14] = shade; this.u8[o + 15] = flags;
    this.u8[o + 16] = r; this.u8[o + 17] = g; this.u8[o + 18] = b; this.u8[o + 19] = 255;
  }
  slice() {
    return this.buf.slice(0, this.n * VSIZE);
  }
}

// ---------- Définition des faces ----------
// ordre : N S W E U D ; sommets CCW vus de l'extérieur
const FACE_VERTS = [
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
];
const FACE_DIR = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]];
const FACE_SHADE = [0.8, 0.8, 0.6, 0.6, 1.0, 0.5];
const AO_CURVE = [0.45, 0.65, 0.82, 1.0];

const P = 18;
const pidx = (x, y, z) => ((y + 1) * P + (z + 1)) * P + (x + 1);

// Décalages (index rembourré) des échantillons AO pour chaque face/sommet : [side1, side2, corner]
const AO_OFF = FACE_VERTS.map((verts, f) => {
  const d = FACE_DIR[f];
  const axes = [0, 1, 2].filter((a) => d[a] === 0);
  return verts.map((v) => {
    const o1 = [0, 0, 0], o2 = [0, 0, 0];
    o1[axes[0]] = v[axes[0]] ? 1 : -1;
    o2[axes[1]] = v[axes[1]] ? 1 : -1;
    const toI = (o) => (o[1] * P + o[2]) * P + o[0];
    return [toI(o1), toI(o2), toI([o1[0] + o2[0], o1[1] + o2[1], o1[2] + o2[2]])];
  });
});
const DIR_OFF = FACE_DIR.map((d) => (d[1] * P + d[2]) * P + d[0]);

// UV par défaut (pixels) depuis une position en pixels dans le bloc
function faceUV(f, x, y, z) {
  switch (f) {
    case 0: return [16 - x, 16 - y];
    case 1: return [x, 16 - y];
    case 2: return [z, 16 - y];
    case 3: return [16 - z, 16 - y];
    default: return [x, z];
  }
}

// ---------- Tampons de travail ----------
const ids = new Uint8Array(P * P * P);
const metas = new Uint8Array(P * P * P);
const lights = new Uint8Array(P * P * P);
const opaqueBuf = new GeoBuffer(16384);
const transBuf = new GeoBuffer(4096);

const TINT_BIRCH = [128, 167, 85];
const TINT_SPRUCE = [97, 153, 97];
const TINT_WATER = [63, 118, 228];
const TINT_WATER_SWAMP = [97, 123, 100];
const WHITE = [255, 255, 255];

const texCache = new Map();
function texLayer(name) {
  let l = texCache.get(name);
  if (l === undefined) { l = tex(name); texCache.set(name, l); }
  return l;
}

export const meshSettings = { fancyLeaves: true, smooth: true };

// Remplit les tableaux rembourrés depuis le monde
function gather(world, chunk, sy) {
  const cx = chunk.cx, cz = chunk.cz;
  const nb = [];
  for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) nb.push(world.getChunk(cx + dx, cz + dz));
  const y0 = sy * 16;
  const skyDefault = world.hasSky ? 0xf0 : 0;
  for (let y = -1; y <= 16; y++) {
    const wy = y0 + y;
    for (let z = -1; z <= 16; z++) {
      const cz2 = z < 0 ? 0 : z > 15 ? 2 : 1;
      const lz = (z + 16) & 15;
      let p = pidx(-1, y, z);
      for (let x = -1; x <= 16; x++, p++) {
        if (wy < 0) { ids[p] = B.bedrock; metas[p] = 0; lights[p] = 0; continue; }
        if (wy > 127) { ids[p] = 0; metas[p] = 0; lights[p] = skyDefault; continue; }
        const cx2 = x < 0 ? 0 : x > 15 ? 2 : 1;
        const c = nb[cz2 * 3 + cx2];
        if (!c) { ids[p] = 0; metas[p] = 0; lights[p] = skyDefault; continue; }
        const i = (wy << 8) | (lz << 4) | ((x + 16) & 15);
        ids[p] = c.blocks[i];
        metas[p] = c.meta[i];
        lights[p] = c.light[i];
      }
    }
  }
}

function tintFor(def, chunk, lx, lz) {
  const t = def.tint;
  if (!t) return WHITE;
  const i = (lz * 16 + lx) * 6;
  if (t === 'grass') return [chunk.tint[i], chunk.tint[i + 1], chunk.tint[i + 2]];
  if (t === 'foliage') return [chunk.tint[i + 3], chunk.tint[i + 4], chunk.tint[i + 5]];
  if (t === 'birch') return TINT_BIRCH;
  if (t === 'spruce') return TINT_SPRUCE;
  if (t === 'water') return chunk.biome[lz * 16 + lx] === 10 ? TINT_WATER_SWAMP : TINT_WATER;
  return WHITE;
}

// ---------- Construction ----------
export function buildSection(world, chunk, sy) {
  gather(world, chunk, sy);
  opaqueBuf.reset();
  transBuf.reset();
  const fancy = meshSettings.fancyLeaves;
  const smooth = meshSettings.smooth;
  const wx0 = chunk.cx * 16, wy0 = sy * 16, wz0 = chunk.cz * 16;
  for (let y = 0; y < 16; y++)
    for (let z = 0; z < 16; z++)
      for (let x = 0; x < 16; x++) {
        const p = pidx(x, y, z);
        const id = ids[p];
        if (!id) continue;
        const rt = RENDER[id];
        const def = BLOCKS[id];
        const meta = metas[p];
        const out = def.pass === 'translucent' ? transBuf : opaqueBuf;
        if (rt === R_CUBE) {
          const tint = def.tint ? tintFor(def, chunk, x, z) : WHITE;
          for (let f = 0; f < 6; f++) {
            const np = p + DIR_OFF[f];
            const nid = ids[np];
            if (OPAQUE[nid]) continue;
            if (def.cullSame && nid === id) continue;
            if (def.leaves && !fancy && BLOCKS[nid] && BLOCKS[nid].leaves) continue;
            const layer = texLayer(def.texFn(f, meta));
            const rot = def.rotFn ? def.rotFn(f, meta) : 0;
            const useTint = def.tintFn ? def.tintFn(f) : !!def.tint;
            cubeFace(out, p, np, f, x, y, z, layer, rot, useTint ? tint : WHITE, smooth, 0);
          }
        } else if (rt === R_CROSS || rt === R_CROP) {
          const tint = def.tint ? tintFor(def, chunk, x, z) : WHITE;
          const layer = texLayer(def.texFn(0, meta));
          const l = lights[p];
          let ox = 0, oz = 0;
          if (id === B.short_grass || id === B.fern || def.plant && id !== B.wheat && id !== B.sugar_cane) {
            const h = hash3(12345, wx0 + x, 0, wz0 + z);
            ox = ((h & 15) - 7.5) * 0.35; oz = (((h >> 4) & 15) - 7.5) * 0.35;
          }
          if (rt === R_CROSS) crossQuads(out, x * 16 + ox, y * 16, z * 16 + oz, layer, l, tint, id === B.fire ? 4 : 0, id === B.fire ? 17 : 16);
          else cropQuads(out, x * 16, y * 16, z * 16, layer, l, tint);
        } else if (rt === R_LIQUID) {
          liquid(out === transBuf ? transBuf : opaqueBuf, p, x, y, z, id, meta, def, chunk);
        } else if (rt === R_MODEL) {
          model(out, p, x, y, z, id, meta, def, chunk);
        }
      }
  const res = {};
  if (opaqueBuf.n) res.opaque = { data: opaqueBuf.slice(), count: opaqueBuf.n };
  if (transBuf.n) res.trans = { data: transBuf.slice(), count: transBuf.n };
  return res;
}

function cubeFace(out, p, np, f, x, y, z, layer, rot, tint, smooth, flags) {
  const verts = FACE_VERTS[f];
  const offs = AO_OFF[f];
  const shadeF = FACE_SHADE[f];
  const sk = [0, 0, 0, 0], bl = [0, 0, 0, 0], sh = [0, 0, 0, 0], ao = [0, 0, 0, 0];
  const nl = lights[np];
  for (let k = 0; k < 4; k++) {
    if (!smooth) {
      sk[k] = (nl >> 4) * 17; bl[k] = (nl & 15) * 17; sh[k] = shadeF * 255; ao[k] = 3;
      continue;
    }
    const o = offs[k];
    const s1 = np + o[0], s2 = np + o[1], c = np + o[2];
    const o1 = OPAQUE[ids[s1]], o2 = OPAQUE[ids[s2]];
    const oc = o1 && o2 ? 1 : OPAQUE[ids[c]];
    const a = o1 && o2 ? 0 : 3 - (o1 + o2 + oc);
    ao[k] = a;
    let ss = nl >> 4, bb = nl & 15, n = 1;
    if (!o1) { ss += lights[s1] >> 4; bb += lights[s1] & 15; n++; }
    if (!o2) { ss += lights[s2] >> 4; bb += lights[s2] & 15; n++; }
    if (!oc) { ss += lights[c] >> 4; bb += lights[c] & 15; n++; }
    sk[k] = (ss * 17) / n; bl[k] = (bb * 17) / n;
    sh[k] = shadeF * AO_CURVE[a] * 255;
  }
  const start = ao[0] + ao[2] < ao[1] + ao[3] ? 1 : 0;
  const bx = x * 16, by = y * 16, bz = z * 16;
  for (let j = 0; j < 4; j++) {
    const k = (j + start) & 3;
    const v = verts[k];
    const px = v[0] * 16, py = v[1] * 16, pz = v[2] * 16;
    let [u, vv] = faceUV(f, px, py, pz);
    if (rot) { const t = u; u = 16 - vv; vv = t; }
    out.v(bx + px, by + py, bz + pz, u, vv, layer, sk[k], bl[k], sh[k], tint[0], tint[1], tint[2], flags);
  }
}

function crossQuads(out, bx, by, bz, layer, l, tint, flags, height = 16) {
  const s = (l >> 4) * 17, b = (l & 15) * 17;
  const a = 1.6, e = 14.4;
  const quads = [
    [[a, 0, a], [e, 0, e], [e, height, e], [a, height, a]],
    [[e, 0, a], [a, 0, e], [a, height, e], [e, height, a]],
  ];
  const uvs = [[0, 16], [16, 16], [16, 0], [0, 0]];
  for (const q of quads) {
    for (let k = 0; k < 4; k++) out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], uvs[k][0], uvs[k][1], layer, s, b, 235, tint[0], tint[1], tint[2], flags);
    for (let k = 3; k >= 0; k--) out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], uvs[k][0], uvs[k][1], layer, s, b, 235, tint[0], tint[1], tint[2], flags);
  }
}

function cropQuads(out, bx, by, bz, layer, l, tint) {
  const s = (l >> 4) * 17, b = (l & 15) * 17;
  const planes = [
    [[4, 0, 0], [4, 0, 16], [4, 16, 16], [4, 16, 0]],
    [[12, 0, 16], [12, 0, 0], [12, 16, 0], [12, 16, 16]],
    [[16, 0, 4], [0, 0, 4], [0, 16, 4], [16, 16, 4]],
    [[0, 0, 12], [16, 0, 12], [16, 16, 12], [0, 16, 12]],
  ];
  const uvs = [[0, 16], [16, 16], [16, 0], [0, 0]];
  for (const q of planes) {
    for (let k = 0; k < 4; k++) out.v(bx + q[k][0], by + q[k][1] - 1, bz + q[k][2], uvs[k][0], uvs[k][1], layer, s, b, 235, tint[0], tint[1], tint[2], 0);
    for (let k = 3; k >= 0; k--) out.v(bx + q[k][0], by + q[k][1] - 1, bz + q[k][2], uvs[k][0], uvs[k][1], layer, s, b, 235, tint[0], tint[1], tint[2], 0);
  }
}

// ---------- Liquides ----------
function liquidHeight(p, id) {
  // hauteur moyenne pour un coin, à partir des 4 colonnes (p = index du coin "bas-gauche")
  let sum = 0, n = 0;
  const cells = [p, p + 1, p + P, p + P + 1];
  for (const c of cells) {
    if (ids[c] === id) {
      if (ids[c + P * P] === id) return 16;
      const m = metas[c];
      const lvl = m & 8 ? 0 : m & 7;
      const h = ((8 - lvl) / 9) * 16;
      if (lvl === 0) { sum += h * 10; n += 10; } else { sum += h; n++; }
    } else if (!OPAQUE[ids[c]] && !BLOCKS[ids[c]]?.solid) {
      n++;
    }
  }
  return n ? sum / n : 0;
}

function liquid(out, p, x, y, z, id, meta, def, chunk) {
  const layer = texLayer(def.texFn(0, meta));
  const tint = def.tint ? tintFor(def, chunk, x, z) : WHITE;
  const flags = id === B.water ? 1 : 2;
  const above = ids[p + P * P];
  let h00, h10, h01, h11;
  if (above === id) h00 = h10 = h01 = h11 = 16;
  else {
    // coins : (x,z), (x+1,z), (x,z+1), (x+1,z+1)
    h00 = liquidHeight(p - P - 1, id);
    h10 = liquidHeight(p - P, id);
    h01 = liquidHeight(p - 1, id);
    h11 = liquidHeight(p, id);
  }
  const bx = x * 16, by = y * 16, bz = z * 16;
  const lOwn = lights[p];
  const lt = (np) => {
    const a = lights[np];
    const s = Math.max(a >> 4, lOwn >> 4), b = Math.max(a & 15, lOwn & 15);
    return [s * 17, b * 17];
  };
  // dessus
  if (above !== id) {
    const [s, b] = lt(p + P * P);
    const q = [[0, h01, 16], [16, h11, 16], [16, h10, 0], [0, h00, 0]];
    const uv = [[0, 16], [16, 16], [16, 0], [0, 0]];
    for (let k = 0; k < 4; k++) out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], uv[k][0], uv[k][1], layer, s, b, 255, tint[0], tint[1], tint[2], flags);
    if (id === B.water) for (let k = 3; k >= 0; k--) out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], uv[k][0], uv[k][1], layer, s, b, 200, tint[0], tint[1], tint[2], flags);
  }
  // dessous
  const below = ids[p - P * P];
  if (below !== id && !OPAQUE[below]) {
    const [s, b] = lt(p - P * P);
    const q = [[0, 0, 0], [16, 0, 0], [16, 0, 16], [0, 0, 16]];
    const uv = [[0, 0], [16, 0], [16, 16], [0, 16]];
    for (let k = 0; k < 4; k++) out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], uv[k][0], uv[k][1], layer, s, b, 128, tint[0], tint[1], tint[2], flags);
  }
  // côtés : hauteurs haut-gauche/haut-droit selon la face
  const sides = [
    [0, [[16, 0, 0], [0, 0, 0], [0, h00, 0], [16, h10, 0]]],
    [1, [[0, 0, 16], [16, 0, 16], [16, h11, 16], [0, h01, 16]]],
    [2, [[0, 0, 0], [0, 0, 16], [0, h01, 16], [0, h00, 0]]],
    [3, [[16, 0, 16], [16, 0, 0], [16, h10, 0], [16, h11, 16]]],
  ];
  for (const [f, q] of sides) {
    const np = p + DIR_OFF[f];
    const nid = ids[np];
    if (nid === id || OPAQUE[nid]) continue;
    const [s, b] = lt(np);
    const shade = FACE_SHADE[f] * 255;
    for (let k = 0; k < 4; k++) {
      const [u, v] = faceUV(f, q[k][0], q[k][1], q[k][2]);
      out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], u, v, layer, s, b, shade, tint[0], tint[1], tint[2], flags);
    }
    if (id === B.water) for (let k = 3; k >= 0; k--) {
      const [u, v] = faceUV(f, q[k][0], q[k][1], q[k][2]);
      out.v(bx + q[k][0], by + q[k][1], bz + q[k][2], u, v, layer, s, b, shade * 0.8, tint[0], tint[1], tint[2], flags);
    }
  }
}

// ---------- Modèles (boîtes) ----------
function boxTex(spec, localFace) {
  if (typeof spec === 'string') return spec;
  const names = ['north', 'south', 'west', 'east', 'top', 'bottom'];
  const n = names[localFace];
  if (spec[n]) return spec[n];
  if (localFace === 4) return spec.top || spec.side;
  if (localFace === 5) return spec.bottom || spec.top || spec.side;
  if (localFace === 0 && spec.front) return spec.front;
  if (localFace === 1 && spec.back) return spec.back;
  return spec.side || spec.top;
}

function rotPos(px, pz, rot) {
  switch (rot) {
    case 1: return [16 - px, 16 - pz];
    case 2: return [pz, 16 - px];
    case 3: return [16 - pz, px];
    default: return [px, pz];
  }
}

function model(out, p, x, y, z, id, meta, def, chunk) {
  const nbFn = (dx, dy, dz) => ids[p + (dy * P + dz) * P + dx];
  const boxes = def.boxes(meta, nbFn);
  const bx = x * 16, by = y * 16, bz = z * 16;
  const tint = def.tint ? tintFor(def, chunk, x, z) : WHITE;
  const lOwn = lights[p];
  for (const bxd of boxes) {
    const lb = bxd.local || bxd;
    const rot = bxd.local ? bxd.rot : 0;
    const spec = bxd.tex || def.key;
    for (let lf = 0; lf < 6; lf++) {
      if (bxd.only && !bxd.only.includes(lf)) continue;
      const wf = ROT_FACE[rot][lf];
      // la face est-elle sur la limite du bloc ?
      const onEdge = (wf === 0 && bxd.z0 === 0) || (wf === 1 && bxd.z1 === 16) || (wf === 2 && bxd.x0 === 0) ||
        (wf === 3 && bxd.x1 === 16) || (wf === 4 && bxd.y1 === 16) || (wf === 5 && bxd.y0 === 0);
      const np = p + DIR_OFF[wf];
      if (onEdge && OPAQUE[ids[np]]) continue;
      if (onEdge && ids[np] === id && (def.slab || def.stairs || def.pane) && wf >= 4) continue;
      const layer = texLayer(boxTex(spec, lf));
      const nl = lights[np];
      const s = Math.max(nl >> 4, lOwn >> 4) * 17, b = Math.max(nl & 15, lOwn & 15) * 17;
      const shade = FACE_SHADE[wf] * 255;
      const fv = FACE_VERTS[lf];
      // coins locaux de la boîte
      const cs = [];
      for (let k = 0; k < 4; k++) {
        const v = fv[k];
        cs.push([v[0] ? lb.x1 : lb.x0, v[1] ? lb.y1 : lb.y0, v[2] ? lb.z1 : lb.z0]);
      }
      let uvs = cs.map((c) => faceUV(lf, c[0], c[1], c[2]));
      const cuv = bxd.uv && (bxd.uv[lf] || (lf < 4 && bxd.uv.side));
      if (cuv) {
        const us = uvs.map((t) => t[0]), vs = uvs.map((t) => t[1]);
        const umin = Math.min(...us), umax = Math.max(...us), vmin = Math.min(...vs), vmax = Math.max(...vs);
        uvs = uvs.map(([u, v]) => [
          cuv[0] + (umax > umin ? (u - umin) / (umax - umin) : 0) * (cuv[2] - cuv[0]),
          cuv[1] + (vmax > vmin ? (v - vmin) / (vmax - vmin) : 0) * (cuv[3] - cuv[1]),
        ]);
      }
      const flags = bxd.anim || (id === B.nether_portal ? 3 : 0);
      for (let k = 0; k < 4; k++) {
        const c = cs[k];
        const [wx, wz] = rotPos(c[0], c[2], rot);
        out.v(bx + wx, by + c[1], bz + wz, Math.round(uvs[k][0]), Math.round(uvs[k][1]), layer, s, b, shade, tint[0], tint[1], tint[2], flags);
      }
    }
  }
}
