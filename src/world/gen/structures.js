// Structures générées : plans ("blueprints") pouvant chevaucher plusieurs chunks
import { B, I } from '../../data/ids.js';
import { RNG, hash2, hashString, mulberry32 } from '../../core/noise.js';
import { chunkKey } from '../../core/constants.js';

export class Blueprint {
  constructor(name) {
    this.name = name;
    this.ops = new Map();
    this.minX = Infinity; this.minZ = Infinity; this.maxX = -Infinity; this.maxZ = -Infinity;
    this.minY = Infinity; this.maxY = -Infinity;
    this.extras = new Map(); // chunkKey -> [{kind, x,y,z, data}]
    this.zones = []; // zones (boîtes) pour l'apparition de monstres spécifiques
  }
  set(x, y, z, id, meta = 0) {
    if (y < 0 || y > 127) return;
    const k = chunkKey(x >> 4, z >> 4);
    let a = this.ops.get(k);
    if (!a) { a = []; this.ops.set(k, a); }
    a.push(x, y, z, id, meta);
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
  }
  fill(x0, y0, z0, x1, y1, z1, id, meta = 0) {
    for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++)
      for (let z = Math.min(z0, z1); z <= Math.max(z0, z1); z++)
        for (let x = Math.min(x0, x1); x <= Math.max(x0, x1); x++) this.set(x, y, z, typeof id === 'function' ? id(x, y, z) : id, meta);
  }
  // Boîte creuse : murs "wall" (fonction ou id), intérieur air
  room(x0, y0, z0, x1, y1, z1, wall, floor = wall, ceil = wall) {
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++)
        for (let x = x0; x <= x1; x++) {
          let id;
          if (y === y0) id = floor;
          else if (y === y1) id = ceil;
          else if (x === x0 || x === x1 || z === z0 || z === z1) id = wall;
          else id = B.air;
          this.set(x, y, z, typeof id === 'function' ? id(x, y, z) : id);
        }
  }
  extra(kind, x, y, z, data) {
    const k = chunkKey(x >> 4, z >> 4);
    let a = this.extras.get(k);
    if (!a) { a = []; this.extras.set(k, a); }
    a.push({ kind, x, y, z, data });
  }
  chest(x, y, z, facing, loot, seed) {
    this.set(x, y, z, B.chest, facing);
    this.extra('chest', x, y, z, { loot, seed });
  }
  spawner(x, y, z, mob) {
    this.set(x, y, z, B.spawner, 0);
    this.extra('spawner', x, y, z, { mob });
  }
  entity(type, x, y, z, data) {
    this.extra('entity', x, y, z, Object.assign({ type }, data));
  }
  intersectsChunk(cx, cz) {
    return this.ops.has(chunkKey(cx, cz)) || this.extras.has(chunkKey(cx, cz));
  }
  applyTo(chunk) {
    const k = chunkKey(chunk.cx, chunk.cz);
    const a = this.ops.get(k);
    const ox = chunk.cx * 16, oz = chunk.cz * 16;
    if (a) {
      for (let i = 0; i < a.length; i += 5) {
        const idx = (a[i + 1] << 8) | ((a[i + 2] - oz) << 4) | (a[i] - ox);
        chunk.blocks[idx] = a[i + 3];
        chunk.meta[idx] = a[i + 4];
      }
    }
    const ex = this.extras.get(k);
    if (ex) {
      for (const e of ex) {
        const idx = (e.y << 8) | ((e.z - oz) << 4) | (e.x - ox);
        if (e.kind === 'chest') {
          chunk.blockEntities.set(idx, { type: 'chest', items: rollLoot(e.data.loot, e.data.seed) });
        } else if (e.kind === 'spawner') {
          chunk.blockEntities.set(idx, { type: 'spawner', mob: e.data.mob, delay: 200 });
        } else if (e.kind === 'entity') {
          if (!chunk.pendingEntities) chunk.pendingEntities = [];
          chunk.pendingEntities.push({ type: e.data.type, x: e.x + 0.5, y: e.y, z: e.z + 0.5, data: e.data });
        }
      }
    }
  }
}

// ================= Butins =================
const stack = (id, a, b) => ({ id, min: a, max: b ?? a });
export const LOOT = {
  dungeon: { rolls: [4, 8], items: [
    [stack(I.bread, 1, 3), 20], [stack(I.wheat_item, 1, 4), 15], [stack(I.iron_ingot, 1, 4), 10], [stack(I.gold_ingot, 1, 4), 6],
    [stack(I.string, 1, 4), 10], [stack(I.gunpowder, 1, 4), 10], [stack(I.bucket, 1), 8], [stack(I.golden_apple, 1), 3],
    [stack(I.diamond, 1, 2), 3], [stack(I.ender_pearl, 1, 2), 6], [stack(I.redstone, 1, 4), 8], [stack(I.coal, 3, 8), 10],
    [stack(I.bone, 1, 8), 10], [stack(I.rotten_flesh, 1, 8), 10], [stack(I.enchanted_book, 1), 4], [stack(I.apple, 1, 3), 10],
  ] },
  stronghold: { rolls: [3, 6], items: [
    [stack(I.ender_pearl, 1, 2), 12], [stack(I.diamond, 1, 3), 3], [stack(I.iron_ingot, 1, 5), 10], [stack(I.gold_ingot, 1, 3), 5],
    [stack(I.redstone, 4, 9), 5], [stack(I.bread, 1, 3), 15], [stack(I.apple, 1, 3), 15], [stack(I.iron_pickaxe, 1), 5],
    [stack(I.iron_sword, 1), 5], [stack(I.iron_chestplate, 1), 5], [stack(I.iron_helmet, 1), 5], [stack(I.iron_leggings, 1), 5],
    [stack(I.iron_boots, 1), 5], [stack(I.golden_apple, 1), 2], [stack(I.ender_eye, 1), 3],
  ] },
  library: { rolls: [3, 7], items: [
    [stack(I.book, 1, 3), 20], [stack(I.paper, 2, 7), 20], [stack(I.compass, 1), 3], [stack(I.enchanted_book, 1), 12], [stack(I.clock, 1), 2],
  ] },
  blacksmith: { rolls: [3, 8], items: [
    [stack(I.diamond, 1, 3), 3], [stack(I.iron_ingot, 1, 5), 10], [stack(I.gold_ingot, 1, 3), 5], [stack(I.bread, 1, 3), 15],
    [stack(I.apple, 1, 3), 15], [stack(I.iron_pickaxe, 1), 5], [stack(I.iron_sword, 1), 5], [stack(I.iron_chestplate, 1), 5],
    [stack(I.iron_helmet, 1), 5], [stack(I.iron_leggings, 1), 5], [stack(I.iron_boots, 1), 5], [stack(B.obsidian, 3, 7), 5],
    [stack(B.oak_sapling, 3, 7), 5],
  ] },
  village: { rolls: [2, 6], items: [
    [stack(I.bread, 1, 4), 20], [stack(I.apple, 1, 5), 15], [stack(I.wheat_seeds, 2, 8), 15], [stack(I.emerald, 1, 3), 6],
    [stack(I.carrot, 1, 4), 10], [stack(I.potato, 1, 4), 10], [stack(I.book, 1), 5], [stack(B.torch, 2, 6), 10], [stack(I.feather, 1, 3), 5],
  ] },
  fortress: { rolls: [2, 5], items: [
    [stack(I.diamond, 1, 3), 5], [stack(I.iron_ingot, 1, 5), 5], [stack(I.gold_ingot, 1, 3), 15], [stack(I.golden_sword, 1), 5],
    [stack(I.golden_chestplate, 1), 5], [stack(I.flint_and_steel, 1), 5], [stack(I.nether_wart, 3, 7), 5], [stack(B.obsidian, 2, 4), 3],
    [stack(I.blaze_rod, 1, 2), 6], [stack(I.golden_apple, 1), 2],
  ] },
  bonus: { rolls: [4, 6], items: [
    [stack(I.stick, 1, 12), 10], [stack(B.oak_planks, 1, 12), 10], [stack(B.oak_log, 1, 3), 10], [stack(I.apple, 1, 2), 5],
    [stack(I.bread, 1, 2), 5], [stack(I.wooden_axe, 1), 3], [stack(I.wooden_pickaxe, 1), 3], [stack(I.stone_axe, 1), 1], [stack(I.stone_pickaxe, 1), 1],
  ] },
};

let enchantHook = null;
export function setLootEnchantHook(fn) { enchantHook = fn; }

export function rollLoot(tableName, seed) {
  const t = LOOT[tableName];
  const rnd = mulberry32(seed >>> 0);
  const items = new Array(27).fill(null);
  if (!t) return items;
  const total = t.items.reduce((s, e) => s + e[1], 0);
  const rolls = t.rolls[0] + Math.floor(rnd() * (t.rolls[1] - t.rolls[0] + 1));
  for (let r = 0; r < rolls; r++) {
    let x = rnd() * total;
    let e = t.items[0];
    for (const it of t.items) { x -= it[1]; if (x <= 0) { e = it; break; } }
    const s = e[0];
    const count = s.min + Math.floor(rnd() * (s.max - s.min + 1));
    let st = { id: s.id, count };
    if (s.id === I.enchanted_book && enchantHook) st = enchantHook(st, rnd);
    let slot = Math.floor(rnd() * 27);
    for (let k = 0; k < 27 && items[slot]; k++) slot = (slot + 1) % 27;
    items[slot] = st;
  }
  return items;
}

// ================= Forteresse du Nether =================
export function buildFortress(seed, fx, fz) {
  const bp = new Blueprint('fortress');
  const rng = new RNG(hash2(seed, fx, fz) ^ 0xf0f0);
  const Y = 64;
  const deck = (x0, z0, x1, z1) => {
    // tablier du pont + garde-corps + dégagement
    bp.fill(x0, Y, z0, x1, Y, z1, B.nether_bricks);
    bp.fill(x0, Y + 1, z0, x1, Y + 5, z1, B.air);
  };
  const railsX = (x0, x1, z) => { for (let x = x0; x <= x1; x++) { bp.set(x, Y + 1, z, B.nether_brick_fence); } };
  const railsZ = (z0, z1, x) => { for (let z = z0; z <= z1; z++) { bp.set(x, Y + 1, z, B.nether_brick_fence); } };
  const pillar = (x, z) => { for (let y = Y - 1; y >= 20; y--) bp.set(x, y, z, B.nether_bricks); };

  // Salle centrale couverte
  const hall = (cx, cz, r) => {
    bp.room(cx - r, Y, cz - r, cx + r, Y + 6, cz + r, B.nether_bricks);
    for (let x = cx - r + 2; x <= cx + r - 2; x += 3) {
      bp.set(x, Y + 3, cz - r, B.nether_brick_fence); bp.set(x, Y + 3, cz + r, B.nether_brick_fence);
    }
    for (let z = cz - r + 2; z <= cz + r - 2; z += 3) {
      bp.set(cx - r, Y + 3, z, B.nether_brick_fence); bp.set(cx + r, Y + 3, z, B.nether_brick_fence);
    }
    pillar(cx - r, cz - r); pillar(cx + r, cz - r); pillar(cx - r, cz + r); pillar(cx + r, cz + r);
  };

  hall(fx, fz, 6);
  bp.chest(fx + 4, Y + 1, fz + 4, 0, 'fortress', hash2(seed, fx + 4, fz + 4));
  bp.zones.push({ x0: fx - 90, y0: Y - 6, z0: fz - 90, x1: fx + 90, y1: Y + 12, z1: fz + 90, type: 'fortress' });

  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let spawners = 0;
  dirs.forEach(([dx, dz], di) => {
    const len = 26 + rng.int(20);
    // pont
    for (let s = 7; s <= len; s++) {
      const x = fx + dx * s, z = fz + dz * s;
      if (dx) {
        deck(x, z - 2, x, z + 2);
        bp.set(x, Y + 1, z - 2, B.nether_brick_fence); bp.set(x, Y + 1, z + 2, B.nether_brick_fence);
        if (s % 8 === 0) { pillar(x, z - 2); pillar(x, z + 2); }
      } else {
        deck(x - 2, z, x + 2, z);
        bp.set(x - 2, Y + 1, z, B.nether_brick_fence); bp.set(x + 2, Y + 1, z, B.nether_brick_fence);
        if (s % 8 === 0) { pillar(x - 2, z); pillar(x + 2, z); }
      }
    }
    // ouverture du hall vers le pont
    if (dx) bp.fill(fx + dx * 6, Y + 1, fz - 1, fx + dx * 6, Y + 3, fz + 1, B.air);
    else bp.fill(fx - 1, Y + 1, fz + dz * 6, fx + 1, Y + 3, fz + dz * 6, B.air);
    // extrémité : plateforme à blaze (2 bras) ou salle couverte
    const ex = fx + dx * (len + 5), ez = fz + dz * (len + 5);
    if (di < 2 || (spawners < 2 && rng.chance(0.5))) {
      spawners++;
      bp.fill(ex - 4, Y, ez - 4, ex + 4, Y, ez + 4, B.nether_bricks);
      bp.fill(ex - 4, Y + 1, ez - 4, ex + 4, Y + 6, ez + 4, B.air);
      railsX(ex - 4, ex + 4, ez - 4); railsX(ex - 4, ex + 4, ez + 4);
      railsZ(ez - 4, ez + 4, ex - 4); railsZ(ez - 4, ez + 4, ex + 4);
      // entrée
      if (dx) bp.fill(ex - dx * 4, Y + 1, ez - 1, ex - dx * 4, Y + 1, ez + 1, B.air);
      else bp.fill(ex - 1, Y + 1, ez - dz * 4, ex + 1, Y + 1, ez - dz * 4, B.air);
      // escalier vers le générateur
      bp.fill(ex - 1, Y + 1, ez - 1, ex + 1, Y + 1, ez + 1, B.nether_bricks);
      bp.spawner(ex, Y + 2, ez, 'blaze');
      pillar(ex - 4, ez - 4); pillar(ex + 4, ez - 4); pillar(ex - 4, ez + 4); pillar(ex + 4, ez + 4);
    } else {
      hall(ex, ez, 5);
      if (dx) bp.fill(ex - dx * 5, Y + 1, ez - 1, ex - dx * 5, Y + 3, ez + 1, B.air);
      else bp.fill(ex - 1, Y + 1, ez - dz * 5, ex + 1, Y + 3, ez - dz * 5, B.air);
      bp.chest(ex + 2, Y + 1, ez + 2, 0, 'fortress', hash2(seed, ex, ez));
      // escaliers de verrues du Nether (décor)
      bp.fill(ex - 2, Y, ez - 2, ex - 1, Y, ez - 1, B.soul_sand);
      bp.entity('wither_skeleton', ex, Y + 1, ez);
    }
  });
  // Blazes présents dès la génération
  bp.entity('blaze', fx, Y + 2, fz);
  return bp;
}

// ================= Fort (stronghold) =================
export function strongholdPos(seed) {
  const rng = new RNG(hashString('stronghold') ^ seed);
  const ang = rng.float() * Math.PI * 2;
  const dist = 300 + rng.float() * 220;
  return { x: Math.round(Math.cos(ang) * dist), y: 24, z: Math.round(Math.sin(ang) * dist) };
}

export function buildStronghold(seed) {
  const bp = new Blueprint('stronghold');
  const { x: cx, y: y0, z: cz } = strongholdPos(seed);
  const rng = new RNG(seed ^ 0x51a7);
  const sb = () => {
    const r = rng.float();
    return r < 0.7 ? B.stone_bricks : r < 0.85 ? B.mossy_stone_bricks : B.cracked_stone_bricks;
  };
  const corridor = (x0, z0, x1, z1) => {
    // couloir 3x3 le long d'un axe
    const alongX = z0 === z1;
    const a0 = alongX ? Math.min(x0, x1) : Math.min(z0, z1), a1 = alongX ? Math.max(x0, x1) : Math.max(z0, z1);
    for (let a = a0; a <= a1; a++)
      for (let w = -2; w <= 2; w++)
        for (let y = y0; y <= y0 + 4; y++) {
          const x = alongX ? a : x0 + w, z = alongX ? z0 + w : a;
          const edge = Math.abs(w) === 2 || y === y0 || y === y0 + 4;
          bp.set(x, y, z, edge ? sb() : B.air);
        }
    // torches
    for (let a = a0 + 3; a <= a1; a += 8) {
      if (alongX) bp.set(a, y0 + 2, z0 - 1, B.torch, 1);
      else bp.set(x0 - 1, y0 + 2, a, B.torch, 3);
    }
  };

  // --- Salle du portail
  bp.room(cx - 6, y0, cz - 9, cx + 6, y0 + 9, cz + 9, sb);
  // plateforme
  bp.fill(cx - 3, y0 + 1, cz, cx + 3, y0 + 3, cz + 6, sb);
  // lave sous le portail
  bp.fill(cx - 1, y0 + 3, cz + 2, cx + 1, y0 + 3, cz + 4, B.lava);
  bp.fill(cx - 1, y0 + 4, cz + 2, cx + 1, y0 + 6, cz + 4, B.air);
  // cadres (orientés vers l'intérieur)
  const frame = (x, z, facing) => bp.set(x, y0 + 4, z, B.end_portal_frame, facing | (rng.chance(0.1) ? 4 : 0));
  for (let x = cx - 1; x <= cx + 1; x++) { frame(x, cz + 1, 1); frame(x, cz + 5, 0); }
  for (let z = cz + 2; z <= cz + 4; z++) { frame(cx - 2, z, 3); frame(cx + 2, z, 2); }
  // escalier
  bp.set(cx - 1, y0 + 1, cz - 3, B.stone_brick_stairs, 1); bp.set(cx, y0 + 1, cz - 3, B.stone_brick_stairs, 1); bp.set(cx + 1, y0 + 1, cz - 3, B.stone_brick_stairs, 1);
  bp.fill(cx - 1, y0 + 1, cz - 2, cx + 1, y0 + 1, cz - 1, sb);
  bp.set(cx - 1, y0 + 2, cz - 2, B.stone_brick_stairs, 1); bp.set(cx, y0 + 2, cz - 2, B.stone_brick_stairs, 1); bp.set(cx + 1, y0 + 2, cz - 2, B.stone_brick_stairs, 1);
  bp.fill(cx - 1, y0 + 2, cz - 1, cx + 1, y0 + 2, cz - 1, sb);
  bp.set(cx - 1, y0 + 3, cz - 1, B.stone_brick_stairs, 1); bp.set(cx, y0 + 3, cz - 1, B.stone_brick_stairs, 1); bp.set(cx + 1, y0 + 3, cz - 1, B.stone_brick_stairs, 1);
  // bassins de lave latéraux
  bp.fill(cx - 5, y0, cz + 2, cx - 4, y0, cz + 5, B.lava);
  bp.fill(cx + 4, y0, cz + 2, cx + 5, y0, cz + 5, B.lava);
  // torches murales
  for (const z of [cz - 6, cz - 1, cz + 4, cz + 8]) { bp.set(cx - 5, y0 + 4, z, B.torch, 3); bp.set(cx + 5, y0 + 4, z, B.torch, 4); }
  // barreaux décoratifs
  for (const z of [cz - 4, cz + 1, cz + 6]) { bp.set(cx - 6, y0 + 5, z, B.iron_bars); bp.set(cx + 6, y0 + 5, z, B.iron_bars); }
  // porte nord
  bp.fill(cx - 1, y0 + 1, cz - 9, cx + 1, y0 + 3, cz - 9, B.air);
  bp.zones.push({ x0: cx - 6, y0, z0: cz - 9, x1: cx + 6, y1: y0 + 9, z1: cz + 9, type: 'portal_room' });

  // --- Couloir nord vers le carrefour
  corridor(cx, cz - 10, cx, cz - 24);
  // Carrefour
  const rz = cz - 29;
  bp.room(cx - 5, y0, rz - 5, cx + 5, y0 + 6, rz + 5, sb);
  for (const [px, pz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) bp.fill(cx + px, y0 + 1, rz + pz, cx + px, y0 + 5, rz + pz, B.stone_bricks);
  bp.set(cx, y0 + 1, rz, B.cobblestone); bp.set(cx, y0 + 2, rz, B.torch, 0);
  bp.chest(cx + 3, y0 + 1, rz - 4, 1, 'stronghold', hash2(seed, cx + 3, rz));
  bp.fill(cx - 1, y0 + 1, rz + 5, cx + 1, y0 + 3, rz + 5, B.air);
  bp.fill(cx - 5, y0 + 1, rz - 1, cx - 5, y0 + 3, rz + 1, B.air);
  bp.fill(cx + 5, y0 + 1, rz - 1, cx + 5, y0 + 3, rz + 1, B.air);
  bp.fill(cx - 1, y0 + 1, rz - 5, cx - 1 + 2, y0 + 3, rz - 5, B.air);

  // --- Bibliothèque à l'ouest
  corridor(cx - 6, rz, cx - 19, rz);
  const lx = cx - 26;
  bp.room(lx - 6, y0, rz - 5, lx + 6, y0 + 8, rz + 5, B.oak_planks);
  for (let x = lx - 5; x <= lx + 5; x++)
    for (let y = y0 + 1; y <= y0 + 7; y++) {
      if (y === y0 + 4) continue;
      bp.set(x, y, rz - 4, B.bookshelf); bp.set(x, y, rz + 4, B.bookshelf);
    }
  for (let z = rz - 2; z <= rz + 2; z += 2) for (let y = y0 + 1; y <= y0 + 3; y++) { bp.set(lx - 3, y, z, B.bookshelf); bp.set(lx + 3, y, z, B.bookshelf); }
  for (let i = 0; i < 12; i++) bp.set(lx - 5 + rng.int(11), y0 + 5 + rng.int(3), rz - 3 + rng.int(7), B.cobweb);
  bp.fill(lx + 6, y0 + 1, rz - 1, lx + 6, y0 + 3, rz + 1, B.air);
  bp.chest(lx, y0 + 1, rz - 3, 1, 'library', hash2(seed, lx, rz));
  bp.set(lx - 5, y0 + 3, rz, B.torch, 3); bp.set(lx + 5, y0 + 5, rz - 3, B.torch, 1);

  // --- Réserve à l'est
  corridor(cx + 6, rz, cx + 18, rz);
  const sx = cx + 23;
  bp.room(sx - 4, y0, rz - 4, sx + 4, y0 + 5, rz + 4, sb);
  bp.fill(sx - 4, y0 + 1, rz - 1, sx - 4, y0 + 3, rz + 1, B.air);
  bp.chest(sx + 3, y0 + 1, rz - 2, 2, 'stronghold', hash2(seed, sx, rz - 2));
  bp.chest(sx + 3, y0 + 1, rz + 2, 2, 'stronghold', hash2(seed, sx, rz + 2));
  bp.set(sx, y0 + 1, rz, B.crafting_table); bp.set(sx - 2, y0 + 1, rz + 3, B.furnace, 0);
  bp.set(sx + 3, y0 + 3, rz, B.torch, 4);

  // --- Couloir nord + escalier vers la surface (repère)
  corridor(cx, rz - 6, cx, rz - 16);
  const tz = rz - 21;
  bp.room(cx - 4, y0, tz - 4, cx + 4, y0 + 5, tz + 4, sb);
  bp.fill(cx - 1, y0 + 1, tz + 4, cx + 1, y0 + 3, tz + 4, B.air);
  bp.spawner(cx, y0 + 1, tz, 'skeleton');
  bp.chest(cx + 3, y0 + 1, tz - 3, 2, 'stronghold', hash2(seed, cx, tz));
  bp.set(cx - 3, y0 + 3, tz, B.torch, 3);

  bp.zones.push({ x0: bp.minX, y0: y0, z0: bp.minZ, x1: bp.maxX, y1: y0 + 9, z1: bp.maxZ, type: 'stronghold' });
  bp.portalCenter = { x: cx, y: y0 + 4, z: cz + 3 };
  return bp;
}

// ================= Village =================
export function buildVillage(seed, vx, vz, surf) {
  const bp = new Blueprint('village');
  const rng = new RNG(hash2(seed, vx, vz) ^ 0x7777);
  const center = surf(vx, vz);
  const desert = center.biome === 6;
  const snowy = center.biome === 5;
  const wall = desert ? B.sandstone : B.oak_planks;
  const corner = desert ? B.sandstone : snowy ? B.spruce_log : B.oak_log;
  const floorB = desert ? B.sandstone : B.cobblestone;
  const roofB = desert ? B.sandstone : snowy ? B.spruce_planks : B.oak_planks;
  const pathB = desert ? B.sandstone : B.dirt_path;

  const groundAt = (x, z) => surf(x, z).h;
  // Chemin suivant le terrain
  const path = (x, z) => {
    const s = surf(x, z);
    if (s.h < 62) { bp.set(x, 62, z, B.oak_planks); return; }
    bp.set(x, s.h, z, pathB);
    for (let y = s.h + 1; y <= s.h + 3; y++) bp.set(x, y, z, B.air);
  };

  // Puits central
  const wy = groundAt(vx, vz);
  bp.fill(vx - 2, wy - 3, vz - 2, vx + 2, wy, vz + 2, B.cobblestone);
  bp.fill(vx - 1, wy - 2, vz - 1, vx + 1, wy, vz + 1, B.water);
  bp.fill(vx - 2, wy + 1, vz - 2, vx + 2, wy + 4, vz + 2, B.air);
  for (const [dx, dz] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) bp.fill(vx + dx, wy + 1, vz + dz, vx + dx, wy + 3, vz + dz, B.oak_fence);
  bp.fill(vx - 2, wy + 4, vz - 2, vx + 2, wy + 4, vz + 2, B.cobblestone);
  bp.set(vx, wy + 5, vz, B.torch, 0);

  // Routes
  const arms = [];
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const len = 14 + rng.int(14);
    arms.push({ dx, dz, len });
    for (let s = 3; s <= len; s++) for (let w = -1; w <= 1; w++) path(vx + dx * s + (dz ? w : 0), vz + dz * s + (dx ? w : 0));
  }

  const houses = [];
  const house = (hx, hz, w, d, facing, kind) => {
    // Sol au niveau médian du terrain
    const fy = groundAt(hx + (w >> 1), hz + (d >> 1));
    const x0 = hx, z0 = hz, x1 = hx + w - 1, z1 = hz + d - 1;
    // fondations
    for (let x = x0; x <= x1; x++)
      for (let z = z0; z <= z1; z++) {
        const g = groundAt(x, z);
        for (let y = Math.min(g, fy) - 1; y < fy; y++) bp.set(x, y, z, B.cobblestone);
        for (let y = fy + 1; y <= fy + 8; y++) bp.set(x, y, z, B.air);
      }
    bp.fill(x0, fy, z0, x1, fy, z1, floorB);
    const H = 4;
    for (let y = fy + 1; y <= fy + H; y++)
      for (let x = x0; x <= x1; x++)
        for (let z = z0; z <= z1; z++) {
          const edgeX = x === x0 || x === x1, edgeZ = z === z0 || z === z1;
          if (!edgeX && !edgeZ) continue;
          const isCorner = edgeX && edgeZ;
          let id = isCorner ? corner : wall;
          if (!isCorner && y === fy + 2 && ((edgeX && (z - z0) % 2 === 0) || (edgeZ && (x - x0) % 2 === 0))) id = B.glass_pane;
          bp.set(x, y, z, id);
        }
    // toit
    for (let x = x0 - 1; x <= x1 + 1; x++) for (let z = z0 - 1; z <= z1 + 1; z++) bp.set(x, fy + H + 1, z, roofB);
    if (!desert) for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if (x > x0 && x < x1 && z > z0 && z < z1) bp.set(x, fy + H + 2, z, roofB);
    // porte (face vers la route)
    let dxp, dzp, dm;
    if (facing === 0) { dxp = hx + (w >> 1); dzp = z0; dm = 0; }
    else if (facing === 1) { dxp = hx + (w >> 1); dzp = z1; dm = 1; }
    else if (facing === 2) { dxp = x0; dzp = hz + (d >> 1); dm = 2; }
    else { dxp = x1; dzp = hz + (d >> 1); dm = 3; }
    bp.set(dxp, fy + 1, dzp, B.oak_door, dm);
    bp.set(dxp, fy + 2, dzp, B.oak_door, dm | 8);
    // intérieur
    const ix = x0 + 1 + rng.int(Math.max(1, w - 2)), iz = z0 + 1 + rng.int(Math.max(1, d - 2));
    bp.set(x0 + 1, fy + 3, z0 + 1, B.torch, 0);
    if (kind === 'smith') {
      bp.set(x1 - 1, fy + 1, z1 - 1, B.furnace, 2);
      bp.set(x1 - 1, fy + 1, z0 + 1, B.lava, 0);
      bp.chest(x0 + 1, fy + 1, z1 - 1, 3, 'blacksmith', hash2(seed, x0, z0));
      bp.set(x1 - 2, fy + 1, z1 - 1, B.crafting_table);
    } else if (kind === 'library') {
      for (let x = x0 + 1; x < x1; x++) { bp.set(x, fy + 1, z1 - 1, B.bookshelf); }
      bp.set(x0 + 1, fy + 1, z0 + 1, B.crafting_table);
    } else if (kind === 'church') {
      bp.set(x1 - 1, fy + 1, z1 - 1, B.brewing_stand);
    } else {
      if (rng.chance(0.6)) bp.chest(x1 - 1, fy + 1, z1 - 1, 2, 'village', hash2(seed, x1, z1));
      bp.set(x0 + 1, fy + 1, z1 - 1, B.crafting_table);
      // lit (2 blocs, orienté N-S)
      bp.set(x1 - 1, fy + 1, z0 + 1, B.bed, 0 | 4);
      bp.set(x1 - 1, fy + 1, z0 + 2, B.bed, 0);
    }
    void ix; void iz;
    houses.push({ x: hx + (w >> 1), y: fy + 1, z: hz + (d >> 1), kind });
  };

  const farm = (fx, fz) => {
    const fy = groundAt(fx + 3, fz + 4);
    for (let x = fx; x < fx + 7; x++)
      for (let z = fz; z < fz + 9; z++) {
        for (let y = fy + 1; y <= fy + 3; y++) bp.set(x, y, z, B.air);
        const edge = x === fx || x === fx + 6 || z === fz || z === fz + 8;
        if (edge) bp.set(x, fy, z, B.oak_log, 0);
        else if (x === fx + 3) bp.set(x, fy, z, B.water);
        else { bp.set(x, fy, z, B.farmland, 1); bp.set(x, fy + 1, z, B.wheat, 3 + rng.int(5)); }
        bp.set(x, fy - 1, z, B.dirt);
      }
  };

  const kinds = ['house', 'house', 'smith', 'library', 'house', 'church', 'house', 'farm', 'farm'];
  let ki = 0;
  for (const arm of arms) {
    for (let s = 6; s < arm.len - 3; s += 10) {
      for (const side of [-1, 1]) {
        if (rng.chance(0.25)) continue;
        const kind = kinds[ki++ % kinds.length];
        const off = 3;
        if (arm.dx) {
          const hx = vx + arm.dx * s - 2;
          if (kind === 'farm') { farm(hx - 1, side > 0 ? vz + off : vz - off - 8); continue; }
          const d = kind === 'library' || kind === 'smith' ? 7 : 5;
          const hz = side > 0 ? vz + off : vz - off - d + 1;
          house(hx, hz, kind === 'library' ? 7 : 5, d, side > 0 ? 0 : 1, kind);
        } else {
          const hz = vz + arm.dz * s - 2;
          if (kind === 'farm') { farm(side > 0 ? vx + off : vx - off - 6, hz - 1); continue; }
          const w = kind === 'library' || kind === 'smith' ? 7 : 5;
          const hx = side > 0 ? vx + off : vx - off - w + 1;
          house(hx, hz, w, kind === 'library' ? 7 : 5, side > 0 ? 2 : 3, kind);
        }
      }
    }
  }
  // Villageois
  const profs = { house: 'farmer', smith: 'armorer', library: 'librarian', church: 'cleric' };
  houses.forEach((h, i) => {
    bp.entity('villager', h.x, h.y, h.z, { profession: profs[h.kind] || (i % 2 ? 'farmer' : 'toolsmith') });
  });
  bp.entity('villager', vx + 3, wy + 1, vz, { profession: 'cleric' });
  bp.entity('iron_golem', vx - 3, wy + 1, vz + 3, {});
  bp.zones.push({ x0: bp.minX, y0: 0, z0: bp.minZ, x1: bp.maxX, y1: 127, z1: bp.maxZ, type: 'village' });
  bp.center = { x: vx, y: wy, z: vz };
  return bp;
}

// ================= Donjon (dans un seul chunk) =================
export function buildDungeon(chunk, rng) {
  const lx = 4 + Math.floor(rng() * 8), lz = 4 + Math.floor(rng() * 8), y = 12 + Math.floor(rng() * 36);
  const ox = chunk.cx * 16, oz = chunk.cz * 16;
  // vérifie que la zone est bien souterraine
  const idxTop = ((y + 6) << 8) | (lz << 4) | lx;
  if (chunk.blocks[idxTop] === B.air || chunk.blocks[idxTop] === B.water) return;
  for (let dx = -3; dx <= 3; dx++)
    for (let dz = -3; dz <= 3; dz++)
      for (let dy = -1; dy <= 4; dy++) {
        const x = lx + dx, z = lz + dz, yy = y + dy;
        const i = (yy << 8) | (z << 4) | x;
        const edge = Math.abs(dx) === 3 || Math.abs(dz) === 3 || dy === -1 || dy === 4;
        if (edge) {
          if (chunk.blocks[i] !== B.air || dy === -1) chunk.blocks[i] = dy === -1 && rng() < 0.6 ? B.mossy_cobblestone : rng() < 0.3 ? B.mossy_cobblestone : B.cobblestone;
        } else chunk.blocks[i] = B.air;
        chunk.meta[i] = 0;
      }
  const mobs = ['zombie', 'zombie', 'skeleton', 'spider'];
  const si = (y << 8) | (lz << 4) | lx;
  chunk.blocks[si] = B.spawner;
  chunk.blockEntities.set(si, { type: 'spawner', mob: mobs[Math.floor(rng() * mobs.length)], delay: 200 });
  const nChests = 1 + (rng() < 0.5 ? 1 : 0);
  const spots = [[lx - 2, lz], [lx + 2, lz], [lx, lz - 2], [lx, lz + 2]];
  for (let c = 0; c < nChests; c++) {
    const [cx, cz] = spots[Math.floor(rng() * 4)];
    const ci = (y << 8) | (cz << 4) | cx;
    if (chunk.blocks[ci] === B.chest) continue;
    chunk.blocks[ci] = B.chest; chunk.meta[ci] = Math.floor(rng() * 4);
    chunk.blockEntities.set(ci, { type: 'chest', items: rollLoot('dungeon', hash2(ox + cx, y, oz + cz)) });
  }
}

// ================= L'End : piliers et fontaine =================
export function endPillars(seed) {
  const rng = new RNG(seed ^ 0xe4d);
  const heights = [];
  for (let i = 0; i < 10; i++) heights.push(76 + i * 3);
  for (let i = heights.length - 1; i > 0; i--) { const j = rng.int(i + 1); [heights[i], heights[j]] = [heights[j], heights[i]]; }
  const pillars = [];
  for (let i = 0; i < 10; i++) {
    const a = 2 * (-Math.PI + (Math.PI / 10) * i);
    const x = Math.floor(42 * Math.cos(a)), z = Math.floor(42 * Math.sin(a));
    const h = Math.min(120, heights[i] - 6);
    const r = 2 + Math.floor((heights[i] - 76) / 3 / 3);
    pillars.push({ x, z, h, r, caged: heights[i] === 76 + 6 || heights[i] === 76 + 9 });
  }
  return pillars;
}

export function buildEndStructures(seed, fountainY) {
  const bp = new Blueprint('end');
  for (const p of endPillars(seed)) {
    for (let y = 40; y <= p.h; y++)
      for (let dx = -p.r; dx <= p.r; dx++)
        for (let dz = -p.r; dz <= p.r; dz++)
          if (dx * dx + dz * dz <= p.r * p.r + 1) bp.set(p.x + dx, y, p.z + dz, B.obsidian);
    bp.set(p.x, p.h + 1, p.z, B.bedrock);
    bp.set(p.x, p.h + 2, p.z, B.fire);
    if (p.caged) {
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++)
          for (let dy = 0; dy <= 3; dy++) {
            const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2 || dy === 3;
            if (edge) bp.set(p.x + dx, p.h + 1 + dy, p.z + dz, B.iron_bars);
          }
    }
  }
  // Fontaine (portail de sortie inactif)
  const fy = fountainY;
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++) {
      const d2 = dx * dx + dz * dz;
      for (let y = fy + 1; y <= fy + 6; y++) if (d2 <= 20) bp.set(dx, y, dz, B.air);
      if (d2 <= 12.25) bp.set(dx, fy, dz, B.bedrock);
      if (d2 > 6.25 && d2 <= 12.25) bp.set(dx, fy + 1, dz, B.bedrock);
    }
  for (let y = fy + 1; y <= fy + 4; y++) bp.set(0, y, 0, B.bedrock);
  bp.set(1, fy + 3, 0, B.torch, 3); bp.set(-1, fy + 3, 0, B.torch, 4);
  bp.set(0, fy + 3, 1, B.torch, 1); bp.set(0, fy + 3, -1, B.torch, 2);
  return bp;
}

export function exitPortalCells() {
  const r = [];
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (dx * dx + dz * dz <= 6.25 && (dx || dz)) r.push([dx, dz]);
  return r;
}
