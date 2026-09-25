// Contrôleur principal du jeu
import '../entity/player.js';
import '../entity/mobs.js';
import '../entity/misc.js';
import '../entity/projectiles.js';
import '../entity/dragon.js';
import { Player } from '../entity/player.js';
import { World } from '../world/world.js';
import { ST_LIT } from '../world/chunk.js';
import { Renderer } from '../gfx/renderer.js';
import { Sky } from '../gfx/sky.js';
import { Particles } from '../gfx/particles.js';
import { Audio } from './audio.js';
import { Input } from './input.js';
import { Interaction } from './interaction.js';
import { Spawner } from '../entity/spawning.js';
import { SaveStore } from './save.js';
import { UI } from '../ui/ui.js';
import { findPortal, buildPortal, buildEndPlatform } from './portal.js';
import { ADV_BY_ID, ITEM_ADV } from './advancements.js';
import { rollLoot, setLootEnchantHook, endPillars, exitPortalCells } from '../world/gen/structures.js';
import { randomBook } from './enchant.js';
import { hashString } from '../core/noise.js';
import { B, I } from '../data/ids.js';
import { ITEMS } from '../data/items.js';
import { SOLID, BLOCKS } from '../data/blocks.js';
import { clamp, lookDir } from '../core/math.js';
import { spawnEntity } from '../entity/registry.js';

const DEFAULT_SETTINGS = {
  renderDistance: 7, fov: 70, sensitivity: 1, brightness: 0.35, volume: 0.8, musicVolume: 0.5, sfxVolume: 1, guiScale: 2, resolution: 1,
  difficulty: 2, particles: 2, fancyLeaves: true, smoothLighting: true, clouds: true, viewBobbing: true, invertY: false,
  keepInventory: false, doDaylightCycle: true, doMobSpawning: true, mobGriefing: true, fireSpread: true, naturalRegen: true, mobLoot: true,
};

export const MOB_NAMES = {
  zombie: 'Zombie', skeleton: 'Squelette', creeper: 'Creeper', spider: 'Araignée', enderman: 'Enderman', blaze: 'Blaze', ghast: 'Ghast',
  piglin: 'Piglin zombifié', wither_skeleton: 'Wither squelette', magma_cube: 'Cube de magma', slime: 'Slime', ender_dragon: 'Ender Dragon',
  iron_golem: 'Golem de fer', pig: 'Cochon', cow: 'Vache', sheep: 'Mouton', chicken: 'Poulet', villager: 'Villageois', player: 'Joueur',
  fireball: 'Boule de feu', small_fireball: 'Boule de feu', tnt: 'TNT', end_crystal: 'Cristal de l\'End', area_cloud: 'Souffle de dragon',
};

export class Game {
  constructor(canvas, uiRoot) {
    this.canvas = canvas;
    this.settings = this.loadSettings();
    this.saves = new SaveStore();
    this.audio = new Audio(this);
    this.input = new Input(this, canvas);
    this.renderer = new Renderer(canvas, this);
    this.sky = new Sky(this);
    this.particles = new Particles(this);
    this.interaction = new Interaction(this);
    this.spawner = new Spawner(this);
    this.ui = new UI(this, uiRoot);
    this.state = 'menu';
    this.paused = false;
    this.time = 0;
    this.weather = { raining: false, thunder: false, strength: 0, timer: 12000 };
    this.cameraMode = 0;
    this.hideHud = false;
    this.showDebug = false;
    this.enderChest = new Array(27).fill(null);
    this.worlds = {};
    this.world = null;
    this.player = null;
    this.target = null;
    this.targetEntity = null;
    this.breakProgress = 0;
    this.portalEffect = 0;
    this.fps = 0;
    this._frames = 0;
    this._fpsT = performance.now();
    this.acc = 0;
    this.last = performance.now();
    setLootEnchantHook(randomBook);
    this.applySettings();
    this.ui.openTitle();
    requestAnimationFrame((t) => this.loop(t));
    window.addEventListener('beforeunload', () => { if (this.state === 'playing') this.saveWorld(); });
    document.addEventListener('visibilitychange', () => { if (document.hidden && this.state === 'playing') this.saveWorld(); });
  }

  // ---------- réglages ----------
  loadSettings() {
    let s = {};
    try { s = JSON.parse(localStorage.getItem('mcjs-settings') || '{}'); } catch (e) { s = {}; }
    return Object.assign({}, DEFAULT_SETTINGS, s);
  }

  saveSettings() {
    try { localStorage.setItem('mcjs-settings', JSON.stringify(this.settings)); } catch (e) { /* ignoré */ }
  }

  applySettings() {
    document.documentElement.style.setProperty('--gs', this.settings.guiScale);
    this.audio.applyVolumes();
    for (const w of Object.values(this.worlds)) for (const c of w.chunks.values()) c.markAllDirty();
    this.saveSettings();
  }

  skyDarken() {
    if (!this.world || this.world.dim !== 'overworld') return 0;
    return this.sky.skyDarken(this.time, this.weather.strength);
  }

  get spectator() {
    return this.player && this.player.gamemode === 'spectator';
  }

  setGamemode(mode) {
    const p = this.player;
    p.gamemode = mode;
    p.creative = mode !== 'survival';
    p.noClip = mode === 'spectator';
    p.invisible = mode === 'spectator';
    if (mode === 'spectator') p.flying = true;
    if (mode === 'survival') { p.flying = false; p.noClip = false; }
    this.meta.gamemode = mode;
    this.ui.hudCache = {};
  }

  // ---------- mondes ----------
  getWorld(dim) {
    if (!this.worlds[dim]) {
      const w = new World(this, dim, this.meta.seed, this.savedMaps ? this.savedMaps[dim] : null);
      this.worlds[dim] = w;
      w.dirtyKeys = new Set();
      if (dim === 'end') this.initEnd(w);
    }
    return this.worlds[dim];
  }

  async newWorld(opts) {
    let seed;
    if (opts.seed) seed = /^-?\d+$/.test(opts.seed) ? parseInt(opts.seed, 10) | 0 : hashString(opts.seed) | 0;
    else seed = (Math.random() * 4294967296) | 0;
    const meta = {
      id: 'w' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      name: opts.name, seed, gamemode: opts.gamemode, created: Date.now(), lastPlayed: Date.now(), time: 1000,
      player: null, advancements: {}, dragonKilled: false, completed: false, bonus: opts.bonus, dims: {},
    };
    await this.saves.putWorld(meta);
    this.start(meta, { overworld: new Map(), nether: new Map(), end: new Map() });
  }

  async loadWorld(id) {
    this.ui.loading('Chargement du monde...', 0);
    const meta = await this.saves.getWorld(id);
    if (!meta) { this.ui.openWorlds(); return; }
    const maps = {};
    for (const d of ['overworld', 'nether', 'end']) maps[d] = await this.saves.loadChunks(id, d);
    this.start(meta, maps);
  }

  start(meta, maps) {
    this.meta = meta;
    this.savedMaps = maps;
    this.worlds = {};
    this.time = meta.time || 1000;
    this.weather = Object.assign({ raining: false, thunder: false, strength: 0, timer: 12000 }, meta.weather || {});
    this.enderChest = meta.enderChest || new Array(27).fill(null);
    this.particles.clear();
    const pd = meta.player;
    const dim = pd ? pd.dim || 'overworld' : 'overworld';
    const world = this.getWorld(dim);
    this.world = world;
    const p = new Player(world, {});
    this.player = p;
    if (pd) this.loadPlayer(p, pd);
    else {
      const sp = world.gen.findSpawn();
      meta.spawn = { x: sp.x, y: sp.y, z: sp.z };
      p.setPos(sp.x, sp.y, sp.z);
      this.freshSpawn = true;
    }
    this.setGamemode(meta.gamemode || 'survival');
    if (pd && pd.flying) p.flying = true;
    world.addEntity(p);
    p.inventory.onChange = () => {};
    this.state = 'loading';
    this.loadProgress = 0;
    this.ui.setHudVisible(false);
    this.ui.loading('Génération du terrain...', 0);
  }

  loadPlayer(p, d) {
    p.setPos(d.x, d.y, d.z);
    p.yaw = d.yaw || 0; p.pitch = d.pitch || 0;
    p.health = d.health ?? 20; p.food = d.food ?? 20; p.saturation = d.saturation ?? 5; p.exhaustion = d.exhaustion || 0;
    p.xpLevel = d.xpLevel || 0; p.xp = d.xp || 0; p.xpTotal = d.xpTotal || 0;
    p.inventory.load(d.inventory);
    p.spawnPoint = d.spawnPoint || null;
    p.stats = Object.assign(p.stats, d.stats || {});
    p.effects = d.effects || {};
    p.air = d.air ?? 300;
    p.fireTicks = d.fireTicks || 0;
    p.enchantSeed = d.enchantSeed;
  }

  savePlayer() {
    const p = this.player;
    return {
      dim: this.world.dim, x: p.x, y: p.y, z: p.z, yaw: p.yaw, pitch: p.pitch, health: p.health, food: p.food, saturation: p.saturation,
      exhaustion: p.exhaustion, xpLevel: p.xpLevel, xp: p.xp, xpTotal: p.xpTotal, inventory: p.inventory.serialize(), spawnPoint: p.spawnPoint,
      stats: p.stats, effects: p.effects, air: p.air, fireTicks: p.fireTicks, flying: p.flying, enchantSeed: p.enchantSeed,
    };
  }

  // Étape de chargement (appelée à chaque frame)
  loadingStep() {
    const w = this.world, p = this.player;
    const R = Math.min(3, this.settings.renderDistance);
    w.updateChunks(p.x, p.z, R, 40);
    this.renderer.cam.x = p.x; this.renderer.cam.z = p.z;
    this.renderer.updateMeshes(w, 20);
    const pcx = Math.floor(p.x) >> 4, pcz = Math.floor(p.z) >> 4;
    let ready = 0, total = 0;
    for (let dx = -R; dx <= R; dx++)
      for (let dz = -R; dz <= R; dz++) {
        total++;
        const c = w.getChunk(pcx + dx, pcz + dz);
        if (c && c.state >= ST_LIT) ready++;
      }
    this.ui.loading('Génération du terrain... ' + ready + ' / ' + total, ready / total);
    if (ready >= total) this.finishLoading();
  }

  finishLoading() {
    const p = this.player, w = this.world;
    if (this.freshSpawn) {
      this.freshSpawn = false;
      let x = Math.floor(p.x), z = Math.floor(p.z), y = 70;
      // cherche une colonne dégagée (pas sur un arbre ni dans l'eau)
      let found = false;
      for (let r = 0; r < 24 && !found; r++)
        for (let dx = -r; dx <= r && !found; dx++)
          for (let dz = -r; dz <= r && !found; dz++) {
            if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
            const cx = x + dx, cz = z + dz;
            const c = w.getChunk(cx >> 4, cz >> 4);
            if (!c || c.state < ST_LIT) continue;
            const ty = c.topY(cx & 15, cz & 15);
            const top = c.get(cx & 15, ty, cz & 15);
            if (top === B.grass_block || top === B.sand || top === B.snow || top === B.dirt || top === B.short_grass || top === B.stone) {
              x = cx; z = cz; y = ty; found = true;
            }
          }
      if (!found) { const c = w.getChunk(x >> 4, z >> 4); y = c.topY(x & 15, z & 15); }
      p.setPos(x + 0.5, y + 1, z + 0.5);
      this.meta.spawn = { x: x + 0.5, y: y + 1, z: z + 0.5 };
      if (this.meta.bonus && this.meta.gamemode === 'survival') this.bonusChest(x, y + 1, z);
      this.ui.chat('Bienvenue dans Minecraft JS ! Appuyez sur Échap puis « Guide de survie » pour savoir comment finir le jeu.', '#ffff55');
      this.ui.chat('Objectif final : vaincre l\'Ender Dragon dans l\'End.', '#ffff55');
    }
    // sortir d'un bloc si besoin
    for (let k = 0; k < 64 && (SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z))] || SOLID[w.getBlock(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z))]); k++) p.y += 1;
    p.prevY = p.y;
    this.state = 'playing';
    this.paused = false;
    this.ui.closeMenu(false);
    this.ui.setHudVisible(true);
    this.grant('root');
    this.saveWorld();
    this.input.requestLock();
  }

  bonusChest(x, y, z) {
    const w = this.world;
    for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2], [2, 2]]) {
      const cx = x + dx, cz = z + dz;
      const c = w.getChunk(cx >> 4, cz >> 4);
      if (!c) continue;
      const cy = c.topY(cx & 15, cz & 15) + 1;
      if (w.getBlock(cx, cy - 1, cz) === B.water || cy > 120) continue;
      w.setBlock(cx, cy, cz, B.chest, 0);
      const items = rollLoot('bonus', (this.meta.seed ^ 0xb0) >>> 0);
      items[13] = { id: B.torch, count: 8 };
      w.setBlockEntity(cx, cy, cz, { type: 'chest', items });
      for (const [tx, tz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.getBlock(cx + tx, cy, cz + tz) === 0 && SOLID[w.getBlock(cx + tx, cy - 1, cz + tz)]) w.setBlock(cx + tx, cy, cz + tz, B.torch, 0);
      return;
    }
  }

  // ---------- sauvegarde ----------
  async saveWorld() {
    if (!this.meta || !this.player) return;
    const m = this.meta;
    m.time = this.time;
    m.lastPlayed = Date.now();
    m.player = this.savePlayer();
    m.weather = { raining: this.weather.raining, thunder: this.weather.thunder, strength: this.weather.strength, timer: this.weather.timer };
    m.enderChest = this.enderChest;
    const end = this.worlds.end;
    if (end) {
      m.dims.end = {
        crystals: end.entities.filter((e) => e.type === 'end_crystal' && !e.removed).map((e) => [e.x, e.y, e.z]),
        dragon: (() => { const d = end.entities.find((e) => e.type === 'ender_dragon' && !e.removed); return d ? { x: d.x, y: d.y, z: d.z, health: d.health } : null; })(),
        initialized: true,
      };
    }
    try {
      await this.saves.putWorld(JSON.parse(JSON.stringify(m)));
      for (const w of Object.values(this.worlds)) {
        w.flushSaved();
        for (const c of w.chunks.values()) if (c.modified) w.dirtyKeys.add((c.cx + 32768) * 65536 + (c.cz + 32768));
        if (!w.dirtyKeys.size) continue;
        const entries = [];
        for (const k of w.dirtyKeys) { const v = w.saved.get(k); if (v) entries.push([k, v]); }
        w.dirtyKeys.clear();
        await this.saves.saveChunks(m.id, w.dim, entries);
      }
    } catch (e) {
      console.warn('Sauvegarde échouée', e);
    }
  }

  async quitToTitle() {
    this.ui.loading('Sauvegarde...', 0.5);
    await this.saveWorld();
    for (const w of Object.values(this.worlds)) this.renderer.disposeAll(w);
    this.worlds = {};
    this.world = null;
    this.player = null;
    this.state = 'menu';
    this.paused = false;
    this.input.releaseLock();
    this.particles.clear();
    this.ui.openTitle();
  }

  // ---------- boucle ----------
  loop(t) {
    requestAnimationFrame((tt) => this.loop(tt));
    const dt = Math.min(0.25, (t - this.last) / 1000);
    this.last = t;
    this._frames++;
    if (t - this._fpsT >= 1000) { this.fps = this._frames; this._frames = 0; this._fpsT = t; }
    try {
      if (this.state === 'loading') {
        this.loadingStep();
      } else if (this.state === 'playing' || this.state === 'credits') {
        const p = this.player;
        if (!this.paused && this.state === 'playing') {
          this.frameInput();
          this.acc += dt;
          let n = 0;
          while (this.acc >= 0.05 && n < 5) { this.tick(); this.acc -= 0.05; n++; }
          if (n === 5) this.acc = 0;
        }
        this.world.updateChunks(p.x, p.z, this.settings.renderDistance, 4);
        const pt = this.paused ? 1 : Math.min(1, this.acc / 0.05);
        this.renderer.render(pt, dt);
        this.audio.setListener(p.x, p.y + p.eyeHeight(), p.z, p.yaw);
        this.ui.updateHud(dt);
      } else {
        const gl = this.renderer.gl;
        gl.clearColor(0.05, 0.05, 0.08, 1);
        gl.clear(gl.COLOR_BUFFER_BIT);
      }
    } catch (e) {
      console.error(e);
      if (!this._errShown) { this._errShown = true; this.ui.chat('Erreur : ' + e.message, '#f55'); }
    }
    this.input.endFrame();
  }

  frameInput() {
    const inp = this.input, p = this.player, s = this.settings;
    if (this.ui.screenOpen()) return;
    const sens = 0.0022 * s.sensitivity;
    if (!p.dead && !p.sleeping) {
      p.yaw -= inp.mouse.dx * sens;
      p.pitch -= inp.mouse.dy * sens * (s.invertY ? -1 : 1);
      p.pitch = clamp(p.pitch, -Math.PI / 2 * 0.995, Math.PI / 2 * 0.995);
    }
    if (inp.mouse.wheel) {
      p.inventory.sel = (p.inventory.sel + inp.mouse.wheel + 9) % 9;
      p.inventory.changed();
    }
    for (let i = 1; i <= 9; i++) if (inp.wasPressed('Digit' + i)) { p.inventory.sel = i - 1; p.inventory.changed(); }
  }

  tick() {
    const p = this.player, w = this.world, inp = this.input;
    // entrées -> joueur
    if (!this.ui.screenOpen() && !p.dead) {
      const d = (c) => inp.down(c);
      let fwd = (d('KeyW') || d('ArrowUp') ? 1 : 0) - (d('KeyS') || d('ArrowDown') ? 1 : 0);
      let str = (d('KeyD') || d('ArrowRight') ? 1 : 0) - (d('KeyA') || d('ArrowLeft') ? 1 : 0);
      if (inp.touch.moveId !== null) { fwd = clamp(-inp.touch.my, -1, 1); str = clamp(inp.touch.mx, -1, 1); }
      if (inp.tickPressed.has('double_KeyW')) this.sprintToggle = true;
      if (fwd <= 0) this.sprintToggle = false;
      if (inp.tickPressed.has('double_Space') && p.creative) { p.flying = !p.flying; if (p.gamemode === 'spectator') p.flying = true; }
      p.input = { forward: fwd, strafe: str, jump: d('Space'), sneak: d('ShiftLeft') || d('ShiftRight'), sprint: d('ControlLeft') || d('ControlRight') || this.sprintToggle };
      if (inp.tickPressed.has('KeyQ') && !p.dead) this.interaction.dropSelected(d('ControlLeft') || d('ControlRight'));
    } else p.input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    if (p.gamemode === 'spectator') { p.noClip = true; p.flying = true; }
    if (!this.ui.screen && !this.ui.menu && !this.spectator) this.interaction.tick(inp);
    else if (this.spectator) this.target = null;
    inp.endTick();

    if (!w.isChunkReady(Math.floor(p.x), Math.floor(p.z))) p.frozen = true; else p.frozen = false;
    w.tick(p);
    // temps et météo
    if (this.settings.doDaylightCycle) this.time++;
    this.tickWeather();
    this.particles.tick();
    this.spawner.tick();
    this.tickPortals();
    this.tickSleep();
    this.audio.tickMusic();
    this.tickAmbient();
    if (w.tickCount % 20 === 0) this.checkAdvancements();
    if (w.tickCount % 1200 === 0) this.saveWorld();
    if (this.state === 'playing' && w.dim === 'end' && p.y < -30 && !p.dead) p.damage(1000, { type: 'void', bypassArmor: true, noInvuln: true });
  }

  tickWeather() {
    const wt = this.weather;
    if (--wt.timer <= 0) {
      wt.raining = !wt.raining;
      wt.thunder = wt.raining && Math.random() < 0.25;
      wt.timer = wt.raining ? 6000 + Math.floor(Math.random() * 12000) : 12000 + Math.floor(Math.random() * 60000);
    }
    const target = wt.raining && this.world.dim === 'overworld' ? 1 : 0;
    wt.strength += clamp(target - wt.strength, -0.01, 0.01);
    if (wt.thunder && this.world.dim === 'overworld' && Math.random() < 1 / 600) {
      const p = this.player;
      this.audio.play('thunder', p.x + (Math.random() - 0.5) * 60, p.y + 20, p.z + (Math.random() - 0.5) * 60, 1.5);
    }
    if (wt.strength > 0.2 && this.world.dim === 'overworld' && Math.random() < wt.strength * 0.3) {
      const p = this.player;
      const x = p.x + (Math.random() - 0.5) * 16, z = p.z + (Math.random() - 0.5) * 16;
      const c = this.world.getChunk(Math.floor(x) >> 4, Math.floor(z) >> 4);
      if (c) {
        const y = c.topY(Math.floor(x) & 15, Math.floor(z) & 15);
        if (Math.abs(y - p.y) < 20) this.particles.spawn(this.world, 'splash', x, y + 1.05, z, (Math.random() - 0.5) * 0.05, 0.08, (Math.random() - 0.5) * 0.05);
      }
    }
  }

  tickAmbient() {
    const p = this.player, w = this.world;
    if (Math.random() < 0.002 && w.dim === 'overworld' && w.getSky(Math.floor(p.x), Math.floor(p.y + 1), Math.floor(p.z)) < 3 && p.y < 50) {
      this.audio.play('ghast', p.x + (Math.random() - 0.5) * 20, p.y - 5, p.z + (Math.random() - 0.5) * 20, 0.25, 0.4);
    }
    if (w.dim === 'nether' && Math.random() < 0.003) this.audio.play('blaze', p.x + (Math.random() - 0.5) * 20, p.y, p.z + (Math.random() - 0.5) * 20, 0.3, 0.5);
    // bruits de feu et de portail proches
    if (w.tickCount % 40 === 0) {
      const f = w.blockInBox(p.x - 4, p.y - 2, p.z - 4, p.x + 4, p.y + 3, p.z + 4, (id) => id === B.fire || id === B.lava || id === B.nether_portal);
      if (f) this.audio.play(f.id === B.nether_portal ? 'portal' : 'fire', f.x + 0.5, f.y + 0.5, f.z + 0.5, 0.4);
    }
  }

  // ---------- portails ----------
  tickPortals() {
    const p = this.player, w = this.world;
    if (p.dead) return;
    const bb = p.bbox();
    const inNether = w.blockInBox(bb[0] + 0.1, bb[1] + 0.1, bb[2] + 0.1, bb[3] - 0.1, bb[4] - 0.2, bb[5] - 0.1, (id) => id === B.nether_portal);
    const inEnd = w.blockInBox(bb[0] + 0.1, bb[1], bb[2] + 0.1, bb[3] - 0.1, bb[1] + 0.5, bb[5] - 0.1, (id) => id === B.end_portal);
    if (inEnd && p.portalCooldown <= 0) {
      p.portalCooldown = 100;
      if (w.dim === 'overworld') this.travelTo('end');
      else if (w.dim === 'end') this.leaveEnd();
      return;
    }
    if (inNether && p.portalCooldown <= 0) {
      p.portalTime++;
      this.portalEffect = Math.min(1, p.portalTime / 80) * 0.7;
      if (p.portalTime === 1) this.audio.play('portal_travel', p.x, p.y, p.z, 0.6);
      if (p.portalTime >= 80 || (p.creative && p.portalTime >= 5)) {
        p.portalCooldown = 300;
        p.portalTime = 0;
        this.travelNether();
      }
    } else if (inNether) {
      // vient d'arriver : il faut sortir du portail avant de pouvoir repartir
      p.portalCooldown = Math.max(p.portalCooldown, 20);
      p.portalTime = 0;
      this.portalEffect = Math.max(0, this.portalEffect - 0.05);
    } else {
      p.portalTime = 0;
      this.portalEffect = Math.max(0, this.portalEffect - 0.05);
    }
  }

  ensureAround(world, x, z, r) {
    const cx = Math.floor(x) >> 4, cz = Math.floor(z) >> 4;
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) world.loadOrGenerate(cx + dx, cz + dz);
  }

  travelNether() {
    const from = this.world;
    const to = from.dim === 'nether' ? 'overworld' : 'nether';
    const p = this.player;
    const scale = to === 'nether' ? 1 / 8 : 8;
    const tx = Math.floor(p.x * scale), tz = Math.floor(p.z * scale);
    const dest = this.getWorld(to);
    this.ensureAround(dest, tx, tz, 2);
    let portal = findPortal(dest, tx, tz, 32);
    if (!portal) {
      let ty;
      if (to === 'nether') ty = clamp(Math.floor(p.y), 34, 100);
      else {
        const c = dest.getChunk(tx >> 4, tz >> 4);
        ty = Math.max(64, c ? c.topY(tx & 15, tz & 15) + 1 : 70);
      }
      portal = buildPortal(dest, tx, ty, tz, to === 'nether' ? 33 : 8, to === 'nether' ? 110 : 120);
    }
    const ox = portal.axis === 1 ? 0.5 : 1, oz = portal.axis === 1 ? 1 : 0.5;
    this.switchWorld(dest, portal.x + ox, portal.y, portal.z + oz);
    if (to === 'nether') this.grant('nether');
  }

  travelTo(dim) {
    const p = this.player;
    const dest = this.getWorld(dim);
    if (dim === 'end') {
      this.ensureAround(dest, 100, 0, 2);
      const pos = buildEndPlatform(dest);
      this.switchWorld(dest, pos.x, pos.y, pos.z);
      p.yaw = Math.PI / 2;
      this.grant('end');
      this.ui.chat('Vous êtes dans l\'End. Détruisez les cristaux et vainquez le dragon !', '#d0a0ff');
    } else if (dim === 'nether') {
      const tx = Math.floor(p.x / 8), tz = Math.floor(p.z / 8);
      this.ensureAround(dest, tx, tz, 2);
      const portal = findPortal(dest, tx, tz, 32) || buildPortal(dest, tx, 64, tz, 33, 110);
      this.switchWorld(dest, portal.x + 1, portal.y, portal.z + 0.5);
    } else {
      const sp = this.spawnLocation();
      this.ensureAround(dest, sp.x, sp.z, 1);
      this.switchWorld(dest, sp.x, sp.y, sp.z);
    }
  }

  leaveEnd() {
    const firstTime = !this.meta.completed;
    const go = () => {
      const sp = this.spawnLocation();
      const dest = this.getWorld('overworld');
      this.ensureAround(dest, sp.x, sp.z, 1);
      this.switchWorld(dest, sp.x, sp.y, sp.z);
      this.state = 'playing';
      this.paused = false;
      this.ui.setHudVisible(true);
      this.input.requestLock();
    };
    if (firstTime && this.meta.dragonKilled) {
      this.meta.completed = true;
      this.grant('credits');
      this.state = 'credits';
      this.input.releaseLock();
      this.ui.openCredits(true, go);
      this.saveWorld();
    } else go();
  }

  switchWorld(dest, x, y, z) {
    const p = this.player;
    const old = this.world;
    if (old !== dest) {
      const i = old.entities.indexOf(p);
      if (i >= 0) old.entities.splice(i, 1);
      old.entityById.delete(p.id);
      // décharger l'ancienne dimension
      for (const c of [...old.chunks.values()]) { old.unloadChunk(c); old.dirtyKeys.add((c.cx + 32768) * 65536 + (c.cz + 32768)); }
      for (const e of old.entities) if (!e.persistent) e.removed = true;
      old.entities = old.entities.filter((e) => e.persistent && !e.removed);
      this.renderer.disposeAll(old);
      this.world = dest;
      dest.addEntity(p);
      this.particles.clear();
    }
    p.setPos(x, y, z);
    p.vx = p.vy = p.vz = 0;
    p.fallDistance = 0;
    p.portalTime = 0;
    p.portalCooldown = Math.max(p.portalCooldown, 100);
    this.portalEffect = 0;
    this.audio.play('portal_travel', null, null, null, 0.5);
    this.saveWorld();
  }

  // ---------- End ----------
  initEnd(w) {
    w.data.fountainY = w.gen.fountainY;
    const saved = this.meta.dims && this.meta.dims.end;
    if (saved && saved.initialized) {
      for (const [x, y, z] of saved.crystals || []) w.spawn('end_crystal', x, y, z);
      if (saved.dragon && !this.meta.dragonKilled) {
        const d = w.spawn('ender_dragon', saved.dragon.x, saved.dragon.y, saved.dragon.z, {});
        if (d) d.health = saved.dragon.health;
      }
    } else if (!this.meta.dragonKilled) {
      for (const pl of endPillars(this.meta.seed)) w.spawn('end_crystal', pl.x + 0.5, pl.h + 2, pl.z + 0.5);
      w.spawn('ender_dragon', 0, w.data.fountainY + 40, 0, { firstKill: true });
    }
    if (this.meta.dragonKilled) w.data.exitOpen = true;
  }

  activateExitPortal(w) {
    const fy = w.data.fountainY;
    this.ensureAround(w, 0, 0, 1);
    for (const [dx, dz] of exitPortalCells()) w.setBlock(dx, fy + 1, dz, B.end_portal, 0);
    w.data.exitOpen = true;
  }

  onDragonKilled(d) {
    const w = d.world;
    this.meta.dragonKilled = true;
    this.activateExitPortal(w);
    const fy = w.data.fountainY;
    if (!this.meta.eggPlaced) {
      w.setBlock(0, fy + 5, 0, B.dragon_egg, 0);
      this.meta.eggPlaced = true;
    }
    this.grant('dragon');
    this.ui.chat('L\'Ender Dragon a été vaincu ! Le portail de sortie est ouvert au centre de l\'île.', '#ff55ff');
    this.audio.play('end_portal', 0, fy, 0, 2);
    this.saveWorld();
  }

  onCrystalDestroyed(c, src) {
    for (const e of c.world.entities) if (e.type === 'ender_dragon' && !e.removed) e.onCrystalDestroyed(c, src);
    const att = src && src.entity;
    if (att && (att.isPlayer || (att.owner && att.owner.isPlayer))) this.grant('crystal');
    const left = c.world.countEntities((e) => e.type === 'end_crystal' && !e.removed && e !== c);
    this.ui.action(left > 0 ? 'Cristaux restants : ' + left : 'Tous les cristaux sont détruits !');
  }

  // ---------- mort ----------
  deathMessage(src) {
    const who = src && src.entity ? MOB_NAMES[src.entity.type] || src.entity.type : null;
    const killer = src && src.entity && src.entity.owner ? MOB_NAMES[src.entity.owner.type] || who : who;
    switch (src && src.type) {
      case 'fall': return 'Joueur a heurté le sol trop violemment';
      case 'lava': return 'Joueur a essayé de nager dans la lave';
      case 'fire': return 'Joueur a péri dans les flammes';
      case 'drown': return 'Joueur s\'est noyé';
      case 'suffocate': return 'Joueur a suffoqué dans un mur';
      case 'void': return 'Joueur est tombé hors du monde';
      case 'starve': return 'Joueur est mort de faim';
      case 'cactus': return 'Joueur s\'est piqué à mort';
      case 'explosion': return who ? 'Joueur a été soufflé par ' + who : 'Joueur a explosé';
      case 'projectile': return 'Joueur a été abattu par ' + (killer || 'un projectile');
      case 'magic': return who ? 'Joueur a été tué par ' + who : 'Joueur a été tué par magie';
      default: return who ? 'Joueur a été tué par ' + who : 'Joueur est mort';
    }
  }

  onPlayerDeath(src) {
    const p = this.player, w = this.world;
    if (!this.settings.keepInventory) {
      const inv = p.inventory;
      for (const list of [inv.slots, inv.armor]) for (let i = 0; i < list.length; i++) {
        if (list[i]) {
          const e = w.dropItem(p.x, p.y + 1, p.z, list[i], [(Math.random() - 0.5) * 0.5, 0.3, (Math.random() - 0.5) * 0.5]);
          if (e) e.pickupDelay = 40;
          list[i] = null;
        }
      }
      const xp = Math.min(100, p.xpLevel * 7);
      if (xp > 0) w.dropXp(p.x, p.y + 0.5, p.z, xp);
      p.xpLevel = 0; p.xp = 0;
    }
    const msg = this.deathMessage(src);
    this.ui.chat(msg, '#ff8888');
    this.input.releaseLock();
    setTimeout(() => { if (this.player && this.player.dead) this.ui.openDeath(msg); }, 1000);
  }

  spawnLocation() {
    const p = this.player;
    const ow = this.getWorld('overworld');
    const sp = p.spawnPoint;
    if (sp) {
      this.ensureAround(ow, sp.x, sp.z, 0);
      const bx = Math.floor(sp.x), by = Math.floor(sp.y), bz = Math.floor(sp.z);
      if (ow.getBlock(bx, by, bz) === B.bed || ow.getBlock(bx, by - 1, bz) === B.bed) {
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
          if (!SOLID[ow.getBlock(bx + dx, by, bz + dz)] && !SOLID[ow.getBlock(bx + dx, by + 1, bz + dz)] && SOLID[ow.getBlock(bx + dx, by - 1, bz + dz)]) return { x: bx + dx + 0.5, y: by, z: bz + dz + 0.5 };
        }
        return { x: sp.x, y: sp.y + 0.6, z: sp.z };
      }
      p.spawnPoint = null;
      this.ui.chat('Votre lit a disparu ou est obstrué.', '#aaa');
    }
    const s = this.meta.spawn || { x: 0.5, y: 80, z: 0.5 };
    this.ensureAround(ow, s.x, s.z, 0);
    const x = Math.floor(s.x), z = Math.floor(s.z);
    const c = ow.getChunk(x >> 4, z >> 4);
    const y = c ? c.topY(x & 15, z & 15) + 1 : s.y;
    return { x: s.x, y, z: s.z };
  }

  respawn() {
    const p = this.player;
    p.dead = false;
    p.deathTime = 0;
    p.health = p.maxHealth;
    p.food = 20;
    p.saturation = 5;
    p.exhaustion = 0;
    p.effects = {};
    p.fireTicks = 0;
    p.air = 300;
    p.removed = false;
    p.hurtTime = 0;
    p.sleeping = false;
    p.absorption = 0;
    const sp = this.spawnLocation();
    const ow = this.getWorld('overworld');
    this.switchWorld(ow, sp.x, sp.y, sp.z);
    if (!ow.entities.includes(p)) ow.addEntity(p);
    this.ui.hudCache = {};
    this.input.requestLock();
  }

  respawnTeleport() {
    const sp = this.spawnLocation();
    this.switchWorld(this.getWorld('overworld'), sp.x, sp.y, sp.z);
  }

  // ---------- sommeil ----------
  tickSleep() {
    const p = this.player;
    if (!p.sleeping) return;
    if (p.sleepPos && this.world.getBlock(p.sleepPos.x, p.sleepPos.y, p.sleepPos.z) !== B.bed) { p.wakeUp(); return; }
    if (p.sleepTimer >= 100) {
      this.time = Math.floor(this.time / 24000) * 24000 + 24000;
      this.weather.raining = false;
      this.weather.thunder = false;
      this.weather.strength = 0;
      p.wakeUp();
      p.y += 0.5;
      this.grant('sleep');
      this.saveWorld();
    }
  }

  onSleep() {
    this.ui.action('Bonne nuit...');
  }

  // ---------- progrès ----------
  grant(id) {
    if (!this.meta || !ADV_BY_ID[id]) return;
    if (!this.meta.advancements) this.meta.advancements = {};
    if (this.meta.advancements[id]) return;
    this.meta.advancements[id] = Date.now();
    if (id !== 'root') this.ui.toast(ADV_BY_ID[id]);
  }

  checkAdvancements() {
    const p = this.player, w = this.world;
    for (const s of p.inventory.slots) if (s && ITEM_ADV[s.id]) this.grant(ITEM_ADV[s.id]);
    const arm = p.inventory.armor;
    if (arm.some((s) => s && ITEMS[s.id].armor && ITEMS[s.id].armor.material === 'iron')) this.grant('armor');
    if (arm.some((s) => s && ITEMS[s.id].armor && ITEMS[s.id].armor.material === 'diamond')) this.grant('diamond_armor');
    if (w.gen.structuresAt) {
      const st = w.gen.structuresAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (w.dim === 'nether' && st.includes('fortress')) {
        // vérifie qu'on est près de briques du Nether
        if (w.blockInBox(p.x - 6, p.y - 4, p.z - 6, p.x + 6, p.y + 3, p.z + 6, (id) => id === B.nether_bricks)) this.grant('fortress');
      }
      if (w.dim === 'overworld' && (st.includes('stronghold') || st.includes('portal_room'))) this.grant('stronghold');
    }
  }

  onPickup(id) { if (ITEM_ADV[id]) this.grant(ITEM_ADV[id]); }
  onCraft(id) { if (ITEM_ADV[id]) this.grant(ITEM_ADV[id]); }
  onSmelt(id) { if (ITEM_ADV[id]) this.grant(ITEM_ADV[id]); }
  onEat() { this.grant('eat'); }
  onBreed() { this.grant('breed'); }
  onTrade() { this.grant('trade'); }
  onEnchant() { this.grant('enchant'); }
  onShoot() { this.grant('bow'); }
  onBucketFill(id) { if (id === I.lava_bucket) this.grant('lava_bucket'); }
  onEndPortalOpened() { this.grant('end_portal'); this.ui.chat('Le portail de l\'End s\'est ouvert !', '#d0a0ff'); }
  onEntityDeath(e, src) {
    const k = src && src.entity;
    const byPlayer = k && (k.isPlayer || (k.owner && k.owner.isPlayer));
    if (byPlayer && e.hostile) this.grant('kill');
  }
  onPlayerHurt() {}
  onXpChange() {}
  onArmorChange() {}
  onBrew() { this.grant('brew'); }
}

void lookDir; void spawnEntity; void BLOCKS;
