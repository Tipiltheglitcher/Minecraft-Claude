// Joueur
import { Living } from './living.js';
import { Inventory } from '../game/inventory.js';
import { ITEMS } from '../data/items.js';
import { I } from '../data/ids.js';
import { MODELS, renderModel } from '../gfx/models.js';
import * as M from '../core/math.js';
import { registerEntity } from './registry.js';

export function xpToNext(level) {
  return level >= 30 ? 112 + (level - 30) * 9 : level >= 15 ? 37 + (level - 15) * 5 : 7 + level * 2;
}

export class Player extends Living {
  constructor(world, data) {
    super(world, data);
    this.type = 'player';
    this.isPlayer = true;
    this.persistent = true;
    this.width = 0.6;
    this.height = 1.8;
    this.inventory = new Inventory(36);
    this.food = 20;
    this.saturation = 5;
    this.exhaustion = 0;
    this.foodTimer = 0;
    this.xpLevel = 0;
    this.xp = 0; // progression 0..1
    this.xpTotal = 0;
    this.creative = false;
    this.flying = false;
    this.sneaking = false;
    this.sprinting = false;
    this.input = { forward: 0, strafe: 0, jump: false, sneak: false, sprint: false };
    this.walkDist = 0; this.prevWalkDist = 0; this.bob = 0; this.prevBob = 0;
    this.equip = 1; this.prevEquip = 1; this.lastSelected = null;
    this.usingItem = false; this.useTicks = 0; this.useItemId = 0;
    this.sleeping = false; this.sleepTimer = 0;
    this.spawnPoint = null;
    this.portalTime = 0; this.portalCooldown = 0;
    this.hurtSound = 'player_hurt';
    this.deathSound = 'player_hurt';
    this.stats = { deaths: 0, kills: 0, blocksMined: 0, blocksPlaced: 0, playTicks: 0, distance: 0, jumps: 0 };
    this.attackCooldown = 0;
    this.enderPearlCooldown = 0;
  }

  eyeHeight() {
    return this.sneaking ? 1.27 : 1.62;
  }

  get creativeMode() { return this.creative; }

  // ----- faim -----
  addExhaustion(n) {
    if (this.creative) return;
    this.exhaustion = Math.min(40, this.exhaustion + n);
  }

  tickFood() {
    const diff = this.game ? this.game.settings.difficulty : 2;
    if (this.creative) { this.food = 20; return; }
    if (this.exhaustion >= 4) {
      this.exhaustion -= 4;
      if (this.saturation > 0) this.saturation = Math.max(0, this.saturation - 1);
      else if (diff > 0) this.food = Math.max(0, this.food - 1);
    }
    if (diff === 0) {
      if (this.health < this.maxHealth && this.age % 20 === 0) this.heal(1);
      if (this.food < 20 && this.age % 20 === 0) this.food++;
    }
    const naturalRegen = this.game ? this.game.settings.naturalRegen !== false : true;
    if (naturalRegen && this.saturation > 0 && this.food >= 20 && this.health < this.maxHealth) {
      this.foodTimer++;
      if (this.foodTimer >= 10) {
        const f = Math.min(this.saturation, 6);
        this.heal(f / 6);
        this.addExhaustion(f);
        this.foodTimer = 0;
      }
    } else if (naturalRegen && this.food >= 18 && this.health < this.maxHealth) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        this.heal(1);
        this.addExhaustion(6);
        this.foodTimer = 0;
      }
    } else if (this.food <= 0) {
      this.foodTimer++;
      if (this.foodTimer >= 80) {
        if (this.health > 10 || diff >= 3 || (this.health > 1 && diff >= 2)) this.damage(1, { type: 'starve', bypassArmor: true, noKnock: true });
        this.foodTimer = 0;
      }
    } else this.foodTimer = 0;
  }

  eat(def) {
    const f = def.food;
    this.food = Math.min(20, this.food + f.hunger);
    this.saturation = Math.min(this.food, this.saturation + f.hunger * f.sat * 2 / 2);
    const fx = def.foodEffect;
    if (fx === 'golden') { this.addEffect('regeneration', 100, 1); this.addEffect('absorption', 2400, 0); }
    else if (fx === 'hunger30' && Math.random() < 0.3) this.addEffect('hunger', 600, 0);
    else if (fx === 'hunger80' && Math.random() < 0.8) this.addEffect('hunger', 600, 0);
    else if (fx === 'poison') this.addEffect('poison', 100, 0);
  }

  // ----- expérience -----
  addXp(n) {
    this.xpTotal += n;
    let need = xpToNext(this.xpLevel);
    this.xp += n / need;
    let leveled = false;
    while (this.xp >= 1) {
      this.xp = (this.xp - 1) * need;
      this.xpLevel++;
      need = xpToNext(this.xpLevel);
      this.xp /= need;
      leveled = true;
    }
    if (leveled && this.xpLevel % 5 === 0) this.world.playSound('levelup', this.x, this.y, this.z);
    else this.world.playSound('xp', this.x, this.y, this.z, 0.4, 0.8 + Math.random() * 0.8);
    this.game?.onXpChange?.();
  }

  removeLevels(n) {
    this.xpLevel = Math.max(0, this.xpLevel - n);
    this.game?.onXpChange?.();
  }

  // ----- armure -----
  armorValue() {
    return this.inventory.armorPoints();
  }

  applyArmor(dmg, src) {
    const a = Math.min(20, this.armorValue());
    let d = dmg * (1 - a / 25);
    // enchantements de protection
    let epf = 0;
    for (const s of this.inventory.armor) {
      if (!s || !s.ench) continue;
      if (s.ench.protection) epf += s.ench.protection;
      if (s.ench.fire_protection && (src.type === 'fire' || src.type === 'lava')) epf += s.ench.fire_protection * 2;
      if (s.ench.blast_protection && src.type === 'explosion') epf += s.ench.blast_protection * 2;
      if (s.ench.projectile_protection && src.type === 'projectile') epf += s.ench.projectile_protection * 2;
      if (s.ench.feather_falling && src.type === 'fall') epf += s.ench.feather_falling * 3;
    }
    d *= 1 - Math.min(20, epf) * 0.04;
    // usure de l'armure
    if (!src.bypassArmor && dmg > 0) {
      const wear = Math.max(1, Math.floor(dmg / 4));
      for (let i = 0; i < 4; i++) {
        const s = this.inventory.armor[i];
        if (!s) continue;
        if (this.damageStack(s, wear)) this.inventory.armor[i] = null;
      }
    }
    return d;
  }

  applyFallEnchant(d) {
    return d;
  }

  // Use l'objet ; renvoie true s'il est cassé
  damageStack(s, n) {
    const d = ITEMS[s.id];
    if (!d || !d.durability || this.creative) return false;
    const unb = s.ench && s.ench.unbreaking;
    for (let k = 0; k < n; k++) {
      if (unb && Math.random() > 1 / (unb + 1)) continue;
      s.dmg = (s.dmg || 0) + 1;
    }
    if (s.dmg >= d.durability) {
      this.world.playSound('item_break', this.x, this.y, this.z);
      this.game?.particles?.itemBreak(this.world, this.x, this.y + 1.3, this.z, this.game.renderer ? 0 : 0);
      return true;
    }
    return false;
  }

  damageHeld(n) {
    const s = this.inventory.selected();
    if (s && this.damageStack(s, n)) { this.inventory.setSelected(null); }
    this.inventory.changed();
  }

  canBeHurtBy(src) {
    if (this.creative && src.type !== 'void') return false;
    return true;
  }

  damage(amount, src = {}) {
    if (this.creative && src.type !== 'void') return false;
    const e = src.entity;
    if (e && !e.isPlayer && src.type !== 'explosion') {
      const diff = this.game ? this.game.settings.difficulty : 2;
      if (diff === 0) return false;
      if (diff === 1) amount = Math.min(amount / 2 + 1, amount);
      if (diff === 3) amount *= 1.5;
    }
    if (this.sleeping) this.wakeUp();
    const ok = super.damage(amount, src);
    if (ok) {
      this.addExhaustion(0.1);
      this.game?.onPlayerHurt?.(amount, src);
    }
    return ok;
  }

  die(src) {
    super.die(src);
    this.stats.deaths++;
    this.usingItem = false;
    this.game?.onPlayerDeath?.(src);
  }

  onVoid() {
    this.damage(1000, { type: 'void', bypassArmor: true, noInvuln: true });
  }

  lootingLevel() {
    const s = this.inventory.selected();
    return (s && s.ench && s.ench.looting) || 0;
  }

  wakeUp() {
    this.sleeping = false;
    this.sleepTimer = 0;
  }

  // ----- tick -----
  tick() {
    if (this.frozen) {
      this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
      this.prevYaw = this.yaw; this.prevPitch = this.pitch;
      return;
    }
    this.prevWalkDist = this.walkDist;
    this.prevBob = this.bob;
    this.prevEquip = this.equip;
    if (this.portalCooldown > 0) this.portalCooldown--;
    if (this.enderPearlCooldown > 0) this.enderPearlCooldown--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    super.tick();
    if (this.dead) return;
    this.stats.playTicks++;
    this.tickFood();
    // animation d'équipement
    const sel = this.inventory.selected();
    const key = sel ? sel.id + ':' + (sel.dmg || 0) : 'none';
    if (key !== this.lastSelected) {
      if (this.lastSelected !== null && !(sel && this.lastSelectedId === sel.id)) this.equip = 0;
      this.lastSelected = key;
      this.lastSelectedId = sel ? sel.id : 0;
    }
    this.equip = Math.min(1, this.equip + 0.25);
    // balancement
    const dx = this.x - this.prevX, dz = this.z - this.prevZ;
    const d = Math.sqrt(dx * dx + dz * dz);
    if (this.onGround && !this.flying) {
      this.walkDist += d * 0.6;
      this.bob += (Math.min(0.1, d) - this.bob) * 0.4;
    } else this.bob *= 0.6;
    this.stats.distance += d;
    if (this.sprinting) this.addExhaustion(0.1 * d);
    if (this.inWater) this.addExhaustion(0.01 * d);
    // bruits de pas
    if (this.onGround && !this.sneaking && d > 0.01) {
      this.stepAcc = (this.stepAcc || 0) + d;
      if (this.stepAcc > 1.7) {
        this.stepAcc = 0;
        const id = this.blockBelow();
        if (id) this.game?.audio?.step(id, this.x, this.y, this.z);
      }
    }
    if (this.inWater && d > 0.02 && this.age % 12 === 0) this.world.playSound('swim', this.x, this.y, this.z, 0.3);
    if (this.sleeping) this.sleepTimer++;
  }

  aiStep() {
    const inp = this.input;
    if (this.sleeping) { this.strafe = this.forward = 0; this.jumping = false; return; }
    this.headYaw = this.yaw;
    this.forward = inp.forward;
    this.strafe = inp.strafe;
    this.jumping = inp.jump;
    this.sneaking = inp.sneak && !this.flying;
    // sprint
    if (inp.sprint && inp.forward > 0 && (this.food > 6 || this.creative) && !this.sneaking && !this.usingItem) this.sprinting = true;
    if (inp.forward <= 0 || this.collidedH || (this.food <= 6 && !this.creative) || this.sneaking) this.sprinting = false;
    let mul = 1;
    if (this.sneaking) mul = 0.3;
    if (this.usingItem) mul *= 0.2;
    this.forward *= mul;
    this.strafe *= mul;
    this.moveSpeed = 0.1 * (this.sprinting ? 1.3 : 1);
    if (this.jumping && this.onGround && !this.inWater && !this.inLava && !this.flying && this.jumpCooldown === 0) {
      this.addExhaustion(this.sprinting ? 0.2 : 0.05);
      this.stats.jumps++;
    }
    this.flyInput = inp;
  }

  airSpeed() {
    return this.sprinting ? 0.026 : 0.02;
  }

  travel() {
    if (this.flying) {
      const inp = this.flyInput || this.input;
      this.jumping = inp.jump;
      this.sneaking = inp.sneak;
      this.travelFlying(this.strafe, this.forward);
      this.sneaking = false;
      return;
    }
    super.travel();
  }

  // protection contre la chute en étant accroupi
  move(dx, dy, dz) {
    if (this.sneaking && this.onGround && !this.flying) {
      const step = 0.05;
      const noGround = (ox, oz) => {
        const bb = this.bbox();
        const boxes = this.world.getCollisions(bb[0] + ox, bb[1] - 1, bb[2] + oz, bb[3] + ox, bb[1] - 0.01, bb[5] + oz, []);
        for (const b of boxes) if (!(bb[3] + ox <= b[0] || bb[0] + ox >= b[3] || bb[5] + oz <= b[2] || bb[2] + oz >= b[5] || b[4] < bb[1] - 1 || b[1] > bb[1])) return false;
        return true;
      };
      while (dx !== 0 && noGround(dx, 0)) dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
      while (dz !== 0 && noGround(0, dz)) dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      while (dx !== 0 && dz !== 0 && noGround(dx, dz)) {
        dx = Math.abs(dx) < step ? 0 : dx - Math.sign(dx) * step;
        dz = Math.abs(dz) < step ? 0 : dz - Math.sign(dz) * step;
      }
    }
    super.move(dx, dy, dz);
  }

  onLand(dist) {
    if (this.creative || this.flying) return;
    // plumes : feather falling traité dans applyArmor
    super.onLand(dist);
  }

  // ----- rendu (3e personne) -----
  render(r, buf, pt, sky, bl) {
    const m = MODELS.player;
    const mat = M.mat4();
    const bodyYaw = M.lerp(this.prevBodyYaw, this.bodyYaw, pt);
    M.rotateY(mat, mat, bodyYaw);
    const ls = M.lerp(this.prevLimbSwing, this.limbSwing, pt) * 0.6662, la = M.lerp(this.prevLimbAmount, this.limbAmount, pt);
    const headRel = M.wrapAngle(M.lerp(this.prevYaw, this.yaw, pt) - bodyYaw);
    const swing = this.getSwing(pt);
    const sneak = this.sneaking ? 0.5 : 0;
    const parts = {
      head: [M.lerp(this.prevPitch, this.pitch, pt), headRel, 0],
      rarm: [Math.cos(ls + Math.PI) * 1.4 * la * 0.5 + Math.sin(swing * Math.PI) * 1.2, 0, 0],
      larm: [Math.cos(ls) * 1.4 * la * 0.5, 0, 0],
      rleg: [Math.cos(ls) * 1.4 * la, 0, 0],
      lleg: [Math.cos(ls + Math.PI) * 1.4 * la, 0, 0],
      body: [-sneak, 0, 0],
    };
    if (this.sleeping) {
      M.translate(mat, mat, 0, 0.3, 0);
      M.rotateX(mat, mat, -Math.PI / 2);
    }
    if (this.dead) M.rotateZ(mat, mat, Math.min(1, (this.deathTime + pt) / 20) * Math.PI / 2);
    renderModel(buf, m, mat, { parts }, sky, bl);
    return 'skin';
  }
}

registerEntity('player', Player);
