// Test de fumée : lance le jeu dans Chromium headless, crée un monde, joue un peu et fait des captures
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
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
const scenario = process.argv[2] || 'basic';
const page0 = process.argv[3] || '/index.html';

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome') ? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') errors.push('[' + m.type() + '] ' + m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.goto(`http://localhost:${port}${page0}`);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(shots, 'title.png') });

const wait = async (fn, ms = 60000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (await page.evaluate(fn)) return true;
    await page.waitForTimeout(250);
  }
  return false;
};

const seed = process.argv[4] || '12345';
await page.evaluate((seed) => window.game.newWorld({ name: 'Test', seed, gamemode: 'survival', bonus: true }), seed);
const ok = await wait(() => window.game.state === 'playing', 120000);
console.log('playing:', ok);
await page.waitForTimeout(3000);
const info = await page.evaluate(() => {
  const g = window.game;
  return { pos: [g.player.x, g.player.y, g.player.z], chunks: g.world.chunks.size, ents: g.world.entities.length, fps: g.fps, drawn: g.renderer.stats.drawn };
});
console.log(JSON.stringify(info));
await page.screenshot({ path: join(shots, 'play1.png') });

if (scenario === 'tour') {
  // vues variées
  const views = [[0, -0.3], [Math.PI / 2, 0], [Math.PI, 0.2], [-Math.PI / 2, -0.6]];
  let i = 0;
  for (const [yaw, pitch] of views) {
    await page.evaluate(([y, p]) => { window.game.player.yaw = y; window.game.player.pitch = p; }, [yaw, pitch]);
    await page.waitForTimeout(1200);
    await page.screenshot({ path: join(shots, 'view' + i++ + '.png') });
  }
}
if (scenario === 'ui') {
  await page.evaluate(() => window.game.ui.openInventory());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'inventory.png') });
  await page.evaluate(() => window.game.ui.closeScreen());
  await page.evaluate(() => window.game.ui.openCrafting());
  await page.waitForTimeout(500);
  await page.screenshot({ path: join(shots, 'crafting.png') });
  await page.evaluate(() => window.game.ui.closeScreen());
  await page.evaluate(() => { window.game.setGamemode('creative'); window.game.ui.openInventory(); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, 'creative.png') });
  await page.evaluate(() => { window.game.ui.closeScreen(); window.game.setGamemode('survival'); window.game.ui.openPause(); });
  await page.waitForTimeout(300);
  await page.screenshot({ path: join(shots, 'pause.png') });
  await page.evaluate(() => window.game.ui.resume());
}
if (scenario === 'mobs') {
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    const types = ['pig', 'cow', 'sheep', 'chicken', 'zombie', 'skeleton', 'creeper', 'spider', 'enderman', 'villager', 'iron_golem'];
    p.yaw = 0; p.pitch = -0.15;
    const w = g.world, x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z);
    for (let dx = -14; dx <= 14; dx++) for (let dz = -14; dz <= 2; dz++) {
      w.setBlock(x0 + dx, y0 - 1, z0 + dz, 2, 0, false);
      for (let dy = 0; dy < 6; dy++) w.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0, false);
    }
    p.setPos(x0 + 0.5, y0, z0 + 0.5);
    types.forEach((t, i) => { const e = w.spawn(t, x0 - 10 + i * 2 + 0.5, y0, z0 - 8 + (i % 2) * 2, {}); if (e) { e.persistent = true; e.despawnable = false; e.noAI = true; } });
    g.setGamemode('creative');
    g.time = 6000;
  });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, 'mobs.png') });
}
if (scenario === 'nether' || scenario === 'end') {
  await page.evaluate((d) => { window.game.setGamemode('creative'); window.game.travelTo(d); }, scenario);
  await page.waitForTimeout(6000);
  await page.evaluate(() => { const p = window.game.player; p.pitch = -0.1; p.flying = true; p.setPos(p.x, p.y + 1, p.z + 3); p.yaw = 0; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, scenario + '.png') });
  if (scenario === 'nether') {
    await page.evaluate(() => {
      const g = window.game, p = g.player;
      const types = ['blaze', 'ghast', 'piglin', 'wither_skeleton', 'magma_cube'];
      types.forEach((t, i) => g.world.spawn(t, p.x - 6 + i * 3, p.y + 2, p.z - 8, {}));
    });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: join(shots, 'nether_mobs.png') });
  }
  if (scenario === 'end') {
    await page.evaluate(() => { const p = window.game.player; p.flying = true; p.setPos(60, 90, 0); p.yaw = Math.PI / 2; p.pitch = -0.2; });
    await page.waitForTimeout(4000);
    await page.screenshot({ path: join(shots, 'end_center.png') });
  }
}
if (scenario === 'night') {
  await page.evaluate(() => { window.game.time = 14000; window.game.player.pitch = 0.3; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'night.png') });
  await page.evaluate(() => { window.game.time = 12300; window.game.player.pitch = 0.05; window.game.player.yaw = Math.PI / 2; });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'sunset.png') });
}
if (scenario === 'stronghold') {
  await page.evaluate(() => {
    const g = window.game;
    g.setGamemode('creative');
    const sh = g.world.gen.stronghold.portalCenter;
    g.player.flying = true;
    g.player.setPos(sh.x + 0.5, sh.y + 1, sh.z - 5);
    g.player.yaw = Math.PI; g.player.pitch = -0.3;
  });
  await page.waitForTimeout(8000);
  await page.screenshot({ path: join(shots, 'stronghold.png') });
}


if (scenario === 'village') {
  const r = await page.evaluate(() => {
    const g = window.game, p = g.player;
    g.setGamemode('creative');
    const gen = g.world.gen;
    const list = gen.villagesNear(p.x - 2000, p.z - 2000, p.x + 2000, p.z + 2000);
    if (!list.length) return 'aucun village';
    const v = list.sort((a, b) => Math.hypot(a.center.x - p.x, a.center.z - p.z) - Math.hypot(b.center.x - p.x, b.center.z - p.z))[0];
    p.flying = true;
    p.setPos(v.center.x + 18, v.center.y + 14, v.center.z + 18);
    p.yaw = Math.atan2(18, 18); p.pitch = -0.45;
    g.time = 5000;
    return 'village ' + v.center.x + ',' + v.center.z;
  });
  console.log(r);
  await page.waitForTimeout(14000);
  await page.screenshot({ path: join(shots, 'village.png') });
}
if (scenario === 'cave') {
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    g.setGamemode('spectator');
    p.setPos(p.x, 30, p.z);
    p.pitch = -0.2;
    p.inventory.slots[0] = { id: 33, count: 64 };
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(shots, 'cave.png') });
}
if (scenario === 'water') {
  await page.evaluate(() => {
    const g = window.game, p = g.player;
    g.setGamemode('creative');
    p.flying = true;
    p.setPos(p.x - 40, 60, p.z);
    p.pitch = 0;
  });
  await page.waitForTimeout(5000);
  await page.screenshot({ path: join(shots, 'water.png') });
}

if (scenario === 'items') {
  await page.evaluate(() => {
    const g = window.game, p = g.player, w = g.world;
    const x0 = Math.floor(p.x), y0 = Math.floor(p.y), z0 = Math.floor(p.z);
    for (let dx = -6; dx <= 6; dx++) for (let dz = -8; dz <= 2; dz++) { w.setBlock(x0 + dx, y0 - 1, z0 + dz, 1, 0, false); for (let dy = 0; dy < 5; dy++) w.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0, false); }
    p.setPos(x0 + 0.5, y0, z0 + 0.5); p.yaw = 0; p.pitch = -0.5;
    const ids = [4, 2, 256 + 38, 256 + 5, 256 + 60, 33, 256 + 17, 50];
    ids.forEach((id, i) => { const e = w.dropItem(x0 - 3 + i + 0.5, y0 + 0.5, z0 - 3.5, { id, count: 1 }, [0, 0, 0]); e.pickupDelay = 99999; });
    w.setBlock(x0, y0, z0 - 2, 1, 0);
    g.target = { x: x0, y: y0, z: z0 - 2, id: 1, face: 1 };
    g.breakProgress = 0.55;
    p.inventory.slots[0] = { id: 256 + 38, count: 1, ench: { efficiency: 3 } };
    p.inventory.slots[1] = { id: 4, count: 32 };
    p.inventory.slots[2] = { id: 256 + 17, count: 1 };
    p.inventory.slots[3] = { id: 256 + 76, count: 5 };
    p.inventory.sel = 0;
    g.time = 6000;
    g.setGamemode('creative');
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: join(shots, 'items.png') });
  await page.evaluate(() => { const g = window.game; g.player.inventory.sel = 1; });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(shots, 'items_block.png') });
  await page.evaluate(() => { const g = window.game; g.setGamemode('survival'); g.world.spawn('zombie', g.player.x, g.player.y, g.player.z - 3); const be = { type: 'chest', items: new Array(27).fill(null) }; be.items[0] = { id: 264, count: 5 }; be.items[4] = { id: 4, count: 64 }; g.ui.openChest(be, null); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shots, 'chest.png') });
  await page.evaluate(() => { const g = window.game; g.ui.closeScreen(); g.ui.openFurnace({ type: 'furnace', items: [{ id: 13, count: 3 }, { id: 257, count: 2 }, { id: 259, count: 1 }], burn: 800, burnMax: 1600, cook: 120, xp: 0 }, null); });
  await page.waitForTimeout(700);
  await page.screenshot({ path: join(shots, 'furnace.png') });
  await page.evaluate(() => { const g = window.game; g.ui.closeScreen(); g.player.damage(1000, { type: 'mob', entity: g.world.entities.find((e) => e.type === 'zombie'), bypassArmor: true, noInvuln: true }); });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: join(shots, 'death.png') });
}

const final = await page.evaluate(() => ({ fps: window.game.fps, state: window.game.state }));
console.log('final', JSON.stringify(final));
console.log('--- erreurs (' + errors.length + ') ---');
for (const e of errors.slice(0, 40)) console.log(e);
await browser.close();
server.close();
