// Système de particules
import { tex } from './textures.js';
import { BLOCKS, SOLID } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { lerp } from '../core/math.js';

const TYPES = {
  smoke: { tex: 'particle_smoke', life: [20, 40], size: [0.12, 0.25], grav: -0.004, drag: 0.96, color: [0.6, 0.6, 0.6], grow: 1.5 },
  big_smoke: { tex: 'particle_smoke', life: [30, 60], size: [0.4, 0.8], grav: -0.006, drag: 0.95, color: [0.4, 0.4, 0.4], grow: 1.8 },
  flame: { tex: 'particle_flame', life: [10, 20], size: [0.06, 0.1], grav: 0, drag: 0.96, bright: true },
  portal: { tex: 'particle_portal', life: [30, 50], size: [0.05, 0.1], grav: 0, drag: 1, bright: true },
  heart: { tex: 'particle_heart', life: [20, 30], size: [0.2, 0.2], grav: -0.01, drag: 0.9, bright: true },
  crit: { tex: 'particle_crit', life: [10, 20], size: [0.06, 0.1], grav: 0.02, drag: 0.8, bright: true },
  explosion: { tex: 'particle_explosion', life: [8, 14], size: [0.8, 1.4], grav: 0, drag: 0.8, bright: true, grow: 1.4 },
  bubble: { tex: 'particle_bubble', life: [10, 30], size: [0.06, 0.1], grav: -0.02, drag: 0.85 },
  block: { tex: null, life: [15, 35], size: [0.06, 0.1], grav: 0.04, drag: 0.98, collide: true },
  xp: { tex: 'particle_xp', life: [10, 20], size: [0.1, 0.15], grav: 0, drag: 0.9, bright: true },
  enchant: { tex: 'particle_enchant', life: [20, 40], size: [0.06, 0.08], grav: 0, drag: 1, bright: true },
  dragon: { tex: 'particle_dragon', life: [20, 40], size: [0.12, 0.2], grav: -0.002, drag: 0.95, bright: true },
  spell: { tex: 'particle_xp', life: [15, 25], size: [0.08, 0.12], grav: -0.01, drag: 0.95 },
  note: { tex: 'particle_note', life: [15, 20], size: [0.15, 0.15], grav: -0.02, drag: 0.9, bright: true },
  angry: { tex: 'particle_angry', life: [15, 20], size: [0.15, 0.15], grav: -0.02, drag: 0.9, bright: true },
  splash: { tex: 'particle_bubble', life: [5, 12], size: [0.05, 0.08], grav: 0.04, drag: 0.98, collide: true },
  white: { tex: 'particle_white', life: [5, 10], size: [0.05, 0.1], grav: 0, drag: 0.9, bright: true },
  lava: { tex: 'particle_flame', life: [20, 40], size: [0.05, 0.08], grav: 0.04, drag: 0.98, bright: true, collide: true },
  end_rod: { tex: 'particle_white', life: [30, 60], size: [0.04, 0.07], grav: -0.002, drag: 0.98, bright: true },
};

export class Particles {
  constructor(game) {
    this.game = game;
    this.list = [];
    this.layers = {};
  }

  layer(name) {
    let l = this.layers[name];
    if (l === undefined) { l = tex(name); this.layers[name] = l; }
    return l;
  }

  max() {
    const s = this.game.settings.particles;
    return s === 2 ? 3000 : s === 1 ? 1000 : 150;
  }

  spawn(world, type, x, y, z, vx = 0, vy = 0, vz = 0, opts) {
    if (world !== this.game.world) return null;
    if (this.list.length >= this.max()) return null;
    const t = TYPES[type] || TYPES.smoke;
    const life = t.life[0] + Math.random() * (t.life[1] - t.life[0]);
    const p = {
      type, x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life,
      size: t.size[0] + Math.random() * (t.size[1] - t.size[0]),
      layer: this.layer(t.tex || 'particle_white'), u0: 0, v0: 0, u1: 16, v1: 16,
      color: t.color ? t.color.slice() : [1, 1, 1], grav: t.grav, drag: t.drag, bright: t.bright, collide: t.collide, grow: t.grow || 0,
    };
    if (type === 'portal') { p.color = [0.8 + Math.random() * 0.2, 0.4 * Math.random() + 0.2, 1]; }
    if (type === 'smoke' || type === 'big_smoke') { const g = 0.3 + Math.random() * 0.4; p.color = [g, g, g]; }
    if (opts) Object.assign(p, opts);
    this.list.push(p);
    return p;
  }

  spawnBurst(world, type, x, y, z, n, spread = 0.3, speed = 0.05, opts) {
    for (let i = 0; i < n; i++) {
      this.spawn(world, type, x + (Math.random() - 0.5) * spread * 2, y + (Math.random() - 0.5) * spread * 2, z + (Math.random() - 0.5) * spread * 2,
        (Math.random() - 0.5) * speed * 2, (Math.random() - 0.5) * speed * 2, (Math.random() - 0.5) * speed * 2, opts);
    }
  }

  blockBreak(world, x, y, z, id, meta) {
    const d = BLOCKS[id];
    if (!d || d.render === 'none') return;
    let name;
    if (d.texFn) name = d.texFn(1, meta);
    if (d.render === 'model' && d.boxes) {
      const b = d.boxes(meta, null)[0];
      if (b) { const sp = b.tex || d.key; name = typeof sp === 'string' ? sp : sp.side || sp.top; }
    }
    const layer = tex(name || d.key);
    const tint = d.tint === 'grass' || d.tint === 'foliage' ? [0.55, 0.75, 0.35] : d.tint === 'water' ? [0.25, 0.45, 0.9] : [1, 1, 1];
    const n = this.game.settings.particles === 0 ? 4 : 4;
    for (let i = 0; i < n; i++)
      for (let j = 0; j < n; j++)
        for (let k = 0; k < n; k++) {
          if (Math.random() < 0.4) continue;
          const px = x + (i + 0.5) / n, py = y + (j + 0.5) / n, pz = z + (k + 0.5) / n;
          const u = Math.floor(Math.random() * 12), v = Math.floor(Math.random() * 12);
          this.spawn(world, 'block', px, py, pz, (px - x - 0.5) * 0.15 + (Math.random() - 0.5) * 0.05, (py - y - 0.5) * 0.15 + Math.random() * 0.1, (pz - z - 0.5) * 0.15 + (Math.random() - 0.5) * 0.05,
            { layer, u0: u, v0: v, u1: u + 4, v1: v + 4, color: tint.slice() });
        }
  }

  blockHit(world, x, y, z, id, face) {
    const d = BLOCKS[id];
    if (!d) return;
    const name = d.texFn ? d.texFn(1, 0) : d.key;
    const layer = tex(name);
    const off = [[0, 0, -0.1], [0, 0, 1.1], [-0.1, 0, 0], [1.1, 0, 0], [0, 1.1, 0], [0, -0.1, 0]][face] || [0, 0, 0];
    const px = x + (off[0] || Math.random()), py = y + (off[1] || Math.random()), pz = z + (off[2] || Math.random());
    const u = Math.floor(Math.random() * 12), v = Math.floor(Math.random() * 12);
    const tint = d.tint === 'grass' || d.tint === 'foliage' ? [0.55, 0.75, 0.35] : [1, 1, 1];
    this.spawn(world, 'block', px, py, pz, (Math.random() - 0.5) * 0.05, 0.05, (Math.random() - 0.5) * 0.05, { layer, u0: u, v0: v, u1: u + 4, v1: v + 4, color: tint, life: 10 });
  }

  itemBreak(world, x, y, z, itemLayer) {
    for (let i = 0; i < 10; i++) {
      const u = Math.floor(Math.random() * 12), v = Math.floor(Math.random() * 12);
      this.spawn(world, 'block', x, y, z, (Math.random() - 0.5) * 0.2, Math.random() * 0.2, (Math.random() - 0.5) * 0.2, { layer: itemLayer, u0: u, v0: v, u1: u + 4, v1: v + 4 });
    }
  }

  tick() {
    const world = this.game.world;
    const L = this.list;
    let j = 0;
    for (let i = 0; i < L.length; i++) {
      const p = L[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      p.age++;
      if (p.age >= p.life) continue;
      if (p.type === 'portal' && p.target) {
        const t = p.age / p.life;
        p.x = lerp(p.sx, p.target[0], t); p.y = lerp(p.sy, p.target[1], t) + Math.sin(t * Math.PI) * 0.5; p.z = lerp(p.sz, p.target[2], t);
      } else {
        p.vy -= p.grav;
        p.vx *= p.drag; p.vy *= p.drag; p.vz *= p.drag;
        let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
        if (p.collide) {
          const id = world.getBlock(Math.floor(nx), Math.floor(ny), Math.floor(nz));
          if (id && SOLID[id] && BLOCKS[id].render !== 'model') {
            if (world.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z)) && SOLID[world.getBlock(Math.floor(p.x), Math.floor(ny), Math.floor(p.z))]) { ny = p.y; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; }
            if (id !== B.air && SOLID[world.getBlock(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))]) { nx = p.x; p.vx = 0; }
            if (SOLID[world.getBlock(Math.floor(p.x), Math.floor(p.y), Math.floor(nz))]) { nz = p.z; p.vz = 0; }
          }
        }
        p.x = nx; p.y = ny; p.z = nz;
      }
      L[j++] = p;
    }
    L.length = j;
  }

  clear() {
    this.list.length = 0;
  }

  build(buf, pt, cam, right, up) {
    const world = this.game.world;
    for (const p of this.list) {
      const x = lerp(p.px, p.x, pt) - cam.x, y = lerp(p.py, p.y, pt) - cam.y, z = lerp(p.pz, p.z, pt) - cam.z;
      if (x * x + y * y + z * z > 90 * 90) continue;
      let s = p.size;
      const lifeT = (p.age + pt) / p.life;
      if (p.grow) s *= 1 + lifeT * p.grow;
      if (p.type === 'heart' || p.type === 'note') s *= Math.min(1, lifeT * 4);
      let sky = 255, bl = 255;
      if (!p.bright) {
        const bx = Math.floor(p.x), by = Math.floor(p.y), bz = Math.floor(p.z);
        sky = world.getSky(bx, by, bz) * 17; bl = world.getBlockLight(bx, by, bz) * 17;
      }
      const r = Math.min(255, p.color[0] * 255), g = Math.min(255, p.color[1] * 255), b = Math.min(255, p.color[2] * 255);
      const rx = right[0] * s, ry = right[1] * s, rz = right[2] * s;
      const ux = up[0] * s, uy = up[1] * s, uz = up[2] * s;
      const alpha = p.type === 'smoke' || p.type === 'big_smoke' || p.type === 'explosion' ? Math.max(0, 1 - lifeT) * 255 : 255;
      const put = (px, py, pz, u, v) => {
        buf.v(Math.round(px * 256), Math.round(py * 256), Math.round(pz * 256), u, v, p.layer, sky, bl, 255, r, g, b, 0);
        buf.u8[(buf.n - 1) * 20 + 19] = alpha;
      };
      put(x - rx - ux, y - ry - uy, z - rz - uz, p.u0, p.v1);
      put(x + rx - ux, y + ry - uy, z + rz - uz, p.u1, p.v1);
      put(x + rx + ux, y + ry + uy, z + rz + uz, p.u1, p.v0);
      put(x - rx + ux, y - ry + uy, z - rz + uz, p.u0, p.v0);
    }
  }
}
