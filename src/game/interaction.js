// Interactions du joueur : viser, miner, poser, utiliser, attaquer
import { B, I } from '../data/ids.js';
import { BLOCKS, SOLID, REPLACEABLE, LIQUID, OPAQUE, collisionBoxes, N, S, W, E, U, D } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { raycastBlocks, raycastEntities } from './raycast.js';
import { canHarvest, FACING_VEC } from '../world/world.js';
import { tryLightPortal, checkEndPortal } from './portal.js';
import { growTree } from '../world/updates.js';
import { strongholdPos } from '../world/gen/structures.js';
import { explode } from '../world/explosion.js';
import { cloneStack } from './inventory.js';
import * as Mth from '../core/math.js';

const OPP = [1, 0, 3, 2, 5, 4];
const FDIR = [[0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0], [0, 1, 0], [0, -1, 0]];

export function lookFacing(yaw) {
  const dx = -Math.sin(yaw), dz = -Math.cos(yaw);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? E : W;
  return dz > 0 ? S : N;
}

export class Interaction {
  constructor(game) {
    this.game = game;
    this.breaking = null; // {x,y,z,progress}
    this.useDelay = 0;
    this.breakDelay = 0;
    this.attackDelay = 0;
    this.lastHitSound = 0;
  }

  get player() { return this.game.player; }
  get world() { return this.game.world; }

  reach() {
    return this.player.creative ? 5 : 4.5;
  }

  // Mise à jour de la cible visée
  updateTarget() {
    const p = this.player, g = this.game;
    if (!p || p.dead || p.sleeping) { g.target = null; g.targetEntity = null; return; }
    const ex = p.x, ey = p.y + p.eyeHeight(), ez = p.z;
    const d = Mth.lookDir(p.yaw, p.pitch);
    const hit = raycastBlocks(this.world, ex, ey, ez, d[0], d[1], d[2], this.reach());
    const ent = raycastEntities(this.world, ex, ey, ez, d[0], d[1], d[2], p.creative ? 5 : 3.5, (e) => e !== p && !e.dead && e.type !== 'item' && e.type !== 'xp_orb' && e.type !== 'area_cloud' && e.type !== 'arrow' && !e.invisible);
    if (ent && (!hit || ent.t < hit.t)) {
      g.targetEntity = ent;
      g.target = null;
    } else {
      g.targetEntity = null;
      g.target = hit;
    }
  }

  // ---------- Vitesse de minage ----------
  breakSpeed(def, stack) {
    const p = this.player;
    if (def.hardness < 0) return 0;
    if (def.hardness === 0) return 1;
    const d = stack ? ITEMS[stack.id] : null;
    const t = d && d.tool;
    let speed = 1;
    if (t) {
      if (t.type === def.tool) speed = t.speed;
      else if (t.type === 'sword' && def.web) speed = 15;
      else if (t.type === 'sword' && (def.leaves || def.plant)) speed = 1.5;
      else if (t.type === 'shears' && (def.leaves || def.web)) speed = def.web ? 15 : 15;
      else if (t.type === 'shears' && def.sound === 'cloth') speed = 5;
      if (speed > 1 && stack.ench && stack.ench.efficiency) speed += stack.ench.efficiency ** 2 + 1;
    }
    if (p.hasEffect('haste')) speed *= 1 + 0.2 * (p.effectAmp('haste') + 1);
    if (p.eyesInWater() && !(p.inventory.armor[0] && p.inventory.armor[0].ench && p.inventory.armor[0].ench.aqua_affinity)) speed /= 5;
    if (!p.onGround && !p.flying) speed /= 5;
    const harvest = canHarvest(def, stack) || (def.web && t && (t.type === 'sword' || t.type === 'shears'));
    return speed / def.hardness / (harvest ? 30 : 100);
  }

  // ---------- Tick ----------
  tick(input) {
    const g = this.game, p = this.player;
    if (this.useDelay > 0) this.useDelay--;
    if (this.breakDelay > 0) this.breakDelay--;
    if (this.attackDelay > 0) this.attackDelay--;
    if (!p || p.dead) { this.breaking = null; g.breakProgress = 0; return; }
    if (p.sleeping) return;
    this.updateTarget();
    const left = input.mouse.left || input.clicked.left;
    const right = input.mouse.right || input.clicked.right;

    // utilisation continue (manger, arc)
    if (p.usingItem) {
      if (!right) this.releaseUse();
      else this.tickUse();
      g.breakProgress = 0;
      this.breaking = null;
      return;
    }

    // attaque / minage
    if (input.clicked.left && g.targetEntity) {
      this.attack(g.targetEntity.entity, g.targetEntity.part);
    } else if (left && g.target && !g.targetEntity) {
      this.mine(g.target);
    } else {
      this.breaking = null;
      g.breakProgress = 0;
      if (input.clicked.left) p.swingArm();
    }

    // clic droit
    if (right && this.useDelay === 0 && (input.clicked.right || this.repeatRight)) {
      this.useDelay = 4;
      this.repeatRight = true;
      this.use();
    }
    if (!right) this.repeatRight = false;

    // clic molette : choisir le bloc
    if (input.clicked.middle && g.target) this.pickBlock(g.target);
  }

  mine(t) {
    const g = this.game, p = this.player, w = this.world;
    const def = BLOCKS[t.id];
    if (!def) return;
    if (p.creative) {
      if (this.breakDelay > 0) return;
      const held = p.inventory.selected();
      if (held && ITEMS[held.id] && ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword') return;
      this.breakDelay = 5;
      this.breakAt(t);
      return;
    }
    if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.id !== t.id) {
      this.breaking = { x: t.x, y: t.y, z: t.z, id: t.id, progress: 0 };
    }
    const held = p.inventory.selected();
    const sp = this.breakSpeed(def, held);
    this.breaking.progress += sp;
    g.breakProgress = Math.min(0.999, this.breaking.progress);
    p.swingArm();
    if (w.tickCount % 4 === 0) {
      g.audio.blockSound(def.sound, 'hit', t.x + 0.5, t.y + 0.5, t.z + 0.5);
      g.particles.blockHit(w, t.x, t.y, t.z, t.id, t.face);
    }
    if (this.breaking.progress >= 1) {
      this.breakAt(t);
      this.breaking = null;
      g.breakProgress = 0;
      this.breakDelay = 5;
    }
  }

  breakAt(t) {
    const g = this.game, p = this.player, w = this.world;
    const held = p.inventory.selected();
    const def = BLOCKS[t.id];
    if (def.hardness < 0 && !p.creative) return;
    if (t.id === B.bedrock && !p.creative) return;
    if (t.id === B.dragon_egg && !p.creative) { this.teleportEgg(t.x, t.y, t.z); return; }
    w.breakBlock(t.x, t.y, t.z, { player: p, tool: held, drop: !p.creative });
    p.stats.blocksMined++;
    p.addExhaustion(0.005);
    if (held && ITEMS[held.id] && ITEMS[held.id].durability && def.hardness > 0) p.damageHeld(ITEMS[held.id].tool && ITEMS[held.id].tool.type === 'sword' ? 2 : 1);
    g.onBlockMined?.(t.id);
  }

  teleportEgg(x, y, z) {
    const w = this.world;
    for (let i = 0; i < 100; i++) {
      const nx = x + Math.floor(Math.random() * 31) - 15, ny = y + Math.floor(Math.random() * 15) - 7, nz = z + Math.floor(Math.random() * 31) - 15;
      if (w.getBlock(nx, ny, nz) === 0 && SOLID[w.getBlock(nx, ny - 1, nz)]) {
        w.setBlock(x, y, z, 0);
        w.setBlock(nx, ny, nz, B.dragon_egg);
        this.game.particles.spawnBurst(w, 'portal', x + 0.5, y + 0.5, z + 0.5, 30, 0.5, 0.1);
        return;
      }
    }
  }

  attack(e, part) {
    const p = this.player, g = this.game;
    if (this.attackDelay > 0) return;
    this.attackDelay = 3;
    p.swingArm();
    const held = p.inventory.selected();
    const d = held ? ITEMS[held.id] : null;
    let dmg = d && d.damage ? d.damage : 1;
    const str = p.effectAmp('strength');
    if (str >= 0) dmg += 3 * (str + 1);
    const weak = p.effectAmp('weakness');
    if (weak >= 0) dmg -= 4 * (weak + 1);
    const ench = held && held.ench;
    if (ench) {
      if (ench.sharpness) dmg += 0.5 * ench.sharpness + 0.5;
      if (ench.smite && ['zombie', 'skeleton', 'wither_skeleton', 'piglin'].includes(e.type)) dmg += 2.5 * ench.smite;
      if (ench.bane_of_arthropods && e.type === 'spider') dmg += 2.5 * ench.bane_of_arthropods;
    }
    const crit = p.fallDistance > 0 && !p.onGround && !p.isClimbing() && !p.inWater && !p.flying;
    if (crit) dmg *= 1.5;
    const kb = (p.sprinting ? 1 : 0) + (ench && ench.knockback ? ench.knockback : 0);
    if (e.interactAttack && e.interactAttack(p)) return;
    const ok = e.damage(Math.max(0, dmg), { type: 'player', entity: p, part, knockMul: 1 + kb * 0.6 });
    if (ok) {
      if (crit) g.particles.spawnBurst(this.world, 'crit', e.x, e.y + e.height * 0.6, e.z, 10, 0.4, 0.2);
      if (ench && ench.fire_aspect) e.fireTicks = Math.max(e.fireTicks || 0, 80 * ench.fire_aspect);
      if (p.sprinting) { p.sprinting = false; p.vx *= 0.6; p.vz *= 0.6; }
      p.addExhaustion(0.1);
      if (d && d.durability) p.damageHeld(d.tool && d.tool.type === 'sword' ? 1 : 2);
      if (e.dead && e.type !== 'end_crystal') p.stats.kills++;
    }
  }

  // ---------- Clic droit ----------
  use() {
    const g = this.game, p = this.player, w = this.world;
    const held = p.inventory.selected();
    const def = held ? ITEMS[held.id] : null;
    // entité
    if (g.targetEntity) {
      const e = g.targetEntity.entity;
      if (e.interact && e.interact(p, held)) { p.swingArm(); return; }
      if (held && def && def.use === 'spawn_egg' && e.type === def.mob) { this.spawnEgg(def, e.x, e.y, e.z); return; }
    }
    const t = g.target;
    if (t) {
      // interaction avec le bloc
      if (!p.sneaking || !held) {
        if (this.useBlock(t, held)) { p.swingArm(); return; }
      }
      // objet sur bloc
      if (held && this.useItemOnBlock(t, held, def)) return;
    }
    if (held) this.useItemInAir(held, def);
  }

  useBlock(t, held) {
    const g = this.game, p = this.player, w = this.world;
    const { x, y, z, id } = t;
    const meta = w.getMeta(x, y, z);
    switch (id) {
      case B.crafting_table: g.ui.openCrafting(); return true;
      case B.chest: {
        let be = w.getBlockEntity(x, y, z);
        if (!be) { be = { type: 'chest', items: new Array(27).fill(null) }; w.setBlockEntity(x, y, z, be); }
        g.ui.openChest(be, { x, y, z });
        w.playSound('chest_open', x + 0.5, y + 0.5, z + 0.5, 0.6);
        return true;
      }
      case B.ender_chest:
        g.ui.openChest({ type: 'chest', items: g.enderChest }, { x, y, z }, 'Coffre de l\'Ender');
        w.playSound('chest_open', x + 0.5, y + 0.5, z + 0.5, 0.6);
        return true;
      case B.furnace: case B.lit_furnace: {
        let be = w.getBlockEntity(x, y, z);
        if (!be) { be = { type: 'furnace', items: [null, null, null], burn: 0, burnMax: 0, cook: 0, xp: 0 }; w.setBlockEntity(x, y, z, be); }
        g.ui.openFurnace(be, { x, y, z });
        return true;
      }
      case B.brewing_stand: {
        let be = w.getBlockEntity(x, y, z);
        if (!be) { be = { type: 'brewing', items: [null, null, null, null, null], brew: 0, fuel: 0 }; w.setBlockEntity(x, y, z, be); }
        g.ui.openBrewing(be);
        return true;
      }
      case B.enchanting_table: g.ui.openEnchanting({ x, y, z }); return true;
      case B.oak_door: {
        const by = meta & 8 ? y - 1 : y;
        const bm = w.getMeta(x, by, z);
        const open = !(bm & 4);
        w.setBlock(x, by, z, B.oak_door, (bm & ~4) | (open ? 4 : 0), false);
        const tm = w.getMeta(x, by + 1, z);
        if (w.getBlock(x, by + 1, z) === B.oak_door) w.setBlock(x, by + 1, z, B.oak_door, (tm & ~4) | (open ? 4 : 0), false);
        w.playSound(open ? 'door_open' : 'door_close', x + 0.5, y + 0.5, z + 0.5);
        return true;
      }
      case B.trapdoor:
        w.setBlock(x, y, z, B.trapdoor, meta ^ 4);
        w.playSound(meta & 4 ? 'door_close' : 'door_open', x + 0.5, y + 0.5, z + 0.5);
        return true;
      case B.bed: return this.useBed(x, y, z, meta);
      case B.cake:
        if (p.food < 20 || p.creative) {
          p.food = Math.min(20, p.food + 2);
          p.saturation = Math.min(p.food, p.saturation + 0.4);
          if ((meta & 7) >= 6) w.setBlock(x, y, z, 0); else w.setBlock(x, y, z, B.cake, meta + 1);
          w.playSound('eat', x + 0.5, y + 0.5, z + 0.5);
          return true;
        }
        return false;
      case B.end_portal_frame:
        if (held && held.id === I.ender_eye && !(meta & 4)) {
          w.setBlock(x, y, z, B.end_portal_frame, meta | 4);
          if (!p.creative) p.inventory.consumeSelected();
          w.playSound('eye_place', x + 0.5, y + 0.5, z + 0.5);
          g.particles.spawnBurst(w, 'portal', x + 0.5, y + 1, z + 0.5, 15, 0.3, 0.05);
          const r = checkEndPortal(w, x, y, z);
          if (r) {
            w.playSound('end_portal', r.x, r.y, r.z, 2);
            g.onEndPortalOpened?.();
          }
          return true;
        }
        return false;
      case B.dragon_egg:
        this.teleportEgg(x, y, z);
        return true;
      case B.tnt:
        if (held && held.id === I.flint_and_steel) {
          w.setBlock(x, y, z, 0);
          w.spawn('tnt', x + 0.5, y, z + 0.5, { owner: p });
          p.damageHeld(1);
          w.playSound('ignite', x + 0.5, y + 0.5, z + 0.5);
          return true;
        }
        return false;
      default:
        return false;
    }
  }

  useBed(x, y, z, meta) {
    const g = this.game, p = this.player, w = this.world;
    if (!w.props.beds) {
      w.setBlock(x, y, z, 0);
      explode(w, x + 0.5, y + 0.5, z + 0.5, 5, { fire: true });
      return true;
    }
    // position de la tête du lit
    let hx = x, hz = z;
    if (!(meta & 4)) { const [dx, dz] = FACING_VEC[meta & 3]; hx += dx; hz += dz; }
    p.spawnPoint = { dim: 'overworld', x: hx + 0.5, y: y + 0.6, z: hz + 0.5 };
    const night = g.skyDarken() >= 4 || (g.weather && g.weather.thunder);
    if (!night) { g.ui.chat('Point d\'apparition défini. Vous ne pouvez dormir que la nuit.'); return true; }
    const monsters = w.entitiesIn(x - 8, y - 5, z - 8, x + 8, y + 5, z + 8, (e) => e.hostile && !e.dead);
    if (monsters.length && !p.creative) { g.ui.chat('Vous ne pouvez pas dormir, des monstres rôdent à proximité.'); return true; }
    p.sleeping = true;
    p.sleepTimer = 0;
    p.sleepPos = { x: hx, y, z: hz };
    p.setPos(hx + 0.5, y + 0.56, hz + 0.5);
    p.vx = p.vy = p.vz = 0;
    g.onSleep?.();
    return true;
  }

  // Position où poser un bloc à partir d'une cible
  placePos(t) {
    const w = this.world;
    const cur = w.getBlock(t.x, t.y, t.z);
    if (REPLACEABLE[cur] && !LIQUID[cur]) return { x: t.x, y: t.y, z: t.z, face: U, replace: true };
    const f = FDIR[t.face];
    return { x: t.x + f[0], y: t.y + f[1], z: t.z + f[2], face: t.face };
  }

  useItemOnBlock(t, held, def) {
    const g = this.game, p = this.player, w = this.world;
    const id = t.id;
    if (!def) return false;
    // houe
    if (def.use === 'hoe' && (id === B.grass_block || id === B.dirt || id === B.dirt_path) && t.face !== D && !w.getBlock(t.x, t.y + 1, t.z)) {
      w.setBlock(t.x, t.y, t.z, B.farmland, 0);
      g.audio.blockSound('gravel', 'place', t.x + 0.5, t.y + 1, t.z + 0.5);
      p.damageHeld(1);
      p.swingArm();
      return true;
    }
    // pelle : chemin
    if (def.use === 'shovel' && id === B.grass_block && t.face !== D && !w.getBlock(t.x, t.y + 1, t.z)) {
      w.setBlock(t.x, t.y, t.z, B.dirt_path, 0);
      g.audio.blockSound('grass', 'place', t.x + 0.5, t.y + 1, t.z + 0.5);
      p.damageHeld(1);
      p.swingArm();
      return true;
    }
    // poudre d'os
    if (def.use === 'bonemeal') {
      if (this.boneMeal(t.x, t.y, t.z, id)) {
        if (!p.creative) p.inventory.consumeSelected();
        g.particles.spawnBurst(w, 'xp', t.x + 0.5, t.y + 0.8, t.z + 0.5, 8, 0.4, 0.02);
        p.swingArm();
        return true;
      }
      return false;
    }
    // graines / plantation
    if (def.plant && t.face === U) {
      const above = w.getBlock(t.x, t.y + 1, t.z);
      if (above) return false;
      if (def.plant === B.wheat && id !== B.farmland) return false;
      if (def.plant === B.sugar_cane) {
        if (!(id === B.sugar_cane || ((id === B.grass_block || id === B.dirt || id === B.sand) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => w.getBlock(t.x + dx, t.y, t.z + dz) === B.water)))) return false;
      }
      w.setBlock(t.x, t.y + 1, t.z, def.plant, 0);
      if (!p.creative) p.inventory.consumeSelected();
      g.audio.blockSound('grass', 'place', t.x + 0.5, t.y + 1, t.z + 0.5);
      p.swingArm();
      return true;
    }
    // seaux
    if (def.use === 'bucket') return this.useBucket(held, def);
    // briquet
    if (def.use === 'ignite') {
      const f = FDIR[t.face];
      const x = t.x + f[0], y = t.y + f[1], z = t.z + f[2];
      if (w.getBlock(x, y, z) !== 0) return false;
      if (!tryLightPortal(w, x, y, z)) w.setBlock(x, y, z, B.fire, 0);
      else g.onPortalLit?.();
      w.playSound('ignite', x + 0.5, y + 0.5, z + 0.5);
      p.damageHeld(1);
      p.swingArm();
      return true;
    }
    // œuf d'apparition
    if (def.use === 'spawn_egg') {
      const f = FDIR[t.face];
      this.spawnEgg(def, t.x + f[0] + 0.5, t.y + f[1], t.z + f[2] + 0.5);
      return true;
    }
    // œil de l'Ender sur autre chose que le cadre : lancer
    if (def.use === 'ender_eye') return false;
    // pose de bloc
    const placeId = held.id < 256 ? held.id : def.place;
    if (placeId) return this.placeBlock(t, placeId, held);
    return false;
  }

  spawnEgg(def, x, y, z) {
    const w = this.world, p = this.player;
    const e = w.spawn(def.mob === 'magma_cube' ? 'magma_cube' : def.mob, x, y, z);
    if (e) { e.persistent = true; e.despawnable = false; }
    if (!p.creative) p.inventory.consumeSelected();
    p.swingArm();
  }

  boneMeal(x, y, z, id) {
    const w = this.world;
    if (id === B.wheat) {
      const m = w.getMeta(x, y, z);
      if (m >= 7) return false;
      w.setBlock(x, y, z, B.wheat, Math.min(7, m + 2 + Math.floor(Math.random() * 3)));
      return true;
    }
    if (id === B.oak_sapling || id === B.birch_sapling || id === B.spruce_sapling) {
      if (Math.random() < 0.45) growTree(w, x, y, z, id);
      return true;
    }
    if (id === B.grass_block) {
      for (let i = 0; i < 24; i++) {
        const nx = x + Math.floor(Math.random() * 7) - 3, nz = z + Math.floor(Math.random() * 7) - 3;
        for (let ny = y + 2; ny >= y - 2; ny--) {
          if (w.getBlock(nx, ny, nz) === B.grass_block && w.getBlock(nx, ny + 1, nz) === 0) {
            const r = Math.random();
            w.setBlock(nx, ny + 1, nz, r < 0.8 ? B.short_grass : r < 0.9 ? B.dandelion : B.poppy, 0);
            break;
          }
        }
      }
      return true;
    }
    if (id === B.sugar_cane || id === B.cactus) {
      let top = y;
      while (w.getBlock(x, top + 1, z) === id) top++;
      let bottom = y;
      while (w.getBlock(x, bottom - 1, z) === id) bottom--;
      if (top - bottom + 1 < 3 && w.getBlock(x, top + 1, z) === 0) { w.setBlock(x, top + 1, z, id, 0); return true; }
      return false;
    }
    return false;
  }

  canPlace(x, y, z, id, meta) {
    const w = this.world;
    const below = w.getBlock(x, y - 1, z);
    const def = BLOCKS[id];
    const solidBelow = SOLID[below] && (OPAQUE[below] || BLOCKS[below].slab || BLOCKS[below].stairs || below === B.farmland || below === B.glass);
    if (def.plant || def.key.endsWith('sapling')) {
      if (id === B.brown_mushroom || id === B.red_mushroom) return solidBelow;
      if (id === B.dead_bush) return below === B.sand || below === B.dirt || below === B.grass_block;
      return below === B.grass_block || below === B.dirt || below === B.farmland;
    }
    if (id === B.cactus) return (below === B.sand || below === B.cactus) && ![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => SOLID[w.getBlock(x + dx, y, z + dz)]);
    if (id === B.torch) {
      if (!meta) return solidBelow || below === B.oak_fence || below === B.nether_brick_fence;
      const [dx, dz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][meta - 1];
      return OPAQUE[w.getBlock(x + dx, y, z + dz)];
    }
    if (id === B.ladder) {
      const [dx, dz] = [[0, -1], [0, 1], [-1, 0], [1, 0]][meta & 3];
      return OPAQUE[w.getBlock(x + dx, y, z + dz)];
    }
    if (id === B.snow || id === B.lantern || id === B.brewing_stand || id === B.cake) return solidBelow;
    return true;
  }

  placeBlock(t, id, held) {
    const g = this.game, p = this.player, w = this.world;
    const def = BLOCKS[id];
    if (!def) return false;
    // dalles : fusion
    if (def.slab && t.id === id) {
      const m = w.getMeta(t.x, t.y, t.z);
      if ((m === 0 && t.face === U) || (m === 1 && t.face === D)) {
        w.setBlock(t.x, t.y, t.z, id, 2);
        this.afterPlace(id, t.x, t.y, t.z);
        return true;
      }
    }
    let pos = this.placePos(t);
    const cur = w.getBlock(pos.x, pos.y, pos.z);
    if (def.slab && cur === id && w.getMeta(pos.x, pos.y, pos.z) !== 2) {
      w.setBlock(pos.x, pos.y, pos.z, id, 2);
      this.afterPlace(id, pos.x, pos.y, pos.z);
      return true;
    }
    if (cur && !(REPLACEABLE[cur])) return false;
    if (pos.y < 0 || pos.y > 127) return false;
    const face = pos.face;
    const look = lookFacing(p.yaw);
    const hitFrac = t.hy - Math.floor(t.hy);
    let meta = 0;
    if (def.tex && def.tex.front) meta = OPP[look];
    if (id === B.chest || id === B.ender_chest || id === B.end_portal_frame || id === B.pumpkin || id === B.jack_o_lantern || id === B.furnace) meta = OPP[look];
    if (def.tex && def.tex.axis) meta = face === U || face === D ? 0 : face === W || face === E ? 1 : 2;
    if (id === B.torch) {
      if (face === U || pos.replace) meta = 0;
      else if (face === D) return false;
      else meta = 1 + OPP[face];
      if (!this.canPlace(pos.x, pos.y, pos.z, id, meta) && meta !== 0) meta = 0;
    }
    if (id === B.ladder) {
      if (face >= 4) {
        // choisir un mur adjacent
        const walls = [N, S, W, E].filter((f) => OPAQUE[w.getBlock(pos.x + FDIR[f][0], pos.y, pos.z + FDIR[f][2])]);
        if (!walls.length) return false;
        meta = walls.includes(look) ? look : walls[0];
      } else meta = OPP[face];
    }
    if (def.stairs) meta = look | (face === D || (face < 4 && hitFrac > 0.5) ? 4 : 0);
    if (def.slab) meta = face === D || (face < 4 && hitFrac > 0.5) ? 1 : 0;
    if (id === B.trapdoor) meta = OPP[look] | (face === D || (face < 4 && hitFrac > 0.5) ? 8 : 0);
    if (id === B.oak_door) {
      meta = OPP[look];
      if (w.getBlock(pos.x, pos.y + 1, pos.z) && !REPLACEABLE[w.getBlock(pos.x, pos.y + 1, pos.z)]) return false;
      if (!SOLID[w.getBlock(pos.x, pos.y - 1, pos.z)]) return false;
    }
    if (id === B.bed) {
      meta = look;
      const [dx, dz] = FACING_VEC[look];
      const hx = pos.x + dx, hz = pos.z + dz;
      const hid = w.getBlock(hx, pos.y, hz);
      if ((hid && !REPLACEABLE[hid]) || !SOLID[w.getBlock(pos.x, pos.y - 1, pos.z)] || !SOLID[w.getBlock(hx, pos.y - 1, hz)]) return false;
    }
    if (!this.canPlace(pos.x, pos.y, pos.z, id, meta)) return false;
    // collision avec les entités
    const boxes = collisionBoxes(id, meta, null);
    if (boxes && def.solid) {
      for (const b of boxes) {
        const x0 = pos.x + b.x0 / 16, y0 = pos.y + b.y0 / 16, z0 = pos.z + b.z0 / 16, x1 = pos.x + b.x1 / 16, y1 = pos.y + b.y1 / 16, z1 = pos.z + b.z1 / 16;
        const hit = w.entitiesIn(x0, y0, z0, x1, y1, z1, (e) => e.type !== 'item' && e.type !== 'xp_orb' && e.type !== 'arrow' && !e.dead && e.type !== 'area_cloud');
        for (const e of hit) {
          const bb = e.bbox();
          if (bb[3] > x0 + 0.001 && bb[0] < x1 - 0.001 && bb[4] > y0 + 0.001 && bb[1] < y1 - 0.001 && bb[5] > z0 + 0.001 && bb[2] < z1 - 0.001) return false;
        }
      }
    }
    w.setBlock(pos.x, pos.y, pos.z, id, meta);
    if (id === B.oak_door) w.setBlock(pos.x, pos.y + 1, pos.z, B.oak_door, meta | 8);
    if (id === B.bed) {
      const [dx, dz] = FACING_VEC[meta];
      w.setBlock(pos.x + dx, pos.y, pos.z + dz, B.bed, meta | 4);
    }
    if (id === B.chest && !w.getBlockEntity(pos.x, pos.y, pos.z)) w.setBlockEntity(pos.x, pos.y, pos.z, { type: 'chest', items: new Array(27).fill(null) });
    this.afterPlace(id, pos.x, pos.y, pos.z);
    // citrouille sculptée sur neige/fer : golems (neige non implémenté)
    if (id === B.pumpkin || id === B.jack_o_lantern) this.checkGolem(pos.x, pos.y, pos.z);
    return true;
  }

  afterPlace(id, x, y, z) {
    const p = this.player, g = this.game;
    if (!p.creative) p.inventory.consumeSelected();
    p.stats.blocksPlaced++;
    p.swingArm();
    g.audio.blockSound(BLOCKS[id].sound, 'place', x + 0.5, y + 0.5, z + 0.5);
    g.onBlockPlaced?.(id, x, y, z);
  }

  checkGolem(x, y, z) {
    const w = this.world;
    if (w.getBlock(x, y - 1, z) !== B.iron_block || w.getBlock(x, y - 2, z) !== B.iron_block) return;
    for (const [ax, az] of [[1, 0], [0, 1]]) {
      if (w.getBlock(x + ax, y - 1, z + az) === B.iron_block && w.getBlock(x - ax, y - 1, z - az) === B.iron_block) {
        for (const [dx, dy, dz] of [[0, 0, 0], [0, -1, 0], [0, -2, 0], [ax, -1, az], [-ax, -1, -az]]) w.setBlock(x + dx, y + dy, z + dz, 0);
        const golem = w.spawn('iron_golem', x + 0.5, y - 2, z + 0.5);
        if (golem) golem.playerCreated = true;
        return;
      }
    }
  }

  useBucket(held, def) {
    const g = this.game, p = this.player, w = this.world;
    const d = Mth.lookDir(p.yaw, p.pitch);
    const hit = raycastBlocks(w, p.x, p.y + p.eyeHeight(), p.z, d[0], d[1], d[2], this.reach(), 'select', true);
    if (!hit) return false;
    if (held.id === I.bucket) {
      if (!LIQUID[hit.id] || w.getMeta(hit.x, hit.y, hit.z) !== 0) return false;
      const filled = hit.id === B.water ? I.water_bucket : I.lava_bucket;
      w.setBlock(hit.x, hit.y, hit.z, 0, 0);
      w.playSound(hit.id === B.water ? 'splash' : 'fizz', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5, 0.5);
      if (!p.creative) {
        if (held.count > 1) { held.count--; if (p.inventory.add({ id: filled, count: 1 }) > 0) w.dropItem(p.x, p.y + 1, p.z, { id: filled, count: 1 }); }
        else p.inventory.setSelected({ id: filled, count: 1 });
      }
      p.inventory.changed();
      g.onBucketFill?.(filled);
      p.swingArm();
      return true;
    }
    // vider
    let tx = hit.x, ty = hit.y, tz = hit.z;
    const cur = w.getBlock(tx, ty, tz);
    if (!(REPLACEABLE[cur] && !LIQUID[cur]) && !(LIQUID[cur])) {
      const f = FDIR[hit.face];
      tx += f[0]; ty += f[1]; tz += f[2];
    }
    const c2 = w.getBlock(tx, ty, tz);
    if (c2 && !REPLACEABLE[c2]) return false;
    if (def.liquid === B.water && w.dim === 'nether') {
      w.playSound('fizz', tx + 0.5, ty + 0.5, tz + 0.5);
      g.particles.spawnBurst(w, 'smoke', tx + 0.5, ty + 0.5, tz + 0.5, 8, 0.4, 0.05);
    } else {
      if (c2 && !LIQUID[c2]) w.breakBlock(tx, ty, tz, {});
      w.setBlock(tx, ty, tz, def.liquid, 0);
      w.playSound(def.liquid === B.water ? 'splash' : 'fizz', tx + 0.5, ty + 0.5, tz + 0.5, 0.5);
    }
    if (!p.creative) p.inventory.setSelected({ id: I.bucket, count: 1 });
    p.swingArm();
    return true;
  }

  useItemInAir(held, def) {
    const g = this.game, p = this.player, w = this.world;
    if (!def) return;
    if (def.food && (p.food < 20 || def.always || p.creative)) { this.startUse(held, 32); return; }
    if (def.use === 'drink' || def.use === 'milk') { this.startUse(held, 32); return; }
    if (def.use === 'bow') {
      if (p.creative || p.inventory.has(I.arrow) || (held.ench && held.ench.infinity && p.inventory.has(I.arrow))) this.startUse(held, 72000);
      return;
    }
    if (def.use === 'bucket') { this.useBucket(held, def); return; }
    if (def.use === 'armor') {
      const slot = def.armor.slot;
      const old = p.inventory.armor[slot];
      p.inventory.armor[slot] = cloneStack(held);
      p.inventory.setSelected(old);
      w.playSound('mat_metal_step', p.x, p.y + 1, p.z, 0.6);
      g.onArmorChange?.();
      return;
    }
    if (def.use && def.use.startsWith('throw') || def.use === 'ender_eye') {
      this.throwItem(held, def);
      return;
    }
    if (def.use === 'bottle') {
      const d = Mth.lookDir(p.yaw, p.pitch);
      const hit = raycastBlocks(w, p.x, p.y + p.eyeHeight(), p.z, d[0], d[1], d[2], this.reach(), 'select', true);
      if (hit && hit.id === B.water) {
        p.inventory.consumeSelected();
        if (p.inventory.add({ id: I.potion, count: 1, potion: 'water' }) > 0) w.dropItem(p.x, p.y + 1, p.z, { id: I.potion, count: 1, potion: 'water' });
        w.playSound('drink', p.x, p.y, p.z, 0.5);
      }
    }
  }

  throwItem(held, def) {
    const g = this.game, p = this.player, w = this.world;
    const d = Mth.lookDir(p.yaw, p.pitch);
    const ex = p.x, ey = p.y + p.eyeHeight() - 0.1, ez = p.z;
    if (def.use === 'ender_eye') {
      if (w.dim !== 'overworld') { g.ui.chat('L\'œil de l\'Ender ne réagit pas ici...'); return; }
      const sh = strongholdPos(w.seed);
      const target = w.gen.stronghold && w.gen.stronghold.portalCenter ? w.gen.stronghold.portalCenter : sh;
      w.spawn('eye_of_ender', ex, ey, ez, { tx: target.x + 0.5, ty: target.y, tz: target.z + 0.5 });
      w.playSound('teleport', ex, ey, ez, 0.5, 1.5);
      if (!p.creative) p.inventory.consumeSelected();
      p.swingArm();
      g.onEyeThrown?.();
      return;
    }
    if (def.use === 'throw_pearl') {
      if (p.enderPearlCooldown > 0) return;
      p.enderPearlCooldown = 20;
    }
    const kind = def.use === 'throw_pearl' ? 'ender_pearl' : def.use === 'throw_snowball' ? 'snowball' : def.use === 'throw_egg' ? 'egg' : 'experience_bottle';
    const e = w.spawn('thrown', ex, ey, ez, { owner: p, kind });
    if (e) {
      e.shoot(d[0], d[1] + (kind === 'experience_bottle' ? 0.2 : 0), d[2], kind === 'experience_bottle' ? 0.7 : 1.5, 1);
      e.vx += p.vx; e.vz += p.vz; if (!p.onGround) e.vy += p.vy;
    }
    w.playSound('bow', ex, ey, ez, 0.4, 0.6);
    if (!p.creative) p.inventory.consumeSelected();
    p.swingArm();
  }

  startUse(held, ticks) {
    const p = this.player;
    p.usingItem = true;
    p.useTicks = 0;
    p.useMax = ticks;
    p.useItemId = held.id;
  }

  tickUse() {
    const p = this.player, g = this.game, w = this.world;
    const held = p.inventory.selected();
    if (!held || held.id !== p.useItemId) { p.usingItem = false; return; }
    p.useTicks++;
    const def = ITEMS[held.id];
    if (def.food && p.useTicks > 4 && p.useTicks % 4 === 0) {
      w.playSound('eat', p.x, p.y + 1.5, p.z, 0.5);
      g.particles.itemBreak(w, p.x - Math.sin(p.yaw) * 0.4, p.y + 1.4, p.z - Math.cos(p.yaw) * 0.4, g.renderer ? 0 : 0);
    }
    if (p.useTicks >= p.useMax && p.useMax < 1000) this.finishUse(held, def);
  }

  finishUse(held, def) {
    const p = this.player, g = this.game, w = this.world;
    p.usingItem = false;
    if (def.food) {
      p.eat(def);
      w.playSound('burp', p.x, p.y + 1, p.z, 0.5);
      g.onEat?.(held.id);
      if (!p.creative) p.inventory.consumeSelected();
    } else if (def.use === 'milk') {
      p.effects = {};
      if (!p.creative) p.inventory.setSelected({ id: I.bucket, count: 1 });
      w.playSound('drink', p.x, p.y + 1, p.z);
    } else if (def.use === 'drink') {
      const effects = { healing: ['instant_health', 1, 0], regeneration: ['regeneration', 900, 0], fire_resistance: ['fire_resistance', 3600, 0], strength: ['strength', 3600, 0], swiftness: ['speed', 3600, 0], night_vision: ['night_vision', 3600, 0] };
      const e = effects[held.potion];
      if (e) p.addEffect(e[0], e[1], e[2]);
      w.playSound('drink', p.x, p.y + 1, p.z);
      if (!p.creative) p.inventory.setSelected({ id: I.glass_bottle, count: 1 });
    }
  }

  releaseUse() {
    const p = this.player, g = this.game, w = this.world;
    const held = p.inventory.selected();
    const wasBow = held && held.id === I.bow && p.usingItem;
    const t = p.useTicks;
    p.usingItem = false;
    if (!wasBow) return;
    let f = t / 20;
    f = (f * f + f * 2) / 3;
    if (f < 0.1) return;
    if (f > 1) f = 1;
    const infinite = p.creative || (held.ench && held.ench.infinity);
    if (!infinite) {
      if (!p.inventory.has(I.arrow)) return;
      p.inventory.remove(I.arrow, 1);
    }
    const d = Mth.lookDir(p.yaw, p.pitch);
    const ench = held.ench || {};
    const a = w.spawn('arrow', p.x, p.y + p.eyeHeight() - 0.1, p.z, { owner: p, damage: 2 + (ench.power ? 0.5 * ench.power + 0.5 : 0), crit: f >= 1, pickup: infinite ? 2 : 1, knockback: ench.punch || 0, flame: !!ench.flame });
    if (a) a.shoot(d[0], d[1], d[2], f * 3, 1);
    w.playSound('bow', p.x, p.y + 1.5, p.z, 1, 1 / (Math.random() * 0.4 + 1.2) + f * 0.5);
    p.damageHeld(1);
    g.onShoot?.();
  }

  pickBlock(t) {
    const p = this.player;
    const def = BLOCKS[t.id];
    const id = def.pick ? def.pick() : t.id;
    if (!ITEMS[id]) return;
    const inv = p.inventory;
    for (let i = 0; i < 9; i++) if (inv.slots[i] && inv.slots[i].id === id) { inv.sel = i; inv.changed(); return; }
    if (p.creative) {
      let slot = -1;
      for (let i = 0; i < 9; i++) if (!inv.slots[i]) { slot = i; break; }
      if (slot < 0) slot = inv.sel;
      inv.slots[slot] = { id, count: ITEMS[id].stack || 64 };
      inv.sel = slot;
      inv.changed();
    } else {
      const k = inv.findSlot((s) => s.id === id);
      if (k >= 9) {
        const tmp = inv.slots[inv.sel];
        inv.slots[inv.sel] = inv.slots[k];
        inv.slots[k] = tmp;
        inv.changed();
      }
    }
  }

  dropSelected(all) {
    const p = this.player, w = this.world;
    const s = p.inventory.selected();
    if (!s) return;
    const n = all ? s.count : 1;
    const drop = cloneStack(s, n);
    s.count -= n;
    if (s.count <= 0) p.inventory.setSelected(null);
    p.inventory.changed();
    this.throwStack(drop);
  }

  throwStack(stack) {
    const p = this.player, w = this.world;
    const d = Mth.lookDir(p.yaw, p.pitch);
    const e = w.dropItem(p.x, p.y + p.eyeHeight() - 0.3, p.z, stack, [d[0] * 0.3, d[1] * 0.3 + 0.1, d[2] * 0.3]);
    if (e) e.pickupDelay = 40;
    p.swingArm();
  }
}
