// Profil CPU du fil principal (Chrome DevTools) pendant un vol rapide : fonctions les plus coûteuses
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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.addInitScript(() => localStorage.setItem('mcjs-settings', JSON.stringify({ renderDistance: 10, shaders: parseInt(new URLSearchParams(location.search).get('sh') || '0', 10) })));
await page.goto(`http://localhost:${server.address().port}/index.html?sh=${process.argv[2] || 0}`);
await page.waitForTimeout(1000);
await page.evaluate(() => window.game.newWorld({ name: 'Prof', seed: '4242', gamemode: 'creative', bonus: false }));
await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 180000 });
await page.waitForTimeout(3000);
const cdp = await page.context().newCDPSession(page);
await cdp.send('Profiler.enable');
await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
await cdp.send('Profiler.start');
await page.evaluate(async () => {
  const g = window.game, p = g.player;
  p.flying = true; p.y = 110; p.pitch = -0.3;
  let last = performance.now();
  const end = last + 15000;
  await new Promise((resolve) => {
    const step = () => {
      const now = performance.now();
      p.x += 20 * (now - last) / 1000; p.prevX = p.x; p.y = 110; p.prevY = 110; last = now;
      if (now < end) requestAnimationFrame(step); else resolve();
    };
    requestAnimationFrame(step);
  });
});
const { profile } = await cdp.send('Profiler.stop');
const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const dt = profile.timeDeltas;
const counts = new Map();
for (let i = 0; i < profile.samples.length; i++) counts.set(profile.samples[i], (counts.get(profile.samples[i]) || 0) + (dt[i] || 0));
let total = 0;
for (const [id, us] of counts) {
  const n = byId.get(id);
  const cf = n.callFrame;
  const key = (cf.functionName || '(anonyme)') + ' ' + cf.url.split('/').slice(-2).join('/') + ':' + (cf.lineNumber + 1);
  self.set(key, (self.get(key) || 0) + us);
  total += us;
}
const top = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 28);
console.log('total échantillonné', (total / 1000).toFixed(0), 'ms');
for (const [k, us] of top) console.log((us / 1000).toFixed(0).padStart(6), 'ms', (100 * us / total).toFixed(1).padStart(5) + ' %', k);
await browser.close();
server.close();
