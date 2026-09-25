// Entités diverses : objets au sol, orbes d'XP, blocs qui tombent, TNT, œil de l'Ender, cristal de l'End, nuage
import { Entity } from './entity.js';
import { registerEntity } from './registry.js';
import { BLOCKS, REPLACEABLE, SOLID, LIQUID } from '../data/blocks.js';
import { B, I } from '../data/ids.js';
import { sameItem, stackMax } from '../game/inventory.js';
import { explode } from '../world/explosion.js';
import * as M from '../core/math.js';
import { tex } from '../gfx/textures.js';
import { MODELS, renderModel, renderBlockCube, renderSprite } from '../gfx/models.js';

// ---------- Objet au sol ----------
export class ItemEntity extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'item';
    this.stack = data.stack;
    this.width = 0.25;
    this.height = 0.25;
    this.pickupDelay = data.pickupDelay ?? 10;
    this.bobOffset = Math.random() * Math.PI * 2;
    this.lifespan = 6000;
  }

  tick() {
    super.tick();
    if (this.pickupDelay > 0) this.pickupDelay--;
    this.updateFluidState();
    if (this.inWater) {
      this.vy += this.vy < 0.06 ? 0.005 : 0;
      this.vx *= 0.99; this.vz *= 0.99;
    } else this.vy -= 0.04;
    if (this.inLava) {
      this.vy = 0.1;
      if (this.age % 5 === 0) this.world.playSound('fizz', this.x, this.y, this.z, 0.4);
      this.removed = true;
      return;
    }
    // sortir d'un bloc
    if (this.isSolidAt(this.x, this.y + 0.1, this.z)) this.vy = 0.15;
    this.move(this.vx, this.vy, this.vz);
    let f = 0.98;
    if (this.onGround) {
      const b = this.blockBelow();
      f = (b ? BLOCKS[b].slip : 0.6) * 0.98;
      if (this.vy < 0) this.vy *= -0.5;
    }
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.age >= this.lifespan) this.removed = true;
    // fusion
    if (this.age % 20 === 0) {
      for (const e of this.world.entitiesIn(this.x - 0.5, this.y - 0.5, this.z - 0.5, this.x + 0.5, this.y + 0.5, this.z + 0.5, (o) => o !== this && o.type === 'item')) {
        if (e.removed || !sameItem(e.stack, this.stack)) continue;
        const max = stackMax(this.stack);
        if (this.stack.count + e.stack.count > max) continue;
        this.stack.count += e.stack.count;
        e.removed = true;
      }
    }
    // ramassage
    if (this.pickupDelay === 0) {
      const p = this.game?.player;
      if (p && !p.dead && p.world === this.world) {
        const dx = p.x - this.x, dy = p.y + 0.5 - this.y, dz = p.z - this.z;
        if (Math.abs(dx) < 1 && Math.abs(dz) < 1 && dy > -1 && dy < 1.8) {
          const before = this.stack.count;
          const left = p.inventory.add(this.stack);
          if (left !== before) {
            this.world.playSound('pop', this.x, this.y, this.z, 0.3, 1.4 + Math.random() * 0.6);
            this.game?.onPickup?.(this.stack.id, before - left);
          }
          if (left <= 0) this.removed = true;
          else this.stack.count = left;
        }
      }
    }
  }

  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    const t = this.age + pt;
    const bob = Math.sin(t / 10 + this.bobOffset) * 0.1 + 0.15;
    M.translate(mat, mat, 0, bob, 0);
    if (r.isCubeItem(this.stack.id)) M.rotateY(mat, mat, t / 20 + this.bobOffset);
    else { M.rotateY(mat, mat, r.cam.yaw); M.translate(mat, mat, 0, 0.05, 0); }
    const n = this.stack.count > 32 ? 3 : this.stack.count > 1 ? 2 : 1;
    for (let i = 0; i < n; i++) {
      const m2 = M.mat4();
      M.translate(m2, mat, i * 0.06, i * 0.04, i * 0.05);
      r.renderItem(buf, m2, this.stack.id, sky, bl, 0.25);
    }
    return 'block';
  }
}
registerEntity('item', ItemEntity);

// ---------- Orbe d'expérience ----------
export class XpOrb extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'xp_orb';
    this.value = data.value || 1;
    this.width = this.height = 0.25;
    this.fullbright = true;
  }

  tick() {
    super.tick();
    this.vy -= 0.03;
    const p = this.game?.player;
    if (p && !p.dead && p.world === this.world) {
      const dx = p.x - this.x, dy = p.y + 0.9 - this.y, dz = p.z - this.z;
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d < 8) {
        const f = (1 - d / 8) ** 2 * 0.1;
        this.vx += (dx / d) * f; this.vy += (dy / d) * f; this.vz += (dz / d) * f;
      }
      if (d < 1.2 && this.age > 10) {
        p.addXp(this.value);
        this.removed = true;
        return;
      }
    }
    this.move(this.vx, this.vy, this.vz);
    const f = this.onGround ? 0.6 * 0.98 : 0.98;
    this.vx *= f; this.vy *= 0.98; this.vz *= f;
    if (this.onGround) this.vy *= -0.9;
    if (this.age > 6000) this.removed = true;
  }

  render(r, buf, pt) {
    const mat = M.mat4();
    const cam = r.cam;
    M.translate(mat, mat, 0, 0.12, 0);
    M.rotateY(mat, mat, cam.yaw);
    M.rotateX(mat, mat, cam.pitch);
    const t = (this.age + pt) / 2;
    const g = (Math.sin(t) + 1) * 0.5;
    const size = 0.15 + Math.min(0.25, this.value / 60);
    renderSprite(buf, mat, tex('particle_xp'), 255, 255, size, [Math.floor(150 + g * 100), 255, Math.floor(g * 80)]);
    return 'block';
  }
}
registerEntity('xp_orb', XpOrb);

// ---------- Bloc qui tombe ----------
export class FallingBlock extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'falling_block';
    this.block = data.block;
    this.meta = data.meta || 0;
    this.width = 0.98;
    this.height = 0.98;
  }

  tick() {
    super.tick();
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround || this.age > 600) {
      const bx = Math.floor(this.x), by = Math.floor(this.y + 0.5), bz = Math.floor(this.z);
      const cur = this.world.getBlock(bx, by, bz);
      this.removed = true;
      if ((cur === 0 || REPLACEABLE[cur]) && this.age <= 600) {
        this.world.setBlock(bx, by, bz, this.block, this.meta);
        this.world.game?.audio?.blockSound(BLOCKS[this.block].sound, 'place', bx + 0.5, by + 0.5, bz + 0.5);
      } else this.world.dropItem(this.x, this.y + 0.5, this.z, { id: this.block, count: 1 });
    }
  }

  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    M.translate(mat, mat, 0, 0.5, 0);
    renderBlockCube(buf, mat, r.blockFaceLayers(this.block, this.meta), sky, bl, 1);
    return 'block';
  }
}
registerEntity('falling_block', FallingBlock);

// ---------- TNT amorcée ----------
export class TntEntity extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'tnt';
    this.fuse = data.fuse ?? 80;
    this.width = 0.98;
    this.height = 0.98;
    this.owner = data.owner || null;
    this.vy = 0.2;
    this.vx = (Math.random() - 0.5) * 0.04;
    this.vz = (Math.random() - 0.5) * 0.04;
    world.playSound('fuse', this.x, this.y, this.z);
  }

  tick() {
    super.tick();
    this.vy -= 0.04;
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.98; this.vy *= 0.98; this.vz *= 0.98;
    if (this.onGround) { this.vx *= 0.7; this.vz *= 0.7; this.vy *= -0.5; }
    if (this.age % 2 === 0) this.game?.particles?.spawn(this.world, 'smoke', this.x, this.y + 1.1, this.z, 0, 0.02, 0);
    if (--this.fuse <= 0) {
      this.removed = true;
      this.updateFluidState();
      explode(this.world, this.x, this.y + 0.49, this.z, 4, { source: this, destroy: !this.inWater });
    }
  }

  overlay() {
    return (this.fuse / 5) % 2 < 1 ? [1, 1, 1, 0.6] : null;
  }

  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    let s = 1;
    if (this.fuse - pt + 1 < 10) {
      const f = 1 - (this.fuse - pt + 1) / 10;
      s = 1 + f * f * 0.3;
    }
    M.translate(mat, mat, 0, 0.5, 0);
    M.scale(mat, mat, s, s, s);
    renderBlockCube(buf, mat, r.blockFaceLayers(B.tnt, 0), sky, bl, 1);
    return 'block';
  }
}
registerEntity('tnt', TntEntity);

// ---------- Œil de l'Ender (lancé) ----------
export class EyeOfEnder extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'eye_of_ender';
    this.width = this.height = 0.25;
    this.tx = data.tx; this.ty = data.ty; this.tz = data.tz;
    this.survive = Math.random() > 0.2;
    this.noGravity = true;
    this.fullbright = true;
  }

  tick() {
    super.tick();
    const dx = this.tx - this.x, dz = this.tz - this.z;
    const d = Math.sqrt(dx * dx + dz * dz);
    let tx = this.tx, tz = this.tz, ty = this.ty;
    if (d > 12) { tx = this.x + (dx / d) * 12; tz = this.z + (dz / d) * 12; ty = this.y + 8; }
    const hd = Math.hypot(tx - this.x, tz - this.z);
    const sp = Math.hypot(this.vx, this.vz);
    const ang = Math.atan2(tz - this.z, tx - this.x);
    const ns = sp + (hd * 0.0025 - sp) * 0.0025 + 0.012;
    this.vx = Math.cos(ang) * Math.min(ns, 0.4);
    this.vz = Math.sin(ang) * Math.min(ns, 0.4);
    if (d < 1) this.vy += (ty - this.y > 0 ? 0.01 : -0.03) ;
    else this.vy += ((this.y < ty ? 1 : -1) * 0.015 - this.vy) * 0.1;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    if (this.age % 2 === 0) this.game?.particles?.spawn(this.world, 'portal', this.x, this.y - 0.2, this.z, (Math.random() - 0.5) * 0.1, -0.05, (Math.random() - 0.5) * 0.1);
    if (this.age > 80) {
      this.removed = true;
      this.world.playSound(this.survive ? 'pop' : 'glass', this.x, this.y, this.z);
      if (this.survive) this.world.dropItem(this.x, this.y, this.z, { id: I.ender_eye, count: 1 });
      else this.game?.particles?.spawnBurst(this.world, 'portal', this.x, this.y, this.z, 20, 0.3, 0.1);
    }
  }

  render(r, buf, pt) {
    const mat = M.mat4();
    M.rotateY(mat, mat, r.cam.yaw);
    M.rotateX(mat, mat, r.cam.pitch);
    renderSprite(buf, mat, tex('item_ender_eye'), 255, 255, 0.4);
    return 'block';
  }
}
registerEntity('eye_of_ender', EyeOfEnder);

// ---------- Cristal de l'End ----------
export class EndCrystal extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'end_crystal';
    this.width = 2;
    this.height = 2;
    this.persistent = true;
    this.noGravity = true;
    this.fullbright = true;
    this.showBase = data.showBase !== false;
    this.beamTarget = null;
    this.renderRadius = 2;
  }

  tick() {
    super.tick();
    if (this.world.dim === 'end' && this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === 0) {
      this.world.setBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z), B.fire, 0);
    }
  }

  damage(amount, src = {}) {
    if (this.removed) return false;
    if (src.type === 'explosion' && src.entity && src.entity.type === 'end_crystal') {
      // réaction en chaîne
    }
    this.removed = true;
    explode(this.world, this.x, this.y, this.z, 6, { source: this });
    this.world.game?.onCrystalDestroyed?.(this, src);
    return true;
  }

  bbox() {
    return [this.x - 1, this.y, this.z - 1, this.x + 1, this.y + 2, this.z + 1];
  }

  render(r, buf, pt) {
    const t = this.age + pt;
    const m = MODELS.end_crystal;
    const mat = M.mat4();
    const bob = Math.sin(t * 0.2) / 2 + 0.5;
    M.translate(mat, mat, 0, 1 + bob * 0.4, 0);
    const parts = {
      outer: [t * 0.05 + 0.6, t * 0.07, 0.785, 2],
      inner: [0.7, t * 0.1, 0.785, 1.2],
    };
    renderModel(buf, m, mat, { parts }, 255, 255);
    return 'skin';
  }
}
registerEntity('end_crystal', EndCrystal);

// ---------- Nuage de souffle de dragon ----------
export class AreaCloud extends Entity {
  constructor(world, data) {
    super(world, data);
    this.type = 'area_cloud';
    this.radius = data.radius || 3;
    this.duration = data.duration || 200;
    this.width = this.radius * 2;
    this.height = 0.5;
    this.invisible = true;
    this.owner = data.owner || null;
  }

  tick() {
    super.tick();
    if (this.age > this.duration) { this.removed = true; return; }
    const r = this.radius * (1 - (this.age / this.duration) * 0.5);
    const p = this.game?.particles;
    if (p) for (let i = 0; i < 4; i++) {
      const a = Math.random() * Math.PI * 2, d = Math.sqrt(Math.random()) * r;
      p.spawn(this.world, 'dragon', this.x + Math.cos(a) * d, this.y + 0.1, this.z + Math.sin(a) * d, 0, 0.02, 0);
    }
    if (this.age % 20 === 0) {
      for (const e of this.world.entitiesIn(this.x - r, this.y - 0.5, this.z - r, this.x + r, this.y + 2, this.z + r, (o) => o.damage && o.type !== 'ender_dragon' && o !== this.owner)) {
        if (Math.hypot(e.x - this.x, e.z - this.z) <= r) e.damage(6, { type: 'magic', bypassArmor: true, entity: this.owner, noKnock: true });
      }
    }
  }
}
registerEntity('area_cloud', AreaCloud);

void SOLID; void LIQUID; void sameItem;
