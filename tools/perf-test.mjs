// Mesure de performance : vol rapide en ligne droite, temps passé sur le fil principal par image
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const root = process.env.GAME_ROOT || join(dirname(fileURLToPath(import.meta.url)), '..');
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
const RD = parseInt(process.argv[3] || '10', 10);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
page.on('pageerror', (e) => console.log('ERREUR', e.message));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.addInitScript((rd) => localStorage.setItem('mcjs-settings', JSON.stringify({ renderDistance: rd, shaders: 0 })), RD);
await page.goto(`http://localhost:${server.address().port}/${process.argv[2] || 'index.html'}`);
await page.waitForTimeout(1000);
const t0 = Date.now();
await page.evaluate(() => window.game.newWorld({ name: 'Perf', seed: '4242', gamemode: 'creative', bonus: false }));
await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 180000 });
const loadMs = Date.now() - t0;
await page.waitForTimeout(3000);
const res = await page.evaluate(async (RD) => {
  const g = window.game, p = g.player;
  p.flying = true; p.y = 110; p.pitch = -0.3; p.yaw = -Math.PI / 2;
  const frames = [];
  let cur = 0;
  const parts = {};
  const wrap = (obj, name, top = true) => { const f = obj[name].bind(obj); parts[name] = 0; obj[name] = (...a) => { const t = performance.now(); const r = f(...a); const d = performance.now() - t; parts[name] += d; if (top) cur += d; return r; }; };
  wrap(g, 'tick'); wrap(g.renderer, 'render'); wrap(g.world, 'updateChunks');
  wrap(g.renderer, 'updateMeshes', false); (g.renderer.collectVisible ? wrap(g.renderer, 'collectVisible', false) : 0); wrap(g.renderer, 'buildEntities', false); wrap(g.world.light, 'initChunk', false);
  const speed = 20; // blocs par seconde
  let last = performance.now();
  const end = last + 20000;
  await new Promise((resolve) => {
    const step = () => {
      const now = performance.now();
      frames.push(cur); cur = 0;
      p.x += speed * (now - last) / 1000; p.prevX = p.x; p.y = 110; p.prevY = 110; last = now;
      if (now < end) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
  // chunks à portée prêts ?
  const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
  let ready = 0, total = 0, meshed = 0;
  for (let dx = -RD; dx <= RD; dx++) for (let dz = -RD; dz <= RD; dz++) {
    if (dx * dx + dz * dz > RD * RD) continue;
    total++;
    const c = g.world.getChunk(pcx + dx, pcz + dz);
    if (c && c.state >= 2) { ready++; if (c.meshes.some((m) => m)) meshed++; }
  }
  frames.sort((a, b) => a - b);
  const avg = frames.reduce((a, b) => a + b, 0) / frames.length;
  for (const k in parts) parts[k] = +(parts[k] / frames.length).toFixed(2);
  return {
    parts,
    frames: frames.length, avgMs: +avg.toFixed(2), p95Ms: +frames[Math.floor(frames.length * 0.95)].toFixed(1), maxMs: +frames[frames.length - 1].toFixed(1),
    over33: frames.filter((f) => f > 33).length, chunksReady: ready + '/' + total, meshed, drawn: g.renderer.stats.drawn, workers: g.workers ? g.workers.workers.length : 0,
  };
}, RD);
console.log(JSON.stringify({ loadMs, ...res }));
await browser.close();
server.close();
