// Test de la musique : morceau au menu, enchaînement en jeu, changement d'ambiance
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
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const page = await browser.newPage({ viewport: { width: 640, height: 360 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.goto(`http://localhost:${server.address().port}/${process.argv[2] || 'index.html'}`);
await page.waitForTimeout(800);
const state = () => page.evaluate(() => { const a = window.game.audio, M = a.music, t = a.ctx.currentTime; return { mood: M.mood, playing: !!M.bus && t < M.endAt, left: +(M.endAt - t).toFixed(1), next: +(M.nextAt - t).toFixed(1), nodes: M.nodes.length }; });
let ok = true;
const check = (name, cond, info) => { console.log((cond ? '  OK  ' : ' ÉCHEC ') + name + ' — ' + JSON.stringify(info)); if (!cond) ok = false; };
await page.evaluate(() => window.game.audio.init());
await page.waitForTimeout(6000);
let st = await state();
check('musique au menu', st.mood === 'menu' && st.playing, st);
await page.evaluate(() => window.game.newWorld({ name: 'M', seed: '5', gamemode: 'creative', bonus: false }));
await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 120000 });
await page.waitForTimeout(8000);
st = await state();
check('enchaînement vers la musique de la Surface', st.mood === 'overworld' && st.playing, st);
// fin du morceau : le suivant démarre après une courte pause
await page.evaluate(() => { const a = window.game.audio; a.fadeMusic(0.2); a.music.nextAt = a.ctx.currentTime + 1; });
await page.waitForTimeout(5000);
st = await state();
check('le morceau suivant démarre tout seul', st.playing, st);
check('pas d\'erreur', !errors.length, errors);
await browser.close();
server.close();
process.exit(ok ? 0 : 1);
