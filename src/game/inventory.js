// Inventaire et piles d'objets
import { ITEMS, maxStack } from '../data/items.js';

export function stackMax(s) {
  if (!s) return 64;
  return maxStack(s.id);
}

export function sameItem(a, b) {
  if (!a || !b) return false;
  if (a.id !== b.id) return false;
  if ((a.dmg || 0) !== (b.dmg || 0)) return false;
  if (JSON.stringify(a.ench || null) !== JSON.stringify(b.ench || null)) return false;
  if ((a.potion || null) !== (b.potion || null)) return false;
  if ((a.name || null) !== (b.name || null)) return false;
  return true;
}

export function cloneStack(s, count) {
  if (!s) return null;
  const c = { ...s };
  if (s.ench) c.ench = { ...s.ench };
  if (count !== undefined) c.count = count;
  return c;
}

export function durability(s) {
  const d = s && ITEMS[s.id];
  return d && d.durability ? d.durability : 0;
}

export class Inventory {
  constructor(size = 36) {
    this.slots = new Array(size).fill(null);
    this.armor = new Array(4).fill(null);
    this.offhand = null;
    this.sel = 0;
    this.onChange = null;
  }

  selected() {
    return this.slots[this.sel];
  }

  setSelected(s) {
    this.slots[this.sel] = s;
    this.changed();
  }

  changed() {
    if (this.onChange) this.onChange();
  }

  // Ajoute une pile ; renvoie le nombre restant
  add(stack) {
    if (!stack || stack.count <= 0) return 0;
    let left = stack.count;
    const max = stackMax(stack);
    // fusion (barre d'accès rapide d'abord)
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      const s = this.slots[i];
      if (s && sameItem(s, stack) && s.count < max) {
        const n = Math.min(left, max - s.count);
        s.count += n;
        left -= n;
      }
    }
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (!this.slots[i]) {
        const n = Math.min(left, max);
        this.slots[i] = cloneStack(stack, n);
        left -= n;
      }
    }
    if (left !== stack.count) this.changed();
    return left;
  }

  count(id) {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    if (this.offhand && this.offhand.id === id) n += this.offhand.count;
    return n;
  }

  has(id, n = 1) {
    return this.count(id) >= n;
  }

  // Retire n objets ; renvoie le nombre retiré
  remove(id, n = 1, pred) {
    let left = n;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (s && s.id === id && (!pred || pred(s))) {
        const k = Math.min(left, s.count);
        s.count -= k;
        left -= k;
        if (s.count <= 0) this.slots[i] = null;
      }
    }
    if (left !== n) this.changed();
    return n - left;
  }

  findSlot(pred) {
    for (let i = 0; i < this.slots.length; i++) if (this.slots[i] && pred(this.slots[i])) return i;
    return -1;
  }

  consumeSelected(n = 1) {
    const s = this.selected();
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.sel] = null;
    this.changed();
  }

  armorPoints() {
    let a = 0;
    for (const s of this.armor) if (s && ITEMS[s.id] && ITEMS[s.id].armor) a += ITEMS[s.id].armor.points;
    return a;
  }

  clear() {
    this.slots.fill(null);
    this.armor.fill(null);
    this.offhand = null;
    this.changed();
  }

  serialize() {
    return { slots: this.slots, armor: this.armor, offhand: this.offhand, sel: this.sel };
  }

  load(d) {
    if (!d) return;
    this.slots = d.slots.map((s) => (s ? { ...s } : null));
    while (this.slots.length < 36) this.slots.push(null);
    this.armor = (d.armor || [null, null, null, null]).map((s) => (s ? { ...s } : null));
    this.offhand = d.offhand || null;
    this.sel = d.sel || 0;
  }
}
