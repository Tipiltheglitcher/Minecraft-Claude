// Créatures : base d'IA + animaux, monstres, villageois, créatures du Nether
import { Living } from './living.js';
import { registerEntity } from './registry.js';
import { findPath } from './pathfind.js';
import { B, I } from '../data/ids.js';
import { SOLID, BLOCKS } from '../data/blocks.js';
import { explode } from '../world/explosion.js';
import { MODELS, renderModel } from '../gfx/models.js';
import * as M from '../core/math.js';
import { raycastBlocks } from '../game/raycast.js';

const rnd = Math.random;
const rint = (a, b) => a + Math.floor(rnd() * (b - a + 1));

// ================= Base =================
export class Mob extends Living {
  constructor(world, data) {
    super(world, data);
    this.hostile = false;
    this.target = null;
    this.path = null;
    this.pathTarget = null;
    this.pathTimer = rint(0, 20);
    this.wanderTimer = rint(40, 200);
    this.attackTimer = 0;
    this.baseSpeed = 0.25;
    this.followRange = 16;
    this.attackDamage = 2;
    this.idleSoundTimer = rint(80, 300);
    this.despawnable = true;
    this.lookTarget = null;
    this.xpReward = 5;
    this.panicTime = 0;
    this.baby = data && data.baby ? data.baby : 0;
    this.modelName = null;
  }

  get player() {
    return this.world.game?.player;
  }

  validTarget(p) {
    return p && !p.dead && p.world === this.world && !p.creative && !(p.isPlayer && this.world.game?.spectator);
  }

  findPlayer(range) {
    const p = this.player;
    if (!this.validTarget(p)) return null;
    const d = this.distanceTo(p);
    if (d > range) return null;
    if (d > 10 && !this.canSee(p)) return null;
    if (p.sneaking && d > 6 && !this.canSee(p)) return null;
    return p;
  }

  // Suivi de chemin vers une position
  navigateTo(x, y, z, speedMul = 1) {
    this.pathTimer--;
    const tx = Math.floor(x), ty = Math.floor(y), tz = Math.floor(z);
    if (!this.path || this.pathTimer <= 0 || !this.pathTarget || Math.abs(this.pathTarget[0] - tx) + Math.abs(this.pathTarget[2] - tz) > 2) {
      this.pathTimer = 15 + rint(0, 15);
      this.pathTarget = [tx, ty, tz];
      this.path = findPath(this.world, Math.floor(this.x), Math.floor(this.y + 0.01), Math.floor(this.z), tx, ty, tz, { height: Math.ceil(this.height), maxNodes: 300, maxDrop: 3 });
      if (!this.path.length) this.path = [{ x: tx, y: ty, z: tz }];
    }
    this.followPath(speedMul);
  }

  followPath(speedMul = 1) {
    if (!this.path || !this.path.length) { this.forward = 0; return; }
    const n = this.path[0];
    const dx = n.x + 0.5 - this.x, dz = n.z + 0.5 - this.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < 0.35 + (this.width > 1 ? 0.5 : 0) && Math.abs(n.y - this.y) < 1.5) {
      this.path.shift();
      if (!this.path.length) { this.forward = 0; return; }
      return this.followPath(speedMul);
    }
    const yaw = Math.atan2(-dx, -dz);
    this.yaw += M.clamp(M.wrapAngle(yaw - this.yaw), -0.5, 0.5);
    this.headYaw = this.yaw;
    this.forward = 1;
    this.moveSpeed = this.baseSpeed * speedMul;
    if ((n.y > this.y + 0.5 || this.collidedH) && this.onGround) this.jumping = true;
  }

  moveDirect(x, z, speedMul = 1) {
    const dx = x - this.x, dz = z - this.z;
    const yaw = Math.atan2(-dx, -dz);
    this.yaw += M.clamp(M.wrapAngle(yaw - this.yaw), -0.5, 0.5);
    this.forward = 1;
    this.moveSpeed = this.baseSpeed * speedMul;
    if (this.collidedH && this.onGround) this.jumping = true;
  }

  wander(speedMul = 1, range = 10) {
    if (--this.wanderTimer <= 0) {
      this.wanderTimer = rint(100, 300);
      if (rnd() < 0.7) {
        const tx = this.x + (rnd() - 0.5) * range * 2, tz = this.z + (rnd() - 0.5) * range * 2;
        this.wanderGoal = [tx, this.y, tz];
        this.path = null;
      } else this.wanderGoal = null;
    }
    if (this.wanderGoal) {
      const [tx, ty, tz] = this.wanderGoal;
      if ((tx - this.x) ** 2 + (tz - this.z) ** 2 < 1.5) { this.wanderGoal = null; this.path = null; return; }
      this.navigateTo(tx, ty, tz, speedMul);
      if (this.path && !this.path.length) this.wanderGoal = null;
    }
  }

  aiStep() {
    this.forward = 0;
    this.strafe = 0;
    this.jumping = false;
    this.moveSpeed = this.baseSpeed;
    if (this.noAI) return;
    if (this.attackTimer > 0) this.attackTimer--;
    this.ai();
    if ((this.inWater || this.inLava) && !this.noGravity && rnd() < 0.8) this.jumping = true;
    // bruits
    if (--this.idleSoundTimer <= 0) {
      this.idleSoundTimer = rint(120, 400);
      if (this.idleSound) this.world.playSound(this.idleSound, this.x, this.y + 1, this.z, 0.7, this.soundPitch || 1);
    }
    // regarder autour
    if (this.lookTarget) this.lookAt(this.lookTarget.x, this.lookTarget.y + (this.lookTarget.eyeHeight ? this.lookTarget.eyeHeight() : 1), this.lookTarget.z);
    else this.headYaw += M.clamp(M.wrapAngle(this.yaw - this.headYaw), -0.3, 0.3);
    this.despawnCheck();
    if (this.baby > 0) this.baby--;
  }

  ai() {}

  despawnCheck() {
    if (!this.despawnable || this.persistent) return;
    const p = this.player;
    if (!p) return;
    const d2 = this.distanceSq(p.x, p.y, p.z);
    if (d2 > 128 * 128) this.removed = true;
    else if (d2 > 32 * 32 && this.hostile && rnd() < 1 / 800) this.removed = true;
    if (this.hostile && this.world.game?.settings.difficulty === 0) this.removed = true;
  }

  // Attaque au corps à corps
  meleeAttack(t) {
    const reach = this.width * 2 * this.width * 2 + t.width + 0.6;
    const dx = t.x - this.x, dz = t.z - this.z, dy = t.y - this.y;
    if (dx * dx + dz * dz <= reach && Math.abs(dy) < 2.5 && this.attackTimer <= 0) {
      this.attackTimer = 20;
      this.swingArm();
      const ok = t.damage(this.attackDamage, { type: 'mob', entity: this });
      if (ok) this.onAttackHit?.(t);
      return true;
    }
    return false;
  }

  chase(t, speedMul = 1) {
    this.lookTarget = t;
    const d2 = this.distanceSq(t.x, t.y, t.z);
    if (d2 < 3 * 3 && this.canSee(t) && Math.abs(t.y - this.y) < 1.5) this.moveDirect(t.x, t.z, speedMul);
    else this.navigateTo(t.x, t.y, t.z, speedMul);
    this.meleeAttack(t);
  }

  isDaylightBurn() {
    const w = this.world;
    if (w.dim !== 'overworld' || this.inWater || this.fireImmune) return false;
    const g = w.game;
    if (!g || g.skyDarken() > 3 || (g.weather && g.weather.raining)) return false;
    if (this.helmet) return false;
    const bx = Math.floor(this.x), by = Math.floor(this.y + this.eyeHeight()), bz = Math.floor(this.z);
    return w.getSky(bx, by, bz) >= 15 && rnd() < 0.3;
  }

  onHurt(dmg, src) {
    if (src.entity && src.entity !== this) {
      if (this.hostile || this.neutral) this.target = src.entity;
      this.panicTime = 100;
    }
  }

  modelRoot(pt, scale = 1) {
    const mat = M.mat4();
    const by = M.lerp(this.prevBodyYaw, this.bodyYaw, pt);
    M.rotateY(mat, mat, by);
    if (this.dead) {
      const t = Math.min(1, (this.deathTime + pt) / 20);
      M.rotateZ(mat, mat, Math.sqrt(t) * Math.PI / 2);
    }
    const s = scale * (this.baby > 0 ? 0.5 : 1);
    if (s !== 1) M.scale(mat, mat, s, s, s);
    return { mat, by };
  }

  anim(pt) {
    const ls = M.lerp(this.prevLimbSwing, this.limbSwing, pt) * 0.6662;
    const la = Math.min(1, M.lerp(this.prevLimbAmount, this.limbAmount, pt));
    const by = M.lerp(this.prevBodyYaw, this.bodyYaw, pt);
    const hy = M.wrapAngle(M.lerp(this.prevHeadYaw, this.headYaw, pt) - by);
    const hp = M.lerp(this.prevPitch, this.pitch, pt);
    return { ls, la, hy: M.clamp(hy, -1.2, 1.2), hp };
  }
}

// ---- Rendus génériques ----
function renderBiped(e, r, buf, pt, sky, bl, modelName, opts = {}) {
  const { mat } = e.modelRoot(pt, opts.scale || 1);
  const { ls, la, hy, hp } = e.anim(pt);
  const swing = e.getSwing(pt);
  const armBase = opts.armsUp ? Math.PI / 2 - 0.1 : 0;
  const parts = {
    head: [hp, hy, 0],
    rarm: [armBase + (opts.armsUp ? Math.sin(e.age * 0.1) * 0.05 : Math.cos(ls + Math.PI) * la * 0.8) + Math.sin(swing * Math.PI) * 1.2, 0, opts.armsUp ? 0 : 0.05],
    larm: [armBase + (opts.armsUp ? Math.sin(e.age * 0.1 + 1) * 0.05 : Math.cos(ls) * la * 0.8), 0, opts.armsUp ? 0 : -0.05],
    rleg: [Math.cos(ls) * 1.4 * la, 0, 0],
    lleg: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0],
  };
  if (opts.aim) { parts.rarm = [Math.PI / 2 + hp, hy * 0.5, 0]; parts.larm = [Math.PI / 2 + hp, hy * 0.5 + 0.4, 0]; }
  renderModel(buf, MODELS[modelName], mat, { parts }, sky, bl);
  if (opts.held) {
    // objet tenu dans la main droite (rendu dans une seconde passe, texture des blocs)
    const m2 = M.mat4();
    M.copy(m2, mat);
    M.translate(m2, m2, -6 / 16, 22 / 16, 0);
    M.rotateZ(m2, m2, parts.rarm[2]);
    M.rotateX(m2, m2, parts.rarm[0]);
    M.translate(m2, m2, 0, -10 / 16, -2 / 16);
    M.rotateY(m2, m2, -Math.PI / 2);
    M.rotateZ(m2, m2, Math.PI / 4 + Math.PI / 2);
    M.translate(m2, m2, 0.18, 0.18, 0);
    e._heldMat = m2;
    e._heldId = opts.held;
  }
  return 'skin';
}

function renderQuad(e, r, buf, pt, sky, bl, modelName, extra = {}) {
  const { mat } = e.modelRoot(pt, extra.scale || 1);
  const { ls, la, hy, hp } = e.anim(pt);
  const parts = {
    head: [hp + (extra.headDown || 0), hy, 0],
    leg0: [Math.cos(ls) * 1.4 * la, 0, 0],
    leg1: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0],
    leg2: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0],
    leg3: [Math.cos(ls) * 1.4 * la, 0, 0],
  };
  renderModel(buf, MODELS[modelName], mat, { parts, hidden: extra.hidden }, sky, bl);
  return 'skin';
}

// ================= Animaux =================
class Animal extends Mob {
  constructor(world, data) {
    super(world, data);
    this.xpReward = rint(1, 3);
    this.love = 0;
    this.breedCooldown = 0;
    this.food = [I.wheat_item];
    this.despawnable = false;
  }

  isFood(id) {
    return this.food.includes(id);
  }

  ai() {
    const p = this.player;
    if (this.breedCooldown > 0) this.breedCooldown--;
    if (this.love > 0) {
      this.love--;
      if (this.age % 10 === 0) this.world.game?.particles?.spawn(this.world, 'heart', this.x, this.y + this.height + 0.2, this.z, 0, 0.02, 0);
      const mate = this.world.entitiesIn(this.x - 8, this.y - 4, this.z - 8, this.x + 8, this.y + 4, this.z + 8, (e) => e !== this && e.type === this.type && e.love > 0 && !e.dead)[0];
      if (mate) {
        this.lookTarget = mate;
        this.navigateTo(mate.x, mate.y, mate.z, 1);
        if (this.distanceTo(mate) < 1.5) {
          this.love = 0; mate.love = 0;
          this.breedCooldown = mate.breedCooldown = 6000;
          const baby = this.world.spawn(this.type, this.x, this.y, this.z, { baby: 24000 });
          if (baby) baby.baby = 24000;
          this.world.dropXp(this.x, this.y, this.z, rint(1, 7));
          this.world.game?.onBreed?.(this.type);
        }
        return;
      }
    }
    if (this.panicTime > 0) {
      this.panicTime--;
      if (!this.panicGoal || this.age % 30 === 0) this.panicGoal = [this.x + (rnd() - 0.5) * 16, this.y, this.z + (rnd() - 0.5) * 16];
      this.moveDirect(this.panicGoal[0], this.panicGoal[2], 1.6);
      return;
    }
    // suivre le joueur qui tient de la nourriture
    if (p && !p.dead && p.world === this.world && this.distanceTo(p) < 10) {
      const held = p.inventory.selected();
      if (held && this.isFood(held.id)) {
        this.lookTarget = p;
        if (this.distanceTo(p) > 2.5) this.navigateTo(p.x, p.y, p.z, 1.1);
        return;
      }
      if (this.distanceTo(p) < 6 && rnd() < 0.02) this.lookTarget = p;
    }
    if (this.lookTarget && rnd() < 0.01) this.lookTarget = null;
    this.wander(0.8);
    this.extraAi?.();
  }

  interact(player, stack) {
    if (stack && this.isFood(stack.id) && this.baby <= 0 && this.breedCooldown <= 0 && this.love <= 0) {
      this.love = 600;
      if (!player.creative) player.inventory.consumeSelected();
      this.world.playSound('eat', this.x, this.y, this.z, 0.5);
      return true;
    }
    if (stack && this.isFood(stack.id) && this.baby > 0) {
      this.baby = Math.max(0, this.baby - 2400);
      if (!player.creative) player.inventory.consumeSelected();
      return true;
    }
    return false;
  }
}

export class Pig extends Animal {
  constructor(w, d) { super(w, d); this.type = 'pig'; this.width = 0.9; this.height = 0.9; this.maxHealth = this.health = 10; this.baseSpeed = 0.25; this.food = [I.carrot, I.potato, I.wheat_item]; this.idleSound = 'pig'; this.hurtSound = 'pig_hurt'; this.deathSound = 'pig_hurt'; }
  dropLoot(p, looting) { this.drop(this.fireTicks > 0 ? I.cooked_porkchop : I.porkchop, rint(1, 3 + looting)); }
  render(r, buf, pt, sky, bl) { return renderQuad(this, r, buf, pt, sky, bl, 'pig'); }
}
registerEntity('pig', Pig);

export class Cow extends Animal {
  constructor(w, d) { super(w, d); this.type = 'cow'; this.width = 0.9; this.height = 1.4; this.maxHealth = this.health = 10; this.baseSpeed = 0.2; this.idleSound = 'cow'; this.hurtSound = 'cow_hurt'; this.deathSound = 'cow_hurt'; }
  dropLoot(p, looting) { this.drop(I.leather, rint(0, 2 + looting)); this.drop(this.fireTicks > 0 ? I.cooked_beef : I.beef, rint(1, 3 + looting)); }
  interact(player, stack) {
    if (stack && stack.id === I.bucket && this.baby <= 0) {
      if (!player.creative) {
        player.inventory.consumeSelected();
        if (player.inventory.selected()) { if (player.inventory.add({ id: I.milk_bucket, count: 1 }) > 0) this.world.dropItem(player.x, player.y + 1, player.z, { id: I.milk_bucket, count: 1 }); }
        else player.inventory.setSelected({ id: I.milk_bucket, count: 1 });
      }
      this.world.playSound('milk', this.x, this.y, this.z);
      return true;
    }
    return super.interact(player, stack);
  }
  render(r, buf, pt, sky, bl) { return renderQuad(this, r, buf, pt, sky, bl, 'cow'); }
}
registerEntity('cow', Cow);

export class Sheep extends Animal {
  constructor(w, d) { super(w, d); this.type = 'sheep'; this.width = 0.9; this.height = 1.3; this.maxHealth = this.health = 8; this.baseSpeed = 0.23; this.sheared = false; this.eatTimer = 0; this.idleSound = 'sheep'; this.hurtSound = 'sheep'; this.deathSound = 'sheep'; }
  dropLoot(p, looting) { if (!this.sheared) this.drop(B.white_wool, 1); this.drop(this.fireTicks > 0 ? I.cooked_mutton : I.mutton, rint(1, 2 + looting)); }
  extraAi() {
    if (this.eatTimer > 0) { this.eatTimer--; this.forward = 0; if (this.eatTimer === 4) this.eatGrass(); return; }
    if (rnd() < (this.sheared ? 1 / 100 : 1 / 1000)) {
      const b = this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.5), Math.floor(this.z));
      if (b === B.grass_block || this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z)) === B.short_grass) this.eatTimer = 40;
    }
  }
  eatGrass() {
    const x = Math.floor(this.x), y = Math.floor(this.y), z = Math.floor(this.z);
    if (this.world.getBlock(x, y, z) === B.short_grass) this.world.setBlock(x, y, z, 0);
    else if (this.world.getBlock(x, y - 1, z) === B.grass_block) this.world.setBlock(x, y - 1, z, B.dirt);
    else return;
    this.sheared = false;
    if (this.baby > 0) this.baby = Math.max(0, this.baby - 1200);
  }
  interact(player, stack) {
    if (stack && stack.id === I.shears && !this.sheared && this.baby <= 0) {
      this.sheared = true;
      for (let i = 0; i < rint(1, 3); i++) this.world.dropItem(this.x, this.y + 1, this.z, { id: B.white_wool, count: 1 });
      this.world.playSound('shear', this.x, this.y, this.z);
      player.damageHeld(1);
      return true;
    }
    return super.interact(player, stack);
  }
  render(r, buf, pt, sky, bl) {
    const hd = this.eatTimer > 4 ? 0.8 : 0;
    return renderQuad(this, r, buf, pt, sky, bl, 'sheep', { hidden: this.sheared ? new Set(['wool']) : null, headDown: hd });
  }
}
registerEntity('sheep', Sheep);

export class Chicken extends Animal {
  constructor(w, d) { super(w, d); this.type = 'chicken'; this.width = 0.4; this.height = 0.7; this.maxHealth = this.health = 4; this.baseSpeed = 0.25; this.food = [I.wheat_seeds]; this.eggTimer = rint(6000, 12000); this.flap = 0; this.idleSound = 'chicken'; this.hurtSound = 'chicken_hurt'; this.deathSound = 'chicken_hurt'; this.soundPitch = 1.2; }
  extraAi() {
    if (--this.eggTimer <= 0 && this.baby <= 0) { this.eggTimer = rint(6000, 12000); this.drop(I.egg, 1); this.world.playSound('pop', this.x, this.y, this.z); }
  }
  travel() { super.travel(); if (!this.onGround && this.vy < -0.08) this.vy = -0.08; this.fallDistance = 0; }
  onLand() {}
  dropLoot(p, looting) { this.drop(I.feather, rint(0, 2 + looting)); this.drop(this.fireTicks > 0 ? I.cooked_chicken : I.chicken, 1); }
  render(r, buf, pt, sky, bl) {
    const { mat } = this.modelRoot(pt);
    const { ls, la, hy, hp } = this.anim(pt);
    const flap = this.onGround ? 0 : Math.sin((this.age + pt) * 1.2) * 0.8 + 0.8;
    renderModel(buf, MODELS.chicken, mat, { parts: { head: [hp, hy, 0], rleg: [Math.cos(ls) * 1.4 * la, 0, 0], lleg: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0], rwing: [0, 0, flap], lwing: [0, 0, -flap] } }, sky, bl);
    return 'skin';
  }
}
registerEntity('chicken', Chicken);

// ================= Monstres =================
class Monster extends Mob {
  constructor(world, data) {
    super(world, data);
    this.hostile = true;
    this.xpReward = 5;
    this.followRange = 35;
  }

  ai() {
    if (this.target && (!this.validTarget(this.target) || this.target.dead || this.distanceTo(this.target) > this.followRange * 1.3)) this.target = null;
    if (!this.target && this.age % 10 === 0) this.target = this.findPlayer(this.detectRange ? this.detectRange() : this.followRange);
    if (this.isDaylightBurn() && this.burnsInDay) this.fireTicks = Math.max(this.fireTicks, 160);
    if (this.target) this.combat(this.target);
    else { this.lookTarget = null; this.wander(0.8); }
  }

  combat(t) {
    this.chase(t, 1);
  }
}

export class Zombie extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'zombie'; this.maxHealth = this.health = 20; this.baseSpeed = 0.23; this.attackDamage = 3; this.burnsInDay = true; this.armor = 2;
    this.idleSound = 'zombie'; this.hurtSound = 'zombie_hurt'; this.deathSound = 'zombie_death';
    if (rnd() < 0.05) this.baby = 1e9;
    this.helmet = rnd() < 0.05;
    if (this.baby > 0) this.baseSpeed = 0.35;
  }
  dropLoot(p, looting) {
    this.drop(I.rotten_flesh, rint(0, 2 + looting));
    if (p && rnd() < 0.025 + looting * 0.01) this.drop(rnd() < 0.33 ? I.iron_ingot : rnd() < 0.5 ? I.carrot : I.potato, 1);
  }
  onAttackHit(t) { if (this.fireTicks > 0 && rnd() < 0.3) t.fireTicks = Math.max(t.fireTicks, 40); }
  render(r, buf, pt, sky, bl) { return renderBiped(this, r, buf, pt, sky, bl, 'zombie', { armsUp: true }); }
}
registerEntity('zombie', Zombie);

export class Skeleton extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'skeleton'; this.maxHealth = this.health = 20; this.baseSpeed = 0.25; this.burnsInDay = true; this.followRange = 16;
    this.shootTimer = 20; this.strafeDir = 1; this.strafeTimer = 0; this.drawing = 0;
    this.idleSound = 'skeleton'; this.hurtSound = 'skeleton_hurt'; this.deathSound = 'skeleton_death';
  }
  combat(t) {
    this.lookTarget = t;
    const d = this.distanceTo(t);
    const see = this.canSee(t);
    if (d > 12 || !see) this.navigateTo(t.x, t.y, t.z, 1);
    else {
      if (d < 6) { this.forward = -0.5; }
      if (--this.strafeTimer <= 0) { this.strafeTimer = rint(20, 60); if (rnd() < 0.3) this.strafeDir *= -1; }
      this.strafe = this.strafeDir * 0.5;
      this.yaw = this.headYaw;
    }
    if (see && d < 16) {
      this.drawing++;
      if (this.drawing >= 20 && --this.shootTimer <= 0) {
        this.shootTimer = rint(20, 40);
        this.drawing = 0;
        this.shoot(t);
      }
    } else this.drawing = 0;
  }
  shoot(t) {
    const a = this.world.spawn('arrow', this.x, this.y + this.eyeHeight() - 0.1, this.z, { owner: this, damage: 2, pickup: 0 });
    if (!a) return;
    const dx = t.x - this.x, dz = t.z - this.z;
    const dy = t.y + t.height * 0.33 - a.y;
    const h = Math.sqrt(dx * dx + dz * dz);
    const diff = this.world.game?.settings.difficulty ?? 2;
    a.shoot(dx, dy + h * 0.2, dz, 1.6, 14 - diff * 4);
    this.world.playSound('bow', this.x, this.y, this.z, 0.8);
    this.swingArm();
  }
  dropLoot(p, looting) {
    this.drop(I.bone, rint(0, 2 + looting));
    this.drop(I.arrow, rint(0, 2 + looting));
    if (p && rnd() < 0.085) this.drop(I.bow, 1, { dmg: rint(100, 350) });
  }
  render(r, buf, pt, sky, bl) { return renderBiped(this, r, buf, pt, sky, bl, 'skeleton', { aim: !!this.target && this.drawing > 0, held: I.bow }); }
}
registerEntity('skeleton', Skeleton);

export class WitherSkeleton extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'wither_skeleton'; this.maxHealth = this.health = 20; this.baseSpeed = 0.25; this.attackDamage = 8; this.fireImmune = true;
    this.width = 0.7; this.height = 2.4; this.followRange = 16;
    this.idleSound = 'skeleton'; this.hurtSound = 'skeleton_hurt'; this.deathSound = 'skeleton_death'; this.soundPitch = 0.7;
  }
  onAttackHit(t) { t.addEffect?.('poison', 100, 0); }
  dropLoot(p, looting) { this.drop(I.bone, rint(0, 2 + looting)); if (rnd() < 0.33) this.drop(I.coal, 1); }
  render(r, buf, pt, sky, bl) { return renderBiped(this, r, buf, pt, sky, bl, 'wither_skeleton', { scale: 1.2, held: I.stone_sword }); }
}
registerEntity('wither_skeleton', WitherSkeleton);

export class Creeper extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'creeper'; this.maxHealth = this.health = 20; this.baseSpeed = 0.25; this.height = 1.7; this.followRange = 16;
    this.fuse = 0; this.prevFuse = 0; this.maxFuse = 30; this.powered = !!(d && d.powered);
    this.hurtSound = 'creeper_hurt'; this.deathSound = 'creeper_hurt';
  }
  ai() {
    this.prevFuse = this.fuse;
    super.ai();
  }
  combat(t) {
    const d = this.distanceTo(t);
    this.lookTarget = t;
    if (d < 3 && this.canSee(t)) {
      if (this.fuse === 0) this.world.playSound('hiss', this.x, this.y, this.z);
      this.fuse++;
      this.forward = 0;
      if (this.fuse >= this.maxFuse) {
        this.removed = true;
        this.dead = true;
        explode(this.world, this.x, this.y + 0.5, this.z, this.powered ? 6 : 3, { source: this, byMob: true });
      }
    } else {
      if (d > 7 || this.fuse === 0) this.fuse = Math.max(0, this.fuse - 1);
      else this.fuse++;
      if (this.fuse >= this.maxFuse) { this.removed = true; this.dead = true; explode(this.world, this.x, this.y + 0.5, this.z, this.powered ? 6 : 3, { source: this, byMob: true }); return; }
      this.chaseNoAttack(t);
    }
  }
  chaseNoAttack(t) {
    if (this.distanceSq(t.x, t.y, t.z) < 9 && this.canSee(t)) this.moveDirect(t.x, t.z, 1);
    else this.navigateTo(t.x, t.y, t.z, 1);
  }
  dropLoot(p, looting) { this.drop(I.gunpowder, rint(0, 2 + looting)); }
  overlay(pt) {
    const f = M.lerp(this.prevFuse, this.fuse, pt) / this.maxFuse;
    if (f > 0 && Math.floor(f * 10) % 2 === 0) return [1, 1, 1, 0.5];
    return super.overlay(pt);
  }
  render(r, buf, pt, sky, bl) {
    const f = Math.max(0, M.lerp(this.prevFuse, this.fuse, pt) / this.maxFuse);
    const { mat } = this.modelRoot(pt);
    const sw = 1 + Math.sin(f * 100) * f * 0.01;
    const s = 1 + f * f * f * 0.4;
    M.scale(mat, mat, s * sw, s / sw, s * sw);
    const { ls, la, hy, hp } = this.anim(pt);
    renderModel(buf, MODELS.creeper, mat, { parts: { head: [hp, hy, 0], leg0: [Math.cos(ls) * 1.4 * la, 0, 0], leg1: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0], leg2: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0], leg3: [Math.cos(ls) * 1.4 * la, 0, 0] } }, sky, bl);
    return 'skin';
  }
}
registerEntity('creeper', Creeper);

export class Spider extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'spider'; this.maxHealth = this.health = 16; this.baseSpeed = 0.3; this.width = 1.4; this.height = 0.9; this.attackDamage = 2;
    this.idleSound = 'spider'; this.hurtSound = 'spider'; this.deathSound = 'spider_death';
    this.stepHeight = 0.6;
  }
  isClimbing() { return this.collidedH || super.isClimbing(); }
  ai() {
    // neutre le jour
    const g = this.world.game;
    if (this.target && g && this.world.dim === 'overworld' && g.skyDarken() < 4 && rnd() < 0.01 && !this.provoked) this.target = null;
    if (!this.target && this.age % 10 === 0) {
      const light = this.world.getLight(Math.floor(this.x), Math.floor(this.y + 0.5), Math.floor(this.z));
      if (light < 12 || this.provoked) this.target = this.findPlayer(16);
    }
    if (this.target && !this.validTarget(this.target)) this.target = null;
    if (this.target) {
      const t = this.target;
      this.chase(t, 1);
      const d = this.distanceTo(t);
      if (d > 2 && d < 6 && this.onGround && rnd() < 0.1) {
        const dx = t.x - this.x, dz = t.z - this.z, l = Math.hypot(dx, dz);
        this.vx += (dx / l) * 0.4; this.vz += (dz / l) * 0.4; this.vy = 0.4;
      }
    } else this.wander(0.8);
  }
  onHurt(dmg, src) { super.onHurt(dmg, src); this.provoked = true; }
  dropLoot(p, looting) { this.drop(I.string, rint(0, 2 + looting)); if (p && rnd() < 0.33) this.drop(I.spider_eye, 1); }
  render(r, buf, pt, sky, bl) {
    const { mat } = this.modelRoot(pt);
    const { ls, la, hy, hp } = this.anim(pt);
    const parts = { head: [hp, hy, 0] };
    const ys = [Math.PI / 4, Math.PI / 8, -Math.PI / 8, -Math.PI / 4];
    for (let i = 0; i < 8; i++) {
      const right = i % 2 === 0, k = i >> 1;
      const ph = ls * 2 + (k % 2 ? Math.PI : 0) + (right ? 0 : Math.PI);
      const sy = -Math.cos(ph) * 0.4 * la, sz = Math.abs(Math.sin(ph)) * 0.4 * la;
      parts['leg' + i] = [0, (right ? ys[k] : -ys[k]) + sy, (right ? Math.PI / 4 : -Math.PI / 4) + (right ? sz : -sz)];
    }
    renderModel(buf, MODELS.spider, mat, { parts }, sky, bl);
    return 'skin';
  }
}
registerEntity('spider', Spider);

export class Enderman extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'enderman'; this.maxHealth = this.health = 40; this.baseSpeed = 0.3; this.width = 0.6; this.height = 2.9; this.attackDamage = 7;
    this.neutral = true; this.hostile = true; this.angry = false; this.stareTimer = 0; this.tpCooldown = 0;
    this.idleSound = 'enderman'; this.hurtSound = 'enderman_hurt'; this.deathSound = 'enderman_death';
    this.canDrown = false;
  }
  eyeHeight() { return 2.55; }
  ai() {
    if (this.tpCooldown > 0) this.tpCooldown--;
    const p = this.player;
    // regard du joueur
    if (!this.angry && p && this.validTarget(p) && this.distanceTo(p) < 64 && this.age % 5 === 0) {
      if (this.isLookedAt(p)) {
        this.stareTimer++;
        this.lookTarget = p;
        if (this.stareTimer > 3) { this.angry = true; this.target = p; this.world.playSound('enderman_scream', this.x, this.y + 2, this.z); }
      } else this.stareTimer = 0;
    }
    if (this.target && (!this.validTarget(this.target) || this.distanceTo(this.target) > 64)) { this.target = null; this.angry = false; }
    // eau / pluie
    const g = this.world.game;
    if (this.inWater || (g && g.weather && g.weather.raining && this.world.dim === 'overworld' && this.world.getSky(Math.floor(this.x), Math.floor(this.y + 2), Math.floor(this.z)) >= 15)) {
      if (this.age % 20 === 0) this.damage(1, { type: 'drown', noKnock: true });
      if (this.tpCooldown <= 0) this.teleportRandom();
    }
    if (this.target && this.angry) {
      const t = this.target;
      this.chase(t, 1.3);
      if (this.distanceTo(t) > 12 && this.tpCooldown <= 0 && rnd() < 0.05) this.teleportToward(t);
    } else {
      this.wander(0.6);
      if (rnd() < 0.0015 && this.tpCooldown <= 0) this.teleportRandom();
    }
  }
  isLookedAt(p) {
    const d = M.lookDir(p.yaw, p.pitch);
    const ex = this.x - p.x, ey = this.y + 2.55 - (p.y + p.eyeHeight()), ez = this.z - p.z;
    const l = Math.hypot(ex, ey, ez);
    const dot = (d[0] * ex + d[1] * ey + d[2] * ez) / l;
    if (dot < 1 - 0.025 / l) return false;
    const head = p.inventory.armor[0];
    if (head && head.id === B.pumpkin) return false;
    return this.canSee(p);
  }
  onHurt(dmg, src) {
    super.onHurt(dmg, src);
    if (src.entity) { this.angry = true; this.target = src.entity; }
    if (rnd() < 0.3 && this.tpCooldown <= 0) this.teleportRandom();
  }
  damage(amount, src = {}) {
    if (src.type === 'projectile') { this.teleportRandom(); return false; }
    return super.damage(amount, src);
  }
  teleportRandom() {
    return this.teleportTo(this.x + (rnd() - 0.5) * 32, this.y + rint(-8, 8), this.z + (rnd() - 0.5) * 32);
  }
  teleportToward(t) {
    const dx = this.x - t.x, dz = this.z - t.z, l = Math.hypot(dx, dz) || 1;
    return this.teleportTo(t.x + (dx / l) * 4 + (rnd() - 0.5) * 6, t.y + rint(-2, 2), t.z + (dz / l) * 4 + (rnd() - 0.5) * 6);
  }
  teleportTo(x, y, z) {
    const bx = Math.floor(x), bz = Math.floor(z);
    let by = Math.floor(y);
    if (!this.world.isChunkReady(bx, bz)) return false;
    while (by > 1 && !SOLID[this.world.getBlock(bx, by - 1, bz)]) by--;
    for (let k = 0; k < 3; k++) if (SOLID[this.world.getBlock(bx, by + k, bz)] || this.world.getBlock(bx, by + k, bz) === B.water) return false;
    if (this.world.getBlock(bx, by - 1, bz) === B.water || this.world.getBlock(bx, by - 1, bz) === B.lava || by <= 1) return false;
    const p = this.world.game?.particles;
    p?.spawnBurst(this.world, 'portal', this.x, this.y + 1.5, this.z, 20, 0.5, 0.1);
    this.setPos(bx + 0.5, by, bz + 0.5);
    this.path = null;
    this.tpCooldown = 20;
    this.world.playSound('teleport', this.x, this.y, this.z);
    p?.spawnBurst(this.world, 'portal', this.x, this.y + 1.5, this.z, 20, 0.5, 0.1);
    return true;
  }
  dropLoot(p, looting) {
    if (rnd() < 0.5 + looting * 0.25 || (p && this.world.game?.settings.difficulty >= 1 && rnd() < 0.15)) this.drop(I.ender_pearl, 1 + (looting > 1 && rnd() < 0.3 ? 1 : 0));
  }
  tick() {
    super.tick();
    if (!this.dead && rnd() < 0.3) this.world.game?.particles?.spawn(this.world, 'portal', this.x + (rnd() - 0.5) * 0.6, this.y + rnd() * 2.9, this.z + (rnd() - 0.5) * 0.6, (rnd() - 0.5) * 0.1, -0.02, (rnd() - 0.5) * 0.1);
  }
  render(r, buf, pt, sky, bl) {
    const { mat } = this.modelRoot(pt);
    const { ls, la, hy, hp } = this.anim(pt);
    const sw = this.getSwing(pt);
    const shake = this.angry ? Math.sin(this.age * 2) * 0.02 : 0;
    M.translate(mat, mat, shake, 0, shake);
    const parts = {
      head: [hp, hy, 0],
      rarm: [Math.cos(ls + Math.PI) * la * 0.5 + Math.sin(sw * Math.PI) * 1.2 + (this.angry ? 0.2 : 0), 0, 0.05],
      larm: [Math.cos(ls) * la * 0.5, 0, -0.05],
      rleg: [Math.cos(ls) * 0.8 * la, 0, 0],
      lleg: [Math.cos(ls + Math.PI) * 0.8 * la, 0, 0],
    };
    renderModel(buf, MODELS.enderman, mat, { parts, offsets: this.angry ? { head: [0, 3, 0] } : null }, sky, bl);
    return 'skin';
  }
}
registerEntity('enderman', Enderman);

// ================= Villageois & golem =================
const TRADES = {
  farmer: [
    { buy: [I.wheat_item, 20], sell: [I.emerald, 1] }, { buy: [I.emerald, 1], sell: [I.bread, 6] }, { buy: [I.potato, 26], sell: [I.emerald, 1] },
    { buy: [I.emerald, 1], sell: [I.apple, 4] }, { buy: [I.emerald, 3], sell: [I.cookie, 18] }, { buy: [I.emerald, 3], sell: [I.golden_apple, 1] },
  ],
  librarian: [
    { buy: [I.paper, 24], sell: [I.emerald, 1] }, { buy: [I.emerald, 9], sell: [B.bookshelf, 1] }, { buy: [I.book, 4], sell: [I.emerald, 1] },
    { buy: [I.emerald, 5], sell: [I.enchanted_book, 1], enchanted: true }, { buy: [I.emerald, 1], sell: [B.lantern, 1] }, { buy: [I.emerald, 5], sell: [I.compass, 1] },
  ],
  cleric: [
    { buy: [I.rotten_flesh, 32], sell: [I.emerald, 1] }, { buy: [I.emerald, 1], sell: [I.redstone, 2] }, { buy: [I.gold_ingot, 3], sell: [I.emerald, 1] },
    { buy: [I.emerald, 5], sell: [I.ender_pearl, 1] }, { buy: [I.emerald, 4], sell: [B.glowstone, 1] }, { buy: [I.emerald, 3], sell: [I.lapis_lazuli, 1] },
  ],
  armorer: [
    { buy: [I.coal, 15], sell: [I.emerald, 1] }, { buy: [I.emerald, 5], sell: [I.iron_helmet, 1] }, { buy: [I.emerald, 9], sell: [I.iron_chestplate, 1] },
    { buy: [I.iron_ingot, 4], sell: [I.emerald, 1] }, { buy: [I.emerald, 13], sell: [I.diamond_chestplate, 1] }, { buy: [I.emerald, 7], sell: [I.iron_leggings, 1] },
  ],
  toolsmith: [
    { buy: [I.coal, 15], sell: [I.emerald, 1] }, { buy: [I.emerald, 1], sell: [I.stone_axe, 1] }, { buy: [I.emerald, 1], sell: [I.stone_pickaxe, 1] },
    { buy: [I.iron_ingot, 4], sell: [I.emerald, 1] }, { buy: [I.emerald, 17], sell: [I.diamond_pickaxe, 1] }, { buy: [I.emerald, 3], sell: [I.bucket, 1] },
  ],
};
export const PROFESSION_NAMES = { farmer: 'Fermier', librarian: 'Bibliothécaire', cleric: 'Prêtre', armorer: 'Armurier', toolsmith: 'Forgeron d\'outils' };
const PROF_COLORS = { farmer: [255, 235, 200], librarian: [255, 255, 255], cleric: [235, 205, 245], armorer: [200, 200, 210], toolsmith: [225, 210, 195] };

export class Villager extends Mob {
  constructor(w, d) {
    super(w, d);
    this.type = 'villager'; this.maxHealth = this.health = 20; this.baseSpeed = 0.5 * 0.5; this.height = 1.95;
    this.profession = (d && d.profession) || ['farmer', 'librarian', 'cleric', 'armorer', 'toolsmith'][rint(0, 4)];
    this.trades = (TRADES[this.profession] || TRADES.farmer).map((t) => ({ ...t, uses: 0, max: rint(8, 16) }));
    this.despawnable = false;
    this.idleSound = 'villager'; this.hurtSound = 'villager_hurt'; this.deathSound = 'villager_hurt';
    this.xpReward = 0;
  }
  ai() {
    const p = this.player;
    if (this.panicTime > 0) { this.panicTime--; if (!this.panicGoal || this.age % 30 === 0) this.panicGoal = [this.x + (rnd() - 0.5) * 16, this.y, this.z + (rnd() - 0.5) * 16]; this.moveDirect(this.panicGoal[0], this.panicGoal[2], 1.5); return; }
    if (this.trading) { this.lookTarget = p; return; }
    // fuir les zombies
    const z = this.world.entitiesIn(this.x - 8, this.y - 3, this.z - 8, this.x + 8, this.y + 3, this.z + 8, (e) => e.type === 'zombie' && !e.dead)[0];
    if (z) { const dx = this.x - z.x, dz = this.z - z.z; this.moveDirect(this.x + dx, this.z + dz, 1.4); return; }
    if (p && this.distanceTo(p) < 5 && rnd() < 0.05) this.lookTarget = p;
    if (this.lookTarget && rnd() < 0.02) this.lookTarget = null;
    this.wander(0.6, 8);
  }
  interact(player) {
    if (this.baby > 0) return false;
    this.world.game?.ui?.openTrading(this);
    this.world.playSound('villager', this.x, this.y + 1, this.z);
    return true;
  }
  render(r, buf, pt, sky, bl) {
    const { mat } = this.modelRoot(pt);
    const { ls, la, hy, hp } = this.anim(pt);
    renderModel(buf, MODELS.villager, mat, { parts: { head: [hp, hy, 0], arms: [-0.75, 0, 0], rleg: [Math.cos(ls) * 1.4 * la * 0.5, 0, 0], lleg: [Math.cos(ls + Math.PI) * 1.4 * la * 0.5, 0, 0] } }, sky, bl, PROF_COLORS[this.profession] || [255, 255, 255]);
    return 'skin';
  }
}
registerEntity('villager', Villager);

export class IronGolem extends Mob {
  constructor(w, d) {
    super(w, d);
    this.type = 'iron_golem'; this.maxHealth = this.health = 100; this.baseSpeed = 0.25; this.width = 1.4; this.height = 2.7; this.attackDamage = 15;
    this.despawnable = false; this.knockbackResistance = 1; this.xpReward = 0; this.hurtSound = 'golem_hurt'; this.deathSound = 'golem_hurt';
    this.attackAnim = 0;
  }
  ai() {
    if (this.attackAnim > 0) this.attackAnim--;
    if (this.target && (this.target.dead || this.target.removed || this.distanceTo(this.target) > 20 || (this.target.isPlayer && !this.validTarget(this.target)))) this.target = null;
    if (!this.target && this.age % 20 === 0) {
      this.target = this.world.entitiesIn(this.x - 16, this.y - 4, this.z - 16, this.x + 16, this.y + 4, this.z + 16, (e) => e.hostile && !e.dead && e.type !== 'creeper' && e.damage)[0] || null;
    }
    if (this.target) {
      this.chase(this.target, 1);
    } else this.wander(0.5, 10);
  }
  onAttackHit(t) { t.vy += 0.4; this.attackAnim = 10; this.world.playSound('golem_attack', this.x, this.y, this.z); }
  onHurt(dmg, src) { if (src.entity) this.target = src.entity; }
  dropLoot() { this.drop(I.iron_ingot, rint(3, 5)); this.drop(B.poppy, rint(0, 2)); }
  render(r, buf, pt, sky, bl) {
    const { mat } = this.modelRoot(pt);
    const { ls, la, hy, hp } = this.anim(pt);
    const a = this.attackAnim > 0 ? -2 + 1.5 * Math.abs(((this.attackAnim - pt) % 10) / 10 - 0.5) : 0;
    renderModel(buf, MODELS.iron_golem, mat, { parts: { head: [hp, hy, 0], rarm: [a || Math.cos(ls) * la * 0.6, 0, 0], larm: [a || Math.cos(ls + Math.PI) * la * 0.6, 0, 0], rleg: [Math.cos(ls) * la * 0.8, 0, 0], lleg: [Math.cos(ls + Math.PI) * la * 0.8, 0, 0] } }, sky, bl);
    return 'skin';
  }
}
registerEntity('iron_golem', IronGolem);

// ================= Nether =================
export class Piglin extends Monster {
  constructor(w, d) {
    super(w, d);
    this.type = 'piglin'; this.maxHealth = this.health = 20; this.baseSpeed = 0.23; this.attackDamage = 8; this.fireImmune = true; this.neutral = true;
    this.angry = 0; this.idleSound = 'piglin'; this.hurtSound = 'piglin_hurt'; this.deathSound = 'piglin_hurt';
    this.armor = 2;
  }
  ai() {
    if (this.angry > 0) this.angry--;
    if (this.target && (!this.validTarget(this.target) || this.angry <= 0)) this.target = null;
    if (this.target) this.chase(this.target, 1.3);
    else { this.lookTarget = null; this.wander(0.7); }
  }
  onHurt(dmg, src) {
    const att = src.entity;
    if (att && att !== this) {
      this.angry = 600 + rint(0, 400);
      this.target = att;
      // colère de groupe
      for (const e of this.world.entitiesIn(this.x - 20, this.y - 10, this.z - 20, this.x + 20, this.y + 10, this.z + 20, (o) => o.type === 'piglin' && o !== this)) {
        e.angry = this.angry; e.target = att;
      }
      this.world.playSound('piglin_angry', this.x, this.y, this.z);
    }
  }
  dropLoot(p, looting) {
    this.drop(I.rotten_flesh, rint(0, 1 + looting));
    this.drop(I.gold_nugget, rint(0, 1 + looting));
    if (p && rnd() < 0.025) this.drop(I.gold_ingot, 1);
    if (p && rnd() < 0.085) this.drop(I.golden_sword, 1, { dmg: rint(5, 25) });
  }
  render(r, buf, pt, sky, bl) { return renderBiped(this, r, buf, pt, sky, bl, 'piglin', { held: I.golden_sword }); }
}
registerEntity('piglin', Piglin);

class Flying extends Mob {
  constructor(w, d) {
    super(w, d);
    this.noGravity = true;
    this.flyTarget = null;
    this.stepHeight = 0;
  }
  travel() {
    this.move(this.vx, this.vy, this.vz);
    this.vx *= 0.91; this.vy *= 0.91; this.vz *= 0.91;
    this.fallDistance = 0;
  }
  flyToward(x, y, z, speed) {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    this.vx += (dx / d) * speed; this.vy += (dy / d) * speed; this.vz += (dz / d) * speed;
  }
  onLand() {}
}

export class Ghast extends Flying {
  constructor(w, d) {
    super(w, d);
    this.type = 'ghast'; this.maxHealth = this.health = 10; this.width = 4; this.height = 4; this.fireImmune = true;
    this.shootTimer = 0; this.charge = 0; this.followRange = 64;
    this.hostile = true; this.idleSound = 'ghast'; this.hurtSound = 'ghast_hurt'; this.deathSound = 'ghast_death';
    this.renderRadius = 3;
  }
  ai() {
    const p = this.player;
    if (this.age % 20 === 0) this.target = this.findPlayer(64) || null;
    if (!this.flyTarget || this.distanceSq(...this.flyTarget) < 4 || rnd() < 0.01 || this.collidedH) {
      this.flyTarget = [this.x + (rnd() - 0.5) * 32, M.clamp(this.y + (rnd() - 0.5) * 16, 40, 110), this.z + (rnd() - 0.5) * 32];
    }
    this.flyToward(...this.flyTarget, 0.01);
    if (this.target) {
      const t = this.target;
      this.lookTarget = t;
      this.yaw = Math.atan2(-(t.x - this.x), -(t.z - this.z));
      this.bodyYaw = this.yaw;
      if (this.canSee(t)) {
        this.charge++;
        if (this.charge === 10) this.world.playSound('ghast_warn', this.x, this.y, this.z, 2);
        if (this.charge >= 20) {
          this.charge = -40;
          const fb = this.world.spawn('fireball', this.x, this.y + 2, this.z, { owner: this, power: 1 });
          if (fb) {
            const dx = t.x - this.x, dy = t.y + 1 - (this.y + 2), dz = t.z - this.z;
            fb.setAccel(dx, dy, dz);
            const l = Math.hypot(dx, dy, dz);
            fb.x += (dx / l) * 2.5; fb.z += (dz / l) * 2.5;
            fb.prevX = fb.x; fb.prevZ = fb.z;
          }
          this.world.playSound('ghast_shoot', this.x, this.y, this.z, 2);
        }
      } else if (this.charge > 0) this.charge--;
    } else if (this.charge > 0) this.charge--;
    else if (this.charge < 0) this.charge++;
    void p;
  }
  dropLoot(p, looting) { this.drop(I.ghast_tear, rint(0, 1 + looting)); this.drop(I.gunpowder, rint(0, 2 + looting)); }
  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    M.rotateY(mat, mat, M.lerp(this.prevYaw, this.yaw, pt));
    if (this.dead) M.rotateZ(mat, mat, Math.min(1, (this.deathTime + pt) / 20) * Math.PI / 2);
    M.scale(mat, mat, 4, 4, 4);
    M.translate(mat, mat, 0, 0.25, 0);
    const t = this.age + pt;
    const parts = {};
    for (let i = 0; i < 9; i++) parts['t' + i] = [Math.sin(t * 0.1 + i) * 0.2 + 0.2, 0, 0];
    renderModel(buf, this.charge > 10 ? MODELS.ghast_angry : MODELS.ghast, mat, { parts }, sky, bl);
    return 'skin';
  }
}
registerEntity('ghast', Ghast);

export class Blaze extends Flying {
  constructor(w, d) {
    super(w, d);
    this.type = 'blaze'; this.maxHealth = this.health = 20; this.width = 0.6; this.height = 1.8; this.fireImmune = true; this.hostile = true;
    this.attackDamage = 6; this.baseSpeed = 0.23; this.followRange = 48; this.shots = 0; this.shotTimer = 0; this.floatY = 0;
    this.idleSound = 'blaze'; this.hurtSound = 'blaze_hurt'; this.deathSound = 'blaze_death'; this.xpReward = 10;
    this.fullbright = true;
  }
  ai() {
    if (this.target && (!this.validTarget(this.target) || this.distanceTo(this.target) > 48)) this.target = null;
    if (!this.target && this.age % 10 === 0) this.target = this.findPlayer(48);
    // flotte doucement
    this.vy += (Math.sin(this.age * 0.05) * 0.02 - this.vy) * 0.1;
    if (!SOLID[this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 1.5), Math.floor(this.z))] && !this.target) this.vy -= 0.02;
    if (this.target) {
      const t = this.target;
      this.lookTarget = t;
      this.yaw = Math.atan2(-(t.x - this.x), -(t.z - this.z));
      this.bodyYaw = this.yaw;
      const d = this.distanceTo(t);
      if (t.y + 1 > this.y + 0.5) this.vy += 0.03;
      if (d < 2.2) this.meleeAttack(t);
      else if (d < 48 && this.canSee(t)) {
        this.shotTimer++;
        if (this.shotTimer === 60) this.world.playSound('blaze_charge', this.x, this.y, this.z);
        if (this.shotTimer > 60 && this.shotTimer % 6 === 0) {
          this.fire(t);
          if (++this.shots >= 3) { this.shots = 0; this.shotTimer = -40; }
        }
        if (d > 10) this.flyToward(t.x, t.y + 2, t.z, 0.02);
      } else this.flyToward(t.x, t.y + 2, t.z, 0.02);
    } else if (rnd() < 0.02) {
      this.flyToward(this.x + (rnd() - 0.5) * 8, this.y + (rnd() - 0.5) * 2, this.z + (rnd() - 0.5) * 8, 0.05);
    }
    if (rnd() < 0.2) this.world.game?.particles?.spawn(this.world, 'smoke', this.x + (rnd() - 0.5) * 0.6, this.y + rnd() * 1.8, this.z + (rnd() - 0.5) * 0.6, 0, 0.02, 0);
  }
  fire(t) {
    const fb = this.world.spawn('small_fireball', this.x, this.y + 1.2, this.z, { owner: this });
    if (!fb) return;
    const dx = t.x - this.x + (rnd() - 0.5) * 1.5, dy = t.y + 0.9 - (this.y + 1.2), dz = t.z - this.z + (rnd() - 0.5) * 1.5;
    fb.setAccel(dx, dy, dz);
    const l = Math.hypot(dx, dy, dz);
    fb.vx = (dx / l) * 0.8; fb.vy = (dy / l) * 0.8; fb.vz = (dz / l) * 0.8;
    this.world.playSound('blaze_shoot', this.x, this.y, this.z);
  }
  damage(a, src = {}) {
    if (src.type === 'projectile' && src.direct && src.direct.kind === 'snowball') a = 3;
    return super.damage(a, src);
  }
  dropLoot(p, looting) { if (p && rnd() < 0.6 + looting * 0.2) this.drop(I.blaze_rod, 1 + (looting && rnd() < 0.5 ? 1 : 0)); }
  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    M.rotateY(mat, mat, M.lerp(this.prevBodyYaw, this.bodyYaw, pt));
    if (this.dead) M.rotateZ(mat, mat, Math.min(1, (this.deathTime + pt) / 20) * Math.PI / 2);
    const { hy, hp } = this.anim(pt);
    const t = (this.age + pt) * 0.08;
    const parts = { head: [hp, hy, 0] };
    const offsets = {};
    const rings = [[9, 18, 1], [7, 11, -1], [5, 4, 1]];
    for (let i = 0; i < 12; i++) {
      const [rad, y, dir] = rings[i >> 2];
      const a = t * dir + (i % 4) * Math.PI / 2 + (i >> 2) * 0.4;
      offsets['rod' + i] = [Math.cos(a) * rad, y + Math.sin(t * 2 + i) * 1.5, Math.sin(a) * rad];
    }
    renderModel(buf, MODELS.blaze, mat, { parts, offsets }, sky, 255);
    return 'skin';
  }
}
registerEntity('blaze', Blaze);

export class Slime extends Mob {
  constructor(w, d) {
    super(w, d);
    this.type = d && d.magma ? 'magma_cube' : 'slime';
    this.size = (d && d.size) || [1, 2, 4][rint(0, 2)];
    this.magma = this.type === 'magma_cube';
    this.width = this.height = 0.52 * this.size;
    this.maxHealth = this.health = this.size * this.size;
    this.attackDamage = this.size === 1 ? (this.magma ? 3 : 0) : this.size * (this.magma ? 2 : 1);
    this.jumpDelay = rint(10, 30);
    this.hostile = true;
    this.fireImmune = this.magma;
    this.squish = 0; this.prevSquish = 0;
    this.xpReward = this.size;
    this.hurtSound = 'slime'; this.deathSound = 'slime';
  }
  ai() {
    this.prevSquish = this.squish;
    this.squish *= 0.6;
    const t = this.age % 10 === 0 ? (this.target = this.findPlayer(16)) : this.target;
    if (this.onGround && --this.jumpDelay <= 0) {
      this.jumpDelay = rint(10, 30) / (t ? 3 : 1);
      let yaw = this.yaw + (rnd() - 0.5);
      if (t && this.validTarget(t)) yaw = Math.atan2(-(t.x - this.x), -(t.z - this.z));
      this.yaw = yaw;
      const sp = this.magma ? 0.3 : 0.2 + this.size * 0.05;
      this.vx = -Math.sin(yaw) * sp; this.vz = -Math.cos(yaw) * sp;
      this.vy = this.magma ? 0.42 + this.size * 0.1 : 0.42;
      this.squish = 1;
      this.world.playSound('slime', this.x, this.y, this.z, 0.4, 1.5 - this.size * 0.2);
    }
    if (t && this.validTarget(t) && this.attackDamage > 0) this.meleeAttack(t);
  }
  travel() {
    this.move(this.vx, this.vy, this.vz);
    this.vy -= 0.08; this.vy *= 0.98;
    if (this.onGround) { this.vx *= 0.6; this.vz *= 0.6; } else { this.vx *= 0.98; this.vz *= 0.98; }
  }
  die(src) {
    super.die(src);
    if (this.size > 1) {
      for (let i = 0; i < rint(2, 4); i++) this.world.spawn(this.magma ? 'magma_cube' : 'slime', this.x + (rnd() - 0.5) * this.size * 0.5, this.y + 0.5, this.z + (rnd() - 0.5) * this.size * 0.5, { size: this.size / 2, magma: this.magma });
    }
  }
  dropLoot(p) {
    if (this.size === 1 && !this.magma) this.drop(I.clay_ball, rint(0, 2));
    if (this.magma && this.size > 1 && rnd() < 0.25) this.drop(I.magma_cream, 1);
  }
  render(r, buf, pt, sky, bl) {
    const mat = M.mat4();
    M.rotateY(mat, mat, M.lerp(this.prevYaw, this.yaw, pt));
    const sq = M.lerp(this.prevSquish, this.squish, pt);
    const s = this.size * 0.52 * 2;
    M.scale(mat, mat, s * (1 - sq * 0.2), s * (1 + sq * 0.3), s * (1 - sq * 0.2));
    renderModel(buf, MODELS[this.magma ? 'magma_cube' : 'slime'], mat, {}, sky, this.magma ? 255 : bl);
    return 'skin';
  }
}
registerEntity('slime', Slime);
registerEntity('magma_cube', class extends Slime { constructor(w, d) { super(w, Object.assign({}, d, { magma: true })); } });

void raycastBlocks; void BLOCKS;
