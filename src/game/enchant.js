// Enchantements
import { ITEMS } from '../data/items.js';
import { I, B } from '../data/ids.js';

export const ENCHANTS = {
  efficiency: { name: 'Efficacité', max: 5, types: ['tool'], weight: 10 },
  unbreaking: { name: 'Solidité', max: 3, types: ['tool', 'sword', 'armor', 'bow'], weight: 5 },
  fortune: { name: 'Fortune', max: 3, types: ['tool'], weight: 2, conflicts: ['silk_touch'] },
  silk_touch: { name: 'Toucher de soie', max: 1, types: ['tool'], weight: 1, conflicts: ['fortune'] },
  sharpness: { name: 'Tranchant', max: 5, types: ['sword'], weight: 10, conflicts: ['smite', 'bane_of_arthropods'] },
  smite: { name: 'Châtiment', max: 5, types: ['sword'], weight: 5, conflicts: ['sharpness', 'bane_of_arthropods'] },
  bane_of_arthropods: { name: 'Fléau des arthropodes', max: 5, types: ['sword'], weight: 5, conflicts: ['sharpness', 'smite'] },
  knockback: { name: 'Recul', max: 2, types: ['sword'], weight: 5 },
  fire_aspect: { name: 'Aura de feu', max: 2, types: ['sword'], weight: 2 },
  looting: { name: 'Butin', max: 3, types: ['sword'], weight: 2 },
  protection: { name: 'Protection', max: 4, types: ['armor'], weight: 10 },
  fire_protection: { name: 'Protection contre le feu', max: 4, types: ['armor'], weight: 5 },
  blast_protection: { name: 'Protection contre les explosions', max: 4, types: ['armor'], weight: 2 },
  projectile_protection: { name: 'Protection contre les projectiles', max: 4, types: ['armor'], weight: 5 },
  feather_falling: { name: 'Chute amortie', max: 4, types: ['boots'], weight: 5 },
  aqua_affinity: { name: 'Affinité aquatique', max: 1, types: ['helmet'], weight: 2 },
  power: { name: 'Puissance', max: 5, types: ['bow'], weight: 10 },
  punch: { name: 'Frappe', max: 2, types: ['bow'], weight: 2 },
  flame: { name: 'Flamme', max: 1, types: ['bow'], weight: 2 },
  infinity: { name: 'Infinité', max: 1, types: ['bow'], weight: 1 },
};

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];
export function enchantLabel(id, lvl) {
  const e = ENCHANTS[id];
  if (!e) return id;
  return e.name + (e.max > 1 ? ' ' + ROMAN[lvl] : '');
}

// Catégorie d'enchantement d'un objet
export function enchantTypes(id) {
  const d = ITEMS[id];
  if (!d) return [];
  if (id === I.book || id === I.enchanted_book) return ['tool', 'sword', 'armor', 'bow', 'boots', 'helmet'];
  if (d.enchType === 'tool') return ['tool'];
  if (d.enchType === 'sword') return ['sword'];
  if (d.enchType === 'bow') return ['bow'];
  if (d.enchType === 'armor') {
    const r = ['armor'];
    if (d.armor.slot === 3) r.push('boots');
    if (d.armor.slot === 0) r.push('helmet');
    return r;
  }
  return [];
}

export function isEnchantable(stack) {
  if (!stack) return false;
  if (stack.id === I.book) return true;
  const d = ITEMS[stack.id];
  return !!(d && d.ench && !stack.ench);
}

function candidates(id) {
  const types = enchantTypes(id);
  return Object.entries(ENCHANTS).filter(([, e]) => e.types.some((t) => types.includes(t)));
}

// Tire des enchantements pour un niveau donné (1..30)
export function rollEnchants(id, level, rnd = Math.random) {
  const d = ITEMS[id];
  const ench = (d && d.ench) || 1;
  let L = level + 1 + Math.floor(rnd() * (ench / 4 + 1)) + Math.floor(rnd() * (ench / 4 + 1));
  L = Math.max(1, Math.round(L * (1 + (rnd() + rnd() - 1) * 0.15)));
  const pool = candidates(id);
  const out = {};
  const pickOne = () => {
    const avail = pool.filter(([k, e]) => !out[k] && !(e.conflicts || []).some((c) => out[c]));
    if (!avail.length) return false;
    const total = avail.reduce((s, [, e]) => s + e.weight, 0);
    let r = rnd() * total;
    for (const [k, e] of avail) {
      r -= e.weight;
      if (r <= 0) {
        out[k] = Math.max(1, Math.min(e.max, Math.ceil((L / 30) * e.max + rnd() * 0.5)));
        return true;
      }
    }
    return false;
  };
  pickOne();
  let chance = (L + 1) / 50;
  while (rnd() < chance && pickOne()) chance /= 2;
  if (id === I.book && Object.keys(out).length > 1) {
    const k = Object.keys(out)[0];
    return { [k]: out[k] };
  }
  return out;
}

// Coûts des 3 options de la table d'enchantement
export function enchantCosts(bookshelves, seed) {
  let s = seed;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const b = Math.min(15, bookshelves);
  const base = 1 + Math.floor(rnd() * 8) + Math.floor(b / 2) + Math.floor(rnd() * (b + 1));
  return [Math.max(1, Math.floor(base / 3)), Math.floor((base * 2) / 3) + 1, Math.max(base, b * 2)];
}

// Livre enchanté aléatoire (butin)
export function randomBook(stack, rnd = Math.random) {
  const keys = Object.keys(ENCHANTS);
  const k = keys[Math.floor(rnd() * keys.length)];
  const lvl = 1 + Math.floor(rnd() * ENCHANTS[k].max);
  return { id: I.enchanted_book, count: 1, ench: { [k]: lvl } };
}

// Applique un livre enchanté sur un objet (fusion dans la grille d'artisanat)
export function applyBook(item, book) {
  const types = enchantTypes(item.id);
  const res = { ...item, ench: { ...(item.ench || {}) } };
  let applied = false;
  for (const [k, lvl] of Object.entries(book.ench || {})) {
    const e = ENCHANTS[k];
    if (!e || !e.types.some((t) => types.includes(t))) continue;
    if ((e.conflicts || []).some((c) => res.ench[c])) continue;
    const cur = res.ench[k] || 0;
    res.ench[k] = cur === lvl ? Math.min(e.max, lvl + 1) : Math.max(cur, lvl);
    applied = true;
  }
  return applied ? res : null;
}

void B;
