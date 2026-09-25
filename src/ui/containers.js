// Écrans à emplacements (inventaire, craft, four, coffre, enchantement, alambic, commerce, créatif)
import { ITEMS, fuelValue, itemName } from '../data/items.js';
import { BLOCKS } from '../data/blocks.js';
import { B, I, ID } from '../data/ids.js';
import { findRecipe, RECIPES, SMELTING, recipeIngredients } from '../data/recipes.js';
import { sameItem, cloneStack, stackMax } from '../game/inventory.js';
import { iconURL } from './icons.js';
import { enchantLabel, isEnchantable, rollEnchants, enchantCosts, applyBook, randomBook } from '../game/enchant.js';
import { canSmelt, POTIONS } from '../world/updates.js';
import { PROFESSION_NAMES } from '../entity/mobs.js';

export function el(tag, cls, parent, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  if (parent) parent.appendChild(e);
  return e;
}

// Rendu d'un emplacement
export function renderSlot(div, s) {
  const key = s ? s.id + ':' + s.count + ':' + (s.dmg || 0) + ':' + (s.ench ? 1 : 0) + ':' + (s.potion || '') : '';
  if (div._key === key) return;
  div._key = key;
  div.innerHTML = '';
  if (!s) return;
  const img = el('div', 'icon', div);
  img.style.backgroundImage = `url(${iconURL(s)})`;
  if (s.ench) el('div', 'glint', div);
  if (s.count > 1) el('span', 'count', div, String(s.count));
  const d = ITEMS[s.id];
  if (d && d.durability && s.dmg > 0) {
    const bar = el('div', 'dur', div);
    const f = 1 - s.dmg / d.durability;
    const inner = el('div', '', bar);
    inner.style.width = f * 100 + '%';
    inner.style.background = `hsl(${f * 120},100%,45%)`;
  }
}

export function tooltipText(s) {
  if (!s) return null;
  const d = ITEMS[s.id];
  const lines = [];
  let name = itemName(s);
  if (s.id === I.potion) name = (POTIONS[s.potion || 'water'] || POTIONS.water).name;
  lines.push({ t: name, c: s.ench ? '#55ffff' : '#fff' });
  if (s.ench) for (const [k, v] of Object.entries(s.ench)) lines.push({ t: enchantLabel(k, v), c: '#aaa' });
  if (d && d.food) lines.push({ t: 'Nourriture : +' + d.food.hunger, c: '#aaa' });
  if (d && d.damage && d.tool) lines.push({ t: 'Dégâts : ' + d.damage, c: '#5555ff' });
  if (d && d.armor) lines.push({ t: 'Armure : +' + d.armor.points, c: '#5555ff' });
  if (d && d.durability) lines.push({ t: 'Durabilité : ' + (d.durability - (s.dmg || 0)) + ' / ' + d.durability, c: '#aaa' });
  if (s.id === I.ender_eye) lines.push({ t: 'Clic droit pour le lancer vers le fort', c: '#aaa' });
  return lines;
}

// Insère une pile dans une liste d'emplacements ; renvoie le reste
function insertInto(stack, slots) {
  if (!stack) return null;
  const max = stackMax(stack);
  for (const sl of slots) {
    if (sl.output || (sl.accept && !sl.accept(stack))) continue;
    const cur = sl.get();
    if (cur && sameItem(cur, stack) && cur.count < Math.min(max, sl.max || 64)) {
      const n = Math.min(stack.count, Math.min(max, sl.max || 64) - cur.count);
      cur.count += n;
      stack.count -= n;
      sl.set(cur);
      if (stack.count <= 0) return null;
    }
  }
  for (const sl of slots) {
    if (sl.output || (sl.accept && !sl.accept(stack))) continue;
    if (!sl.get()) {
      const n = Math.min(stack.count, Math.min(max, sl.max || 64));
      sl.set(cloneStack(stack, n));
      stack.count -= n;
      if (stack.count <= 0) return null;
    }
  }
  return stack;
}

// ===================== Écran de base =====================
export class ContainerScreen {
  constructor(ui, title, cls = '') {
    this.ui = ui;
    this.game = ui.game;
    this.player = ui.game.player;
    this.inv = this.player.inventory;
    this.slots = [];
    this.root = el('div', 'panel container ' + cls);
    if (title) el('div', 'ptitle', this.root, title);
    this.dragSlots = null;
  }

  get cursor() { return this.ui.cursor; }
  set cursor(s) { this.ui.setCursor(s); }

  slot(parent, spec) {
    const div = el('div', 'slot' + (spec.cls ? ' ' + spec.cls : ''), parent);
    spec.el = div;
    if (spec.bg) div.style.setProperty('--bg', `url(${iconURL(spec.bg)})`), div.classList.add('hasbg');
    div.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.onDown(spec, e); });
    div.addEventListener('mouseenter', () => { this.hover = spec; this.onEnter(spec); });
    div.addEventListener('mouseleave', () => { if (this.hover === spec) this.hover = null; });
    div.addEventListener('dblclick', (e) => { e.preventDefault(); this.collect(spec); });
    this.slots.push(spec);
    return spec;
  }

  playerSlots(parent) {
    const main = el('div', 'grid g9', parent);
    this.mainSlots = [];
    for (let i = 9; i < 36; i++) {
      const k = i;
      this.mainSlots.push(this.slot(main, { group: 'main', get: () => this.inv.slots[k], set: (s) => { this.inv.slots[k] = s; } }));
    }
    const hb = el('div', 'grid g9 hotbarrow', parent);
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const k = i;
      this.hotSlots.push(this.slot(hb, { group: 'hotbar', index: k, get: () => this.inv.slots[k], set: (s) => { this.inv.slots[k] = s; } }));
    }
  }

  // ----- clics -----
  onDown(sl, e) {
    const shift = e.shiftKey;
    const right = e.button === 2;
    this.game.audio.ui('click');
    if (sl.output) { this.takeOutput(sl, shift); this.changed(); return; }
    if (shift) { this.quickMove(sl); this.changed(); return; }
    const cur = sl.get();
    const cs = this.cursor;
    if (cs && !cur && (e.button === 0 || right)) {
      // début de glisser-déposer
      this.dragSlots = { button: e.button, list: [sl] };
    }
    if (!right) {
      if (!cs) { if (cur) { this.cursor = cur; sl.set(null); } }
      else if (!cur) { if (!sl.accept || sl.accept(cs)) { const max = Math.min(stackMax(cs), sl.max || 64); const n = Math.min(cs.count, max); sl.set(cloneStack(cs, n)); cs.count -= n; this.cursor = cs.count > 0 ? cs : null; } }
      else if (sameItem(cur, cs)) {
        const max = Math.min(stackMax(cur), sl.max || 64);
        const n = Math.min(cs.count, max - cur.count);
        cur.count += n; cs.count -= n;
        sl.set(cur);
        this.cursor = cs.count > 0 ? cs : null;
      } else if (!sl.accept || sl.accept(cs)) { sl.set(cs); this.cursor = cur; }
    } else {
      if (!cs) { if (cur) { const h = Math.ceil(cur.count / 2); this.cursor = cloneStack(cur, h); cur.count -= h; sl.set(cur.count > 0 ? cur : null); } }
      else if (!cur) { if (!sl.accept || sl.accept(cs)) { sl.set(cloneStack(cs, 1)); cs.count--; this.cursor = cs.count > 0 ? cs : null; } }
      else if (sameItem(cur, cs) && cur.count < Math.min(stackMax(cur), sl.max || 64)) { cur.count++; cs.count--; sl.set(cur); this.cursor = cs.count > 0 ? cs : null; }
      else if (!sl.accept || sl.accept(cs)) { sl.set(cs); this.cursor = cur; }
    }
    this.changed();
  }

  onEnter(sl) {
    const d = this.dragSlots;
    if (!d || !this.ui.mouseDown) return;
    if (d.list.includes(sl)) return;
    const cs = this.cursor;
    if (!cs || sl.output || sl.get() || (sl.accept && !sl.accept(cs))) return;
    d.list.push(sl);
    if (d.button === 2) {
      sl.set(cloneStack(cs, 1));
      cs.count--;
      this.cursor = cs.count > 0 ? cs : null;
      if (!this.cursor) this.dragSlots = null;
      this.changed();
    }
  }

  onUp() {
    const d = this.dragSlots;
    this.dragSlots = null;
    if (!d || d.button !== 0 || d.list.length < 2) return;
    // répartition égale : la 1re case a déjà reçu toute la pile
    const first = d.list[0];
    const s = first.get();
    if (!s) return;
    const total = s.count + (this.cursor && sameItem(this.cursor, s) ? this.cursor.count : 0);
    const per = Math.floor(total / d.list.length);
    if (per < 1) return;
    let left = total;
    for (const sl of d.list) {
      sl.set(cloneStack(s, per));
      left -= per;
    }
    this.cursor = left > 0 ? cloneStack(s, left) : null;
    this.changed();
  }

  collect(sl) {
    const cs = this.cursor;
    if (!cs) return;
    const max = stackMax(cs);
    for (const o of this.slots) {
      if (o.output || cs.count >= max) continue;
      const s = o.get();
      if (s && sameItem(s, cs)) {
        const n = Math.min(s.count, max - cs.count);
        cs.count += n; s.count -= n;
        o.set(s.count > 0 ? s : null);
      }
    }
    this.cursor = cs;
    this.changed();
  }

  // Touche numérique sur une case survolée : échange avec la barre d'action
  numberKey(n) {
    const sl = this.hover;
    if (!sl || sl.output) return false;
    const a = sl.get(), b = this.inv.slots[n];
    if (sl.accept && b && !sl.accept(b)) return true;
    sl.set(b);
    this.inv.slots[n] = a;
    this.changed();
    return true;
  }

  dropHovered(all) {
    const sl = this.hover;
    if (!sl || sl.output) return;
    const s = sl.get();
    if (!s) return;
    const n = all ? s.count : 1;
    this.game.interaction.throwStack(cloneStack(s, n));
    s.count -= n;
    sl.set(s.count > 0 ? s : null);
    this.changed();
  }

  targetsFor(sl) {
    // cible par défaut : conteneur <-> inventaire
    const cont = this.slots.filter((s) => s.group === 'container');
    if (sl.group === 'container' || sl.group === 'craft' || sl.group === 'armor') return [...this.mainSlots, ...this.hotSlots];
    if (cont.length) return cont;
    return sl.group === 'hotbar' ? this.mainSlots : this.hotSlots;
  }

  quickMove(sl) {
    const s = sl.get();
    if (!s) return;
    // armure
    const d = ITEMS[s.id];
    if ((sl.group === 'main' || sl.group === 'hotbar') && d && d.armor && this.armorSlots) {
      const a = this.armorSlots[d.armor.slot];
      if (!a.get()) { a.set(s); sl.set(null); return; }
    }
    const rest = insertInto(cloneStack(s), this.targetsFor(sl));
    sl.set(rest && rest.count > 0 ? rest : null);
  }

  takeOutput(sl, shift) {
    const s = sl.get();
    if (!s) return;
    if (shift) {
      const copy = cloneStack(s);
      const rest = insertInto(copy, [...this.mainSlots, ...this.hotSlots]);
      const moved = s.count - (rest ? rest.count : 0);
      if (moved <= 0) return;
      if (moved === s.count) { sl.onTake && sl.onTake(cloneStack(s)); }
      else { s.count -= moved; sl.set(s); }
      return;
    }
    const cs = this.cursor;
    if (!cs) { this.cursor = cloneStack(s); sl.onTake && sl.onTake(s); }
    else if (sameItem(cs, s) && cs.count + s.count <= stackMax(cs)) { cs.count += s.count; this.cursor = cs; sl.onTake && sl.onTake(s); }
  }

  changed() {
    this.inv.changed();
    this.onChange && this.onChange();
    this.render();
  }

  render() {
    for (const sl of this.slots) renderSlot(sl.el, sl.get());
    this.renderExtra && this.renderExtra();
  }

  tick() {
    this.tickExtra && this.tickExtra();
    this.render();
  }

  close() {
    this.onClose && this.onClose();
  }
}

// ===================== Livre de recettes =====================
function buildRecipeBook(screen, parent, gridW) {
  const box = el('div', 'recipebook', parent);
  const head = el('div', 'rbhead', box);
  const search = el('input', 'rbsearch', head);
  search.placeholder = 'Rechercher...';
  const lab = el('label', 'rbfilter', head);
  const cb = el('input', '', lab);
  cb.type = 'checkbox';
  el('span', '', lab, ' Réalisables');
  const list = el('div', 'rblist', box);
  const info = el('div', 'rbinfo', box, 'Cliquez sur une recette pour la placer.');
  search.addEventListener('keydown', (e) => e.stopPropagation());
  const fits = (r) => (r.type === 'shaped' ? r.w <= gridW && r.h <= gridW : r.ingredients.length <= gridW * gridW);
  const inv = screen.inv;
  const counts = () => {
    const m = new Map();
    for (const s of inv.slots) if (s) m.set(s.id, (m.get(s.id) || 0) + s.count);
    for (const s of screen.grid) if (s) m.set(s.id, (m.get(s.id) || 0) + s.count);
    return m;
  };
  const craftable = (r, m) => {
    for (const ing of recipeIngredients(r)) {
      let have = 0;
      for (const id of ing.ids) have += m.get(id) || 0;
      if (have < ing.count) return false;
    }
    return true;
  };
  const seen = new Set();
  const all = RECIPES.filter((r) => {
    if (!fits(r)) return false;
    const k = r.result.id + '|' + JSON.stringify(r.pattern || r.ingredients);
    if (seen.has(k)) return false;
    seen.add(k);
    return ITEMS[r.result.id] && !ITEMS[r.result.id].hidden || r.result.id === I.door_item || r.result.id === I.bed_item || r.result.id === I.cake_item;
  });
  const refresh = () => {
    list.innerHTML = '';
    const m = counts();
    const q = search.value.trim().toLowerCase();
    const items = all.map((r) => ({ r, ok: craftable(r, m) })).filter(({ r, ok }) => (!cb.checked || ok) && (!q || (ITEMS[r.result.id].name || '').toLowerCase().includes(q)));
    items.sort((a, b) => (b.ok - a.ok));
    for (const { r, ok } of items.slice(0, 200)) {
      const d = el('div', 'slot rbitem' + (ok ? '' : ' missing'), list);
      renderSlot(d, { id: r.result.id, count: r.result.count });
      d.title = ITEMS[r.result.id].name;
      d.addEventListener('mouseenter', () => {
        info.textContent = ITEMS[r.result.id].name + ' : ' + recipeIngredients(r).map((g) => g.count + '× ' + (ITEMS[g.ids[0]] ? ITEMS[g.ids[0]].name : '?') + (g.ids.length > 1 ? ' (au choix)' : '')).join(', ');
      });
      d.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); screen.placeRecipe(r); refresh(); });
    }
  };
  search.addEventListener('input', refresh);
  cb.addEventListener('change', refresh);
  refresh();
  return { refresh, box };
}

// ===================== Inventaire / table de craft =====================
export class CraftingScreen extends ContainerScreen {
  constructor(ui, size, title) {
    super(ui, title, 'crafting' + size);
    this.size = size;
    this.grid = new Array(size * size).fill(null);
    const top = el('div', 'row', this.root);
    if (size === 2) {
      // armure
      const arm = el('div', 'col armorcol', top);
      this.armorSlots = [];
      const bgs = [I.iron_helmet, I.iron_chestplate, I.iron_leggings, I.iron_boots];
      for (let i = 0; i < 4; i++) {
        const k = i;
        this.armorSlots.push(this.slot(arm, {
          group: 'armor', cls: 'armorslot', max: 1,
          get: () => this.inv.armor[k], set: (s) => { this.inv.armor[k] = s; this.game.onArmorChange?.(); },
          accept: (s) => { const d = ITEMS[s.id]; return (d && d.armor && d.armor.slot === k) || (k === 0 && (s.id === B.pumpkin)); },
        }));
        this.armorSlots[i].el.dataset.hint = ['Casque', 'Plastron', 'Jambières', 'Bottes'][i];
      }
      const pv = el('div', 'playerview', top);
      const p = this.player;
      el('div', 'pvname', pv, 'Niveau ' + p.xpLevel);
      el('div', 'pvstat', pv, '❤ ' + Math.ceil(p.health) + '/' + p.maxHealth);
      el('div', 'pvstat', pv, '🍗 ' + p.food + '/20');
      el('div', 'pvstat', pv, '🛡 ' + p.armorValue());
    }
    const cg = el('div', 'craftarea', top);
    el('div', 'clabel', cg, 'Artisanat');
    const row = el('div', 'row center', cg);
    const g = el('div', 'grid g' + size, row);
    for (let i = 0; i < size * size; i++) {
      const k = i;
      this.slot(g, { group: 'craft', get: () => this.grid[k], set: (s) => { this.grid[k] = s; this.updateResult(); } });
    }
    el('div', 'arrow', row, '➜');
    this.result = null;
    this.resultSlot = this.slot(row, {
      group: 'result', output: true, cls: 'big', repeat: true,
      get: () => this.result, set: () => {},
      onTake: () => this.consume(),
    });
    this.playerSlots(this.root);
    this.book = buildRecipeBook(this, this.root, size);
    this.updateResult();
  }

  onChange() {
    if (this.book) this.book.refresh();
  }

  updateResult() {
    const ids = this.grid.map((s) => (s ? s.id : 0));
    const r = findRecipe(ids, this.size, this.size);
    this.recipe = r;
    this.result = r ? { id: r.result.id, count: r.result.count } : null;
    if (this.result && this.result.id === I.cake_item) this.result.count = 1;
    // livre enchanté + objet
    if (!r) {
      const items = this.grid.filter(Boolean);
      if (items.length === 2) {
        const book = items.find((s) => s.id === I.enchanted_book), it = items.find((s) => s.id !== I.enchanted_book);
        if (book && it && ITEMS[it.id].ench) {
          const res = applyBook(it, book);
          if (res) { this.result = { ...res, count: 1 }; this.recipe = { special: 'book' }; }
        }
      }
    }
  }

  consume() {
    const r = this.result;
    for (let i = 0; i < this.grid.length; i++) {
      const s = this.grid[i];
      if (!s) continue;
      // seaux rendus
      let back = null;
      if (s.id === I.milk_bucket || s.id === I.water_bucket || s.id === I.lava_bucket) back = { id: I.bucket, count: 1 };
      s.count--;
      this.grid[i] = s.count > 0 ? s : back;
    }
    if (r) this.game.onCraft?.(r.id, r.count);
    this.updateResult();
  }

  takeOutput(sl, shift) {
    if (!this.result) return;
    if (shift) {
      for (let k = 0; k < 64 && this.result; k++) {
        const copy = cloneStack(this.result);
        const rest = insertInto(copy, [...this.hotSlots, ...this.mainSlots]);
        if (rest && rest.count > 0) {
          // rendre ce qui n'a pas pu entrer
          if (rest.count < this.result.count) { this.consume(); this.game.world.dropItem(this.player.x, this.player.y + 1, this.player.z, rest); }
          break;
        }
        this.consume();
      }
      return;
    }
    super.takeOutput(sl, false);
  }

  placeRecipe(r) {
    // rendre la grille à l'inventaire
    for (let i = 0; i < this.grid.length; i++) if (this.grid[i]) { const left = this.inv.add(this.grid[i]); if (left > 0) this.game.world.dropItem(this.player.x, this.player.y + 1, this.player.z, cloneStack(this.grid[i], left)); this.grid[i] = null; }
    const take = (key) => {
      const ids = Array.isArray(key) ? key : [key];
      for (const id of ids) {
        const k = this.inv.findSlot((s) => s.id === id && !s.ench);
        if (k >= 0) { const s = this.inv.slots[k]; s.count--; if (s.count <= 0) this.inv.slots[k] = null; return { id, count: 1 }; }
      }
      return null;
    };
    let ok = true;
    if (r.type === 'shaped') {
      for (let y = 0; y < r.h; y++)
        for (let x = 0; x < r.w; x++) {
          const ch = r.pattern[y][x];
          if (ch === ' ') continue;
          const got = take(r.key[ch]);
          if (!got) { ok = false; continue; }
          this.grid[y * this.size + x] = got;
        }
    } else {
      r.ingredients.forEach((ing, i) => {
        const got = take(ing);
        if (!got) { ok = false; return; }
        this.grid[i] = got;
      });
    }
    if (!ok && !this.player.creative) this.ui.chat('Ingrédients manquants pour ' + ITEMS[r.result.id].name, '#f88');
    this.updateResult();
    this.changed();
  }

  targetsFor(sl) {
    if (sl.group === 'craft' || sl.group === 'armor') return [...this.mainSlots, ...this.hotSlots];
    if (sl.group === 'hotbar') return this.mainSlots;
    return this.hotSlots;
  }

  onClose() {
    for (let i = 0; i < this.grid.length; i++) {
      if (!this.grid[i]) continue;
      const left = this.inv.add(this.grid[i]);
      if (left > 0) this.game.world.dropItem(this.player.x, this.player.y + 1, this.player.z, cloneStack(this.grid[i], left));
      this.grid[i] = null;
    }
  }
}

// ===================== Coffre =====================
export class ChestScreen extends ContainerScreen {
  constructor(ui, be, pos, title) {
    super(ui, title || 'Coffre', 'chest');
    this.be = be;
    this.pos = pos;
    const g = el('div', 'grid g9', this.root);
    for (let i = 0; i < be.items.length; i++) {
      const k = i;
      this.slot(g, { group: 'container', get: () => be.items[k], set: (s) => { be.items[k] = s; this.markModified(); } });
    }
    el('div', 'clabel', this.root, 'Inventaire');
    this.playerSlots(this.root);
  }
  markModified() {
    if (!this.pos) return;
    const c = this.game.world.getChunk(this.pos.x >> 4, this.pos.z >> 4);
    if (c) c.modified = true;
  }
  onClose() {
    if (this.pos) this.game.world.playSound('chest_close', this.pos.x + 0.5, this.pos.y + 0.5, this.pos.z + 0.5, 0.6);
  }
}

// ===================== Four =====================
export class FurnaceScreen extends ContainerScreen {
  constructor(ui, be, pos) {
    super(ui, 'Four', 'furnace');
    this.be = be;
    this.pos = pos;
    const row = el('div', 'row center furnacerow', this.root);
    const col = el('div', 'col', row);
    this.inputSlot = this.slot(col, { group: 'container', get: () => be.items[0], set: (s) => { be.items[0] = s; }, accept: () => true });
    this.flame = el('div', 'flame', col);
    this.fuelSlot = this.slot(col, { group: 'container', get: () => be.items[1], set: (s) => { be.items[1] = s; }, accept: (s) => fuelValue(s.id) > 0 });
    this.arrow = el('div', 'progress', row);
    el('div', 'fill', this.arrow);
    this.outSlot = this.slot(row, {
      group: 'container', output: true, cls: 'big', get: () => be.items[2], set: (s) => { be.items[2] = s; },
      onTake: (s) => {
        be.items[2] = null;
        if (be.xp >= 1) { this.game.world.dropXp(this.player.x, this.player.y + 0.5, this.player.z, Math.floor(be.xp)); be.xp -= Math.floor(be.xp); }
        this.game.onSmelt?.(s.id, s.count);
      },
    });
    el('div', 'clabel', this.root, 'Inventaire');
    this.playerSlots(this.root);
  }
  targetsFor(sl) {
    if (sl.group === 'container') return [...this.mainSlots, ...this.hotSlots];
    const s = sl.get();
    if (s && SMELTING.has(s.id)) return [this.inputSlot];
    if (s && fuelValue(s.id) > 0) return [this.fuelSlot];
    return sl.group === 'hotbar' ? this.mainSlots : this.hotSlots;
  }
  renderExtra() {
    const be = this.be;
    const f = be.burn > 0 ? be.burn / (be.burnMax || 1) : 0;
    this.flame.style.setProperty('--f', f);
    this.flame.classList.toggle('on', be.burn > 0);
    this.arrow.firstChild.style.width = ((be.cook || 0) / 200) * 100 + '%';
  }
}

// ===================== Alambic =====================
export class BrewingScreen extends ContainerScreen {
  constructor(ui, be) {
    super(ui, 'Alambic', 'brewing');
    this.be = be;
    const top = el('div', 'row center', this.root);
    this.fuel = this.slot(top, { group: 'container', get: () => be.items[4], set: (s) => { be.items[4] = s; }, accept: (s) => s.id === I.blaze_powder, bg: I.blaze_powder });
    this.ing = this.slot(top, { group: 'container', get: () => be.items[3], set: (s) => { be.items[3] = s; }, accept: (s) => [I.nether_wart, I.ghast_tear, I.magma_cream, I.blaze_powder, I.sugar, I.golden_apple, I.melon_slice, I.glowstone_dust].includes(s.id) });
    this.bar = el('div', 'progress vertical', top);
    el('div', 'fill', this.bar);
    this.fuelInfo = el('div', 'clabel', top, '');
    const bot = el('div', 'row center', this.root);
    this.bottles = [0, 1, 2].map((i) => this.slot(bot, { group: 'container', max: 1, get: () => be.items[i], set: (s) => { be.items[i] = s; }, accept: (s) => s.id === I.potion || s.id === I.glass_bottle }));
    el('div', 'hint', this.root, 'Fiole d\'eau + verrue du Nether = potion étrange, puis ajoutez : larme de Ghast (régénération), crème de magma (résistance au feu), poudre de Blaze (force), sucre (rapidité), tranche de pastèque (soin), pomme dorée (vision nocturne). Carburant : poudre de Blaze.');
    this.playerSlots(this.root);
  }
  targetsFor(sl) {
    if (sl.group === 'container') return [...this.mainSlots, ...this.hotSlots];
    const s = sl.get();
    if (!s) return [];
    if (s.id === I.blaze_powder) return [this.fuel, this.ing];
    if (s.id === I.potion || s.id === I.glass_bottle) return this.bottles;
    return [this.ing];
  }
  renderExtra() {
    this.bar.firstChild.style.height = ((this.be.brew || 0) / 400) * 100 + '%';
    this.fuelInfo.textContent = 'Carburant : ' + (this.be.fuel || 0);
  }
}

// ===================== Enchantement =====================
export class EnchantScreen extends ContainerScreen {
  constructor(ui, pos) {
    super(ui, 'Enchanter', 'enchanting');
    this.pos = pos;
    this.item = null;
    this.lapis = null;
    const row = el('div', 'row', this.root);
    const col = el('div', 'col', row);
    const r2 = el('div', 'row', col);
    this.itemSlot = this.slot(r2, { group: 'container', max: 1, get: () => this.item, set: (s) => { this.item = s; this.refresh(); }, accept: (s) => isEnchantable(s) });
    this.lapisSlot = this.slot(r2, { group: 'container', get: () => this.lapis, set: (s) => { this.lapis = s; this.refresh(); }, accept: (s) => s.id === I.lapis_lazuli, bg: I.lapis_lazuli });
    this.opts = el('div', 'col enchopts', row);
    this.shelves = this.countShelves();
    el('div', 'hint', this.root, 'Bibliothèques autour de la table : ' + this.shelves + ' / 15 (plus il y en a, plus les enchantements sont puissants).');
    this.playerSlots(this.root);
    this.refresh();
  }
  countShelves() {
    const w = this.game.world;
    const { x, y, z } = this.pos;
    let n = 0;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) < 2 && Math.abs(dz) < 2) continue;
        for (let dy = 0; dy <= 1; dy++) if (w.getBlock(x + dx, y + dy, z + dz) === B.bookshelf) n++;
      }
    return n;
  }
  targetsFor(sl) {
    if (sl.group === 'container') return [...this.mainSlots, ...this.hotSlots];
    const s = sl.get();
    if (s && s.id === I.lapis_lazuli) return [this.lapisSlot];
    return [this.itemSlot];
  }
  refresh() {
    if (!this.opts) return;
    this.opts.innerHTML = '';
    const p = this.player;
    if (!p.enchantSeed) p.enchantSeed = Math.floor(Math.random() * 1e9);
    const costs = enchantCosts(this.shelves, p.enchantSeed);
    for (let i = 0; i < 3; i++) {
      const b = el('button', 'enchopt', this.opts);
      if (!this.item) { b.disabled = true; b.textContent = '—'; continue; }
      const cost = costs[i];
      let s = p.enchantSeed + i * 7919;
      const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
      const ench = rollEnchants(this.item.id, cost, rnd);
      const first = Object.entries(ench)[0];
      const lapisOk = p.creative || (this.lapis && this.lapis.count >= i + 1);
      const lvlOk = p.creative || p.xpLevel >= cost;
      b.innerHTML = `<span class="lvl">${cost}</span> ${first ? enchantLabel(first[0], first[1]) + ' ...?' : '?'} <span class="lap">${i + 1} lapis</span>`;
      b.disabled = !(lapisOk && lvlOk && first);
      b.addEventListener('mousedown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (b.disabled) return;
        const it = this.item;
        this.item = it.id === I.book ? { id: I.enchanted_book, count: 1, ench } : { ...it, ench };
        if (!p.creative) {
          this.lapis.count -= i + 1;
          if (this.lapis.count <= 0) this.lapis = null;
          p.removeLevels(i + 1);
        }
        p.enchantSeed = Math.floor(Math.random() * 1e9);
        this.game.world.playSound('enchant', this.pos.x + 0.5, this.pos.y + 1, this.pos.z + 0.5);
        this.game.particles.spawnBurst(this.game.world, 'enchant', this.pos.x + 0.5, this.pos.y + 1.5, this.pos.z + 0.5, 20, 0.8, 0.05);
        this.game.onEnchant?.();
        this.refresh();
        this.changed();
      });
    }
  }
  onClose() {
    for (const k of ['item', 'lapis']) {
      if (this[k]) { const left = this.inv.add(this[k]); if (left > 0) this.game.world.dropItem(this.player.x, this.player.y + 1, this.player.z, cloneStack(this[k], left)); this[k] = null; }
    }
  }
}

// ===================== Commerce =====================
export class TradeScreen extends ContainerScreen {
  constructor(ui, villager) {
    super(ui, 'Villageois — ' + (PROFESSION_NAMES[villager.profession] || ''), 'trading');
    this.v = villager;
    villager.trading = true;
    this.list = el('div', 'col trades', this.root);
    el('div', 'clabel', this.root, 'Inventaire');
    this.playerSlots(this.root);
    this.buildTrades();
  }
  buildTrades() {
    this.list.innerHTML = '';
    for (const t of this.v.trades) {
      const row = el('div', 'trade' + (t.uses >= t.max ? ' out' : ''), this.list);
      const a = el('div', 'slot small', row);
      renderSlot(a, { id: t.buy[0], count: t.buy[1] });
      el('span', 'arrow', row, '➜');
      const b = el('div', 'slot small', row);
      renderSlot(b, { id: t.sell[0], count: t.sell[1], ench: t.enchanted ? { x: 1 } : undefined });
      el('span', 'tname', row, ITEMS[t.sell[0]].name);
      const btn = el('button', 'tbtn', row, t.uses >= t.max ? 'Épuisé' : 'Échanger');
      const has = this.inv.count(t.buy[0]) >= t.buy[1] || this.player.creative;
      btn.disabled = t.uses >= t.max || !has;
      btn.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        if (btn.disabled) return;
        if (!this.player.creative) this.inv.remove(t.buy[0], t.buy[1]);
        let out = { id: t.sell[0], count: t.sell[1] };
        if (t.enchanted) out = randomBook(out);
        const left = this.inv.add(out);
        if (left > 0) this.game.world.dropItem(this.player.x, this.player.y + 1, this.player.z, cloneStack(out, left));
        t.uses++;
        this.game.world.dropXp(this.v.x, this.v.y + 1, this.v.z, 3 + Math.floor(Math.random() * 4));
        this.game.world.playSound('villager', this.v.x, this.v.y + 1, this.v.z);
        this.game.onTrade?.();
        this.buildTrades();
        this.changed();
      });
    }
  }
  onChange() { this.buildTrades(); }
  onClose() { this.v.trading = false; }
}

// ===================== Créatif =====================
const CATS = [
  ['Tout', () => true],
  ['Blocs', (d) => d.block && BLOCKS[d.id] && BLOCKS[d.id].render === 'cube' && !BLOCKS[d.id].plant],
  ['Déco', (d) => d.block && BLOCKS[d.id] && BLOCKS[d.id].render !== 'cube' || d.id === I.bed_item || d.id === I.door_item],
  ['Outils', (d) => !!d.tool || d.use === 'bucket' || d.use === 'ignite' || [I.compass, I.clock, I.shears, I.ender_eye, I.ender_pearl].includes(d.id)],
  ['Combat', (d) => !!d.armor || d.id === I.bow || d.id === I.arrow || (d.tool && d.tool.type === 'sword')],
  ['Nourriture', (d) => !!d.food || d.id === I.cake_item],
  ['Matériaux', (d) => !d.block && !d.tool && !d.armor && !d.food && d.use !== 'spawn_egg'],
  ['Œufs', (d) => d.use === 'spawn_egg'],
];

export class CreativeScreen extends ContainerScreen {
  constructor(ui) {
    super(ui, 'Inventaire créatif', 'creative');
    this.cat = 0;
    const tabs = el('div', 'tabs', this.root);
    CATS.forEach(([name], i) => {
      const t = el('button', 'tab' + (i === 0 ? ' sel' : ''), tabs, name);
      t.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.cat = i; [...tabs.children].forEach((c, j) => c.classList.toggle('sel', j === i)); this.fill(); });
    });
    const sw = el('button', 'tab', tabs, 'Inventaire ▸');
    sw.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); this.ui.openInventory(true); });
    this.search = el('input', 'csearch', this.root);
    this.search.placeholder = 'Rechercher un objet...';
    this.search.addEventListener('input', () => this.fill());
    this.search.addEventListener('keydown', (e) => e.stopPropagation());
    this.gridEl = el('div', 'grid g9 cgrid', this.root);
    const bottom = el('div', 'row', this.root);
    const hb = el('div', 'grid g9 hotbarrow', bottom);
    this.hotSlots = [];
    for (let i = 0; i < 9; i++) {
      const k = i;
      this.hotSlots.push(this.slot(hb, { group: 'hotbar', get: () => this.inv.slots[k], set: (s) => { this.inv.slots[k] = s; } }));
    }
    this.mainSlots = [];
    const trash = el('div', 'slot trash', bottom, '🗑');
    trash.title = 'Supprimer';
    trash.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); if (e.shiftKey) { this.inv.slots.fill(null); } this.cursor = null; this.changed(); });
    this.fill();
  }
  fill() {
    this.gridEl.innerHTML = '';
    const q = this.search.value.trim().toLowerCase();
    const pred = CATS[this.cat][1];
    const list = [];
    for (const d of ITEMS) {
      if (!d || d.id === 0) continue;
      if (d.hidden && !d.creativeOnly && ![I.bed_item, I.door_item].includes(d.id)) continue;
      if (BLOCKS[d.id] && BLOCKS[d.id].hidden) continue;
      if (!pred(d)) continue;
      if (q && !d.name.toLowerCase().includes(q) && !d.key.includes(q)) continue;
      list.push(d);
    }
    for (const d of list) {
      const div = el('div', 'slot', this.gridEl);
      const st = { id: d.id, count: 1 };
      renderSlot(div, st);
      div.addEventListener('mouseenter', () => { this.hoverItem = st; this.ui.showTooltip(st); });
      div.addEventListener('mouseleave', () => { this.hoverItem = null; this.ui.showTooltip(null); });
      div.addEventListener('mousedown', (e) => {
        e.preventDefault(); e.stopPropagation();
        this.game.audio.ui('click');
        if (this.cursor) { this.cursor = null; return; }
        const n = e.button === 2 ? 1 : d.stack;
        if (e.shiftKey) { this.inv.add({ id: d.id, count: d.stack }); this.changed(); return; }
        this.cursor = { id: d.id, count: n };
      });
    }
  }
  targetsFor() {
    return this.hotSlots;
  }
}
