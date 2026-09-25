// Test du mode shader, des sons et des touches : captures et vérification des erreurs
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, extname } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let chromium;
try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const shots = join(root, 'tools/shots');
mkdirSync(shots, { recursive: true });
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
const port = server.address().port;
const page0 = process.argv[2] || '/index.html';
const preset = parseInt(process.argv[3] || '3', 10);

const browser = await chromium.launch({
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.addInitScript((preset) => {
  const presets = [null, [0, 48, false, false], [1, 64, true, true], [1, 96, true, true], [2, 128, true, true]];
  const p = presets[preset];
  const s = { shaders: preset, renderDistance: 6 };
  if (p) Object.assign(s, { shaderShadowQuality: p[0], shaderShadowDist: p[1], shaderWater: p[2], shaderGodrays: p[3] });
  localStorage.setItem('mcjs-settings', JSON.stringify(s));
}, preset);
await page.goto(`http://localhost:${port}${page0}`);
await page.waitForTimeout(1500);

const wait = async (fn, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

// sons : tout doit se synthétiser sans erreur
const audio = await page.evaluate(async () => {
  const a = window.game.audio;
  a.init();
  const t0 = performance.now();
  while (a.queue.length && performance.now() - t0 < 30000) await new Promise((r) => setTimeout(r, 100));
  const names = [...a.data.keys()];
  for (const n of ['click', 'pop', 'cow', 'zombie', 'explode', 'mat_stone', 'thunder']) a.play(n, null, null, null, 0.1);
  a.playPiece('overworld');
  return { left: a.queue.length, synthesized: names.length, ctx: a.ctx && a.ctx.state, ms: Math.round(performance.now() - t0) };
});
console.log('audio', JSON.stringify(audio));

await page.evaluate(() => window.game.newWorld({ name: 'Shader', seed: '777', gamemode: 'creative', bonus: false }));
console.log('playing:', await wait(() => window.game.state === 'playing', 120000));
await page.waitForTimeout(4000);

const shot = async (name, setup, ms = 1500, arg = null) => {
  await page.evaluate(setup, arg);
  await page.waitForTimeout(ms);
  await page.screenshot({ path: join(shots, name + '.png') });
};
// panorama au soleil
console.log('fps0', await page.evaluate(() => window.game.fps));
await shot('sh_day', () => { const g = window.game; g.time = 3000; g.settings.doDaylightCycle = false; g.player.flying = true; g.player.y += 6; g.player.pitch = -0.25; g.player.yaw = 0.8; }, 4000);
await shot('sh_day2', () => { const g = window.game; g.player.yaw = 2.6; g.player.pitch = -0.45; }, 2500);
await shot('sh_sunset', () => { const g = window.game; g.time = 11800; g.player.yaw = -Math.PI / 2; g.player.pitch = 0.05; }, 2500);
await shot('sh_night', () => { const g = window.game; g.time = 17000; g.player.pitch = -0.2; }, 2000);
// eau : cherche un bloc d'eau proche
const water = await page.evaluate(() => {
  const g = window.game, w = g.world, p = g.player;
  for (let r = 0; r < 60; r++) for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
    const x = Math.floor(p.x) + dx, z = Math.floor(p.z) + dz;
    for (let y = 70; y > 50; y--) if (w.getBlock(x, y, z) === 9 || w.getBlock(x, y, z) === 8) return [x, y, z];
  }
  return null;
});
console.log('water', water);
if (water) await shot('sh_water', (wp) => { const g = window.game; g.time = 2500; const p = g.player; p.x = wp[0] + 6.5; p.z = wp[2] + 6.5; p.y = wp[1] + 4; p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z; p.yaw = Math.PI * 0.75; p.pitch = -0.45; }, 3000, water);
// ombres : plateforme flottante au-dessus du sol
await shot('sh_shadow', () => {
  const g = window.game, w = g.world, p = g.player;
  g.time = 4500;
  const x0 = Math.floor(p.x) - 30, z0 = Math.floor(p.z) - 30, y = 100;
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) w.setBlock(x0 + dx, y, z0 + dz, 1);
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (Math.abs(dx) === 3 || Math.abs(dz) === 3 || (dx === 0 && dz === 0)) w.setBlock(x0 + dx, y + 5, z0 + dz, 1);
  p.x = x0 + 0.5; p.z = z0 + 12.5; p.y = y + 12; p.prevX = p.x; p.prevY = p.y; p.prevZ = p.z;
  p.yaw = 0; p.pitch = -0.8;
}, 6000);
await shot('sh_leaves_nowave', () => { const g = window.game; g.settings.shaderWaving = false; }, 2500);
await page.evaluate(() => { window.game.settings.shaderWaving = true; });
const stats = await page.evaluate(() => ({ fps: window.game.fps, fancy: !!window.game.renderer.fancy, err: window.game.renderer.fancyError, float: window.game.renderer.fancy && window.game.renderer.fancy.floatOK, shadow: window.game.renderer.fancy && window.game.renderer.fancy.lastShadow }));
console.log('stats', JSON.stringify(stats));
// options : onglets
await page.evaluate(() => { window.game.ui.openOptions(() => window.game.ui.resume(), 'shaders'); });
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'sh_opt_shaders.png') });
await page.evaluate(() => { window.game.ui.openOptions(() => window.game.ui.resume(), 'controls'); });
await page.waitForTimeout(400);
await page.screenshot({ path: join(shots, 'sh_opt_controls.png') });
console.log('errors:', errors.length ? errors.slice(0, 15).join('\n') : 'none');
await browser.close();
server.close();
