// L'Ender Dragon : boss final
import { Living } from './living.js';
import { registerEntity } from './registry.js';
import { B } from '../data/ids.js';
import { BLOCKS } from '../data/blocks.js';
import { MODELS, renderModel } from '../gfx/models.js';
import * as M from '../core/math.js';

const rnd = Math.random;
const IMMUNE = new Set([B.end_stone, B.obsidian, B.bedrock, B.iron_bars, B.end_portal, B.end_portal_frame, B.fire, B.crying_obsidian]);

export class EnderDragon extends Living {
  constructor(world, data) {
    super(world, data);
    this.type = 'ender_dragon';
    this.maxHealth = this.health = 200;
    this.width = 8;
    this.height = 4;
    this.noGravity = true;
    this.persistent = true;
    this.fireImmune = true;
    this.canDrown = false;
    this.phase = 'circle';
    this.phaseTime = 0;
    this.speed = 0.6;
    this.tx = 0; this.ty = 80; this.tz = 0;
    this.circleAngle = rnd() * Math.PI * 2;
    this.circleDir = rnd() < 0.5 ? 1 : -1;
    this.crystal = null;
    this.flap = 0; this.prevFlap = 0;
    this.renderRadius = 12;
    this.pitchV = 0;
    this.damageTaken = 0;
    this.breathTimer = 0;
    this.hurtSound = 'dragon_hurt';
    this.knockbackResistance = 1;
    this.history = [];
    this.fullbright = false;
    this.firstKill = data.firstKill !== false;
  }

  get fy() {
    return this.world.data.fountainY || 64;
  }

  get player() {
    return this.world.game?.player;
  }

  validPlayer() {
    const p = this.player;
    return p && !p.dead && p.world === this.world && !p.creative;
  }

  // Boîtes de collision : tête et corps
  hitboxes() {
    const f = M.lookDir(this.yaw, 0);
    const hx = this.x + f[0] * 6, hy = this.y + 0.5 + this.headDy(), hz = this.z + f[2] * 6;
    const head = [hx - 1, hy - 1, hz - 1, hx + 1, hy + 1, hz + 1];
    head.part = 'head';
    const body = [this.x - 2.5, this.y - 1.5, this.z - 2.5, this.x + 2.5, this.y + 1.5, this.z + 2.5];
    body.part = 'body';
    const wing = [this.x - 4, this.y - 0.3, this.z - 4, this.x + 4, this.y + 0.8, this.z + 4];
    wing.part = 'wing';
    return [head, body, wing];
  }

  headDy() {
    return this.phase === 'perched' ? -1.2 : 0;
  }

  bbox() {
    return [this.x - 4, this.y - 1.5, this.z - 4, this.x + 4, this.y + 2, this.z + 4];
  }

  damage(amount, src = {}) {
    if (this.dead || this.phase === 'dying') return false;
    if (src.type === 'explosion' && !(src.entity && src.entity.isPlayer)) return false;
    if (src.type === 'fall' || src.type === 'suffocate' || src.type === 'drown' || src.type === 'void' || src.type === 'magic') return false;
    let a = amount;
    if (src.part && src.part !== 'head') a = a / 4 + 1;
    if (src.type === 'explosion') a = Math.min(a, 12);
    const hp0 = this.health;
    this.invuln = 0;
    const ok = super.damage(a, Object.assign({}, src, { noKnock: true, noInvuln: true }));
    if (ok) {
      this.damageTaken += hp0 - this.health;
      if (this.phase === 'perched' && this.damageTaken > 25) this.setPhase('takeoff');
      this.world.playSound('dragon_hurt', this.x, this.y, this.z, 2, 0.8 + rnd() * 0.3);
    }
    return ok;
  }

  die() {
    if (this.phase === 'dying') return;
    this.health = 0;
    this.setPhase('dying');
    this.world.playSound('dragon_death', this.x, this.y, this.z, 4);
  }

  setPhase(p) {
    this.phase = p;
    this.phaseTime = 0;
    this.damageTaken = 0;
    if (p === 'landing' || p === 'takeoff' || p === 'strafe') this.world.playSound('dragon_growl', this.x, this.y, this.z, 3);
  }

  onCrystalDestroyed(c, src) {
    if (this.crystal === c) {
      this.crystal = null;
      super.damage(10, { type: 'explosion', entity: src && src.entity, noKnock: true, noInvuln: true, bypassArmor: true });
      if (this.health <= 0) this.die();
    }
  }

  crystalsLeft() {
    return this.world.countEntities((e) => e.type === 'end_crystal');
  }

  tick() {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.prevFlap = this.flap;
    this.prevBodyYaw = this.bodyYaw;
    this.age++;
    this.phaseTime++;
    if (this.hurtTime > 0) this.hurtTime--;
    this.bodyYaw = this.yaw;
    this.flap += this.phase === 'perched' ? 0.03 : this.phase === 'dying' ? 0.05 : 0.12 + Math.max(0, this.vy) * 0.2;
    if (Math.floor(this.flap / (Math.PI * 2)) !== Math.floor(this.prevFlap / (Math.PI * 2)) && this.phase !== 'perched') this.world.playSound('dragon_flap', this.x, this.y, this.z, 2, 0.8 + rnd() * 0.3);

    if (this.phase === 'dying') { this.tickDying(); return; }

    // soin par les cristaux
    if (this.crystal && this.crystal.removed) this.crystal = null;
    if (!this.crystal && this.age % 10 === 0) {
      let best = null, bd = 32 * 32;
      for (const e of this.world.entities) {
        if (e.type !== 'end_crystal' || e.removed) continue;
        const d = this.distanceSq(e.x, e.y, e.z);
        if (d < bd) { bd = d; best = e; }
      }
      this.crystal = best;
    }
    if (this.crystal && this.age % 10 === 0 && this.health < this.maxHealth) this.health = Math.min(this.maxHealth, this.health + 1);

    this.ai();
    this.destroyBlocks();
    this.hitEntities();
    if (this.age % 200 === 0 && this.phase !== 'perched') this.world.playSound('dragon_growl', this.x, this.y, this.z, 2);
  }

  steer(tx, ty, tz, speed, turn = 0.08) {
    const dx = tx - this.x, dz = tz - this.z, dy = ty - this.y;
    const want = Math.atan2(-dx, -dz);
    this.yaw = M.wrapAngle(this.yaw + M.clamp(M.wrapAngle(want - this.yaw), -turn, turn));
    const vyT = M.clamp(dy * 0.08, -0.6, 0.6);
    this.vy += (vyT - this.vy) * 0.1;
    this.vx = -Math.sin(this.yaw) * speed;
    this.vz = -Math.cos(this.yaw) * speed;
    this.x += this.vx; this.y += this.vy; this.z += this.vz;
    this.pitch = M.clamp(this.vy * 0.8, -0.6, 0.6);
    return Math.hypot(dx, dz);
  }

  nextCircleNode() {
    const crystals = this.crystalsLeft();
    // choix de phase
    if (rnd() < 1 / (crystals + 3) && this.phaseTime > 100) { this.setPhase('landing'); return; }
    if (this.validPlayer() && rnd() < 0.18 && this.phaseTime > 60) { this.setPhase(rnd() < 0.5 ? 'strafe' : 'charge'); return; }
    this.circleAngle += this.circleDir * (Math.PI / 5);
    if (rnd() < 0.08) this.circleDir *= -1;
    const R = 40 + rnd() * 25;
    this.tx = Math.cos(this.circleAngle) * R;
    this.tz = Math.sin(this.circleAngle) * R;
    this.ty = this.fy + 22 + rnd() * 22;
  }

  ai() {
    const p = this.player;
    switch (this.phase) {
      case 'circle': {
        const d = this.steer(this.tx, this.ty, this.tz, 0.6);
        if (d < 12 || this.phaseTime % 400 === 399) this.nextCircleNode();
        break;
      }
      case 'strafe': {
        if (!this.validPlayer()) { this.setPhase('circle'); break; }
        const d = this.steer(p.x, p.y + 12, p.z, 0.6);
        if (d < 50 && this.phaseTime > 20 && this.canSeeTarget(p)) {
          this.shootFireball(p);
          this.setPhase('circle');
          this.nextCircleNode();
        }
        if (this.phaseTime > 300) this.setPhase('circle');
        break;
      }
      case 'charge': {
        if (!this.validPlayer()) { this.setPhase('circle'); break; }
        const d = this.steer(p.x, p.y + 1, p.z, 0.8, 0.12);
        if (d < 4 || this.phaseTime > 200) { this.setPhase('circle'); this.nextCircleNode(); }
        break;
      }
      case 'landing': {
        const fy = this.fy;
        const above = this.phaseTime < 400 && Math.hypot(this.x, this.z) > 6;
        const tyy = above ? fy + 20 : fy + 4.5;
        const d = this.steer(0, tyy, 0, above ? 0.6 : 0.3, 0.12);
        if (!above && d < 2 && Math.abs(this.y - (fy + 4.5)) < 1.5) {
          this.x += (0 - this.x) * 0.2; this.z += (0 - this.z) * 0.2;
          this.setPhase('perched');
        }
        if (this.phaseTime > 800) this.setPhase('perched');
        break;
      }
      case 'perched': {
        this.vx = this.vz = 0;
        this.y += (this.fy + 4.5 - this.y) * 0.1;
        this.x *= 0.9; this.z *= 0.9;
        if (this.validPlayer()) {
          const want = Math.atan2(-(p.x - this.x), -(p.z - this.z));
          this.yaw = M.wrapAngle(this.yaw + M.clamp(M.wrapAngle(want - this.yaw), -0.05, 0.05));
          if (++this.breathTimer > 80) {
            this.breathTimer = 0;
            this.breath();
          }
        }
        if (this.phaseTime > 300 + rnd() * 200) this.setPhase('takeoff');
        break;
      }
      case 'takeoff': {
        this.steer(this.x - Math.sin(this.yaw) * 20, this.fy + 35, this.z - Math.cos(this.yaw) * 20, 0.5);
        if (this.y > this.fy + 25 || this.phaseTime > 120) { this.setPhase('circle'); this.nextCircleNode(); }
        break;
      }
      default:
        this.setPhase('circle');
    }
  }

  canSeeTarget(p) {
    const n = 20;
    for (let i = 1; i < n; i++) {
      const t = i / n;
      const id = this.world.getBlock(Math.floor(M.lerp(this.x, p.x, t)), Math.floor(M.lerp(this.y, p.y + 1, t)), Math.floor(M.lerp(this.z, p.z, t)));
      if (id && BLOCKS[id].opaque && BLOCKS[id].solid) return false;
    }
    return true;
  }

  shootFireball(p) {
    const f = M.lookDir(this.yaw, 0);
    const fb = this.world.spawn('dragon_fireball', this.x + f[0] * 6, this.y, this.z + f[2] * 6, { owner: this });
    if (fb) {
      fb.setAccel(p.x - fb.x, p.y + 1 - fb.y, p.z - fb.z);
      fb.vx = fb.ax * 5; fb.vy = fb.ay * 5; fb.vz = fb.az * 5;
    }
    this.world.playSound('dragon_shoot', this.x, this.y, this.z, 3);
  }

  breath() {
    const f = M.lookDir(this.yaw, 0);
    const x = this.x + f[0] * 7, z = this.z + f[2] * 7;
    let y = Math.floor(this.y);
    while (y > 0 && !this.world.getBlock(Math.floor(x), y - 1, Math.floor(z))) y--;
    this.world.spawn('area_cloud', x, y, z, { radius: 3, duration: 160, owner: this });
    this.world.playSound('dragon_breath', x, y, z, 2);
  }

  destroyBlocks() {
    if (this.phase === 'perched' || this.phase === 'landing' && this.y < this.fy + 8) return;
    const w = this.world;
    if (this.world.game && this.world.game.settings.mobGriefing === false) return;
    const x0 = Math.floor(this.x - 3), x1 = Math.floor(this.x + 3), y0 = Math.floor(this.y - 1), y1 = Math.floor(this.y + 2), z0 = Math.floor(this.z - 3), z1 = Math.floor(this.z + 3);
    let n = 0;
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          const id = w.getBlock(x, y, z);
          if (!id || IMMUNE.has(id) || BLOCKS[id].liquid) continue;
          w.setBlock(x, y, z, 0, 0);
          if (++n > 20) return;
        }
    if (n > 0 && rnd() < 0.3) w.game?.particles?.spawnBurst(w, 'explosion', this.x, this.y, this.z, 2, 2, 0.05);
  }

  hitEntities() {
    if (this.phase === 'perched' || this.age % 2) return;
    const hb = this.hitboxes();
    for (const e of this.world.entitiesIn(this.x - 5, this.y - 3, this.z - 5, this.x + 5, this.y + 3, this.z + 5, (o) => o.damage && o !== this && o.type !== 'end_crystal' && o.type !== 'area_cloud' && !(o.isPlayer && o.creative))) {
      const bb = e.bbox();
      for (const h of hb) {
        if (bb[3] < h[0] || bb[0] > h[3] || bb[4] < h[1] || bb[1] > h[4] || bb[5] < h[2] || bb[2] > h[5]) continue;
        const dmg = h.part === 'head' ? 10 : 5;
        if (e.damage(dmg, { type: 'mob', entity: this, noKnock: true })) {
          const dx = e.x - this.x, dz = e.z - this.z, l = Math.hypot(dx, dz) || 1;
          e.vx += (dx / l) * 1.5; e.vz += (dz / l) * 1.5; e.vy += 0.4;
        }
        break;
      }
    }
  }

  tickDying() {
    this.vx = this.vz = 0;
    this.y += 0.1;
    const p = this.world.game?.particles;
    if (p && this.phaseTime % 5 === 0) p.spawnBurst(this.world, 'explosion', this.x + (rnd() - 0.5) * 8, this.y + (rnd() - 0.5) * 4 + 2, this.z + (rnd() - 0.5) * 8, 1, 0.5, 0);
    if (p) for (let i = 0; i < 3; i++) p.spawn(this.world, 'end_rod', this.x + (rnd() - 0.5) * 6, this.y + rnd() * 3, this.z + (rnd() - 0.5) * 6, (rnd() - 0.5) * 0.3, rnd() * 0.3, (rnd() - 0.5) * 0.3);
    if (this.phaseTime > 150 && this.phaseTime % 5 === 0) this.world.dropXp(this.x + (rnd() - 0.5) * 2, this.y, this.z + (rnd() - 0.5) * 2, this.firstKill ? 200 : 25);
    if (this.phaseTime >= 200) {
      this.removed = true;
      this.dead = true;
      this.world.dropXp(this.x, this.y, this.z, this.firstKill ? 2000 : 250);
      this.world.game?.onDragonKilled?.(this);
    }
  }

  overlay() {
    if (this.hurtTime > 0) return [1, 0, 0, 0.3];
    if (this.phase === 'dying') return [1, 0.9, 1, Math.min(0.8, this.phaseTime / 200)];
    return null;
  }

  render(r, buf, pt, sky, bl) {
    const t = this.age + pt;
    const mat = M.mat4();
    const yaw = M.lerp(this.prevYaw, this.yaw, pt) + (Math.abs(this.yaw - this.prevYaw) > Math.PI ? Math.PI * 2 * Math.sign(this.prevYaw) : 0) * 0;
    M.rotateY(mat, mat, yaw);
    M.rotateX(mat, mat, M.lerp(this.prevPitch, this.pitch, pt) * 0.5);
    const flap = Math.sin(M.lerp(this.prevFlap, this.flap, pt));
    const parts = {};
    const offsets = {};
    // cou
    const perched = this.phase === 'perched';
    let nz = -32, ny = 2;
    for (let i = 0; i < 5; i++) {
      const wave = Math.sin(t * 0.08 - i * 0.6) * (perched ? 0.5 : 1.2);
      ny += perched ? -2.2 : wave * 0.6;
      offsets['neck' + i] = [0, ny, nz - 5];
      parts['neck' + i] = [0, Math.sin(t * 0.05 - i * 0.4) * 0.05, 0];
      nz -= 10;
    }
    offsets.head = [0, ny, nz + 2];
    parts.head = [perched ? -0.2 : Math.sin(t * 0.07) * 0.15, 0, 0];
    parts.jaw = [perched && this.breathTimer > 60 ? 0.5 : Math.max(0, Math.sin(t * 0.1)) * 0.2, 0, 0];
    // queue
    let tz = 32, ty = 0;
    for (let i = 0; i < 12; i++) {
      const wave = Math.sin(t * 0.07 + i * 0.5) * 1.2;
      ty += wave * 0.4 - (perched ? 0.8 : 0.2);
      offsets['tail' + i] = [Math.sin(t * 0.05 + i * 0.3) * i * 0.6, ty, tz + 5];
      tz += 10;
    }
    // ailes
    const wf = perched ? 0.1 : flap * 0.6;
    parts.lwing = [0, 0, wf];
    parts.lwingtip = [0, 0, -wf * 0.8 - 0.1];
    parts.rwing = [0, 0, -wf];
    parts.rwingtip = [0, 0, wf * 0.8 + 0.1];
    for (const l of ['fleg0', 'fleg1', 'bleg0', 'bleg1']) parts[l] = [perched ? -0.3 : 0.6, 0, 0];
    renderModel(buf, MODELS.dragon, mat, { parts, offsets }, this.phase === 'dying' ? 255 : Math.max(sky, 150), bl);
    return 'skin';
  }
}
registerEntity('ender_dragon', EnderDragon);
