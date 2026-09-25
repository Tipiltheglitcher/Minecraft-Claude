// Identifiants numériques des blocs et objets.
// IMPORTANT : ne faire qu'ajouter à la fin des listes (compatibilité des sauvegardes).

export const BLOCK_KEYS = [
  'air', 'stone', 'grass_block', 'dirt', 'cobblestone', 'oak_planks', 'oak_sapling', 'bedrock',
  'water', 'lava', 'sand', 'gravel', 'gold_ore', 'iron_ore', 'coal_ore', 'oak_log',
  'oak_leaves', 'glass', 'lapis_ore', 'lapis_block', 'sandstone', 'white_wool', 'dandelion', 'poppy',
  'brown_mushroom', 'red_mushroom', 'gold_block', 'iron_block', 'bricks', 'tnt', 'bookshelf', 'mossy_cobblestone',
  'obsidian', 'torch', 'fire', 'spawner', 'chest', 'diamond_ore', 'diamond_block', 'crafting_table',
  'wheat', 'farmland', 'furnace', 'lit_furnace', 'oak_door', 'ladder', 'redstone_ore', 'snow',
  'ice', 'snow_block', 'cactus', 'clay', 'sugar_cane', 'pumpkin', 'netherrack', 'soul_sand',
  'glowstone', 'nether_portal', 'jack_o_lantern', 'stone_bricks', 'mossy_stone_bricks', 'cracked_stone_bricks', 'nether_bricks', 'enchanting_table',
  'end_portal_frame', 'end_portal', 'end_stone', 'dragon_egg', 'birch_log', 'birch_leaves', 'birch_planks', 'spruce_log',
  'spruce_leaves', 'spruce_planks', 'birch_sapling', 'spruce_sapling', 'short_grass', 'fern', 'dead_bush', 'cornflower',
  'oxeye_daisy', 'cobweb', 'iron_bars', 'bed', 'emerald_ore', 'emerald_block', 'coal_block', 'redstone_block',
  'nether_quartz_ore', 'quartz_block', 'granite', 'diorite', 'andesite', 'melon', 'hay_block', 'magma_block',
  'nether_brick_fence', 'oak_fence', 'packed_ice', 'oak_stairs', 'cobblestone_stairs', 'stone_brick_stairs', 'nether_brick_stairs', 'stone_slab',
  'oak_slab', 'smooth_stone', 'brewing_stand', 'anvil', 'white_bed_unused', 'crying_obsidian', 'bone_block', 'lantern',
  'end_stone_bricks', 'purpur_block', 'ender_chest', 'cake', 'trapdoor', 'dirt_path', 'blue_wool', 'red_wool',
  'yellow_wool', 'green_wool', 'black_wool', 'glass_pane',
];

export const ITEM_KEYS = [
  'stick', 'coal', 'charcoal', 'iron_ingot', 'gold_ingot', 'diamond', 'emerald', 'lapis_lazuli',
  'redstone', 'flint', 'feather', 'string', 'leather', 'bone', 'bone_meal', 'gunpowder',
  'arrow', 'bow',
  'wooden_pickaxe', 'wooden_axe', 'wooden_shovel', 'wooden_hoe', 'wooden_sword',
  'stone_pickaxe', 'stone_axe', 'stone_shovel', 'stone_hoe', 'stone_sword',
  'iron_pickaxe', 'iron_axe', 'iron_shovel', 'iron_hoe', 'iron_sword',
  'golden_pickaxe', 'golden_axe', 'golden_shovel', 'golden_hoe', 'golden_sword',
  'diamond_pickaxe', 'diamond_axe', 'diamond_shovel', 'diamond_hoe', 'diamond_sword',
  'leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots',
  'iron_helmet', 'iron_chestplate', 'iron_leggings', 'iron_boots',
  'golden_helmet', 'golden_chestplate', 'golden_leggings', 'golden_boots',
  'diamond_helmet', 'diamond_chestplate', 'diamond_leggings', 'diamond_boots',
  'apple', 'golden_apple', 'bread', 'porkchop', 'cooked_porkchop', 'beef', 'cooked_beef', 'chicken',
  'cooked_chicken', 'mutton', 'cooked_mutton', 'rotten_flesh', 'spider_eye', 'melon_slice', 'wheat_item', 'wheat_seeds',
  'sugar_cane_item', 'paper', 'book', 'sugar', 'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket',
  'flint_and_steel', 'shears', 'compass', 'clock', 'ender_pearl', 'blaze_rod', 'blaze_powder', 'ender_eye',
  'ghast_tear', 'gold_nugget', 'quartz', 'glowstone_dust', 'bed_item', 'door_item', 'snowball', 'clay_ball',
  'brick', 'nether_brick', 'magma_cream', 'enchanted_book', 'cookie', 'pumpkin_pie', 'carrot', 'potato',
  'baked_potato', 'egg', 'cod', 'cooked_cod', 'fishing_rod', 'potion', 'glass_bottle', 'nether_wart',
  'spawn_pig', 'spawn_cow', 'spawn_sheep', 'spawn_chicken', 'spawn_zombie', 'spawn_skeleton', 'spawn_creeper', 'spawn_spider',
  'spawn_enderman', 'spawn_villager', 'spawn_blaze', 'spawn_ghast', 'spawn_piglin', 'spawn_wither_skeleton', 'spawn_magma_cube', 'spawn_slime',
  'iron_nugget', 'cake_item', 'dragon_breath', 'experience_bottle', 'map', 'totem',
];

export const B = {};
BLOCK_KEYS.forEach((k, i) => (B[k] = i));
export const I = {};
ITEM_KEYS.forEach((k, i) => (I[k] = 256 + i));
// Les blocs sont aussi des objets (même identifiant)
export const ID = { ...B, ...I };
