// Génération procédurale de toutes les textures 16x16 (blocs, objets, particules)
import { Painter, hex, shade, mix } from './paint.js';

const T = {}; // textures de blocs
const IT = {}; // icônes d'objets

// ---------- Helpers ----------
function cobble(p, base = [122, 122, 122], mortar = [72, 72, 72], seeds = 10) {
  const pts = [];
  for (let i = 0; i < seeds; i++) pts.push([p.r() * 16, p.r() * 16, 0.8 + p.r() * 0.35]);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      let d1 = 1e9, d2 = 1e9, best = 0;
      for (let i = 0; i < pts.length; i++) {
        for (let ox = -16; ox <= 16; ox += 16)
          for (let oy = -16; oy <= 16; oy += 16) {
            const dx = x + 0.5 - pts[i][0] - ox, dy = y + 0.5 - pts[i][1] - oy;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
          }
      }
      if (d2 - d1 < 1.1) p.set(x, y, shade(mortar, 0.9 + p.r() * 0.2));
      else {
        const f = pts[best][2] * (1.08 - d1 * 0.04);
        p.set(x, y, shade(base, f * (0.93 + p.r() * 0.14)));
      }
    }
}

function planks(p, base, dark) {
  p.noise(base, 0.04);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const streak = Math.sin((x * 0.9 + (y >> 2) * 7) * 1.3) * 0.04;
      p.set(x, y, shade(p.get(x, y), 1 + streak));
    }
  for (let b = 0; b < 4; b++) {
    p.hline(0, b * 4 + 3, 16, dark);
    const sx = (b * 7 + 3) % 16;
    p.vline(sx, b * 4, 3, shade(dark, 1.1));
  }
}

function logSide(p, base, dark, light) {
  for (let x = 0; x < 16; x++) {
    const col = x % 4 === 0 ? dark : x % 4 === 2 ? light : base;
    for (let y = 0; y < 16; y++) p.set(x, y, shade(col, 0.9 + p.r() * 0.18));
  }
  for (let i = 0; i < 6; i++) {
    const x = p.ri(16), y = p.ri(16), l = 2 + p.ri(4);
    p.vline(x, y, l, shade(dark, 0.85));
  }
}

function logTop(p, ring1, ring2, bark) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const dx = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5));
      if (dx > 6.5) p.set(x, y, shade(bark, 0.9 + p.r() * 0.2));
      else p.set(x, y, shade(Math.floor(dx) % 2 ? ring1 : ring2, 0.95 + p.r() * 0.1));
    }
}

function leaves(p, dens = 0.22, base = 150) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      if (p.r() < dens) { p.set(x, y, [0, 0, 0, 0]); continue; }
      const v = base * (0.7 + p.r() * 0.5);
      p.set(x, y, [v, v, v, 255]);
    }
  // quelques trous groupés
  for (let i = 0; i < 4; i++) {
    const x = p.ri(15), y = p.ri(15);
    p.set(x, y, [0, 0, 0, 0]); p.set(x + 1, y, [0, 0, 0, 0]);
  }
}

function ore(p, color, count = 5, stoneBase = null) {
  if (stoneBase) stoneBase(p); else T.stone(p);
  const c = hex(color);
  for (let n = 0; n < count; n++) {
    const cx = 2 + p.ri(12), cy = 2 + p.ri(12);
    const size = 2 + p.ri(3);
    for (let k = 0; k < size; k++) {
      const x = cx + p.ri(3) - 1, y = cy + p.ri(3) - 1;
      p.set(x, y, shade(c, 0.9 + p.r() * 0.25));
      p.set(x + 1, y + 1, shade(c, 0.6));
    }
  }
}

function mineralBlock(p, base, light, dark) {
  p.noise(base, 0.04);
  p.bevel(light, dark);
  p.bevel(shade(light, 0.95), shade(dark, 1.05), 1, 1, 14, 14);
  for (let i = 0; i < 5; i++) {
    const x = 3 + p.ri(9), y = 3 + p.ri(9);
    p.set(x, y, light); p.set(x + 1, y - 1, light);
  }
}

function bricksPattern(p, brick, mortar, bw = 8, bh = 4) {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const row = Math.floor(y / bh);
      const off = row % 2 ? bw / 2 : 0;
      const isM = y % bh === bh - 1 || (x + off) % bw === bw - 1;
      p.set(x, y, isM ? shade(mortar, 0.9 + p.r() * 0.15) : shade(brick, 0.88 + p.r() * 0.2));
    }
}

function wool(p, c) {
  p.noise(c, 0.05);
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) if ((x + y * 3) % 7 === 0) p.set(x, y, shade(p.get(x, y), 0.9));
}

function plantStem(p, x, y0, y1, c) {
  for (let y = y0; y <= y1; y++) p.set(x, y, shade(c, 0.9 + p.r() * 0.2));
}

// ---------- Textures de blocs ----------
T.stone = (p) => {
  p.noise([125, 125, 125], 0.07);
  for (let i = 0; i < 12; i++) {
    const x = p.ri(16), y = p.ri(16), l = 2 + p.ri(3);
    for (let k = 0; k < l; k++) p.set((x + k) % 16, y, shade([125, 125, 125], 0.8 + p.r() * 0.08));
  }
  for (let i = 0; i < 8; i++) p.set(p.ri(16), p.ri(16), [145, 145, 145]);
};
T.smooth_stone = (p) => { p.noise([158, 158, 158], 0.03); p.border([120, 120, 120]); };
T.smooth_stone_slab_side = (p) => { p.noise([158, 158, 158], 0.03); p.border([120, 120, 120]); p.hline(0, 7, 16, [120, 120, 120]); p.hline(0, 8, 16, [120, 120, 120]); };
T.granite = (p) => { p.noise([149, 103, 85], 0.08); p.speckle([175, 120, 100], 30); p.speckle([110, 70, 60], 20); p.speckle([200, 170, 160], 6); };
T.diorite = (p) => { p.noise([188, 188, 188], 0.06); p.speckle([230, 230, 230], 30); p.speckle([120, 120, 120], 25); };
T.andesite = (p) => { p.noise([136, 136, 136], 0.06); p.speckle([160, 160, 160], 30); p.speckle([100, 100, 100], 25, 2); };
T.cobblestone = (p) => cobble(p);
T.mossy_cobblestone = (p) => {
  cobble(p);
  for (let i = 0; i < 40; i++) {
    const x = p.ri(16), y = p.ri(16);
    p.set(x, y, shade([82, 110, 50], 0.8 + p.r() * 0.4));
  }
  p.blobs([70, 105, 45], 6, 3, 6, 0);
};
T.dirt = (p) => {
  p.noise([134, 96, 67], 0.1);
  p.speckle([105, 75, 50], 25);
  p.speckle([155, 115, 85], 12);
};
T.grass_top = (p) => {
  p.noise([150, 150, 150], 0.13);
  p.speckle([120, 120, 120], 30);
  p.speckle([175, 175, 175], 15);
};
function grassSide(p, green, snowy) {
  T.dirt(p);
  for (let x = 0; x < 16; x++) {
    const h = 3 + (p.r() < 0.5 ? 1 : 0) + (p.r() < 0.25 ? 1 : 0) - (p.r() < 0.2 ? 1 : 0);
    for (let y = 0; y < h; y++) p.set(x, y, shade(green, 0.85 + p.r() * 0.25));
  }
  if (!snowy) for (let i = 0; i < 4; i++) p.set(p.ri(16), 4 + p.ri(2), shade(green, 0.8));
}
T.grass_side = (p) => grassSide(p, [98, 145, 57]);
T.grass_side_snowy = (p) => grassSide(p, [240, 248, 250], true);
T.sand = (p) => { p.noise([219, 207, 163], 0.05); p.speckle([200, 185, 140], 20); p.speckle([235, 225, 190], 10); };
T.gravel = (p) => {
  p.noise([130, 124, 122], 0.08);
  for (let i = 0; i < 28; i++) {
    const c = p.pick ? null : null;
    void c;
    const cols = [[100, 94, 92], [165, 160, 158], [120, 105, 100], [145, 140, 138]];
    const col = cols[p.ri(4)];
    const x = p.ri(16), y = p.ri(16), s = 1 + p.ri(2);
    p.rect(x, y, s, s, shade(col, 0.9 + p.r() * 0.2));
    p.set(x + s, y + s, [80, 76, 75]);
  }
};
T.bedrock = (p) => {
  for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
    const v = p.r() < 0.5 ? 40 + p.r() * 30 : 85 + p.r() * 40;
    p.set(x, y, [v, v, v]);
  }
};
T.oak_log = (p) => logSide(p, [102, 81, 49], [74, 58, 34], [120, 96, 60]);
T.oak_log_top = (p) => logTop(p, [176, 142, 88], [153, 122, 73], [102, 81, 49]);
T.oak_planks = (p) => planks(p, [162, 130, 78], [117, 92, 55]);
T.oak_leaves = (p) => leaves(p, 0.2, 150);
T.birch_log = (p) => {
  p.noise([216, 215, 210], 0.04);
  for (let i = 0; i < 9; i++) {
    const x = p.ri(16), y = p.ri(16), l = 2 + p.ri(4);
    p.hline(x, y, l, [40, 40, 36]);
    if (p.r() < 0.5) p.hline(x + 1, y + 1, l - 1, [80, 80, 70]);
  }
};
T.birch_log_top = (p) => logTop(p, [205, 187, 130], [190, 170, 115], [216, 215, 210]);
T.birch_planks = (p) => planks(p, [196, 178, 123], [150, 132, 88]);
T.birch_leaves = (p) => leaves(p, 0.2, 150);
T.spruce_log = (p) => logSide(p, [58, 37, 16], [40, 26, 10], [75, 52, 28]);
T.spruce_log_top = (p) => logTop(p, [120, 90, 55], [100, 74, 44], [58, 37, 16]);
T.spruce_planks = (p) => planks(p, [115, 85, 52], [80, 58, 34]);
T.spruce_leaves = (p) => leaves(p, 0.12, 130);
T.coal_ore = (p) => ore(p, [30, 30, 30], 6);
T.iron_ore = (p) => ore(p, [216, 175, 147], 5);
T.gold_ore = (p) => ore(p, [252, 238, 75], 5);
T.diamond_ore = (p) => ore(p, [93, 236, 245], 5);
T.redstone_ore = (p) => ore(p, [220, 0, 0], 6);
T.lapis_ore = (p) => ore(p, [31, 64, 180], 6);
T.emerald_ore = (p) => ore(p, [23, 221, 98], 4);
T.nether_quartz_ore = (p) => ore(p, [235, 230, 222], 6, T.netherrack);
T.glass = (p) => {
  p.clear();
  p.border([215, 235, 240]);
  p.hline(1, 1, 3, [240, 250, 255]); p.vline(1, 1, 3, [240, 250, 255]);
  p.set(4, 5, [230, 245, 250]); p.set(5, 4, [230, 245, 250]); p.set(10, 11, [230, 245, 250]); p.set(11, 10, [230, 245, 250]);
};
T.glass_pane = T.glass;
T.sandstone = (p) => {
  p.noise([216, 203, 155], 0.04);
  p.rectNoise(0, 0, 16, 3, [224, 213, 168], 0.03);
  p.hline(0, 3, 16, [196, 182, 135]);
  p.rectNoise(0, 12, 16, 4, [205, 190, 140], 0.05);
  p.hline(0, 11, 16, [196, 182, 135]);
};
T.sandstone_top = (p) => { p.noise([219, 207, 160], 0.03); };
T.sandstone_bottom = (p) => { p.noise([214, 200, 152], 0.05); p.speckle([190, 175, 130], 12); };
T.white_wool = (p) => wool(p, [234, 236, 237]);
T.blue_wool = (p) => wool(p, [53, 57, 157]);
T.red_wool = (p) => wool(p, [161, 39, 34]);
T.yellow_wool = (p) => wool(p, [248, 197, 39]);
T.green_wool = (p) => wool(p, [84, 109, 27]);
T.black_wool = (p) => wool(p, [25, 25, 30]);
function flowerTex(p, petal, center, stemH = 7) {
  p.clear();
  plantStem(p, 7, 16 - stemH, 15, [60, 130, 40]);
  p.set(6, 13, [70, 140, 45]); p.set(8, 11, [70, 140, 45]); p.set(5, 12, [60, 125, 40]); p.set(9, 10, [60, 125, 40]);
  const cy = 16 - stemH - 2;
  p.rect(6, cy - 1, 3, 3, petal);
  p.set(7, cy - 2, petal); p.set(7, cy + 2, petal); p.set(5, cy, petal); p.set(9, cy, petal);
  p.set(7, cy, center);
}
T.dandelion = (p) => { flowerTex(p, [245, 220, 40], [230, 170, 20], 6); };
T.poppy = (p) => { flowerTex(p, [210, 30, 30], [40, 20, 10], 7); p.set(6, 7, [170, 20, 20]); };
T.cornflower = (p) => { flowerTex(p, [80, 110, 230], [200, 200, 255], 7); };
T.oxeye_daisy = (p) => { flowerTex(p, [240, 240, 240], [240, 200, 40], 7); };
T.brown_mushroom = (p) => {
  p.clear();
  p.rect(7, 10, 2, 6, [210, 200, 180]);
  p.rect(5, 8, 6, 2, [150, 112, 88]); p.rect(6, 7, 4, 1, [165, 125, 98]);
};
T.red_mushroom = (p) => {
  p.clear();
  p.rect(7, 10, 2, 6, [220, 210, 190]);
  p.rect(4, 7, 8, 3, [205, 35, 35]); p.rect(5, 6, 6, 1, [215, 45, 45]); p.rect(6, 5, 4, 1, [215, 45, 45]);
  p.set(6, 7, [255, 255, 255]); p.set(9, 8, [255, 255, 255]); p.set(8, 6, [255, 255, 255]);
};
function sapling(p, leaf) {
  p.clear();
  plantStem(p, 7, 9, 15, [95, 70, 40]);
  plantStem(p, 8, 11, 15, [85, 62, 35]);
  for (let i = 0; i < 26; i++) {
    const x = 3 + p.ri(10), y = 2 + p.ri(9);
    if (Math.hypot(x - 7.5, y - 6) < 5) p.set(x, y, shade(leaf, 0.8 + p.r() * 0.4));
  }
}
T.oak_sapling = (p) => sapling(p, [70, 120, 40]);
T.birch_sapling = (p) => sapling(p, [110, 150, 70]);
T.spruce_sapling = (p) => sapling(p, [50, 85, 50]);
T.short_grass = (p) => {
  p.clear();
  for (let i = 0; i < 9; i++) {
    const x = 1 + p.ri(14), h = 5 + p.ri(9);
    for (let y = 16 - h; y < 16; y++) {
      const v = 120 + p.r() * 60;
      p.set(x + (y < 8 && p.r() < 0.3 ? (p.r() < 0.5 ? -1 : 1) : 0), y, [v, v, v]);
    }
  }
};
T.fern = (p) => {
  p.clear();
  for (let i = 0; i < 4; i++) {
    const x = 3 + i * 3;
    for (let y = 4 + p.ri(3); y < 16; y++) {
      const v = 110 + p.r() * 50;
      p.set(x, y, [v, v, v]);
      if (y % 2 === 0) { p.set(x - 1, y, [v * 0.9, v * 0.9, v * 0.9]); p.set(x + 1, y - 1, [v, v, v]); }
    }
  }
};
T.dead_bush = (p) => {
  p.clear();
  const c = [110, 80, 40];
  p.line(7, 15, 7, 9, c); p.line(7, 11, 3, 6, c); p.line(7, 10, 12, 4, c); p.line(5, 8, 5, 4, c); p.line(10, 6, 13, 7, c); p.line(7, 9, 8, 3, c);
};
T.sugar_cane = (p) => {
  p.clear();
  for (const x of [3, 8, 12]) {
    for (let y = 0; y < 16; y++) p.set(x, y, y % 5 === 0 ? [110, 150, 70] : shade([150, 195, 100], 0.9 + p.r() * 0.15));
    for (let y = 0; y < 16; y++) p.set(x + 1, y, y % 5 === 0 ? [90, 130, 55] : [125, 170, 80]);
    p.set(x - 1, 3 + p.ri(8), [120, 170, 70]);
  }
};
T.cobweb = (p) => {
  p.clear();
  const c = [230, 230, 230, 220];
  p.line(0, 0, 15, 15, c); p.line(15, 0, 0, 15, c); p.line(8, 0, 8, 15, c); p.line(0, 8, 15, 8, c);
  for (let r = 3; r < 9; r += 3) {
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      p.set(Math.round(8 + Math.cos(ang) * r), Math.round(8 + Math.sin(ang) * r), c);
    }
  }
};
for (let s = 0; s < 8; s++) {
  T['wheat_stage' + s] = (p) => {
    p.clear();
    const h = 2 + s * 2;
    const ripe = s === 7;
    for (let i = 0; i < 6; i++) {
      const x = 1 + i * 2 + (i > 2 ? 1 : 0);
      for (let y = 16 - h; y < 16; y++) {
        const g = ripe ? [190, 165, 70] : s > 4 ? [140, 160, 60] : [70, 160, 50];
        p.set(x, y, shade(g, 0.85 + p.r() * 0.25));
      }
      if (s >= 5) {
        const hc = ripe ? [220, 190, 90] : [160, 170, 70];
        p.rect(x, 16 - h, 1, 3, hc);
        p.set(x - 1, 16 - h + 1, shade(hc, 0.9)); p.set(x + 1, 16 - h + 2, shade(hc, 0.9));
      }
    }
  };
}
T.gold_block = (p) => mineralBlock(p, [249, 212, 40], [255, 250, 150], [200, 150, 20]);
T.iron_block = (p) => mineralBlock(p, [220, 220, 220], [255, 255, 255], [160, 160, 160]);
T.diamond_block = (p) => mineralBlock(p, [98, 230, 225], [200, 255, 250], [40, 170, 165]);
T.emerald_block = (p) => mineralBlock(p, [60, 210, 110], [170, 255, 200], [20, 140, 60]);
T.lapis_block = (p) => mineralBlock(p, [38, 70, 160], [90, 130, 220], [20, 40, 110]);
T.coal_block = (p) => mineralBlock(p, [22, 22, 22], [60, 60, 60], [8, 8, 8]);
T.redstone_block = (p) => mineralBlock(p, [175, 25, 10], [230, 70, 50], [120, 10, 5]);
T.bricks = (p) => bricksPattern(p, [150, 74, 58], [185, 175, 165]);
T.tnt_side = (p) => {
  p.noise([219, 68, 26], 0.05);
  for (let x = 1; x < 16; x += 4) p.vline(x, 0, 16, [180, 50, 20]);
  p.rectNoise(0, 5, 16, 6, [230, 230, 225], 0.03);
  const L = ['.XXX.X..X.XXX.', '..X..XX.X..X..', '..X..X.XX..X..', '..X..X..X..X..'];
  void L;
  const txt = [
    'XXX.X..X.XXX',
    '.X..XX.X..X.',
    '.X..X.XX..X.',
    '.X..X..X..X.',
  ];
  for (let y = 0; y < 4; y++) for (let x = 0; x < 12; x++) if (txt[y][x] === 'X') p.set(2 + x, 6 + y, [30, 30, 30]);
};
T.tnt_top = (p) => { p.noise([200, 70, 40], 0.05); p.border([150, 50, 25]); p.circle(8, 8, 2.5, [70, 70, 70]); p.set(8, 7, [40, 40, 40]); };
T.tnt_bottom = (p) => { p.noise([190, 60, 30], 0.05); p.border([150, 50, 25]); };
T.bookshelf = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  const cols = [[160, 40, 40], [40, 60, 160], [50, 120, 50], [130, 90, 50], [200, 170, 60], [110, 50, 130], [60, 110, 120]];
  for (const row of [1, 9]) {
    p.rect(0, row, 16, 6, [60, 45, 25]);
    let x = 1;
    while (x < 15) {
      const w = 1 + (p.r() < 0.4 ? 1 : 0), h = 4 + p.ri(3);
      const c = cols[p.ri(cols.length)];
      p.rect(x, row + 6 - h, w, h, c);
      p.vline(x, row + 6 - h, h, shade(c, 1.3));
      x += w + (p.r() < 0.2 ? 1 : 0);
    }
  }
  p.hline(0, 0, 16, [117, 92, 55]); p.hline(0, 7, 16, [117, 92, 55]); p.hline(0, 8, 16, [162, 130, 78]); p.hline(0, 15, 16, [117, 92, 55]);
};
T.obsidian = (p) => {
  p.noise([22, 18, 32], 0.15);
  p.speckle([55, 35, 85], 20);
  p.speckle([85, 65, 120], 8);
};
T.crying_obsidian = (p) => {
  T.obsidian(p);
  for (let i = 0; i < 5; i++) { const x = p.ri(16), y = p.ri(12); p.vline(x, y, 2 + p.ri(3), [150, 50, 230]); }
};
T.torch = (p) => {
  p.clear();
  p.rect(7, 8, 2, 8, [120, 90, 50]);
  p.set(8, 9, [95, 70, 35]); p.set(7, 12, [95, 70, 35]);
  p.rect(7, 6, 2, 2, [255, 225, 90]);
  p.set(7, 6, [255, 255, 200]); p.set(8, 7, [255, 170, 40]);
};
T.fire = (p) => {
  p.clear();
  for (let x = 0; x < 16; x++) {
    const h = 6 + Math.floor(Math.abs(Math.sin(x * 1.7)) * 8) + p.ri(3);
    for (let y = 16 - h; y < 16; y++) {
      const t = (y - (16 - h)) / h;
      const c = t < 0.3 ? [255, 240, 120] : t < 0.6 ? [255, 170, 40] : [230, 90, 20];
      if (p.r() < 0.9) p.set(x, y, shade(c, 0.9 + p.r() * 0.15));
    }
  }
};
T.spawner = (p) => {
  p.clear();
  const c = [35, 45, 55];
  p.border(c); p.border([55, 65, 80], 1, 1, 14, 14);
  p.vline(5, 0, 16, c); p.vline(10, 0, 16, c); p.hline(0, 5, 16, c); p.hline(0, 10, 16, c);
};
function chestTex(p, wood, dark, latch, front, top) {
  p.noise(wood, 0.06);
  for (let y = 0; y < 16; y++) if (y % 4 === 2) p.hline(0, y, 16, shade(wood, 0.85));
  p.border(dark);
  if (!top) p.hline(0, 5, 16, dark);
  if (front) { p.rect(7, 4, 2, 4, latch); p.set(7, 4, shade(latch, 1.2)); }
}
T.chest_side = (p) => chestTex(p, [160, 110, 50], [70, 45, 20]);
T.chest_front = (p) => chestTex(p, [160, 110, 50], [70, 45, 20], [210, 210, 210], true);
T.chest_top = (p) => chestTex(p, [165, 115, 55], [70, 45, 20], null, false, true);
T.ender_chest_side = (p) => chestTex(p, [25, 45, 45], [10, 20, 20]);
T.ender_chest_front = (p) => chestTex(p, [25, 45, 45], [10, 20, 20], [60, 180, 150], true);
T.ender_chest_top = (p) => chestTex(p, [25, 45, 45], [10, 20, 20], null, false, true);
T.crafting_table_top = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.border([90, 65, 35]);
  p.rect(2, 2, 12, 12, [140, 105, 60]);
  for (let i = 2; i < 14; i += 4) { p.hline(2, i, 12, [95, 70, 40]); p.vline(i, 2, 12, [95, 70, 40]); }
  p.hline(2, 13, 12, [95, 70, 40]); p.vline(13, 2, 12, [95, 70, 40]);
};
T.crafting_table_side = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.rect(0, 0, 16, 3, [120, 85, 50]); p.hline(0, 3, 16, [80, 60, 35]);
  // scie
  p.rect(3, 6, 6, 2, [180, 180, 180]); p.rect(9, 6, 2, 3, [110, 80, 40]);
  // marteau
  p.rect(11, 9, 3, 2, [140, 140, 140]); p.vline(12, 11, 4, [110, 80, 40]);
};
T.crafting_table_front = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.rect(0, 0, 16, 3, [120, 85, 50]); p.hline(0, 3, 16, [80, 60, 35]);
  p.rect(3, 6, 2, 8, [110, 80, 40]); p.rect(2, 5, 4, 2, [150, 150, 150]);
  p.rect(10, 6, 2, 8, [110, 80, 40]); p.rect(9, 5, 4, 1, [170, 170, 170]); p.set(12, 6, [170, 170, 170]);
};
T.furnace_side = (p) => { p.noise([118, 118, 118], 0.06); p.border([90, 90, 90]); p.hline(0, 0, 16, [140, 140, 140]); };
T.furnace_top = (p) => { p.noise([110, 110, 110], 0.05); p.border([85, 85, 85]); };
T.furnace_front = (p) => {
  T.furnace_side(p);
  p.rect(3, 2, 10, 3, [70, 70, 70]); p.rect(4, 3, 8, 1, [40, 40, 40]);
  p.rect(3, 8, 10, 6, [70, 70, 70]); p.rect(4, 9, 8, 4, [25, 25, 25]);
};
T.furnace_front_on = (p) => {
  T.furnace_front(p);
  for (let x = 4; x < 12; x++) {
    const h = 1 + p.ri(4);
    for (let y = 13 - h; y < 13; y++) p.set(x, y, y > 11 ? [255, 200, 60] : [255, 130, 30]);
  }
};
T.farmland = (p) => { p.noise([120, 85, 55], 0.08); for (let y = 1; y < 16; y += 4) p.hline(0, y, 16, [90, 62, 40]); p.border([100, 70, 45]); };
T.farmland_moist = (p) => { p.noise([70, 45, 28], 0.08); for (let y = 1; y < 16; y += 4) p.hline(0, y, 16, [50, 32, 20]); p.border([60, 40, 25]); };
T.door_top = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.border([100, 75, 40]);
  p.rect(3, 3, 4, 5, [0, 0, 0, 0]); p.rect(9, 3, 4, 5, [0, 0, 0, 0]);
  p.vline(8, 2, 7, [100, 75, 40]);
};
T.door_bottom = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.border([100, 75, 40]);
  p.border([130, 100, 60], 3, 2, 10, 11);
  p.set(12, 1, [60, 60, 60]); p.set(12, 2, [60, 60, 60]);
};
T.trapdoor = (p) => {
  planks(p, [162, 130, 78], [117, 92, 55]);
  p.border([100, 75, 40]);
  p.rect(3, 3, 3, 3, [0, 0, 0, 0]); p.rect(10, 3, 3, 3, [0, 0, 0, 0]); p.rect(3, 10, 3, 3, [0, 0, 0, 0]); p.rect(10, 10, 3, 3, [0, 0, 0, 0]);
};
T.ladder = (p) => {
  p.clear();
  const c = [125, 95, 55], d = [90, 68, 38];
  p.rect(2, 0, 2, 16, c); p.rect(12, 0, 2, 16, c); p.vline(3, 0, 16, d); p.vline(13, 0, 16, d);
  for (let y = 1; y < 16; y += 4) { p.rect(2, y, 12, 2, c); p.hline(2, y + 1, 12, d); }
};
T.snow = (p) => { p.noise([242, 250, 250], 0.02); p.speckle([220, 235, 245], 12); };
T.snow_block = T.snow;
T.ice = (p) => {
  p.fill([150, 185, 250, 180]);
  for (let i = 0; i < 6; i++) { const x = p.ri(14), y = p.ri(14); p.line(x, y, x + 2, y + 2, [220, 235, 255, 200]); }
};
T.packed_ice = (p) => { p.noise([160, 190, 245], 0.04); for (let i = 0; i < 6; i++) { const x = p.ri(14), y = p.ri(14); p.line(x, y, x + 2, y + 2, [220, 235, 255]); } };
T.cactus_side = (p) => {
  p.noise([86, 125, 40], 0.08);
  for (const x of [0, 4, 8, 12]) p.vline(x, 0, 16, [60, 95, 28]);
  for (let i = 0; i < 10; i++) { const x = p.ri(16), y = p.ri(16); p.set(x, y, [210, 220, 170]); }
};
T.cactus_top = (p) => { p.noise([100, 145, 50], 0.06); p.border([70, 105, 35]); p.border([85, 125, 42], 3, 3, 10, 10); p.set(7, 7, [60, 90, 30]); };
T.cactus_bottom = (p) => { p.noise([150, 170, 100], 0.05); p.border([70, 105, 35]); };
T.clay = (p) => { p.noise([160, 166, 179], 0.05); p.speckle([140, 146, 160], 15); };
T.pumpkin_side = (p) => { p.noise([227, 144, 29], 0.06); for (const x of [0, 5, 10, 15]) p.vline(x, 0, 16, [190, 110, 15]); };
T.pumpkin_top = (p) => { p.noise([220, 140, 30], 0.06); p.border([190, 110, 15]); p.rect(7, 7, 2, 2, [100, 80, 30]); };
function pumpkinFace(p, glow) {
  T.pumpkin_side(p);
  const c = glow ? [255, 220, 80] : [45, 25, 5];
  p.rect(3, 4, 3, 3, c); p.rect(10, 4, 3, 3, c);
  p.rect(3, 10, 10, 2, c); p.rect(4, 12, 8, 1, c); p.set(5, 9, c); p.set(10, 9, c);
  if (glow) { p.set(4, 5, [255, 250, 180]); p.set(11, 5, [255, 250, 180]); }
}
T.pumpkin_face = (p) => pumpkinFace(p, false);
T.jack_o_lantern = (p) => pumpkinFace(p, true);
T.netherrack = (p) => {
  p.noise([111, 54, 52], 0.14);
  p.speckle([80, 32, 32], 30);
  p.speckle([140, 75, 70], 12);
};
T.soul_sand = (p) => {
  p.noise([84, 64, 51], 0.1);
  for (let i = 0; i < 4; i++) {
    const x = 1 + p.ri(12), y = 1 + p.ri(12);
    p.set(x, y, [55, 40, 32]); p.set(x + 2, y, [55, 40, 32]); p.rect(x, y + 2, 3, 1, [60, 45, 36]);
  }
};
T.glowstone = (p) => {
  cobble(p, [230, 180, 100], [140, 100, 50], 9);
  p.speckle([255, 240, 180], 18);
};
T.nether_portal = (p) => {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = Math.sin(x * 0.8 + Math.sin(y * 0.6) * 2) * 0.5 + 0.5;
      p.set(x, y, [90 + v * 80, 20 + v * 40, 170 + v * 70, 190]);
    }
};
T.stone_bricks = (p) => {
  p.noise([122, 122, 122], 0.05);
  const m = [85, 85, 85], l = [150, 150, 150];
  p.hline(0, 7, 16, m); p.hline(0, 15, 16, m);
  p.vline(7, 0, 7, m); p.vline(15, 8, 7, m);
  p.hline(0, 0, 7, l); p.hline(8, 0, 7, l); p.hline(0, 8, 15, l);
};
T.mossy_stone_bricks = (p) => {
  T.stone_bricks(p);
  for (let i = 0; i < 30; i++) { const x = p.ri(16), y = p.ri(16); p.set(x, y, shade([82, 110, 50], 0.8 + p.r() * 0.4)); }
  p.blobs([70, 105, 45], 5, 3, 6, 0);
};
T.cracked_stone_bricks = (p) => {
  T.stone_bricks(p);
  p.line(3, 1, 6, 5, [70, 70, 70]); p.line(6, 5, 5, 7, [70, 70, 70]); p.line(10, 9, 13, 13, [70, 70, 70]); p.line(12, 9, 11, 11, [70, 70, 70]);
};
T.nether_bricks = (p) => bricksPattern(p, [48, 24, 28], [26, 13, 15], 8, 4);
T.end_stone_bricks = (p) => bricksPattern(p, [219, 222, 160], [170, 172, 115], 8, 8);
T.purpur_block = (p) => { p.noise([165, 120, 165], 0.05); p.border([130, 90, 130]); p.border([185, 145, 185], 1, 1, 14, 14); };
T.enchanting_table_top = (p) => {
  p.noise([20, 16, 30], 0.1);
  p.rect(2, 2, 12, 12, [150, 30, 35]);
  p.border([40, 20, 20], 2, 2, 12, 12);
  for (const [x, y] of [[1, 1], [13, 1], [1, 13], [13, 13]]) p.rect(x, y, 2, 2, [90, 240, 230]);
};
T.enchanting_table_side = (p) => {
  p.noise([22, 18, 32], 0.15);
  p.rect(0, 4, 16, 3, [150, 30, 35]);
  p.hline(0, 7, 16, [100, 20, 25]);
  p.speckle([55, 35, 85], 10, 1, (x, y) => y > 8);
};
T.enchanting_table_bottom = (p) => T.obsidian(p);
T.end_stone = (p) => {
  p.noise([219, 222, 158], 0.05);
  p.speckle([190, 192, 130], 25);
  for (let i = 0; i < 5; i++) { const x = p.ri(15), y = p.ri(15); p.set(x, y, [170, 170, 115]); p.set(x + 1, y, [200, 200, 140]); }
};
T.end_portal_frame_top = (p) => {
  p.noise([70, 105, 90], 0.08);
  p.border([45, 75, 60]);
  p.rect(4, 4, 8, 8, [30, 50, 42]);
  p.border([95, 135, 115], 3, 3, 10, 10);
};
T.end_portal_frame_side = (p) => {
  T.end_stone(p);
  p.rectNoise(0, 3, 16, 3, [70, 105, 90], 0.08);
  p.hline(0, 6, 16, [45, 75, 60]);
};
T.end_portal_frame_eye = (p) => {
  p.noise([30, 90, 70], 0.1);
  p.circle(8, 8, 4, [50, 140, 110]);
  p.circle(8, 8, 2, [10, 30, 20]);
  p.set(6, 6, [180, 255, 220]);
};
T.end_portal = (p) => {
  p.fill([8, 12, 18]);
  const cols = [[40, 90, 90], [60, 140, 120], [20, 60, 80], [120, 200, 180], [220, 240, 230]];
  for (let i = 0; i < 26; i++) p.set(p.ri(16), p.ri(16), cols[p.ri(cols.length)]);
};
T.dragon_egg = (p) => { p.noise([14, 10, 18], 0.2); p.speckle([60, 20, 85], 20); p.speckle([100, 50, 130], 5); };
T.iron_bars = (p) => {
  p.clear();
  const c = [75, 75, 78], l = [120, 120, 125];
  for (let x = 0; x < 16; x++) if (x % 4 === 3 || x % 4 === 0) p.vline(x, 0, 16, x % 4 === 3 ? l : c);
  p.hline(0, 2, 16, c); p.hline(0, 13, 16, c);
};
T.bed_head_top = (p) => {
  p.noise([160, 30, 30], 0.05);
  p.rectNoise(2, 1, 12, 5, [235, 235, 235], 0.03);
  p.hline(0, 0, 16, [140, 100, 60]);
};
T.bed_foot_top = (p) => {
  p.noise([160, 30, 30], 0.05);
  p.hline(0, 15, 16, [140, 100, 60]);
  p.hline(0, 3, 16, [185, 45, 45]);
};
T.bed_head_side = (p) => {
  p.clear();
  p.rectNoise(0, 7, 16, 3, [160, 30, 30], 0.05);
  p.rectNoise(0, 7, 6, 2, [235, 235, 235], 0.03);
  p.rectNoise(0, 10, 16, 3, [150, 110, 70], 0.05);
};
T.bed_foot_side = (p) => {
  p.clear();
  p.rectNoise(0, 7, 16, 3, [160, 30, 30], 0.05);
  p.rectNoise(0, 10, 16, 3, [150, 110, 70], 0.05);
};
T.bed_head_end = (p) => { p.clear(); p.rectNoise(0, 7, 16, 6, [150, 110, 70], 0.05); p.hline(0, 7, 16, [120, 85, 50]); };
T.bed_foot_end = (p) => { p.clear(); p.rectNoise(0, 7, 16, 3, [160, 30, 30], 0.05); p.rectNoise(0, 10, 16, 3, [150, 110, 70], 0.05); };
T.bed_side_plain = (p) => { p.clear(); p.rectNoise(0, 7, 16, 6, [150, 110, 70], 0.05); };
T.quartz_block = (p) => { p.noise([235, 229, 222], 0.02); p.border([220, 212, 205]); };
T.quartz_block_top = (p) => { p.noise([236, 231, 224], 0.02); };
T.melon_side = (p) => { p.noise([115, 160, 40], 0.06); for (let x = 1; x < 16; x += 3) p.vline(x, 0, 16, [80, 120, 25]); };
T.melon_top = (p) => { p.noise([110, 150, 40], 0.06); p.border([80, 120, 25]); p.rect(7, 7, 2, 2, [90, 80, 30]); };
T.hay_block_side = (p) => {
  p.noise([200, 170, 40], 0.08);
  for (let x = 0; x < 16; x += 2) p.vline(x, 0, 16, [175, 145, 30]);
  p.rect(0, 3, 16, 2, [150, 60, 30]); p.rect(0, 11, 16, 2, [150, 60, 30]);
};
T.hay_block_top = (p) => { p.noise([190, 160, 40], 0.12); p.border([150, 60, 30]); };
T.magma_block = (p) => {
  p.noise([110, 35, 10], 0.15);
  for (let i = 0; i < 7; i++) {
    let x = p.ri(16), y = p.ri(16);
    for (let k = 0; k < 5; k++) {
      p.set(x, y, [255, 130 + p.ri(60), 20]);
      x += p.ri(3) - 1; y += p.ri(3) - 1;
    }
  }
};
T.bone_block_side = (p) => { p.noise([226, 222, 200], 0.04); for (let x = 0; x < 16; x += 5) p.vline(x, 0, 16, [200, 196, 175]); };
T.bone_block_top = (p) => { p.noise([226, 222, 200], 0.04); p.circle(8, 8, 5, [210, 205, 185]); p.circle(8, 8, 2.5, [226, 222, 200]); };
T.dirt_path_top = (p) => { p.noise([148, 122, 65], 0.08); p.speckle([125, 100, 50], 15); };
T.dirt_path_side = (p) => { T.dirt(p); p.rectNoise(0, 0, 16, 2, [148, 122, 65], 0.08); };
T.cake_top = (p) => { p.noise([240, 238, 235], 0.03); p.border([220, 215, 210]); for (let i = 0; i < 6; i++) p.set(2 + p.ri(12), 2 + p.ri(12), [200, 30, 30]); };
T.cake_side = (p) => { p.clear(); p.rectNoise(0, 8, 16, 2, [240, 238, 235], 0.03); p.rectNoise(0, 10, 16, 6, [185, 120, 70], 0.08); p.hline(0, 12, 16, [230, 225, 220]); };
T.cake_bottom = (p) => { p.noise([150, 95, 55], 0.05); };
T.cake_inner = (p) => { p.clear(); p.rectNoise(0, 8, 16, 2, [240, 238, 235], 0.03); p.rectNoise(0, 10, 16, 6, [215, 170, 110], 0.08); };
T.lantern = (p) => {
  p.clear();
  p.rect(0, 2, 6, 7, [55, 60, 70]); p.rect(1, 3, 4, 5, [255, 200, 90]); p.rect(2, 4, 2, 3, [255, 245, 190]);
  p.rect(1, 0, 4, 2, [55, 60, 70]);
  p.rect(0, 9, 6, 6, [60, 65, 75]); p.rect(1, 10, 4, 4, [255, 210, 110]);
};
T.brewing_stand_rod = (p) => { p.clear(); p.rect(7, 2, 2, 14, [200, 180, 80]); };
T.brewing_stand_base = (p) => { p.noise([100, 100, 100], 0.05); p.border([70, 70, 70]); };
T.water_still = (p) => {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = 190 + Math.sin((x + y * 0.5) * 0.8) * 18 + p.r() * 14;
      p.set(x, y, [v, v, v, 185]);
    }
};
T.lava_still = (p) => {
  for (let y = 0; y < 16; y++)
    for (let x = 0; x < 16; x++) {
      const v = Math.sin(x * 0.7 + Math.cos(y * 0.5) * 2) * 0.5 + 0.5;
      p.set(x, y, mix([200, 70, 10], [255, 180, 40], v * 0.8 + p.r() * 0.2));
    }
  p.speckle([255, 230, 120], 8);
};

// Fissures (10 étapes)
const crackSegs = (() => {
  const p = new Painter('cracks');
  const segs = [];
  for (let i = 0; i < 40; i++) {
    const x = 1 + p.ri(14), y = 1 + p.ri(14);
    const dx = p.ri(3) - 1, dy = p.ri(3) - 1;
    segs.push([x, y, x + dx * 2, y + dy * 2]);
  }
  return segs;
})();
for (let s = 0; s < 10; s++) {
  T['destroy_' + s] = (p) => {
    p.clear();
    const n = Math.floor(((s + 1) / 10) * crackSegs.length);
    for (let i = 0; i < n; i++) {
      const [a, b, c, d] = crackSegs[i];
      p.line(a, b, c, d, [20, 20, 20, 190]);
    }
  };
}

// ---------- Particules ----------
T.particle_smoke = (p) => { p.clear(); p.circle(8, 8, 5, (x, y, d) => [200, 200, 200, 220 - d * 25]); };
T.particle_flame = (p) => { p.clear(); p.circle(8, 9, 4, [255, 170, 40]); p.circle(8, 10, 2, [255, 240, 150]); p.set(8, 4, [255, 170, 40]); };
T.particle_portal = (p) => { p.clear(); p.circle(8, 8, 3, [180, 80, 255]); p.set(8, 8, [240, 200, 255]); };
T.particle_heart = (p) => {
  p.clear();
  p.ascii(['..RR.RR..', '.RRRRRRR.', '.RRRRRRR.', '..RRRRR..', '...RRR...', '....R....'], { R: [230, 30, 40] }, 4, 5);
};
T.particle_crit = (p) => { p.clear(); p.line(8, 3, 8, 13, [255, 255, 255]); p.line(3, 8, 13, 8, [255, 255, 255]); p.line(5, 5, 11, 11, [220, 220, 220]); p.line(11, 5, 5, 11, [220, 220, 220]); };
T.particle_explosion = (p) => { p.clear(); p.circle(8, 8, 7, (x, y, d) => [230 - d * 10, 230 - d * 10, 230 - d * 10, 230]); };
T.particle_bubble = (p) => { p.clear(); p.circle(8, 8, 3, [180, 210, 255, 200]); p.circle(8, 8, 2, [0, 0, 0, 0]); p.set(7, 7, [255, 255, 255]); };
T.particle_rain = (p) => { p.clear(); p.vline(8, 2, 10, [120, 150, 230, 200]); };
T.particle_snow = (p) => { p.clear(); p.rect(7, 7, 2, 2, [255, 255, 255]); p.set(6, 7, [230, 240, 255]); };
T.particle_xp = (p) => { p.clear(); p.circle(8, 8, 3.5, [200, 255, 60]); p.circle(8, 8, 2, [255, 255, 180]); };
T.particle_enchant = (p) => { p.clear(); p.ascii(['XXX', 'X.X', 'XX.', 'X..'], { X: [230, 230, 255] }, 6, 6); };
T.particle_dragon = (p) => { p.clear(); p.circle(8, 8, 3.5, [200, 60, 220]); p.set(8, 8, [255, 200, 255]); };
T.particle_white = (p) => { p.fill([255, 255, 255]); };
T.particle_note = (p) => { p.clear(); p.rect(6, 10, 3, 3, [60, 200, 60]); p.vline(8, 3, 8, [60, 200, 60]); };
T.particle_angry = (p) => { p.clear(); p.line(4, 4, 11, 11, [60, 60, 60]); p.line(11, 4, 4, 11, [60, 60, 60]); };
T.sun = (p) => { p.fill([255, 255, 220]); };

// ---------- Icônes d'objets ----------
const OUT = [25, 20, 15, 255];
const MAT = {
  wooden: { a: [104, 78, 40], b: [150, 115, 65], c: [190, 150, 90] },
  stone: { a: [90, 90, 90], b: [130, 130, 130], c: [170, 170, 170] },
  iron: { a: [150, 150, 150], b: [210, 210, 210], c: [250, 250, 250] },
  golden: { a: [190, 140, 20], b: [245, 210, 60], c: [255, 250, 150] },
  diamond: { a: [30, 160, 150], b: [80, 230, 215], c: [200, 255, 250] },
  leather: { a: [110, 60, 30], b: [160, 90, 50], c: [195, 125, 80] },
};
const HANDLE = { h: [140, 105, 60], H: [95, 70, 35] };

const TOOL_ART = {
  pickaxe: [
    '................',
    '................',
    '....bbbbbb......',
    '...bccccccbb....',
    '....aa...acbb...',
    '.........hHab...',
    '........hH..cb..',
    '.......hH...cb..',
    '......hH....cb..',
    '.....hH.....ab..',
    '....hH.......a..',
    '...hH...........',
    '..hH............',
    '.hH.............',
    '................',
    '................',
  ],
  axe: [
    '................',
    '.....bb.........',
    '....bccb........',
    '....bcccb.......',
    '....bcccab.hH...',
    '.....bccaahH....',
    '......bbahH.....',
    '........hHa.....',
    '.......hH.......',
    '......hH........',
    '.....hH.........',
    '....hH..........',
    '...hH...........',
    '..hH............',
    '................',
    '................',
  ],
  shovel: [
    '................',
    '...........bb...',
    '..........bccb..',
    '.........bcccb..',
    '.........bccab..',
    '..........aab...',
    '.........hH.....',
    '........hH......',
    '.......hH.......',
    '......hH........',
    '.....hH.........',
    '....hH..........',
    '...hH...........',
    '..hH............',
    '................',
    '................',
  ],
  hoe: [
    '................',
    '................',
    '.....bbbbbb.....',
    '.....abcccbb....',
    '..........hH....',
    '.........hH.....',
    '........hH......',
    '.......hH.......',
    '......hH........',
    '.....hH.........',
    '....hH..........',
    '...hH...........',
    '..hH............',
    '.hH.............',
    '................',
    '................',
  ],
  sword: [
    '................',
    '.............cc.',
    '............cbc.',
    '...........cbc..',
    '..........cbc...',
    '.........cbc....',
    '........cbc.....',
    '.......cba......',
    '..a...cba.......',
    '...a.cba........',
    '....aba.........',
    '....hHa.........',
    '...hH..a........',
    '..hH............',
    '.hH.............',
    '................',
  ],
};
const ARMOR_ART = {
  helmet: [
    '................',
    '................',
    '................',
    '....bbbbbbbb....',
    '...bccccccccb...',
    '...bcbbbbbbab...',
    '...bb......ab...',
    '...bb......ab...',
    '...aa......aa...',
    '................',
  ],
  chestplate: [
    '................',
    '..bb.......bb...',
    '.bcbb.....bbab..',
    '.bccbbbbbbbcab..',
    '.bcccccccccab...'.replace(/.$/, '.'),
    '..bbccccccab....',
    '....bcccccb.....',
    '....bcccccb.....',
    '....bccccab.....',
    '....bccccab.....',
    '....bcccaab.....',
    '....abbbbba.....',
  ],
  leggings: [
    '................',
    '................',
    '....bbbbbbbb....',
    '....bccccccb....',
    '....bcbaabcb....',
    '....bcb..bcb....',
    '....bcb..bcb....',
    '....bcb..bcb....',
    '....bcb..bcb....',
    '....bab..bab....',
    '....aaa..aaa....',
  ],
  boots: [
    '................',
    '................',
    '................',
    '................',
    '................',
    '...bbb....bbb...',
    '...bcb....bcb...',
    '...bcb....bcb...',
    '...bcb....bcb...',
    '..bccb....bccb..',
    '.bcccb....bcccb.',
    '.aaaaa....aaaaa.',
  ],
};

function toolIcon(type, mat) {
  return (p) => {
    p.clear();
    p.ascii(TOOL_ART[type], Object.assign({}, HANDLE, MAT[mat]));
    p.outline(OUT);
  };
}
for (const mat of ['wooden', 'stone', 'iron', 'golden', 'diamond'])
  for (const type of Object.keys(TOOL_ART)) IT[mat + '_' + type] = toolIcon(type, mat);
for (const mat of ['leather', 'iron', 'golden', 'diamond'])
  for (const slot of Object.keys(ARMOR_ART))
    IT[mat + '_' + slot] = (p) => {
      p.clear();
      p.ascii(ARMOR_ART[slot], MAT[mat], 0, 2);
      p.outline(OUT);
    };

function sphere(p, base, r = 5, cx = 8, cy = 8) {
  const c = hex(base);
  p.circle(cx, cy, r, (x, y, d) => {
    const hl = (x - cx + 2) * (x - cx + 2) + (y - cy + 2) * (y - cy + 2);
    return shade(c, hl < 3 ? 1.5 : 1.05 - d / (r * 3.5));
  });
}
function powder(p, base) {
  const c = hex(base);
  const rows = ['......XX........', '....XXXXX.......', '...XXXXXXXX.....', '..XXXXXXXXXX....', '.XXXXXXXXXXXXX..', '..XXXXXXXXXXX...'];
  p.ascii(rows, { X: () => shade(c, 0.75 + p.r() * 0.5) }, 0, 7);
}
function chunkShape(p, base) {
  const c = hex(base);
  const rows = ['.....XXXX.......', '...XXXXXXXX.....', '..XXXXXXXXXX....', '..XXXXXXXXXXX...', '...XXXXXXXXXX...', '....XXXXXXXX....', '......XXXX......'];
  p.ascii(rows, { X: () => shade(c, 0.75 + p.r() * 0.5) }, 0, 4);
}
function meat(p, base, fat, bone) {
  const rows = [
    '................',
    '.......FFFF.....',
    '.....FMMMMMF....',
    '....FMMMMMMMF...',
    '...FMMMMMMMMMF..',
    '...FMMMMMMMMMF..',
    '...FMMMMMMMMF...',
    '....FMMMMMMF....',
    '.....FMMMMF.....',
    '......FFFF......',
  ];
  p.ascii(rows, { M: () => shade(base, 0.85 + p.r() * 0.3), F: fat }, 0, 3);
  if (bone) { p.rect(3, 12, 3, 2, bone); p.set(2, 13, bone); }
}

IT.stick = (p) => { p.clear(); for (let i = 0; i < 10; i++) { p.set(3 + i, 12 - i, [140, 105, 60]); p.set(4 + i, 12 - i, [95, 70, 35]); } p.outline(OUT); };
IT.coal = (p) => { p.clear(); chunkShape(p, [40, 40, 40]); p.speckle([80, 80, 80], 4, 1, (x, y) => p.alpha(x, y) > 0); p.outline(OUT); };
IT.charcoal = (p) => { p.clear(); chunkShape(p, [55, 45, 35]); p.outline(OUT); };
IT.flint = (p) => { p.clear(); p.ascii(['......XX........', '.....XXXX.......', '....XXXXXX......', '...XXXXXXXX.....', '...XXXXXXXXX....', '....XXXXXXXX....', '.....XXXXXX.....', '......XXX.......'], { X: () => shade([60, 60, 64], 0.8 + p.r() * 0.5) }, 1, 3); p.outline(OUT); };
IT.quartz = (p) => { p.clear(); p.ascii(['......XX........', '.....XXXX.......', '....XXXXXX......', '...XXXXXXXX.....', '...XXXXXXXXX....', '....XXXXXXXX....', '.....XXXXXX.....'], { X: () => shade([236, 230, 222], 0.85 + p.r() * 0.2) }, 1, 4); p.outline([120, 110, 100, 255]); };
function ingot(p, m) {
  p.clear();
  const rows = ['......cccccb....', '....ccbbbbbab...', '..ccbbbbbbbaab..', '.abbbbbbbbaaab..', '.aabbbbbbaaab...', '..aaabbbaaab....', '....aaaaab......'];
  p.ascii(rows, m, 0, 5);
  p.outline(OUT);
}
IT.iron_ingot = (p) => ingot(p, MAT.iron);
IT.gold_ingot = (p) => ingot(p, MAT.golden);
IT.brick = (p) => ingot(p, { a: [110, 50, 35], b: [160, 75, 55], c: [200, 110, 85] });
IT.nether_brick = (p) => ingot(p, { a: [30, 14, 16], b: [55, 27, 32], c: [80, 40, 45] });
IT.diamond = (p) => {
  p.clear();
  p.ascii(['.....cccccc.....', '....cbbbbbbc....', '...cbccbbccbb...', '..cbbbbbbbbbba..', '...bbbbbbbbba...', '....bbbbbbba....', '.....bbbbba.....', '......bbba......', '.......ba.......'], MAT.diamond, 0, 3);
  p.outline([20, 80, 75, 255]);
};
IT.emerald = (p) => {
  p.clear();
  p.ascii(['......cc......', '.....cbbc.....', '....cbbbba....', '....cbbbba....', '....cbbbba....', '....cbbbba....', '....bbbbba....', '.....bbba.....', '......aa......'], { a: [10, 120, 50], b: [40, 200, 100], c: [170, 255, 200] }, 1, 3);
  p.outline([5, 60, 25, 255]);
};
IT.lapis_lazuli = (p) => { p.clear(); chunkShape(p, [40, 80, 190]); p.outline([15, 30, 80, 255]); };
IT.redstone = (p) => { p.clear(); powder(p, [200, 20, 10]); p.outline([80, 5, 0, 255]); };
IT.gunpowder = (p) => { p.clear(); powder(p, [90, 90, 90]); p.outline([40, 40, 40, 255]); };
IT.sugar = (p) => { p.clear(); powder(p, [245, 245, 245]); p.outline([150, 150, 150, 255]); };
IT.bone_meal = (p) => { p.clear(); powder(p, [235, 235, 225]); p.outline([130, 130, 120, 255]); };
IT.blaze_powder = (p) => { p.clear(); powder(p, [250, 170, 30]); p.outline([130, 60, 0, 255]); };
IT.glowstone_dust = (p) => { p.clear(); powder(p, [255, 220, 110]); p.outline([140, 100, 30, 255]); };
IT.feather = (p) => {
  p.clear();
  for (let i = 0; i < 11; i++) {
    const x = 3 + i, y = 13 - i;
    p.set(x, y, [150, 150, 150]);
    if (i > 1) { p.set(x - 1, y - 1, [240, 240, 240]); p.set(x - 2, y - 1, [225, 225, 225]); p.set(x + 1, y + 1, [235, 235, 235]); if (i > 3 && i < 10) p.set(x + 1, y + 2, [215, 215, 215]); }
  }
  p.outline([90, 90, 90, 255]);
};
IT.string = (p) => { p.clear(); const c = [240, 240, 240]; for (let i = 0; i < 12; i++) p.set(2 + i, 8 + Math.round(Math.sin(i * 0.9) * 3), c); for (let i = 0; i < 12; i++) p.set(2 + i, 9 + Math.round(Math.sin(i * 0.9 + 1) * 3), [200, 200, 200]); p.outline([90, 90, 90, 255]); };
IT.leather = (p) => { p.clear(); p.ascii(['..XXXXXXXXXX..', '.XXXXXXXXXXXX.', '.XXXXXXXXXXXX.', '..XXXXXXXXXX..', '..XXXXXXXXXX..', '.XXXXXXXXXXXX.', '.XXXXXXXXXXXX.', '..XXX....XXX..'], { X: () => shade([160, 90, 50], 0.85 + p.r() * 0.25) }, 1, 4); p.outline(OUT); };
IT.bone = (p) => {
  p.clear();
  const c = [235, 232, 215];
  for (let i = 0; i < 9; i++) { p.set(4 + i, 11 - i, c); p.set(5 + i, 11 - i, [210, 205, 190]); }
  p.rect(2, 11, 3, 3, c); p.rect(12, 2, 3, 3, c); p.set(2, 11, [0, 0, 0, 0]); p.set(14, 4, [0, 0, 0, 0]);
  p.outline([100, 95, 80, 255]);
};
IT.arrow = (p) => {
  p.clear();
  for (let i = 0; i < 9; i++) p.set(4 + i, 11 - i, [140, 105, 60]);
  p.ascii(['..XX', '.XXX', 'XXX.', 'XX..'], { X: [200, 200, 200] }, 11, 1);
  p.ascii(['W...', 'WW..', '.WW.', '..W.'], { W: [240, 240, 240] }, 1, 11);
  p.set(3, 12, [240, 240, 240]); p.set(2, 11, [220, 220, 220]);
  p.outline(OUT);
};
IT.bow = (p) => {
  p.clear();
  const w = [140, 105, 60];
  const pts = [[2, 3], [3, 2], [4, 2], [5, 2], [6, 3], [7, 3], [8, 4], [9, 5], [10, 6], [11, 7], [12, 8], [12, 9], [13, 10], [13, 11], [13, 12], [12, 13]];
  for (const [x, y] of pts) { p.set(x, y, w); p.set(x + 1, y + 1, [95, 70, 35]); }
  p.line(3, 3, 12, 12, [220, 220, 220]);
  p.outline(OUT);
};
IT.apple = (p) => {
  p.clear();
  sphere(p, [210, 30, 30], 5.5, 8, 9);
  p.vline(8, 2, 3, [90, 60, 30]); p.set(9, 2, [60, 150, 40]); p.set(10, 2, [60, 150, 40]); p.set(10, 1, [60, 150, 40]);
  p.outline(OUT);
};
IT.golden_apple = (p) => {
  p.clear();
  sphere(p, [240, 200, 50], 5.5, 8, 9);
  p.vline(8, 2, 3, [90, 60, 30]); p.set(9, 2, [240, 220, 90]); p.set(10, 1, [240, 220, 90]);
  p.outline([120, 80, 10, 255]);
};
IT.bread = (p) => {
  p.clear();
  p.ascii(['........XXXXX...', '.....XXXXXXXXX..', '...XXXXXXXXXXXX.', '..XXXXXXXXXXXXX.', '.XXXXXXXXXXXXX..', '.XXXXXXXXXXXX...', '..XXXXXXXXX.....', '...XXXXX........'], { X: () => shade([200, 140, 60], 0.85 + p.r() * 0.25) }, 0, 4);
  for (const x of [5, 8, 11]) p.set(x, 6 + (x === 5 ? 2 : x === 8 ? 1 : 0), [240, 200, 120]);
  p.outline(OUT);
};
IT.porkchop = (p) => { p.clear(); meat(p, [240, 140, 140], [250, 210, 200]); p.outline(OUT); };
IT.cooked_porkchop = (p) => { p.clear(); meat(p, [190, 120, 70], [220, 180, 130]); p.outline(OUT); };
IT.beef = (p) => { p.clear(); meat(p, [200, 50, 45], [240, 220, 210]); p.outline(OUT); };
IT.cooked_beef = (p) => { p.clear(); meat(p, [110, 65, 40], [160, 110, 70]); p.outline(OUT); };
IT.mutton = (p) => { p.clear(); meat(p, [215, 70, 70], [245, 230, 220], [240, 240, 230]); p.outline(OUT); };
IT.cooked_mutton = (p) => { p.clear(); meat(p, [150, 85, 55], [190, 140, 100], [240, 240, 230]); p.outline(OUT); };
IT.rotten_flesh = (p) => { p.clear(); meat(p, [130, 90, 60], [100, 140, 70]); p.speckle([80, 120, 50], 6, 1, (x, y) => p.alpha(x, y) > 0); p.outline(OUT); };
function drumstick(p, meatC, boneC) {
  p.ascii(['.....MMMM.......', '....MMMMMM......', '...MMMMMMMM.....', '...MMMMMMMM.....', '...MMMMMMMM.....', '....MMMMMMB.....', '.....MMMM..B....', '...........BB...', '............BB..'], { M: () => shade(meatC, 0.85 + p.r() * 0.3), B: boneC }, 0, 3);
}
IT.chicken = (p) => { p.clear(); drumstick(p, [240, 190, 170], [240, 240, 230]); p.outline(OUT); };
IT.cooked_chicken = (p) => { p.clear(); drumstick(p, [200, 140, 70], [240, 240, 230]); p.outline(OUT); };
IT.spider_eye = (p) => { p.clear(); sphere(p, [150, 30, 50], 5); p.circle(8, 8, 2, [220, 60, 80]); p.set(8, 8, [30, 0, 0]); p.outline(OUT); };
IT.melon_slice = (p) => {
  p.clear();
  p.ascii(['GGGGGGGGGGGGGG', 'gRRRRRRRRRRRRg', '.gRRbRRRRbRRg.', '..gRRRRRRRRg..', '...gRRbRRRg...', '....gRRRRg....', '.....gRRg.....', '......gg......'], { G: [60, 130, 30], g: [220, 240, 170], R: [230, 50, 50], b: [30, 20, 20] }, 1, 4);
  p.outline(OUT);
};
IT.cookie = (p) => { p.clear(); sphere(p, [200, 140, 70], 5.5); p.speckle([70, 40, 20], 7, 1, (x, y) => p.alpha(x, y) > 0 && Math.hypot(x - 8, y - 8) < 4.5); p.outline(OUT); };
IT.pumpkin_pie = (p) => { p.clear(); p.ascii(['....cccccccc....', '..cooooooooooc..', '.cooooooooooooc.', '.cccccccccccccc.', '.bbbbbbbbbbbbbb.', '..bbbbbbbbbbbb..'], { c: [220, 180, 110], o: [230, 140, 40], b: [190, 140, 80] }, 0, 5); p.outline(OUT); };
IT.carrot = (p) => {
  p.clear();
  for (let i = 0; i < 9; i++) { p.set(3 + i, 12 - i, [240, 140, 30]); p.set(4 + i, 12 - i, [220, 110, 20]); if (i > 2) p.set(3 + i, 11 - i, [250, 160, 50]); }
  p.ascii(['G.G', '.GG', 'GG.'], { G: [60, 160, 40] }, 11, 1);
  p.outline(OUT);
};
IT.potato = (p) => { p.clear(); p.ascii(['...XXXXX...', '.XXXXXXXXX.', 'XXXXXXXXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '...XXXXX...'], { X: () => shade([200, 160, 90], 0.85 + p.r() * 0.2) }, 2, 5); p.outline(OUT); };
IT.baked_potato = (p) => { p.clear(); p.ascii(['...XXXXX...', '.XXXXXXXXX.', 'XXXYYYYXXXX', 'XXXXXXXXXXX', '.XXXXXXXXX.', '...XXXXX...'], { X: () => shade([180, 120, 50], 0.85 + p.r() * 0.2), Y: [240, 220, 120] }, 2, 5); p.outline(OUT); };
IT.cod = (p) => { p.clear(); p.ascii(['....XXXXXX..T', '..XXXXXXXXXTT', '.XeXXXXXXXXXT', '..XXXXXXXXXTT', '....XXXXXX..T'], { X: [190, 170, 130], e: [20, 20, 20], T: [160, 140, 100] }, 1, 6); p.outline(OUT); };
IT.cooked_cod = (p) => { p.clear(); p.ascii(['....XXXXXX..T', '..XXXXXXXXXTT', '.XeXXXXXXXXXT', '..XXXXXXXXXTT', '....XXXXXX..T'], { X: [220, 190, 130], e: [20, 20, 20], T: [190, 160, 110] }, 1, 6); p.outline(OUT); };
IT.wheat_item = (p) => {
  p.clear();
  for (let k = 0; k < 4; k++) {
    for (let i = 0; i < 9; i++) p.set(3 + i + k, 13 - i - (k % 2), [200, 170, 70]);
    p.rect(10 + k, 2 + (k % 2), 2, 3, [225, 195, 95]);
  }
  p.outline(OUT);
};
IT.wheat_seeds = (p) => { p.clear(); for (const [x, y] of [[5, 6], [9, 5], [7, 9], [11, 9], [4, 11], [8, 12]]) { p.set(x, y, [80, 170, 50]); p.set(x + 1, y, [60, 130, 40]); } p.outline([30, 60, 20, 255]); };
IT.sugar_cane_item = (p) => { p.clear(); for (const x of [4, 8, 11]) for (let y = 2; y < 15; y++) p.set(x, y, y % 4 === 0 ? [100, 140, 60] : [150, 200, 100]); p.set(5, 5, [120, 170, 70]); p.set(9, 8, [120, 170, 70]); p.outline(OUT); };
IT.paper = (p) => { p.clear(); p.ascii(['..XXXXXXXXXX..', '.XXXXXXXXXXX..', '.XXXXXXXXXXXX.', '..XXXXXXXXXXX.', '.XXXXXXXXXXX..', '.XXXXXXXXXXXX.', '..XXXXXXXXXXX.', '..XXXXXXXXXX..'], { X: () => shade([235, 235, 225], 0.95 + p.r() * 0.08) }, 1, 4); p.outline([120, 120, 110, 255]); };
function book(p, cover) {
  p.clear();
  p.ascii(['..CCCCCCCCCC..', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '.CCCCCCCCCCCP.', '..PPPPPPPPPPP.'], { C: () => shade(cover, 0.9 + p.r() * 0.15), P: [235, 230, 215] }, 1, 3);
  p.vline(3, 4, 8, shade(cover, 0.7));
  p.outline(OUT);
}
IT.book = (p) => book(p, [120, 60, 35]);
IT.enchanted_book = (p) => { book(p, [110, 40, 150]); p.set(8, 8, [255, 220, 90]); p.set(9, 7, [255, 220, 90]); };
function bucket(p, content) {
  p.clear();
  const m = { a: [110, 110, 110], b: [170, 170, 170], c: [220, 220, 220] };
  p.ascii(['..cccccccccc..', '.cbbbbbbbbbbc.', '.cbbbbbbbbbba.', '..bbbbbbbbba..', '..bbbbbbbbba..', '...bbbbbbba...', '...bbbbbbba...', '....aaaaaa....'], m, 1, 6);
  if (content) { p.hline(3, 6, 10, content); p.hline(4, 7, 8, shade(content, 0.9)); }
  p.line(2, 6, 4, 2, [90, 90, 90]); p.line(4, 2, 11, 2, [90, 90, 90]); p.line(11, 2, 13, 6, [90, 90, 90]);
  p.outline(OUT);
}
IT.bucket = (p) => bucket(p, null);
IT.water_bucket = (p) => bucket(p, [50, 90, 220]);
IT.lava_bucket = (p) => bucket(p, [250, 120, 20]);
IT.milk_bucket = (p) => bucket(p, [250, 250, 250]);
IT.flint_and_steel = (p) => {
  p.clear();
  p.circle(6, 6, 4, [170, 170, 170]); p.circle(6, 6, 2.5, [0, 0, 0, 0]);
  p.rect(8, 9, 5, 4, [60, 60, 64]); p.set(9, 10, [100, 100, 104]);
  p.outline(OUT);
};
IT.shears = (p) => {
  p.clear();
  p.line(4, 12, 11, 3, [210, 210, 210]); p.line(5, 12, 12, 3, [170, 170, 170]);
  p.line(4, 3, 11, 12, [210, 210, 210]);
  p.circle(3.5, 12.5, 2, [140, 60, 40]); p.circle(12.5, 12.5, 2, [140, 60, 40]);
  p.outline(OUT);
};
IT.compass = (p) => {
  p.clear();
  p.circle(8, 8, 6, [140, 140, 150]); p.circle(8, 8, 5, [220, 215, 200]);
  p.line(8, 8, 8, 4, [220, 30, 30]); p.line(8, 9, 8, 12, [90, 90, 100]); p.set(8, 8, [40, 40, 40]);
  p.outline(OUT);
};
IT.clock = (p) => {
  p.clear();
  p.circle(8, 8, 6, [200, 160, 40]); p.circle(8, 8, 5, [110, 170, 230]);
  p.rect(3, 9, 10, 4, [60, 90, 40]); p.circle(8, 8, 1.5, [255, 230, 90]);
  p.outline(OUT);
};
IT.ender_pearl = (p) => { p.clear(); sphere(p, [20, 90, 80], 5); p.circle(8, 8, 2, [40, 150, 130]); p.outline([5, 30, 25, 255]); };
IT.ender_eye = (p) => { p.clear(); sphere(p, [40, 120, 70], 5); p.circle(8, 8, 2.5, [150, 220, 120]); p.rect(7, 6, 2, 4, [10, 30, 15]); p.outline([5, 30, 15, 255]); };
IT.blaze_rod = (p) => { p.clear(); for (let i = 0; i < 11; i++) { p.set(2 + i, 13 - i, [255, 210, 60]); p.set(3 + i, 13 - i, [230, 150, 20]); } p.outline([110, 50, 0, 255]); };
IT.ghast_tear = (p) => { p.clear(); p.ascii(['...X...', '..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'], { X: [200, 235, 240] }, 4, 4); p.set(6, 8, [255, 255, 255]); p.outline([80, 110, 120, 255]); };
IT.gold_nugget = (p) => { p.clear(); p.ascii(['.XX.', 'XXXX', 'XXXX', '.XX.'], { X: [250, 215, 70] }, 5, 6); p.set(6, 7, [255, 250, 180]); p.outline([120, 80, 10, 255]); };
IT.iron_nugget = (p) => { p.clear(); p.ascii(['.XX.', 'XXXX', 'XXXX', '.XX.'], { X: [210, 210, 210] }, 5, 6); p.outline([90, 90, 90, 255]); };
IT.bed_item = (p) => {
  p.clear();
  p.rect(1, 7, 14, 3, [170, 35, 35]); p.rect(1, 7, 4, 2, [240, 240, 240]);
  p.rect(1, 10, 14, 2, [150, 110, 70]); p.rect(1, 12, 2, 2, [150, 110, 70]); p.rect(13, 12, 2, 2, [150, 110, 70]);
  p.outline(OUT);
};
IT.door_item = (p) => {
  p.clear();
  p.rect(4, 1, 8, 14, [160, 128, 76]);
  p.rect(5, 2, 2, 4, [110, 90, 60]); p.rect(9, 2, 2, 4, [110, 90, 60]);
  p.hline(4, 7, 8, [120, 95, 55]); p.set(10, 9, [60, 60, 60]);
  p.outline(OUT);
};
IT.snowball = (p) => { p.clear(); sphere(p, [245, 250, 255], 5); p.outline([120, 140, 150, 255]); };
IT.clay_ball = (p) => { p.clear(); sphere(p, [165, 170, 185], 5); p.outline([80, 85, 95, 255]); };
IT.magma_cream = (p) => { p.clear(); sphere(p, [230, 120, 40], 5); p.circle(8, 8, 2, [250, 220, 80]); p.outline([90, 40, 10, 255]); };
IT.egg = (p) => { p.clear(); p.ascii(['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'], { X: () => shade([230, 210, 170], 0.95 + p.r() * 0.1) }, 4, 4); p.outline(OUT); };
IT.spawn_egg = (p) => { p.clear(); p.ascii(['..XXX..', '.XXXXX.', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..'], { X: [255, 255, 255] }, 4, 4); };
IT.fishing_rod = (p) => { p.clear(); for (let i = 0; i < 11; i++) p.set(2 + i, 13 - i, [120, 90, 50]); p.line(13, 2, 13, 12, [220, 220, 220]); p.set(12, 12, [150, 150, 150]); p.outline(OUT); };
function bottle(p, liquid) {
  p.clear();
  p.ascii(['.....GG.....', '.....GG.....', '....GGGG....', '...GLLLLG...', '..GLLLLLLG..', '..GLLLLLLG..', '..GLLLLLLG..', '...GLLLLG...', '....GGGG....'], { G: [210, 230, 240], L: liquid || [0, 0, 0, 0] }, 2, 4);
  p.rect(7, 3, 2, 1, [140, 100, 60]);
  p.outline([70, 80, 90, 255]);
}
IT.potion = (p) => bottle(p, [220, 40, 60]);
IT.glass_bottle = (p) => bottle(p, null);
IT.experience_bottle = (p) => bottle(p, [140, 230, 60]);
IT.dragon_breath = (p) => bottle(p, [230, 90, 200]);
IT.nether_wart = (p) => { p.clear(); p.ascii(['..RR.RR.', '.RRRRRRR', 'RRRRRRR.', '.RRRRRR.', '..RRRR..'], { R: () => shade([160, 20, 30], 0.8 + p.r() * 0.4) }, 4, 5); p.outline(OUT); };
IT.cake_item = (p) => { p.clear(); p.ascii(['..WWWWWWWWWW..', '.WWRWWWWWRWWW.', '.WWWWWWRWWWWW.', '.CCCCCCCCCCCC.', '.CCCCCCCCCCCC.', '.WWWWWWWWWWWW.', '.CCCCCCCCCCCC.'], { W: [245, 240, 235], R: [210, 30, 30], C: [190, 125, 70] }, 1, 5); p.outline(OUT); };
IT.map = (p) => { IT.paper(p); p.speckle([100, 150, 80], 12, 1, (x, y) => p.alpha(x, y) > 0); };
IT.totem = (p) => { p.clear(); p.ascii(['..GGGG..', '.GeGGeG.', '.GGGGGG.', '..GGGG..', 'GGGGGGGG', '..GGGG..', '..G..G..'], { G: [240, 200, 60], e: [30, 140, 60] }, 4, 3); p.outline(OUT); };
IT.map = IT.map || null;

// ---------- Construction de l'atlas ----------
export const TEX_SIZE = 16;
export const texIndex = new Map();
export const texPainters = new Map(); // nom -> Painter (pour les icônes)
let layers = [];

function register(name, fn) {
  if (texIndex.has(name)) return;
  const p = new Painter(name);
  fn(p);
  texIndex.set(name, layers.length);
  texPainters.set(name, p);
  layers.push(p.data);
}

export function buildTextures() {
  layers = [];
  texIndex.clear();
  texPainters.clear();
  for (const [name, fn] of Object.entries(T)) register(name, fn);
  for (const [name, fn] of Object.entries(IT)) if (fn) register('item_' + name, fn);
  return { layers, index: texIndex };
}

export function tex(name) {
  const i = texIndex.get(name);
  if (i === undefined) {
    if (!tex.warned) tex.warned = new Set();
    if (!tex.warned.has(name)) { tex.warned.add(name); console.warn('Texture manquante', name); }
    return texIndex.get('stone') ?? 0;
  }
  return i;
}

export function hasTex(name) {
  return texIndex.has(name);
}
