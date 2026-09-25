// Générateur de l'End
import { Simplex, mulberry32, hash2 } from '../../core/noise.js';
import { B } from '../../data/ids.js';
import { buildEndStructures } from './structures.js';
import { BI } from './overworld.js';

export class EndGen {
  constructor(seed) {
    this.seed = seed;
    this.n1 = new Simplex(seed ^ 0xe01);
    this.n2 = new Simplex(seed ^ 0xe02);
    this.nI = new Simplex(seed ^ 0xe03);
    this.fountainY = this.islandTop(0, 0);
    this.structures = buildEndStructures(seed, this.fountainY);
  }

  // Île principale : lentille déformée ; îles externes éparses
  islandShape(x, z) {
    const r = Math.sqrt(x * x + z * z);
    const R = 78 + this.n1.fbm2(x / 60, z / 60, 3) * 14;
    if (r < R) {
      const t = 1 - (r / R) * (r / R);
      const top = Math.round(60 + this.n2.fbm2(x / 30, z / 30, 3) * 3 + t * 4);
      const bottom = Math.round(top - 4 - t * 42 + this.n2.noise2(x / 10 + 50, z / 10) * 3);
      return { top, bottom };
    }
    if (r > 300) {
      const n = this.nI.fbm2(x / 70, z / 70, 3);
      if (n > 0.35) {
        const t = Math.min(1, (n - 0.35) / 0.25);
        const top = Math.round(58 + this.n2.noise2(x / 20, z / 20) * 3 + t * 3);
        return { top, bottom: Math.round(top - t * 18) };
      }
    }
    return null;
  }

  islandTop(x, z) {
    const s = this.islandShape(x, z);
    return s ? s.top : 60;
  }

  generate(chunk) {
    const { cx, cz } = chunk;
    const ox = cx * 16, oz = cz * 16;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        chunk.biome[lz * 16 + lx] = BI.END;
        const s = this.islandShape(ox + lx, oz + lz);
        if (!s) continue;
        for (let y = Math.max(1, s.bottom); y <= Math.min(126, s.top); y++) chunk.blocks[(y << 8) | (lz << 4) | lx] = B.end_stone;
      }
    if (this.structures.intersectsChunk(cx, cz)) this.structures.applyTo(chunk);
    // quelques piliers de chorus remplacés par de la purpur (îles externes)
    const rng = mulberry32(hash2(this.seed ^ 0xe0e, cx, cz));
    if (Math.hypot(ox, oz) > 320 && rng() < 0.08) {
      const lx = 4 + Math.floor(rng() * 8), lz = 4 + Math.floor(rng() * 8);
      const y = chunk.topY(lx, lz);
      if (y > 40) {
        const h = 3 + Math.floor(rng() * 6);
        for (let k = 1; k <= h; k++) chunk.blocks[((y + k) << 8) | (lz << 4) | lx] = B.purpur_block;
        chunk.blocks[((y + h + 1) << 8) | (lz << 4) | lx] = B.end_stone_bricks;
      }
    }
  }

  findSpawn() {
    return { x: 100.5, y: 49, z: 0.5 };
  }
}
