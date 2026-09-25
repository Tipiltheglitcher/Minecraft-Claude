// Explosions (algorithme de rayons façon Minecraft)
import { BLOCKS, SOLID } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { blockDrops } from './world.js';

export function explode(world, x, y, z, power, opts = {}) {
  const game = world.game;
  const destroy = opts.destroy !== false && (!game || game.settings.mobGriefing !== false || !opts.byMob);
  const toBreak = new Map();
  if (destroy) {
    for (let i = 0; i < 16; i++)
      for (let j = 0; j < 16; j++)
        for (let k = 0; k < 16; k++) {
          if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
          let dx = (i / 15) * 2 - 1, dy = (j / 15) * 2 - 1, dz = (k / 15) * 2 - 1;
          const l = Math.hypot(dx, dy, dz);
          dx /= l; dy /= l; dz /= l;
          let s = power * (0.7 + Math.random() * 0.6);
          let px = x, py = y, pz = z;
          while (s > 0) {
            const bx = Math.floor(px), by = Math.floor(py), bz = Math.floor(pz);
            const id = world.getBlock(bx, by, bz);
            if (id) {
              const d = BLOCKS[id];
              const res = d ? d.blast : 0;
              s -= (res + 0.3) * 0.3;
              if (s > 0 && d && d.hardness >= 0 && !(opts.protect && opts.protect(id))) toBreak.set(bx + ',' + by + ',' + bz, [bx, by, bz, id]);
            }
            px += dx * 0.3; py += dy * 0.3; pz += dz * 0.3;
            s -= 0.225;
          }
        }
  }
  // Dégâts aux entités
  const r = power * 2;
  const ents = world.entitiesIn(x - r - 1, y - r - 1, z - r - 1, x + r + 1, y + r + 1, z + r + 1);
  for (const e of ents) {
    if (e === opts.source && !opts.hurtSource) continue;
    const ex = e.x, ey = e.y + (e.eyeHeight ? e.eyeHeight() : e.height / 2), ez = e.z;
    let dist = Math.hypot(ex - x, ey - y, ez - z) / r;
    if (dist > 1) continue;
    let dx = ex - x, dy = ey - y, dz = ez - z;
    const l = Math.hypot(dx, dy, dz) || 1;
    dx /= l; dy /= l; dz /= l;
    const exposure = seenPercent(world, x, y, z, e);
    const impact = (1 - dist) * exposure;
    const dmg = Math.floor(((impact * impact + impact) / 2) * 7 * r + 1);
    if (e.damage) e.damage(dmg, { type: 'explosion', entity: opts.source && opts.source.owner ? opts.source.owner : opts.source, noKnock: true });
    if (e.onExplosion) e.onExplosion(opts.source);
    const kb = impact * (1 - (e.knockbackResistance || 0));
    e.vx += dx * kb; e.vy += dy * kb; e.vz += dz * kb;
  }
  // Destruction
  const dropChance = 1 / power;
  for (const [bx, by, bz, id] of toBreak.values()) {
    if (world.getBlock(bx, by, bz) !== id) continue;
    if (id === B.tnt) {
      world.setBlock(bx, by, bz, 0, 0);
      const t = world.spawn('tnt', bx + 0.5, by, bz + 0.5, { fuse: 10 + Math.floor(Math.random() * 20) });
      continue;
    }
    const be = world.getBlockEntity(bx, by, bz);
    if (be && be.items) for (const s of be.items) if (s) world.dropItem(bx + 0.5, by + 0.5, bz + 0.5, { ...s });
    if (Math.random() < dropChance && !opts.noDrops) {
      for (const s of blockDrops(id, world.getMeta(bx, by, bz), null, null)) world.dropItem(bx + 0.5, by + 0.5, bz + 0.5, s);
    }
    world.setBlock(bx, by, bz, 0, 0, true);
  }
  if (opts.fire) {
    for (const [bx, by, bz] of toBreak.values()) {
      if (Math.random() < 0.33 && world.getBlock(bx, by, bz) === 0 && SOLID[world.getBlock(bx, by - 1, bz)]) world.setBlock(bx, by, bz, B.fire, 0);
    }
  }
  if (game) {
    game.audio?.play('explode', x, y, z, Math.min(2, power / 3 + 0.5), 0.9 + Math.random() * 0.2);
    game.particles?.spawnBurst(world, 'explosion', x, y, z, Math.ceil(power * 2), power * 0.4, 0.05);
    game.particles?.spawnBurst(world, 'big_smoke', x, y, z, Math.ceil(power * 3), power * 0.5, 0.08);
    game.onExplosion?.(world, x, y, z, power);
  }
}

// Fraction de points de la boîte de l'entité visibles depuis l'explosion
function seenPercent(world, x, y, z, e) {
  const bb = e.bbox();
  let seen = 0, total = 0;
  for (let i = 0; i <= 1; i += 0.5)
    for (let j = 0; j <= 1; j += 0.5)
      for (let k = 0; k <= 1; k += 0.5) {
        const px = bb[0] + (bb[3] - bb[0]) * i, py = bb[1] + (bb[4] - bb[1]) * j, pz = bb[2] + (bb[5] - bb[2]) * k;
        total++;
        const dx = px - x, dy = py - y, dz = pz - z;
        const d = Math.hypot(dx, dy, dz);
        const n = Math.ceil(d * 3);
        let blocked = false;
        for (let s = 1; s < n; s++) {
          const t = s / n;
          const id = world.getBlock(Math.floor(x + dx * t), Math.floor(y + dy * t), Math.floor(z + dz * t));
          if (id && BLOCKS[id].opaque && BLOCKS[id].solid) { blocked = true; break; }
        }
        if (!blocked) seen++;
      }
  return seen / total;
}
