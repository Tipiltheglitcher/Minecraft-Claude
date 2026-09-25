// Progrès (succès) guidant le joueur jusqu'à la fin du jeu
import { B, I } from '../data/ids.js';

export const ADVANCEMENTS = [
  { id: 'root', title: 'Minecraft', desc: 'Le cœur et l\'histoire du jeu', icon: B.grass_block, parent: null },
  { id: 'wood', title: 'Prendre du bois', desc: 'Frappez un arbre jusqu\'à obtenir une bûche', icon: B.oak_log, parent: 'root' },
  { id: 'bench', title: 'Établi', desc: 'Fabriquez une table de craft avec 4 planches', icon: B.crafting_table, parent: 'wood' },
  { id: 'wood_pick', title: 'Au boulot !', desc: 'Fabriquez une pioche en bois', icon: I.wooden_pickaxe, parent: 'bench' },
  { id: 'stone', title: 'L\'âge de pierre', desc: 'Minez de la pierre avec votre pioche', icon: B.cobblestone, parent: 'wood_pick' },
  { id: 'stone_pick', title: 'Amélioration', desc: 'Fabriquez une pioche en pierre', icon: I.stone_pickaxe, parent: 'stone' },
  { id: 'furnace', title: 'Question brûlante', desc: 'Fabriquez un four avec 8 pierres taillées', icon: B.furnace, parent: 'stone' },
  { id: 'iron', title: 'Acquérir du matériel', desc: 'Faites fondre du minerai de fer', icon: I.iron_ingot, parent: 'furnace' },
  { id: 'iron_pick', title: 'Pioche de fer', desc: 'Fabriquez une pioche en fer', icon: I.iron_pickaxe, parent: 'iron' },
  { id: 'armor', title: 'Équipez-vous', desc: 'Portez une pièce d\'armure en fer', icon: I.iron_chestplate, parent: 'iron' },
  { id: 'bucket', title: 'Seau', desc: 'Fabriquez un seau', icon: I.bucket, parent: 'iron' },
  { id: 'lava_bucket', title: 'C\'est chaud', desc: 'Remplissez un seau de lave', icon: I.lava_bucket, parent: 'bucket' },
  { id: 'diamonds', title: 'Diamants !', desc: 'Obtenez des diamants (sous la couche 16)', icon: I.diamond, parent: 'iron_pick' },
  { id: 'diamond_armor', title: 'Couvrez-moi de diamants', desc: 'Portez une armure en diamant', icon: I.diamond_chestplate, parent: 'diamonds' },
  { id: 'enchant', title: 'Enchanteur', desc: 'Enchantez un objet sur une table d\'enchantement', icon: B.enchanting_table, parent: 'diamonds' },
  { id: 'obsidian', title: 'Défi du seau de glace', desc: 'Obtenez de l\'obsidienne (pioche en diamant, ou eau sur lave)', icon: B.obsidian, parent: 'diamonds' },
  { id: 'nether', title: 'Nous devons aller plus profond', desc: 'Allumez un portail d\'obsidienne (4×5) et entrez dans le Nether', icon: I.flint_and_steel, parent: 'obsidian' },
  { id: 'fortress', title: 'Une forteresse terrible', desc: 'Trouvez une forteresse du Nether (briques sombres)', icon: B.nether_bricks, parent: 'nether' },
  { id: 'blaze_rod', title: 'Dans le feu', desc: 'Obtenez un bâton de Blaze', icon: I.blaze_rod, parent: 'fortress' },
  { id: 'brew', title: 'Brasserie locale', desc: 'Préparez une potion', icon: I.potion, parent: 'blaze_rod' },
  { id: 'pearl', title: 'Perle rare', desc: 'Obtenez une perle de l\'Ender (Endermen, prêtres, coffres)', icon: I.ender_pearl, parent: 'iron' },
  { id: 'eye', title: 'L\'œil qui voit tout', desc: 'Fabriquez un œil de l\'Ender (poudre de Blaze + perle)', icon: I.ender_eye, parent: 'blaze_rod' },
  { id: 'stronghold', title: 'Œil pour œil', desc: 'Lancez des yeux de l\'Ender et suivez-les jusqu\'au fort', icon: B.stone_bricks, parent: 'eye' },
  { id: 'end_portal', title: 'Le portail est ouvert', desc: 'Placez 12 yeux de l\'Ender dans les cadres du portail', icon: B.end_portal_frame, parent: 'stronghold' },
  { id: 'end', title: 'La Fin ?', desc: 'Entrez dans le portail de l\'End', icon: B.end_stone, parent: 'end_portal' },
  { id: 'crystal', title: 'Briseur de cristaux', desc: 'Détruisez un cristal de l\'End (flèches ou coup d\'épée)', icon: I.bow, parent: 'end' },
  { id: 'dragon', title: 'Libérer l\'End', desc: 'Vainquez l\'Ender Dragon', icon: B.dragon_egg, parent: 'end', type: 'goal' },
  { id: 'egg', title: 'La génération suivante', desc: 'Obtenez l\'œuf de dragon', icon: B.dragon_egg, parent: 'dragon' },
  { id: 'credits', title: 'La Fin.', desc: 'Traversez le portail de sortie et terminez le jeu', icon: B.end_portal_frame, parent: 'dragon', type: 'challenge' },
  { id: 'kill', title: 'Chasseur de monstres', desc: 'Tuez une créature hostile', icon: I.iron_sword, parent: 'root' },
  { id: 'bow', title: 'Dans le mille', desc: 'Tirez une flèche avec un arc', icon: I.bow, parent: 'kill' },
  { id: 'sleep', title: 'Doux rêves', desc: 'Dormez dans un lit', icon: I.bed_item, parent: 'root' },
  { id: 'hoe', title: 'Fermier en herbe', desc: 'Fabriquez une houe', icon: I.wooden_hoe, parent: 'root' },
  { id: 'bread', title: 'Boulanger', desc: 'Faites du pain avec 3 blés', icon: I.bread, parent: 'hoe' },
  { id: 'cake', title: 'Le mensonge', desc: 'Préparez un gâteau', icon: I.cake_item, parent: 'bread' },
  { id: 'breed', title: 'Les oiseaux et les abeilles', desc: 'Faites se reproduire deux animaux', icon: I.wheat_item, parent: 'root' },
  { id: 'trade', title: 'Marché conclu !', desc: 'Commercez avec un villageois', icon: I.emerald, parent: 'root' },
  { id: 'eat', title: 'Bon appétit', desc: 'Mangez quelque chose', icon: I.apple, parent: 'root' },
];

export const ADV_BY_ID = Object.fromEntries(ADVANCEMENTS.map((a) => [a.id, a]));

// Correspondance objet obtenu -> progrès
export const ITEM_ADV = {
  [B.oak_log]: 'wood', [B.birch_log]: 'wood', [B.spruce_log]: 'wood',
  [B.crafting_table]: 'bench', [I.wooden_pickaxe]: 'wood_pick', [B.cobblestone]: 'stone', [I.stone_pickaxe]: 'stone_pick',
  [B.furnace]: 'furnace', [I.iron_ingot]: 'iron', [I.iron_pickaxe]: 'iron_pick', [I.bucket]: 'bucket', [I.lava_bucket]: 'lava_bucket',
  [I.diamond]: 'diamonds', [B.obsidian]: 'obsidian', [I.blaze_rod]: 'blaze_rod', [I.ender_pearl]: 'pearl', [I.ender_eye]: 'eye',
  [B.dragon_egg]: 'egg', [I.bread]: 'bread', [I.cake_item]: 'cake', [I.wooden_hoe]: 'hoe', [I.stone_hoe]: 'hoe', [I.iron_hoe]: 'hoe',
  [I.golden_hoe]: 'hoe', [I.diamond_hoe]: 'hoe', [I.diamond_pickaxe]: 'iron_pick',
};

// Étapes du guide de progression
export const GUIDE = [
  ['1. Survivre', 'Frappez un arbre (clic gauche maintenu) pour obtenir des bûches. Ouvrez l\'inventaire (E) et transformez-les en planches, puis fabriquez une table de craft (4 planches).'],
  ['2. Outils', 'Avec la table de craft : bâtons (2 planches), pioche en bois, puis en pierre. Fabriquez un four (8 pierres taillées) et des torches (charbon + bâton). Dormez dans un lit (3 laines + 3 planches) pour passer la nuit.'],
  ['3. Fer et diamants', 'Faites fondre le minerai de fer dans le four. Avec une pioche en fer, creusez vers la couche Y=5..16 pour trouver des diamants. Une pioche en diamant permet de miner l\'obsidienne.'],
  ['4. Le Nether', 'Construisez un cadre d\'obsidienne de 4×5 (10 blocs sans les coins), allumez-le avec un briquet (fer + silex). Astuce : on peut aussi créer l\'obsidienne en versant de l\'eau sur de la lave source.'],
  ['5. Forteresse et Blazes', 'Dans le Nether, cherchez une forteresse en briques sombres. Tuez des Blazes (près des générateurs) pour obtenir des bâtons de Blaze. Transformez-les en poudre de Blaze.'],
  ['6. Perles de l\'Ender', 'Tuez des Endermen (la nuit, ne les regardez pas en face !), échangez avec un prêtre de village ou fouillez les coffres. Poudre de Blaze + perle = œil de l\'Ender. Il en faut au moins 12 (souvent moins : certains cadres en ont déjà).'],
  ['7. Le fort', 'Lancez un œil de l\'Ender (clic droit) : il vole vers le fort. Suivez-le puis creusez sous l\'endroit où il plonge. Dans la salle du portail, placez les yeux dans les 12 cadres.'],
  ['8. L\'End', 'Entrez dans le portail. Détruisez les cristaux de l\'End sur les piliers d\'obsidienne (flèches !), ils soignent le dragon. Frappez le dragon à la tête quand il se pose sur la fontaine centrale.'],
  ['9. Victoire', 'Une fois le dragon vaincu, le portail de sortie s\'active au centre. Sautez dedans pour voir la fin et revenir dans votre monde !'],
];
