# Minecraft JS

Un clone complet de **Minecraft** jouable dans le navigateur, écrit de zéro en JavaScript et WebGL2, **sans aucune dépendance ni ressource externe** : toutes les textures, les modèles, les sons et la musique sont générés procéduralement au lancement. L'interface est en français.

Le jeu se **termine** comme l'original : on survit, on part dans le Nether chercher des bâtons de Blaze, on fabrique des yeux de l'Ender, on trouve le fort, on active le portail de l'End, on vainc l'**Ender Dragon**, puis on traverse le portail de sortie pour voir l'épilogue et le générique.

## Jouer

- **Le plus simple** : ouvrez `dist/minecraft.html` dans un navigateur récent (Chrome, Edge, Firefox, Safari 15+). C'est un fichier unique et autonome, il fonctionne même hors ligne (double-clic).
- **Version de développement** (modules ES) : servez le dossier avec un serveur statique, par exemple `npm run serve`, puis ouvrez <http://localhost:8080>.
- Reconstruire le fichier unique : `npm install` puis `npm run build`.

## Commandes

| Touche | Action |
| --- | --- |
| ZQSD / WASD (touches physiques) | Se déplacer |
| Espace | Sauter, nager ; double appui : voler (créatif) |
| Maj gauche | S'accroupir (on ne tombe pas des bords) |
| Ctrl ou double appui sur Z/W | Sprinter |
| Clic gauche | Miner, attaquer |
| Clic droit | Poser, utiliser, manger, tirer à l'arc, ouvrir |
| Clic molette | Choisir le bloc visé |
| 1-9, molette | Barre d'action |
| E | Inventaire (livre de recettes intégré) |
| Q / Ctrl+Q | Jeter un objet / la pile |
| T ou / | Chat et commandes (`/help`) |
| L | Progrès |
| F1 / F2 / F3 / F5 | Masquer l'interface / capture / débogage / vue à la 3e personne |
| Échap | Pause, options, guide |

Dans l'inventaire : Maj+clic pour un déplacement rapide, clic droit pour prendre la moitié ou déposer un par un, glisser pour répartir, double-clic pour rassembler, touches 1-9 pour échanger avec la barre d'action. Le **livre de recettes** (à gauche) liste toutes les recettes et les place dans la grille d'un clic.

Si le navigateur refuse le verrouillage de la souris (page intégrée dans une autre), maintenez un bouton de la souris enfoncé et déplacez-la pour regarder autour de vous. Des commandes tactiles de base existent sur mobile.

## Contenu

**Monde**
- Terrain infini généré par bruit simplex : océans, plages, rivières, plaines, forêts, forêts de bouleaux, taïgas, plaines et taïgas enneigées, déserts, marais, montagnes enneigées.
- Grottes (tunnels et cavernes), lacs de lave souterrains, minerais (charbon, fer, or, redstone, lapis, diamant, émeraude), granite / diorite / andésite.
- Arbres (chêne, bouleau, sapin, grands chênes), cactus, canne à sucre, fleurs, herbes, citrouilles, pastèques.
- Villages avec maisons, forge, bibliothèque, église, champs cultivés, puits, villageois et golem de fer.
- Donjons avec générateur de monstres et coffres, fort souterrain avec bibliothèque et salle du portail de l'End.
- Cycle jour/nuit, soleil, lune, étoiles, nuages, pluie, neige, orages.
- Éclairage par propagation (soleil et torches), occlusion ambiante, eau et lave qui s'écoulent (sources infinies, obsidienne, pierre taillée), sable et gravier qui tombent, feu qui se propage, TNT.

**Survie**
- Santé, faim et saturation, régénération, famine, dégâts de chute, noyade, lave, feu, étouffement, cactus, vide.
- Minage avec vitesses et niveaux d'outils fidèles (bois, pierre, fer, or, diamant), durabilité, outils adaptés.
- Artisanat 2×2 et 3×3 (plus de 130 recettes), four (44 cuissons) avec combustibles et expérience, coffres, coffre de l'Ender. Plus de 120 blocs et 260 objets.
- Armures (cuir, fer, or, diamant), arc et flèches, épées, haches, nourritures variées.
- Agriculture (houe, graines, blé, poudre d'os, pousses d'arbres), élevage et reproduction des animaux, cisailles, seaux (eau, lave, lait).
- Lits (passer la nuit, point d'apparition ; ils explosent dans le Nether et l'End), portes, trappes, échelles, escaliers, dalles, barrières, vitres, lanternes, gâteau.
- Expérience et niveaux, table d'enchantement avec bibliothèques (20 enchantements), livres enchantés applicables dans la grille d'artisanat.
- Alambic et potions (soin, régénération, force, rapidité, résistance au feu, vision nocturne).
- Commerce avec les villageois (fermier, bibliothécaire, prêtre, armurier, forgeron d'outils).

**Créatures** (IA avec recherche de chemin A*)
- Passives : cochon, vache, mouton (tonte, broute l'herbe), poulet (pond des œufs), villageois, golem de fer.
- Hostiles : zombie, squelette (tire à l'arc), creeper (explose), araignée (grimpe aux murs), Enderman (téléportation, n'aime pas qu'on le regarde), slime.
- Nether : piglin zombifié (colère de groupe), Ghast (boules de feu renvoyables), Blaze (rafales de feu), Wither squelette, cube de magma.
- L'**Ender Dragon** : vol circulaire, piqués, boules de feu, souffle, perchage sur la fontaine, soins par les cristaux de l'End, destruction de blocs, mort spectaculaire.

**Dimensions**
- Le **Nether** (portails d'obsidienne de 2×3 à 21×21, correspondance des coordonnées ×8), avec forteresses, générateurs de Blazes, pierre lumineuse, quartz, sable des âmes, lave.
- **L'End** : île principale, 10 piliers d'obsidienne avec cristaux (dont deux en cage), plateforme d'arrivée, portail de sortie, œuf de dragon, îles extérieures.

**Méta**
- Mondes multiples sauvegardés dans le navigateur (IndexedDB) : blocs modifiés, coffres, fours, inventaire, progression, état de l'End.
- Modes survie, créatif (inventaire créatif avec recherche et œufs d'apparition) et spectateur ; 4 difficultés.
- 38 progrès qui guident jusqu'à la fin, guide de survie intégré, épilogue original et générique.
- Commandes : `/help`, `/gamemode`, `/give`, `/tp`, `/time`, `/weather`, `/locate fort|forteresse|village`, `/summon`, `/effect`, `/enchant`, `/xp`, `/difficulty`, `/gamerule`, `/spawnpoint`, `/home`, `/top`, `/seed`…
- Options : distance d'affichage, champ de vision, sensibilité, luminosité, volumes, échelle de l'interface, résolution, particules, feuillage, éclairage lissé, nuages, balancement de la vue…
- Audio 100 % procédural (Web Audio) : bruitages spatialisés des blocs, créatures, explosions, et musique générative au piano.

## Comment finir le jeu

1. Récoltez du bois, fabriquez une table de craft, des outils, un four et des torches.
2. Trouvez du fer, puis des diamants (sous la couche 16) et fabriquez une pioche en diamant.
3. Minez de l'obsidienne (ou versez de l'eau sur de la lave source), construisez un cadre de 4×5 et allumez-le avec un briquet.
4. Dans le Nether, trouvez une forteresse et tuez des Blazes pour obtenir des bâtons de Blaze.
5. Obtenez des perles de l'Ender (Endermen, prêtres des villages, coffres des forts).
6. Fabriquez des yeux de l'Ender (poudre de Blaze + perle) et lancez-les : ils volent vers le fort.
7. Dans la salle du portail, placez un œil dans chaque cadre vide.
8. Dans l'End, détruisez les cristaux (des flèches suffisent), puis frappez le dragon, surtout à la tête quand il se pose.
9. Sautez dans le portail de sortie pour voir la fin.

Astuce : `/locate fort` et `/locate forteresse` donnent les coordonnées des structures.

## Architecture

```
src/
  core/      maths (matrices, frustum), bruit simplex, constantes
  data/      identifiants, blocs, objets, recettes
  world/     chunks, monde, lumière, fluides et comportements des blocs, explosions
  world/gen/ générateurs (Surface, Nether, End), arbres et minerais, structures
  gfx/       textures procédurales, mesher, renderer WebGL2, shaders, ciel, particules, modèles d'entités
  entity/    entités, créatures et IA, projectiles, dragon, apparition, recherche de chemin
  game/      boucle de jeu, entrées, interactions, portails, audio, sauvegarde, progrès, enchantements, commandes
  ui/        interface (HUD, inventaires, menus), icônes, épilogue
tools/       build (fichier unique), tests automatisés dans Chromium
```

Le monde tourne à 20 ticks par seconde comme l'original ; le rendu interpole les positions entre deux ticks. Les chunks (16×128×16) sont découpés en sections de 16³ maillées à la demande avec éclairage lissé.

## Tests

Les tests lancent le jeu dans Chromium sans interface (Playwright) :

- `node tools/logic-test.mjs` rejoue toute la progression (artisanat, four, minage, portails, yeux de l'Ender, dragon, générique, sauvegarde) ;
- `node tools/feature-test.mjs` vérifie les autres mécaniques (lit, portes, TNT, creeper, squelette, zombie, seaux, agriculture, apparitions, enchantement, commerce, alambic, mort) ;
- `node tools/menu-test.mjs` parcourt les menus avec de vrais clics ;
- `node tools/smoke-test.mjs <scénario>` produit des captures (`tour`, `mobs`, `ui`, `nether`, `end`, `stronghold`, `village`, `night`, `items`…).

## Avertissement

Projet de fan non officiel, sans lien avec Mojang ni Microsoft. Aucun élément de Minecraft (textures, sons, code) n'est utilisé : tout est recréé. L'épilogue de fin est un texte original.
