// Monde : gestion des chunks, blocs, ticks et entités d'une dimension
import { Chunk, ST_EMPTY, ST_GENERATED, ST_LIT, rleEncodeBytes, rleDecode } from './chunk.js';
import { LightEngine } from './light.js';
import { chunkKey, WH } from '../core/constants.js';
import { BLOCKS, OPACITY, EMIT, SOLID, collisionBoxes, blockDef, LIQUID, REPLACEABLE } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { ITEMS } from '../data/items.js';
import { OverworldGen } from './gen/overworld.js';
import { NetherGen } from './gen/nether.js';
import { EndGen } from './gen/end.js';
import { spawnEntity } from '../entity/registry.js';
import * as updates from './updates.js';

export const DIMS = {
  overworld: { name: 'La Surface', hasSky: true, ceiling: false, fog: [0.62, 0.78, 1.0], ambient: 0.0, beds: true, lavaDelay: 30, lavaDrop: 2, scale: 1 },
  nether: { name: 'Le Nether', hasSky: false, ceiling: true, fog: [0.2, 0.03, 0.03], ambient: 0.12, beds: false, lavaDelay: 10, lavaDrop: 1, scale: 8 },
  end: { name: 'L\'End', hasSky: false, ceiling: false, fog: [0.04, 0.02, 0.06], ambient: 0.16, beds: false, lavaDelay: 30, lavaDrop: 2, scale: 1 },
};

export class World {
  constructor(game, dim, seed, saved) {
    this.game = game;
    this.dim = dim;
    this.props = DIMS[dim];
    this.hasSky = this.props.hasSky;
    this.seed = seed;
    this.chunks = new Map();
    this.saved = saved || new Map(); // chunkKey -> données sérialisées
    this.light = new LightEngine(this);
    this.entities = [];
    this.entityById = new Map();
    this.scheduled = new Map(); // tick -> [x,y,z,...]
    this.scheduledSet = new Set();
    this.tickingBE = new Map(); // clé position -> {x,y,z,be}
    this.tickCount = 0;
    this.gen = dim === 'overworld' ? new OverworldGen(seed) : dim === 'nether' ? new NetherGen(seed) : new EndGen(seed);
    this._lastChunk = null;
    this.data = {}; // données propres à la dimension (dragon, portail...)
    this.pending = new Set(); // chunks demandés aux workers
    this.arrived = []; // chunks générés par les workers, à intégrer
  }

  // ---------- Chunks ----------
  getChunk(cx, cz) {
    const lc = this._lastChunk;
    if (lc && lc.cx === cx && lc.cz === cz) return lc;
    const c = this.chunks.get(chunkKey(cx, cz));
    if (c) this._lastChunk = c;
    return c;
  }

  isChunkReady(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return !!c && c.state >= ST_LIT;
  }

  loadOrGenerate(cx, cz) {
    const key = chunkKey(cx, cz);
    let c = this.chunks.get(key);
    if (c) return c;
    c = new Chunk(cx, cz);
    const s = this.saved.get(key);
    if (s) {
      this.deserialize(c, s);
      // biome/teintes : recalculés via le générateur (non sauvegardés)
      const tmp = new Chunk(cx, cz);
      this.gen.generate(tmp);
      c.biome.set(tmp.biome);
      c.tint.set(tmp.tint);
      c.pendingEntities = tmp.pendingEntities;
    } else {
      this.gen.generate(c);
    }
    this.addChunk(c);
    return c;
  }

  // Intègre un chunk généré (fil principal ou worker) : éclairage, voisins, entités
  addChunk(c, preLit = false) {
    const key = chunkKey(c.cx, c.cz);
    c.state = ST_GENERATED;
    c.updateSectionFlags();
    this.chunks.set(key, c);
    if (preLit) this.light.finishChunk(c, this.hasSky);
    else this.light.initChunk(c, this.hasSky);
    c.markAllDirty();
    // les voisins doivent être remaillés (bords)
    for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
      const n = this.getChunk(c.cx + dx, c.cz + dz);
      if (n) n.markAllDirty();
    }
    this.onChunkLoaded(c);
  }

  // Demande la génération d'un chunk à un worker
  requestChunk(cx, cz, pool) {
    const key = chunkKey(cx, cz);
    this.pending.add(key);
    const light = !this.saved.has(key);
    pool.run({ type: 'gen', dim: this.dim, seed: this.seed, cx, cz, light, hasSky: this.hasSky }, null, (r) => {
      this.pending.delete(key);
      r.cx = cx; r.cz = cz;
      this.arrived.push(r);
    }, 1, () => this.pending.delete(key));
  }

  // Résultat d'un worker -> chunk du monde
  integrate(r, pcx, pcz, radius) {
    const key = chunkKey(r.cx, r.cz);
    if (this.chunks.has(key)) return false;
    if (Math.max(Math.abs(r.cx - pcx), Math.abs(r.cz - pcz)) > radius + 3) return false;
    const c = new Chunk(r.cx, r.cz);
    c.biome = r.biome;
    c.tint = r.tint;
    const s = this.saved.get(key);
    let preLit = false;
    if (s) this.deserialize(c, s);
    else {
      c.blocks = r.blocks;
      c.meta = r.meta;
      c.blockEntities = new Map(r.be);
      if (r.light) { c.light = r.light; preLit = true; }
    }
    c.pendingEntities = r.ents;
    this.addChunk(c, preLit);
    return true;
  }

  onChunkLoaded(c) {
    const ox = c.cx * 16, oz = c.cz * 16;
    for (const [idx, be] of c.blockEntities) {
      if (be.type === 'furnace' || be.type === 'spawner' || be.type === 'brewing') {
        const x = ox + (idx & 15), y = idx >> 8, z = oz + ((idx >> 4) & 15);
        this.tickingBE.set(x + ',' + y + ',' + z, { x, y, z, be });
      }
    }
    if (c.pendingEntities) {
      const list = c.pendingEntities;
      c.pendingEntities = null;
      for (const e of list) {
        if (this.game && this.game.settings && this.game.settings.difficulty === 0 && ['zombie', 'skeleton', 'wither_skeleton', 'blaze'].includes(e.type)) continue;
        spawnEntity(this, e.type, e.x, e.y, e.z, e.data);
      }
    }
  }

  unloadChunk(c) {
    const key = chunkKey(c.cx, c.cz);
    if (c.modified && (c.saveDirty || !this.saved.has(key))) { this.saved.set(key, this.serialize(c)); if (this.dirtyKeys) this.dirtyKeys.add(key); }
    if (this.game && this.game.renderer) this.game.renderer.disposeChunk(c);
    this.chunks.delete(key);
    if (this._lastChunk === c) this._lastChunk = null;
    const ox = c.cx * 16, oz = c.cz * 16;
    for (const k of [...this.tickingBE.keys()]) {
      const t = this.tickingBE.get(k);
      if (t.x >= ox && t.x < ox + 16 && t.z >= oz && t.z < oz + 16) this.tickingBE.delete(k);
    }
    for (const e of this.entities) {
      if (e.persistent || e.isPlayer) continue;
      if (Math.floor(e.x) >> 4 === c.cx && Math.floor(e.z) >> 4 === c.cz) e.removed = true;
    }
  }

  // Charge/génère les chunks autour d'un point, dans un budget de temps
  updateChunks(px, pz, radius, budgetMs = 8) {
    const pcx = Math.floor(px) >> 4, pcz = Math.floor(pz) >> 4;
    const t0 = performance.now();
    let generated = 0;
    const pool = this.game && this.game.workers && this.game.workers.ok ? this.game.workers : null;
    // chunks générés par les workers : les plus proches d'abord
    if (this.arrived.length) {
      const dd = (r) => Math.max(Math.abs(r.cx - pcx), Math.abs(r.cz - pcz));
      this.arrived.sort((a, b) => dd(a) - dd(b));
      let k = 0;
      while (k < this.arrived.length && (k === 0 || performance.now() - t0 < budgetMs)) {
        if (this.integrate(this.arrived[k], pcx, pcz, radius)) generated++;
        k++;
      }
      this.arrived.splice(0, k);
    }
    const maxPending = pool ? pool.workers.length * 6 : 0;
    const r = radius + 1;
    outer:
    for (let d = 0; d <= r; d++) {
      for (let dx = -d; dx <= d; dx++)
        for (let dz = -d; dz <= d; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== d) continue;
          if (dx * dx + dz * dz > r * r + 2) continue;
          const cx = pcx + dx, cz = pcz + dz;
          const key = chunkKey(cx, cz);
          if (this.chunks.has(key) || this.pending.has(key)) continue;
          if (pool) {
            if (this.pending.size >= maxPending) break outer;
            this.requestChunk(cx, cz, pool);
            continue;
          }
          this.loadOrGenerate(cx, cz);
          generated++;
          if (performance.now() - t0 > budgetMs) return generated;
        }
    }
    // déchargement
    if (this.tickCount % 20 === 0) {
      // marge réduite pour les grandes distances (mémoire)
      const lim = radius + (radius > 12 ? 2 : 4);
      for (const c of [...this.chunks.values()]) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (Math.abs(dx) > lim || Math.abs(dz) > lim || dx * dx + dz * dz > (lim + 1) * (lim + 1)) this.unloadChunk(c);
      }
    }
    return generated;
  }

  serialize(c) {
    const be = [];
    for (const [idx, data] of c.blockEntities) be.push([idx, data]);
    c.saveDirty = false;
    return { b: rleEncodeBytes(c.blocks), m: rleEncodeBytes(c.meta), be };
  }

  deserialize(c, s) {
    rleDecode(s.b, c.blocks);
    rleDecode(s.m, c.meta);
    c.blockEntities = new Map((s.be || []).map(([i, d]) => [i, d]));
    c.modified = true;
  }

  // Sauvegarde des chunks changés depuis la dernière fois
  flushSaved() {
    for (const c of this.chunks.values()) if (c.saveDirty) this.saveChunk(c);
    return this.saved;
  }

  saveChunk(c) {
    const k = chunkKey(c.cx, c.cz);
    this.saved.set(k, this.serialize(c));
    if (this.dirtyKeys) this.dirtyKeys.add(k);
  }

  // ---------- Accès aux blocs ----------
  getBlock(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  getMeta(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.meta[(y << 8) | ((z & 15) << 4) | (x & 15)];
  }

  getSky(x, y, z) {
    if (y >= WH) return this.hasSky ? 15 : 0;
    if (y < 0) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return this.hasSky ? 15 : 0;
    return c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] >> 4;
  }

  getBlockLight(x, y, z) {
    if (y < 0 || y >= WH) return 0;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 0;
    return c.light[(y << 8) | ((z & 15) << 4) | (x & 15)] & 15;
  }

  // Niveau de lumière effectif (0..15) en tenant compte du jour
  getLight(x, y, z) {
    const sky = this.getSky(x, y, z) - (this.hasSky ? this.game.skyDarken() : 0);
    return Math.max(sky, this.getBlockLight(x, y, z));
  }

  getBiome(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return 1;
    return c.biome[((z & 15) << 4) | (x & 15)];
  }

  isLoaded(x, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    return !!c && c.state >= ST_GENERATED;
  }

  setBlock(x, y, z, id, meta = 0, notify = true) {
    if (y < 0 || y >= WH) return false;
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c || c.state < ST_GENERATED) return false;
    const i = (y << 8) | ((z & 15) << 4) | (x & 15);
    const old = c.blocks[i], oldMeta = c.meta[i];
    if (old === id && oldMeta === meta) return false;
    c.blocks[i] = id;
    c.meta[i] = meta;
    c.modified = true;
    c.saveDirty = true;
    if (id) c.sectionHasBlocks[y >> 4] = 1;
    if (old !== id) {
      const be = c.blockEntities.get(i);
      if (be && !(old === B.furnace && id === B.lit_furnace) && !(old === B.lit_furnace && id === B.furnace)) {
        c.blockEntities.delete(i);
        this.tickingBE.delete(x + ',' + y + ',' + z);
      }
    }
    if (c.state >= ST_LIT && (OPACITY[old] !== OPACITY[id] || EMIT[old] !== EMIT[id])) this.light.update(x, y, z, this.hasSky);
    this.markDirty(x, y, z);
    if (notify) {
      updates.onPlaced(this, x, y, z, id, meta, old);
      this.notifyNeighbors(x, y, z);
    }
    return true;
  }

  setMeta(x, y, z, meta) {
    return this.setBlock(x, y, z, this.getBlock(x, y, z), meta);
  }

  markDirty(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    const s = y >> 4;
    c.dirty[s] = 1;
    const ly = y & 15, lx = x & 15, lz = z & 15;
    if (ly === 0 && s > 0) c.dirty[s - 1] = 1;
    if (ly === 15 && s < 7) c.dirty[s + 1] = 1;
    if (lx === 0) { const n = this.getChunk(c.cx - 1, c.cz); if (n) n.dirty[s] = 1; }
    if (lx === 15) { const n = this.getChunk(c.cx + 1, c.cz); if (n) n.dirty[s] = 1; }
    if (lz === 0) { const n = this.getChunk(c.cx, c.cz - 1); if (n) n.dirty[s] = 1; }
    if (lz === 15) { const n = this.getChunk(c.cx, c.cz + 1); if (n) n.dirty[s] = 1; }
  }

  notifyNeighbors(x, y, z) {
    updates.neighborChanged(this, x - 1, y, z, x, y, z);
    updates.neighborChanged(this, x + 1, y, z, x, y, z);
    updates.neighborChanged(this, x, y - 1, z, x, y, z);
    updates.neighborChanged(this, x, y + 1, z, x, y, z);
    updates.neighborChanged(this, x, y, z - 1, x, y, z);
    updates.neighborChanged(this, x, y, z + 1, x, y, z);
  }

  // ---------- Entités de bloc ----------
  getBlockEntity(x, y, z) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return null;
    return c.blockEntities.get((y << 8) | ((z & 15) << 4) | (x & 15)) || null;
  }

  setBlockEntity(x, y, z, be) {
    const c = this.getChunk(x >> 4, z >> 4);
    if (!c) return;
    c.blockEntities.set((y << 8) | ((z & 15) << 4) | (x & 15), be);
    c.modified = true;
    c.saveDirty = true;
    if (be.type === 'furnace' || be.type === 'spawner' || be.type === 'brewing') this.tickingBE.set(x + ',' + y + ',' + z, { x, y, z, be });
  }

  // ---------- Collisions ----------
  // Remplit "out" avec les boîtes [x0,y0,z0,x1,y1,z1] en coordonnées monde
  // Boîtes de collision des blocs dans une zone ; les tableaux de boîtes sont réutilisés
  // d'un appel à l'autre (aucune allocation pour les blocs pleins)
  getCollisions(x0, y0, z0, x1, y1, z1, out) {
    const pool = out._pool || (out._pool = []);
    let n = 0;
    const put = (a, b, c, d, e, f) => {
      let r = pool[n];
      if (!r) r = pool[n] = [0, 0, 0, 0, 0, 0];
      r[0] = a; r[1] = b; r[2] = c; r[3] = d; r[4] = e; r[5] = f;
      out[n++] = r;
    };
    let qx = 0, qy = 0, qz = 0;
    const nb = (dx, dy, dz) => this.getBlock(qx + dx, qy + dy, qz + dz);
    const bx0 = Math.floor(x0), by0 = Math.floor(y0) - 1, bz0 = Math.floor(z0);
    const bx1 = Math.floor(x1), by1 = Math.floor(y1), bz1 = Math.floor(z1);
    for (let x = bx0; x <= bx1; x++)
      for (let z = bz0; z <= bz1; z++) {
        const c = this.getChunk(x >> 4, z >> 4);
        if (!c || c.state < ST_GENERATED) {
          put(x, by0, z, x + 1, by1 + 1, z + 1);
          continue;
        }
        for (let y = by0; y <= by1; y++) {
          if (y < 0 || y >= WH) continue;
          const i = (y << 8) | ((z & 15) << 4) | (x & 15);
          const id = c.blocks[i];
          if (!SOLID[id]) continue;
          const d = BLOCKS[id];
          if (!d.collide && !(d.render === 'model' && d.boxes)) { put(x, y, z, x + 1, y + 1, z + 1); continue; }
          qx = x; qy = y; qz = z;
          const boxes = collisionBoxes(id, c.meta[i], nb);
          if (!boxes) continue;
          for (const b of boxes) put(x + b.x0 / 16, y + b.y0 / 16, z + b.z0 / 16, x + b.x1 / 16, y + b.y1 / 16, z + b.z1 / 16);
        }
      }
    out.length = n;
    return out;
  }

  // Vérifie si une boîte contient du liquide ; renvoie l'id du liquide
  liquidIn(x0, y0, z0, x1, y1, z1) {
    let found = 0;
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
          const id = this.getBlock(x, y, z);
          if (LIQUID[id]) {
            const m = this.getMeta(x, y, z);
            const h = m & 8 || m === 0 ? 1 : 1 - (m & 7) / 9;
            if (y0 < y + h) { if (id === B.lava) return B.lava; found = id; }
          }
        }
    return found;
  }

  blockInBox(x0, y0, z0, x1, y1, z1, pred) {
    for (let x = Math.floor(x0); x <= Math.floor(x1); x++)
      for (let y = Math.floor(y0); y <= Math.floor(y1); y++)
        for (let z = Math.floor(z0); z <= Math.floor(z1); z++) {
          const id = this.getBlock(x, y, z);
          if (id && pred(id, x, y, z)) return { id, x, y, z };
        }
    return null;
  }

  // ---------- Entités ----------
  addEntity(e) {
    e.world = this;
    this.entities.push(e);
    this.entityById.set(e.id, e);
    return e;
  }

  removeEntity(e) {
    e.removed = true;
  }

  entitiesIn(x0, y0, z0, x1, y1, z1, filter) {
    const r = [];
    for (const e of this.entities) {
      if (e.removed) continue;
      if (e.x + e.width / 2 < x0 || e.x - e.width / 2 > x1) continue;
      if (e.z + e.width / 2 < z0 || e.z - e.width / 2 > z1) continue;
      if (e.y + e.height < y0 || e.y > y1) continue;
      if (filter && !filter(e)) continue;
      r.push(e);
    }
    return r;
  }

  countEntities(pred) {
    let n = 0;
    for (const e of this.entities) if (!e.removed && pred(e)) n++;
    return n;
  }

  spawn(type, x, y, z, data) {
    return spawnEntity(this, type, x, y, z, data);
  }

  dropItem(x, y, z, stack, vel) {
    if (!stack || stack.count <= 0) return null;
    const e = spawnEntity(this, 'item', x, y, z, { stack });
    if (e) {
      if (vel) { e.vx = vel[0]; e.vy = vel[1]; e.vz = vel[2]; }
      else { e.vx = (Math.random() - 0.5) * 0.2; e.vy = 0.2; e.vz = (Math.random() - 0.5) * 0.2; }
    }
    return e;
  }

  dropXp(x, y, z, amount) {
    while (amount > 0) {
      const v = amount >= 17 ? 17 : amount >= 7 ? 7 : amount >= 3 ? 3 : 1;
      amount -= v;
      const e = spawnEntity(this, 'xp_orb', x, y, z, { value: v });
      if (e) { e.vx = (Math.random() - 0.5) * 0.3; e.vy = 0.2 + Math.random() * 0.2; e.vz = (Math.random() - 0.5) * 0.3; }
    }
  }

  // ---------- Ticks ----------
  scheduleTick(x, y, z, delay) {
    const key = x + ',' + y + ',' + z;
    if (this.scheduledSet.has(key)) return;
    this.scheduledSet.add(key);
    const t = this.tickCount + Math.max(1, delay);
    let a = this.scheduled.get(t);
    if (!a) { a = []; this.scheduled.set(t, a); }
    a.push(x, y, z);
  }

  tick(player) {
    this.tickCount++;
    // ticks programmés
    const due = this.scheduled.get(this.tickCount);
    if (due) {
      this.scheduled.delete(this.tickCount);
      for (let i = 0; i < due.length; i += 3) {
        const x = due[i], y = due[i + 1], z = due[i + 2];
        this.scheduledSet.delete(x + ',' + y + ',' + z);
        if (this.isLoaded(x, z)) updates.scheduledTick(this, x, y, z);
      }
    }
    // ticks aléatoires près du joueur
    if (player) {
      const pcx = Math.floor(player.x) >> 4, pcz = Math.floor(player.z) >> 4;
      const R = 6;
      for (let cx = pcx - R; cx <= pcx + R; cx++)
        for (let cz = pcz - R; cz <= pcz + R; cz++) {
          const c = this.getChunk(cx, cz);
          if (!c || c.state < ST_LIT) continue;
          for (let s = 0; s < 8; s++) {
            if (!c.sectionHasBlocks[s]) continue;
            for (let k = 0; k < 3; k++) {
              const r = (Math.random() * 4096) | 0;
              const lx = r & 15, lz = (r >> 4) & 15, y = (s << 4) | (r >> 8);
              const id = c.blocks[(y << 8) | (lz << 4) | lx];
              if (id && updates.RANDOM_TICK[id]) updates.randomTick(this, cx * 16 + lx, y, cz * 16 + lz, id);
            }
          }
        }
    }
    // entités de bloc
    for (const t of this.tickingBE.values()) updates.blockEntityTick(this, t.x, t.y, t.z, t.be, player);
    // entités
    const ents = this.entities;
    const tc = this.tickCount;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed) continue;
      if (!e.isPlayer && !this.isChunkReady(Math.floor(e.x), Math.floor(e.z)) && !e.persistent) continue;
      // créatures loin du joueur : simulées un tick sur quatre (comme la distance de simulation)
      if (player && e.navigateTo && !e.persistent && e.type !== 'ender_dragon' && ((e.id + tc) & 3)) {
        const dx = e.x - player.x, dz = e.z - player.z;
        if (dx * dx + dz * dz > 64 * 64) { e.prevX = e.x; e.prevY = e.y; e.prevZ = e.z; continue; }
      }
      e.tick();
    }
    let j = 0;
    for (let i = 0; i < ents.length; i++) {
      const e = ents[i];
      if (e.removed) { this.entityById.delete(e.id); if (e.onRemoved) e.onRemoved(); continue; }
      ents[j++] = e;
    }
    ents.length = j;
  }

  // ---------- Casser un bloc ----------
  // opts : {player, tool (stack), drop:boolean}
  breakBlock(x, y, z, opts = {}) {
    const id = this.getBlock(x, y, z);
    if (!id) return false;
    const meta = this.getMeta(x, y, z);
    const def = blockDef(id);
    const drop = opts.drop !== false;
    // conteneurs : vider
    const be = this.getBlockEntity(x, y, z);
    if (be && be.items && drop) for (const s of be.items) if (s) this.dropItem(x + 0.5, y + 0.5, z + 0.5, { ...s });
    if (drop) {
      for (const s of blockDrops(id, meta, opts.tool, opts.player)) this.dropItem(x + 0.5, y + 0.3, z + 0.5, s);
      if (def.xp && canHarvest(def, opts.tool)) {
        const [a, b] = def.xp;
        const amt = a + Math.floor(Math.random() * (b - a + 1));
        if (amt > 0) this.dropXp(x + 0.5, y + 0.5, z + 0.5, amt);
      }
    }
    if (this.game) {
      this.game.particles?.blockBreak(this, x, y, z, id, meta);
      this.game.audio?.blockSound(def.sound, 'break', x + 0.5, y + 0.5, z + 0.5);
    }
    // doubles blocs
    if (id === B.oak_door) {
      const oy = meta & 8 ? y - 1 : y + 1;
      if (this.getBlock(x, oy, z) === B.oak_door) this.setBlock(x, oy, z, 0, 0, false);
    } else if (id === B.bed) {
      const [dx, dz] = FACING_VEC[meta & 3];
      const s = meta & 4 ? -1 : 1;
      if (this.getBlock(x + dx * s, y, z + dz * s) === B.bed) this.setBlock(x + dx * s, y, z + dz * s, 0, 0, false);
    }
    let replacement = 0;
    if (id === B.ice && this.dim !== 'nether') {
      const below = this.getBlock(x, y - 1, z);
      if (below && below !== B.air && !LIQUID[below]) replacement = B.water;
    }
    this.setBlock(x, y, z, replacement, 0);
    if (replacement === B.water) this.scheduleTick(x, y, z, 5);
    return true;
  }

  playSound(name, x, y, z, vol = 1, pitch = 1) {
    if (this.game && this.game.world === this) this.game.audio?.play(name, x, y, z, vol, pitch);
  }
}

export const FACING_VEC = [[0, -1], [0, 1], [-1, 0], [1, 0]];

// ---------- Récolte ----------
function toolOf(stack) {
  if (!stack) return null;
  const d = ITEMS[stack.id];
  return d && d.tool ? d.tool : null;
}

export function canHarvest(def, stack) {
  const t = toolOf(stack);
  if (def.needsTool) {
    if (!t) return false;
    if (def.web) return t.type === 'sword' || t.type === 'shears';
    return t.type === def.tool;
  }
  if (def.level < 0) return true;
  if (!t) return false;
  return t.type === def.tool && t.level >= def.level;
}

export function blockDrops(id, meta, tool, player) {
  const def = BLOCKS[id];
  if (!def) return [];
  if (player && player.creative) return [];
  const t = toolOf(tool);
  // cisailles
  if (t && t.type === 'shears' && (def.leaves || def.shears || def.web)) return [{ id, count: 1 }];
  const ench = tool && tool.ench;
  if (ench && ench.silk_touch && def.hardness >= 0 && !def.liquid && !def.portal && canHarvest(def, tool)) return [{ id: def.pick ? def.pick() : id, count: 1 }];
  if (!canHarvest(def, tool)) return [];
  let list;
  if (def.drops) list = def.drops(meta, Math.random, tool).map(([i, c]) => ({ id: i, count: c }));
  else list = [{ id, count: 1 }];
  if (def.dropCount) for (const s of list) s.count = def.dropCount;
  const fortune = ench && ench.fortune;
  if (fortune && def.fortune) for (const s of list) s.count *= 1 + Math.floor(Math.random() * (fortune + 1));
  return list.filter((s) => s.count > 0 && s.id);
}

export function isReplaceable(id) {
  return !!REPLACEABLE[id];
}
