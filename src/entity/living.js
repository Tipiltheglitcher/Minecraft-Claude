// Entité vivante : santé, dégâts, effets, déplacement type Minecraft
import { Entity } from './entity.js';
import { BLOCKS, SOLID } from '../data/blocks.js';
import { B } from '../data/ids.js';
import { wrapAngle, clamp } from '../core/math.js';

export const EFFECT_NAMES = {
  speed: 'Rapidité', slowness: 'Lenteur', strength: 'Force', regeneration: 'Régénération', poison: 'Poison',
  fire_resistance: 'Résistance au feu', night_vision: 'Vision nocturne', hunger: 'Faim', resistance: 'Résistance',
  water_breathing: 'Apnée', absorption: 'Absorption', weakness: 'Faiblesse', levitation: 'Lévitation',
};

export class Living extends Entity {
  constructor(world, data) {
    super(world, data);
    this.maxHealth = 20;
    this.health = 20;
    this.hurtTime = 0;
    this.invuln = 0;
    this.lastDamage = 0;
    this.deathTime = 0;
    this.dead = false;
    this.air = 300;
    this.effects = {};
    this.bodyYaw = 0; this.prevBodyYaw = 0;
    this.headYaw = 0; this.prevHeadYaw = 0;
    this.limbSwing = 0; this.limbAmount = 0; this.prevLimbAmount = 0; this.prevLimbSwing = 0;
    this.swingTime = 0; this.swingDuration = 6; this.swinging = false; this.prevSwing = 0; this.swing = 0;
    this.moveSpeed = 0.1;
    this.jumpPower = 0.42;
    this.stepHeight = 0.6;
    this.armor = 0;
    this.strafe = 0; this.forward = 0; this.jumping = false; this.jumpCooldown = 0;
    this.lastAttacker = null;
    this.lastAttackerTime = 0;
    this.fireImmune = false;
    this.canDrown = true;
    this.absorption = 0;
    this.xpReward = 0;
    this.hurtDir = 1;
  }

  // ----- effets -----
  addEffect(name, ticks, amp = 0) {
    if (name === 'instant_health') { this.heal(4 << amp); return; }
    if (name === 'instant_damage') { this.damage(6 << amp, { type: 'magic', bypassArmor: true }); return; }
    const cur = this.effects[name];
    if (!cur || cur.amp < amp || (cur.amp === amp && cur.ticks < ticks)) this.effects[name] = { amp, ticks };
    if (name === 'absorption') this.absorption = Math.max(this.absorption, 4 * (amp + 1));
  }

  hasEffect(name) {
    return !!this.effects[name];
  }

  effectAmp(name) {
    const e = this.effects[name];
    return e ? e.amp : -1;
  }

  tickEffects() {
    for (const [name, e] of Object.entries(this.effects)) {
      e.ticks--;
      if (name === 'poison' && this.health > 1 && this.age % Math.max(1, 25 >> e.amp) === 0) this.damage(1, { type: 'magic', bypassArmor: true, noKnock: true, noInvuln: true });
      if (name === 'regeneration' && this.age % Math.max(1, 50 >> e.amp) === 0) this.heal(1);
      if (name === 'hunger' && this.addExhaustion) this.addExhaustion(0.005 * (e.amp + 1));
      if (e.ticks <= 0) {
        delete this.effects[name];
        if (name === 'absorption') this.absorption = 0;
      }
    }
  }

  heal(n) {
    if (this.dead) return;
    this.health = Math.min(this.maxHealth, this.health + n);
  }

  // ----- tick principal -----
  tick() {
    super.tick();
    this.prevBodyYaw = this.bodyYaw;
    this.prevHeadYaw = this.headYaw;
    this.prevLimbAmount = this.limbAmount;
    this.prevLimbSwing = this.limbSwing;
    this.prevSwing = this.swing;
    this.updateFluidState();
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.invuln > 0) this.invuln--;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.dead) {
      this.deathTime++;
      this.strafe = this.forward = 0;
      this.jumping = false;
      this.travel();
      if (this.deathTime >= 20) {
        this.removed = true;
        const g = this.game;
        if (g && g.particles) g.particles.spawnBurst(this.world, 'smoke', this.x, this.y + this.height / 2, this.z, 12, this.width / 2, 0.05);
      }
      return;
    }
    this.baseTick();
    if (this.dead) return;
    this.tickEffects();
    this.aiStep();
    this.travel();
    this.updateSwing();
    this.updateLimbs();
    this.contactDamage();
  }

  baseTick() {
    // feu
    if (this.fireTicks > 0) {
      if (this.fireImmune || this.hasEffect('fire_resistance')) this.fireTicks = Math.max(0, this.fireTicks - 4);
      else {
        if (this.fireTicks % 20 === 0) this.damage(1, { type: 'fire', noKnock: true });
        this.fireTicks--;
      }
      if (this.inWater) this.fireTicks = 0;
    }
    if (this.inLava && !this.fireImmune) {
      if (!this.hasEffect('fire_resistance')) this.damage(4, { type: 'lava', noKnock: true });
      this.fireTicks = Math.max(this.fireTicks, 300);
    }
    // noyade
    if (this.canDrown && this.eyesInWater() && !this.hasEffect('water_breathing')) {
      this.air--;
      if (this.air <= -20) {
        this.air = 0;
        this.damage(2, { type: 'drown', bypassArmor: true, noKnock: true });
      }
    } else if (this.air < 300) this.air = Math.min(300, this.air + 4);
    // étouffement
    if (this.isInsideOpaque() && !this.noClip && this.age % 10 === 0) this.damage(1, { type: 'suffocate', bypassArmor: true, noKnock: true });
    // vide
    if (this.y < -40) this.damage(4, { type: 'void', bypassArmor: true, noKnock: true, noInvuln: true });
  }

  contactDamage() {
    if (this.age % 10 !== 0) return;
    const bb = this.bbox();
    const w = this.world;
    const hit = w.blockInBox(bb[0] - 0.05, bb[1], bb[2] - 0.05, bb[3] + 0.05, bb[4] - 0.1, bb[5] + 0.05, (id) => id === B.cactus || id === B.fire || id === B.sweet_berry);
    if (hit) {
      if (hit.id === B.cactus) this.damage(1, { type: 'cactus', noKnock: true });
      else if (hit.id === B.fire && !this.fireImmune) { this.damage(1, { type: 'fire', noKnock: true }); this.fireTicks = Math.max(this.fireTicks, 160); }
    }
    if (this.onGround && this.blockBelow() === B.magma_block && !this.fireImmune && !this.sneaking && !this.hasEffect('fire_resistance')) this.damage(1, { type: 'fire', noKnock: true });
    if (w.blockInBox(bb[0] + 0.1, bb[1] + 0.1, bb[2] + 0.1, bb[3] - 0.1, bb[4] - 0.1, bb[5] - 0.1, (id) => id === B.cobweb)) this.inWeb = true;
    else this.inWeb = false;
  }

  aiStep() {}

  updateSwing() {
    if (this.swinging) {
      this.swingTime++;
      if (this.swingTime >= this.swingDuration) { this.swingTime = 0; this.swinging = false; }
    } else this.swingTime = 0;
    this.swing = this.swingTime / this.swingDuration;
  }

  swingArm() {
    if (!this.swinging || this.swingTime >= this.swingDuration / 2 || this.swingTime < 0) {
      this.swingTime = -1;
      this.swinging = true;
    }
  }

  getSwing(pt) {
    let d = this.swing - this.prevSwing;
    if (d < 0) d += 1;
    return this.prevSwing + d * pt;
  }

  updateLimbs() {
    const dx = this.x - this.prevX, dz = this.z - this.prevZ;
    const dist = Math.min(1, Math.sqrt(dx * dx + dz * dz) * 4);
    this.limbAmount += (dist - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
    // corps
    if (dx * dx + dz * dz > 0.0005) {
      const moveYaw = Math.atan2(-dx, -dz);
      this.bodyYaw += wrapAngle(moveYaw - this.bodyYaw) * 0.3;
    }
    const diff = wrapAngle(this.headYaw - this.bodyYaw);
    if (Math.abs(diff) > 0.87) this.bodyYaw += diff - Math.sign(diff) * 0.87;
    this.bodyYaw = wrapAngle(this.bodyYaw);
  }

  speed() {
    let s = this.moveSpeed;
    const sp = this.effectAmp('speed');
    if (sp >= 0) s *= 1 + 0.2 * (sp + 1);
    const sl = this.effectAmp('slowness');
    if (sl >= 0) s *= Math.max(0, 1 - 0.15 * (sl + 1));
    return s;
  }

  moveRelative(strafe, forward, f) {
    let len = strafe * strafe + forward * forward;
    if (len < 1e-4) return;
    len = Math.sqrt(len);
    if (len < 1) len = 1;
    strafe *= f / len;
    forward *= f / len;
    const s = Math.sin(this.yaw), c = Math.cos(this.yaw);
    this.vx += -forward * s + strafe * c;
    this.vz += -forward * c - strafe * s;
  }

  jump() {
    this.vy = this.jumpPower;
    if (this.sprinting) {
      this.vx -= Math.sin(this.yaw) * 0.2;
      this.vz -= Math.cos(this.yaw) * 0.2;
    }
    this.onGround = false;
  }

  isClimbing() {
    const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y), Math.floor(this.z));
    return id && BLOCKS[id].climbable;
  }

  travel() {
    const strafe = this.strafe * 0.98, forward = this.forward * 0.98;
    // saut
    if (this.jumping) {
      if (this.inWater || this.inLava) this.vy += 0.04;
      else if (this.onGround && this.jumpCooldown === 0) { this.jump(); this.jumpCooldown = 10; }
    } else this.jumpCooldown = 0;

    if (this.flying) { this.travelFlying(strafe, forward); return; }
    if (this.inWater) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02 * (this.depthStrider || 1));
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.8; this.vy *= 0.8; this.vz *= 0.8;
      if (!this.noGravity) this.vy -= 0.02;
      if (this.collidedH && this.isFreeAt(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
      return;
    }
    if (this.inLava) {
      const y0 = this.y;
      this.moveRelative(strafe, forward, 0.02);
      this.move(this.vx, this.vy, this.vz);
      this.vx *= 0.5; this.vy *= 0.5; this.vz *= 0.5;
      if (!this.noGravity) this.vy -= 0.02;
      if (this.collidedH && this.isFreeAt(this.vx, this.vy + 0.6 - this.y + y0, this.vz)) this.vy = 0.3;
      return;
    }
    let slip = 0.91;
    if (this.onGround) {
      const below = this.blockBelow();
      slip = (below && BLOCKS[below] ? BLOCKS[below].slip : 0.6) * 0.91;
    }
    const accel = this.onGround ? this.speed() * (0.16277136 / (slip * slip * slip)) : this.airSpeed ? this.airSpeed() : 0.02;
    this.moveRelative(strafe, forward, accel);
    if (this.isClimbing()) {
      this.vx = clamp(this.vx, -0.15, 0.15);
      this.vz = clamp(this.vz, -0.15, 0.15);
      this.fallDistance = 0;
      if (this.vy < -0.15) this.vy = -0.15;
      if (this.sneaking && this.vy < 0) this.vy = 0;
    }
    let mx = this.vx, my = this.vy, mz = this.vz;
    if (this.inWeb) { mx *= 0.25; my *= 0.05; mz *= 0.25; this.fallDistance = 0; }
    if (this.onGround && this.blockBelow() === B.soul_sand) { mx *= 0.4; mz *= 0.4; }
    this.move(mx, my, mz);
    if (this.inWeb) { this.vx = 0; this.vy = 0; this.vz = 0; }
    if (this.collidedH && this.isClimbing()) this.vy = 0.2;
    if (this.hasEffect('levitation')) this.vy += (0.05 * (this.effectAmp('levitation') + 1) - this.vy) * 0.2;
    else if (!this.noGravity) this.vy -= 0.08;
    this.vy *= 0.98;
    this.vx *= slip;
    this.vz *= slip;
  }

  travelFlying(strafe, forward) {
    this.moveRelative(strafe, forward, this.sprinting ? 0.1 : 0.05);
    if (this.jumping) this.vy += 0.15;
    if (this.sneaking) this.vy -= 0.15;
    this.move(this.vx, this.vy, this.vz);
    this.vy *= 0.6;
    this.vx *= 0.91;
    this.vz *= 0.91;
    this.fallDistance = 0;
    if (this.onGround && this.isPlayer && !this.game?.spectator) this.flying = false;
  }

  isFreeAt(dx, dy, dz) {
    const bb = this.bbox();
    const boxes = this.world.getCollisions(bb[0] + dx, bb[1] + dy, bb[2] + dz, bb[3] + dx, bb[4] + dy, bb[5] + dz, []);
    for (const b of boxes) {
      if (bb[3] + dx <= b[0] || bb[0] + dx >= b[3] || bb[4] + dy <= b[1] || bb[1] + dy >= b[4] || bb[5] + dz <= b[2] || bb[2] + dz >= b[5]) continue;
      return false;
    }
    return true;
  }

  onLand(dist) {
    if (this.inWater) return;
    let d = Math.ceil(dist - 3 - (this.effectAmp('jump_boost') + 1));
    if (this.flying) return;
    const below = this.blockBelow();
    if (below === B.hay_block) d = Math.ceil(d * 0.2);
    if (below === B.bed || below === B.slime_block) d = Math.ceil(d * 0.5);
    if (d > 0) {
      this.damage(d, { type: 'fall', noKnock: true });
      const g = this.game;
      if (g && below && BLOCKS[below]) {
        g.audio?.play(d > 4 ? 'fall_big' : 'fall_small', this.x, this.y, this.z);
        for (let i = 0; i < Math.min(20, d * 3); i++) g.particles?.blockHit(this.world, Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z), below, 4);
      }
    }
  }

  // ----- dégâts -----
  armorValue() {
    return this.armor;
  }

  damage(amount, src = {}) {
    if (this.dead || this.removed || amount <= 0) return false;
    if (this.invulnerable && src.type !== 'void') return false;
    if ((src.type === 'fire' || src.type === 'lava') && (this.fireImmune || this.hasEffect('fire_resistance'))) return false;
    if (!this.canBeHurtBy(src)) return false;
    let dealt = amount;
    if (!src.noInvuln && this.invuln > 0) {
      if (amount <= this.lastDamage) return false;
      dealt = amount - this.lastDamage;
      this.lastDamage = amount;
    } else {
      this.lastDamage = amount;
      if (!src.noInvuln) this.invuln = 10;
      this.hurtTime = 10;
    }
    if (!src.bypassArmor) dealt = this.applyArmor(dealt, src);
    const res = this.effectAmp('resistance');
    if (res >= 0) dealt *= Math.max(0, 1 - 0.2 * (res + 1));
    if (this.absorption > 0) {
      const a = Math.min(this.absorption, dealt);
      this.absorption -= a;
      dealt -= a;
    }
    this.health -= dealt;
    this.onHurt(dealt, src);
    const att = src.entity;
    if (att) {
      this.lastAttacker = att;
      this.lastAttackerTime = this.age;
    }
    if (att && !src.noKnock) {
      let dx = att.x - this.x, dz = att.z - this.z;
      if (src.direct && src.direct !== att) { dx = -(src.direct.vx || 0); dz = -(src.direct.vz || 0); }
      if (dx * dx + dz * dz < 1e-4) { dx = Math.random() - 0.5; dz = Math.random() - 0.5; }
      this.knockback(0.4 * (src.knockMul || 1), dx, dz);
      this.hurtDir = Math.sign(Math.sin(Math.atan2(dx, dz) - this.yaw)) || 1;
    }
    if (this.health <= 0) {
      this.health = 0;
      this.die(src);
    } else this.playHurtSound();
    return true;
  }

  canBeHurtBy() {
    return true;
  }

  applyArmor(dmg) {
    const a = Math.min(20, this.armorValue());
    return dmg * (1 - a / 25);
  }

  knockback(strength, dx, dz) {
    const res = this.knockbackResistance || 0;
    strength *= 1 - res;
    if (strength <= 0) return;
    const f = Math.sqrt(dx * dx + dz * dz);
    this.vx /= 2;
    this.vz /= 2;
    this.vx -= (dx / f) * strength;
    this.vz -= (dz / f) * strength;
    if (this.onGround || this.isPlayer) {
      this.vy /= 2;
      this.vy += strength;
      if (this.vy > 0.4) this.vy = 0.4;
    }
  }

  onHurt() {}

  playHurtSound() {
    if (this.hurtSound) this.world.playSound(this.hurtSound, this.x, this.y + this.height / 2, this.z, 1, this.soundPitch || 1);
  }

  die(src) {
    if (this.dead) return;
    this.dead = true;
    this.deathTime = 0;
    if (this.deathSound) this.world.playSound(this.deathSound, this.x, this.y + this.height / 2, this.z, 1, this.soundPitch || 1);
    const killer = src.entity;
    const byPlayer = killer && killer.isPlayer;
    if (!this.isPlayer) {
      const looting = byPlayer && killer.lootingLevel ? killer.lootingLevel() : 0;
      if (this.world.game?.settings?.mobLoot !== false) this.dropLoot(byPlayer, looting, src);
      if (byPlayer && this.xpReward) this.world.dropXp(this.x, this.y + 0.5, this.z, this.xpReward);
    }
    this.world.game?.onEntityDeath?.(this, src);
  }

  dropLoot() {}

  drop(id, count = 1, extra) {
    if (count <= 0) return;
    this.world.dropItem(this.x, this.y + 0.5, this.z, Object.assign({ id, count }, extra));
  }

  overlay(pt) {
    if (this.hurtTime > 0 || this.dead) return [1, 0, 0, 0.35];
    return null;
  }

  // Regarder vers un point
  lookAt(x, y, z, maxTurn = 0.4) {
    const dx = x - this.x, dy = y - (this.y + this.eyeHeight()), dz = z - this.z;
    const yaw = Math.atan2(-dx, -dz);
    const pitch = Math.atan2(dy, Math.sqrt(dx * dx + dz * dz));
    this.headYaw += clamp(wrapAngle(yaw - this.headYaw), -maxTurn, maxTurn);
    this.pitch += clamp(pitch - this.pitch, -maxTurn, maxTurn);
  }

  canSee(e) {
    const x0 = this.x, y0 = this.y + this.eyeHeight(), z0 = this.z;
    const x1 = e.x, y1 = e.y + (e.eyeHeight ? e.eyeHeight() : e.height / 2), z1 = e.z;
    const d = Math.hypot(x1 - x0, y1 - y0, z1 - z0);
    const n = Math.ceil(d * 2);
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const id = this.world.getBlock(Math.floor(x0 + (x1 - x0) * t), Math.floor(y0 + (y1 - y0) * t), Math.floor(z0 + (z1 - z0) * t));
      if (id && SOLID[id] && BLOCKS[id].opaque) return false;
    }
    return true;
  }
}
