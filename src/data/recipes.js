// Recettes d'artisanat et de cuisson
import { B, I } from './ids.js';

export const TAGS = {
  planks: [B.oak_planks, B.birch_planks, B.spruce_planks],
  logs: [B.oak_log, B.birch_log, B.spruce_log],
  wool: [B.white_wool, B.blue_wool, B.red_wool, B.yellow_wool, B.green_wool, B.black_wool],
  coals: [I.coal, I.charcoal],
  stone_tool: [B.cobblestone],
};

export const RECIPES = [];

function norm(k) {
  if (typeof k === 'string' && k.startsWith('#')) return TAGS[k.slice(1)];
  return k;
}

function shaped(pattern, key, id, count = 1, group) {
  const k = {};
  for (const [c, v] of Object.entries(key)) k[c] = norm(v);
  RECIPES.push({ type: 'shaped', pattern, key: k, result: { id, count }, w: pattern[0].length, h: pattern.length, group });
}

function shapeless(ingredients, id, count = 1) {
  RECIPES.push({ type: 'shapeless', ingredients: ingredients.map(norm), result: { id, count } });
}

// --- Bois
shapeless([B.oak_log], B.oak_planks, 4);
shapeless([B.birch_log], B.birch_planks, 4);
shapeless([B.spruce_log], B.spruce_planks, 4);
shaped(['P', 'P'], { P: '#planks' }, I.stick, 4);
shaped(['PP', 'PP'], { P: '#planks' }, B.crafting_table);
shaped(['PPP', 'P P', 'PPP'], { P: '#planks' }, B.chest);
shaped(['CCC', 'C C', 'CCC'], { C: B.cobblestone }, B.furnace);
shaped(['C', 'S'], { C: '#coals', S: I.stick }, B.torch, 4);

// --- Outils
const TOOL_MATS = [['wooden', '#planks'], ['stone', B.cobblestone], ['iron', I.iron_ingot], ['golden', I.gold_ingot], ['diamond', I.diamond]];
for (const [m, mat] of TOOL_MATS) {
  shaped(['XXX', ' S ', ' S '], { X: mat, S: I.stick }, I[m + '_pickaxe']);
  shaped(['XX', 'XS', ' S'], { X: mat, S: I.stick }, I[m + '_axe']);
  shaped(['X', 'S', 'S'], { X: mat, S: I.stick }, I[m + '_shovel']);
  shaped(['XX', ' S', ' S'], { X: mat, S: I.stick }, I[m + '_hoe']);
  shaped(['X', 'X', 'S'], { X: mat, S: I.stick }, I[m + '_sword']);
}
// --- Armures
const ARMOR_MATS = [['leather', I.leather], ['iron', I.iron_ingot], ['golden', I.gold_ingot], ['diamond', I.diamond]];
for (const [m, mat] of ARMOR_MATS) {
  shaped(['XXX', 'X X'], { X: mat }, I[m + '_helmet']);
  shaped(['X X', 'XXX', 'XXX'], { X: mat }, I[m + '_chestplate']);
  shaped(['XXX', 'X X', 'X X'], { X: mat }, I[m + '_leggings']);
  shaped(['X X', 'X X'], { X: mat }, I[m + '_boots']);
}
shaped([' SX', 'S X', ' SX'], { S: I.stick, X: I.string }, I.bow);
shaped(['F', 'S', 'E'], { F: I.flint, S: I.stick, E: I.feather }, I.arrow, 4);
shaped(['X X', ' X '], { X: I.iron_ingot }, I.bucket);
shapeless([I.iron_ingot, I.flint], I.flint_and_steel);
shaped([' X', 'X '], { X: I.iron_ingot }, I.shears);
shaped([' I ', 'IRI', ' I '], { I: I.iron_ingot, R: I.redstone }, I.compass);
shaped([' I ', 'IRI', ' I '], { I: I.gold_ingot, R: I.redstone }, I.clock);

// --- Nourriture
shaped(['WWW'], { W: I.wheat_item }, I.bread);
shaped(['MMM', 'SES', 'WWW'], { M: I.milk_bucket, S: I.sugar, E: I.egg, W: I.wheat_item }, I.cake_item);
shapeless([B.pumpkin, I.sugar, I.egg], I.pumpkin_pie);
shaped(['GGG', 'GAG', 'GGG'], { G: I.gold_ingot, A: I.apple }, I.golden_apple);
shaped(['WCW'], { W: I.wheat_item, C: I.sugar }, I.cookie, 8);

// --- Divers
shapeless([I.sugar_cane_item], I.sugar);
shaped(['CCC'], { C: I.sugar_cane_item }, I.paper, 3);
shapeless([I.paper, I.paper, I.paper, I.leather], I.book);
shaped(['PPP', 'BBB', 'PPP'], { P: '#planks', B: I.book }, B.bookshelf);
shaped([' B ', 'DOD', 'OOO'], { B: I.book, D: I.diamond, O: B.obsidian }, B.enchanting_table);
shaped(['WWW', 'PPP'], { W: '#wool', P: '#planks' }, I.bed_item);
shaped(['PP', 'PP', 'PP'], { P: '#planks' }, I.door_item, 3);
shaped(['PPP', 'PPP'], { P: '#planks' }, B.trapdoor, 2);
shaped(['S S', 'SSS', 'S S'], { S: I.stick }, B.ladder, 3);
shaped(['PSP', 'PSP'], { P: '#planks', S: I.stick }, B.oak_fence, 3);
shaped(['NnN', 'NnN'], { N: B.nether_bricks, n: I.nether_brick }, B.nether_brick_fence, 6);
shaped(['X  ', 'XX ', 'XXX'], { X: '#planks' }, B.oak_stairs, 4);
shaped(['X  ', 'XX ', 'XXX'], { X: B.cobblestone }, B.cobblestone_stairs, 4);
shaped(['X  ', 'XX ', 'XXX'], { X: B.stone_bricks }, B.stone_brick_stairs, 4);
shaped(['X  ', 'XX ', 'XXX'], { X: B.nether_bricks }, B.nether_brick_stairs, 4);
shaped(['XXX'], { X: B.smooth_stone }, B.stone_slab, 6);
shaped(['XXX'], { X: B.stone }, B.stone_slab, 6);
shaped(['XXX'], { X: '#planks' }, B.oak_slab, 6);
shaped(['SS', 'SS'], { S: B.stone }, B.stone_bricks, 4);
shaped(['BB', 'BB'], { B: I.brick }, B.bricks);
shaped(['BB', 'BB'], { B: I.nether_brick }, B.nether_bricks);
shaped(['SS', 'SS'], { S: B.sand }, B.sandstone);
shaped(['GSG', 'SGS', 'GSG'], { G: I.gunpowder, S: B.sand }, B.tnt);
shaped(['GGG', 'GGG'], { G: B.glass }, B.glass_pane, 16);
shaped(['III', 'III'], { I: I.iron_ingot }, B.iron_bars, 16);
shaped(['SS', 'SS'], { S: I.string }, B.white_wool);
shaped(['SS', 'SS'], { S: I.snowball }, B.snow_block);
shaped(['CC', 'CC'], { C: I.clay_ball }, B.clay);
shaped(['GG', 'GG'], { G: I.glowstone_dust }, B.glowstone);
shaped(['P', 'T'], { P: B.pumpkin, T: B.torch }, B.jack_o_lantern);
shaped(['QQ', 'QQ'], { Q: I.quartz }, B.quartz_block);
shaped(['EE', 'EE'], { E: B.end_stone }, B.end_stone_bricks, 4);
shaped(['MM', 'MM'], { M: I.magma_cream }, B.magma_block);
shaped(['NNN', 'NTN', 'NNN'], { N: I.iron_nugget, T: B.torch }, B.lantern);
shaped(['G G', ' G '], { G: B.glass }, I.glass_bottle, 3);
shaped([' R ', 'CCC'], { R: I.blaze_rod, C: B.cobblestone }, B.brewing_stand);
shaped(['OOO', 'OEO', 'OOO'], { O: B.obsidian, E: I.ender_eye }, B.ender_chest);
shaped(['III', ' i ', 'iii'], { I: B.iron_block, i: I.iron_ingot }, B.anvil);
shapeless([B.white_wool, B.poppy], B.red_wool);
shapeless([B.white_wool, B.dandelion], B.yellow_wool);
shapeless([B.white_wool, B.cornflower], B.blue_wool);
shapeless([B.white_wool, B.cactus], B.green_wool);
shapeless([B.white_wool, I.coal], B.black_wool);
shapeless([I.bone], I.bone_meal, 3);
shaped(['BBB', 'BBB', 'BBB'], { B: I.bone_meal }, B.bone_block);
shapeless([B.bone_block], I.bone_meal, 9);
shapeless([I.blaze_rod], I.blaze_powder, 2);
shapeless([I.ender_pearl, I.blaze_powder], I.ender_eye);
shapeless([I.blaze_powder, I.clay_ball], I.magma_cream);
shaped(['PPP', 'PWP', 'PPP'], { P: I.paper, W: I.compass }, I.map);

// Blocs de minerai <-> lingots
const BLOCKS9 = [
  [I.iron_ingot, B.iron_block], [I.gold_ingot, B.gold_block], [I.diamond, B.diamond_block], [I.emerald, B.emerald_block],
  [I.lapis_lazuli, B.lapis_block], [I.coal, B.coal_block], [I.redstone, B.redstone_block], [I.wheat_item, B.hay_block],
  [I.melon_slice, B.melon], [I.iron_nugget, I.iron_ingot], [I.gold_nugget, I.gold_ingot],
];
for (const [item, block] of BLOCKS9) {
  shaped(['XXX', 'XXX', 'XXX'], { X: item }, block);
  if (item !== I.melon_slice) shapeless([block], item, 9);
}

// --- Cuisson (four)
export const SMELTING = new Map();
function smelt(input, output, xp = 0.1) {
  SMELTING.set(input, { id: output, xp });
}
smelt(B.iron_ore, I.iron_ingot, 0.7);
smelt(B.gold_ore, I.gold_ingot, 1);
smelt(B.diamond_ore, I.diamond, 1);
smelt(B.emerald_ore, I.emerald, 1);
smelt(B.coal_ore, I.coal, 0.1);
smelt(B.lapis_ore, I.lapis_lazuli, 0.2);
smelt(B.redstone_ore, I.redstone, 0.3);
smelt(B.nether_quartz_ore, I.quartz, 0.2);
smelt(B.sand, B.glass, 0.1);
smelt(B.cobblestone, B.stone, 0.1);
smelt(B.stone, B.smooth_stone, 0.1);
smelt(B.stone_bricks, B.cracked_stone_bricks, 0.1);
smelt(I.clay_ball, I.brick, 0.3);
smelt(B.clay, B.bricks, 0.35);
smelt(B.netherrack, I.nether_brick, 0.1);
smelt(B.oak_log, I.charcoal, 0.15);
smelt(B.birch_log, I.charcoal, 0.15);
smelt(B.spruce_log, I.charcoal, 0.15);
smelt(B.cactus, B.green_wool, 0.2);
smelt(I.porkchop, I.cooked_porkchop, 0.35);
smelt(I.beef, I.cooked_beef, 0.35);
smelt(I.chicken, I.cooked_chicken, 0.35);
smelt(I.mutton, I.cooked_mutton, 0.35);
smelt(I.potato, I.baked_potato, 0.35);
smelt(I.cod, I.cooked_cod, 0.35);
smelt(B.sandstone, B.smooth_stone, 0.1);
for (const t of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
  smelt(I['iron_' + t], I.iron_nugget, 0.1);
  smelt(I['golden_' + t], I.gold_nugget, 0.1);
}
for (const a of ['helmet', 'chestplate', 'leggings', 'boots']) {
  smelt(I['iron_' + a], I.iron_nugget, 0.1);
  smelt(I['golden_' + a], I.gold_nugget, 0.1);
}

function matches(key, id) {
  if (key === undefined || key === null) return id === 0;
  if (Array.isArray(key)) return key.includes(id);
  return key === id;
}

// grid : tableau de w*h identifiants (0 = vide)
export function findRecipe(grid, w, h) {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  const ids = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const id = grid[y * w + x];
      if (id) {
        ids.push(id);
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
  if (!ids.length) return null;
  const bw = maxX - minX + 1, bh = maxY - minY + 1;
  for (const r of RECIPES) {
    if (r.type === 'shaped') {
      if (r.w !== bw || r.h !== bh) continue;
      for (const mirror of [false, true]) {
        let ok = true;
        for (let y = 0; y < bh && ok; y++)
          for (let x = 0; x < bw && ok; x++) {
            const px = mirror ? bw - 1 - x : x;
            const ch = r.pattern[y][px];
            const id = grid[(minY + y) * w + minX + x];
            if (ch === ' ') { if (id) ok = false; }
            else if (!matches(r.key[ch], id)) ok = false;
          }
        if (ok) return r;
      }
    } else {
      if (r.ingredients.length !== ids.length) continue;
      const left = ids.slice();
      let ok = true;
      for (const ing of r.ingredients) {
        const i = left.findIndex((id) => matches(ing, id));
        if (i < 0) { ok = false; break; }
        left.splice(i, 1);
      }
      if (ok) return r;
    }
  }
  return null;
}

// Liste d'ingrédients (pour le livre de recettes) : tableau de {key, count}
export function recipeIngredients(r) {
  const counts = new Map();
  const add = (k) => {
    const key = Array.isArray(k) ? k : [k];
    const s = key.join(',');
    const e = counts.get(s);
    if (e) e.count++; else counts.set(s, { ids: key, count: 1 });
  };
  if (r.type === 'shaped') {
    for (const row of r.pattern) for (const ch of row) if (ch !== ' ') add(r.key[ch]);
  } else r.ingredients.forEach(add);
  return [...counts.values()];
}
