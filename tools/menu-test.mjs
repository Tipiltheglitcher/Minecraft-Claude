// Test des menus par de vrais clics
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
const url = `http://localhost:${server.address().port}/${process.argv[2] || 'index.html'}`;
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message));
page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('Failed to load resource')) errors.push(m.text()); });
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.goto(url);
await page.waitForTimeout(1200);
const click = async (text) => { await page.getByRole('button', { name: text, exact: true }).first().click(); await page.waitForTimeout(400); };
const shot = (n) => page.screenshot({ path: join(shots, n + '.png') });
let ok = true;
const step = async (name, fn) => { try { await fn(); console.log('  OK  ' + name); } catch (e) { ok = false; console.log(' ÉCHEC ' + name + ' — ' + e.message.split('\n')[0]); } };
await step('options depuis le titre', async () => { await click('Options'); await shot('m_options'); await click('Terminé'); });
await step('guide', async () => { await click('Guide de survie'); await shot('m_guide'); await click('Retour'); });
await step('crédits', async () => { await click('Crédits'); await page.waitForTimeout(1500); await shot('m_credits'); await page.keyboard.press('Escape'); await page.waitForTimeout(300); });
await step('créer un monde', async () => {
  await click('Solo');
  await click('Nouveau monde');
  await page.locator('.form input').first().fill('Mon monde');
  await shot('m_create');
  await click('Créer le monde');
  await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 120000 });
  await page.waitForTimeout(1500);
  await shot('m_play');
});
await step('pause', async () => { await page.evaluate(() => window.game.ui.openPause()); await page.waitForTimeout(300); await shot('m_pause'); });
await step('progrès', async () => { await click('Progrès'); await shot('m_adv'); await click('Terminé'); });
await step('chat /help', async () => {
  await click('Reprendre la partie');
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  await page.keyboard.type('/help');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const n = await page.evaluate(() => window.game.ui.chatLines.length);
  if (n < 10) throw new Error('lignes=' + n);
  await shot('m_chat');
});
await step('inventaire au clavier (E)', async () => {
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
  if (!(await page.evaluate(() => !!window.game.ui.screen))) throw new Error('pas ouvert');
  await page.keyboard.press('KeyE');
  await page.waitForTimeout(300);
});
await step('Échap dans l\'inventaire et la table de craft met le jeu en pause', async () => {
  for (const open of ['KeyE', 'craft']) {
    if (open === 'KeyE') await page.keyboard.press('KeyE');
    else await page.evaluate(() => window.game.ui.openCrafting());
    await page.waitForTimeout(300);
    if (!(await page.evaluate(() => !!window.game.ui.screen))) throw new Error('écran non ouvert (' + open + ')');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const st = await page.evaluate(() => ({ screen: !!window.game.ui.screen, paused: window.game.paused, pause: !!(window.game.ui.menu && window.game.ui.menu.isPause) }));
    if (st.screen || !st.paused || !st.pause) throw new Error(JSON.stringify(st));
    await click('Reprendre la partie');
  }
});
await step('Échap dans le chat met le jeu en pause', async () => {
  await page.keyboard.press('KeyT');
  await page.waitForTimeout(200);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  const st = await page.evaluate(() => ({ chat: window.game.ui.chatOpen, paused: window.game.paused }));
  if (st.chat || !st.paused) throw new Error(JSON.stringify(st));
  await click('Reprendre la partie');
});
await step('changer une touche (Avancer -> I) et s\'en servir', async () => {
  await page.evaluate(() => window.game.ui.openPause());
  await page.waitForTimeout(200);
  await click('Options');
  await click('Commandes');
  await shot('m_controls');
  const row = page.locator('.keyrow', { hasText: 'Avancer' }).first();
  await row.locator('button').click();
  await page.waitForTimeout(200);
  await page.keyboard.press('KeyI');
  await page.waitForTimeout(200);
  const k = await page.evaluate(() => window.game.settings.keys.forward);
  if (k !== 'KeyI') throw new Error('touche=' + k);
  await click('Terminé');
  await click('Reprendre la partie');
  const z0 = await page.evaluate(() => window.game.player.z);
  await page.keyboard.down('KeyI');
  await page.waitForTimeout(1500);
  await page.keyboard.up('KeyI');
  const z1 = await page.evaluate(() => window.game.player.z);
  if (Math.abs(z1 - z0) < 0.3 && (await page.evaluate(() => Math.abs(window.game.player.x - window.game.player.prevX))) < 0.01) {
    const moved = await page.evaluate(() => window.game.player.walkDist);
    if (!moved) throw new Error('le joueur ne bouge pas');
  }
  await page.evaluate(() => { const g = window.game; g.settings.keys.forward = 'KeyW'; g.saveSettings(); });
});
await step('onglets des options (vidéo, shaders, son, jeu)', async () => {
  await page.evaluate(() => window.game.ui.openPause());
  await page.waitForTimeout(200);
  await click('Options');
  for (const t of ['Shaders', 'Son', 'Jeu', 'Vidéo']) { await click(t); await shot('m_opt_' + t); }
  await click('Terminé');
  await click('Reprendre la partie');
});
await step('sauvegarder et quitter puis recharger', async () => {
  await page.evaluate(() => window.game.ui.openPause());
  await page.waitForTimeout(200);
  await click('Sauvegarder et quitter');
  await page.waitForFunction(() => window.game.state === 'menu', null, { timeout: 30000 });
  await click('Solo');
  await page.waitForTimeout(500);
  await shot('m_worlds');
  await page.locator('.world').first().click();
  await click('Jouer');
  await page.waitForFunction(() => window.game.state === 'playing', null, { timeout: 120000 });
});
console.log(ok ? 'Tous les menus fonctionnent' : 'Des étapes ont échoué');
for (const e of errors) console.log(e);
await browser.close();
server.close();
process.exit(ok && !errors.length ? 0 : 1);
