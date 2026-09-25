// Comportements des blocs : mises à jour voisines, ticks programmés/aléatoires, fluides
import { B, I } from '../data/ids.js';
import { BLOCKS, SOLID, OPAQUE, LIQUID, REPLACEABLE } from '../data/blocks.js';
import { SMELTING } from '../data/recipes.js';
import { fuelValue } from '../data/items.js';
import { oakTree, spruceTree, birchTree } from './gen/features.js';

export const RANDOM_TICK = new Uint8Array(256);
for (const id of [B.grass_block, B.farmland, B.wheat, B.oak_sapling, B.birch_sapling, B.spruce_sapling, B.sugar_cane, B.cactus,
  B.oak_leaves, B.birch_leaves, B.spruce_leaves, B.ice, B.snow, B.fire, B.lava, B.nether_portal, B.dirt_path]) RANDOM_TICK[id] = 1;

const H4 = [[0, -1], [0, 1], [-1, 0], [1, 0]];

function isSupport(id) {
  return SOLID[id] && (OPAQUE[id] || BLOCKS[id].slab || BLOCKS[id].stairs || id === B.farmland || id === B.glass || id === B.soul_sand || id === B.dirt_path);
}

// Un bloc vient d'être posé
export function onPlaced(world, x, y, z, id, meta, old) {
  if (LIQUID[id]) world.scheduleTick(x, y, z, id === B.water ? 5 : world.props.lavaDelay);
  const d = BLOCKS[id];
  if (d && d.gravity) world.scheduleTick(x, y, z, 2);
  if (id === B.tnt && world.game) {
    // TNT à côté d'un feu/lave : rien (pas de redstone)
  }
}

// Le bloc en (x,y,z) est notifié qu'un voisin (fx,fy,fz) a changé
export function neighborChanged(world, x, y, z) {
  if (y < 0 || y > 127) return;
  const id = world.getBlock(x, y, z);
  if (!id) return;
  const d = BLOCKS[id];
  if (!d) return;
  if (LIQUID[id]) { world.scheduleTick(x, y, z, id === B.water ? 5 : world.props.lavaDelay); return; }
  if (d.gravity) { world.scheduleTick(x, y, z, 2); return; }
  const meta = world.getMeta(x, y, z);
  const below = world.getBlock(x, y - 1, z);
  let ok = true;
  switch (id) {
    case B.dandelion: case B.poppy: case B.cornflower: case B.oxeye_daisy: case B.short_grass: case B.fern:
    case B.oak_sapling: case B.birch_sapling: case B.spruce_sapling:
      ok = below === B.grass_block || below === B.dirt || below === B.farmland || below === B.dirt_path;
      break;
    case B.dead_bush:
      ok = below === B.sand || below === B.dirt || below === B.grass_block;
      break;
    case B.brown_mushroom: case B.red_mushroom:
      ok = isSupport(below);
      break;
    case B.wheat:
      ok = below === B.farmland;
      break;
    case B.sugar_cane:
      ok = below === B.sugar_cane || ((below === B.grass_block || below === B.dirt || below === B.sand) && H4.some(([dx, dz]) => world.getBlock(x + dx, y - 1, z + dz) === B.water || world.getBlock(x + dx, y - 1, z + dz) === B.ice));
      break;
    case B.cactus:
      ok = (below === B.sand || below === B.cactus) && !H4.some(([dx, dz]) => SOLID[world.getBlock(x + dx, y, z + dz)]);
      break;
    case B.snow:
      ok = isSupport(below) || below === B.oak_leaves || below === B.spruce_leaves || below === B.birch_leaves;
      break;
    case B.torch:
      if (!meta) ok = isSupport(below) || below === B.oak_fence || below === B.nether_brick_fence;
      else {
        const [dx, dz] = H4[meta - 1];
        ok = isSupport(world.getBlock(x + dx, y, z + dz));
      }
      break;
    case B.ladder: {
      const [dx, dz] = H4[meta & 3];
      ok = isSupport(world.getBlock(x + dx, y, z + dz));
      break;
    }
    case B.oak_door:
      if (meta & 8) ok = world.getBlock(x, y - 1, z) === B.oak_door;
      else ok = isSupport(below) && world.getBlock(x, y + 1, z) === B.oak_door;
      if (!ok) { world.setBlock(x, y, z, 0, 0); if (!(meta & 8)) world.dropItem(x + 0.5, y + 0.5, z + 0.5, { id: I.door_item, count: 1 }); return; }
      break;
    case B.bed: {
      const f = meta & 3;
      const s = meta & 4 ? -1 : 1;
      const dx = [0, 0, -1, 1][f] * s, dz = [-1, 1, 0, 0][f] * s;
      ok = world.getBlock(x + dx, y, z + dz) === B.bed;
      if (!ok) { world.setBlock(x, y, z, 0, 0); return; }
      break;
    }
    case B.fire:
      ok = isSupport(below) || below === B.netherrack || hasFlammableNeighbor(world, x, y, z);
      if (!ok) { world.setBlock(x, y, z, 0, 0); return; }
      break;
    case B.nether_portal:
      if (!portalIntact(world, x, y, z, meta)) { world.setBlock(x, y, z, 0, 0); return; }
      break;
    case B.cake:
      ok = SOLID[below];
      break;
    case B.farmland:
      if (SOLID[world.getBlock(x, y + 1, z)] && OPAQUE[world.getBlock(x, y + 1, z)]) { world.setBlock(x, y, z, B.dirt); return; }
      break;
    case B.brewing_stand: case B.lantern:
      ok = SOLID[below];
      break;
    default:
      break;
  }
  if (!ok) world.breakBlock(x, y, z, {});
}

function hasFlammableNeighbor(world, x, y, z) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const d = BLOCKS[world.getBlock(x + dx, y + dy, z + dz)];
    if (d && d.flammable) return true;
  }
  return false;
}

// Un bloc de portail reste valide si, le long de son axe, il est bordé par portail/obsidienne
function portalIntact(world, x, y, z, meta) {
  const ax = meta & 1 ? [0, 1] : [1, 0]; // meta 0 : plan X (s'étend en X), 1 : plan Z
  const ok = (id) => id === B.nether_portal || id === B.obsidian;
  return ok(world.getBlock(x, y + 1, z)) && ok(world.getBlock(x, y - 1, z)) &&
    ok(world.getBlock(x + ax[0], y, z + ax[1])) && ok(world.getBlock(x - ax[0], y, z - ax[1]));
}

// ---------- Ticks programmés ----------
export function scheduledTick(world, x, y, z) {
  const id = world.getBlock(x, y, z);
  if (LIQUID[id]) { fluidTick(world, x, y, z, id); return; }
  const d = BLOCKS[id];
  if (d && d.gravity) {
    const below = world.getBlock(x, y - 1, z);
    if (y > 0 && (below === 0 || LIQUID[below] || below === B.fire || (REPLACEABLE[below] && !SOLID[below]))) {
      const meta = world.getMeta(x, y, z);
      world.setBlock(x, y, z, 0, 0);
      world.spawn('falling_block', x + 0.5, y, z + 0.5, { block: id, meta });
    }
  }
}

// ---------- Fluides ----------
function fluidLevel(world, x, y, z, id) {
  if (world.getBlock(x, y, z) !== id) return -1;
  const m = world.getMeta(x, y, z);
  return m & 8 ? 0 : m & 7;
}

function canFlowInto(world, x, y, z, fid) {
  const id = world.getBlock(x, y, z);
  if (id === 0) return true;
  if (LIQUID[id]) return false;
  if (!world.isLoaded(x, z)) return false;
  const d = BLOCKS[id];
  return !!(d && d.replaceable && !d.liquid) || (d && d.plant && !SOLID[id] && id !== B.sugar_cane) || id === B.torch && fid === B.water;
}

function flowInto(world, x, y, z, fid, meta) {
  const cur = world.getBlock(x, y, z);
  if (cur && cur !== fid) {
    if (cur === B.fire) world.setBlock(x, y, z, 0, 0, false);
    else world.breakBlock(x, y, z, {});
  }
  world.setBlock(x, y, z, fid, meta);
}

function lavaContact(world, x, y, z, meta) {
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0]]) {
    if (world.getBlock(x + dx, y + dy, z + dz) === B.water) {
      world.setBlock(x, y, z, meta === 0 ? B.obsidian : B.cobblestone, 0);
      world.playSound('fizz', x + 0.5, y + 0.5, z + 0.5);
      world.game?.particles?.spawnBurst(world, 'smoke', x + 0.5, y + 1, z + 0.5, 6);
      return true;
    }
  }
  return false;
}

// Distance jusqu'au trou le plus proche dans une direction (algorithme de Minecraft simplifié)
function holeDistance(world, x, y, z, fid, fromDir, depth) {
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    if (d === fromDir) continue;
    const [dx, dz] = H4[d];
    const nx = x + dx, nz = z + dz;
    if (!canFlowInto(world, nx, y, nz, fid) && world.getBlock(nx, y, nz) !== fid) continue;
    if (world.getBlock(nx, y, nz) === fid && world.getMeta(nx, y, nz) === 0) continue;
    if (canFlowInto(world, nx, y - 1, nz, fid) || world.getBlock(nx, y - 1, nz) === fid) return depth;
    if (depth < 4) {
      const r = holeDistance(world, nx, y, nz, fid, d ^ 1, depth + 1);
      if (r < best) best = r;
    }
  }
  return best;
}

function fluidTick(world, x, y, z, fid) {
  const water = fid === B.water;
  const drop = water ? 1 : world.props.lavaDrop;
  const delay = water ? 5 : world.props.lavaDelay;
  let meta = world.getMeta(x, y, z);
  if (!water && lavaContact(world, x, y, z, meta)) return;
  if (water && world.dim === 'nether') { world.setBlock(x, y, z, 0, 0); return; }

  if (meta !== 0) {
    // recalcule le niveau à partir des voisins
    let min = 99, sources = 0;
    for (const [dx, dz] of H4) {
      const l = fluidLevel(world, x + dx, y, z + dz, fid);
      if (l < 0) continue;
      if (l === 0 && world.getMeta(x + dx, y, z + dz) === 0) sources++;
      if (l < min) min = l;
    }
    let nm;
    const falling = world.getBlock(x, y + 1, z) === fid;
    if (falling) nm = 8;
    else nm = min + drop;
    if (water && sources >= 2) {
      const below = world.getBlock(x, y - 1, z);
      if (SOLID[below] || (below === B.water && world.getMeta(x, y - 1, z) === 0)) nm = 0;
    }
    if (!falling && nm > 7) {
      world.setBlock(x, y, z, 0, 0);
      return;
    }
    if (nm !== meta) {
      world.setBlock(x, y, z, fid, nm);
      meta = nm;
    }
  }
  // écoulement vers le bas
  const below = world.getBlock(x, y - 1, z);
  if (y > 0 && canFlowInto(world, x, y - 1, z, fid)) {
    flowInto(world, x, y - 1, z, fid, 8);
    world.scheduleTick(x, y - 1, z, delay);
    return;
  }
  if (y > 0 && !water && below === B.water) {
    world.setBlock(x, y - 1, z, B.stone, 0);
    world.playSound('fizz', x + 0.5, y, z + 0.5);
    return;
  }
  if (below === fid && meta !== 0) return;
  // étalement horizontal
  const level = meta & 8 ? 0 : meta & 7;
  const next = level + drop;
  if (next > 7) return;
  const dists = [];
  let best = 1000;
  for (let d = 0; d < 4; d++) {
    const [dx, dz] = H4[d];
    const nx = x + dx, nz = z + dz;
    const nid = world.getBlock(nx, y, nz);
    if (!water && nid === B.water) {
      world.setBlock(nx, y, nz, B.cobblestone, 0);
      world.playSound('fizz', nx + 0.5, y + 0.5, nz + 0.5);
      dists.push(null);
      continue;
    }
    if (!canFlowInto(world, nx, y, nz, fid) && !(nid === fid && fluidLevel(world, nx, y, nz, fid) > next)) { dists.push(null); continue; }
    let dist;
    if (canFlowInto(world, nx, y - 1, nz, fid) || world.getBlock(nx, y - 1, nz) === fid) dist = 0;
    else dist = holeDistance(world, nx, y, nz, fid, d ^ 1, 1);
    dists.push(dist);
    if (dist < best) best = dist;
  }
  for (let d = 0; d < 4; d++) {
    if (dists[d] === null || dists[d] > best) continue;
    const [dx, dz] = H4[d];
    const nx = x + dx, nz = z + dz;
    const nid = world.getBlock(nx, y, nz);
    if (nid === fid && fluidLevel(world, nx, y, nz, fid) <= next) continue;
    flowInto(world, nx, y, nz, fid, next);
    world.scheduleTick(nx, y, nz, delay);
  }
}

// ---------- Ticks aléatoires ----------
export function randomTick(world, x, y, z, id) {
  const game = world.game;
  switch (id) {
    case B.grass_block: {
      const above = world.getBlock(x, y + 1, z);
      const la = Math.max(world.getSky(x, y + 1, z) - (game ? game.skyDarken() : 0), world.getBlockLight(x, y + 1, z));
      if (OPAQUE[above] || LIQUID[above]) { world.setBlock(x, y, z, B.dirt); return; }
      if (la >= 9) {
        for (let k = 0; k < 4; k++) {
          const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 5) | 0) - 3, nz = z + ((Math.random() * 3) | 0) - 1;
          if (world.getBlock(nx, ny, nz) === B.dirt && world.getMeta(nx, ny, nz) === 0) {
            const a2 = world.getBlock(nx, ny + 1, nz);
            if (!OPAQUE[a2] && !LIQUID[a2] && world.getSky(nx, ny + 1, nz) >= 4) world.setBlock(nx, ny, nz, B.grass_block, 0);
          }
        }
      }
      return;
    }
    case B.dirt_path:
      if (OPAQUE[world.getBlock(x, y + 1, z)]) world.setBlock(x, y, z, B.dirt);
      return;
    case B.farmland: {
      let wet = false;
      for (let dx = -4; dx <= 4 && !wet; dx++)
        for (let dz = -4; dz <= 4 && !wet; dz++)
          for (let dy = 0; dy <= 1; dy++) if (world.getBlock(x + dx, y + dy, z + dz) === B.water) { wet = true; break; }
      if (!wet && game && game.weather && game.weather.raining && world.getSky(x, y + 1, z) >= 15) wet = true;
      const meta = world.getMeta(x, y, z);
      if (wet && !meta) world.setBlock(x, y, z, B.farmland, 1);
      else if (!wet) {
        if (meta) world.setBlock(x, y, z, B.farmland, 0);
        else if (world.getBlock(x, y + 1, z) !== B.wheat && Math.random() < 0.3) world.setBlock(x, y, z, B.dirt);
      }
      return;
    }
    case B.wheat: {
      const meta = world.getMeta(x, y, z);
      if (meta >= 7) return;
      const l = Math.max(world.getSky(x, y + 1, z) - (game ? game.skyDarken() : 0), world.getBlockLight(x, y, z));
      if (l < 9) return;
      const moist = world.getMeta(x, y - 1, z) === 1;
      if (Math.random() < (moist ? 0.5 : 0.25)) world.setBlock(x, y, z, B.wheat, meta + 1);
      return;
    }
    case B.oak_sapling: case B.birch_sapling: case B.spruce_sapling:
      if (Math.random() < 0.15 && world.getLight(x, y + 1, z) >= 9) growTree(world, x, y, z, id);
      return;
    case B.sugar_cane: case B.cactus: {
      if (world.getBlock(x, y + 1, z) !== 0) return;
      let h = 1;
      while (world.getBlock(x, y - h, z) === id) h++;
      if (h >= 3) return;
      const age = world.getMeta(x, y, z);
      if (age >= 7) {
        world.setBlock(x, y + 1, z, id, 0);
        world.setBlock(x, y, z, id, 0, false);
      } else world.setBlock(x, y, z, id, age + 1, false);
      return;
    }
    case B.oak_leaves: case B.birch_leaves: case B.spruce_leaves: {
      if (world.getMeta(x, y, z) & 1) return;
      if (!logNearby(world, x, y, z)) world.breakBlock(x, y, z, {});
      return;
    }
    case B.ice:
      if (world.getBlockLight(x, y, z) > 11 || world.dim === 'nether') world.setBlock(x, y, z, world.dim === 'nether' ? 0 : B.water);
      return;
    case B.snow:
      if (world.getBlockLight(x, y, z) > 11) world.setBlock(x, y, z, 0);
      return;
    case B.fire:
      fireTick(world, x, y, z);
      return;
    case B.lava:
      if (Math.random() < 0.3) {
        for (let k = 0; k < 3; k++) {
          const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + 1 + ((Math.random() * 2) | 0), nz = z + ((Math.random() * 3) | 0) - 1;
          if (world.getBlock(nx, ny, nz) === 0 && hasFlammableNeighbor(world, nx, ny, nz)) { world.setBlock(nx, ny, nz, B.fire); break; }
        }
      }
      return;
    case B.nether_portal:
      if (world.dim === 'overworld' && Math.random() < 0.002 && game && game.settings.difficulty > 0) {
        let yy = y;
        while (world.getBlock(x, yy - 1, z) === B.nether_portal) yy--;
        world.spawn('piglin', x + 0.5, yy, z + 0.5);
      }
      return;
    default:
      return;
  }
}

function logNearby(world, x, y, z) {
  // BFS à travers les feuilles jusqu'à 4 blocs
  const seen = new Set();
  let frontier = [[x, y, z]];
  for (let d = 0; d < 5; d++) {
    const next = [];
    for (const [px, py, pz] of frontier) {
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const nx = px + dx, ny = py + dy, nz = pz + dz;
        const k = nx + ',' + ny + ',' + nz;
        if (seen.has(k)) continue;
        seen.add(k);
        const id = world.getBlock(nx, ny, nz);
        if (id === B.oak_log || id === B.birch_log || id === B.spruce_log) return true;
        if (!world.isLoaded(nx, nz)) return true;
        if (BLOCKS[id] && BLOCKS[id].leaves) next.push([nx, ny, nz]);
      }
    }
    frontier = next;
    if (!frontier.length) break;
  }
  return false;
}

export function growTree(world, x, y, z, sapling) {
  // vérifie l'espace
  for (let dy = 1; dy <= 6; dy++) {
    const id = world.getBlock(x, y + dy, z);
    if (id && !BLOCKS[id].leaves && !REPLACEABLE[id]) return false;
  }
  const below = world.getBlock(x, y - 1, z);
  if (below !== B.grass_block && below !== B.dirt) return false;
  world.setBlock(x, y, z, 0, 0, false);
  const put = (px, py, pz, id, meta, mode) => {
    const cur = world.getBlock(px, py, pz);
    if (mode === 1 && cur !== 0 && !REPLACEABLE[cur]) return;
    if (mode === 2 && cur !== 0 && !REPLACEABLE[cur] && !(BLOCKS[cur] && BLOCKS[cur].leaves) && cur !== B.oak_sapling && cur !== B.birch_sapling && cur !== B.spruce_sapling) return;
    if (id === B.dirt) return;
    world.setBlock(px, py, pz, id, meta, false);
  };
  const rng = Math.random;
  if (sapling === B.spruce_sapling) spruceTree(put, x, y, z, rng);
  else if (sapling === B.birch_sapling) birchTree(put, x, y, z, rng);
  else oakTree(put, x, y, z, rng, B.oak_log, B.oak_leaves, rng() < 0.1);
  if (world.getBlock(x, y, z) === 0) world.setBlock(x, y, z, sapling === B.spruce_sapling ? B.spruce_log : sapling === B.birch_sapling ? B.birch_log : B.oak_log);
  return true;
}

function fireTick(world, x, y, z) {
  const below = world.getBlock(x, y - 1, z);
  const eternal = below === B.netherrack || below === B.magma_block || (below === B.bedrock && world.dim === 'end');
  const game = world.game;
  if (!eternal && game && game.weather && game.weather.raining && world.getSky(x, y, z) >= 15 && Math.random() < 0.5) { world.setBlock(x, y, z, 0); return; }
  const age = world.getMeta(x, y, z);
  if (!eternal) {
    if (age < 15) world.setBlock(x, y, z, B.fire, Math.min(15, age + 1 + ((Math.random() * 3) | 0)), false);
    if (!hasFlammableNeighbor(world, x, y, z) && (!isSupport(below) || age > 3)) { world.setBlock(x, y, z, 0); return; }
    if (age >= 15 && Math.random() < 0.25 && !BLOCKS[below]?.flammable) { world.setBlock(x, y, z, 0); return; }
  }
  if (game && !game.settings.fireSpread) return;
  // brûle / propage
  for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const nx = x + dx, ny = y + dy, nz = z + dz;
    const nid = world.getBlock(nx, ny, nz);
    const d = BLOCKS[nid];
    if (d && d.flammable && Math.random() * 100 < d.flammable) {
      if (nid === B.tnt) { world.setBlock(nx, ny, nz, 0); world.spawn('tnt', nx + 0.5, ny, nz + 0.5, { fuse: 10 + ((Math.random() * 20) | 0) }); continue; }
      world.setBlock(nx, ny, nz, Math.random() < 0.4 ? B.fire : 0, 0);
    }
  }
  for (let k = 0; k < 2; k++) {
    const nx = x + ((Math.random() * 3) | 0) - 1, ny = y + ((Math.random() * 4) | 0) - 1, nz = z + ((Math.random() * 3) | 0) - 1;
    if (world.getBlock(nx, ny, nz) === 0 && hasFlammableNeighbor(world, nx, ny, nz) && Math.random() < 0.3) world.setBlock(nx, ny, nz, B.fire, 0);
  }
}

// ---------- Entités de bloc (four, générateur) ----------
export function blockEntityTick(world, x, y, z, be, player) {
  if (be.type === 'furnace') furnaceTick(world, x, y, z, be);
  else if (be.type === 'spawner') spawnerTick(world, x, y, z, be, player);
  else if (be.type === 'brewing') brewingTick(world, x, y, z, be);
}

export function canSmelt(be) {
  const input = be.items[0];
  if (!input) return null;
  const r = SMELTING.get(input.id);
  if (!r) return null;
  const out = be.items[2];
  if (out && (out.id !== r.id || out.count >= 64 || out.ench)) return null;
  return r;
}

function furnaceTick(world, x, y, z, be) {
  const wasBurning = be.burn > 0;
  if (be.burn > 0) be.burn--;
  const r = canSmelt(be);
  if (be.burn <= 0 && r) {
    const fuel = be.items[1];
    const fv = fuel ? fuelValue(fuel.id) : 0;
    if (fv > 0) {
      be.burn = be.burnMax = fv;
      if (fuel.id === I.lava_bucket) be.items[1] = { id: I.bucket, count: 1 };
      else if (--fuel.count <= 0) be.items[1] = null;
    }
  }
  if (be.burn > 0 && r) {
    be.cook = (be.cook || 0) + 1;
    if (be.cook >= 200) {
      be.cook = 0;
      const input = be.items[0];
      if (--input.count <= 0) be.items[0] = null;
      if (be.items[2]) be.items[2].count++;
      else be.items[2] = { id: r.id, count: 1 };
      be.xp = (be.xp || 0) + r.xp;
    }
  } else if (be.cook > 0) be.cook = Math.max(0, be.cook - 2);
  const burning = be.burn > 0;
  if (burning !== wasBurning) {
    const meta = world.getMeta(x, y, z);
    world.setBlock(x, y, z, burning ? B.lit_furnace : B.furnace, meta, false);
  }
  if (burning && Math.random() < 0.08) world.game?.particles?.spawn(world, 'flame', x + 0.5 + (Math.random() - 0.5) * 0.4, y + 0.3, z + 0.5, 0, 0.01, 0);
  const c = world.getChunk(x >> 4, z >> 4);
  if (c) c.modified = true;
}

function brewingTick(world, x, y, z, be) {
  // Alambic : ingrédient (slot 3) + fioles (0..2) ; poudre de blaze comme carburant (slot 4)
  if (!be.fuel && be.items[4] && be.items[4].id === I.blaze_powder) {
    be.fuel = 20;
    if (--be.items[4].count <= 0) be.items[4] = null;
  }
  const ing = be.items[3];
  const hasBottle = [0, 1, 2].some((i) => be.items[i] && (be.items[i].id === I.potion || be.items[i].id === I.glass_bottle));
  const valid = ing && be.fuel > 0 && hasBottle && brewResult(be.items[0], ing) !== undefined;
  if (valid) {
    be.brew = (be.brew || 0) + 1;
    if (be.brew >= 400) {
      be.brew = 0;
      be.fuel--;
      for (const i of [0, 1, 2]) {
        const r = brewResult(be.items[i], ing);
        if (r) be.items[i] = r;
      }
      if (--ing.count <= 0) be.items[3] = null;
      world.playSound('brew', x + 0.5, y + 0.5, z + 0.5);
      world.game?.onBrew?.();
    }
  } else be.brew = 0;
}

export const POTIONS = {
  water: { name: 'Fiole d\'eau', color: [60, 90, 230] },
  awkward: { name: 'Potion étrange', color: [80, 100, 220] },
  healing: { name: 'Potion de soin', color: [240, 40, 60] },
  regeneration: { name: 'Potion de régénération', color: [220, 100, 180] },
  fire_resistance: { name: 'Potion de résistance au feu', color: [230, 150, 60] },
  strength: { name: 'Potion de force', color: [150, 40, 40] },
  swiftness: { name: 'Potion de rapidité', color: [120, 180, 230] },
  night_vision: { name: 'Potion de vision nocturne', color: [40, 40, 160] },
};

function brewResult(bottle, ing) {
  if (!bottle || !ing) return null;
  const p = bottle.id === I.potion ? bottle.potion || 'water' : null;
  if (!p) return null;
  if (p === 'water' && ing.id === I.nether_wart) return { id: I.potion, count: 1, potion: 'awkward' };
  if (p === 'awkward') {
    const map = { [I.ghast_tear]: 'regeneration', [I.magma_cream]: 'fire_resistance', [I.blaze_powder]: 'strength', [I.sugar]: 'swiftness', [I.golden_apple]: 'night_vision', [I.melon_slice]: 'healing', [I.glowstone_dust]: 'healing' };
    if (map[ing.id]) return { id: I.potion, count: 1, potion: map[ing.id] };
  }
  return undefined;
}

const SPAWNER_MOBS = ['zombie', 'skeleton', 'spider', 'blaze', 'wither_skeleton'];
function spawnerTick(world, x, y, z, be, player) {
  if (!player || player.dead) return;
  const dx = player.x - x, dy = player.y - y, dz = player.z - z;
  if (dx * dx + dy * dy + dz * dz > 16 * 16) return;
  if (Math.random() < 0.3) world.game?.particles?.spawn(world, Math.random() < 0.5 ? 'flame' : 'smoke', x + Math.random(), y + Math.random(), z + Math.random(), 0, 0.02, 0);
  if (world.game && world.game.settings.difficulty === 0) return;
  if (be.delay > 0) { be.delay--; return; }
  be.delay = 200 + ((Math.random() * 600) | 0);
  const mob = SPAWNER_MOBS.includes(be.mob) ? be.mob : 'zombie';
  const near = world.entitiesIn(x - 8, y - 4, z - 8, x + 9, y + 5, z + 9, (e) => e.type === mob).length;
  if (near >= 6) return;
  const n = 1 + ((Math.random() * 4) | 0);
  let spawned = 0;
  for (let attempt = 0; attempt < n * 4 && spawned < n; attempt++) {
    const bx = Math.floor(x + (Math.random() - 0.5) * 8), bz = Math.floor(z + (Math.random() - 0.5) * 8);
    let by = y + 1;
    // chercher un sol entre y+1 et y-2
    while (by > y - 3 && !SOLID[world.getBlock(bx, by - 1, bz)]) by--;
    if (SOLID[world.getBlock(bx, by, bz)] || SOLID[world.getBlock(bx, by + 1, bz)]) continue;
    if (mob !== 'blaze' && !SOLID[world.getBlock(bx, by - 1, bz)]) continue;
    if (mob !== 'blaze' && mob !== 'wither_skeleton' && world.getBlockLight(bx, by, bz) > 11) continue;
    const e = world.spawn(mob, bx + 0.5, by, bz + 0.5);
    if (e) { spawned++; world.game?.particles?.spawnBurst(world, 'smoke', bx + 0.5, by + 0.5, bz + 0.5, 8); }
  }
}
