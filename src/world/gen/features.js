// Éléments de décor : arbres, cactus, minerais, végétation
import { B } from '../../data/ids.js';

// Écrit un bloc dans le chunk s'il est à l'intérieur ; "mode" : 0 toujours, 1 seulement si air/remplaçable, 2 si air ou feuilles
export function makeWriter(chunk) {
  const ox = chunk.cx * 16, oz = chunk.cz * 16;
  return function put(x, y, z, id, meta = 0, mode = 0) {
    const lx = x - ox, lz = z - oz;
    if (lx < 0 || lx > 15 || lz < 0 || lz > 15 || y < 0 || y > 127) return;
    const i = (y << 8) | (lz << 4) | lx;
    const cur = chunk.blocks[i];
    if (mode === 1 && cur !== 0 && cur !== B.short_grass && cur !== B.fern && cur !== B.snow) return;
    if (mode === 2 && cur !== 0 && cur !== B.oak_leaves && cur !== B.birch_leaves && cur !== B.spruce_leaves && cur !== B.short_grass && cur !== B.fern && cur !== B.snow) return;
    chunk.blocks[i] = id;
    chunk.meta[i] = meta;
  };
}

export function oakTree(put, x, y, z, rng, log = B.oak_log, leaf = B.oak_leaves, big = false) {
  const h = (big ? 6 : 4) + Math.floor(rng() * 3);
  const top = y + h;
  // feuillage
  for (let ly = top - 3; ly <= top + 1; ly++) {
    const dy = ly - top;
    const r = dy >= 0 ? 1 : 2 + (big && dy < -1 ? 1 : 0);
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (Math.abs(dx) === r && Math.abs(dz) === r && (dy >= 0 || rng() < 0.5)) continue;
        if (dy === 1 && Math.abs(dx) + Math.abs(dz) > 1) continue;
        put(x + dx, ly, z + dz, leaf, 0, 1);
      }
  }
  for (let ly = y; ly < top; ly++) put(x, ly, z, log, 0, 2);
  put(x, y - 1, z, B.dirt, 0, 0);
}

export function spruceTree(put, x, y, z, rng) {
  const h = 6 + Math.floor(rng() * 4);
  const top = y + h;
  let r = 0;
  const leafStart = y + 2 + Math.floor(rng() * 2);
  for (let ly = top; ly >= leafStart; ly--) {
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (r > 0 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
        put(x + dx, ly, z + dz, B.spruce_leaves, 0, 1);
      }
    if (r >= 2 || (r === 1 && rng() < 0.5)) r = r === 3 ? 1 : r === 2 ? (rng() < 0.4 ? 3 : 1) : r + 1;
    else r++;
    if (ly === top) r = 1;
  }
  put(x, top + 1, z, B.spruce_leaves, 0, 1);
  for (let ly = y; ly < top; ly++) put(x, ly, z, B.spruce_log, 0, 2);
  put(x, y - 1, z, B.dirt, 0, 0);
}

export function birchTree(put, x, y, z, rng) {
  oakTree(put, x, y, z, rng, B.birch_log, B.birch_leaves, false);
  // un peu plus haut
  put(x, y + 5, z, B.birch_log, 0, 2);
}

export function cactus(put, x, y, z, rng) {
  const h = 1 + Math.floor(rng() * 3);
  for (let i = 0; i < h; i++) put(x, y + i, z, B.cactus, 0, 1);
}

export function hugeMushroom(put, x, y, z, rng) {
  const red = rng() < 0.5;
  const h = 4 + Math.floor(rng() * 3);
  for (let i = 0; i < h; i++) put(x, y + i, z, B.oak_log, 0, 2);
  const cap = red ? B.red_wool : B.dirt;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) + Math.abs(dz) < 4) put(x + dx, y + h, z + dz, cap, 0, 1);
}

// Veine de minerai (remplace seulement la pierre / roche hôte)
export function oreVein(chunk, lx, y, lz, id, size, rng, host = B.stone) {
  let x = lx, z = lz;
  for (let i = 0; i < size; i++) {
    if (x >= 0 && x < 16 && z >= 0 && z < 16 && y > 0 && y < 127) {
      const idx = (y << 8) | (z << 4) | x;
      if (chunk.blocks[idx] === host) chunk.blocks[idx] = id;
    }
    const d = Math.floor(rng() * 6);
    if (d === 0) x++; else if (d === 1) x--; else if (d === 2) y++; else if (d === 3) y--; else if (d === 4) z++; else z--;
  }
}
