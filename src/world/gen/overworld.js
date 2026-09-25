// Générateur de la Surface (Overworld)
import { Simplex, RNG, mulberry32, hash2 } from '../../core/noise.js';
import { clamp, lerp, smoothstep } from '../../core/math.js';
import { B } from '../../data/ids.js';
import { SEA } from '../../core/constants.js';
import { makeWriter, oakTree, spruceTree, birchTree, cactus, oreVein } from './features.js';
import { buildStronghold, buildVillage, buildDungeon } from './structures.js';

export const BI = {
  OCEAN: 0, PLAINS: 1, FOREST: 2, BIRCH: 3, TAIGA: 4, SNOWY: 5, DESERT: 6, MOUNTAINS: 7, BEACH: 8,
  FROZEN_OCEAN: 9, SWAMP: 10, RIVER: 11, SNOWY_TAIGA: 12, NETHER: 20, END: 30,
};
export const BIOME_NAMES = {
  0: 'Océan', 1: 'Plaines', 2: 'Forêt', 3: 'Forêt de bouleaux', 4: 'Taïga', 5: 'Plaines enneigées', 6: 'Désert',
  7: 'Montagnes', 8: 'Plage', 9: 'Océan gelé', 10: 'Marais', 11: 'Rivière', 12: 'Taïga enneigée', 20: 'Désolation du Nether', 30: 'L\'End',
};
export const SNOWY_BIOMES = new Set([BI.SNOWY, BI.SNOWY_TAIGA, BI.FROZEN_OCEAN]);
export const DRY_BIOMES = new Set([BI.DESERT]);

// Grille d'interpolation des grottes
const GX = 5, GY = 33, GZ = 5;

export class OverworldGen {
  constructor(seed) {
    this.seed = seed;
    this.nCont = new Simplex(seed ^ 0x1001);
    this.nEro = new Simplex(seed ^ 0x2002);
    this.nPv = new Simplex(seed ^ 0x3003);
    this.nDet = new Simplex(seed ^ 0x4004);
    this.nTemp = new Simplex(seed ^ 0x5005);
    this.nHum = new Simplex(seed ^ 0x6006);
    this.nRidge = new Simplex(seed ^ 0x7007);
    this.nRiver = new Simplex(seed ^ 0x8008);
    this.nC1 = new Simplex(seed ^ 0x9009);
    this.nC2 = new Simplex(seed ^ 0xa00a);
    this.nC3 = new Simplex(seed ^ 0xb00b);
    this.nMisc = new Simplex(seed ^ 0xc00c);
    this.colCache = new Map();
    this.villages = new Map();
    this._stronghold = null;
    this.caveGrid = new Float32Array(GX * GY * GZ);
  }

  get stronghold() {
    if (!this._stronghold) this._stronghold = buildStronghold(this.seed);
    return this._stronghold;
  }

  // ---------- Colonne (déterministe) ----------
  column(x, z) {
    const key = (x + 1048576) * 2097152 + (z + 1048576);
    let c = this.colCache.get(key);
    if (c) return c;
    if (this.colCache.size > 120000) this.colCache.clear();
    const cont = clamp(this.nCont.fbm2(x / 800, z / 800, 4) * 1.6 + 0.12, -1, 1);
    const ero = this.nEro.fbm2(x / 450 + 100, z / 450, 3) * 1.4;
    const pv = this.nPv.fbm2(x / 160, z / 160, 4);
    const det = this.nDet.fbm2(x / 45, z / 45, 3);
    let temp = this.nTemp.fbm2(x / 650, z / 650, 3) * 1.5;
    const hum = this.nHum.fbm2(x / 520, z / 520, 3) * 1.5;
    const landness = smoothstep(-0.3, -0.1, cont);
    const oceanH = 40 + (cont + 1) * 22 + det * 3;
    const landH = 64 + Math.max(0, cont + 0.1) * 12 + pv * 5 + det * 2.5;
    const mtn = smoothstep(0.1, 0.5, ero) * smoothstep(-0.05, 0.25, cont);
    const rn = this.nRidge.fbm2(x / 260, z / 260, 4);
    const ridge = 1 - Math.abs(rn);
    const mtnH = mtn * (ridge * ridge * ridge * 58 + pv * 6 + 4);
    let h = lerp(oceanH, landH, landness) + mtnH * landness;
    const sw = smoothstep(0.35, 0.55, hum) * smoothstep(-0.25, -0.05, temp) * (1 - mtn) * landness;
    h = lerp(h, 62.2 + det * 2, sw);
    const rv = Math.abs(this.nRiver.fbm2(x / 380, z / 380, 3));
    const river = (1 - smoothstep(0.012, 0.045, rv)) * landness * (1 - smoothstep(0.15, 0.45, mtn));
    if (river > 0) h = lerp(h, 57 + det * 2, river);
    h = Math.round(clamp(h, 4, 123));
    temp -= Math.max(0, h - 85) * 0.015;

    let biome;
    if (river > 0.55 && h < SEA) biome = BI.RIVER;
    else if (h < SEA - 1) biome = temp < -0.45 ? BI.FROZEN_OCEAN : BI.OCEAN;
    else if (h <= SEA + 2 && landness < 0.97 && mtn < 0.25 && sw < 0.5) biome = BI.BEACH;
    else if (mtn > 0.35 && h > 84) biome = BI.MOUNTAINS;
    else if (sw > 0.5) biome = BI.SWAMP;
    else if (temp < -0.42) biome = hum > 0 ? BI.SNOWY_TAIGA : BI.SNOWY;
    else if (temp > 0.42 && hum < 0.05) biome = BI.DESERT;
    else if (temp < -0.1) biome = BI.TAIGA;
    else if (hum > 0.1) biome = temp > 0.2 && hum < 0.4 ? BI.BIRCH : BI.FOREST;
    else biome = BI.PLAINS;

    c = { h, biome, temp, hum, mtn, sw, det };
    this.colCache.set(key, c);
    return c;
  }

  // Bloc de surface d'une colonne
  surfaceTop(x, z, c) {
    const b = c.biome;
    if (b === BI.OCEAN || b === BI.FROZEN_OCEAN || b === BI.RIVER) {
      const n = this.nMisc.noise2(x / 12, z / 12);
      if (c.h < 54) return n > 0.5 ? B.clay : B.gravel;
      return n > 0.6 ? B.clay : n < -0.5 ? B.gravel : B.sand;
    }
    if (b === BI.BEACH || b === BI.DESERT) return B.sand;
    if (b === BI.MOUNTAINS) {
      const s = Math.max(
        Math.abs(this.column(x + 1, z).h - this.column(x - 1, z).h),
        Math.abs(this.column(x, z + 1).h - this.column(x, z - 1).h),
      );
      if (c.h > 108) return B.snow_block;
      if (s >= 4 || c.h > 100) return B.stone;
      return B.grass_block;
    }
    if (c.h < SEA) return B.dirt;
    return B.grass_block;
  }

  // ---------- Grottes (densité interpolée) ----------
  caveSample(x, y, z) {
    const n1 = this.nC1.noise3(x / 42, y / 26, z / 42);
    const n2 = this.nC2.noise3(x / 42 + 50, y / 26, z / 42 + 50);
    const sp = n1 * n1 + n2 * n2 - 0.006;
    let d = sp / 0.006;
    if (y < 48) {
      const n3 = this.nC3.noise3(x / 90, y / 40, z / 90);
      const ch = (0.62 - n3) / 0.12;
      if (ch < d) d = ch;
    }
    return d;
  }

  caveGridFill(cx, cz) {
    const g = this.caveGrid;
    const ox = cx * 16, oz = cz * 16;
    for (let ix = 0; ix < GX; ix++)
      for (let iz = 0; iz < GZ; iz++)
        for (let iy = 0; iy < GY; iy++) g[(ix * GZ + iz) * GY + iy] = this.caveSample(ox + ix * 4, iy * 4, oz + iz * 4);
  }

  // Évaluation ponctuelle identique à l'interpolation de chunk
  caveAt(x, y, z) {
    const x0 = Math.floor(x / 4) * 4, y0 = Math.floor(y / 4) * 4, z0 = Math.floor(z / 4) * 4;
    const fx = (x - x0) / 4, fy = (y - y0) / 4, fz = (z - z0) / 4;
    const c000 = this.caveSample(x0, y0, z0), c100 = this.caveSample(x0 + 4, y0, z0);
    const c010 = this.caveSample(x0, y0 + 4, z0), c110 = this.caveSample(x0 + 4, y0 + 4, z0);
    const c001 = this.caveSample(x0, y0, z0 + 4), c101 = this.caveSample(x0 + 4, y0, z0 + 4);
    const c011 = this.caveSample(x0, y0 + 4, z0 + 4), c111 = this.caveSample(x0 + 4, y0 + 4, z0 + 4);
    return trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz);
  }

  canCarve(y, h, d) {
    if (y < 1) return false;
    if (h < SEA + 2 && y > h - 5) return false;
    if (y > h - 3) return d < -0.35;
    return d < 0;
  }

  surface(x, z) {
    const c = this.column(x, z);
    return { h: c.h, biome: c.biome, top: this.surfaceTop(x, z, c), temp: c.temp };
  }

  // ---------- Villages ----------
  villageFor(rx, rz) {
    const key = rx * 100000 + rz;
    if (this.villages.has(key)) return this.villages.get(key);
    let v = null;
    const rng = new RNG(hash2(this.seed ^ 0x1111, rx, rz));
    if (rng.chance(0.55)) {
      const vx = rx * 320 + 60 + rng.int(200), vz = rz * 320 + 60 + rng.int(200);
      const c = this.column(vx, vz);
      const ok = [BI.PLAINS, BI.DESERT, BI.SNOWY, BI.TAIGA].includes(c.biome) && c.h > SEA + 1 && c.h < 90;
      if (ok) {
        let flat = true;
        for (const [dx, dz] of [[20, 0], [-20, 0], [0, 20], [0, -20], [14, 14], [-14, -14]]) {
          const cc = this.column(vx + dx, vz + dz);
          if (Math.abs(cc.h - c.h) > 6 || cc.h < SEA) flat = false;
        }
        if (flat) v = buildVillage(this.seed, vx, vz, (x, z) => this.surface(x, z));
      }
    }
    this.villages.set(key, v);
    return v;
  }

  villagesNear(x0, z0, x1, z1) {
    const r = [];
    for (let rx = Math.floor((x0 - 80) / 320); rx <= Math.floor((x1 + 80) / 320); rx++)
      for (let rz = Math.floor((z0 - 80) / 320); rz <= Math.floor((z1 + 80) / 320); rz++) {
        const v = this.villageFor(rx, rz);
        if (v) r.push(v);
      }
    return r;
  }

  inVillage(x, z) {
    for (const v of this.villagesNear(x, z, x, z)) if (x >= v.minX - 2 && x <= v.maxX + 2 && z >= v.minZ - 2 && z <= v.maxZ + 2) return true;
    return false;
  }

  // Liste des structures (pour localiser/apparitions)
  structuresAt(x, y, z) {
    const r = [];
    const sh = this.stronghold;
    for (const zn of sh.zones) if (x >= zn.x0 && x <= zn.x1 && y >= zn.y0 && y <= zn.y1 && z >= zn.z0 && z <= zn.z1) r.push(zn.type);
    for (const v of this.villagesNear(x, z, x, z)) for (const zn of v.zones) if (x >= zn.x0 && x <= zn.x1 && z >= zn.z0 && z <= zn.z1) r.push(zn.type);
    return r;
  }

  // ---------- Génération d'un chunk ----------
  generate(chunk) {
    const { cx, cz } = chunk;
    const ox = cx * 16, oz = cz * 16;
    const blocks = chunk.blocks;
    const seed = this.seed;
    this.caveGridFill(cx, cz);
    const g = this.caveGrid;
    const cols = new Array(256);

    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const x = ox + lx, z = oz + lz;
        const c = this.column(x, z);
        cols[lz * 16 + lx] = c;
        const h = c.h;
        const top = this.surfaceTop(x, z, c);
        const b = c.biome;
        const deep = b === BI.DESERT ? 7 : b === BI.BEACH ? 5 : 4;
        const filler = top === B.sand ? B.sand : top === B.stone || top === B.snow_block ? B.stone : top === B.gravel ? B.gravel : top === B.clay ? B.clay : B.dirt;
        const snowy = SNOWY_BIOMES.has(b) || (b === BI.MOUNTAINS && h > 96) || (b === BI.TAIGA && h > 90);
        for (let y = 0; y <= Math.max(h, SEA); y++) {
          let id;
          if (y > h) id = y <= SEA ? B.water : B.air;
          else if (y === 0) id = B.bedrock;
          else if (y < 5 && (hash2(seed, x * 131 + y, z) & 7) < 5 - y) id = B.bedrock;
          else if (y === h) id = top;
          else if (y > h - deep) id = y > h - 4 ? filler : top === B.sand ? B.sandstone : filler === B.dirt ? B.dirt : B.stone;
          else id = B.stone;
          if (id === B.water && y === SEA && snowy && b !== BI.RIVER) id = B.ice;
          if (id === B.water && y === SEA && b === BI.FROZEN_OCEAN) id = B.ice;
          const idx = (y << 8) | (lz << 4) | lx;
          blocks[idx] = id;
          if (id === B.grass_block && snowy) chunk.meta[idx] = 1;
        }
        chunk.biome[lz * 16 + lx] = b;
        // teintes
        const ti = (lz * 16 + lx) * 6;
        const gc = grassColor(c.temp, c.hum, b);
        chunk.tint[ti] = gc[0]; chunk.tint[ti + 1] = gc[1]; chunk.tint[ti + 2] = gc[2];
        chunk.tint[ti + 3] = gc[0] * 0.82; chunk.tint[ti + 4] = gc[1] * 0.9; chunk.tint[ti + 5] = gc[2] * 0.55;
        // grottes (hauteur minimale des voisins pour ne pas percer sous l'eau)
        const gx = lx >> 2, gz = lz >> 2, fx = (lx & 3) / 4, fz = (lz & 3) / 4;
        const hmin = Math.min(h, this.column(x + 1, z).h, this.column(x - 1, z).h, this.column(x, z + 1).h, this.column(x, z - 1).h);
        const hc = hmin < SEA + 2 ? hmin : h;
        const maxY = Math.min(h, 125);
        for (let y = 1; y <= maxY; y++) {
          const gy = y >> 2, fy = (y & 3) / 4;
          const i000 = (gx * GZ + gz) * GY + gy;
          const d = trilerp(
            g[i000], g[i000 + GZ * GY], g[i000 + 1], g[i000 + GZ * GY + 1],
            g[i000 + GY], g[i000 + GZ * GY + GY], g[i000 + GY + 1], g[i000 + GZ * GY + GY + 1],
            fx, fy, fz,
          );
          if (this.canCarve(y, hc, d) && (hc === h || y <= hc - 5)) {
            const idx = (y << 8) | (lz << 4) | lx;
            const cur = blocks[idx];
            if (cur === B.water || cur === B.bedrock || cur === B.ice) continue;
            blocks[idx] = y <= 10 ? B.lava : B.air;
            chunk.meta[idx] = 0;
          }
        }
      }

    const rng = mulberry32(hash2(seed ^ 0x0e5, cx, cz));
    // ---- Minerais
    const ores = [
      [B.coal_ore, 18, 12, 5, 120], [B.iron_ore, 18, 8, 5, 64], [B.gold_ore, 3, 7, 5, 32], [B.redstone_ore, 7, 6, 5, 16],
      [B.diamond_ore, 2, 6, 3, 16], [B.lapis_ore, 2, 6, 5, 30], [B.dirt, 8, 24, 5, 100], [B.gravel, 6, 24, 5, 100],
      [B.granite, 5, 30, 5, 80], [B.diorite, 5, 30, 5, 80], [B.andesite, 5, 30, 5, 80],
    ];
    for (const [id, tries, size, y0, y1] of ores)
      for (let t = 0; t < tries; t++) oreVein(chunk, Math.floor(rng() * 16), y0 + Math.floor(rng() * (y1 - y0)), Math.floor(rng() * 16), id, size, rng);
    const cb = cols[8 * 16 + 8].biome;
    if (cb === BI.MOUNTAINS) for (let t = 0; t < 6; t++) oreVein(chunk, Math.floor(rng() * 16), 5 + Math.floor(rng() * 28), Math.floor(rng() * 16), B.emerald_ore, 1, rng);

    // ---- Donjons
    if (rng() < 0.14) buildDungeon(chunk, rng);

    // ---- Structures (fort, villages)
    const sh = this.stronghold;
    if (sh.intersectsChunk(cx, cz)) sh.applyTo(chunk);
    const vills = this.villagesNear(ox, oz, ox + 15, oz + 15);
    for (const v of vills) if (v.intersectsChunk(cx, cz)) v.applyTo(chunk);

    // ---- Arbres (voisinage 3x3 pour permettre le chevauchement)
    const put = makeWriter(chunk);
    for (let ncx = cx - 1; ncx <= cx + 1; ncx++)
      for (let ncz = cz - 1; ncz <= cz + 1; ncz++) this.treesFor(ncx, ncz, put);

    // ---- Végétation, neige
    const prng = mulberry32(hash2(seed ^ 0x9a9, cx, cz));
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const c = cols[lz * 16 + lx];
        const b = c.biome;
        const y = chunk.topY(lx, lz);
        if (y < 1 || y > 125) continue;
        const idx = (y << 8) | (lz << 4) | lx;
        const topId = blocks[idx];
        const above = idx + 256;
        const r = prng();
        if (topId === B.grass_block && blocks[above] === B.air) {
          const x = ox + lx, z = oz + lz;
          let plant = 0;
          const fl = this.nMisc.noise2(x / 30 + 300, z / 30);
          if (b === BI.PLAINS) plant = r < 0.18 ? B.short_grass : r < 0.2 ? (fl > 0.3 ? B.oxeye_daisy : fl > 0 ? B.dandelion : B.poppy) : 0;
          else if (b === BI.FOREST || b === BI.BIRCH) plant = r < 0.1 ? B.short_grass : r < 0.115 ? (fl > 0.2 ? B.cornflower : B.dandelion) : r < 0.118 ? B.brown_mushroom : 0;
          else if (b === BI.TAIGA) plant = r < 0.08 ? B.fern : r < 0.1 ? B.short_grass : r < 0.103 ? B.red_mushroom : 0;
          else if (b === BI.SWAMP) plant = r < 0.08 ? B.short_grass : r < 0.09 ? B.brown_mushroom : 0;
          else if (b === BI.MOUNTAINS) plant = r < 0.05 ? B.short_grass : 0;
          else if (b === BI.SNOWY || b === BI.SNOWY_TAIGA) plant = 0;
          if (r > 0.9995) plant = prng() < 0.5 ? B.pumpkin : B.melon;
          if (plant) blocks[above] = plant;
        } else if (topId === B.sand && blocks[above] === B.air) {
          if (b === BI.DESERT && r < 0.006) blocks[above] = B.dead_bush;
        }
        // canne à sucre au bord de l'eau
        if ((topId === B.sand || topId === B.grass_block || topId === B.dirt) && blocks[above] === B.air && y === SEA && r < 0.12 && lx > 0 && lx < 15 && lz > 0 && lz < 15) {
          if (blocks[idx - 1] === B.water || blocks[idx + 1] === B.water || blocks[idx - 16] === B.water || blocks[idx + 16] === B.water) {
            const hgt = 1 + Math.floor(prng() * 3);
            for (let k = 1; k <= hgt; k++) blocks[idx + k * 256] = B.sugar_cane;
          }
        }
        // neige
        const snowy = SNOWY_BIOMES.has(b) || (b === BI.MOUNTAINS && c.h > 96) || (b === BI.TAIGA && c.h > 90);
        if (snowy) {
          const ty = chunk.topY(lx, lz);
          const ti = (ty << 8) | (lz << 4) | lx;
          const tid = blocks[ti];
          if (ty < 126 && tid !== B.water && tid !== B.ice && tid !== B.snow && (tid === B.grass_block || tid === B.stone || tid === B.dirt || tid === B.sand || tid === B.gravel || tid === B.spruce_leaves || tid === B.oak_leaves || tid === B.snow_block)) {
            blocks[ti + 256] = B.snow;
            chunk.meta[ti + 256] = 0;
            if (tid === B.grass_block) chunk.meta[ti] = 1;
          }
        }
      }

    // ---- Animaux
    if (prng() < 0.12) {
      const b = cols[8 * 16 + 8].biome;
      const grassy = [BI.PLAINS, BI.FOREST, BI.BIRCH, BI.TAIGA, BI.MOUNTAINS, BI.SWAMP, BI.SNOWY, BI.SNOWY_TAIGA].includes(b);
      if (grassy) {
        const types = b === BI.SNOWY || b === BI.SNOWY_TAIGA ? ['sheep', 'chicken'] : ['pig', 'cow', 'sheep', 'chicken'];
        const t = types[Math.floor(prng() * types.length)];
        const n = 2 + Math.floor(prng() * 3);
        for (let i = 0; i < n; i++) {
          const lx = 2 + Math.floor(prng() * 12), lz = 2 + Math.floor(prng() * 12);
          const y = chunk.topY(lx, lz);
          const tid = blocks[(y << 8) | (lz << 4) | lx];
          if (tid === B.grass_block || tid === B.snow || tid === B.short_grass) {
            if (!chunk.pendingEntities) chunk.pendingEntities = [];
            chunk.pendingEntities.push({ type: t, x: ox + lx + 0.5, y: y + 1, z: oz + lz + 0.5 });
          }
        }
      }
    }
  }

  treesFor(ncx, ncz, put) {
    const rng = mulberry32(hash2(this.seed ^ 0x7ee, ncx, ncz));
    const center = this.column(ncx * 16 + 8, ncz * 16 + 8);
    const b = center.biome;
    let count = 0;
    if (b === BI.FOREST || b === BI.BIRCH) count = 6 + Math.floor(rng() * 4);
    else if (b === BI.TAIGA || b === BI.SNOWY_TAIGA) count = 5 + Math.floor(rng() * 4);
    else if (b === BI.SWAMP) count = 2;
    else if (b === BI.MOUNTAINS) count = rng() < 0.5 ? 1 : 0;
    else if (b === BI.PLAINS) count = rng() < 0.12 ? 1 : 0;
    else if (b === BI.SNOWY) count = rng() < 0.15 ? 1 : 0;
    else if (b === BI.DESERT) count = rng() < 0.6 ? 2 : 0;
    for (let i = 0; i < count; i++) {
      const x = ncx * 16 + Math.floor(rng() * 16), z = ncz * 16 + Math.floor(rng() * 16);
      const r1 = rng(), r2 = rng();
      const c = this.column(x, z);
      if (c.h < SEA || c.h > 118) continue;
      const top = this.surfaceTop(x, z, c);
      if (this.caveAt(x, c.h, z) < 0 && this.canCarve(c.h, c.h, this.caveAt(x, c.h, z))) continue;
      if (this.inVillage(x, z)) continue;
      const trng = mulberry32((r1 * 4294967296) >>> 0);
      if (c.biome === BI.DESERT) {
        if (top === B.sand && r2 < 0.8) cactus(put, x, c.h + 1, z, trng);
        continue;
      }
      if (top !== B.grass_block) continue;
      const tb = c.biome;
      if (tb === BI.TAIGA || tb === BI.SNOWY_TAIGA || tb === BI.SNOWY) spruceTree(put, x, c.h + 1, z, trng);
      else if (tb === BI.BIRCH) (r2 < 0.8 ? birchTree : oakTree)(put, x, c.h + 1, z, trng);
      else if (tb === BI.FOREST) (r2 < 0.2 ? birchTree : (p, a, b2, c2, rr) => oakTree(p, a, b2, c2, rr, B.oak_log, B.oak_leaves, r2 > 0.9))(put, x, c.h + 1, z, trng);
      else if (tb === BI.MOUNTAINS) (r2 < 0.5 ? spruceTree : oakTree)(put, x, c.h + 1, z, trng);
      else oakTree(put, x, c.h + 1, z, trng, B.oak_log, B.oak_leaves, tb === BI.SWAMP);
    }
  }

  findSpawn() {
    for (let r = 0; r < 800; r += 8) {
      const steps = Math.max(1, Math.floor((r * 2 * Math.PI) / 8));
      for (let s = 0; s < steps; s++) {
        const a = (s / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r), z = Math.round(Math.sin(a) * r);
        const c = this.column(x, z);
        if ([BI.PLAINS, BI.FOREST, BI.BIRCH, BI.TAIGA].includes(c.biome) && c.h > SEA && c.h < 90 && this.surfaceTop(x, z, c) === B.grass_block) {
          if (this.caveAt(x, c.h, z) >= 0) return { x: x + 0.5, y: c.h + 1, z: z + 0.5 };
        }
      }
    }
    return { x: 0.5, y: 80, z: 0.5 };
  }
}

export function trilerp(c000, c100, c010, c110, c001, c101, c011, c111, fx, fy, fz) {
  const x00 = c000 + (c100 - c000) * fx;
  const x10 = c010 + (c110 - c010) * fx;
  const x01 = c001 + (c101 - c001) * fx;
  const x11 = c011 + (c111 - c011) * fx;
  const y0 = x00 + (x10 - x00) * fy;
  const y1 = x01 + (x11 - x01) * fy;
  return y0 + (y1 - y0) * fz;
}

export function grassColor(temp, hum, biome) {
  if (biome === BI.SWAMP) return [106, 112, 57];
  const t = clamp((temp + 1) / 2, 0, 1);
  const h = clamp((hum + 1) / 2, 0, 1);
  const cold = [128, 180, 151], dry = [191, 183, 85], wet = [71, 205, 51];
  const r = cold[0] * (1 - t) + (dry[0] * (1 - h) + wet[0] * h) * t;
  const g = cold[1] * (1 - t) + (dry[1] * (1 - h) + wet[1] * h) * t;
  const bl = cold[2] * (1 - t) + (dry[2] * (1 - h) + wet[2] * h) * t;
  return [r | 0, g | 0, bl | 0];
}
