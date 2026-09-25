// Projectiles : flèches, boules de feu, boules de neige, œufs, perles de l'Ender
import { Entity } from './entity.js';
import { registerEntity } from './registry.js';
import { raycastBlocks, rayBox } from '../game/raycast.js';
import { B, I } from '../data/ids.js';
import { BLOCKS, SOLID } from '../data/blocks.js';
import { explode } from '../world/explosion.js';
import * as M from '../core/math.js';
import { tex } from '../gfx/textures.js';
import { MODELS, renderModel, renderSprite } from '../gfx/models.js';

export class Projectile extends Entity {
  constructor(world, data) {
    super(world, data);
    this.owner = data.owner || null;
    this.width = this.height = 0.25;
    this.gravity = 0.03;
    this.drag = 0.99;
    this.inGround = false;
  }

  shoot(dx, dy, dz, speed, inaccuracy = 1) {
    const l = Math.hypot(dx, dy, dz);
    dx /= l; dy /= l; dz /= l;
    dx += (Math.random() - 0.5) * 0.015 * inaccuracy;
    dy += (Math.random() - 0.5) * 0.015 * inaccuracy;
    dz += (Math.random() - 0.5) * 0.015 * inaccuracy;
    this.vx = dx * speed; this.vy = dy * speed; this.vz = dz * speed;
    this.yaw = Math.atan2(-dx, -dz);
    this.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
  }

  tick() {
    super.tick();
    if (this.inGround) { this.tickInGround(); return; }
    const ox = this.x, oy = this.y + this.height / 2, oz = this.z;
    let vx = this.vx, vy = this.vy, vz = this.vz;
    const len = Math.hypot(vx, vy, vz);
    let hitT = Infinity, hitBlock = null, hitEnt = null;
    if (len > 1e-6) {
      const r = raycastBlocks(this.world, ox, oy, oz, vx, vy, vz, len, 'collide');
      if (r) { hitT = r.t; hitBlock = r; }
      // entités
      const x1 = ox + vx, y1 = oy + vy, z1 = oz + vz;
      const cand = this.world.entitiesIn(Math.min(ox, x1) - 2, Math.min(oy, y1) - 2, Math.min(oz, z1) - 2, Math.max(ox, x1) + 2, Math.max(oy, y1) + 2, Math.max(oz, z1) + 2,
        (e) => e !== this && e.damage && !(e === this.owner && this.age < 5) && !e.dead && e.type !== 'item' && e.type !== 'xp_orb' && !(e instanceof Projectile) && e.type !== 'area_cloud');
      for (const e of cand) {
        const boxes = e.hitboxes ? e.hitboxes() : [e.bbox()];
        for (const bb of boxes) {
          const g = 0.3;
          const hr = rayBox(ox, oy, oz, vx / len, vy / len, vz / len, bb[0] - g, bb[1] - g, bb[2] - g, bb[3] + g, bb[4] + g, bb[5] + g);
          if (hr && hr.t <= len && hr.t < hitT) { hitT = hr.t; hitEnt = { e, part: bb.part }; hitBlock = null; }
        }
      }
    }
    if (hitEnt) {
      this.x = ox + (vx / len) * hitT; this.y = oy + (vy / len) * hitT - this.height / 2; this.z = oz + (vz / len) * hitT;
      this.onHitEntity(hitEnt.e, hitEnt.part);
    } else if (hitBlock) {
      this.x = hitBlock.hx - (vx / len) * 0.05; this.y = hitBlock.hy - this.height / 2 - (vy / len) * 0.05; this.z = hitBlock.hz - (vz / len) * 0.05;
      this.onHitBlock(hitBlock);
    } else {
      this.x += vx; this.y += vy; this.z += vz;
      this.updateFluidState();
      const drag = this.inWater ? 0.6 : this.drag;
      this.vx *= drag; this.vy *= drag; this.vz *= drag;
      this.vy -= this.gravity;
      if (this.inWater && this.age % 3 === 0) this.game?.particles?.spawn(this.world, 'bubble', this.x, this.y, this.z, 0, 0.02, 0);
      const h = Math.hypot(this.vx, this.vz);
      this.yaw = Math.atan2(-this.vx, -this.vz);
      this.pitch = Math.atan2(this.vy, h);
    }
    if (this.age > 1200) this.removed = true;
  }

  tickInGround() {}
  onHitEntity() { this.removed = true; }
  onHitBlock() { this.removed = true; }

  spriteRender(r, buf, texName, size = 0.4) {
    const mat = M.mat4();
    M.translate(mat, mat, 0, this.height / 2, 0);
    M.rotateY(mat, mat, r.cam.yaw);
    M.rotateX(mat, mat, r.cam.pitch);
    renderSprite(buf, mat, tex(texName), 255, 255, size);
    return 'block';
  }
}

// ---------- Flèche ----------
export class Arrow extends Projectile {
  constructor(world, data) {
    super(world, data);
    this.type = 'arrow';
    this.gravity = 0.05;
    this.baseDamage = data.damage || 2;
    this.crit = !!data.crit;
    this.pickup = data.pickup ?? 1; // 0 non, 1 oui, 2 créatif
    this.knockbackLvl = data.knockback || 0;
    this.flame = !!data.flame;
    this.groundTime = 0;
    this.shake = 0;
    if (this.flame) this.fireTicks = 2000;
  }

  onHitEntity(e, part) {
    const speed = Math.hypot(this.vx, this.vy, this.vz);
    let dmg = Math.ceil(speed * this.baseDamage);
    if (this.crit) dmg += Math.floor(Math.random() * (dmg / 2 + 2));
    if (e.type === 'enderman') { e.teleportRandom?.(); this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1; return; }
    const ok = e.damage(dmg, { type: 'projectile', entity: this.owner || this, direct: this, part, knockMul: 1 + this.knockbackLvl * 0.5 });
    if (ok) {
      if (this.flame && e.type !== 'enderman') e.fireTicks = Math.max(e.fireTicks || 0, 100);
      this.world.playSound('arrow_hit', this.x, this.y, this.z);
      if (this.owner && this.owner.isPlayer && e !== this.owner) this.world.playSound('ding', this.owner.x, this.owner.y, this.owner.z, 0.3, 0.5);
      this.removed = true;
    } else {
      this.vx *= -0.1; this.vy *= -0.1; this.vz *= -0.1;
    }
  }

  onHitBlock(hit) {
    this.inGround = true;
    this.groundBlock = [hit.x, hit.y, hit.z, hit.id];
    this.vx = this.vy = this.vz = 0;
    this.shake = 7;
    this.world.playSound('arrow_hit', this.x, this.y, this.z, 0.6);
    this.crit = false;
    if (this.flame && hit.id === B.tnt) {
      this.world.setBlock(hit.x, hit.y, hit.z, 0);
      this.world.spawn('tnt', hit.x + 0.5, hit.y, hit.z + 0.5, {});
    }
  }

  tickInGround() {
    if (this.shake > 0) this.shake--;
    const [bx, by, bz, id] = this.groundBlock;
    if (this.world.getBlock(bx, by, bz) !== id) { this.inGround = false; this.vy = 0; return; }
    this.groundTime++;
    if (this.groundTime > 1200) this.removed = true;
    const p = this.game?.player;
    if (p && this.pickup && !p.dead && p.world === this.world && this.groundTime > 5 && p.distanceSq(this.x, this.y, this.z) < 2) {
      if (this.pickup === 1 && !p.creative) {
        if (p.inventory.add({ id: I.arrow, count: 1 }) === 0) { this.removed = true; this.world.playSound('pop', this.x, this.y, this.z, 0.3, 1.5); }
      } else this.removed = true;
    }
  }

  tick() {
    super.tick();
    if (this.crit && !this.inGround && this.age % 2 === 0) this.game?.particles?.spawn(this.world, 'crit', this.x, this.y, this.z, 0, 0, 0);
  }

  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    M.rotateY(mat, mat, M.lerp(this.prevYaw, this.yaw, pt));
    M.rotateX(mat, mat, M.lerp(this.prevPitch, this.pitch, pt));
    if (this.shake > 0) M.rotateX(mat, mat, Math.sin((this.shake - pt) * 3) * 0.1);
    renderModel(buf, MODELS.arrow, mat, {}, sky, bl);
    return 'skin';
  }
}
registerEntity('arrow', Arrow);

// ---------- Boule de feu (Ghast) ----------
export class Fireball extends Projectile {
  constructor(world, data) {
    super(world, data);
    this.type = 'fireball';
    this.width = this.height = 1;
    this.gravity = 0;
    this.drag = 1;
    this.power = data.power ?? 1;
    this.fullbright = true;
    this.ax = 0; this.ay = 0; this.az = 0;
  }

  setAccel(dx, dy, dz) {
    const l = Math.hypot(dx, dy, dz);
    this.ax = (dx / l) * 0.1; this.ay = (dy / l) * 0.1; this.az = (dz / l) * 0.1;
  }

  tick() {
    this.vx += this.ax; this.vy += this.ay; this.vz += this.az;
    this.vx *= 0.95; this.vy *= 0.95; this.vz *= 0.95;
    super.tick();
    this.game?.particles?.spawn(this.world, 'smoke', this.x, this.y + 0.5, this.z, 0, 0, 0);
  }

  // renvoyée si frappée
  damage(amt, src) {
    if (src && src.entity) {
      const e = src.entity;
      const d = M.lookDir(e.yaw, e.pitch);
      this.vx = d[0]; this.vy = d[1]; this.vz = d[2];
      this.setAccel(d[0], d[1], d[2]);
      this.owner = e;
      return true;
    }
    return false;
  }

  onHitEntity(e) {
    if (e === this.owner) return;
    e.damage(6, { type: 'projectile', entity: this.owner || this, direct: this });
    this.explode();
  }

  onHitBlock() {
    this.explode();
  }

  explode() {
    if (this.removed) return;
    this.removed = true;
    explode(this.world, this.x, this.y + 0.5, this.z, this.power, { source: this, fire: true, byMob: true });
  }

  render(r, buf) {
    return this.spriteRender(r, buf, 'particle_flame', 1.2);
  }
}
registerEntity('fireball', Fireball);

// ---------- Petite boule de feu (Blaze) ----------
export class SmallFireball extends Fireball {
  constructor(world, data) {
    super(world, data);
    this.type = 'small_fireball';
    this.width = this.height = 0.3125;
  }

  tick() {
    Projectile.prototype.tick.call(this);
    this.vx += this.ax * 0.5; this.vy += this.ay * 0.5; this.vz += this.az * 0.5;
    if (this.age % 2 === 0) this.game?.particles?.spawn(this.world, 'flame', this.x, this.y, this.z, 0, 0, 0);
  }

  onHitEntity(e) {
    if (e === this.owner || (this.owner && e.type === this.owner.type)) return;
    if (!e.fireImmune) {
      e.damage(5, { type: 'projectile', entity: this.owner || this, direct: this });
      e.fireTicks = Math.max(e.fireTicks || 0, 100);
    }
    this.removed = true;
  }

  onHitBlock(hit) {
    this.removed = true;
    const f = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]][hit.face];
    const x = hit.x + f[0], y = hit.y + f[1], z = hit.z + f[2];
    if (this.world.getBlock(x, y, z) === 0 && (!this.game || this.game.settings.mobGriefing !== false)) this.world.setBlock(x, y, z, B.fire);
  }

  render(r, buf) {
    return this.spriteRender(r, buf, 'particle_flame', 0.5);
  }
}
registerEntity('small_fireball', SmallFireball);

// ---------- Boule de feu du dragon ----------
export class DragonFireball extends Fireball {
  constructor(world, data) {
    super(world, data);
    this.type = 'dragon_fireball';
  }
  tick() {
    Projectile.prototype.tick.call(this);
    this.vx += this.ax; this.vy += this.ay; this.vz += this.az;
    this.game?.particles?.spawn(this.world, 'dragon', this.x, this.y + 0.5, this.z, 0, 0, 0);
  }
  onHitEntity(e) { if (e === this.owner) return; this.burst(); }
  onHitBlock() { this.burst(); }
  burst() {
    if (this.removed) return;
    this.removed = true;
    this.world.spawn('area_cloud', this.x, this.y, this.z, { radius: 3, duration: 400, owner: this.owner });
    this.world.playSound('explode', this.x, this.y, this.z, 0.6, 1.5);
  }
  render(r, buf) {
    return this.spriteRender(r, buf, 'particle_dragon', 1.2);
  }
}
registerEntity('dragon_fireball', DragonFireball);

// ---------- Objets lancés ----------
export class Thrown extends Projectile {
  constructor(world, data) {
    super(world, data);
    this.kind = data.kind;
    this.type = 'thrown_' + this.kind;
  }

  onHitEntity(e) {
    if (e === this.owner) return;
    if (this.kind === 'snowball') e.damage(e.type === 'blaze' ? 3 : 0.01, { type: 'projectile', entity: this.owner || this, direct: this });
    else if (this.kind === 'egg') e.damage(0.01, { type: 'projectile', entity: this.owner || this, direct: this });
    this.impact();
  }

  onHitBlock() {
    this.impact();
  }

  impact() {
    if (this.removed) return;
    this.removed = true;
    const p = this.game?.particles;
    if (this.kind === 'ender_pearl') {
      const o = this.owner;
      if (o && !o.dead && o.world === this.world) {
        p?.spawnBurst(this.world, 'portal', o.x, o.y + 1, o.z, 30, 0.5, 0.1);
        o.setPos(this.x, this.y, this.z);
        o.fallDistance = 0;
        if (o.isPlayer && !o.creative) o.damage(5, { type: 'fall', noKnock: true });
        this.world.playSound('teleport', this.x, this.y, this.z);
        p?.spawnBurst(this.world, 'portal', this.x, this.y + 1, this.z, 30, 0.5, 0.1);
      }
    } else if (this.kind === 'egg') {
      if (Math.random() < 0.125) {
        const n = Math.random() < 1 / 32 ? 4 : 1;
        for (let i = 0; i < n; i++) {
          const c = this.world.spawn('chicken', this.x, this.y, this.z);
          if (c) c.baby = 24000;
        }
      }
      p?.spawnBurst(this.world, 'white', this.x, this.y, this.z, 8, 0.1, 0.1);
    } else if (this.kind === 'experience_bottle') {
      this.world.dropXp(this.x, this.y, this.z, 3 + Math.floor(Math.random() * 9));
      this.world.playSound('glass', this.x, this.y, this.z);
      p?.spawnBurst(this.world, 'spell', this.x, this.y, this.z, 15, 0.3, 0.1);
    } else {
      p?.spawnBurst(this.world, 'white', this.x, this.y, this.z, 8, 0.1, 0.1);
    }
  }

  render(r, buf) {
    const names = { snowball: 'item_snowball', egg: 'item_egg', ender_pearl: 'item_ender_pearl', experience_bottle: 'item_experience_bottle' };
    return this.spriteRender(r, buf, names[this.kind] || 'item_snowball', 0.4);
  }
}
registerEntity('thrown', Thrown);

void BLOCKS; void SOLID;
