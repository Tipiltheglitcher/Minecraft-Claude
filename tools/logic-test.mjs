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

// 1. Artisanat
const craft = await page.evaluate(async () => {
  const { findRecipe } = await import('./src/data/recipes.js');
  const { B, I } = await import('./src/data/ids.js');
  const r = (grid, w) => { const x = findRecipe(grid, w, w); return x ? x.result.id : 0; };
  return {
    planks: r([B.oak_log, 0, 0, 0], 2) === B.oak_planks,
    sticks: r([B.oak_planks, 0, B.oak_planks, 0], 2) === I.stick,
    table: r([B.oak_planks, B.birch_planks, B.spruce_planks, B.oak_planks], 2) === B.crafting_table,
    pick: r([B.cobblestone, B.cobblestone, B.cobblestone, 0, I.stick, 0, 0, I.stick, 0], 3) === I.stone_pickaxe,
    furnace: r([B.cobblestone, B.cobblestone, B.cobblestone, B.cobblestone, 0, B.cobblestone, B.cobblestone, B.cobblestone, B.cobblestone], 3) === B.furnace,
    axeMirror: r([0, B.oak_planks, B.oak_planks, 0, I.stick, B.oak_planks, 0, I.stick, 0], 3) === I.wooden_axe,
    eye: r([I.ender_pearl, 0, 0, I.blaze_powder], 2) === I.ender_eye,
    flint: r([0, I.iron_ingot, I.flint, 0], 2) === I.flint_and_steel,
    bed: r([B.white_wool, B.white_wool, B.white_wool, B.oak_planks, B.oak_planks, B.oak_planks, 0, 0, 0], 3) === I.bed_item,
    bow: r([0, I.stick, I.string, I.stick, 0, I.string, 0, I.stick, I.string], 3) === I.bow,
  };
});
for (const [k, v] of Object.entries(craft)) check('recette ' + k, v);

// 2. Four
const furnace = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  const x = Math.floor(p.x) + 2, y = Math.floor(p.y), z = Math.floor(p.z);
  w.setBlock(x, y, z, B.furnace, 0);
  const be = { type: 'furnace', items: [{ id: B.iron_ore, count: 3 }, { id: I.coal, count: 1 }, null], burn: 0, burnMax: 0, cook: 0, xp: 0 };
  w.setBlockEntity(x, y, z, be);
  window.T(3 * 200 + 20);
  return { out: be.items[2], lit: w.getBlock(x, y, z) };
});
check('four : 3 lingots de fer', furnace.out && furnace.out.count === 3, JSON.stringify(furnace.out));

// 3. Minage avec outils
const mining = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const { BLOCKS } = await import('./src/data/blocks.js');
  const g = window.game, it = g.interaction, p = g.player;
  const t = (id, tool) => { p.inventory.slots[0] = tool ? { id: tool, count: 1 } : null; p.inventory.sel = 0; p.onGround = true; const s = it.breakSpeed(BLOCKS[id], p.inventory.slots[0]); return s > 0 ? +(1 / s / 20).toFixed(2) : -1; };
  return { stoneHand: t(B.stone), stoneWood: t(B.stone, I.wooden_pickaxe), obsDiamond: t(B.obsidian, I.diamond_pickaxe), dirtHand: t(B.dirt), logAxe: t(B.oak_log, I.stone_axe), bedrock: t(B.bedrock, I.diamond_pickaxe) };
});
check('temps pierre à la main ≈ 7,5 s', Math.abs(mining.stoneHand - 7.5) < 0.1, JSON.stringify(mining));
check('temps pierre pioche bois ≈ 1,15 s', Math.abs(mining.stoneWood - 1.15) < 0.1);
check('temps obsidienne pioche diamant ≈ 9,4 s', Math.abs(mining.obsDiamond - 9.4) < 0.1);
check('bedrock incassable', mining.bedrock === -1);

// 4. Casser un bloc produit un objet
const drops = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  const x = Math.floor(p.x) - 2, y = Math.floor(p.y), z = Math.floor(p.z);
  w.setBlock(x, y, z, B.stone);
  const before = w.entities.filter((e) => e.type === 'item').length;
  w.breakBlock(x, y, z, { player: p, tool: { id: I.wooden_pickaxe, count: 1 } });
  const items = w.entities.filter((e) => e.type === 'item');
  const cob = items.find((e) => e.stack.id === B.cobblestone);
  w.setBlock(x, y, z, B.stone);
  w.breakBlock(x, y, z, { player: p, tool: null });
  const none = w.entities.filter((e) => e.type === 'item').length === items.length;
  return { cob: !!cob, none, before };
});
check('pierre + pioche → pierre taillée', drops.cob);
check('pierre à la main → rien', drops.none);

// 5. Ramassage
const pickup = await page.evaluate(async () => {
  const { B } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  p.inventory.clear();
  const e = w.dropItem(p.x, p.y + 0.5, p.z, { id: B.oak_log, count: 5 });
  e.pickupDelay = 0;
  window.T(20);
  return p.inventory.count(B.oak_log);
});
check('ramassage d\'objets', pickup === 5, 'bûches=' + pickup);
check('progrès « Prendre du bois »', await page.evaluate(() => !!window.game.meta.advancements.wood));

// 6. Faim et nourriture
const food = await page.evaluate(async () => {
  const { I } = await import('./src/data/ids.js');
  const { ITEMS } = await import('./src/data/items.js');
  const p = window.game.player;
  p.food = 10;
  p.eat(ITEMS[I.cooked_beef]);
  return p.food;
});
check('manger un steak : +8', food === 18);

// 7. Dégâts de chute
const fall = await page.evaluate(() => {
  const g = window.game, p = g.player;
  p.health = 20;
  p.invuln = 0;
  p.onLand(10);
  return p.health;
});
check('chute de 10 blocs : -7 PV', fall === 13, 'PV=' + fall);

// 8. Combat : tuer un zombie
const combat = await page.evaluate(async () => {
  const { I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  const z = w.spawn('zombie', p.x + 1.5, p.y, p.z);
  p.inventory.slots[0] = { id: I.diamond_sword, count: 1 };
  p.inventory.sel = 0;
  let hits = 0;
  while (!z.dead && hits < 20) { g.interaction.attackDelay = 0; z.invuln = 0; g.interaction.attack(z); hits++; }
  return { dead: z.dead, hits };
});
check('épée en diamant tue un zombie', combat.dead, 'coups=' + combat.hits);

// 9. Eau + lave = obsidienne
const obs = await page.evaluate(async () => {
  const { B } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  const x = Math.floor(p.x) + 5, y = Math.floor(p.y) + 3, z = Math.floor(p.z) + 5;
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { w.setBlock(x + dx, y - 1, z + dz, B.stone); w.setBlock(x + dx, y, z + dz, 0); }
  w.setBlock(x, y, z, B.lava, 0);
  w.setBlock(x + 1, y, z, B.water, 0);
  window.T(40);
  return w.getBlock(x, y, z) === B.obsidian;
});
check('eau sur lave source → obsidienne', obs);

// 10. Portail du Nether
const portal = await page.evaluate(async () => {
  const { B } = await import('./src/data/ids.js');
  const { tryLightPortal } = await import('./src/game/portal.js');
  const g = window.game, w = g.world, p = g.player;
  const x = Math.floor(p.x) + 3, y = Math.floor(p.y) + 5, z = Math.floor(p.z) - 3;
  for (let i = -1; i <= 2; i++) for (let j = -1; j <= 3; j++) w.setBlock(x + i, y + j, z, (i === -1 || i === 2 || j === -1 || j === 3) ? B.obsidian : 0);
  const ok = tryLightPortal(w, x, y, z);
  return { ok, block: w.getBlock(x + 1, y + 2, z) === B.nether_portal };
});
check('allumage du portail du Nether', portal.ok && portal.block);

// 11. Voyage dans le Nether par le portail
const nether = await page.evaluate(() => {
  const g = window.game, p = g.player;
  g.travelNether();
  return { dim: g.world.dim, y: p.y };
});
check('voyage vers le Nether', nether.dim === 'nether', JSON.stringify(nether));
const back = await page.evaluate(() => { const g = window.game; g.player.portalCooldown = 0; g.travelNether(); return g.world.dim; });
check('retour à la Surface', back === 'overworld');

// 12. Fort : œil de l'Ender vers le fort, activation du portail
const sh = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  const pc = w.gen.stronghold.portalCenter;
  g.ensureAround(w, pc.x, pc.z, 2);
  // lancer un œil
  p.inventory.slots[0] = { id: I.ender_eye, count: 64 };
  p.inventory.sel = 0;
  g.interaction.throwItem(p.inventory.slots[0], { use: 'ender_eye' });
  const eye = w.entities.find((e) => e.type === 'eye_of_ender');
  const ex0 = eye ? eye.x : 0, ez0 = eye ? eye.z : 0;
  window.T(30);
  const d0 = Math.hypot(ex0 - pc.x, ez0 - pc.z), d1 = eye ? Math.hypot(eye.x - pc.x, eye.z - pc.z) : 999;
  // placer les yeux
  p.setPos(pc.x + 0.5, pc.y + 1, pc.z - 3.5);
  let placed = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) {
    const x = pc.x + dx, y = pc.y, z = pc.z + dz;
    if (w.getBlock(x, y, z) === B.end_portal_frame && !(w.getMeta(x, y, z) & 4)) {
      g.interaction.useBlock({ x, y, z, id: B.end_portal_frame }, p.inventory.slots[0]);
      placed++;
    }
  }
  return { towards: d1 < d0, placed, active: w.getBlock(pc.x, pc.y, pc.z) === B.end_portal, adv: !!g.meta.advancements.end_portal };
});
check('l\'œil de l\'Ender vole vers le fort', sh.towards);
check('portail de l\'End activé (12 yeux)', sh.active, 'yeux posés=' + sh.placed);
check('progrès « Le portail est ouvert »', sh.adv);

// 13. Entrer dans l'End par le portail
const end = await page.evaluate(() => {
  const g = window.game, p = g.player, pc = g.world.gen.stronghold.portalCenter;
  p.portalCooldown = 0;
  p.setPos(pc.x + 0.5, pc.y, pc.z + 0.5);
  window.T(2);
  return { dim: g.world.dim, x: p.x, y: p.y, crystals: g.world.countEntities((e) => e.type === 'end_crystal'), dragon: g.world.countEntities((e) => e.type === 'ender_dragon') };
});
check('arrivée dans l\'End', end.dim === 'end', JSON.stringify(end));
check('10 cristaux et le dragon présents', end.crystals === 10 && end.dragon === 1);
await page.waitForTimeout(1500);
await page.screenshot({ path: join(shots, 'logic_end.png') });

// 14. Détruire un cristal, vaincre le dragon
const dragon = await page.evaluate(async () => {
  const { I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  p.creative = true; // survivre aux explosions pendant le test
  const c = w.entities.find((e) => e.type === 'end_crystal');
  c.damage(1, { type: 'projectile', entity: p });
  const crystalsLeft = w.countEntities((e) => e.type === 'end_crystal' && !e.removed);
  const d = w.entities.find((e) => e.type === 'ender_dragon');
  const hb = d.hitboxes()[0];
  let hits = 0;
  p.inventory.slots[0] = { id: I.diamond_sword, count: 1, ench: { sharpness: 5 } };
  while (d.phase !== 'dying' && hits < 200) { d.damage(20, { type: 'player', entity: p, part: 'head' }); hits++; }
  const dying = d.phase === 'dying';
  window.T(210);
  const fy = w.data.fountainY;
  let portalCells = 0;
  for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (w.getBlock(dx, fy + 1, dz) === 119 - 119 + w.getBlock(dx, fy + 1, dz) && w.getBlock(dx, fy + 1, dz) === 65) portalCells++;
  return { crystalsLeft, dying, killed: g.meta.dragonKilled, portalCells, egg: w.getBlock(0, fy + 5, 0), adv: !!g.meta.advancements.dragon, crystalAdv: !!g.meta.advancements.crystal };
});
check('cristal détruit', dragon.crystalsLeft === 9);
check('progrès « Briseur de cristaux »', dragon.crystalAdv);
check('dragon vaincu', dragon.dying && dragon.killed);
check('portail de sortie activé', dragon.portalCells >= 16, 'cases=' + dragon.portalCells);
check('œuf de dragon posé', dragon.egg === 67, 'bloc=' + dragon.egg);
check('progrès « Libérer l\'End »', dragon.adv);
await page.evaluate(() => { const g = window.game, p = g.player; p.setPos(3, g.world.data.fountainY + 8, 8); p.yaw = 0; p.pitch = -0.6; });
await page.waitForTimeout(2000);
await page.screenshot({ path: join(shots, 'logic_exit.png') });

// 15. Portail de sortie → générique → retour
const fin = await page.evaluate(() => {
  const g = window.game, p = g.player, fy = g.world.data.fountainY;
  p.portalCooldown = 0;
  p.setPos(1.5, fy + 1, 0.5);
  window.T(2);
  return { state: g.state, completed: g.meta.completed, adv: !!g.meta.advancements.credits };
});
check('générique de fin lancé', fin.state === 'credits' && fin.completed && fin.adv, JSON.stringify(fin));
await page.waitForTimeout(2500);
await page.screenshot({ path: join(shots, 'logic_credits.png') });
await page.evaluate(() => window.game.ui.menu.back());
const after = await page.evaluate(() => ({ state: window.game.state, dim: window.game.world.dim }));
check('retour à la Surface après le générique', after.state === 'playing' && after.dim === 'overworld', JSON.stringify(after));

// 16. Sauvegarde et chargement
const saved = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const g = window.game, w = g.world, p = g.player;
  p.creative = false;
  p.inventory.clear();
  p.inventory.slots[3] = { id: I.diamond, count: 42 };
  const x = Math.floor(p.x) + 1, y = Math.floor(p.y) + 1, z = Math.floor(p.z) + 1;
  w.setBlock(x, y, z, B.gold_block);
  window.__pos = [x, y, z];
  const id = g.meta.id;
  await g.quitToTitle();
  await g.loadWorld(id);
  return id;
});
await waitFor(() => window.game.state === 'playing');
const loaded = await page.evaluate(async () => {
  const { B, I } = await import('./src/data/ids.js');
  const g = window.game;
  const [x, y, z] = window.__pos;
  return { diamonds: g.player.inventory.count(I.diamond), block: g.world.getBlock(x, y, z) === B.gold_block, completed: g.meta.completed, dragonKilled: g.meta.dragonKilled };
});
check('sauvegarde : inventaire conservé', loaded.diamonds === 42, JSON.stringify(loaded));
check('sauvegarde : bloc posé conservé', loaded.block);
check('sauvegarde : progression conservée', loaded.completed && loaded.dragonKilled);
void saved;

console.log(`\n${pass} réussis, ${fail} échecs`);
console.log('--- erreurs console (' + errors.length + ') ---');
for (const e of errors.slice(0, 30)) console.log(e);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
