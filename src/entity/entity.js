// Entité de base : position, physique et collisions
import { newEntityId } from './registry.js';
import { BLOCKS, SOLID } from '../data/blocks.js';
import { B } from '../data/ids.js';

const _boxes = [];

export class Entity {
  constructor(world, data = {}) {
    this.id = newEntityId();
    this.world = world;
    this.type = 'entity';
    this.x = 0; this.y = 0; this.z = 0;
    this.prevX = 0; this.prevY = 0; this.prevZ = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.yaw = 0; this.pitch = 0; this.prevYaw = 0; this.prevPitch = 0;
    this.width = 0.6; this.height = 1.8;
    this.onGround = false;
    this.collidedH = false;
    this.collidedV = false;
    this.inWater = false;
    this.inLava = false;
    this.fallDistance = 0;
    this.age = 0;
    this.removed = false;
    this.fireTicks = 0;
    this.noGravity = false;
    this.noClip = false;
    this.stepHeight = 0;
    this.persistent = false;
    this.data = data;
  }

  setPos(x, y, z) {
    this.x = this.prevX = x;
    this.y = this.prevY = y;
    this.z = this.prevZ = z;
  }

  get game() {
    return this.world.game;
  }

  eyeHeight() {
    return this.height * 0.85;
  }

  bbox() {
    const w = this.width / 2;
    return [this.x - w, this.y, this.z - w, this.x + w, this.y + this.height, this.z + w];
  }

  distanceTo(e) {
    const dx = e.x - this.x, dy = e.y - this.y, dz = e.z - this.z;
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  distanceSq(x, y, z) {
    const dx = x - this.x, dy = y - this.y, dz = z - this.z;
    return dx * dx + dy * dy + dz * dz;
  }

  tick() {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
    this.age++;
    if (this.y < -64) this.onVoid();
  }

  onVoid() {
    this.removed = true;
  }

  updateFluidState() {
    const bb = this.bbox();
    const liq = this.world.liquidIn(bb[0] + 0.001, bb[1] + 0.01, bb[2] + 0.001, bb[3] - 0.001, bb[1] + Math.max(0.3, this.height * 0.6), bb[5] - 0.001);
    const wasInWater = this.inWater;
    this.inWater = liq === B.water;
    this.inLava = liq === B.lava;
    if (this.inWater) {
      if (!wasInWater && this.fallDistance > 1 && this.onSplash) this.onSplash();
      this.fallDistance = 0;
      if (this.fireTicks > 0) this.fireTicks = 0;
    }
  }

  eyesInWater() {
    const ey = this.y + this.eyeHeight();
    const bx = Math.floor(this.x), by = Math.floor(ey), bz = Math.floor(this.z);
    if (this.world.getBlock(bx, by, bz) !== B.water) return false;
    const m = this.world.getMeta(bx, by, bz);
    const h = m & 8 || m === 0 ? 0.9 : 1 - (m & 7) / 9;
    return ey - by < h;
  }

  // Déplacement avec collisions (ordre Y, X, Z comme Minecraft)
  move(dx, dy, dz) {
    if (this.noClip) {
      this.x += dx; this.y += dy; this.z += dz;
      return;
    }
    const w = this.width / 2;
    let x0 = this.x - w, y0 = this.y, z0 = this.z - w, x1 = this.x + w, y1 = this.y + this.height, z1 = this.z + w;
    const odx = dx, ody = dy, odz = dz;
    const boxes = this.world.getCollisions(
      Math.min(x0, x0 + dx) - 0.01, Math.min(y0, y0 + dy) - 0.01, Math.min(z0, z0 + dz) - 0.01,
      Math.max(x1, x1 + dx) + 0.01, Math.max(y1, y1 + dy) + 0.01, Math.max(z1, z1 + dz) + 0.01, _boxes,
    );
    // Y
    for (const b of boxes) {
      if (x1 <= b[0] || x0 >= b[3] || z1 <= b[2] || z0 >= b[5]) continue;
      if (dy > 0 && y1 <= b[1] + 1e-7) dy = Math.min(dy, b[1] - y1);
      else if (dy < 0 && y0 >= b[4] - 1e-7) dy = Math.max(dy, b[4] - y0);
    }
    y0 += dy; y1 += dy;
    // X
    for (const b of boxes) {
      if (y1 <= b[1] || y0 >= b[4] || z1 <= b[2] || z0 >= b[5]) continue;
      if (dx > 0 && x1 <= b[0] + 1e-7) dx = Math.min(dx, b[0] - x1);
      else if (dx < 0 && x0 >= b[3] - 1e-7) dx = Math.max(dx, b[3] - x0);
    }
    x0 += dx; x1 += dx;
    // Z
    for (const b of boxes) {
      if (y1 <= b[1] || y0 >= b[4] || x1 <= b[0] || x0 >= b[3]) continue;
      if (dz > 0 && z1 <= b[2] + 1e-7) dz = Math.min(dz, b[2] - z1);
      else if (dz < 0 && z0 >= b[5] - 1e-7) dz = Math.max(dz, b[5] - z0);
    }
    z0 += dz; z1 += dz;

    // Montée de marche
    const collH = dx !== odx || dz !== odz;
    if (this.stepHeight > 0 && collH && (this.onGround || (ody < 0 && dy !== ody))) {
      const res = this.tryStep(odx, odz);
      if (res && res[0] * res[0] + res[2] * res[2] > dx * dx + dz * dz + 1e-6) {
        this.x += res[0]; this.y += res[1]; this.z += res[2];
        this.collidedH = Math.abs(res[0] - odx) > 1e-6 || Math.abs(res[2] - odz) > 1e-6;
        this.collidedV = false;
        this.onGround = true;
        if (this.collidedH) { if (Math.abs(res[0] - odx) > 1e-6) this.vx = 0; if (Math.abs(res[2] - odz) > 1e-6) this.vz = 0; }
        this.fallDistance = 0;
        return;
      }
    }

    this.x = (x0 + x1) / 2;
    this.y = y0;
    this.z = (z0 + z1) / 2;
    this.collidedH = dx !== odx || dz !== odz;
    this.collidedV = dy !== ody;
    const wasOnGround = this.onGround;
    this.onGround = ody < 0 && dy !== ody;
    if (dx !== odx) this.vx = 0;
    if (dz !== odz) this.vz = 0;
    if (dy !== ody) this.vy = 0;
    // chute
    if (this.onGround) {
      if (this.fallDistance > 0) this.onLand(this.fallDistance, wasOnGround);
      this.fallDistance = 0;
    } else if (dy < 0) this.fallDistance -= dy;
  }

  tryStep(dx, dz) {
    const w = this.width / 2;
    const sh = this.stepHeight;
    let x0 = this.x - w, y0 = this.y, z0 = this.z - w, x1 = this.x + w, y1 = this.y + this.height, z1 = this.z + w;
    const boxes = this.world.getCollisions(Math.min(x0, x0 + dx) - 0.01, y0 - 0.01, Math.min(z0, z0 + dz) - 0.01, Math.max(x1, x1 + dx) + 0.01, y1 + sh + 0.01, Math.max(z1, z1 + dz) + 0.01, _boxes);
    let up = sh;
    for (const b of boxes) {
      if (x1 <= b[0] || x0 >= b[3] || z1 <= b[2] || z0 >= b[5]) continue;
      if (y1 <= b[1] + 1e-7) up = Math.min(up, b[1] - y1);
    }
    y0 += up; y1 += up;
    for (const b of boxes) {
      if (y1 <= b[1] || y0 >= b[4] || z1 <= b[2] || z0 >= b[5]) continue;
      if (dx > 0 && x1 <= b[0] + 1e-7) dx = Math.min(dx, b[0] - x1);
      else if (dx < 0 && x0 >= b[3] - 1e-7) dx = Math.max(dx, b[3] - x0);
    }
    x0 += dx; x1 += dx;
    for (const b of boxes) {
      if (y1 <= b[1] || y0 >= b[4] || x1 <= b[0] || x0 >= b[3]) continue;
      if (dz > 0 && z1 <= b[2] + 1e-7) dz = Math.min(dz, b[2] - z1);
      else if (dz < 0 && z0 >= b[5] - 1e-7) dz = Math.max(dz, b[5] - z0);
    }
    z0 += dz; z1 += dz;
    // redescendre
    let down = -up;
    for (const b of boxes) {
      if (x1 <= b[0] || x0 >= b[3] || z1 <= b[2] || z0 >= b[5]) continue;
      if (y0 >= b[4] - 1e-7) down = Math.max(down, b[4] - y0);
    }
    return [dx, up + down, dz];
  }

  onLand() {}

  isInsideOpaque() {
    const id = this.world.getBlock(Math.floor(this.x), Math.floor(this.y + this.eyeHeight()), Math.floor(this.z));
    const d = BLOCKS[id];
    return d && d.opaque && d.solid && d.render === 'cube';
  }

  blockBelow() {
    return this.world.getBlock(Math.floor(this.x), Math.floor(this.y - 0.2), Math.floor(this.z));
  }

  isSolidAt(x, y, z) {
    return !!SOLID[this.world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z))];
  }

  serialize() {
    return null;
  }
}
