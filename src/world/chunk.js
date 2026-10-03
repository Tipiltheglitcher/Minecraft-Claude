// Stockage des données d'un chunk (16 x 128 x 16)
import { WH, NSEC } from '../core/constants.js';

export const CHUNK_VOL = 16 * 16 * WH;

export const ST_EMPTY = 0;
export const ST_GENERATED = 1;
export const ST_LIT = 2;

export class Chunk {
  constructor(cx, cz) {
    this.cx = cx;
    this.cz = cz;
    this.blocks = new Uint8Array(CHUNK_VOL);
    this.meta = new Uint8Array(CHUNK_VOL);
    this.light = new Uint8Array(CHUNK_VOL); // ciel (4 bits hauts) | bloc (4 bits bas)
    this.biome = new Uint8Array(256);
    this.tint = new Uint8Array(256 * 6); // couleurs herbe (rgb) + feuillage (rgb) par colonne
    this.state = ST_EMPTY;
    this.dirty = new Uint8Array(NSEC); // sections à remailler
    this.meshes = new Array(NSEC).fill(null);
    this.sectionHasBlocks = new Uint8Array(NSEC);
    this.vis = new Uint16Array(NSEC).fill(0x7fff); // connectivité des faces (culling des grottes)
    this.meshSeq = new Int32Array(NSEC); // dernier maillage appliqué (résultats asynchrones)
    this.blockEntities = new Map(); // index -> données (coffre, four...)
    this.modified = false; // diffère du terrain généré (à conserver)
    this.saveDirty = false; // modifié depuis la dernière sauvegarde
    this.pendingEntities = null; // entités à faire apparaître (générées avec le chunk)
    this.lastSeen = 0;
    this.inhabited = 0;
  }

  static idx(x, y, z) {
    return (y << 8) | (z << 4) | x;
  }

  get(x, y, z) {
    return this.blocks[(y << 8) | (z << 4) | x];
  }

  set(x, y, z, id, meta = 0) {
    const i = (y << 8) | (z << 4) | x;
    this.blocks[i] = id;
    this.meta[i] = meta;
  }

  sky(i) {
    return this.light[i] >> 4;
  }

  bl(i) {
    return this.light[i] & 15;
  }

  markAllDirty() {
    this.dirty.fill(1);
  }

  updateSectionFlags() {
    for (let s = 0; s < NSEC; s++) {
      let any = 0;
      const start = s * 16 * 256, end = start + 16 * 256;
      for (let i = start; i < end; i++) if (this.blocks[i]) { any = 1; break; }
      this.sectionHasBlocks[s] = any;
    }
  }

  // Hauteur du plus haut bloc non-air dans la colonne
  topY(x, z) {
    for (let y = WH - 1; y >= 0; y--) if (this.blocks[(y << 8) | (z << 4) | x]) return y;
    return -1;
  }
}

// Compression RLE compacte (octets : valeur puis longueur en varint) : rapide à cloner pour IndexedDB
export function rleEncodeBytes(arr) {
  const out = new Uint8Array(arr.length * 2 + 8);
  let o = 0, i = 0;
  const len = arr.length;
  while (i < len) {
    const v = arr[i];
    let n = 1;
    while (i + n < len && arr[i + n] === v) n++;
    out[o++] = v;
    let c = n;
    while (c >= 128) { out[o++] = (c & 127) | 128; c >>>= 7; }
    out[o++] = c;
    i += n;
  }
  return out.slice(0, o);
}

function rleDecodeBytes(src, target) {
  let p = 0, o = 0;
  while (o < src.length) {
    const v = src[o++];
    let n = 0, sh = 0, b;
    do { b = src[o++]; n |= (b & 127) << sh; sh += 7; } while (b & 128);
    target.fill(v, p, p + n);
    p += n;
  }
  return target;
}

// Ancien format (tableaux de nombres), toujours lu pour les sauvegardes existantes
export function rleEncode(arr) {
  const out = [];
  let i = 0;
  while (i < arr.length) {
    const v = arr[i];
    let n = 1;
    while (i + n < arr.length && arr[i + n] === v && n < 65535) n++;
    out.push(v, n);
    i += n;
  }
  return out;
}

export function rleDecode(list, target) {
  if (list instanceof Uint8Array) return rleDecodeBytes(list, target);
  let p = 0;
  for (let i = 0; i < list.length; i += 2) {
    const v = list[i], n = list[i + 1];
    target.fill(v, p, p + n);
    p += n;
  }
  return target;
}
