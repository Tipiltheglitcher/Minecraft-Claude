// Définitions des objets (les blocs ont aussi une forme d'objet)
import { B, I, ITEM_KEYS } from './ids.js';
import { BLOCKS } from './blocks.js';

export const ITEMS = [];

export const TIERS = {
  wooden: { level: 0, speed: 2, durability: 59, name: 'en bois', ench: 15 },
  stone: { level: 1, speed: 4, durability: 131, name: 'en pierre', ench: 5 },
  iron: { level: 2, speed: 6, durability: 250, name: 'en fer', ench: 14 },
  golden: { level: 0, speed: 12, durability: 32, name: 'en or', ench: 22 },
  diamond: { level: 3, speed: 8, durability: 1561, name: 'en diamant', ench: 10 },
};
const TOOL_DAMAGE = {
  sword: { wooden: 5, stone: 6, iron: 7, golden: 5, diamond: 8 },
  axe: { wooden: 4, stone: 5, iron: 6, golden: 4, diamond: 7 },
  pickaxe: { wooden: 3, stone: 4, iron: 5, golden: 3, diamond: 6 },
  shovel: { wooden: 2, stone: 3, iron: 4, golden: 2, diamond: 5 },
  hoe: { wooden: 1, stone: 1, iron: 1, golden: 1, diamond: 1 },
};
const TOOL_NAMES = { pickaxe: 'Pioche', axe: 'Hache', shovel: 'Pelle', hoe: 'Houe', sword: 'Épée' };
const TOOL_GENDER_F = { pickaxe: true, axe: true, shovel: true, hoe: true, sword: true };

const ARMOR = {
  leather: { name: 'en cuir', points: [1, 3, 2, 1], dur: [55, 80, 75, 65], ench: 15 },
  iron: { name: 'en fer', points: [2, 6, 5, 2], dur: [165, 240, 225, 195], ench: 9 },
  golden: { name: 'en or', points: [2, 5, 3, 1], dur: [77, 112, 105, 91], ench: 25 },
  diamond: { name: 'en diamant', points: [3, 8, 6, 3], dur: [363, 528, 495, 429], ench: 10 },
};
const ARMOR_SLOTS = ['helmet', 'chestplate', 'leggings', 'boots'];
const ARMOR_NAMES = { helmet: 'Casque', chestplate: 'Plastron', leggings: 'Jambières', boots: 'Bottes' };

function item(key, name, props = {}) {
  const id = I[key];
  if (id === undefined) throw new Error('Objet inconnu ' + key);
  ITEMS[id] = Object.assign({ id, key, name, stack: 64, icon: key }, props);
  return ITEMS[id];
}

// --- Blocs en tant qu'objets
for (let i = 1; i < 256; i++) {
  const b = BLOCKS[i];
  if (!b) continue;
  ITEMS[i] = { id: i, key: b.key, name: b.name, stack: b.stack || 64, block: i, icon: null, hidden: b.hidden, fuel: b.fuel };
}

// --- Matériaux
item('stick', 'Bâton', { fuel: 100 });
item('coal', 'Charbon', { fuel: 1600 });
item('charcoal', 'Charbon de bois', { fuel: 1600 });
item('iron_ingot', 'Lingot de fer');
item('gold_ingot', 'Lingot d\'or');
item('diamond', 'Diamant');
item('emerald', 'Émeraude');
item('lapis_lazuli', 'Lapis-lazuli');
item('redstone', 'Poudre de redstone');
item('flint', 'Silex');
item('feather', 'Plume');
item('string', 'Ficelle');
item('leather', 'Cuir');
item('bone', 'Os');
item('bone_meal', 'Poudre d\'os', { use: 'bonemeal' });
item('gunpowder', 'Poudre à canon');
item('arrow', 'Flèche');
item('bow', 'Arc', { stack: 1, durability: 384, use: 'bow', fuel: 300, ench: 1, enchType: 'bow' });

// --- Outils
for (const tier of Object.keys(TIERS)) {
  for (const type of ['pickaxe', 'axe', 'shovel', 'hoe', 'sword']) {
    const t = TIERS[tier];
    item(tier + '_' + type, TOOL_NAMES[type] + ' ' + t.name, {
      stack: 1,
      tool: { type, level: t.level, speed: t.speed },
      durability: t.durability,
      damage: TOOL_DAMAGE[type][tier],
      fuel: tier === 'wooden' ? 200 : 0,
      ench: t.ench,
      enchType: type === 'sword' ? 'sword' : 'tool',
      material: tier,
      use: type === 'hoe' ? 'hoe' : type === 'shovel' ? 'shovel' : undefined,
    });
  }
}
void TOOL_GENDER_F;

// --- Armures
for (const mat of Object.keys(ARMOR)) {
  ARMOR_SLOTS.forEach((slot, si) => {
    const a = ARMOR[mat];
    item(mat + '_' + slot, ARMOR_NAMES[slot] + ' ' + a.name, {
      stack: 1,
      armor: { slot: si, points: a.points[si], material: mat },
      durability: a.dur[si],
      ench: a.ench,
      enchType: 'armor',
      use: 'armor',
    });
  });
}

// --- Nourriture
const food = (key, name, hunger, sat, extra = {}) => item(key, name, Object.assign({ food: { hunger, sat } }, extra));
food('apple', 'Pomme', 4, 2.4);
food('golden_apple', 'Pomme dorée', 4, 9.6, { foodEffect: 'golden', always: true });
food('bread', 'Pain', 5, 6);
food('porkchop', 'Côtelette de porc crue', 3, 1.8);
food('cooked_porkchop', 'Côtelette de porc cuite', 8, 12.8);
food('beef', 'Bœuf cru', 3, 1.8);
food('cooked_beef', 'Steak', 8, 12.8);
food('chicken', 'Poulet cru', 2, 1.2, { foodEffect: 'hunger30' });
food('cooked_chicken', 'Poulet rôti', 6, 7.2);
food('mutton', 'Mouton cru', 2, 1.2);
food('cooked_mutton', 'Mouton cuit', 6, 9.6);
food('rotten_flesh', 'Chair putréfiée', 4, 0.8, { foodEffect: 'hunger80' });
food('spider_eye', 'Œil d\'araignée', 2, 3.2, { foodEffect: 'poison' });
food('melon_slice', 'Tranche de pastèque', 2, 1.2);
food('cookie', 'Cookie', 2, 0.4);
food('pumpkin_pie', 'Tarte à la citrouille', 8, 4.8);
food('carrot', 'Carotte', 3, 3.6);
food('potato', 'Pomme de terre', 1, 0.6);
food('baked_potato', 'Pomme de terre cuite', 5, 6);
food('cod', 'Morue crue', 2, 0.4);
food('cooked_cod', 'Morue cuite', 5, 6);

// --- Agriculture & divers
item('wheat_item', 'Blé');
item('wheat_seeds', 'Graines de blé', { plant: B.wheat });
item('sugar_cane_item', 'Canne à sucre', { plant: B.sugar_cane });
item('paper', 'Papier');
item('book', 'Livre');
item('sugar', 'Sucre');
item('bucket', 'Seau', { stack: 16, use: 'bucket' });
item('water_bucket', 'Seau d\'eau', { stack: 1, use: 'bucket', liquid: B.water });
item('lava_bucket', 'Seau de lave', { stack: 1, use: 'bucket', liquid: B.lava, fuel: 20000 });
item('milk_bucket', 'Seau de lait', { stack: 1, use: 'milk' });
item('flint_and_steel', 'Briquet', { stack: 1, durability: 64, use: 'ignite' });
item('shears', 'Cisailles', { stack: 1, durability: 238, tool: { type: 'shears', level: 0, speed: 5 } });
item('compass', 'Boussole', { stack: 1 });
item('clock', 'Montre', { stack: 1 });
item('ender_pearl', 'Perle de l\'Ender', { stack: 16, use: 'throw_pearl' });
item('blaze_rod', 'Bâton de Blaze', { fuel: 2400 });
item('blaze_powder', 'Poudre de Blaze');
item('ender_eye', 'Œil de l\'Ender', { use: 'ender_eye' });
item('ghast_tear', 'Larme de Ghast');
item('gold_nugget', 'Pépite d\'or');
item('quartz', 'Quartz du Nether');
item('glowstone_dust', 'Poudre lumineuse');
item('bed_item', 'Lit', { stack: 1, place: B.bed, icon: 'bed_item' });
item('door_item', 'Porte en chêne', { place: B.oak_door, icon: 'door_item' });
item('snowball', 'Boule de neige', { stack: 16, use: 'throw_snowball' });
item('clay_ball', 'Boule d\'argile');
item('brick', 'Brique');
item('nether_brick', 'Brique du Nether');
item('magma_cream', 'Crème de magma');
item('enchanted_book', 'Livre enchanté', { stack: 1 });
item('egg', 'Œuf', { stack: 16, use: 'throw_egg' });
item('fishing_rod', 'Canne à pêche', { stack: 1, durability: 64, hidden: true });
item('potion', 'Potion', { stack: 1, use: 'drink' });
item('glass_bottle', 'Fiole', { use: 'bottle' });
item('nether_wart', 'Verrue du Nether');
item('iron_nugget', 'Pépite de fer');
item('cake_item', 'Gâteau', { stack: 1, place: B.cake });
item('dragon_breath', 'Souffle de dragon', { hidden: true });
item('experience_bottle', 'Fiole d\'expérience', { use: 'throw_xp' });
item('map', 'Carte', { hidden: true });
item('totem', 'Totem d\'immortalité', { stack: 1 });

// --- Œufs d'apparition (créatif)
const SPAWN = {
  pig: ['Cochon', '#f0a5a2', '#db635f'], cow: ['Vache', '#443626', '#a1a1a1'], sheep: ['Mouton', '#e7e7e7', '#ffb5b5'],
  chicken: ['Poulet', '#a1a1a1', '#ff0000'], zombie: ['Zombie', '#00afaf', '#799c65'], skeleton: ['Squelette', '#c1c1c1', '#494949'],
  creeper: ['Creeper', '#0da70b', '#000000'], spider: ['Araignée', '#342d27', '#a80e0e'], enderman: ['Enderman', '#161616', '#000000'],
  villager: ['Villageois', '#563c33', '#bd8b72'], blaze: ['Blaze', '#f6b201', '#fff87e'], ghast: ['Ghast', '#f9f9f9', '#bcbcbc'],
  piglin: ['Piglin zombifié', '#ea9393', '#4c7129'], wither_skeleton: ['Wither squelette', '#141414', '#474d4d'],
  magma_cube: ['Cube de magma', '#340000', '#fcfc00'], slime: ['Slime', '#51a03e', '#7ebf6e'],
};
for (const [mob, [name, c1, c2]] of Object.entries(SPAWN)) {
  item('spawn_' + mob, 'Œuf d\'apparition : ' + name, { use: 'spawn_egg', mob, colors: [c1, c2], icon: 'spawn_egg', creativeOnly: true });
}

// Objets non définis explicitement (sécurité)
ITEM_KEYS.forEach((k) => {
  if (!ITEMS[I[k]]) item(k, k, { hidden: true });
});

export function itemDef(id) {
  return ITEMS[id];
}

export function maxStack(id) {
  const d = ITEMS[id];
  return d ? d.stack : 64;
}

export function itemName(stack) {
  if (!stack) return '';
  if (stack.name) return stack.name;
  const d = ITEMS[stack.id];
  return d ? d.name : '?';
}

export function isFood(id) {
  return !!ITEMS[id]?.food;
}

// Nombre de ticks de combustion
export function fuelValue(id) {
  const d = ITEMS[id];
  if (!d) return 0;
  if (d.fuel) return d.fuel;
  const b = BLOCKS[id];
  if (b && b.fuel) return b.fuel;
  return 0;
}

export const ARMOR_SLOT_NAMES = ARMOR_SLOTS;
