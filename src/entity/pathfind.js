// Recherche de chemin A* sur la grille de blocs
import { SOLID, BLOCKS, LIQUID } from '../data/blocks.js';
import { B } from '../data/ids.js';

function passable(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (!id) return true;
  if (id === B.oak_door) return true;
  const d = BLOCKS[id];
  if (d.fire || id === B.lava || id === B.cactus) return false;
  return !SOLID[id] || d.render === 'model' && (d.key === 'snow' || d.key === 'carpet');
}

function dangerous(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  return id === B.lava || id === B.fire || id === B.cactus || id === B.magma_block;
}

function canStand(world, x, y, z, h) {
  for (let i = 0; i < h; i++) if (!passable(world, x, y + i, z)) return false;
  const below = world.getBlock(x, y - 1, z);
  if (dangerous(world, x, y, z) || dangerous(world, x, y - 1, z)) return false;
  if (SOLID[below] && !BLOCKS[below].fence) return true;
  if (LIQUID[world.getBlock(x, y, z)] === 1 && world.getBlock(x, y, z) === B.water) return true;
  return false;
}

// Tas binaire minimal sur f
function heapPush(h, n) {
  h.push(n);
  let i = h.length - 1;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (h[p].f <= n.f) break;
    h[i] = h[p]; i = p;
  }
  h[i] = n;
}

function heapPop(h) {
  const top = h[0];
  const last = h.pop();
  if (h.length) {
    let i = 0;
    const len = h.length;
    for (;;) {
      const l = i * 2 + 1, r = l + 1;
      let m = i;
      let mf = last.f;
      if (l < len && h[l].f < mf) { m = l; mf = h[l].f; }
      if (r < len && h[r].f < mf) m = r;
      if (m === i) break;
      h[i] = h[m]; i = m;
    }
    h[i] = last;
  }
  return top;
}

export function findPath(world, sx, sy, sz, tx, ty, tz, opts = {}) {
  const h = opts.height || 2;
  const maxNodes = opts.maxNodes || 500;
  const maxDrop = opts.maxDrop ?? 3;
  const key = (x, y, z) => x * 73856093 ^ y * 19349663 ^ z * 83492791;
  const open = [];
  const nodes = new Map();
  const start = { x: sx, y: sy, z: sz, g: 0, f: 0, parent: null, closed: false };
  start.f = Math.abs(tx - sx) + Math.abs(ty - sy) + Math.abs(tz - sz);
  nodes.set(key(sx, sy, sz), start);
  open.push(start);
  let best = start, bestH = start.f;
  let count = 0;
  const reach = opts.reach ?? 1;
  while (open.length && count < maxNodes) {
    const cur = heapPop(open);
    if (cur.closed) continue;
    cur.closed = true;
    count++;
    const hd = Math.abs(tx - cur.x) + Math.abs(ty - cur.y) + Math.abs(tz - cur.z);
    if (hd < bestH) { bestH = hd; best = cur; }
    if (hd <= reach) { best = cur; break; }
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nx = cur.x + dx, nz = cur.z + dz;
      let ny = null;
      if (dx && dz) {
        // diagonale : les deux côtés doivent être libres
        if (!canStand(world, cur.x + dx, cur.y, cur.z, h) || !canStand(world, cur.x, cur.y, cur.z + dz, h)) continue;
        if (canStand(world, nx, cur.y, nz, h)) ny = cur.y; else continue;
      } else if (canStand(world, nx, cur.y, nz, h)) ny = cur.y;
      else if (canStand(world, nx, cur.y + 1, nz, h) && passable(world, cur.x, cur.y + h, cur.z)) ny = cur.y + 1;
      else if (passable(world, nx, cur.y, nz) && passable(world, nx, cur.y + 1, nz)) {
        for (let d = 1; d <= maxDrop; d++) {
          if (canStand(world, nx, cur.y - d, nz, h)) { ny = cur.y - d; break; }
          if (!passable(world, nx, cur.y - d, nz)) break;
        }
      }
      if (ny === null) continue;
      const k = key(nx, ny, nz);
      const inWater = world.getBlock(nx, ny, nz) === B.water;
      const cost = (dx && dz ? 1.41 : 1) + (ny > cur.y ? 0.5 : 0) + (inWater ? 2 : 0);
      const g = cur.g + cost;
      let n = nodes.get(k);
      if (n) {
        if (n.closed || g >= n.g) continue;
        // nouvelle entrée dans le tas (l'ancienne sera ignorée car fermée ensuite)
        const m = { x: nx, y: ny, z: nz, g, f: g + Math.abs(tx - nx) + Math.abs(ty - ny) + Math.abs(tz - nz), parent: cur, closed: false };
        n.closed = true;
        nodes.set(k, m);
        heapPush(open, m);
      } else {
        n = { x: nx, y: ny, z: nz, g, f: 0, parent: cur, closed: false };
        n.f = g + Math.abs(tx - nx) + Math.abs(ty - ny) + Math.abs(tz - nz);
        nodes.set(k, n);
        heapPush(open, n);
      }
    }
  }
  const path = [];
  let n = best;
  while (n && n !== start) { path.push({ x: n.x, y: n.y, z: n.z }); n = n.parent; }
  path.reverse();
  return path;
}

export { canStand, passable };
