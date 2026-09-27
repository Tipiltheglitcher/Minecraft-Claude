// Worker : génération des chunks, maillage des sections, synthèse des sons (hors du fil principal)
import { Chunk } from '../world/chunk.js';
import { LightEngine } from '../world/light.js';
import { OverworldGen } from '../world/gen/overworld.js';
import { NetherGen } from '../world/gen/nether.js';
import { EndGen } from '../world/gen/end.js';
import { setLootEnchantHook } from '../world/gen/structures.js';
import { randomBook } from '../game/enchant.js';
import { setTextureIndex } from '../gfx/texindex.js';
import { loadPadded, meshSection } from '../gfx/mesher.js';
import { synth, synthLoop, pianoNote } from '../game/sfx.js';

setLootEnchantHook(randomBook);
const gens = new Map();
// moteur de lumière réutilisé (ses files font plusieurs Mo) ; il ne voit que le chunk en cours
const lightWorld = { c: null, getChunk(x, z) { const c = this.c; return c && c.cx === x && c.cz === z ? c : null; } };
const lighter = new LightEngine(lightWorld);

function generator(dim, seed) {
  const k = dim + ':' + seed;
  let g = gens.get(k);
  if (!g) {
    g = dim === 'overworld' ? new OverworldGen(seed) : dim === 'nether' ? new NetherGen(seed) : new EndGen(seed);
    gens.set(k, g);
  }
  return g;
}

function handle(m) {
  switch (m.type) {
    case 'init':
      setTextureIndex(m.tex);
      return null;
    case 'gen': {
      const c = new Chunk(m.cx, m.cz);
      generator(m.dim, m.seed).generate(c);
      // éclairage interne au chunk (le raccord avec les voisins se fait sur le fil principal)
      if (m.light) {
        lightWorld.c = c;
        lighter.initChunk(c, m.hasSky);
        lightWorld.c = null;
      }
      const out = {
        id: m.id, blocks: c.blocks, meta: c.meta, biome: c.biome, tint: c.tint, light: m.light ? c.light : null,
        be: [...c.blockEntities], ents: c.pendingEntities,
      };
      const tr = [c.blocks.buffer, c.meta.buffer, c.biome.buffer, c.tint.buffer];
      if (m.light) tr.push(c.light.buffer);
      return [out, tr];
    }
    case 'mesh': {
      loadPadded(m.ids, m.metas, m.lights);
      const r = meshSection({ cx: m.cx, cz: m.cz, tint: m.tint, biome: m.biome }, m.sy, m.opts);
      const out = { id: m.id, vis: r.vis, opaque: r.opaque || null, trans: r.trans || null };
      const tr = [];
      if (r.opaque) tr.push(r.opaque.data);
      if (r.trans) tr.push(r.trans.data);
      return [out, tr];
    }
    case 'sfx': {
      const d = synth(m.name, m.variant);
      return [{ id: m.id, channels: d.channels, rate: d.rate }, d.channels.map((c) => c.buffer)];
    }
    case 'loop': {
      const d = synthLoop(m.name);
      return [{ id: m.id, channels: d.channels, rate: d.rate }, d.channels.map((c) => c.buffer)];
    }
    case 'piano': {
      const d = pianoNote(m.midi, m.vel);
      return [{ id: m.id, data: d }, [d.buffer]];
    }
    default:
      return [{ id: m.id, type: 'error', message: 'tâche inconnue ' + m.type }, []];
  }
}

self.onmessage = (e) => {
  const m = e.data;
  try {
    const r = handle(m);
    if (r) self.postMessage(r[0], r[1]);
  } catch (err) {
    self.postMessage({ id: m.id, type: 'error', message: String(err && err.stack || err) });
  }
};
