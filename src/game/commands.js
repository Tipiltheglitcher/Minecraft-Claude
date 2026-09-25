// Commandes de chat (/help, /gamemode, /give, /tp, /time, ...)
import { ITEMS } from '../data/items.js';
import { ID } from '../data/ids.js';
import { ENCHANTS } from './enchant.js';
import { strongholdPos } from '../world/gen/structures.js';
import { ENTITY_TYPES } from '../entity/registry.js';
import { SOLID } from '../data/blocks.js';

function findItem(name) {
  name = name.toLowerCase().replace(/^minecraft:/, '');
  if (ID[name] !== undefined) return ID[name];
  for (const d of ITEMS) if (d && d.name && d.name.toLowerCase() === name) return d.id;
  for (const d of ITEMS) if (d && d.key && d.key.includes(name)) return d.id;
  for (const d of ITEMS) if (d && d.name && d.name.toLowerCase().includes(name)) return d.id;
  return null;
}

export const COMMANDS = {
  help: {
    desc: 'Liste des commandes',
    run: (g) => {
      for (const [k, c] of Object.entries(COMMANDS)) g.ui.chat('/' + k + (c.usage ? ' ' + c.usage : '') + ' — ' + c.desc, '#aaa');
    },
  },
  gamemode: {
    usage: '<survie|creatif|spectateur>',
    desc: 'Change le mode de jeu',
    run: (g, [m]) => {
      const map = { 0: 'survival', 1: 'creative', 3: 'spectator', s: 'survival', c: 'creative', survie: 'survival', survival: 'survival', creatif: 'creative', créatif: 'creative', creative: 'creative', spectateur: 'spectator', spectator: 'spectator', sp: 'spectator' };
      const mode = map[(m || '').toLowerCase()];
      if (!mode) return 'Mode inconnu';
      g.setGamemode(mode);
      return 'Mode de jeu : ' + { survival: 'Survie', creative: 'Créatif', spectator: 'Spectateur' }[mode];
    },
  },
  time: {
    usage: 'set <jour|nuit|midi|minuit|n> | add <n>',
    desc: 'Change l\'heure',
    run: (g, [op, v]) => {
      const names = { day: 1000, jour: 1000, noon: 6000, midi: 6000, night: 13000, nuit: 13000, midnight: 18000, minuit: 18000, sunrise: 23000, aube: 23000 };
      if (op === 'set') {
        const t = names[v] ?? parseInt(v, 10);
        if (isNaN(t)) return 'Heure invalide';
        g.time = Math.floor(g.time / 24000) * 24000 + t;
        return 'Heure réglée sur ' + t;
      }
      if (op === 'add') { g.time += parseInt(v, 10) || 0; return 'Heure avancée'; }
      if (op === 'query') return 'Heure : ' + (g.time % 24000) + ' (jour ' + Math.floor(g.time / 24000) + ')';
      return 'Usage : /time set jour';
    },
  },
  weather: {
    usage: '<clair|pluie|orage>',
    desc: 'Change la météo',
    run: (g, [w]) => {
      const map = { clear: 0, clair: 0, soleil: 0, rain: 1, pluie: 1, thunder: 2, orage: 2 };
      const v = map[(w || '').toLowerCase()];
      if (v === undefined) return 'Météo inconnue';
      g.weather.raining = v > 0;
      g.weather.thunder = v === 2;
      g.weather.timer = 12000;
      return 'Météo modifiée';
    },
  },
  give: {
    usage: '<objet> [quantité]',
    desc: 'Donne un objet',
    run: (g, [name, n]) => {
      if (!name) return 'Usage : /give diamond 64';
      const id = findItem(name);
      if (id === null || !ITEMS[id]) return 'Objet inconnu : ' + name;
      const count = Math.max(1, Math.min(6400, parseInt(n, 10) || 1));
      let left = count;
      while (left > 0) {
        const k = Math.min(left, ITEMS[id].stack || 64);
        const r = g.player.inventory.add({ id, count: k });
        if (r > 0) g.world.dropItem(g.player.x, g.player.y + 1, g.player.z, { id, count: r });
        left -= k;
      }
      return 'Donné ' + count + ' × ' + ITEMS[id].name;
    },
  },
  tp: {
    usage: '<x> <y> <z>',
    desc: 'Téléporte le joueur',
    run: (g, args) => {
      const p = g.player;
      const v = args.map((a, i) => (a && a.startsWith('~') ? [p.x, p.y, p.z][i] + (parseFloat(a.slice(1)) || 0) : parseFloat(a)));
      if (v.length < 3 || v.some((x) => isNaN(x))) return 'Usage : /tp x y z';
      p.setPos(v[0], v[1], v[2]);
      p.vx = p.vy = p.vz = 0;
      p.fallDistance = 0;
      return 'Téléporté en ' + v.map((x) => x.toFixed(1)).join(' ');
    },
  },
  kill: { desc: 'Tue le joueur', run: (g) => { g.player.damage(1e6, { type: 'void', bypassArmor: true, noInvuln: true }); } },
  heal: { desc: 'Soigne complètement', run: (g) => { g.player.health = g.player.maxHealth; g.player.food = 20; g.player.saturation = 20; return 'Soigné'; } },
  difficulty: {
    usage: '<paisible|facile|normal|difficile>',
    desc: 'Change la difficulté',
    run: (g, [d]) => {
      const map = { peaceful: 0, paisible: 0, 0: 0, easy: 1, facile: 1, 1: 1, normal: 2, 2: 2, hard: 3, difficile: 3, 3: 3 };
      const v = map[(d || '').toLowerCase()];
      if (v === undefined) return 'Difficulté inconnue';
      g.settings.difficulty = v;
      g.saveSettings();
      return 'Difficulté : ' + ['Paisible', 'Facile', 'Normale', 'Difficile'][v];
    },
  },
  seed: { desc: 'Affiche la graine du monde', run: (g) => 'Graine : ' + g.meta.seed },
  spawnpoint: { desc: 'Définit le point d\'apparition ici', run: (g) => { const p = g.player; p.spawnPoint = { dim: g.world.dim, x: p.x, y: p.y, z: p.z }; return 'Point d\'apparition défini'; } },
  effect: {
    usage: '<effet> [secondes] [niveau]',
    desc: 'Applique un effet (speed, strength, regeneration, night_vision, fire_resistance...)',
    run: (g, [name, s, a]) => {
      if (!name) return 'Usage : /effect night_vision 300';
      if (name === 'clear') { g.player.effects = {}; return 'Effets retirés'; }
      g.player.addEffect(name, (parseInt(s, 10) || 30) * 20, Math.max(0, (parseInt(a, 10) || 1) - 1));
      return 'Effet appliqué : ' + name;
    },
  },
  xp: { usage: '<niveaux>', desc: 'Ajoute des niveaux d\'expérience', run: (g, [n]) => { const k = parseInt(n, 10) || 1; for (let i = 0; i < k; i++) g.player.xpLevel++; g.onXpChange(); return '+' + k + ' niveaux'; } },
  summon: {
    usage: '<créature>',
    desc: 'Fait apparaître une créature',
    run: (g, [type]) => {
      if (!type || !ENTITY_TYPES[type]) return 'Créatures : ' + Object.keys(ENTITY_TYPES).filter((t) => !['item', 'xp_orb', 'player', 'thrown', 'area_cloud'].includes(t)).join(', ');
      const p = g.player;
      const d = [-Math.sin(p.yaw) * 3, -Math.cos(p.yaw) * 3];
      g.world.spawn(type, p.x + d[0], p.y + (type === 'ender_dragon' ? 10 : 0), p.z + d[1], {});
      return 'Invoqué : ' + type;
    },
  },
  locate: {
    usage: '<fort|forteresse|village>',
    desc: 'Localise une structure',
    run: (g, [s]) => {
      const p = g.player;
      s = (s || '').toLowerCase();
      if (s.startsWith('fort') && !s.startsWith('forte') || s === 'stronghold') {
        const sh = strongholdPos(g.meta.seed);
        return 'Fort le plus proche : X=' + sh.x + ' Z=' + sh.z + ' (à ' + Math.round(Math.hypot(sh.x - p.x, sh.z - p.z)) + ' blocs)';
      }
      if (s.startsWith('forte') || s === 'fortress') {
        const gen = g.worlds.nether ? g.worlds.nether.gen : null;
        if (!gen) return 'Allez d\'abord dans le Nether';
        const cx = g.world.dim === 'nether' ? p.x : p.x / 8, cz = g.world.dim === 'nether' ? p.z : p.z / 8;
        const list = gen.fortressesNear(cx - 400, cz - 400, cx + 400, cz + 400);
        let best = null, bd = Infinity;
        for (const f of list) { const x = (f.minX + f.maxX) / 2, z = (f.minZ + f.maxZ) / 2; const d = Math.hypot(x - cx, z - cz); if (d < bd) { bd = d; best = [x, z]; } }
        return best ? 'Forteresse (Nether) : X=' + Math.round(best[0]) + ' Z=' + Math.round(best[1]) : 'Aucune forteresse trouvée';
      }
      if (s.startsWith('vill')) {
        const gen = g.worlds.overworld.gen;
        const list = gen.villagesNear(p.x - 1200, p.z - 1200, p.x + 1200, p.z + 1200);
        let best = null, bd = Infinity;
        for (const v of list) { const d = Math.hypot(v.center.x - p.x, v.center.z - p.z); if (d < bd) { bd = d; best = v.center; } }
        return best ? 'Village : X=' + best.x + ' Z=' + best.z + ' (à ' + Math.round(bd) + ' blocs)' : 'Aucun village proche';
      }
      return 'Usage : /locate fort | forteresse | village';
    },
  },
  enchant: {
    usage: '<enchantement> [niveau]',
    desc: 'Enchante l\'objet tenu',
    run: (g, [name, lvl]) => {
      const s = g.player.inventory.selected();
      if (!s) return 'Tenez un objet';
      if (!ENCHANTS[name]) return 'Enchantements : ' + Object.keys(ENCHANTS).join(', ');
      s.ench = Object.assign({}, s.ench, { [name]: Math.max(1, Math.min(10, parseInt(lvl, 10) || 1)) });
      g.player.inventory.changed();
      return 'Enchanté';
    },
  },
  clear: { desc: 'Vide l\'inventaire', run: (g) => { g.player.inventory.clear(); return 'Inventaire vidé'; } },
  gamerule: {
    usage: '<keepInventory|doDaylightCycle|doMobSpawning|mobGriefing|fireSpread> <true|false>',
    desc: 'Règles du jeu',
    run: (g, [r, v]) => {
      const rules = ['keepInventory', 'doDaylightCycle', 'doMobSpawning', 'mobGriefing', 'fireSpread', 'naturalRegen'];
      if (!rules.includes(r)) return 'Règles : ' + rules.join(', ');
      if (v === undefined) return r + ' = ' + g.settings[r];
      g.settings[r] = v === 'true' || v === '1' || v === 'vrai';
      g.saveSettings();
      return r + ' = ' + g.settings[r];
    },
  },
  home: { desc: 'Retourne au point d\'apparition', run: (g) => { g.respawnTeleport(); return 'Retour au point d\'apparition'; } },
  dimension: {
    usage: '<surface|nether|end>',
    desc: 'Change de dimension (triche)',
    run: (g, [d]) => {
      const map = { surface: 'overworld', overworld: 'overworld', nether: 'nether', end: 'end' };
      const dim = map[(d || '').toLowerCase()];
      if (!dim) return 'Dimensions : surface, nether, end';
      g.travelTo(dim);
      return 'Voyage vers ' + dim;
    },
  },
  top: {
    desc: 'Remonte à la surface',
    run: (g) => {
      const p = g.player, w = g.world;
      const x = Math.floor(p.x), z = Math.floor(p.z);
      for (let y = 126; y > 0; y--) if (SOLID[w.getBlock(x, y, z)]) { p.setPos(x + 0.5, y + 1, z + 0.5); return 'En surface'; }
      return 'Impossible';
    },
  },
};

export function runCommand(game, text) {
  const parts = text.trim().replace(/^\//, '').split(/\s+/);
  const name = parts.shift().toLowerCase();
  const aliases = { gm: 'gamemode', t: 'time', tp: 'tp', teleport: 'tp', aide: 'help', donner: 'give', meteo: 'weather', météo: 'weather' };
  const cmd = COMMANDS[aliases[name] || name];
  if (!cmd) return 'Commande inconnue. Tapez /help';
  const cheat = !['help', 'seed', 'spawnpoint'].includes(aliases[name] || name);
  if (cheat && !game.meta.cheats) {
    game.meta.cheats = true;
  }
  try {
    return cmd.run(game, parts);
  } catch (e) {
    console.error(e);
    return 'Erreur : ' + e.message;
  }
}
