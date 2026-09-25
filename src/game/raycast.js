// Lancer de rayons (blocs et entités)
import { selectionBoxes, collisionBoxes, BLOCKS, LIQUID } from '../data/blocks.js';

// Intersection segment / boîte (méthode des dalles) ; renvoie {t, face} ou null
export function rayBox(ox, oy, oz, dx, dy, dz, x0, y0, z0, x1, y1, z1) {
  let tmin = 0, tmax = Infinity, face = -1;
  const axes = [[ox, dx, x0, x1, 2, 3], [oy, dy, y0, y1, 5, 4], [oz, dz, z0, z1, 0, 1]];
  for (const [o, d, a, b, fmin, fmax] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < a || o > b) return null;
      continue;
    }
    let t1 = (a - o) / d, t2 = (b - o) / d;
    let f1 = fmin, f2 = fmax;
    if (t1 > t2) { const t = t1; t1 = t2; t2 = t; const f = f1; f1 = f2; f2 = f; }
    if (t1 > tmin) { tmin = t1; face = f1; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  return { t: tmin, face };
}

// Parcours DDA des voxels ; mode : 'select' | 'collide'
export function raycastBlocks(world, ox, oy, oz, dx, dy, dz, maxDist, mode = 'select', hitLiquid = false) {
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;
  let x = Math.floor(ox), y = Math.floor(oy), z = Math.floor(oz);
  const sx = dx > 0 ? 1 : -1, sy = dy > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
  const tdx = Math.abs(1 / dx), tdy = Math.abs(1 / dy), tdz = Math.abs(1 / dz);
  let tmx = dx > 0 ? (x + 1 - ox) * tdx : (ox - x) * tdx;
  let tmy = dy > 0 ? (y + 1 - oy) * tdy : (oy - y) * tdy;
  let tmz = dz > 0 ? (z + 1 - oz) * tdz : (oz - z) * tdz;
  if (!isFinite(tmx)) tmx = Infinity;
  if (!isFinite(tmy)) tmy = Infinity;
  if (!isFinite(tmz)) tmz = Infinity;
  let t = 0;
  for (let i = 0; i < 400 && t <= maxDist; i++) {
    const id = world.getBlock(x, y, z);
    if (id) {
      const def = BLOCKS[id];
      let boxes = null;
      if (LIQUID[id]) {
        if (hitLiquid && (world.getMeta(x, y, z) === 0)) boxes = [{ x0: 0, y0: 0, z0: 0, x1: 16, y1: 14, z1: 16 }];
      } else {
        const nb = (a, b, c) => world.getBlock(x + a, y + b, z + c);
        boxes = mode === 'collide' ? collisionBoxes(id, world.getMeta(x, y, z), nb) : selectionBoxes(id, world.getMeta(x, y, z), nb);
      }
      if (boxes && boxes.length) {
        let best = null;
        for (const b of boxes) {
          const r = rayBox(ox, oy, oz, dx, dy, dz, x + b.x0 / 16, y + b.y0 / 16, z + b.z0 / 16, x + b.x1 / 16, y + b.y1 / 16, z + b.z1 / 16);
          if (r && r.t <= maxDist && (!best || r.t < best.t)) best = r;
        }
        if (best) {
          return { x, y, z, id, def, face: best.face < 0 ? 4 : best.face, t: best.t, hx: ox + dx * best.t, hy: oy + dy * best.t, hz: oz + dz * best.t };
        }
      }
    }
    if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; }
    else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; }
    else { z += sz; t = tmz; tmz += tdz; }
  }
  return null;
}

// Entité la plus proche touchée par le rayon
export function raycastEntities(world, ox, oy, oz, dx, dy, dz, maxDist, filter) {
  const len = Math.hypot(dx, dy, dz);
  dx /= len; dy /= len; dz /= len;
  let best = null;
  for (const e of world.entities) {
    if (e.removed || (filter && !filter(e))) continue;
    const parts = e.hitboxes ? e.hitboxes() : null;
    const boxes = parts || [e.bbox()];
    for (const bb of boxes) {
      const g = e.pickMargin ?? 0.1;
      const r = rayBox(ox, oy, oz, dx, dy, dz, bb[0] - g, bb[1] - g, bb[2] - g, bb[3] + g, bb[4] + g, bb[5] + g);
      if (r && r.t <= maxDist && (!best || r.t < best.t)) best = { entity: e, t: r.t, part: bb.part };
    }
  }
  return best;
}
