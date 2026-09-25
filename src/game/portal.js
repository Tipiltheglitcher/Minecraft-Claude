// Portails du Nether et de l'End
import { B } from '../data/ids.js';
import { SOLID, BLOCKS } from '../data/blocks.js';

// Tente d'allumer un portail à partir de la case d'air (x,y,z)
export function tryLightPortal(world, x, y, z) {
  for (const axis of [0, 1]) {
    const ax = axis === 0 ? [1, 0] : [0, 1];
    const air = (px, py, pz) => { const id = world.getBlock(px, py, pz); return id === 0 || id === B.fire; };
    const obs = (px, py, pz) => world.getBlock(px, py, pz) === B.obsidian;
    if (!air(x, y, z)) return false;
    // descendre jusqu'au bas du cadre
    let by = y;
    for (let i = 0; i < 21 && air(x, by - 1, z); i++) by--;
    if (!obs(x, by - 1, z)) continue;
    // bord gauche
    let lx = x, lz = z;
    for (let i = 0; i < 21 && air(lx - ax[0], by, lz - ax[1]) && obs(lx - ax[0], by - 1, lz - ax[1]); i++) { lx -= ax[0]; lz -= ax[1]; }
    if (!obs(lx - ax[0], by, lz - ax[1])) continue;
    // largeur
    let w = 0;
    while (w < 22 && air(lx + ax[0] * w, by, lz + ax[1] * w) && obs(lx + ax[0] * w, by - 1, lz + ax[1] * w)) w++;
    if (w < 2 || w > 21 || !obs(lx + ax[0] * w, by, lz + ax[1] * w)) continue;
    // hauteur
    let h = 0;
    let ok = true;
    while (h < 22) {
      let rowAir = true;
      for (let i = 0; i < w; i++) if (!air(lx + ax[0] * i, by + h, lz + ax[1] * i)) { rowAir = false; break; }
      if (!rowAir) break;
      if (!obs(lx - ax[0], by + h, lz - ax[1]) || !obs(lx + ax[0] * w, by + h, lz + ax[1] * w)) { ok = false; break; }
      h++;
    }
    if (!ok || h < 3 || h > 21) continue;
    for (let i = 0; i < w; i++) if (!obs(lx + ax[0] * i, by + h, lz + ax[1] * i)) { ok = false; break; }
    if (!ok) continue;
    // remplir
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) world.setBlock(lx + ax[0] * i, by + j, lz + ax[1] * i, B.nether_portal, axis, false);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) world.markDirty(lx + ax[0] * i, by + j, lz + ax[1] * i);
    return true;
  }
  return false;
}

// Cherche un portail existant autour de (x,z) ; renvoie la position où placer le joueur
export function findPortal(world, x, z, radius = 24) {
  let best = null, bd = Infinity;
  for (let cx = Math.floor((x - radius) / 16); cx <= Math.floor((x + radius) / 16); cx++)
    for (let cz = Math.floor((z - radius) / 16); cz <= Math.floor((z + radius) / 16); cz++) {
      const c = world.getChunk(cx, cz);
      if (!c) continue;
      const b = c.blocks;
      for (let i = 0; i < b.length; i++) {
        if (b[i] !== B.nether_portal) continue;
        const px = cx * 16 + (i & 15), py = i >> 8, pz = cz * 16 + ((i >> 4) & 15);
        if (b[i - 256] === B.nether_portal) continue; // on veut le bas
        const d = (px - x) ** 2 + (pz - z) ** 2;
        if (d < bd) { bd = d; best = { x: px, y: py, z: pz, axis: c.meta[i] }; }
      }
    }
  return best;
}

// Construit un nouveau portail près de (x,y,z) ; renvoie la position du bas
export function buildPortal(world, x, y, z, minY = 8, maxY = 118) {
  // cherche un emplacement : sol solide et 4x5 d'air
  let spot = null;
  for (let r = 0; r <= 16 && !spot; r += 2)
    for (let a = 0; a < Math.max(1, r * 4) && !spot; a++) {
      const ang = (a / Math.max(1, r * 4)) * Math.PI * 2;
      const px = Math.round(x + Math.cos(ang) * r), pz = Math.round(z + Math.sin(ang) * r);
      for (let py = Math.min(maxY, y + 16); py >= Math.max(minY, y - 16); py--) {
        if (!SOLID[world.getBlock(px, py - 1, pz)] || BLOCKS[world.getBlock(px, py - 1, pz)].liquid) continue;
        let free = true;
        for (let i = -1; i <= 2 && free; i++)
          for (let j = 0; j < 5 && free; j++)
            for (let k = -1; k <= 1 && free; k++) {
              const id = world.getBlock(px + i, py + j, pz + k);
              if (id && (SOLID[id] || BLOCKS[id].liquid)) free = false;
            }
        if (free && SOLID[world.getBlock(px + 1, py - 1, pz)]) { spot = { x: px, y: py, z: pz }; break; }
      }
    }
  if (!spot) spot = { x: Math.round(x), y: Math.max(minY + 2, Math.min(maxY - 6, Math.round(y))), z: Math.round(z) };
  const { x: px, y: py, z: pz } = spot;
  // plateforme et dégagement
  for (let i = -1; i <= 2; i++)
    for (let k = -2; k <= 2; k++) {
      if (!SOLID[world.getBlock(px + i, py - 1, pz + k)] || BLOCKS[world.getBlock(px + i, py - 1, pz + k)].liquid) world.setBlock(px + i, py - 1, pz + k, B.obsidian, 0, false);
      for (let j = 0; j < 4; j++) if (i >= 0 && i <= 1 || k !== 0) world.setBlock(px + i, py + j, pz + k, 0, 0, false);
    }
  // cadre (axe X) : intérieur x = px..px+1, y = py..py+2
  for (let i = -1; i <= 2; i++) {
    world.setBlock(px + i, py - 1, pz, B.obsidian, 0, false);
    world.setBlock(px + i, py + 3, pz, B.obsidian, 0, false);
  }
  for (let j = 0; j < 3; j++) {
    world.setBlock(px - 1, py + j, pz, B.obsidian, 0, false);
    world.setBlock(px + 2, py + j, pz, B.obsidian, 0, false);
    world.setBlock(px, py + j, pz, B.nether_portal, 0, false);
    world.setBlock(px + 1, py + j, pz, B.nether_portal, 0, false);
  }
  return { x: px, y: py, z: pz, axis: 0 };
}

// Plateforme d'obsidienne d'arrivée dans l'End
export function buildEndPlatform(world) {
  const x0 = 100, y0 = 48, z0 = 0;
  for (let dx = -2; dx <= 2; dx++)
    for (let dz = -2; dz <= 2; dz++) {
      world.setBlock(x0 + dx, y0, z0 + dz, B.obsidian, 0, false);
      for (let dy = 1; dy <= 3; dy++) world.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0, false);
    }
  return { x: x0 + 0.5, y: y0 + 1, z: z0 + 0.5 };
}

// Vérifie si les 12 cadres autour d'un portail de l'End ont un œil ; active le portail
export function checkEndPortal(world, x, y, z) {
  // cherche un cadre 5x5 contenant (x,y,z)
  for (let ox = -4; ox <= 0; ox++)
    for (let oz = -4; oz <= 0; oz++) {
      const cx = x + ox, cz = z + oz; // coin
      let all = true;
      const frames = [];
      for (let i = 1; i <= 3; i++) frames.push([cx + i, cz], [cx + i, cz + 4], [cx, cz + i], [cx + 4, cz + i]);
      for (const [fx, fz] of frames) {
        if (world.getBlock(fx, y, fz) !== B.end_portal_frame || !(world.getMeta(fx, y, fz) & 4)) { all = false; break; }
      }
      if (!all) continue;
      for (let i = 1; i <= 3; i++) for (let k = 1; k <= 3; k++) world.setBlock(cx + i, y, cz + k, B.end_portal, 0, false);
      return { x: cx + 2, y, z: cz + 2 };
    }
  return null;
}
