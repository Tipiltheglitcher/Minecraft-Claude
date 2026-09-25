// Générateur du Nether
import { Simplex, RNG, mulberry32, hash2 } from '../../core/noise.js';
import { B } from '../../data/ids.js';
import { buildFortress } from './structures.js';
import { oreVein } from './features.js';
import { trilerp, BI } from './overworld.js';

const GX = 5, GY = 33, GZ = 5;
export const NETHER_LAVA = 31;

export class NetherGen {
  constructor(seed) {
    this.seed = seed;
    this.n1 = new Simplex(seed ^ 0x3e1);
    this.n2 = new Simplex(seed ^ 0x3e2);
    this.n3 = new Simplex(seed ^ 0x3e3);
    this.nPatch = new Simplex(seed ^ 0x3e4);
    this.grid = new Float32Array(GX * GY * GZ);
    this.fortresses = new Map();
  }

  density(x, y, z) {
    let d = this.n1.fbm3(x / 90, y / 45, z / 90, 3) * 1.1 + this.n2.noise3(x / 24, y / 18, z / 24) * 0.35;
    if (y < 34) d += (34 - y) / 9;
    if (y > 94) d += (y - 94) / 7;
    return d - 0.05;
  }

  fortressFor(rx, rz) {
    const key = rx * 100000 + rz;
    if (this.fortresses.has(key)) return this.fortresses.get(key);
    const rng = new RNG(hash2(this.seed ^ 0xf07, rx, rz));
    let f = null;
    if (rx === 0 && rz === 0) {
      const a = rng.float() * Math.PI * 2, d = 45 + rng.int(40);
      f = buildFortress(this.seed, Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d));
    } else if (rng.chance(0.6)) {
      f = buildFortress(this.seed, rx * 176 + 60 + rng.int(56), rz * 176 + 60 + rng.int(56));
    }
    this.fortresses.set(key, f);
    return f;
  }

  fortressesNear(x0, z0, x1, z1) {
    const r = [];
    // la région (0,0) couvre l'origine ; les forteresses font ~110 blocs de large
    for (let rx = Math.floor((x0 - 110) / 176); rx <= Math.floor((x1 + 110) / 176); rx++)
      for (let rz = Math.floor((z0 - 110) / 176); rz <= Math.floor((z1 + 110) / 176); rz++) {
        const f = this.fortressFor(rx, rz);
        if (f) r.push(f);
      }
    return r;
  }

  structuresAt(x, y, z) {
    const r = [];
    for (const f of this.fortressesNear(x, z, x, z))
      for (const zn of f.zones) if (x >= zn.x0 && x <= zn.x1 && y >= zn.y0 && y <= zn.y1 && z >= zn.z0 && z <= zn.z1) r.push(zn.type);
    return r;
  }

  generate(chunk) {
    const { cx, cz } = chunk;
    const ox = cx * 16, oz = cz * 16;
    const g = this.grid;
    for (let ix = 0; ix < GX; ix++)
      for (let iz = 0; iz < GZ; iz++)
        for (let iy = 0; iy < GY; iy++) g[(ix * GZ + iz) * GY + iy] = this.density(ox + ix * 4, iy * 4, oz + iz * 4);
    const blocks = chunk.blocks;
    const seed = this.seed;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz;
        const gx = lx >> 2, gz = lz >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4;
        const patch = this.nPatch.noise2(x / 20, z / 20);
        chunk.biome[lz * 16 + lx] = BI.NETHER;
        for (let y = 0; y < 128; y++) {
          const idx = (y << 8) | (lz << 4) | lx;
          if (y === 0 || y === 127 || (y < 5 && (hash2(seed, x * 7 + y, z) & 7) < 5 - y) || (y > 122 && (hash2(seed, x * 7 + y, z) & 7) < y - 122)) {
            blocks[idx] = B.bedrock;
            continue;
          }
          const gy = y >> 2, fy = (y & 3) / 4;
          const i000 = (gx * GZ + gz) * GY + gy;
          const d = trilerp(
            g[i000], g[i000 + GZ * GY], g[i000 + 1], g[i000 + GZ * GY + 1],
            g[i000 + GY], g[i000 + GZ * GY + GY], g[i000 + GY + 1], g[i000 + GZ * GY + GY + 1],
            fx, fy, fz,
          );
          if (d > 0) blocks[idx] = B.netherrack;
          else blocks[idx] = y <= NETHER_LAVA ? B.lava : B.air;
        }
        // surfaces : sable des âmes / gravier près de la lave
        for (let y = 26; y < 40; y++) {
          const idx = (y << 8) | (lz << 4) | lx;
          if (blocks[idx] === B.netherrack && blocks[idx + 256] === B.air) {
            if (patch > 0.45) { blocks[idx] = B.soul_sand; if (blocks[idx - 256] === B.netherrack) blocks[idx - 256] = B.soul_sand; }
            else if (patch < -0.55) blocks[idx] = B.gravel;
          }
        }
      }
    const rng = mulberry32(hash2(seed ^ 0x1e7, cx, cz));
    // Minerais de quartz, magma
    for (let t = 0; t < 14; t++) oreVein(chunk, Math.floor(rng() * 16), 10 + Math.floor(rng() * 108), Math.floor(rng() * 16), B.nether_quartz_ore, 7, rng, B.netherrack);
    for (let t = 0; t < 4; t++) oreVein(chunk, Math.floor(rng() * 16), 27 + Math.floor(rng() * 10), Math.floor(rng() * 16), B.magma_block, 10, rng, B.netherrack);
    for (let t = 0; t < 2; t++) oreVein(chunk, Math.floor(rng() * 16), 5 + Math.floor(rng() * 110), Math.floor(rng() * 16), B.gold_ore, 5, rng, B.netherrack);
    // Pierre lumineuse suspendue
    for (let t = 0; t < 10; t++) {
      const lx = 2 + Math.floor(rng() * 12), lz = 2 + Math.floor(rng() * 12);
      for (let y = 118; y > 50; y--) {
        const idx = (y << 8) | (lz << 4) | lx;
        if (blocks[idx] === B.netherrack && blocks[idx - 256] === B.air) {
          let x = lx, z = lz, yy = y - 1;
          for (let k = 0; k < 18; k++) {
            if (x >= 0 && x < 16 && z >= 0 && z < 16 && yy > 1) {
              const i2 = (yy << 8) | (z << 4) | x;
              if (blocks[i2] === B.air) blocks[i2] = B.glowstone;
            }
            const d = Math.floor(rng() * 5);
            if (d === 0) x++; else if (d === 1) x--; else if (d === 2) z++; else if (d === 3) z--; else yy--;
          }
          break;
        }
        if (rng() < 0.02) break;
      }
    }
    // Feu et champignons
    for (let t = 0; t < 8; t++) {
      const lx = Math.floor(rng() * 16), lz = Math.floor(rng() * 16);
      const y = 32 + Math.floor(rng() * 80);
      const idx = (y << 8) | (lz << 4) | lx;
      if (blocks[idx] === B.netherrack && blocks[idx + 256] === B.air) blocks[idx + 256] = rng() < 0.5 ? B.fire : rng() < 0.5 ? B.brown_mushroom : B.red_mushroom;
    }
    // Chutes de lave
    if (rng() < 0.5) {
      const lx = 1 + Math.floor(rng() * 14), lz = 1 + Math.floor(rng() * 14), y = 40 + Math.floor(rng() * 70);
      const idx = (y << 8) | (lz << 4) | lx;
      if (blocks[idx] === B.netherrack && blocks[idx - 256] === B.netherrack) {
        const open = [idx - 1, idx + 1, idx - 16, idx + 16].filter((i) => blocks[i] === B.air).length;
        if (open === 1) blocks[idx] = B.lava;
      }
    }
    // Forteresses
    for (const f of this.fortressesNear(ox, oz, ox + 15, oz + 15)) if (f.intersectsChunk(cx, cz)) f.applyTo(chunk);
  }

  findSpawn() {
    return { x: 0.5, y: 64, z: 0.5 };
  }
}
