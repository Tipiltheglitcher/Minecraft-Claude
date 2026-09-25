// Test de logique : rejoue la progression complète via l'API du jeu
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
const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width: 1024, height: 640 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('[pageerror] ' + e.message + '\n' + e.stack));
await page.route('**/fonts.googleapis.com/**', (r) => r.abort());
await page.goto(`http://localhost:${port}/${process.argv[2] || 'index.html'}`);
await page.waitForTimeout(1000);
const waitFor = async (fn, ms = 120000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (await page.evaluate(fn)) return true; await page.waitForTimeout(250); }
  return false;
};
await page.evaluate(() => window.game.newWorld({ name: 'Logique', seed: '4242', gamemode: 'survival', bonus: false }));
console.log('monde prêt :', await waitFor(() => window.game.state === 'playing'));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { if (ok) pass++; else fail++; console.log((ok ? '  OK  ' : ' ÉCHEC ') + name + (extra ? ' — ' + extra : '')); };

// Utilitaire côté page : ticks rapides
await page.evaluate(() => {
  window.T = (n) => { const g = window.game; for (let i = 0; i < n; i++) g.tick(); };
  window.ids = {};
});


const R = (fn, arg) => page.evaluate(fn, arg);
await R(async () => {
  const mods = {};
  mods.ids = await import('./src/data/ids.js');
  window.B = mods.ids.B; window.I = mods.ids.I;
  const g = window.game, w = g.world, p = g.player;
  // plateforme de test plate
  const x0 = Math.floor(p.x), y0 = Math.floor(p.y) + 20, z0 = Math.floor(p.z);
  for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) {
    w.setBlock(x0 + dx, y0 - 1, z0 + dz, window.B.grass_block, 0, false);
    for (let dy = 0; dy < 8; dy++) w.setBlock(x0 + dx, y0 + dy, z0 + dz, 0, 0, false);
  }
  p.setPos(x0 + 0.5, y0, z0 + 0.5);
  window.O = { x: x0, y: y0, z: z0 };
  window.T(5);
});

// Lit : dormir la nuit
const bed = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.inventory.slots[0] = { id: window.I.bed_item, count: 1 }; p.inventory.sel = 0;
  const ok = g.interaction.placeBlock({ x, y: y - 1, z: z + 2, id: window.B.grass_block, face: 4, hx: x + 0.5, hy: y, hz: z + 2.5 }, window.B.bed, p.inventory.slots[0]);
  g.time = 14000;
  const hasBed = w.getBlock(x, y, z + 2) === window.B.bed;
  g.interaction.useBlock({ x, y, z: z + 2, id: window.B.bed }, null);
  const slept = p.sleeping;
  window.T(110);
  return { ok, hasBed, slept, day: g.time % 24000, spawn: !!p.spawnPoint, adv: !!g.meta.advancements.sleep };
});
check('poser un lit', bed.ok && bed.hasBed, JSON.stringify(bed));
check('dormir passe la nuit', bed.slept && bed.day < 1000 && bed.adv);
check('le lit définit le point d\'apparition', bed.spawn);

// Porte
const door = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.inventory.slots[0] = { id: window.I.door_item, count: 1 };
  g.interaction.placeBlock({ x: x + 3, y: y - 1, z, id: window.B.grass_block, face: 4, hx: x + 3.5, hy: y, hz: z + 0.5 }, window.B.oak_door, p.inventory.slots[0]);
  const placed = w.getBlock(x + 3, y, z) === window.B.oak_door && w.getBlock(x + 3, y + 1, z) === window.B.oak_door;
  const m0 = w.getMeta(x + 3, y, z);
  g.interaction.useBlock({ x: x + 3, y: y + 1, z, id: window.B.oak_door }, null);
  const m1 = w.getMeta(x + 3, y, z), m2 = w.getMeta(x + 3, y + 1, z);
  w.breakBlock(x + 3, y, z, { player: p });
  return { placed, toggled: (m1 & 4) !== (m0 & 4) && (m2 & 4) === (m1 & 4), gone: w.getBlock(x + 3, y + 1, z) === 0 };
});
check('porte : pose sur 2 blocs', door.placed);
check('porte : ouverture des deux moitiés', door.toggled);
check('porte : casser une moitié retire l\'autre', door.gone);

// TNT
const tnt = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.creative = true;
  w.setBlock(x - 6, y, z - 6, window.B.tnt);
  for (let i = 1; i <= 2; i++) w.setBlock(x - 6 + i, y, z - 6, window.B.stone);
  g.interaction.useBlock({ x: x - 6, y, z: z - 6, id: window.B.tnt }, { id: window.I.flint_and_steel, count: 1 });
  const primed = w.entities.some((e) => e.type === 'tnt');
  window.T(90);
  return { primed, crater: w.getBlock(x - 6, y - 1, z - 6) === 0 || w.getBlock(x - 5, y, z - 6) === 0 };
});
check('TNT amorcée au briquet', tnt.primed);
check('explosion de TNT', tnt.crater);

// Creeper
const creeper = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.creative = false; p.health = 20; p.invuln = 0;
  const c = w.spawn('creeper', x + 1.5, y, z + 0.5);
  let t = 0;
  while (!c.removed && t < 120) { window.T(1); t++; }
  return { exploded: c.removed, hp: p.health, t };
});
check('le creeper explose près du joueur', creeper.exploded && creeper.hp < 20, JSON.stringify(creeper));
await R(() => { const g = window.game, p = g.player, { x, y, z } = window.O; if (p.dead) g.respawn(); p.setPos(x + 0.5, y, z + 0.5); p.health = 20; for (let dx = -12; dx <= 12; dx++) for (let dz = -12; dz <= 12; dz++) { g.world.setBlock(x + dx, y - 1, z + dz, window.B.grass_block, 0, false); for (let dy = 0; dy < 8; dy++) g.world.setBlock(x + dx, y + dy, z + dz, 0, 0, false); } window.T(2); });

// Squelette tire des flèches
const skel = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.health = 20; p.creative = false;
  g.time = 18000;
  const s = w.spawn('skeleton', x + 8.5, y, z + 0.5);
  let arrows = 0;
  for (let i = 0; i < 160; i++) { window.T(1); arrows = Math.max(arrows, w.entities.filter((e) => e.type === 'arrow').length); }
  s.removed = true;
  return { arrows, hp: p.health };
});
check('le squelette tire des flèches', skel.arrows > 0, JSON.stringify(skel));
await R(() => { const g = window.game, p = g.player, { x, y, z } = window.O; p.health = 20; g.world.entities.filter((e) => e.hostile || e.type === 'arrow').forEach((e) => (e.removed = true)); p.setPos(x + 0.5, y, z + 0.5); p.vx = p.vy = p.vz = 0; window.T(2); });

// Zombie : recherche de chemin autour d'un mur
const zombie = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  p.creative = false;
  for (let dz = -3; dz <= 3; dz++) for (let dy = 0; dy < 3; dy++) w.setBlock(x + 4, y + dy, z + dz, window.B.stone);
  const zb = w.spawn('zombie', x + 7.5, y, z + 0.5);
  zb.helmet = true;
  const d0 = Math.hypot(zb.x - p.x, zb.z - p.z);
  for (let i = 0; i < 200; i++) { p.health = 20; window.T(1); }
  const d1 = Math.hypot(zb.x - p.x, zb.z - p.z);
  zb.removed = true;
  return { d0: +d0.toFixed(1), d1: +d1.toFixed(1) };
});
check('le zombie contourne un mur pour atteindre le joueur', zombie.d1 < 2.5, JSON.stringify(zombie));

// Seau d'eau / lave
const bucket = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  w.entities.filter((e) => e.hostile || e.type === 'arrow').forEach((e) => (e.removed = true));
  p.setPos(x + 0.5, y, z + 0.5); p.vx = p.vy = p.vz = 0; p.onGround = true;
  p.creative = false; p.yaw = 0; p.pitch = -1.2;
  p.inventory.slots[0] = { id: window.I.water_bucket, count: 1 }; p.inventory.sel = 0;
  g.interaction.useBucket(p.inventory.slots[0], { liquid: window.B.water });
  window.T(40);
  const tx = x, tz = z - 1;
  let water = 0;
  for (let dx = -4; dx <= 4; dx++) for (let dz = -5; dz <= 3; dz++) if (w.getBlock(x + dx, y, z + dz) === window.B.water) water++;
  const emptyNow = p.inventory.slots[0] && p.inventory.slots[0].id === window.I.bucket;
  // reprendre la source : regarder droit vers elle
  p.setPos(x + 0.5, y + 1, z - 0.5); p.pitch = -Math.PI / 2 + 0.01; p.vx = p.vy = p.vz = 0;
  g.interaction.useBucket(p.inventory.slots[0], {});
  p.setPos(x + 0.5, y, z + 0.5);
  return { water, emptyNow, refilled: p.inventory.slots[0].id === window.I.water_bucket, tx, tz };
});
check('vider un seau d\'eau : l\'eau s\'écoule', bucket.water > 3 && bucket.emptyNow, JSON.stringify(bucket));
check('reprendre l\'eau source', bucket.refilled);
await R(() => { const { x, y, z } = window.O; const w = window.game.world; for (let dx = -8; dx <= 8; dx++) for (let dz = -8; dz <= 8; dz++) if (w.getBlock(x + dx, y, z + dz) === window.B.water) w.setBlock(x + dx, y, z + dz, 0, 0, false); });

// Agriculture
const farm = await R(() => {
  const g = window.game, w = g.world, p = g.player, { x, y, z } = window.O;
  const fx = x - 3, fz = z + 5;
  p.inventory.slots[0] = { id: window.I.wooden_hoe, count: 1 };
  g.interaction.useItemOnBlock({ x: fx, y: y - 1, z: fz, id: window.B.grass_block, face: 4 }, p.inventory.slots[0], { use: 'hoe' });
  const tilled = w.getBlock(fx, y - 1, fz) === window.B.farmland;
  p.inventory.slots[0] = { id: window.I.wheat_seeds, count: 5 };
  g.interaction.useItemOnBlock({ x: fx, y: y - 1, z: fz, id: window.B.farmland, face: 4 }, p.inventory.slots[0], { plant: window.B.wheat });
  const planted = w.getBlock(fx, y, fz) === window.B.wheat;
  for (let i = 0; i < 6; i++) g.interaction.boneMeal(fx, y, fz, window.B.wheat);
  const ripe = w.getMeta(fx, y, fz) === 7;
  w.breakBlock(fx, y, fz, { player: p });
  const wheat = w.entities.some((e) => e.type === 'item' && e.stack.id === window.I.wheat_item);
  return { tilled, planted, ripe, wheat };
});
check('houe : terre labourée', farm.tilled);
check('planter des graines', farm.planted);
check('poudre d\'os : blé mûr', farm.ripe);
check('récolte du blé', farm.wheat);

// Pousse d'arbre + poudre d'os
const tree = await R(async () => {
  const { growTree } = await import('./src/world/updates.js');
  const g = window.game, w = g.world, { x, y, z } = window.O;
  w.setBlock(x + 8, y, z + 8, window.B.oak_sapling);
  const ok = growTree(w, x + 8, y, z + 8, window.B.oak_sapling);
  return ok && w.getBlock(x + 8, y + 1, z + 8) === window.B.oak_log;
});
check('une pousse devient un arbre', tree);

// Apparition de monstres la nuit
const spawn = await R(() => {
  const g = window.game, w = g.world;
  g.time = 18000;
  w.entities.filter((e) => e.hostile).forEach((e) => (e.removed = true));
  window.T(1);
  for (let i = 0; i < 600; i++) g.spawner.tick();
  return w.countEntities((e) => e.hostile);
});
check('des monstres apparaissent la nuit', spawn > 0, 'monstres=' + spawn);

// Générateur de monstres
const spawner = await R(() => {
  const g = window.game, w = g.world, { x, y, z } = window.O;
  g.player.setPos(x + 0.5, y, z + 0.5); g.player.vx = g.player.vz = 0;
  w.entities.filter((e) => e.hostile).forEach((e) => (e.removed = true));
  w.setBlock(x + 5, y, z - 5, window.B.spawner);
  w.setBlockEntity(x + 5, y, z - 5, { type: 'spawner', mob: 'zombie', delay: 5 });
  window.T(40);
  return w.countEntities((e) => e.type === 'zombie' && Math.hypot(e.x - x - 5, e.z - z + 5) < 14);
});
check('le générateur fait apparaître des zombies', spawner > 0, 'zombies=' + spawner);
await R(() => { const { x, y, z } = window.O; window.game.world.setBlock(x + 5, y, z - 5, 0); window.game.world.entities.filter((e) => e.hostile).forEach((e) => (e.removed = true)); window.game.time = 6000; window.game.player.health = 20; });

// Enchantement
const ench = await R(async () => {
  const { EnchantScreen } = await import('./src/ui/containers.js');
  const g = window.game, p = g.player, { x, y, z } = window.O;
  g.world.setBlock(x - 2, y, z - 2, window.B.enchanting_table);
  p.xpLevel = 30; p.creative = false;
  const scr = new EnchantScreen(g.ui, { x: x - 2, y, z: z - 2 });
  scr.item = { id: window.I.diamond_pickaxe, count: 1 };
  scr.lapis = { id: window.I.lapis_lazuli, count: 3 };
  scr.refresh();
  const btn = scr.opts.children[2];
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return { ench: scr.item.ench, lvl: p.xpLevel, lapis: scr.lapis ? scr.lapis.count : 0 };
});
check('enchantement d\'une pioche', ench.ench && Object.keys(ench.ench).length > 0 && ench.lvl === 27, JSON.stringify(ench));

// Livre enchanté + objet dans la grille
const book = await R(async () => {
  const { CraftingScreen } = await import('./src/ui/containers.js');
  const g = window.game;
  const scr = new CraftingScreen(g.ui, 2, 'x');
  scr.grid[0] = { id: window.I.iron_sword, count: 1 };
  scr.grid[1] = { id: window.I.enchanted_book, count: 1, ench: { sharpness: 3 } };
  scr.updateResult();
  return scr.result && scr.result.ench && scr.result.ench.sharpness === 3;
});
check('livre enchanté appliqué à une épée', book);

// Commerce
const trade = await R(async () => {
  const { TradeScreen } = await import('./src/ui/containers.js');
  const g = window.game, p = g.player, { x, y, z } = window.O;
  const v = g.world.spawn('villager', x + 2, y, z + 2, { profession: 'cleric' });
  p.inventory.clear();
  p.inventory.add({ id: window.I.emerald, count: 10 });
  const scr = new TradeScreen(g.ui, v);
  const t = v.trades.findIndex((tr) => tr.sell[0] === window.I.ender_pearl);
  const btn = scr.list.children[t].querySelector('button');
  btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  v.removed = true;
  return { pearls: p.inventory.count(window.I.ender_pearl), emeralds: p.inventory.count(window.I.emerald) };
});
check('acheter une perle de l\'Ender au prêtre', trade.pearls === 1 && trade.emeralds === 5, JSON.stringify(trade));

// Alambic
const brew = await R(() => {
  const g = window.game, w = g.world, { x, y, z } = window.O;
  w.setBlock(x - 4, y, z + 4, window.B.brewing_stand);
  const be = { type: 'brewing', items: [{ id: window.I.potion, count: 1, potion: 'water' }, null, null, { id: window.I.nether_wart, count: 1 }, { id: window.I.blaze_powder, count: 1 }], brew: 0, fuel: 0 };
  w.setBlockEntity(x - 4, y, z + 4, be);
  window.T(410);
  const awk = be.items[0].potion;
  be.items[3] = { id: window.I.ghast_tear, count: 1 };
  window.T(410);
  return { awk, final: be.items[0].potion, adv: !!g.meta.advancements.brew };
});
check('potion étrange puis de régénération', brew.awk === 'awkward' && brew.final === 'regeneration' && brew.adv, JSON.stringify(brew));

// Mort et réapparition
const death = await R(async () => {
  const g = window.game, p = g.player;
  p.creative = false;
  p.inventory.clear();
  p.inventory.slots[0] = { id: window.I.diamond, count: 3 };
  const pre = { dead: p.dead, removed: p.removed, hp: p.health, gm: p.gamemode, creative: p.creative };
  const ok = p.damage(1000, { type: 'void', bypassArmor: true, noInvuln: true });
  const dead = p.dead;
  const dropped = g.world.entities.some((e) => e.type === 'item' && e.stack.id === window.I.diamond);
  g.respawn();
  return { ok, pre, dead, dropped, alive: !p.dead && p.health === 20 };
});
check('mort : objets lâchés', death.dead && death.dropped, JSON.stringify(death));
check('réapparition', death.alive);

// Commandes
const cmd = await R(async () => {
  const { runCommand } = await import('./src/game/commands.js');
  const g = window.game;
  const a = runCommand(g, '/give diamond 5');
  const b = runCommand(g, '/time set nuit');
  const c = runCommand(g, '/locate fort');
  return { give: g.player.inventory.count(window.I.diamond) >= 5, time: g.time % 24000 === 13000, loc: c.includes('Fort'), a, c };
});
check('commandes /give /time /locate', cmd.give && cmd.time && cmd.loc, JSON.stringify(cmd));
console.log(`\n${pass} réussis, ${fail} échecs`);
console.log('--- erreurs console (' + errors.length + ') ---');
for (const e of errors.slice(0, 30)) console.log(e);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
