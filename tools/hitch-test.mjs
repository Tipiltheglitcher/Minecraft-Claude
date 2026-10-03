// Détection des saccades : marche + sauts + caméra pendant 30 s (nuit, monstres, sauvegarde auto)
// et attribution de chaque image lente aux parties du code qui ont pris le temps.
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const f = join(root, p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': MIME[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
});
await new Promise((r) => server.listen(0, r));
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 480, height: 270 } });
page.on('pageerror', (e) => console.log('ERREUR', e.message));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.addInitScript(() => localStorage.setItem('mcjs-settings', JSON.stringify({ renderDistance: 8, shaders: 0, dynamicRes: false })));
await page.goto(`http://localhost:${server.address().port}/${process.argv[2] || 'index.html'}`);
await page.waitForTimeout(1000);
await page.evaluate(() => window.game.newWorld({ name: 'Hitch', seed: '777', gamemode: 'survival', bonus: false }));
await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(4000);
// instrumentation
await page.evaluate(() => {
  const g = window.game;
  g.audio.init();
  window.__frames = [];
  window.__cur = {};
  window.__long = [];
  try { new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ type: 'longtask', buffered: false }); } catch (e) { /* indisponible */ }
  const wrap = (obj, name, label) => {
    const f = obj[name];
    obj[name] = function (...a) {
      const t = performance.now();
      try { return f.apply(this, a); } finally { const d = performance.now() - t; window.__cur[label] = (window.__cur[label] || 0) + d; }
    };
  };
  wrap(g, 'tick', 'tick'); wrap(g.world, 'tick', 'world.tick'); wrap(g.spawner, 'tick', 'spawner');
  wrap(g.world, 'updateChunks', 'updateChunks'); wrap(g.world, 'integrate', 'integrate');
  wrap(g.renderer, 'render', 'render'); wrap(g.renderer, 'updateMeshes', 'updateMeshes'); wrap(g.renderer, 'applyMesh', 'applyMesh');
  wrap(g.renderer, 'buildEntities', 'buildEntities'); wrap(g.renderer, 'collectVisible', 'collectVisible');
  wrap(g.ui, 'updateHud', 'hud'); wrap(g.audio, 'update', 'audio'); wrap(g.audio, 'play', 'audio.play');
  wrap(g, 'saveWorld', 'saveWorld'); wrap(g.world, 'flushSaved', 'flushSaved'); wrap(g.world.light, 'relight', 'relight');
  wrap(g.world, 'serialize', 'serialize'); wrap(g.saves, 'saveChunks', 'saveChunks');
  for (const k of ['pathTo', 'findPath']) { /* chemins : mesurés via l'entité si présent */ }
  let last = performance.now();
  const step = (now) => {
    window.__frames.push({ dt: now - last, parts: window.__cur });
    window.__cur = {};
    last = now;
    if (!window.__stop) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
  // nuit + monstres ; beaucoup de chunks modifiés comme après une longue partie
  g.time = 14000;
  for (const c of g.world.chunks.values()) c.modified = true;
});
// jeu : avancer, sauter régulièrement, tourner la caméra
await page.keyboard.down('KeyW');
const t0 = Date.now();
let i = 0;
while (Date.now() - t0 < 30000) {
  if (i % 3 === 0) await page.keyboard.press('Space');
  await page.evaluate((i) => { const p = window.game.player; p.yaw += 0.08 * Math.sin(i / 4); }, i);
  if (i === 40) await page.evaluate(() => window.game.saveWorld());
  await page.waitForTimeout(250);
  i++;
}
await page.keyboard.up('KeyW');
const res = await page.evaluate(() => {
  window.__stop = true;
  const fr = window.__frames.slice(5);
  const slow = fr.filter((f) => f.dt > 50).sort((a, b) => b.dt - a.dt).slice(0, 12);
  const tot = {};
  for (const f of fr) for (const [k, v] of Object.entries(f.parts)) tot[k] = Math.max(tot[k] || 0, v);
  return {
    frames: fr.length, median: fr.map((f) => f.dt).sort((a, b) => a - b)[fr.length >> 1].toFixed(1),
    slow: slow.map((f) => Math.round(f.dt) + 'ms: ' + Object.entries(f.parts).filter(([, v]) => v > 3).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v.toFixed(1)).join(', ')),
    maxPerPart: Object.fromEntries(Object.entries(tot).map(([k, v]) => [k, +v.toFixed(1)]).sort((a, b) => b[1] - a[1])),
    longTasks: window.__long.sort((a, b) => b - a).slice(0, 10),
    pos: [Math.round(window.game.player.x), Math.round(window.game.player.y), Math.round(window.game.player.z)],
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
server.close();
