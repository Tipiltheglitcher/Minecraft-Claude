// Génération des icônes d'objets pour l'interface (canvas 2D)
import { texPainters } from '../gfx/textures.js';
import { BLOCKS, RENDER, R_CUBE } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { B, I } from '../data/ids.js';
import { POTIONS } from '../world/updates.js';

const texCanvases = new Map();
const iconCache = new Map();
const SIZE = 48;

function texCanvas(name, tint) {
  const key = name + (tint ? '|' + tint.join(',') : '');
  let c = texCanvases.get(key);
  if (c) return c;
  const p = texPainters.get(name) || texPainters.get('stone');
  c = document.createElement('canvas');
  c.width = c.height = p.size;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const img = ctx.createImageData(p.size, p.size);
  img.data.set(p.data);
  if (tint) {
    for (let i = 0; i < img.data.length; i += 4) {
      img.data[i] = (img.data[i] * tint[0]) / 255;
      img.data[i + 1] = (img.data[i + 1] * tint[1]) / 255;
      img.data[i + 2] = (img.data[i + 2] * tint[2]) / 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  texCanvases.set(key, c);
  return c;
}

const TINTS = { grass: [124, 189, 90], foliage: [96, 161, 62], birch: [128, 167, 85], spruce: [97, 153, 97], water: [63, 118, 228] };

function faceName(def, f, meta = 0) {
  if (def.render === 'model' && def.boxes) {
    const b = def.boxes(meta, null)[0];
    const spec = b.tex || def.key;
    if (typeof spec === 'string') return spec;
    if (f === 4) return spec.top || spec.side;
    if (f === 5) return spec.bottom || spec.top || spec.side;
    if (f === 1 && spec.front) return spec.front;
    return spec.side || spec.top;
  }
  return def.texFn(f, meta);
}

function drawIso(ctx, def, h = 1) {
  ctx.imageSmoothingEnabled = false;
  const tintTop = def.tint && (def.tintFn ? def.tintFn(4) : true) ? TINTS[def.tint] : null;
  const tintSide = def.tint && (def.tintFn ? def.tintFn(1) : true) ? TINTS[def.tint] : null;
  const meta = def.tex && def.tex.front ? 1 : 0;
  const top = texCanvas(faceName(def, 4, meta), tintTop);
  const left = texCanvas(faceName(def, 1, meta), tintSide);
  const right = texCanvas(faceName(def, 3, meta), tintSide);
  const s = SIZE / 48;
  const yOff = (1 - h) * 22 * s;
  // gauche (face avant)
  ctx.setTransform((21 / 16) * s, (11 / 16) * s, 0, ((22 * h) / 16) * s, 3 * s, 13 * s + yOff);
  ctx.drawImage(left, 0, 16 - 16 * h, 16, 16 * h, 0, 0, 16, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.22)';
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillRect(0, 0, 16, 16);
  ctx.globalCompositeOperation = 'source-over';
  // droite
  ctx.setTransform((21 / 16) * s, (-11 / 16) * s, 0, ((22 * h) / 16) * s, 24 * s, 24 * s + yOff);
  ctx.drawImage(right, 0, 16 - 16 * h, 16, 16 * h, 0, 0, 16, 16);
  ctx.fillStyle = 'rgba(0,0,0,0.42)';
  ctx.globalCompositeOperation = 'source-atop';
  ctx.fillRect(0, 0, 16, 16);
  ctx.globalCompositeOperation = 'source-over';
  // dessus
  ctx.setTransform((21 / 16) * s, (-11 / 16) * s, (21 / 16) * s, (11 / 16) * s, 3 * s, 13 * s + yOff);
  ctx.drawImage(top, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
}

function drawFlat(ctx, name, tint, colorize) {
  ctx.imageSmoothingEnabled = false;
  const c = texCanvas(name, tint);
  ctx.drawImage(c, 0, 0, 16, 16, 0, 0, SIZE, SIZE);
  if (colorize) colorize(ctx);
}

function hexRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const ISO_MODELS = new Set([B.chest, B.ender_chest, B.enchanting_table, B.end_portal_frame, B.farmland, B.dirt_path, B.cactus, B.oak_stairs,
  B.cobblestone_stairs, B.stone_brick_stairs, B.nether_brick_stairs, B.anvil, B.dragon_egg, B.snow]);

export function iconURL(stack) {
  if (!stack) return '';
  const id = typeof stack === 'number' ? stack : stack.id;
  const potion = stack.potion || '';
  const key = id + '|' + potion;
  let url = iconCache.get(key);
  if (url) return url;
  const c = document.createElement('canvas');
  c.width = c.height = SIZE;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  const d = ITEMS[id];
  const bd = id < 256 ? BLOCKS[id] : null;
  try {
    if (bd && (RENDER[id] === R_CUBE)) drawIso(ctx, bd, 1);
    else if (bd && bd.slab) drawIso(ctx, bd, 0.5);
    else if (bd && id === B.snow) drawIso(ctx, bd, 0.15);
    else if (bd && ISO_MODELS.has(id)) drawIso(ctx, bd, id === B.enchanting_table ? 0.75 : id === B.farmland || id === B.dirt_path ? 0.94 : 1);
    else if (bd) {
      let name = bd.texFn ? bd.texFn(0, 0) : bd.key;
      if (bd.render === 'model' && bd.boxes && !['torch', 'ladder', 'iron_bars', 'glass_pane', 'lantern', 'brewing_stand'].includes(bd.key)) {
        const b = bd.boxes(0, null)[0];
        const sp = b.tex || bd.key;
        name = typeof sp === 'string' ? sp : sp.side || sp.top;
      }
      if (bd.key === 'lantern') name = 'lantern';
      if (bd.key === 'brewing_stand') name = 'brewing_stand_rod';
      const tint = bd.tint ? TINTS[bd.tint] : null;
      drawFlat(ctx, name, tint);
    } else if (d) {
      if (d.icon === 'spawn_egg') {
        drawFlat(ctx, 'item_spawn_egg');
        const [c1, c2] = d.colors.map(hexRgb);
        ctx.globalCompositeOperation = 'source-atop';
        ctx.fillStyle = `rgb(${c1})`;
        ctx.fillRect(0, 0, SIZE, SIZE);
        ctx.fillStyle = `rgb(${c2})`;
        for (const [x, y] of [[7, 6], [9, 8], [6, 10], [8, 5], [10, 11]]) ctx.fillRect((x * SIZE) / 16, (y * SIZE) / 16, SIZE / 16, SIZE / 16);
        ctx.globalCompositeOperation = 'source-over';
      } else if (id === I.potion && potion) {
        drawFlat(ctx, 'item_potion');
        const col = (POTIONS[potion] || POTIONS.water).color;
        const img = ctx.getImageData(0, 0, SIZE, SIZE);
        for (let i = 0; i < img.data.length; i += 4) {
          if (img.data[i] > 180 && img.data[i + 1] < 90 && img.data[i + 3] > 0) { img.data[i] = col[0]; img.data[i + 1] = col[1]; img.data[i + 2] = col[2]; }
        }
        ctx.putImageData(img, 0, 0);
      } else drawFlat(ctx, 'item_' + (d.icon || d.key));
    }
  } catch (e) {
    console.warn('icône', id, e);
  }
  url = c.toDataURL();
  iconCache.set(key, url);
  return url;
}

// Petites icônes du HUD (cœurs, faim, armure, bulles) en pixel-art 9x9
const HUD_ART = {
  heart_full: ['.RR...RR.', 'RWRR.RRRR', 'RWRRRRRRR', 'RRRRRRRRR', '.RRRRRRR.', '..RRRRR..', '...RRR...', '....R....'],
  heart_half: ['.RR...KK.', 'RWRR.KKKK', 'RWRRKKKKK', 'RRRRKKKKK', '.RRRKKKK.', '..RRKKK..', '...RKK...', '....K....'],
  heart_empty: ['.KK...KK.', 'KKKK.KKKK', 'KKKKKKKKK', 'KKKKKKKKK', '.KKKKKKK.', '..KKKKK..', '...KKK...', '....K....'],
  heart_gold: ['.YY...YY.', 'YWYY.YYYY', 'YWYYYYYYY', 'YYYYYYYYY', '.YYYYYYY.', '..YYYYY..', '...YYY...', '....Y....'],
  heart_poison: ['.GG...GG.', 'GWGG.GGGG', 'GWGGGGGGG', 'GGGGGGGGG', '.GGGGGGG.', '..GGGGG..', '...GGG...', '....G....'],
  food_full: ['.....BB..', '....BMMB.', '...BMMMMB', '..BMMMMMB', '.BWMMMMB.', 'BW.BMMB..', 'WW..BB...', '.W.......'],
  food_half: ['.....KK..', '....KKKK.', '...BKKKKK', '..BMKKKKK', '.BWMKKKK.', 'BW.BKKK..', 'WW..KK...', '.W.......'],
  food_empty: ['.....KK..', '....KKKK.', '...KKKKKK', '..KKKKKKK', '.KKKKKKK.', 'KK.KKKK..', 'KK..KK...', '.K.......'],
  armor_full: ['.AA...AA.', 'AAAAAAAAA', 'AAAAAAAAA', '.AAAAAAA.', '.AAAAAAA.', '.AAAAAAA.', '.AAAAAAA.', '..AAAAA..'],
  armor_half: ['.AA...KK.', 'AAAAAKKKK', 'AAAAAKKKK', '.AAAAKKK.', '.AAAAKKK.', '.AAAAKKK.', '.AAAAKKK.', '..AAAKK..'],
  armor_empty: ['.KK...KK.', 'KKKKKKKKK', 'KKKKKKKKK', '.KKKKKKK.', '.KKKKKKK.', '.KKKKKKK.', '.KKKKKKK.', '..KKKKK..'],
  bubble: ['..OOOO...', '.OBBBBO..', 'OBWBBBBO.', 'OBBBBBBO.', 'OBBBBBBO.', 'OBBBBBBO.', '.OBBBBO..', '..OOOO...'],
};
const HUD_PAL = { R: '#e01818', W: '#ffffff', K: '#2a2a2a', Y: '#f0c020', G: '#6a9a20', B: '#8a4a1a', M: '#c07030', A: '#d8d8d8', O: '#2050c0' };
const hudCache = new Map();
export function hudIcon(name) {
  let u = hudCache.get(name);
  if (u) return u;
  const art = HUD_ART[name];
  const c = document.createElement('canvas');
  c.width = 9; c.height = 9;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  // contour
  const px = (x, y, col) => { ctx.fillStyle = col; ctx.fillRect(x, y, 1, 1); };
  art.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== '.') px(x, y + 1, HUD_PAL[ch]); }));
  u = c.toDataURL();
  hudCache.set(name, u);
  return u;
}

export function textureURL(name, scale = 1) {
  const c0 = texCanvas(name);
  const c = document.createElement('canvas');
  c.width = c.height = 16 * scale;
  const ctx = c.getContext('2d', { willReadFrequently: true });
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(c0, 0, 0, 16 * scale, 16 * scale);
  return c.toDataURL();
}
