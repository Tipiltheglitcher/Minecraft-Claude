// Apparition naturelle des créatures
import { SOLID, BLOCKS, OPAQUE } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { ST_LIT } from '../world/chunk.js';

const rnd = Math.random;

const TABLES = {
  overworld_night: [['zombie', 100, 1, 4], ['skeleton', 90, 1, 3], ['spider', 90, 1, 2], ['creeper', 90, 1, 2], ['enderman', 20, 1, 2]],
  overworld_cave: [['zombie', 100, 1, 3], ['skeleton', 100, 1, 3], ['spider', 80, 1, 2], ['creeper', 90, 1, 2], ['enderman', 12, 1, 1]],
  passive: [['pig', 10, 2, 3], ['cow', 8, 2, 3], ['sheep', 12, 2, 3], ['chicken', 10, 2, 3]],
  nether: [['piglin', 100, 2, 4], ['ghast', 25, 1, 1], ['magma_cube', 15, 1, 2]],
  fortress: [['blaze', 60, 1, 3], ['wither_skeleton', 40, 1, 2], ['piglin', 20, 1, 2], ['magma_cube', 10, 1, 1]],
  end: [['enderman', 100, 1, 4]],
};

function pick(table) {
  const total = table.reduce((s, e) => s + e[1], 0);
  let r = rnd() * total;
  for (const e of table) { r -= e[1]; if (r <= 0) return e; }
  return table[0];
}

function heightOf(type) {
  return type === 'enderman' ? 3 : type === 'ghast' ? 4 : type === 'spider' ? 1 : 2;
}

function widthOf(type) {
  return type === 'ghast' ? 4 : type === 'spider' ? 2 : 1;
}

function spaceFree(world, x, y, z, type) {
  const h = heightOf(type), w = widthOf(type);
  for (let dx = 0; dx < w; dx++)
    for (let dz = 0; dz < w; dz++)
      for (let dy = 0; dy < h; dy++) {
        const id = world.getBlock(x + dx, y + dy, z + dz);
        if (SOLID[id] || (id && BLOCKS[id].liquid)) return false;
      }
  return true;
}

export class Spawner {
  constructor(game) {
    this.game = game;
    this.timer = 0;
  }

  tick() {
    const game = this.game;
    const world = game.world;
    const p = game.player;
    if (!p || p.dead || !game.settings.doMobSpawning) return;
    if (++this.timer % 10 !== 0) return;
    const diff = game.settings.difficulty;
    const dim = world.dim;
    const hostileCount = world.countEntities((e) => e.hostile && !e.dead);
    const passiveCount = world.countEntities((e) => ['pig', 'cow', 'sheep', 'chicken'].includes(e.type));
    const hostileCap = dim === 'overworld' ? 35 : dim === 'nether' ? 30 : 20;
    for (let attempt = 0; attempt < 3; attempt++) {
      // position aléatoire autour du joueur
      const ang = rnd() * Math.PI * 2;
      const dist = 24 + rnd() * 72;
      const x = Math.floor(p.x + Math.cos(ang) * dist), z = Math.floor(p.z + Math.sin(ang) * dist);
      const c = world.getChunk(x >> 4, z >> 4);
      if (!c || c.state < ST_LIT) continue;
      if (dim === 'overworld') {
        // passifs rares
        if (passiveCount < 12 && rnd() < 0.02) {
          const y = c.topY(x & 15, z & 15);
          if (world.getBlock(x, y, z) === B.grass_block && world.getLight(x, y + 1, z) >= 9 && spaceFree(world, x, y + 1, z, 'pig')) {
            this.spawnGroup(world, pick(TABLES.passive), x, y + 1, z);
          }
          continue;
        }
        if (diff === 0 || hostileCount >= hostileCap) continue;
        // surface la nuit ou grotte
        const top = c.topY(x & 15, z & 15);
        let y;
        if (rnd() < 0.5) y = top + 1;
        else y = 1 + Math.floor(rnd() * Math.max(1, top));
        // descendre jusqu'au sol
        while (y > 1 && !SOLID[world.getBlock(x, y - 1, z)]) y--;
        const below = world.getBlock(x, y - 1, z);
        if (!OPAQUE[below] || below === B.bedrock || below === B.glass) continue;
        if (!spaceFree(world, x, y, z, 'zombie')) continue;
        if (world.getBlockLight(x, y, z) > 0) continue;
        const light = world.getLight(x, y, z);
        if (light > 7 * rnd()) continue;
        const cave = world.getSky(x, y, z) < 8;
        const e = pick(cave ? TABLES.overworld_cave : TABLES.overworld_night);
        if (p.distanceSq(x, y, z) < 24 * 24) continue;
        this.spawnGroup(world, e, x, y, z);
      } else if (dim === 'nether') {
        if (diff === 0 || hostileCount >= hostileCap) continue;
        let y = 10 + Math.floor(rnd() * 100);
        while (y > 1 && !SOLID[world.getBlock(x, y - 1, z)]) y--;
        const below = world.getBlock(x, y - 1, z);
        if (!SOLID[below] || below === B.bedrock) continue;
        const inFortress = world.gen.structuresAt && world.gen.structuresAt(x, y, z).includes('fortress');
        const e = pick(inFortress ? TABLES.fortress : TABLES.nether);
        if (e[0] === 'ghast') {
          y += 3;
          if (world.countEntities((o) => o.type === 'ghast') >= 5) continue;
        }
        if (!spaceFree(world, x, y, z, e[0])) continue;
        this.spawnGroup(world, e, x, y, z);
      } else if (dim === 'end') {
        if (diff === 0 || hostileCount >= hostileCap) continue;
        const y = c.topY(x & 15, z & 15) + 1;
        if (world.getBlock(x, y - 1, z) !== B.end_stone) continue;
        if (!spaceFree(world, x, y, z, 'enderman')) continue;
        this.spawnGroup(world, pick(TABLES.end), x, y, z);
      }
    }
  }

  spawnGroup(world, e, x, y, z) {
    const [type, , min, max] = e;
    const n = min + Math.floor(rnd() * (max - min + 1));
    for (let i = 0; i < n; i++) {
      const sx = x + (i ? Math.floor(rnd() * 5) - 2 : 0), sz = z + (i ? Math.floor(rnd() * 5) - 2 : 0);
      let sy = y;
      if (i) {
        while (sy > 1 && !SOLID[world.getBlock(sx, sy - 1, sz)]) sy--;
        if (!spaceFree(world, sx, sy, sz, type) || !SOLID[world.getBlock(sx, sy - 1, sz)]) continue;
      }
      world.spawn(type, sx + 0.5, sy, sz + 0.5);
    }
  }
}
