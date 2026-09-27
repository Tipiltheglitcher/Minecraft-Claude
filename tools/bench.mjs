// Mesure des temps de génération, d'éclairage et de maillage (Node, sans navigateur)
import { World } from '../src/world/world.js';
import { buildSection } from '../src/gfx/mesher.js';
import { buildTextures } from '../src/gfx/textures.js';

buildTextures();
const R = parseInt(process.argv[2] || '6', 10);
const w = new World(null, process.argv[3] || 'overworld', 12345, null);
const t = { gen: 0, light: 0, mesh: 0, gather: 0 };
const origGen = w.gen.generate.bind(w.gen);
w.gen.generate = (c) => { const a = performance.now(); origGen(c); t.gen += performance.now() - a; };
const origLight = w.light.initChunk.bind(w.light);
w.light.initChunk = (c, s) => { const a = performance.now(); origLight(c, s); t.light += performance.now() - a; };
let n = 0;
const t0 = performance.now();
for (let cx = -R; cx <= R; cx++) for (let cz = -R; cz <= R; cz++) { w.loadOrGenerate(cx, cz); n++; }
const tLoad = performance.now() - t0;
let secs = 0, verts = 0;
const t1 = performance.now();
for (const c of w.chunks.values()) {
  if (Math.abs(c.cx) >= R || Math.abs(c.cz) >= R) continue;
  for (let s = 0; s < 8; s++) {
    if (!c.sectionHasBlocks[s]) continue;
    const r = buildSection(w, c, s);
    secs++;
    verts += (r.opaque ? r.opaque.count : 0) + (r.trans ? r.trans.count : 0);
  }
}
t.mesh = performance.now() - t1;
console.log(`chunks ${n} : total ${(tLoad / n).toFixed(2)} ms/chunk (génération ${(t.gen / n).toFixed(2)}, lumière ${(t.light / n).toFixed(2)})`);
console.log(`sections ${secs} : ${(t.mesh / secs).toFixed(2)} ms/section, ${(verts / secs).toFixed(0)} sommets/section`);
