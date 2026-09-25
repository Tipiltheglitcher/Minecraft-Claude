// Modèles d'entités (boîtes articulées) et génération procédurale des skins
import { Painter, hex, shade } from './paint.js';
import * as M from '../core/math.js';

export const SKIN_SIZE = 128;
export const MODELS = {};
const skinLayers = [];

// ---------- Définition ----------
// part : {name, pivot:[x,y,z], boxes:[{from, size, c, f:{n,s,w,e,u,d}, inflate}], children:[...]}
function model(name, def) {
  const m = Object.assign({ name, ds: 1, scale: 1 }, def);
  m.partMap = {};
  const walk = (parts) => {
    for (const p of parts) {
      m.partMap[p.name] = p;
      if (p.children) walk(p.children);
    }
  };
  walk(m.parts);
  MODELS[name] = m;
  return m;
}

// ---------- Peinture ----------
function faceRegions(u, v, w, h, d) {
  return {
    w: [u, v + d, d, h],
    n: [u + d, v + d, w, h],
    e: [u + d + w, v + d, d, h],
    s: [u + 2 * d + w, v + d, w, h],
    u: [u + d, v, w, d],
    d: [u + d + w, v, w, d],
  };
}

function paintSkin(m) {
  const p = new Painter('skin_' + m.name, SKIN_SIZE);
  p.clear();
  // empaquetage en étagères
  let cx = 0, cy = 0, rowH = 0;
  const ds = m.ds;
  const all = [];
  const walk = (parts) => {
    for (const part of parts) {
      for (const b of part.boxes || []) all.push(b);
      if (part.children) walk(part.children);
    }
  };
  walk(m.parts);
  for (const b of all) {
    const w = Math.max(1, Math.round(b.size[0] * ds)), h = Math.max(1, Math.round(b.size[1] * ds)), d = Math.max(1, Math.round(b.size[2] * ds));
    const W = 2 * (w + d), H = d + h;
    if (cx + W > SKIN_SIZE) { cx = 0; cy += rowH; rowH = 0; }
    if (cy + H > SKIN_SIZE) console.warn('Skin trop grande', m.name);
    b.uvw = [cx, cy, w, h, d];
    const reg = faceRegions(cx, cy, w, h, d);
    b.regions = reg;
    const base = hex(b.c || '#888888');
    for (const [fn, [rx, ry, rw, rh]] of Object.entries(reg)) {
      const faceBase = b.fc && b.fc[fn] ? hex(b.fc[fn]) : base;
      const amp = b.noise ?? 0.07;
      for (let yy = ry; yy < ry + rh; yy++)
        for (let xx = rx; xx < rx + rw; xx++) p.set(xx, yy, shade(faceBase, 1 + (p.r() * 2 - 1) * amp));
      if (b.all) b.all(p, rx, ry, rw, rh, fn);
      if (b.f && b.f[fn]) b.f[fn](p, rx, ry, rw, rh);
    }
    cx += W;
    rowH = Math.max(rowH, H);
  }
  m.layer = skinLayers.length;
  skinLayers.push(p.data);
}

export function buildSkins() {
  skinLayers.length = 0;
  for (const m of Object.values(MODELS)) paintSkin(m);
  return skinLayers;
}

// ---------- Helpers de peinture ----------
const px = (p, x, y, c) => p.set(x, y, c);
const eyes = (col, pupil, y = 4, wide = false) => (p, x, yy, w) => {
  const cxm = x + (w >> 1);
  if (wide) { p.rect(cxm - 3, yy + y, 2, 1, col); p.rect(cxm + 1, yy + y, 2, 1, col); if (pupil) { px(p, cxm - 2, yy + y, pupil); px(p, cxm + 1, yy + y, pupil); } return; }
  px(p, cxm - 3, yy + y, col); px(p, cxm - 2, yy + y, pupil || col);
  px(p, cxm + 1, yy + y, pupil || col); px(p, cxm + 2, yy + y, col);
};
const band = (y0, h, c) => (p, x, y, w) => p.rect(x, y + y0, w, h, c);
const patches = (c, n) => (p, x, y, w, h) => {
  for (let i = 0; i < n; i++) {
    const bx = x + p.ri(Math.max(1, w - 1)), by = y + p.ri(Math.max(1, h - 1));
    p.rect(bx, by, 1 + p.ri(2), 1 + p.ri(2), c);
  }
};
function combine(...fns) { return (p, x, y, w, h, f) => fns.forEach((fn) => fn && fn(p, x, y, w, h, f)); }

// ---------- Bipèdes ----------
function biped(name, o) {
  const limbW = o.limbW || 4;
  return model(name, {
    height: o.height,
    parts: [
      { name: 'body', pivot: [0, 24, 0], boxes: [{ from: [-4, -12, -2], size: [8, 12, 4], c: o.body, f: o.bodyF, fc: o.bodyFc }] },
      { name: 'head', pivot: [0, 24, 0], boxes: [{ from: [-(o.headW || 8) / 2, 0, -4], size: [o.headW || 8, o.headH || 8, 8], c: o.head, f: o.headF, fc: o.headFc }].concat(o.headExtra || []) },
      { name: 'rarm', pivot: [-5, 22, 0], boxes: [{ from: [-limbW + 1, -10, -limbW / 2], size: [limbW, 12, limbW], c: o.arm, f: o.armF }] },
      { name: 'larm', pivot: [5, 22, 0], boxes: [{ from: [-1, -10, -limbW / 2], size: [limbW, 12, limbW], c: o.arm, f: o.armF }] },
      { name: 'rleg', pivot: [-1.9, 12, 0], boxes: [{ from: [-limbW / 2, -12, -limbW / 2], size: [limbW, 12, limbW], c: o.leg, f: o.legF }] },
      { name: 'lleg', pivot: [1.9, 12, 0], boxes: [{ from: [-limbW / 2, -12, -limbW / 2], size: [limbW, 12, limbW], c: o.leg, f: o.legF }] },
    ],
  });
}

// Joueur (Steve)
biped('player', {
  head: '#b98a68',
  headF: {
    n: combine(band(0, 2, '#3b2513'), (p, x, y) => { p.set(x, y + 2, '#3b2513'); p.set(x + 7, y + 2, '#3b2513'); p.rect(x + 1, y + 4, 2, 1, '#ffffff'); p.set(x + 2, y + 4, '#3a4db0'); p.rect(x + 5, y + 4, 2, 1, '#ffffff'); p.set(x + 5, y + 4, '#3a4db0'); p.rect(x + 3, y + 6, 2, 1, '#8a5a42'); p.rect(x + 2, y + 7, 4, 1, '#6b4a3a'); }),
    u: (p, x, y, w, h) => p.rect(x, y, w, h, '#3b2513'),
    s: band(0, 7, '#3b2513'), w: band(0, 3, '#3b2513'), e: band(0, 3, '#3b2513'),
  },
  body: '#00a8a8', bodyF: { n: (p, x, y) => { p.rect(x + 3, y, 2, 1, '#b98a68'); } },
  arm: '#b98a68', armF: { n: band(0, 4, '#00a8a8'), s: band(0, 4, '#00a8a8'), w: band(0, 4, '#00a8a8'), e: band(0, 4, '#00a8a8'), u: (p, x, y, w, h) => p.rect(x, y, w, h, '#00a8a8') },
  leg: '#3c3ca0', legF: { n: band(10, 2, '#555555'), s: band(10, 2, '#555555'), w: band(10, 2, '#555555'), e: band(10, 2, '#555555'), d: (p, x, y, w, h) => p.rect(x, y, w, h, '#555555') },
});

biped('zombie', {
  head: '#5d8a47', headF: { n: (p, x, y) => { p.rect(x + 1, y + 4, 2, 1, '#1d2b16'); p.rect(x + 5, y + 4, 2, 1, '#1d2b16'); p.rect(x + 3, y + 6, 2, 1, '#3c5a2c'); } },
  body: '#00a5a5', bodyF: { n: patches('#008a8a', 5) },
  arm: '#5d8a47', armF: { n: band(0, 3, '#00a5a5'), s: band(0, 3, '#00a5a5'), w: band(0, 3, '#00a5a5'), e: band(0, 3, '#00a5a5') },
  leg: '#3e3a8f', legF: { n: band(10, 2, '#4a4a4a') },
});

const skelHead = { n: (p, x, y) => { p.rect(x + 1, y + 3, 2, 2, '#2a2a2a'); p.rect(x + 5, y + 3, 2, 2, '#2a2a2a'); p.set(x + 4, y + 5, '#444444'); p.rect(x + 2, y + 6, 4, 1, '#3a3a3a'); } };
const ribs = { n: (p, x, y, w, h) => { for (let i = 1; i < h; i += 2) p.hline(x + 1, y + i, w - 2, '#555555'); } };
biped('skeleton', { head: '#c8c8c8', headF: skelHead, body: '#b5b5b5', bodyF: ribs, arm: '#bdbdbd', leg: '#bdbdbd', limbW: 2 });
biped('wither_skeleton', { head: '#2c2c2c', headF: { n: (p, x, y) => { p.rect(x + 1, y + 3, 2, 2, '#0a0a0a'); p.rect(x + 5, y + 3, 2, 2, '#0a0a0a'); p.rect(x + 2, y + 6, 4, 1, '#111111'); } }, body: '#262626', bodyF: ribs, arm: '#2a2a2a', leg: '#2a2a2a', limbW: 2 });
biped('piglin', {
  head: '#e59a9a', headW: 10, headF: {
    n: (p, x, y) => { p.rect(x + 1, y + 3, 2, 1, '#ffffff'); p.set(x + 2, y + 3, '#301010'); p.rect(x + 7, y + 3, 2, 1, '#ffffff'); p.set(x + 7, y + 3, '#301010'); p.rect(x + 2, y + 6, 6, 2, '#6b8c3c'); },
    e: patches('#6b8c3c', 3),
  },
  headExtra: [{ from: [-2, 1, -5], size: [4, 3, 1], c: '#d67c7c', f: { n: (p, x, y) => { p.set(x, y + 1, '#6a2a2a'); p.set(x + 3, y + 1, '#6a2a2a'); } } },
    { from: [-6, 3, -1], size: [1, 5, 4], c: '#d68888' }, { from: [5, 3, -1], size: [1, 5, 4], c: '#d68888' }],
  body: '#8a6a3a', bodyF: { n: patches('#6b8c3c', 6) }, arm: '#e59a9a', armF: { n: patches('#6b8c3c', 3) }, leg: '#5a4a2a',
});
model('villager', {
  height: 1.95,
  parts: [
    { name: 'body', pivot: [0, 24, 0], boxes: [{ from: [-4, -12, -3], size: [8, 12, 6], c: '#6d4b35' }, { from: [-4, -18, -3], size: [8, 6, 6], c: '#5a3d2a' }] },
    { name: 'head', pivot: [0, 24, 0], boxes: [{ from: [-4, 0, -4], size: [8, 10, 8], c: '#b8876c', f: { n: (p, x, y) => { p.rect(x + 1, y + 4, 2, 1, '#ffffff'); p.set(x + 2, y + 4, '#2e8a3a'); p.rect(x + 5, y + 4, 2, 1, '#ffffff'); p.set(x + 5, y + 4, '#2e8a3a'); p.rect(x + 1, y + 3, 6, 1, '#6a4a3a'); } } },
      { from: [-1, 1, -6], size: [2, 4, 2], c: '#a8775c' }] },
    { name: 'arms', pivot: [0, 21, -1], boxes: [{ from: [-4, -4, -4], size: [8, 4, 4], c: '#6d4b35' }, { from: [-6, -4, -3], size: [2, 6, 4], c: '#6d4b35' }, { from: [4, -4, -3], size: [2, 6, 4], c: '#6d4b35' }] },
    { name: 'rleg', pivot: [-2, 6, 0], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#4a3426' }] },
    { name: 'lleg', pivot: [2, 6, 0], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#4a3426' }] },
  ],
});
model('enderman', {
  height: 2.9,
  parts: [
    { name: 'body', pivot: [0, 38, 0], boxes: [{ from: [-4, -12, -2], size: [8, 12, 4], c: '#141414' }] },
    { name: 'head', pivot: [0, 38, 0], boxes: [{ from: [-4, 0, -4], size: [8, 8, 8], c: '#151515', f: { n: (p, x, y) => { p.rect(x + 1, y + 4, 2, 1, '#e079fa'); p.rect(x + 5, y + 4, 2, 1, '#e079fa'); p.set(x, y + 4, '#cc00fa'); p.set(x + 7, y + 4, '#cc00fa'); } } }] },
    { name: 'rarm', pivot: [-5, 36, 0], boxes: [{ from: [-1, -30, -1], size: [2, 30, 2], c: '#141414' }] },
    { name: 'larm', pivot: [5, 36, 0], boxes: [{ from: [-1, -30, -1], size: [2, 30, 2], c: '#141414' }] },
    { name: 'rleg', pivot: [-2, 26, 0], boxes: [{ from: [-1, -26, -1], size: [2, 26, 2], c: '#141414' }] },
    { name: 'lleg', pivot: [2, 26, 0], boxes: [{ from: [-1, -26, -1], size: [2, 26, 2], c: '#141414' }] },
  ],
});

// ---------- Quadrupèdes ----------
function quad(name, o) {
  const lh = o.legH;
  return model(name, {
    parts: [
      { name: 'body', pivot: [0, lh, 0], boxes: [{ from: [-o.bw / 2, 0, -o.bl / 2], size: [o.bw, o.bh, o.bl], c: o.body, f: o.bodyF, all: o.bodyAll }].concat(o.bodyExtra || []) },
      { name: 'head', pivot: [0, lh + o.headY, -o.bl / 2], boxes: [{ from: [-o.hw / 2, -o.hh / 2, -o.hd], size: [o.hw, o.hh, o.hd], c: o.head, f: o.headF, all: o.headAll }].concat(o.headExtra || []) },
      { name: 'leg0', pivot: [-o.lx, lh, -o.lz], boxes: [{ from: [-2, -lh, -2], size: [4, lh, 4], c: o.leg, f: o.legF }] },
      { name: 'leg1', pivot: [o.lx, lh, -o.lz], boxes: [{ from: [-2, -lh, -2], size: [4, lh, 4], c: o.leg, f: o.legF }] },
      { name: 'leg2', pivot: [-o.lx, lh, o.lz], boxes: [{ from: [-2, -lh, -2], size: [4, lh, 4], c: o.leg, f: o.legF }] },
      { name: 'leg3', pivot: [o.lx, lh, o.lz], boxes: [{ from: [-2, -lh, -2], size: [4, lh, 4], c: o.leg, f: o.legF }] },
    ],
  });
}
const animalEyes = (p, x, y, w) => { p.rect(x, y + 2, 2, 1, '#ffffff'); p.set(x, y + 2, '#111111'); p.rect(x + w - 2, y + 2, 2, 1, '#ffffff'); p.set(x + w - 1, y + 2, '#111111'); };
quad('pig', {
  legH: 6, bw: 10, bh: 8, bl: 16, body: '#f0a5a2', hw: 8, hh: 8, hd: 8, headY: 6, head: '#f0a5a2',
  headF: { n: animalEyes }, headExtra: [{ from: [-2, -3, -9], size: [4, 3, 1], c: '#e27d7a', f: { n: (p, x, y) => { p.set(x, y + 1, '#8a3a3a'); p.set(x + 3, y + 1, '#8a3a3a'); } } }],
  lx: 3, lz: 5, leg: '#e89a97', legF: { d: (p, x, y, w, h) => p.rect(x, y, w, h, '#b06060') },
});
quad('cow', {
  legH: 12, bw: 12, bh: 10, bl: 18, body: '#4a3526', bodyAll: patches('#d8d8d8', 6), hw: 8, hh: 8, hd: 6, headY: 8, head: '#4a3526',
  headF: { n: combine(animalEyes, (p, x, y) => p.rect(x + 2, y + 5, 4, 3, '#b5b5b5')) },
  headExtra: [{ from: [-5, 3, -4], size: [1, 3, 1], c: '#d8d0c0' }, { from: [4, 3, -4], size: [1, 3, 1], c: '#d8d0c0' }],
  lx: 4, lz: 6, leg: '#4a3526', legF: { n: band(9, 3, '#d8d8d8') },
});
quad('sheep', {
  legH: 12, bw: 8, bh: 6, bl: 16, body: '#d8b8a4', hw: 6, hh: 6, hd: 8, headY: 8, head: '#d7b9a3',
  headF: { n: animalEyes, u: (p, x, y, w, h) => p.rect(x, y, w, h, '#e8e8e8') },
  bodyExtra: [{ from: [-6, -1, -9], size: [12, 9, 18], c: '#e9e9e9', noise: 0.05, wool: true }],
  lx: 3, lz: 5, leg: '#d7b9a3', legF: { n: band(0, 5, '#e8e8e8'), s: band(0, 5, '#e8e8e8'), w: band(0, 5, '#e8e8e8'), e: band(0, 5, '#e8e8e8') },
});
model('chicken', {
  parts: [
    { name: 'body', pivot: [0, 5, 0], boxes: [{ from: [-3, 0, -4], size: [6, 6, 8], c: '#f0f0f0' }] },
    { name: 'head', pivot: [0, 9, -4], boxes: [{ from: [-2, 0, -2], size: [4, 6, 3], c: '#f2f2f2', f: { n: (p, x, y) => { p.set(x, y + 1, '#111111'); p.set(x + 3, y + 1, '#111111'); } } },
      { from: [-2, 2, -4], size: [4, 2, 2], c: '#f2b01c' }, { from: [-1, 0, -3], size: [2, 2, 2], c: '#d12d2d' }] },
    { name: 'rwing', pivot: [-3, 10, 0], boxes: [{ from: [-1, -4, -3], size: [1, 4, 6], c: '#e8e8e8' }] },
    { name: 'lwing', pivot: [3, 10, 0], boxes: [{ from: [0, -4, -3], size: [1, 4, 6], c: '#e8e8e8' }] },
    { name: 'rleg', pivot: [-1.5, 5, 1], boxes: [{ from: [-0.5, -5, -0.5], size: [1, 5, 1], c: '#e8a41c' }, { from: [-1.5, -5, -2], size: [3, 0.01, 3], c: '#e8a41c' }] },
    { name: 'lleg', pivot: [1.5, 5, 1], boxes: [{ from: [-0.5, -5, -0.5], size: [1, 5, 1], c: '#e8a41c' }, { from: [-1.5, -5, -2], size: [3, 0.01, 3], c: '#e8a41c' }] },
  ],
});
const creeperSkin = combine(patches('#0b7a09', 10), patches('#56d44c', 6), patches('#9ae88f', 2));
model('creeper', {
  parts: [
    { name: 'body', pivot: [0, 6, 0], boxes: [{ from: [-4, 0, -2], size: [8, 12, 4], c: '#0da70b', all: creeperSkin }] },
    { name: 'head', pivot: [0, 18, 0], boxes: [{ from: [-4, 0, -4], size: [8, 8, 8], c: '#0da70b', all: creeperSkin, f: { n: (p, x, y) => { p.rect(x + 1, y + 2, 2, 2, '#000000'); p.rect(x + 5, y + 2, 2, 2, '#000000'); p.rect(x + 3, y + 4, 2, 2, '#000000'); p.rect(x + 2, y + 5, 4, 2, '#000000'); p.set(x + 2, y + 7, '#000000'); p.set(x + 5, y + 7, '#000000'); } } }] },
    { name: 'leg0', pivot: [-2, 6, -4], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#0da70b', all: creeperSkin }] },
    { name: 'leg1', pivot: [2, 6, -4], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#0da70b', all: creeperSkin }] },
    { name: 'leg2', pivot: [-2, 6, 4], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#0da70b', all: creeperSkin }] },
    { name: 'leg3', pivot: [2, 6, 4], boxes: [{ from: [-2, -6, -2], size: [4, 6, 4], c: '#0da70b', all: creeperSkin }] },
  ],
});
const spiderLegs = [];
for (let i = 0; i < 8; i++) {
  const right = i % 2 === 0;
  const z = [2, 1, 0, -1][i >> 1];
  spiderLegs.push({ name: 'leg' + i, pivot: [right ? -4 : 4, 9, z], boxes: [{ from: right ? [-15, -1, -1] : [-1, -1, -1], size: [16, 2, 2], c: '#2e2620' }] });
}
model('spider', {
  parts: [
    { name: 'head', pivot: [0, 9, -3], boxes: [{ from: [-4, -4, -8], size: [8, 8, 8], c: '#342d27', f: { n: (p, x, y) => { for (const [ex, ey] of [[1, 3], [6, 3], [2, 2], [5, 2], [3, 4], [4, 4]]) p.set(x + ex, y + ey, '#c01010'); p.rect(x + 2, y + 3, 4, 1, '#e02020'); } } }] },
    { name: 'neck', pivot: [0, 9, 0], boxes: [{ from: [-3, -3, -3], size: [6, 6, 6], c: '#2c2520' }] },
    { name: 'body', pivot: [0, 9, 9], boxes: [{ from: [-5, -4, -6], size: [10, 8, 12], c: '#342d27', all: patches('#4a3d33', 6) }] },
  ].concat(spiderLegs),
});
const blazeRods = [];
for (let i = 0; i < 12; i++) blazeRods.push({ name: 'rod' + i, pivot: [0, 0, 0], boxes: [{ from: [-1, -4, -1], size: [2, 8, 2], c: '#e6b010', f: { n: band(0, 2, '#fff3a0') } }] });
model('blaze', {
  parts: [{ name: 'head', pivot: [0, 18, 0], boxes: [{ from: [-4, 0, -4], size: [8, 8, 8], c: '#f2c12e', all: patches('#d99a1a', 4), f: { n: (p, x, y) => { p.rect(x + 1, y + 3, 2, 1, '#2a1a00'); p.rect(x + 5, y + 3, 2, 1, '#2a1a00'); p.rect(x + 2, y + 6, 4, 1, '#7a4a00'); } } }] }].concat(blazeRods),
});
const ghastTentacles = [];
for (let i = 0; i < 9; i++) {
  const len = 7 + ((i * 5) % 7);
  ghastTentacles.push({ name: 't' + i, pivot: [((i % 3) - 1) * 5, 0, (Math.floor(i / 3) - 1) * 5], boxes: [{ from: [-1, -len, -1], size: [2, len, 2], c: '#e8e8e8' }] });
}
model('ghast', {
  parts: [{ name: 'body', pivot: [0, 0, 0], boxes: [{ from: [-8, 0, -8], size: [16, 16, 16], c: '#f0f0f0', all: patches('#d8d8d8', 8), f: { n: (p, x, y) => { p.rect(x + 3, y + 5, 3, 1, '#606060'); p.rect(x + 10, y + 5, 3, 1, '#606060'); p.rect(x + 6, y + 10, 4, 2, '#606060'); } } }] }].concat(ghastTentacles),
});
model('ghast_angry', {
  parts: [{ name: 'body', pivot: [0, 0, 0], boxes: [{ from: [-8, 0, -8], size: [16, 16, 16], c: '#f0f0f0', all: patches('#d8d8d8', 8), f: { n: (p, x, y) => { p.rect(x + 3, y + 4, 3, 3, '#a01010'); p.rect(x + 10, y + 4, 3, 3, '#a01010'); p.rect(x + 5, y + 9, 6, 4, '#300000'); } } }] }].concat(ghastTentacles.map((t) => ({ ...t, name: t.name, boxes: t.boxes.map((b) => ({ ...b })) }))),
});
model('slime', { parts: [{ name: 'body', pivot: [0, 0, 0], boxes: [{ from: [-4, 0, -4], size: [8, 8, 8], c: '#6ab04c', noise: 0.05, f: { n: (p, x, y) => { p.rect(x + 1, y + 2, 2, 2, '#1c3a10'); p.rect(x + 5, y + 2, 2, 2, '#1c3a10'); p.set(x + 4, y + 5, '#1c3a10'); } } }] }] });
model('magma_cube', { parts: [{ name: 'body', pivot: [0, 0, 0], boxes: [{ from: [-4, 0, -4], size: [8, 8, 8], c: '#4a0a00', all: combine(band(2, 1, '#f08a10'), band(5, 1, '#ffd23a')), f: { n: (p, x, y) => { p.rect(x + 1, y + 3, 2, 1, '#ffee60'); p.rect(x + 5, y + 3, 2, 1, '#ffee60'); } } }] }] });
model('iron_golem', {
  parts: [
    { name: 'body', pivot: [0, 31, 0], boxes: [{ from: [-9, -12, -6], size: [18, 12, 11], c: '#d8d4cc', all: patches('#6a9a3a', 5) }, { from: [-4.5, -17, -3], size: [9, 5, 6], c: '#cfcac0' }] },
    { name: 'head', pivot: [0, 31, -2], boxes: [{ from: [-4, 0, -5.5], size: [8, 10, 8], c: '#d8d4cc', f: { n: (p, x, y) => { p.rect(x + 1, y + 4, 2, 1, '#a01010'); p.rect(x + 5, y + 4, 2, 1, '#a01010'); p.rect(x + 1, y + 3, 6, 1, '#8a867e'); } } }, { from: [-1, 1, -7.5], size: [2, 4, 2], c: '#c4bfb5' }] },
    { name: 'rarm', pivot: [-11, 29, 0], boxes: [{ from: [-2, -28, -3], size: [4, 30, 6], c: '#d8d4cc', all: patches('#6a9a3a', 3) }] },
    { name: 'larm', pivot: [11, 29, 0], boxes: [{ from: [-2, -28, -3], size: [4, 30, 6], c: '#d8d4cc' }] },
    { name: 'rleg', pivot: [-4, 16, 0], boxes: [{ from: [-3, -16, -2.5], size: [6, 16, 5], c: '#cfcac0' }] },
    { name: 'lleg', pivot: [4, 16, 0], boxes: [{ from: [-3, -16, -2.5], size: [6, 16, 5], c: '#cfcac0' }] },
  ],
});
model('end_crystal', {
  parts: [
    { name: 'outer', pivot: [0, 0, 0], boxes: [{ from: [-4, -4, -4], size: [8, 8, 8], c: '#e0b0f0', noise: 0.15, all: (p, x, y, w, h) => p.border('#ffffff', x, y, w, h) }] },
    { name: 'inner', pivot: [0, 0, 0], boxes: [{ from: [-4, -4, -4], size: [8, 8, 8], c: '#d020c0', noise: 0.2, all: patches('#ff80ff', 6) }] },
  ],
});
model('arrow', { parts: [{ name: 'shaft', pivot: [0, 0, 0], boxes: [{ from: [-0.5, -0.5, -8], size: [1, 1, 14], c: '#8b6a3e' }, { from: [-0.5, -0.5, -9], size: [1, 1, 2], c: '#b0b0b0' }, { from: [-1.5, -0.5, 5], size: [3, 1, 3], c: '#f0f0f0' }] }] });

// ---------- Ender Dragon ----------
const dragonSkin = combine(patches('#262626', 12), patches('#0f0f0f', 12));
const neck = [];
for (let i = 0; i < 5; i++) neck.push({ name: 'neck' + i, pivot: [0, 0, 0], boxes: [{ from: [-5, -5, -5], size: [10, 10, 10], c: '#1a1a1a', all: dragonSkin }, { from: [-1, 5, -3], size: [2, 4, 6], c: '#3a3a3a' }] });
const tail = [];
for (let i = 0; i < 12; i++) tail.push({ name: 'tail' + i, pivot: [0, 0, 0], boxes: [{ from: [-5, -5, -5], size: [10, 10, 10], c: '#1a1a1a', all: dragonSkin }, { from: [-1, 5, -3], size: [2, 4, 6], c: '#3a3a3a' }] });
model('dragon', {
  ds: 0.25,
  parts: [
    { name: 'body', pivot: [0, 0, 0], boxes: [{ from: [-12, -12, -32], size: [24, 24, 64], c: '#1c1c1c', all: dragonSkin }, { from: [-1, 12, -30], size: [2, 6, 12], c: '#3a3a3a' }, { from: [-1, 12, -10], size: [2, 6, 12], c: '#3a3a3a' }, { from: [-1, 12, 10], size: [2, 6, 12], c: '#3a3a3a' }] },
    { name: 'head', pivot: [0, 0, 0], boxes: [
      { from: [-8, -8, -16], size: [16, 16, 16], c: '#1c1c1c', all: dragonSkin, f: { n: (p, x, y, w) => { p.rect(x + 1, y + 1, 2, 1, '#e060f0'); p.rect(x + w - 3, y + 1, 2, 1, '#e060f0'); } } },
      { from: [-6, -4, -32], size: [12, 5, 16], c: '#1c1c1c', all: dragonSkin },
      { from: [-5, 1, -30], size: [2, 2, 4], c: '#3a3a3a' }, { from: [3, 1, -30], size: [2, 2, 4], c: '#3a3a3a' },
      { from: [-5, 8, -10], size: [2, 4, 6], c: '#3a3a3a' }, { from: [3, 8, -10], size: [2, 4, 6], c: '#3a3a3a' },
    ], children: [{ name: 'jaw', pivot: [0, -4, -16], boxes: [{ from: [-6, -4, -16], size: [12, 4, 16], c: '#161616', all: dragonSkin }] }] },
    { name: 'lwing', pivot: [12, 5, -18], boxes: [{ from: [0, -4, -4], size: [56, 8, 8], c: '#1c1c1c' }, { from: [0, 0, 2], size: [56, 0.01, 56], c: '#302a3a', noise: 0.1 }],
      children: [{ name: 'lwingtip', pivot: [56, 0, 0], boxes: [{ from: [0, -2, -2], size: [56, 4, 4], c: '#1c1c1c' }, { from: [0, 0, 2], size: [56, 0.01, 56], c: '#302a3a', noise: 0.1 }] }] },
    { name: 'rwing', pivot: [-12, 5, -18], boxes: [{ from: [-56, -4, -4], size: [56, 8, 8], c: '#1c1c1c' }, { from: [-56, 0, 2], size: [56, 0.01, 56], c: '#302a3a', noise: 0.1 }],
      children: [{ name: 'rwingtip', pivot: [-56, 0, 0], boxes: [{ from: [-56, -2, -2], size: [56, 4, 4], c: '#1c1c1c' }, { from: [-56, 0, 2], size: [56, 0.01, 56], c: '#302a3a', noise: 0.1 }] }] },
    { name: 'fleg0', pivot: [-12, -8, -18], boxes: [{ from: [-4, -20, -4], size: [8, 24, 8], c: '#1a1a1a' }] },
    { name: 'fleg1', pivot: [12, -8, -18], boxes: [{ from: [-4, -20, -4], size: [8, 24, 8], c: '#1a1a1a' }] },
    { name: 'bleg0', pivot: [-16, -4, 22], boxes: [{ from: [-8, -28, -8], size: [16, 32, 16], c: '#1a1a1a' }] },
    { name: 'bleg1', pivot: [16, -4, 22], boxes: [{ from: [-8, -28, -8], size: [16, 32, 16], c: '#1a1a1a' }] },
  ].concat(neck, tail),
});

// ---------- Rendu ----------
const _m = M.mat4();
const _stack = [];
for (let i = 0; i < 16; i++) _stack.push(M.mat4());
const _v = new Float32Array(3);
const FACE_CORNERS = {
  n: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
  s: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  w: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  e: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  u: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  d: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
};
const FACE_NORMAL = { n: [0, 0, -1], s: [0, 0, 1], w: [-1, 0, 0], e: [1, 0, 0], u: [0, 1, 0], d: [0, -1, 0] };

// UV (texels) d'un coin selon la face
function cornerUV(f, reg, c, w, h, d) {
  const [rx, ry] = reg;
  switch (f) {
    case 'n': return [rx + (1 - c[0]) * w, ry + (1 - c[1]) * h];
    case 's': return [rx + c[0] * w, ry + (1 - c[1]) * h];
    case 'w': return [rx + c[2] * d, ry + (1 - c[1]) * h];
    case 'e': return [rx + (1 - c[2]) * d, ry + (1 - c[1]) * h];
    case 'u': return [rx + c[0] * w, ry + c[2] * d];
    default: return [rx + c[0] * w, ry + c[2] * d];
  }
}

// pose : { parts: {nom: [rx,ry,rz]}, hidden: Set, offsets: {nom:[x,y,z]} }
// root : matrice (entité -> monde relatif, unités blocs)
export function renderModel(buf, m, root, pose, sky, bl, color = [255, 255, 255], alpha = 255) {
  const layer = m.layer;
  const parts = pose.parts || {};
  const hidden = pose.hidden;
  const offs = pose.offsets || {};
  let depth = 0;
  const drawPart = (part, parent) => {
    if (hidden && hidden.has(part.name)) return;
    const mat = _stack[++depth];
    const o = offs[part.name];
    M.translate(mat, parent, (part.pivot[0] + (o ? o[0] : 0)) / 16, (part.pivot[1] + (o ? o[1] : 0)) / 16, (part.pivot[2] + (o ? o[2] : 0)) / 16);
    const r = parts[part.name];
    if (r) {
      if (r[2]) M.rotateZ(mat, mat, r[2]);
      if (r[1]) M.rotateY(mat, mat, r[1]);
      if (r[0]) M.rotateX(mat, mat, r[0]);
      if (r[3]) M.scale(mat, mat, r[3], r[3], r[3]);
    }
    for (const b of part.boxes) {
      if (hidden && b.wool && hidden.has('wool')) continue;
      emitBox(buf, mat, b, layer, sky, bl, color, alpha);
    }
    if (part.children) for (const ch of part.children) drawPart(ch, mat);
    depth--;
  };
  for (const p of m.parts) drawPart(p, root);
}

function emitBox(buf, mat, b, layer, sky, bl, color, alpha) {
  const [x0, y0, z0] = b.from;
  const [sw, sh, sd] = b.size;
  const inf = b.inflate || 0;
  const [, , w, h, d] = b.uvw;
  for (const f of ['n', 's', 'w', 'e', 'u', 'd']) {
    const reg = b.regions[f];
    const nrm = FACE_NORMAL[f];
    // normale transformée (sans translation)
    const nx = mat[0] * nrm[0] + mat[4] * nrm[1] + mat[8] * nrm[2];
    const ny = mat[1] * nrm[0] + mat[5] * nrm[1] + mat[9] * nrm[2];
    const nl = Math.hypot(nx, ny, mat[2] * nrm[0] + mat[6] * nrm[1] + mat[10] * nrm[2]) || 1;
    const shd = Math.max(0.45, Math.min(1, 0.78 + 0.22 * (ny / nl) + 0.06 * (nx / nl))) * 255;
    const cs = FACE_CORNERS[f];
    for (let k = 0; k < 4; k++) {
      const c = cs[k];
      const lx = (x0 - inf + c[0] * (sw + inf * 2)) / 16, ly = (y0 - inf + c[1] * (sh + inf * 2)) / 16, lz = (z0 - inf + c[2] * (sd + inf * 2)) / 16;
      M.transformPoint(mat, lx, ly, lz, _v);
      const uv = cornerUV(f, reg, c, w, h, d);
      buf.v(Math.round(_v[0] * 256), Math.round(_v[1] * 256), Math.round(_v[2] * 256), uv[0], uv[1], layer, sky, bl, shd, color[0], color[1], color[2], 0);
      if (alpha !== 255) buf.u8[(buf.n - 1) * 20 + 19] = alpha;
    }
  }
}

// Cube texturé avec les textures de blocs (objets posés, blocs qui tombent)
export function renderBlockCube(buf, mat, faceLayers, sky, bl, size = 1, tint = [255, 255, 255], centered = true) {
  const faces = ['n', 's', 'w', 'e', 'u', 'd'];
  const o = centered ? -size / 2 : 0;
  for (let fi = 0; fi < 6; fi++) {
    const f = faces[fi];
    const nrm = FACE_NORMAL[f];
    const ny = mat[1] * nrm[0] + mat[5] * nrm[1] + mat[9] * nrm[2];
    const nx = mat[0] * nrm[0] + mat[4] * nrm[1] + mat[8] * nrm[2];
    const shd = Math.max(0.5, Math.min(1, 0.78 + 0.22 * ny + 0.05 * nx)) * 255;
    const cs = FACE_CORNERS[f];
    const uvs = [[0, 16], [16, 16], [16, 0], [0, 0]];
    const topUV = f === 'u' || f === 'd';
    for (let k = 0; k < 4; k++) {
      const c = cs[k];
      M.transformPoint(mat, o + c[0] * size, (centered ? o : 0) + c[1] * size, o + c[2] * size, _v);
      const uv = topUV ? [c[0] * 16, c[2] * 16] : uvs[k];
      buf.v(Math.round(_v[0] * 256), Math.round(_v[1] * 256), Math.round(_v[2] * 256), uv[0], uv[1], faceLayers[fi], sky, bl, shd, tint[0], tint[1], tint[2], 0);
    }
  }
}

// Sprite (quad double face) dans le plan XY de la matrice
export function renderSprite(buf, mat, layer, sky, bl, size = 1, color = [255, 255, 255], u0 = 0, v0 = 0, u1 = 16, v1 = 16, shadeV = 255) {
  const h = size / 2;
  const q = [[-h, -h, 0, u0, v1], [h, -h, 0, u1, v1], [h, h, 0, u1, v0], [-h, h, 0, u0, v0]];
  for (const order of [[0, 1, 2, 3], [3, 2, 1, 0]]) {
    for (const k of order) {
      M.transformPoint(mat, q[k][0], q[k][1], q[k][2], _v);
      buf.v(Math.round(_v[0] * 256), Math.round(_v[1] * 256), Math.round(_v[2] * 256), q[k][3], q[k][4], layer, sky, bl, shadeV, color[0], color[1], color[2], 0);
    }
  }
}

export function tmpMat() {
  return _m;
}
