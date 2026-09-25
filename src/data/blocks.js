// Définitions des blocs
import { B, I } from './ids.js';

export const N = 0, S = 1, W = 2, E = 3, U = 4, D = 5;

export const BLOCKS = new Array(256).fill(null);

// Tables rapides (utilisées par le mesher, la lumière, la physique)
export const OPAQUE = new Uint8Array(256); // cube plein opaque (cache les faces voisines, AO)
export const SOLID = new Uint8Array(256); // collision
export const EMIT = new Uint8Array(256); // lumière émise
export const OPACITY = new Uint8Array(256); // absorption de lumière
export const RENDER = new Uint8Array(256); // type de rendu
export const REPLACEABLE = new Uint8Array(256);
export const LIQUID = new Uint8Array(256);

export const R_NONE = 0, R_CUBE = 1, R_CROSS = 2, R_LIQUID = 3, R_MODEL = 4, R_CROP = 5;
const RENDER_CODES = { none: R_NONE, cube: R_CUBE, cross: R_CROSS, liquid: R_LIQUID, model: R_MODEL, crop: R_CROP };

const DEF = {
  solid: true,
  opaque: true,
  render: 'cube',
  pass: 'opaque', // opaque | cutout | translucent
  hardness: 1,
  tool: null, // pickaxe | axe | shovel | hoe | sword | shears
  level: -1, // niveau d'outil requis pour récolter (0 bois,1 pierre,2 fer,3 diamant)
  light: 0,
  opacity: null,
  tint: null,
  replaceable: false,
  flammable: 0,
  gravity: false,
  sound: 'stone',
  climbable: false,
  slip: 0.6,
  speed: 1,
  hidden: false,
  stack: 64,
};

function def(key, name, props = {}) {
  const id = B[key];
  if (id === undefined) throw new Error('Bloc inconnu ' + key);
  const d = Object.assign({ id, key, name }, DEF, props);
  if (d.opacity === null) d.opacity = d.opaque ? 15 : 0;
  if (d.blast === undefined) d.blast = d.hardness < 0 ? 3600000 : d.hardness * 3;
  // Normalisation des textures
  if (!d.texFn) {
    const t = d.tex || key;
    if (typeof t === 'string') d.texFn = () => t;
    else {
      const top = t.top || t.all || t.side, bottom = t.bottom || t.top || t.all || t.side;
      const side = t.side || t.all;
      const front = t.front || side;
      const back = t.back || side;
      if (t.front) {
        // Bloc orienté : meta & 3 = direction de la face avant
        d.texFn = (f, meta) => {
          if (f === U) return top;
          if (f === D) return bottom;
          const facing = meta & 3;
          if (f === facing) return front;
          if (f === (facing ^ 1)) return back;
          return side;
        };
      } else if (t.axis) {
        // Bûches : meta = axe (0 Y, 1 X, 2 Z)
        d.texFn = (f, meta) => {
          const axis = meta & 3;
          if (axis === 0) return f === U || f === D ? top : side;
          if (axis === 1) return f === W || f === E ? top : side;
          return f === N || f === S ? top : side;
        };
        d.rotFn = (f, meta) => {
          const axis = meta & 3;
          if (axis === 1) return f === N || f === S || f === U || f === D ? 1 : 0;
          if (axis === 2) return f === W || f === E ? 1 : 0;
          return 0;
        };
      } else d.texFn = (f) => (f === U ? top : f === D ? bottom : side);
    }
  }
  BLOCKS[id] = d;
  return d;
}

// Outils pour les modèles (boîtes en pixels 0..16)
export function box(x0, y0, z0, x1, y1, z1, tex, extra) {
  return Object.assign({ x0, y0, z0, x1, y1, z1, tex }, extra);
}

// Rotation d'une boîte autour de l'axe Y (quart de tour) selon l'orientation 0..3 (N,S,W,E)
// La boîte est définie pour l'orientation "N" (face avant vers -Z)
// Les coordonnées renvoyées sont celles du monde (pour collision/sélection) ; "local" + "rot"
// permettent au mesher de générer les faces dans le repère local puis de les tourner.
export function rotBox(b, facing) {
  const { x0, z0, x1, z1 } = b;
  let nx0, nz0, nx1, nz1;
  if (facing === N) return b;
  if (facing === S) { nx0 = 16 - x1; nx1 = 16 - x0; nz0 = 16 - z1; nz1 = 16 - z0; }
  else if (facing === W) { nx0 = z0; nx1 = z1; nz0 = 16 - x1; nz1 = 16 - x0; }
  else { nx0 = 16 - z1; nx1 = 16 - z0; nz0 = x0; nz1 = x1; }
  return Object.assign({}, b, { x0: nx0, z0: nz0, x1: nx1, z1: nz1, local: b, rot: facing });
}
// Face locale -> face monde pour une orientation donnée
export const ROT_FACE = [
  [0, 1, 2, 3, 4, 5], // N
  [1, 0, 3, 2, 4, 5], // S
  [2, 3, 1, 0, 4, 5], // W : N->W, S->E, W->S, E->N
  [3, 2, 0, 1, 4, 5], // E : N->E, S->W, W->N, E->S
];

const fullBox = [box(0, 0, 0, 16, 16, 16)];

// ====== Drops utilitaires ======
const one = (id) => () => [[id, 1]];
const nothing = () => [];

// ================= DÉFINITIONS =================
def('air', 'Air', { solid: false, opaque: false, render: 'none', hardness: 0, replaceable: true, hidden: true });
def('stone', 'Pierre', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0, drops: one(B.cobblestone) });
def('grass_block', 'Bloc d\'herbe', {
  hardness: 0.6, tool: 'shovel', sound: 'grass', drops: one(B.dirt),
  texFn: (f, meta) => (f === U ? 'grass_top' : f === D ? 'dirt' : meta & 1 ? 'grass_side_snowy' : 'grass_side'),
  tintFn: (f) => f === U,
  tint: 'grass',
});
def('dirt', 'Terre', { hardness: 0.5, tool: 'shovel', sound: 'gravel' });
def('cobblestone', 'Pierre taillée', { hardness: 2, blast: 6, tool: 'pickaxe', level: 0 });
def('oak_planks', 'Planches de chêne', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, fuel: 300 });
def('oak_sapling', 'Pousse de chêne', { solid: false, opaque: false, render: 'cross', pass: 'cutout', hardness: 0, sound: 'grass', fuel: 100, flammable: 1 });
def('bedrock', 'Bedrock', { hardness: -1, blast: 3600000 });
def('water', 'Eau', { solid: false, opaque: false, render: 'liquid', pass: 'translucent', hardness: -1, blast: 100, opacity: 2, replaceable: true, tint: 'water', hidden: true, liquid: true, tex: 'water_still' });
def('lava', 'Lave', { solid: false, opaque: false, render: 'liquid', pass: 'opaque', hardness: -1, blast: 100, light: 15, opacity: 15, replaceable: true, hidden: true, liquid: true, tex: 'lava_still' });
def('sand', 'Sable', { hardness: 0.5, tool: 'shovel', sound: 'sand', gravity: true });
def('gravel', 'Gravier', {
  hardness: 0.6, tool: 'shovel', sound: 'gravel', gravity: true,
  drops: (m, rng) => [[rng() < 0.1 ? I.flint : B.gravel, 1]],
});
def('gold_ore', 'Minerai d\'or', { hardness: 3, tool: 'pickaxe', level: 2 });
def('iron_ore', 'Minerai de fer', { hardness: 3, tool: 'pickaxe', level: 1 });
def('coal_ore', 'Minerai de charbon', { hardness: 3, tool: 'pickaxe', level: 0, drops: one(I.coal), xp: [0, 2], fortune: true });
def('oak_log', 'Bûche de chêne', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, tex: { top: 'oak_log_top', side: 'oak_log', axis: true }, fuel: 300, drops: one(B.oak_log) });
def('oak_leaves', 'Feuilles de chêne', {
  opaque: false, pass: 'cutout', hardness: 0.2, tool: 'hoe', sound: 'grass', opacity: 1, flammable: 30, tint: 'foliage', leaves: true,
  drops: (m, rng) => {
    const r = [];
    if (rng() < 0.05) r.push([B.oak_sapling, 1]);
    if (rng() < 0.02) r.push([I.stick, 1 + Math.floor(rng() * 2)]);
    if (rng() < 0.01) r.push([I.apple, 1]);
    return r;
  },
});
def('glass', 'Verre', { opaque: false, pass: 'cutout', hardness: 0.3, sound: 'glass', drops: nothing, cullSame: true });
def('lapis_ore', 'Minerai de lapis-lazuli', { hardness: 3, tool: 'pickaxe', level: 1, drops: (m, rng) => [[I.lapis_lazuli, 4 + Math.floor(rng() * 5)]], xp: [2, 5], fortune: true });
def('lapis_block', 'Bloc de lapis-lazuli', { hardness: 3, tool: 'pickaxe', level: 1 });
def('sandstone', 'Grès', { hardness: 0.8, tool: 'pickaxe', level: 0, tex: { top: 'sandstone_top', bottom: 'sandstone_bottom', side: 'sandstone' } });
def('white_wool', 'Laine blanche', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
const flower = { solid: false, opaque: false, render: 'cross', pass: 'cutout', hardness: 0, sound: 'grass', plant: true, flammable: 60 };
def('dandelion', 'Pissenlit', flower);
def('poppy', 'Coquelicot', flower);
def('brown_mushroom', 'Champignon brun', Object.assign({}, flower, { light: 1 }));
def('red_mushroom', 'Champignon rouge', flower);
def('gold_block', 'Bloc d\'or', { hardness: 3, tool: 'pickaxe', level: 2, sound: 'metal' });
def('iron_block', 'Bloc de fer', { hardness: 5, tool: 'pickaxe', level: 1, sound: 'metal' });
def('bricks', 'Briques', { hardness: 2, blast: 6, tool: 'pickaxe', level: 0 });
def('tnt', 'TNT', { hardness: 0, sound: 'grass', flammable: 15, tex: { top: 'tnt_top', bottom: 'tnt_bottom', side: 'tnt_side' } });
def('bookshelf', 'Bibliothèque', { hardness: 1.5, tool: 'axe', sound: 'wood', flammable: 30, tex: { top: 'oak_planks', side: 'bookshelf' }, drops: one(I.book), dropCount: 3, fuel: 300 });
def('mossy_cobblestone', 'Pierre taillée moussue', { hardness: 2, blast: 6, tool: 'pickaxe', level: 0 });
def('obsidian', 'Obsidienne', { hardness: 50, blast: 1200, tool: 'pickaxe', level: 3 });
def('torch', 'Torche', {
  solid: false, opaque: false, render: 'model', pass: 'cutout', hardness: 0, light: 14, sound: 'wood',
  boxes: (meta) => {
    const uv = { [U]: [7, 6, 9, 8], [D]: [7, 14, 9, 16] };
    if (!meta) return [box(7, 0, 7, 9, 10, 9, 'torch', { uv })];
    // Torche murale : décalée contre le mur et inclinée (approx : décalage)
    const off = [[0, -5], [0, 5], [-5, 0], [5, 0]][meta - 1];
    return [box(7 + off[0], 3, 7 + off[1], 9 + off[0], 13, 9 + off[1], 'torch', { uv, tilt: meta - 1 })];
  },
  select: (meta) => {
    if (!meta) return [box(6, 0, 6, 10, 10, 10)];
    const off = [[0, -5], [0, 5], [-5, 0], [5, 0]][meta - 1];
    return [box(5.5 + off[0], 3, 5.5 + off[1], 10.5 + off[0], 13, 10.5 + off[1])];
  },
});
def('fire', 'Feu', { solid: false, opaque: false, render: 'cross', pass: 'cutout', hardness: 0, light: 15, replaceable: true, drops: nothing, hidden: true, fire: true });
def('spawner', 'Générateur de monstres', { opaque: false, pass: 'cutout', hardness: 5, tool: 'pickaxe', level: 0, sound: 'metal', drops: nothing, xp: [15, 43], hidden: true, cullSame: false });
def('chest', 'Coffre', {
  opaque: false, render: 'model', hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 300, container: 'chest', flammable: 5,
  boxes: (meta) => [
    rotBox(box(1, 0, 1, 15, 14, 15, { top: 'chest_top', bottom: 'chest_top', side: 'chest_side', front: 'chest_front' }), meta & 3),
  ],
});
def('diamond_ore', 'Minerai de diamant', { hardness: 3, tool: 'pickaxe', level: 2, drops: one(I.diamond), xp: [3, 7], fortune: true });
def('diamond_block', 'Bloc de diamant', { hardness: 5, tool: 'pickaxe', level: 2, sound: 'metal' });
def('crafting_table', 'Table de craft', { hardness: 2.5, tool: 'axe', sound: 'wood', fuel: 300, tex: { top: 'crafting_table_top', bottom: 'oak_planks', side: 'crafting_table_side', front: 'crafting_table_front' }, flammable: 5 });
def('wheat', 'Blé', {
  solid: false, opaque: false, render: 'crop', pass: 'cutout', hardness: 0, sound: 'grass', hidden: true, plant: true,
  texFn: (f, meta) => 'wheat_stage' + Math.min(7, meta),
  drops: (meta, rng) => (meta >= 7 ? [[I.wheat_item, 1], [I.wheat_seeds, Math.floor(rng() * 4)]] : [[I.wheat_seeds, 1]]),
  pick: () => I.wheat_seeds,
});
def('farmland', 'Terre labourée', {
  opaque: false, render: 'model', hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: one(B.dirt), opacity: 15,
  boxes: (meta) => [box(0, 0, 0, 16, 15, 16, { top: meta ? 'farmland_moist' : 'farmland', side: 'dirt', bottom: 'dirt' })],
  hidden: true,
});
const furnaceTex = { top: 'furnace_top', bottom: 'furnace_top', side: 'furnace_side', front: 'furnace_front' };
def('furnace', 'Four', { hardness: 3.5, tool: 'pickaxe', level: 0, tex: furnaceTex, container: 'furnace' });
def('lit_furnace', 'Four allumé', { hardness: 3.5, tool: 'pickaxe', level: 0, light: 13, tex: Object.assign({}, furnaceTex, { front: 'furnace_front_on' }), container: 'furnace', drops: one(B.furnace), hidden: true, pick: () => B.furnace });
def('oak_door', 'Porte en chêne', {
  opaque: false, render: 'model', pass: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', hidden: true,
  drops: () => [[I.door_item, 1]],
  pick: () => I.door_item,
  boxes: (meta) => {
    const facing = meta & 3, open = meta & 4, top = meta & 8;
    const tex = top ? 'door_top' : 'door_bottom';
    // Porte fermée : panneau le long du côté "facing"
    let b = box(0, 0, 0, 16, 16, 3, { side: tex, top: tex, bottom: tex });
    let dir = facing;
    if (open) dir = [W, E, S, N][facing];
    return [rotBox(b, dir)];
  },
});
def('ladder', 'Échelle', {
  solid: true, opaque: false, render: 'model', pass: 'cutout', hardness: 0.4, tool: 'axe', sound: 'wood', climbable: true, flammable: 5, fuel: 300,
  boxes: (meta) => [rotBox(box(0, 0, 0, 16, 16, 1, 'ladder', { only: [S, N] }), meta & 3)],
  collide: (meta) => [rotBox(box(0, 0, 0, 16, 16, 3), meta & 3)],
});
def('redstone_ore', 'Minerai de redstone', { hardness: 3, tool: 'pickaxe', level: 2, drops: (m, rng) => [[I.redstone, 4 + Math.floor(rng() * 2)]], xp: [1, 5] });
def('snow', 'Couche de neige', {
  solid: false, opaque: false, render: 'model', hardness: 0.1, tool: 'shovel', sound: 'snow', replaceable: true,
  boxes: (meta) => [box(0, 0, 0, 16, 2 * ((meta & 7) + 1), 16, 'snow')],
  drops: (meta) => [[I.snowball, (meta & 7) + 1]], needsTool: true,
});
def('ice', 'Glace', { opaque: false, pass: 'translucent', hardness: 0.5, tool: 'pickaxe', sound: 'glass', opacity: 2, slip: 0.98, drops: nothing, cullSame: true });
def('snow_block', 'Bloc de neige', { hardness: 0.2, tool: 'shovel', sound: 'snow', drops: () => [[I.snowball, 4]], needsTool: true });
def('cactus', 'Cactus', {
  opaque: false, render: 'model', pass: 'cutout', hardness: 0.4, sound: 'cloth', opacity: 0,
  boxes: () => [
    box(1, 0, 1, 15, 16, 15, { side: 'cactus_side', top: 'cactus_top', bottom: 'cactus_bottom' }, { only: [N, S, W, E] }),
    box(0, 0, 0, 16, 16, 16, { top: 'cactus_top', bottom: 'cactus_bottom' }, { only: [U, D] }),
  ],
  collide: () => [box(1, 0, 1, 15, 15, 15)],
  damage: 1,
});
def('clay', 'Argile', { hardness: 0.6, tool: 'shovel', sound: 'gravel', drops: () => [[I.clay_ball, 4]] });
def('sugar_cane', 'Canne à sucre', { solid: false, opaque: false, render: 'cross', pass: 'cutout', hardness: 0, sound: 'grass', drops: one(I.sugar_cane_item), hidden: true, pick: () => I.sugar_cane_item, plant: true });
def('pumpkin', 'Citrouille', { hardness: 1, tool: 'axe', sound: 'wood', tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'pumpkin_face' } });
def('netherrack', 'Netherrack', { hardness: 0.4, tool: 'pickaxe', level: 0 });
def('soul_sand', 'Sable des âmes', { hardness: 0.5, tool: 'shovel', sound: 'sand', speed: 0.4, collide: () => [box(0, 0, 0, 16, 14, 16)] });
def('glowstone', 'Pierre lumineuse', { hardness: 0.3, sound: 'glass', light: 15, drops: (m, rng) => [[I.glowstone_dust, 2 + Math.floor(rng() * 3)]] });
def('nether_portal', 'Portail du Nether', {
  solid: false, opaque: false, render: 'model', pass: 'translucent', hardness: -1, light: 11, drops: nothing, hidden: true, portal: true,
  boxes: (meta) => (meta & 1 ? [box(6, 0, 0, 10, 16, 16, 'nether_portal', { only: [W, E] })] : [box(0, 0, 6, 16, 16, 10, 'nether_portal', { only: [N, S] })]),
  select: (meta) => (meta & 1 ? [box(6, 0, 0, 10, 16, 16)] : [box(0, 0, 6, 16, 16, 10)]),
});
def('jack_o_lantern', 'Citrouille-lanterne', { hardness: 1, tool: 'axe', sound: 'wood', light: 15, tex: { top: 'pumpkin_top', bottom: 'pumpkin_top', side: 'pumpkin_side', front: 'jack_o_lantern' } });
def('stone_bricks', 'Pierres taillées', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('mossy_stone_bricks', 'Pierres taillées moussues', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('cracked_stone_bricks', 'Pierres taillées craquelées', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('nether_bricks', 'Briques du Nether', { hardness: 2, blast: 6, tool: 'pickaxe', level: 0 });
def('enchanting_table', 'Table d\'enchantement', {
  opaque: false, render: 'model', hardness: 5, blast: 1200, tool: 'pickaxe', level: 0, light: 7,
  boxes: () => [box(0, 0, 0, 16, 12, 16, { top: 'enchanting_table_top', side: 'enchanting_table_side', bottom: 'enchanting_table_bottom' })],
  container: 'enchant',
});
def('end_portal_frame', 'Cadre de portail de l\'End', {
  opaque: false, render: 'model', hardness: -1, light: 1, drops: nothing,
  boxes: (meta) => {
    const r = [box(0, 0, 0, 16, 13, 16, { top: 'end_portal_frame_top', side: 'end_portal_frame_side', bottom: 'end_stone' })];
    if (meta & 4) r.push(box(4, 13, 4, 12, 16, 12, { top: 'end_portal_frame_eye', side: 'end_portal_frame_eye', bottom: 'end_portal_frame_eye' }));
    return r;
  },
});
def('end_portal', 'Portail de l\'End', {
  solid: false, opaque: false, render: 'model', hardness: -1, light: 15, drops: nothing, hidden: true, portal: true,
  boxes: () => [box(0, 0, 0, 16, 12, 16, 'end_portal', { only: [U], anim: 3 })],
  select: () => [],
});
def('end_stone', 'Pierre de l\'End', { hardness: 3, blast: 9, tool: 'pickaxe', level: 0 });
def('dragon_egg', 'Œuf de dragon', {
  opaque: false, render: 'model', hardness: 3, blast: 9, light: 1, gravity: true,
  boxes: () => [
    box(6, 15, 6, 10, 16, 10, 'dragon_egg'), box(5, 14, 5, 11, 15, 11, 'dragon_egg'), box(4, 13, 4, 12, 14, 12, 'dragon_egg'),
    box(3, 11, 3, 13, 13, 13, 'dragon_egg'), box(2, 8, 2, 14, 11, 14, 'dragon_egg'), box(1, 3, 1, 15, 8, 15, 'dragon_egg'),
    box(2, 1, 2, 14, 3, 14, 'dragon_egg'), box(3, 0, 3, 13, 1, 13, 'dragon_egg'),
  ],
  collide: () => [box(1, 0, 1, 15, 16, 15)],
});
def('birch_log', 'Bûche de bouleau', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, tex: { top: 'birch_log_top', side: 'birch_log', axis: true }, fuel: 300 });
def('birch_leaves', 'Feuilles de bouleau', {
  opaque: false, pass: 'cutout', hardness: 0.2, tool: 'hoe', sound: 'grass', opacity: 1, flammable: 30, tint: 'birch', leaves: true,
  drops: (m, rng) => (rng() < 0.05 ? [[B.birch_sapling, 1]] : rng() < 0.02 ? [[I.stick, 1]] : []),
});
def('birch_planks', 'Planches de bouleau', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, fuel: 300 });
def('spruce_log', 'Bûche de sapin', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, tex: { top: 'spruce_log_top', side: 'spruce_log', axis: true }, fuel: 300 });
def('spruce_leaves', 'Feuilles de sapin', {
  opaque: false, pass: 'cutout', hardness: 0.2, tool: 'hoe', sound: 'grass', opacity: 1, flammable: 30, tint: 'spruce', leaves: true,
  drops: (m, rng) => (rng() < 0.05 ? [[B.spruce_sapling, 1]] : rng() < 0.02 ? [[I.stick, 1]] : []),
});
def('spruce_planks', 'Planches de sapin', { hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, fuel: 300 });
def('birch_sapling', 'Pousse de bouleau', flower);
def('spruce_sapling', 'Pousse de sapin', flower);
def('short_grass', 'Herbes hautes', Object.assign({}, flower, { replaceable: true, tint: 'grass', drops: (m, rng) => (rng() < 0.125 ? [[I.wheat_seeds, 1]] : []), shears: true }));
def('fern', 'Fougère', Object.assign({}, flower, { replaceable: true, tint: 'grass', drops: (m, rng) => (rng() < 0.125 ? [[I.wheat_seeds, 1]] : []), shears: true }));
def('dead_bush', 'Buisson mort', Object.assign({}, flower, { replaceable: true, drops: (m, rng) => [[I.stick, Math.floor(rng() * 3)]], shears: true }));
def('cornflower', 'Bleuet', flower);
def('oxeye_daisy', 'Marguerite', flower);
def('cobweb', 'Toile d\'araignée', { solid: false, opaque: false, render: 'cross', pass: 'cutout', hardness: 4, tool: 'sword', sound: 'cloth', opacity: 1, drops: one(I.string), web: true, needsTool: true });
function paneBoxes(tex) {
  return (meta, nb) => {
    const r = [box(7, 0, 7, 9, 16, 9, tex)];
    const con = (dx, dz) => {
      const id = nb ? nb(dx, 0, dz) : 0;
      return id && (OPAQUE[id] || BLOCKS[id]?.pane);
    };
    const cn = con(0, -1), cs = con(0, 1), cw = con(-1, 0), ce = con(1, 0);
    const none = !cn && !cs && !cw && !ce;
    if (cn || none) r.push(box(7, 0, 0, 9, 16, 7, tex));
    if (cs || none) r.push(box(7, 0, 9, 9, 16, 16, tex));
    if (cw || none) r.push(box(0, 0, 7, 7, 16, 9, tex));
    if (ce || none) r.push(box(9, 0, 7, 16, 16, 9, tex));
    return r;
  };
}
def('iron_bars', 'Barreaux de fer', { opaque: false, render: 'model', pass: 'cutout', hardness: 5, tool: 'pickaxe', level: 0, sound: 'metal', pane: true, boxes: paneBoxes('iron_bars') });
def('bed', 'Lit', {
  opaque: false, render: 'model', hardness: 0.2, sound: 'wood', hidden: true, pick: () => I.bed_item,
  drops: () => [[I.bed_item, 1]],
  boxes: (meta) => {
    const head = meta & 4;
    const f = meta & 3;
    const top = head ? 'bed_head_top' : 'bed_foot_top';
    const r = [rotBox(box(0, 3, 0, 16, 9, 16, { top, side: head ? 'bed_head_side' : 'bed_foot_side', bottom: 'oak_planks', front: head ? 'bed_head_end' : 'bed_side_plain', back: head ? 'bed_side_plain' : 'bed_foot_end' }, { rotTop: f }), f)];
    // pieds
    const legs = head ? [[0, 0], [13, 0]] : [[0, 13], [13, 13]];
    for (const [lx, lz] of legs) r.push(rotBox(box(lx, 0, lz, lx + 3, 3, lz + 3, 'oak_planks'), f));
    return r;
  },
  collide: () => [box(0, 0, 0, 16, 9, 16)],
});
def('emerald_ore', 'Minerai d\'émeraude', { hardness: 3, tool: 'pickaxe', level: 2, drops: one(I.emerald), xp: [3, 7], fortune: true });
def('emerald_block', 'Bloc d\'émeraude', { hardness: 5, tool: 'pickaxe', level: 2, sound: 'metal' });
def('coal_block', 'Bloc de charbon', { hardness: 5, tool: 'pickaxe', level: 0, fuel: 16000, flammable: 5 });
def('redstone_block', 'Bloc de redstone', { hardness: 5, tool: 'pickaxe', level: 0, sound: 'metal' });
def('nether_quartz_ore', 'Minerai de quartz du Nether', { hardness: 3, tool: 'pickaxe', level: 0, drops: one(I.quartz), xp: [2, 5], fortune: true });
def('quartz_block', 'Bloc de quartz', { hardness: 0.8, tool: 'pickaxe', level: 0, tex: { top: 'quartz_block_top', side: 'quartz_block' } });
def('granite', 'Granite', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('diorite', 'Diorite', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('andesite', 'Andésite', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('melon', 'Pastèque', { hardness: 1, tool: 'axe', sound: 'wood', tex: { top: 'melon_top', side: 'melon_side' }, drops: (m, rng) => [[I.melon_slice, 3 + Math.floor(rng() * 5)]] });
def('hay_block', 'Botte de foin', { hardness: 0.5, tool: 'hoe', sound: 'grass', flammable: 60, tex: { top: 'hay_block_top', side: 'hay_block_side', axis: true } });
def('magma_block', 'Bloc de magma', { hardness: 0.5, tool: 'pickaxe', level: 0, light: 3, damage: 1, magma: true });
function fenceBoxes(tex, fenceKey) {
  return (meta, nb) => {
    const r = [box(6, 0, 6, 10, 16, 10, tex)];
    const con = (dx, dz) => {
      const id = nb ? nb(dx, 0, dz) : 0;
      return id && (OPAQUE[id] || BLOCKS[id]?.fence === fenceKey);
    };
    if (con(0, -1)) r.push(box(7, 12, 0, 9, 15, 6, tex), box(7, 6, 0, 9, 9, 6, tex));
    if (con(0, 1)) r.push(box(7, 12, 10, 9, 15, 16, tex), box(7, 6, 10, 9, 9, 16, tex));
    if (con(-1, 0)) r.push(box(0, 12, 7, 6, 15, 9, tex), box(0, 6, 7, 6, 9, 9, tex));
    if (con(1, 0)) r.push(box(10, 12, 7, 16, 15, 9, tex), box(10, 6, 7, 16, 9, 9, tex));
    return r;
  };
}
function fenceCollide(fenceKey) {
  return (meta, nb) => {
    const r = [box(6, 0, 6, 10, 24, 10)];
    const con = (dx, dz) => {
      const id = nb ? nb(dx, 0, dz) : 0;
      return id && (OPAQUE[id] || BLOCKS[id]?.fence === fenceKey);
    };
    if (con(0, -1)) r.push(box(6, 0, 0, 10, 24, 6));
    if (con(0, 1)) r.push(box(6, 0, 10, 10, 24, 16));
    if (con(-1, 0)) r.push(box(0, 0, 6, 6, 24, 10));
    if (con(1, 0)) r.push(box(10, 0, 6, 16, 24, 10));
    return r;
  };
}
def('nether_brick_fence', 'Barrière en briques du Nether', { opaque: false, render: 'model', hardness: 2, tool: 'pickaxe', level: 0, fence: 'nether', boxes: fenceBoxes('nether_bricks', 'nether'), collide: fenceCollide('nether'), select: (m, nb) => fenceBoxes('nether_bricks', 'nether')(m, nb) });
def('oak_fence', 'Barrière en chêne', { opaque: false, render: 'model', hardness: 2, tool: 'axe', sound: 'wood', fence: 'wood', flammable: 5, fuel: 300, boxes: fenceBoxes('oak_planks', 'wood'), collide: fenceCollide('wood'), select: (m, nb) => fenceBoxes('oak_planks', 'wood')(m, nb) });
def('packed_ice', 'Glace compactée', { hardness: 0.5, tool: 'pickaxe', sound: 'glass', slip: 0.98, drops: nothing });

function stairBoxes(tex) {
  return (meta) => {
    const f = meta & 3, up = meta & 4;
    if (!up) return [box(0, 0, 0, 16, 8, 16, tex), rotBox(box(0, 8, 0, 16, 16, 8, tex), f)];
    return [box(0, 8, 0, 16, 16, 16, tex), rotBox(box(0, 0, 0, 16, 8, 8, tex), f)];
  };
}
def('oak_stairs', 'Escalier en chêne', { opaque: false, render: 'model', hardness: 2, tool: 'axe', sound: 'wood', flammable: 5, stairs: true, opacity: 15, boxes: stairBoxes('oak_planks'), fuel: 300 });
def('cobblestone_stairs', 'Escalier en pierre taillée', { opaque: false, render: 'model', hardness: 2, blast: 6, tool: 'pickaxe', level: 0, stairs: true, opacity: 15, boxes: stairBoxes('cobblestone') });
def('stone_brick_stairs', 'Escalier en pierres taillées', { opaque: false, render: 'model', hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0, stairs: true, opacity: 15, boxes: stairBoxes('stone_bricks') });
def('nether_brick_stairs', 'Escalier en briques du Nether', { opaque: false, render: 'model', hardness: 2, blast: 6, tool: 'pickaxe', level: 0, stairs: true, opacity: 15, boxes: stairBoxes('nether_bricks') });
function slabBoxes(tex) {
  return (meta) => (meta === 2 ? [box(0, 0, 0, 16, 16, 16, tex)] : meta === 1 ? [box(0, 8, 0, 16, 16, 16, tex)] : [box(0, 0, 0, 16, 8, 16, tex)]);
}
def('stone_slab', 'Dalle de pierre', { opaque: false, render: 'model', hardness: 2, blast: 6, tool: 'pickaxe', level: 0, slab: true, opacity: 0, boxes: slabBoxes({ top: 'smooth_stone', side: 'smooth_stone_slab_side' }), drops: (m) => [[B.stone_slab, m === 2 ? 2 : 1]] });
def('oak_slab', 'Dalle en chêne', { opaque: false, render: 'model', hardness: 2, tool: 'axe', sound: 'wood', slab: true, opacity: 0, flammable: 5, fuel: 150, boxes: slabBoxes('oak_planks'), drops: (m) => [[B.oak_slab, m === 2 ? 2 : 1]] });
def('smooth_stone', 'Pierre lisse', { hardness: 2, blast: 6, tool: 'pickaxe', level: 0 });
def('brewing_stand', 'Alambic', {
  opaque: false, render: 'model', pass: 'cutout', hardness: 0.5, tool: 'pickaxe', level: 0, light: 1, container: 'brewing', sound: 'metal',
  boxes: () => [box(7, 0, 7, 9, 14, 9, 'brewing_stand_rod'), box(1, 0, 1, 15, 2, 15, 'brewing_stand_base', { only: [U, N, S, W, E] })],
  collide: () => [box(1, 0, 1, 15, 2, 15), box(7, 0, 7, 9, 14, 9)],
});
def('anvil', 'Enclume', { opaque: false, render: 'model', hardness: 5, blast: 1200, tool: 'pickaxe', level: 0, sound: 'metal', hidden: true, boxes: () => [box(2, 0, 2, 14, 4, 14, 'iron_block'), box(4, 4, 3, 12, 10, 13, 'iron_block'), box(0, 10, 3, 16, 16, 13, 'iron_block')] });
def('white_bed_unused', 'Lit (inutilisé)', { hidden: true });
def('crying_obsidian', 'Obsidienne pleureuse', { hardness: 50, blast: 1200, tool: 'pickaxe', level: 3, light: 10 });
def('bone_block', 'Bloc d\'os', { hardness: 2, tool: 'pickaxe', level: 0, tex: { top: 'bone_block_top', side: 'bone_block_side', axis: true } });
def('lantern', 'Lanterne', {
  opaque: false, render: 'model', pass: 'cutout', hardness: 3.5, tool: 'pickaxe', level: 0, light: 15, sound: 'metal', solid: true,
  boxes: () => [box(5, 0, 5, 11, 7, 11, 'lantern', { uv: { [U]: [0, 9, 6, 15], [D]: [0, 9, 6, 15], side: [0, 2, 6, 9] } }), box(6, 7, 6, 10, 9, 10, 'lantern', { uv: { [U]: [1, 10, 5, 14], side: [1, 0, 5, 2] } })],
});
def('end_stone_bricks', 'Briques de pierre de l\'End', { hardness: 3, blast: 9, tool: 'pickaxe', level: 0 });
def('purpur_block', 'Bloc de purpur', { hardness: 1.5, blast: 6, tool: 'pickaxe', level: 0 });
def('ender_chest', 'Coffre de l\'Ender', {
  opaque: false, render: 'model', hardness: 22.5, blast: 600, tool: 'pickaxe', level: 0, light: 7, container: 'ender_chest', drops: () => [[B.obsidian, 8]],
  boxes: (meta) => [rotBox(box(1, 0, 1, 15, 14, 15, { top: 'ender_chest_top', bottom: 'ender_chest_top', side: 'ender_chest_side', front: 'ender_chest_front' }), meta & 3)],
});
def('cake', 'Gâteau', {
  opaque: false, render: 'model', hardness: 0.5, sound: 'cloth', hidden: true, drops: nothing, pick: () => I.cake_item,
  boxes: (meta) => [box(1 + (meta & 7) * 2, 0, 1, 15, 8, 15, { top: 'cake_top', bottom: 'cake_bottom', side: 'cake_side', west: meta ? 'cake_inner' : 'cake_side' })],
});
def('trapdoor', 'Trappe', {
  opaque: false, render: 'model', pass: 'cutout', hardness: 3, tool: 'axe', sound: 'wood', flammable: 5, fuel: 300,
  boxes: (meta) => {
    const open = meta & 4, top = meta & 8;
    if (!open) return [top ? box(0, 13, 0, 16, 16, 16, 'trapdoor') : box(0, 0, 0, 16, 3, 16, 'trapdoor')];
    return [rotBox(box(0, 0, 13, 16, 16, 16, 'trapdoor'), meta & 3)];
  },
});
def('dirt_path', 'Chemin de terre', { opaque: false, render: 'model', hardness: 0.65, tool: 'shovel', sound: 'gravel', opacity: 15, drops: one(B.dirt), boxes: () => [box(0, 0, 0, 16, 15, 16, { top: 'dirt_path_top', side: 'dirt_path_side', bottom: 'dirt' })] });
def('blue_wool', 'Laine bleue', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
def('red_wool', 'Laine rouge', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
def('yellow_wool', 'Laine jaune', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
def('green_wool', 'Laine verte', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
def('black_wool', 'Laine noire', { hardness: 0.8, tool: 'shears', sound: 'cloth', flammable: 30 });
def('glass_pane', 'Vitre', { opaque: false, render: 'model', pass: 'cutout', hardness: 0.3, sound: 'glass', pane: true, drops: nothing, boxes: paneBoxes('glass_pane') });

// ====== Remplissage des tables ======
for (let i = 0; i < 256; i++) {
  const d = BLOCKS[i];
  if (!d) continue;
  OPAQUE[i] = d.opaque && d.render === 'cube' ? 1 : 0;
  SOLID[i] = d.solid ? 1 : 0;
  EMIT[i] = d.light;
  OPACITY[i] = d.opacity;
  RENDER[i] = RENDER_CODES[d.render];
  REPLACEABLE[i] = d.replaceable ? 1 : 0;
  LIQUID[i] = d.liquid ? 1 : 0;
}

export function blockDef(id) {
  return BLOCKS[id] || BLOCKS[0];
}

// Boîtes de collision (en blocs, relatives) d'un bloc ; null = aucune
export function collisionBoxes(id, meta, nb) {
  const d = BLOCKS[id];
  if (!d || !d.solid) return null;
  if (d.collide) return d.collide(meta, nb);
  if (d.render === 'model' && d.boxes) return d.boxes(meta, nb);
  return fullBox;
}

export function selectionBoxes(id, meta, nb) {
  const d = BLOCKS[id];
  if (!d || id === 0) return null;
  if (d.select) return d.select(meta, nb);
  if (d.render === 'cross' || d.render === 'crop') {
    if (d.key === 'wheat') return [box(0, 0, 0, 16, 2 + (meta & 7) * 2, 16)];
    return [box(2, 0, 2, 14, 13, 14)];
  }
  if (d.render === 'liquid') return null;
  if (d.render === 'model' && d.boxes) return d.boxes(meta, nb);
  return fullBox;
}
