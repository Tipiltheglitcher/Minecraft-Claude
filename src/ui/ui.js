// Interface : HUD, chat, notifications, écrans et menus
import { el, renderSlot, tooltipText, CraftingScreen, ChestScreen, FurnaceScreen, BrewingScreen, EnchantScreen, TradeScreen, CreativeScreen } from './containers.js';
import { iconURL, hudIcon, textureURL } from './icons.js';
import { ITEMS, itemName } from '../data/items.js';
import { B, I } from '../data/ids.js';
import { ADVANCEMENTS, ADV_BY_ID, GUIDE } from '../game/advancements.js';
import { runCommand, COMMANDS } from '../game/commands.js';
import { BIOME_NAMES } from '../world/gen/overworld.js';
import { EFFECT_NAMES } from '../entity/living.js';
import { POTIONS } from '../world/updates.js';
import { END_POEM, CREDITS } from './poem.js';
import { KEY_ACTIONS, DEFAULT_KEYS, keyName, conflicts } from '../game/keybinds.js';
import { SHADER_PRESETS } from '../gfx/fancy.js';

const SPLASHES = ['Édition JavaScript !', '100 % procédural !', 'Aussi en français !', 'Terminez le jeu !', 'Méfiez-vous des Creepers !', 'Ne regardez pas les Endermen !', 'Des cubes partout !', 'Fait avec WebGL2 !', 'Sans aucune image !', 'Le dragon vous attend...'];

export class UI {
  constructor(game, root) {
    this.game = game;
    this.root = root;
    this.screen = null; // écran modal actuel
    this.menu = null;
    this.cursor = null;
    this.mouseDown = false;
    this.chatLines = [];
    this.chatHistory = [];
    this.chatHistIdx = -1;
    this.toastQueue = [];
    this.hudCache = {};
    this.build();
    window.addEventListener('mousemove', (e) => {
      this.mx = e.clientX; this.my = e.clientY;
      if (this.cursorEl) { this.cursorEl.style.left = e.clientX + 'px'; this.cursorEl.style.top = e.clientY + 'px'; }
      if (this.tooltipEl && this.tooltipEl.style.display !== 'none') this.placeTooltip();
    });
    window.addEventListener('mousedown', (e) => {
      this.mouseDown = true;
      // clic hors fenêtre avec un objet : le jeter
      if (this.screen && this.screen.slots && this.cursor && !e.target.closest('.panel')) {
        const drop = e.button === 2 ? { ...this.cursor, count: 1 } : this.cursor;
        this.game.interaction.throwStack({ ...drop });
        if (e.button === 2) { this.cursor.count--; this.setCursor(this.cursor.count > 0 ? this.cursor : null); }
        else this.setCursor(null);
      }
    });
    window.addEventListener('mouseup', () => {
      this.mouseDown = false;
      if (this.screen && this.screen.onUp) this.screen.onUp();
    });
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  build() {
    const r = this.root;
    this.hud = el('div', 'hud', r);
    this.crosshair = el('div', 'crosshair', this.hud);
    this.bossbar = el('div', 'bossbar', this.hud);
    el('div', 'bossname', this.bossbar, 'Ender Dragon');
    this.bossfill = el('div', 'bossfill', el('div', 'bossbg', this.bossbar));
    this.actionbar = el('div', 'actionbar', this.hud);
    this.itemname = el('div', 'itemname', this.hud);
    const bottom = el('div', 'hudbottom', this.hud);
    this.statrows = el('div', 'statrows', bottom);
    const left = el('div', 'statcol', this.statrows);
    const right = el('div', 'statcol right', this.statrows);
    this.armorRow = el('div', 'icons', left);
    this.heartRow = el('div', 'icons', left);
    this.airRow = el('div', 'icons rev', right);
    this.foodRow = el('div', 'icons rev', right);
    this.xpWrap = el('div', 'xpbar', bottom);
    this.xpFill = el('div', 'xpfill', this.xpWrap);
    this.xpLevel = el('div', 'xplevel', this.xpWrap);
    this.hotbar = el('div', 'hotbar', bottom);
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) this.hotSlots.push(el('div', 'slot', this.hotbar));
    this.effectsEl = el('div', 'effects', this.hud);
    this.chatEl = el('div', 'chat', r);
    this.chatLog = el('div', 'chatlog', this.chatEl);
    this.chatInput = el('input', 'chatinput', this.chatEl);
    this.chatInput.style.display = 'none';
    this.chatInput.addEventListener('keydown', (e) => this.onChatKey(e));
    this.toasts = el('div', 'toasts', r);
    this.debug = el('div', 'debug', r);
    this.overlay = el('div', 'overlay', r);
    this.portalOverlay = el('div', 'portaloverlay', r);
    this.fireOverlay = el('div', 'fireoverlay', r);
    this.hurtOverlay = el('div', 'hurtoverlay', r);
    this.sleepOverlay = el('div', 'sleepoverlay', r);
    this.waterOverlay = el('div', 'wateroverlay', r);
    this.clickHint = el('div', 'clickhint', r, 'Cliquez pour jouer');
    this.screenEl = el('div', 'screen', r);
    this.cursorEl = el('div', 'slot cursor', r);
    this.tooltipEl = el('div', 'tooltip', r);
    this.tooltipEl.style.display = 'none';
    this.touchEl = el('div', 'touch', r);
    this.buildTouch();
    this.hud.style.display = 'none';
  }

  buildTouch() {
    if (!('ontouchstart' in window)) return;
    const mk = (label, cls, down, up) => {
      const b = el('div', 'tbtn ' + cls, this.touchEl, label);
      b.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); down(); }, { passive: false });
      b.addEventListener('touchend', (e) => { e.preventDefault(); e.stopPropagation(); up && up(); }, { passive: false });
      return b;
    };
    const inp = this.game.input;
    mk('⤒', 'tjump', () => inp.keys.add(inp.binds.jump), () => inp.keys.delete(inp.binds.jump));
    mk('⇩', 'tsneak', () => { const k = inp.binds.sneak; if (inp.keys.has(k)) inp.keys.delete(k); else inp.keys.add(k); });
    mk('⛏', 'tbreak', () => { inp.mouse.left = true; }, () => { inp.mouse.left = false; });
    mk('✋', 'tuse', () => { inp.mouse.right = true; inp.clicked.right = true; }, () => { inp.mouse.right = false; });
    mk('🎒', 'tinv', () => this.openInventory());
    mk('⏸', 'tpause', () => this.openPause());
  }

  // ---------- état ----------
  screenOpen() {
    return !!this.screen || !!this.menu || this.chatOpen;
  }

  setCursor(s) {
    this.cursor = s && s.count > 0 ? s : null;
    renderSlot(this.cursorEl, this.cursor);
    this.cursorEl.style.display = this.cursor ? 'block' : 'none';
    if (this.mx !== undefined) { this.cursorEl.style.left = this.mx + 'px'; this.cursorEl.style.top = this.my + 'px'; }
  }

  showTooltip(s) {
    if (!s) { this.tooltipEl.style.display = 'none'; return; }
    const lines = tooltipText(s);
    this.tooltipEl.innerHTML = '';
    for (const l of lines) { const d = el('div', '', this.tooltipEl, l.t); d.style.color = l.c; }
    this.tooltipEl.style.display = 'block';
    this.placeTooltip();
  }

  placeTooltip() {
    const t = this.tooltipEl;
    let x = (this.mx || 0) + 16, y = (this.my || 0) - 10;
    if (x + t.offsetWidth > window.innerWidth) x = (this.mx || 0) - t.offsetWidth - 10;
    t.style.left = x + 'px';
    t.style.top = Math.max(0, y) + 'px';
  }

  // Ouvre un écran de conteneur
  openScreen(scr) {
    this.closeScreen(true);
    this.screen = scr;
    this.screenEl.innerHTML = '';
    this.screenEl.appendChild(scr.root);
    this.screenEl.classList.add('open');
    this.game.input.releaseLock();
    scr.render();
    // infobulles
    for (const sl of scr.slots) {
      sl.el.addEventListener('mouseenter', () => this.showTooltip(sl.get()));
      sl.el.addEventListener('mouseleave', () => this.showTooltip(null));
    }
    this.game.audio.ui('click');
  }

  closeScreen(silent) {
    if (!this.screen) return;
    const s = this.screen;
    this.screen = null;
    s.close && s.close();
    if (this.cursor) {
      const left = this.game.player.inventory.add(this.cursor);
      if (left > 0) this.game.interaction.throwStack({ ...this.cursor, count: left });
      this.setCursor(null);
    }
    this.showTooltip(null);
    this.screenEl.innerHTML = '';
    this.screenEl.classList.remove('open');
    if (!silent && this.game.state === 'playing') this.game.input.requestLock();
  }

  openInventory(forceSurvival) {
    if (this.game.player.creative && !forceSurvival) this.openScreen(new CreativeScreen(this));
    else this.openScreen(new CraftingScreen(this, 2, 'Inventaire'));
  }
  openCrafting() { this.openScreen(new CraftingScreen(this, 3, 'Table de craft')); }
  openChest(be, pos, title) { this.openScreen(new ChestScreen(this, be, pos, title)); }
  openFurnace(be, pos) { this.openScreen(new FurnaceScreen(this, be, pos)); }
  openBrewing(be) { this.openScreen(new BrewingScreen(this, be)); }
  openEnchanting(pos) { this.openScreen(new EnchantScreen(this, pos)); }
  openTrading(v) { this.openScreen(new TradeScreen(this, v)); this.game.onTradeOpen?.(); }

  // ---------- clavier ----------
  handleKey(e, down) {
    const g = this.game;
    const code = e.code;
    const k = g.settings.keys;
    if (this.chatOpen) return true;
    if (this.capture) {
      if (down) { e.preventDefault(); this.capture(code); }
      return true;
    }
    if (!down) return false;
    if (this.menu) {
      if (code === 'Escape' && this.menu.back) { this.menu.back(); return true; }
      return false;
    }
    if (this.screen) {
      // Échap ne peut pas recapturer la souris (règle des navigateurs) : on ouvre la pause
      if (code === 'Escape') { e.preventDefault(); this.closeScreen(true); this.openPause(); return true; }
      if (code === k.inventory) { this.closeScreen(); e.preventDefault(); return true; }
      for (let i = 1; i <= 9; i++) if (code === k['hotbar' + i]) { if (this.screen.numberKey) this.screen.numberKey(i - 1); return true; }
      if (code === k.drop && this.screen.dropHovered) { this.screen.dropHovered(e.ctrlKey); return true; }
      return true;
    }
    if (g.state !== 'playing') return false;
    const act = (fn) => { e.preventDefault(); fn(); return true; };
    if (code === 'Escape') { this.openPause(); return true; }
    if (code === k.inventory) return act(() => this.openInventory());
    if (code === k.chat || code === 'Enter') return act(() => this.openChat(''));
    if (code === k.command || code === 'NumpadDivide') return act(() => this.openChat('/'));
    if (code === k.advancements) return act(() => this.openAdvancements());
    if (code === k.hideHud) return act(() => { g.hideHud = !g.hideHud; });
    if (code === k.debug) return act(() => { g.showDebug = !g.showDebug; });
    if (code === k.perspective) return act(() => { g.cameraMode = (g.cameraMode + 1) % 3; });
    if (code === k.screenshot) return act(() => this.screenshot());
    return false;
  }

  // La souris n'a pas pu être recapturée (pas de geste utilisateur) : pause plutôt qu'un jeu sans contrôle
  lockFailed() {
    const g = this.game;
    if (g.state === 'playing' && !this.screen && !this.menu && !this.chatOpen) this.openPause();
  }

  // ---------- chat ----------
  openChat(prefix) {
    this.chatOpen = true;
    this.chatInput.style.display = 'block';
    this.chatInput.value = prefix;
    this.chatEl.classList.add('open');
    this.game.input.releaseLock();
    this.game.input.keys.clear();
    setTimeout(() => { this.chatInput.focus(); this.chatInput.setSelectionRange(prefix.length, prefix.length); }, 0);
  }

  closeChat(silent = false) {
    this.chatOpen = false;
    this.chatInput.style.display = 'none';
    this.chatEl.classList.remove('open');
    this.chatInput.blur();
    if (!silent) this.game.input.requestLock();
  }

  onChatKey(e) {
    e.stopPropagation();
    if (e.code === 'Escape') { this.closeChat(true); if (this.game.state === 'playing') this.openPause(); return; }
    if (e.code === 'ArrowUp') { if (this.chatHistory.length) { this.chatHistIdx = Math.min(this.chatHistory.length - 1, this.chatHistIdx + 1); this.chatInput.value = this.chatHistory[this.chatHistory.length - 1 - this.chatHistIdx]; } e.preventDefault(); return; }
    if (e.code === 'ArrowDown') { this.chatHistIdx = Math.max(-1, this.chatHistIdx - 1); this.chatInput.value = this.chatHistIdx >= 0 ? this.chatHistory[this.chatHistory.length - 1 - this.chatHistIdx] : ''; e.preventDefault(); return; }
    if (e.code === 'Tab') {
      e.preventDefault();
      const v = this.chatInput.value;
      if (v.startsWith('/') && !v.includes(' ')) {
        const m = Object.keys(COMMANDS).filter((c) => c.startsWith(v.slice(1)));
        if (m.length === 1) this.chatInput.value = '/' + m[0] + ' ';
        else if (m.length) this.chat(m.map((c) => '/' + c).join('  '), '#aaa');
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      const v = this.chatInput.value.trim();
      if (v) {
        this.chatHistory.push(v);
        this.chatHistIdx = -1;
        if (v.startsWith('/')) {
          const res = runCommand(this.game, v);
          if (res) this.chat(res, '#ffff88');
        } else this.chat('<Joueur> ' + v);
      }
      this.closeChat();
    }
  }

  chat(text, color = '#fff') {
    const line = el('div', 'chatline', this.chatLog, text);
    line.style.color = color;
    line._t = performance.now();
    this.chatLines.push(line);
    while (this.chatLines.length > 60) this.chatLines.shift().remove();
    this.chatLog.scrollTop = this.chatLog.scrollHeight;
  }

  action(text, dur = 2500) {
    this.actionbar.textContent = text;
    this.actionbar.style.opacity = 1;
    clearTimeout(this._actT);
    this._actT = setTimeout(() => { this.actionbar.style.opacity = 0; }, dur);
  }

  // ---------- notifications de progrès ----------
  toast(adv) {
    const t = el('div', 'toast' + (adv.type === 'challenge' ? ' challenge' : adv.type === 'goal' ? ' goal' : ''), this.toasts);
    const ic = el('div', 'slot small', t);
    renderSlot(ic, { id: adv.icon, count: 1 });
    const tx = el('div', 'ttext', t);
    el('div', 'ttitle', tx, adv.type === 'challenge' ? 'Défi relevé !' : adv.type === 'goal' ? 'Objectif atteint !' : 'Progrès réalisé !');
    el('div', 'tname', tx, adv.title);
    this.game.audio.ui(adv.type === 'challenge' ? 'challenge' : 'toast');
    this.chat('Vous avez réalisé le progrès [' + adv.title + ']', '#55ff55');
    setTimeout(() => t.classList.add('hide'), 5000);
    setTimeout(() => t.remove(), 5600);
  }

  // ---------- HUD ----------
  setHudVisible(v) {
    this.hud.style.display = v ? 'block' : 'none';
  }

  updateHud(dt) {
    const g = this.game;
    const p = g.player;
    if (!p || g.state !== 'playing') return;
    const hide = g.hideHud;
    this.hud.classList.toggle('hidden', hide);
    const inv = p.inventory;
    // barre d'action
    for (let i = 0; i < 9; i++) {
      renderSlot(this.hotSlots[i], inv.slots[i]);
      this.hotSlots[i].classList.toggle('sel', i === inv.sel);
    }
    const sel = inv.selected();
    const selKey = inv.sel + ':' + (sel ? sel.id : 0);
    if (selKey !== this._selKey) {
      this._selKey = selKey;
      this.itemname.textContent = sel ? (sel.id === I.potion ? (POTIONS[sel.potion || 'water'] || POTIONS.water).name : itemName(sel)) : '';
      this.itemname.style.opacity = sel ? 1 : 0;
      clearTimeout(this._inT);
      this._inT = setTimeout(() => { this.itemname.style.opacity = 0; }, 2000);
    }
    const survival = !p.creative && !g.spectator;
    this.statrows.style.visibility = survival ? 'visible' : 'hidden';
    this.xpWrap.style.visibility = survival ? 'visible' : 'hidden';
    if (survival) {
      // cœurs, faim, armure, air : éléments réutilisés, seule l'image change (pas de reconstruction du DOM)
      const hp = Math.ceil(p.health);
      const poison = p.hasEffect('poison');
      const hkey = hp + ':' + p.maxHealth + ':' + poison + ':' + Math.ceil(p.absorption) + ':' + (hp <= 4 && !g.paused);
      if (hkey !== this.hudCache.h) {
        this.hudCache.h = hkey;
        const full = poison ? 'heart_poison' : 'heart_full';
        const icons = [];
        for (let i = 0; i < p.maxHealth / 2; i++) { const v = hp - i * 2; icons.push(v >= 2 ? full : v === 1 ? 'heart_half' : 'heart_empty'); }
        for (let i = 0; i < Math.ceil(p.absorption / 2); i++) icons.push('heart_gold');
        this.setIcons(this.heartRow, icons, hp <= 4 && !g.paused ? 'shake' : '');
      }
      // clignotement des cœurs quand on est touché : simple classe CSS
      const blink = p.hurtTime > 0 && g.time % 4 < 2;
      if (blink !== this.hudCache.blink) { this.hudCache.blink = blink; this.heartRow.classList.toggle('blink', blink); }
      const hunger = p.hasEffect('hunger');
      const fkey = p.food + ':' + hunger;
      if (fkey !== this.hudCache.f) {
        this.hudCache.f = fkey;
        const icons = [];
        for (let i = 0; i < 10; i++) { const v = p.food - i * 2; icons.push(v >= 2 ? 'food_full' : v === 1 ? 'food_half' : 'food_empty'); }
        this.setIcons(this.foodRow, icons, '');
        this.foodRow.style.filter = hunger ? 'hue-rotate(60deg) saturate(0.6)' : '';
      }
      const ar = p.armorValue();
      if (ar !== this.hudCache.a) {
        this.hudCache.a = ar;
        const icons = [];
        if (ar > 0) for (let i = 0; i < 10; i++) { const v = ar - i * 2; icons.push(v >= 2 ? 'armor_full' : v === 1 ? 'armor_half' : 'armor_empty'); }
        this.setIcons(this.armorRow, icons, '');
      }
      const air = p.eyesInWater() || p.air < 300 ? Math.ceil((Math.max(0, p.air) * 10) / 300) : -1;
      if (air !== this.hudCache.air) {
        this.hudCache.air = air;
        this.setIcons(this.airRow, new Array(Math.max(0, air)).fill('bubble'), '');
      }
      this.xpFill.style.width = p.xp * 100 + '%';
      this.xpLevel.textContent = p.xpLevel > 0 ? p.xpLevel : '';
    }
    // effets
    const ekey = Object.entries(p.effects).map(([k, e]) => k + Math.ceil(e.ticks / 20)).join(',');
    if (ekey !== this.hudCache.e) {
      this.hudCache.e = ekey;
      this.effectsEl.innerHTML = '';
      for (const [k, e] of Object.entries(p.effects)) {
        const s = Math.ceil(e.ticks / 20);
        el('div', 'effect', this.effectsEl, (EFFECT_NAMES[k] || k) + (e.amp ? ' ' + ['', 'II', 'III', 'IV'][e.amp] : '') + ' ' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'));
      }
    }
    // boss
    const dragon = g.world.dim === 'end' ? g.world.entities.find((e) => e.type === 'ender_dragon' && !e.removed) : null;
    this.bossbar.style.display = dragon ? 'block' : 'none';
    if (dragon) this.bossfill.style.width = (dragon.health / dragon.maxHealth) * 100 + '%';
    // chat : estompage
    const now = performance.now();
    for (const l of this.chatLines) l.classList.toggle('old', !this.chatOpen && now - l._t > 10000);
    // superpositions
    const portal = g.portalEffect || 0;
    this.portalOverlay.style.opacity = portal;
    this.fireOverlay.style.opacity = p.fireTicks > 0 && !p.fireImmune && !p.hasEffect('fire_resistance') && g.cameraMode === 0 ? 1 : 0;
    this.hurtOverlay.style.opacity = p.hurtTime > 0 ? (p.hurtTime / 10) * 0.35 : 0;
    this.sleepOverlay.style.opacity = p.sleeping ? Math.min(1, p.sleepTimer / 100) : p.dead ? 0 : 0;
    this.waterOverlay.style.opacity = g.renderer && g.renderer.env && g.renderer.env.underFluid ? 0.25 : 0;
    this.clickHint.style.display = g.state === 'playing' && !this.screenOpen() && !g.input.locked && !g.input.dragLook && !g.input.touch.active && !p.dead ? 'block' : 'none';
    // debug
    this.debug.style.display = g.showDebug ? 'block' : 'none';
    if (g.showDebug) this.updateDebug();
    // conteneur ouvert : rafraîchir (four...)
    if (this.screen && this.screen.tick) this.screen.tick();
  }

  // Met à jour une rangée d'icônes en réutilisant ses éléments
  setIcons(row, names, cls) {
    const kids = row.children;
    while (kids.length < names.length) el('div', 'hicon', row);
    for (let i = 0; i < kids.length; i++) {
      const d = kids[i];
      if (i >= names.length) { if (d.style.display !== 'none') d.style.display = 'none'; continue; }
      if (d.style.display === 'none') d.style.display = '';
      if (d._icon !== names[i]) { d._icon = names[i]; d.style.backgroundImage = `url(${hudIcon(names[i])})`; }
      const c = 'hicon' + (cls ? ' ' + cls : '');
      if (d.className !== c) d.className = c;
    }
  }

  updateDebug() {
    const g = this.game, p = g.player, w = g.world, r = g.renderer;
    const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
    const dirs = ['nord (-Z)', 'ouest (-X)', 'sud (+Z)', 'est (+X)'];
    const yawN = ((-p.yaw * 180) / Math.PI % 360 + 360) % 360;
    const facing = dirs[Math.round(yawN / 90) % 4];
    const t = g.target;
    const lines = [
      'Minecraft JS — ' + g.fps + ' ips (' + r.stats.drawn + ' sections, ' + r.stats.meshedThisFrame + ' maillées)',
      'Dimension : ' + w.props.name,
      'XYZ : ' + p.x.toFixed(3) + ' / ' + p.y.toFixed(3) + ' / ' + p.z.toFixed(3),
      'Bloc : ' + bx + ' ' + by + ' ' + bz + '   Chunk : ' + (bx >> 4) + ' ' + (bz >> 4),
      'Orientation : ' + facing + ' (' + yawN.toFixed(1) + ' / ' + ((p.pitch * 180) / Math.PI).toFixed(1) + ')',
      'Biome : ' + (BIOME_NAMES[w.getBiome(bx, bz)] || '?'),
      'Lumière : ' + w.getLight(bx, by + 1, bz) + ' (ciel ' + w.getSky(bx, by + 1, bz) + ', bloc ' + w.getBlockLight(bx, by + 1, bz) + ')',
      'Heure : ' + (g.time % 24000) + ' (jour ' + (Math.floor(g.time / 24000) + 1) + ')' + (g.weather.raining ? ' — pluie' : ''),
      'Entités : ' + w.entities.length + '   Chunks : ' + w.chunks.size + '   Particules : ' + g.particles.list.length,
      'Rendu : ' + r.canvas.width + '×' + r.canvas.height + ' (échelle ' + Math.round((r.dynScale || 1) * 100) + ' %)' + (r.cullActive ? ', grottes masquées' : '') +
        (g.workers && g.workers.ok ? '   Workers : ' + g.workers.workers.length + ' (' + g.workers.pending + ' tâches, ' + w.pending.size + ' chunks en cours)' : '   Workers : non'),
      'Graine : ' + g.meta.seed,
    ];
    if (t) lines.push('Cible : ' + (ITEMS[t.id] ? ITEMS[t.id].name : t.id) + ' (' + t.x + ', ' + t.y + ', ' + t.z + ') méta ' + w.getMeta(t.x, t.y, t.z));
    if (g.targetEntity) lines.push('Entité : ' + g.targetEntity.entity.type + ' ♥' + Math.ceil(g.targetEntity.entity.health || 0));
    this.debug.textContent = lines.join('\n');
  }

  screenshot() {
    const c = this.game.renderer.canvas;
    this.game.renderer.render(0, 0);
    const a = document.createElement('a');
    a.href = c.toDataURL('image/png');
    a.download = 'minecraft-js-' + Date.now() + '.png';
    a.click();
    this.chat('Capture d\'écran enregistrée', '#aaa');
  }

  // ================= Menus =================
  showMenu(builder, opts = {}) {
    this.closeScreen(true);
    this.screenEl.innerHTML = '';
    this.screenEl.classList.add('open');
    if (opts.dirt) this.screenEl.classList.add('dirt'); else this.screenEl.classList.remove('dirt');
    const m = { back: opts.back || null };
    this.menu = m;
    const panel = el('div', 'menu ' + (opts.cls || ''), this.screenEl);
    builder(panel, m);
    this.game.input.releaseLock();
    return panel;
  }

  closeMenu(resume = true) {
    this.menu = null;
    this.screenEl.innerHTML = '';
    this.screenEl.classList.remove('open', 'dirt');
    if (resume && this.game.state === 'playing') this.game.input.requestLock();
  }

  button(parent, text, fn, cls = '') {
    const b = el('button', 'btn ' + cls, parent, text);
    b.addEventListener('click', (e) => { e.stopPropagation(); this.game.audio.init(); this.game.audio.ui('click'); fn(); });
    return b;
  }

  // ----- écran titre -----
  openTitle() {
    this.game.audio.init();
    this.setHudVisible(false);
    this.showMenu((p) => {
      const logo = el('div', 'logo', p);
      el('div', 'logotext', logo, 'MINECRAFT');
      el('div', 'logosub', logo, 'ÉDITION JAVASCRIPT');
      el('div', 'splash', logo, SPLASHES[Math.floor(Math.random() * SPLASHES.length)]);
      const col = el('div', 'col buttons', p);
      this.button(col, 'Solo', () => this.openWorlds());
      this.button(col, 'Guide de survie', () => this.openGuide(() => this.openTitle()));
      this.button(col, 'Options', () => this.openOptions(() => this.openTitle()));
      this.button(col, 'Crédits', () => this.openCredits(false, () => this.openTitle()));
      const ver = el('div', 'version', p, 'Minecraft JS 1.0 — clone non officiel, aucune ressource Mojang.');
      this.game.saves.ready.then(() => { ver.textContent += this.game.saves.persistent ? ' Sauvegardes : navigateur (IndexedDB).' : ' Sauvegarde indisponible (mode éphémère).'; });
    }, { dirt: true, cls: 'title' });
  }

  async openWorlds() {
    const worlds = await this.game.saves.listWorlds();
    this.showMenu((p) => {
      el('h2', '', p, 'Choisir un monde');
      const list = el('div', 'worldlist', p);
      if (!worlds.length) el('div', 'empty', list, 'Aucun monde. Créez-en un !');
      let selected = null;
      const rows = [];
      for (const w of worlds) {
        const row = el('div', 'world', list);
        el('div', 'wname', row, w.name + (w.completed ? ' ★' : ''));
        el('div', 'winfo', row, (w.gamemode === 'creative' ? 'Créatif' : 'Survie') + ' — ' + new Date(w.lastPlayed || w.created).toLocaleString('fr-FR') + ' — Jour ' + (Math.floor((w.time || 0) / 24000) + 1));
        row.addEventListener('click', () => { selected = w; rows.forEach((r) => r.classList.remove('sel')); row.classList.add('sel'); });
        row.addEventListener('dblclick', () => this.game.loadWorld(w.id));
        rows.push(row);
      }
      const bar = el('div', 'row buttons', p);
      this.button(bar, 'Jouer', () => { if (selected) this.game.loadWorld(selected.id); });
      this.button(bar, 'Nouveau monde', () => this.openCreate());
      this.button(bar, 'Supprimer', async () => {
        if (!selected) return;
        if (!confirm('Supprimer définitivement « ' + selected.name + ' » ?')) return;
        await this.game.saves.deleteWorld(selected.id);
        this.openWorlds();
      });
      this.button(bar, 'Retour', () => this.openTitle());
    }, { dirt: true, back: () => this.openTitle() });
  }

  openCreate() {
    this.showMenu((p) => {
      el('h2', '', p, 'Créer un nouveau monde');
      const f = el('div', 'form', p);
      const row = (label) => { const r = el('label', 'frow', f); el('span', '', r, label); return r; };
      const name = el('input', '', row('Nom du monde'));
      name.value = 'Nouveau monde';
      const seed = el('input', '', row('Graine (facultatif)'));
      seed.placeholder = 'aléatoire';
      const mode = el('select', '', row('Mode de jeu'));
      for (const [v, t] of [['survival', 'Survie'], ['creative', 'Créatif']]) { const o = el('option', '', mode, t); o.value = v; }
      const diff = el('select', '', row('Difficulté'));
      ['Paisible', 'Facile', 'Normale', 'Difficile'].forEach((t, i) => { const o = el('option', '', diff, t); o.value = i; });
      diff.value = String(this.game.settings.difficulty);
      const bonus = el('input', '', row('Coffre bonus de départ'));
      bonus.type = 'checkbox';
      bonus.checked = true;
      for (const i of [name, seed]) i.addEventListener('keydown', (e) => e.stopPropagation());
      const bar = el('div', 'row buttons', p);
      this.button(bar, 'Créer le monde', () => {
        this.game.settings.difficulty = parseInt(diff.value, 10);
        this.game.saveSettings();
        this.game.newWorld({ name: name.value.trim() || 'Nouveau monde', seed: seed.value.trim(), gamemode: mode.value, bonus: bonus.checked });
      });
      this.button(bar, 'Annuler', () => this.openWorlds());
    }, { dirt: true, back: () => this.openWorlds() });
  }

  loading(text, progress) {
    if (!this.loadingEl || !this.loadingEl.isConnected) {
      this.showMenu((p) => {
        this.loadingText = el('div', 'loadtext', p, text);
        const bar = el('div', 'loadbar', p);
        this.loadingFill = el('div', 'loadfill', bar);
        this.loadingEl = p;
      }, { dirt: true, cls: 'loading' });
    }
    this.loadingText.textContent = text;
    this.loadingFill.style.width = Math.round((progress || 0) * 100) + '%';
  }

  // ----- pause -----
  openPause() {
    const g = this.game;
    if (g.state !== 'playing' || g.player.dead) return;
    if (this.menu && !this.menu.sub && this.menu.isPause) return;
    this.closeScreen(true);
    g.paused = true;
    this.showMenu((p) => {
      el('h2', '', p, 'Menu du jeu');
      const col = el('div', 'col buttons', p);
      this.button(col, 'Reprendre la partie', () => this.resume());
      this.button(col, 'Progrès', () => this.openAdvancements(() => this.openPause()));
      this.button(col, 'Guide de survie', () => this.openGuide(() => this.openPause()));
      this.button(col, 'Options', () => this.openOptions(() => this.openPause()));
      this.button(col, 'Sauvegarder et quitter', () => { g.paused = false; g.quitToTitle(); });
      const p2 = g.player;
      el('div', 'stats', p, 'Morts : ' + p2.stats.deaths + ' — Créatures tuées : ' + p2.stats.kills + ' — Blocs minés : ' + p2.stats.blocksMined + ' — Temps de jeu : ' + Math.floor(p2.stats.playTicks / 1200) + ' min');
    }, { back: () => this.resume(), cls: 'pause' });
    this.menu.isPause = true;
  }

  resume() {
    this.game.paused = false;
    this.closeMenu(true);
  }

  // ----- mort -----
  openDeath(msg) {
    const g = this.game;
    this.closeScreen(true);
    this.showMenu((p) => {
      el('h1', 'deathtitle', p, 'Vous êtes mort !');
      el('div', 'deathmsg', p, msg);
      el('div', 'deathscore', p, 'Score : ' + g.player.xpTotal);
      const col = el('div', 'col buttons', p);
      this.button(col, 'Réapparaître', () => { this.closeMenu(true); g.respawn(); });
      this.button(col, 'Écran titre', () => g.quitToTitle());
    }, { cls: 'death' });
  }

  // ----- options -----
  openOptions(back, tab = 'video') {
    const g = this.game, s = g.settings;
    const TABS = [['video', 'Vidéo'], ['shaders', 'Shaders'], ['sound', 'Son'], ['controls', 'Commandes'], ['game', 'Jeu']];
    this.showMenu((p) => {
      el('h2', '', p, 'Options');
      const tabs = el('div', 'tabs', p);
      for (const [id, label] of TABS) {
        const b = el('button', 'btn tab' + (id === tab ? ' sel' : ''), tabs, label);
        b.addEventListener('click', (e) => { e.stopPropagation(); g.audio.ui('click'); g.saveSettings(); this.openOptions(back, id); });
      }
      const f = el('div', 'options', p);
      const pct = (v) => Math.round(v * 100) + ' %';
      const slider = (label, key, min, max, step, fmt) => {
        const r = el('label', 'opt', f);
        const t = el('span', '', r);
        const i = el('input', '', r);
        i.type = 'range'; i.min = min; i.max = max; i.step = step; i.value = s[key];
        i.id = 'opt-' + key;
        const upd = () => { t.textContent = label + ' : ' + (fmt ? fmt(s[key]) : s[key]); };
        i.addEventListener('input', () => { s[key] = parseFloat(i.value); upd(); g.applySettings(); });
        upd();
      };
      const toggle = (label, key, remesh = false, fmt) => {
        const b = el('button', 'btn opt', f);
        const upd = () => { b.textContent = label + ' : ' + (fmt ? fmt(s[key]) : s[key] ? 'OUI' : 'NON'); };
        b.addEventListener('click', () => { s[key] = !s[key]; upd(); g.applySettings(remesh); g.audio.ui('click'); });
        upd();
      };
      const choice = (label, key, opts, after, wide = false) => {
        const b = el('button', 'btn opt' + (wide ? ' wide' : ''), f);
        const upd = () => { b.textContent = label + ' : ' + opts[s[key]]; };
        b.addEventListener('click', () => { s[key] = (s[key] + 1) % opts.length; upd(); g.applySettings(); g.audio.ui('click'); if (after) after(s[key]); });
        upd();
      };
      const header = (text) => el('div', 'optcat', f, text);
      const note = (text) => el('div', 'optnote', f, text);

      if (tab === 'video') {
        slider('Distance d\'affichage', 'renderDistance', 2, 32, 1, (v) => v + ' chunks' + (v > 16 ? ' (très gourmand)' : v > 12 ? ' (gourmand)' : ''));
        slider('Champ de vision', 'fov', 50, 110, 1, (v) => (v === 70 ? 'Normal' : v >= 110 ? 'Quake Pro' : v + '°'));
        slider('Luminosité', 'brightness', 0, 1, 0.05, (v) => (v === 0 ? 'Sombre' : v === 1 ? 'Lumineux' : pct(v)));
        slider('Échelle de l\'interface', 'guiScale', 1, 4, 1, (v) => '×' + v);
        slider('Résolution de rendu', 'resolution', 0.4, 1, 0.1, pct);
        choice('Particules', 'particles', ['Minimales', 'Réduites', 'Toutes']);
        toggle('Feuilles détaillées', 'fancyLeaves', true);
        toggle('Éclairage lissé', 'smoothLighting', true);
        toggle('Nuages', 'clouds');
        toggle('Balancement de la vue', 'viewBobbing');
        toggle('Résolution dynamique', 'dynamicRes');
        toggle('Masquer les grottes invisibles', 'caveCulling');
        const w = g.workers;
        note('Résolution dynamique : baisse un peu la résolution quand le jeu ralentit, puis la remonte. ' +
          (w && w.ok ? 'Calculs en parallèle : ' + w.workers.length + ' cœur(s) de processeur utilisés pour générer le terrain, le maillage et les sons.' : 'Calculs en parallèle indisponibles dans ce navigateur : tout est calculé sur le fil principal.'));
      } else if (tab === 'shaders') {
        choice('Mode shader', 'shaders', ['Désactivé', 'Bas', 'Moyen', 'Élevé', 'Ultra'], (v) => {
          if (SHADER_PRESETS[v]) Object.assign(s, SHADER_PRESETS[v]);
          g.saveSettings();
          this.openOptions(back, 'shaders');
        }, true);
        if (g.renderer.fancyError) note('Le mode shader n\'a pas pu démarrer sur cet appareil : ' + g.renderer.fancyError);
        else if (!s.shaders) note('Active les ombres dynamiques du soleil et de la lune, l\'eau qui reflète le paysage, la végétation qui ondule au vent, les nuages volumétriques, le halo des lumières et les rayons de soleil. Demande une carte graphique correcte.');
        if (s.shaders) {
          toggle('Ombres dynamiques', 'shaderShadows');
          choice('Qualité des ombres', 'shaderShadowQuality', ['Basse (1024)', 'Haute (2048)', 'Ultra (4096)']);
          slider('Portée des ombres', 'shaderShadowDist', 32, 160, 16, (v) => v + ' blocs');
          toggle('Réflexions de l\'eau', 'shaderWater');
          toggle('Végétation ondulante', 'shaderWaving');
          toggle('Halo lumineux (bloom)', 'shaderBloom');
          toggle('Rayons de soleil', 'shaderGodrays');
          toggle('Vignette', 'shaderVignette');
          slider('Exposition', 'shaderExposure', 0.5, 2, 0.05, pct);
          slider('Saturation', 'shaderSaturation', 0.5, 1.6, 0.05, pct);
        }
      } else if (tab === 'sound') {
        slider('Volume général', 'volume', 0, 1, 0.05, pct);
        slider('Musique', 'musicVolume', 0, 1, 0.05, pct);
        slider('Effets sonores', 'sfxVolume', 0, 1, 0.05, pct);
        slider('Ambiance (pluie, grottes...)', 'ambientVolume', 0, 1, 0.05, pct);
        choice('Pauses entre les morceaux', 'musicPause', ['Aucune (musique continue)', 'Courtes', 'Longues (comme Minecraft)']);
        const b = el('button', 'btn opt', f, 'Écouter un morceau');
        b.addEventListener('click', () => { g.audio.init(); g.audio.playPiece(g.world ? g.world.dim : 'overworld'); });
      } else if (tab === 'controls') {
        slider('Sensibilité de la souris', 'sensitivity', 0.2, 3, 0.05, pct);
        toggle('Inverser la souris', 'invertY');
        toggle('S\'accroupir', 'toggleSneak', false, (v) => (v ? 'Basculer' : 'Maintenir'));
        toggle('Sprinter', 'toggleSprint', false, (v) => (v ? 'Basculer' : 'Maintenir'));
        note('Cliquez sur une touche puis appuyez sur la nouvelle touche ou un bouton de la souris. Échap annule.');
        const btns = {};
        const refresh = () => {
          const conf = conflicts(s.keys);
          for (const [a, b] of Object.entries(btns)) {
            b.textContent = keyName(s.keys[a]);
            b.classList.toggle('conflict', conf.has(a));
            b.classList.remove('wait');
          }
        };
        for (const cat of KEY_ACTIONS) {
          header(cat.cat);
          for (const [a, label] of cat.list) {
            const row = el('div', 'opt keyrow', f);
            el('span', '', row, label);
            const b = el('button', 'btn keybtn', row);
            btns[a] = b;
            b.addEventListener('click', (e) => {
              e.stopPropagation();
              g.audio.ui('click');
              refresh();
              b.textContent = '> ? <';
              b.classList.add('wait');
              let onMouse = null;
              const done = (code) => {
                this.capture = null;
                window.removeEventListener('mousedown', onMouse, true);
                if (code && code !== 'Escape') s.keys[a] = code;
                g.saveSettings();
                refresh();
              };
              onMouse = (ev) => { ev.preventDefault(); ev.stopPropagation(); done('Mouse' + ev.button); };
              this.capture = done;
              setTimeout(() => { if (this.capture === done) window.addEventListener('mousedown', onMouse, true); }, 0);
            });
          }
        }
        refresh();
        const r = el('button', 'btn opt wide', f, 'Réinitialiser les touches');
        r.addEventListener('click', () => { s.keys = Object.assign({}, DEFAULT_KEYS); g.saveSettings(); g.audio.ui('click'); refresh(); });
      } else if (tab === 'game') {
        choice('Difficulté', 'difficulty', ['Paisible', 'Facile', 'Normale', 'Difficile']);
        toggle('Garder l\'inventaire à la mort', 'keepInventory');
        toggle('Cycle jour/nuit', 'doDaylightCycle');
        toggle('Apparition des monstres', 'doMobSpawning');
        toggle('Destructions par les créatures', 'mobGriefing');
        toggle('Propagation du feu', 'fireSpread');
        toggle('Régénération naturelle', 'naturalRegen');
        toggle('Butin des créatures', 'mobLoot');
      }
      const bar = el('div', 'row buttons', p);
      this.button(bar, 'Terminé', () => { this.capture = null; g.saveSettings(); back(); });
    }, { dirt: g.state !== 'playing', back: () => { this.capture = null; g.saveSettings(); back(); }, cls: 'optmenu' });
  }

  // ----- progrès -----
  openAdvancements(back) {
    const g = this.game;
    const done = g.meta ? g.meta.advancements || {} : {};
    const doBack = back || (() => this.closeMenu(true));
    this.showMenu((p) => {
      el('h2', '', p, 'Progrès — ' + Object.keys(done).length + ' / ' + ADVANCEMENTS.length);
      const list = el('div', 'advlist', p);
      for (const a of ADVANCEMENTS) {
        const row = el('div', 'adv' + (done[a.id] ? ' done' : '') + (a.type ? ' ' + a.type : ''), list);
        const ic = el('div', 'slot small', row);
        renderSlot(ic, { id: a.icon, count: 1 });
        const t = el('div', 'advtext', row);
        el('div', 'advtitle', t, a.title + (done[a.id] ? ' ✔' : ''));
        el('div', 'advdesc', t, a.desc);
        if (a.parent) el('div', 'advparent', t, '← ' + ADV_BY_ID[a.parent].title);
      }
      const bar = el('div', 'row buttons', p);
      this.button(bar, 'Terminé', doBack);
    }, { back: doBack, cls: 'advmenu', dirt: g.state !== 'playing' });
    if (!back) this.game.input.releaseLock();
  }

  // ----- guide -----
  openGuide(back) {
    this.showMenu((p) => {
      el('h2', '', p, 'Guide de survie : comment finir le jeu');
      const box = el('div', 'guide', p);
      for (const [t, d] of GUIDE) {
        const s = el('div', 'gstep', box);
        el('div', 'gtitle', s, t);
        el('div', 'gdesc', s, d);
      }
      el('h3', '', box, 'Commandes');
      const K = this.game.settings.keys;
      const kn = (a) => keyName(K[a]);
      const keys = [
        [kn('forward') + kn('left') + kn('back') + kn('right'), 'Se déplacer'], [kn('jump'), 'Sauter / nager (double appui : voler en créatif)'], [kn('sneak'), 'S\'accroupir (ne tombe pas des bords)'],
        [kn('sprint') + ' / double ' + kn('forward'), 'Sprinter'], [kn('attack'), 'Miner / attaquer'], [kn('use'), 'Poser / utiliser / manger / tirer à l\'arc'], [kn('pickBlock'), 'Choisir le bloc visé'],
        ['1-9 / molette', 'Barre d\'action'], [kn('inventory'), 'Inventaire'], [kn('drop'), 'Jeter un objet (Ctrl : toute la pile)'], [kn('chat') + ' ou ' + kn('command'), 'Chat et commandes (/help)'], [kn('advancements'), 'Progrès'],
        [kn('zoom'), 'Zoom'], [kn('hideHud'), 'Masquer l\'interface'], [kn('screenshot'), 'Capture d\'écran'], [kn('debug'), 'Informations de débogage'], [kn('perspective'), 'Changer de vue'], ['Échap', 'Pause'],
        ['Inventaire', 'Maj+clic : déplacement rapide ; clic droit : moitié / un par un ; glisser : répartir ; double-clic : rassembler ; livre de recettes à droite'],
      ];
      el('div', 'tip', box, 'Toutes les touches se changent dans Options → Commandes.');
      const tbl = el('div', 'keys', box);
      for (const [k, d] of keys) { const r = el('div', 'krow', tbl); el('span', 'key', r, k); el('span', '', r, d); }
      el('h3', '', box, 'Astuces');
      for (const t of [
        'La nuit, les monstres apparaissent dans l\'obscurité. Les torches les empêchent d\'apparaître.',
        'Les zombies et squelettes brûlent au soleil. Les Creepers explosent : reculez !',
        'Les Endermen deviennent hostiles si vous les regardez dans les yeux. Portez une citrouille sur la tête pour les éviter.',
        'Les villageois échangent des émeraudes contre des objets utiles ; le prêtre vend des perles de l\'Ender.',
        'Un seau d\'eau versé sur de la lave source crée de l\'obsidienne.',
        'Une table d\'enchantement entourée de 15 bibliothèques donne les meilleurs enchantements. Combinez un livre enchanté et un objet dans la grille d\'artisanat.',
        'Dans l\'End, les cristaux sur les piliers soignent le dragon : détruisez-les avec des flèches ou en grimpant.',
        'Commandes utiles : /locate fort, /locate forteresse, /locate village, /time set jour, /gamemode creatif.',
      ]) el('div', 'tip', box, '• ' + t);
      const bar = el('div', 'row buttons', p);
      this.button(bar, 'Retour', back);
    }, { back, cls: 'guidemenu', dirt: this.game.state !== 'playing' });
  }

  // ----- générique de fin -----
  openCredits(poem, done) {
    const g = this.game;
    this.closeScreen(true);
    this.setHudVisible(false);
    const panel = this.showMenu((p) => {
      const scroll = el('div', 'credits', p);
      const inner = el('div', 'creditsinner', scroll);
      if (poem) {
        el('div', 'ctitle', inner, 'MINECRAFT JS');
        el('div', 'cspace', inner);
        for (const [who, line] of END_POEM) {
          const d = el('div', 'cpoem ' + (who === 1 ? 'voice1' : who === 2 ? 'voice2' : ''), inner, line);
          void d;
        }
        el('div', 'cspace', inner);
      }
      for (const [t, lines] of CREDITS) {
        el('div', 'chead', inner, t);
        for (const l of lines) el('div', 'cline', inner, l);
        el('div', 'cspace small', inner);
      }
      el('div', 'cspace', inner);
      el('div', 'ctitle', inner, 'Merci d\'avoir joué !');
      const skip = el('div', 'cskip', p, 'Cliquez ou appuyez sur Échap pour passer');
      void skip;
      let y = window.innerHeight;
      let last = performance.now();
      let speed = 40;
      const finish = () => {
        if (this._creditsDone) return;
        this._creditsDone = true;
        cancelAnimationFrame(this._creditsRaf);
        this.closeMenu(false);
        done && done();
      };
      this._creditsDone = false;
      const step = (t) => {
        const dt = Math.min(0.1, (t - last) / 1000);
        last = t;
        y -= dt * speed;
        inner.style.transform = `translateY(${y}px)`;
        if (y < -inner.offsetHeight - 50) { finish(); return; }
        this._creditsRaf = requestAnimationFrame(step);
      };
      this._creditsRaf = requestAnimationFrame(step);
      p.addEventListener('mousedown', () => { speed = speed === 40 ? 400 : 40; });
      p.addEventListener('dblclick', finish);
      this.menu.back = finish;
      if (poem) g.audio.playCredits();
    }, { cls: 'creditsmenu', back: () => {} });
    void panel;
  }
}

void B; void iconURL; void textureURL; void ITEMS;
