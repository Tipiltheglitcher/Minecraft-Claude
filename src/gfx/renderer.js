// Moteur de rendu WebGL2
import * as M from '../core/math.js';
import { createProgram, createTextureArray, setupVertexAttribs } from './gl.js';
import { WORLD_VS, WORLD_FS, SKY_VS, SKY_FS, LINE_VS, LINE_FS } from './shaders.js';
import { buildTextures, tex, TEX_SIZE } from './textures.js';
import { buildSkins, SKIN_SIZE, MODELS, renderModel, renderBlockCube, renderSprite } from './models.js';
import { buildSection, GeoBuffer, meshSettings } from './mesher.js';
import { ST_LIT } from '../world/chunk.js';
import { BLOCKS, selectionBoxes, RENDER, R_CUBE, R_CROSS, R_CROP } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { B } from '../data/ids.js';

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.game = game;
    const gl = canvas.getContext('webgl2', { antialias: false, alpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('WebGL2 non disponible');
    this.gl = gl;
    this.proj = M.mat4();
    this.view = M.mat4();
    this.viewProj = M.mat4();
    this.invViewProj = M.mat4();
    this.frustum = new Float32Array(24);
    this.cam = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0 };
    this.time = 0;
    this.meshQueue = [];
    this.stats = { sections: 0, drawn: 0, meshedThisFrame: 0, tris: 0 };

    // textures
    const { layers } = buildTextures();
    this.blockTex = createTextureArray(gl, layers, TEX_SIZE, { mipmaps: true, maxLevel: 3, keepAlpha: true });
    this.skinTex = createTextureArray(gl, buildSkins(), SKIN_SIZE, { mipmaps: false });

    // programmes
    this.world = createProgram(gl, WORLD_VS, WORLD_FS, 'world');
    this.sky = createProgram(gl, SKY_VS, SKY_FS, 'sky');
    this.line = createProgram(gl, LINE_VS, LINE_FS, 'line');

    // tampon d'indices partagé (quads)
    this.indexBuf = gl.createBuffer();
    this.indexCap = 0;
    this.ensureIndices(65536);

    // géométrie dynamique
    this.dyn = new GeoBuffer(8192);
    this.dynVbo = gl.createBuffer();
    this.dynVao = gl.createVertexArray();
    gl.bindVertexArray(this.dynVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    setupVertexAttribs(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bindVertexArray(null);

    this.lineVbo = gl.createBuffer();
    this.lineVao = gl.createVertexArray();
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 12, 0);
    gl.bindVertexArray(null);
    this.emptyVao = gl.createVertexArray();

    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.frontFace(gl.CCW);
    this.env = null;
  }

  ensureIndices(quads) {
    if (quads <= this.indexCap) return;
    const gl = this.gl;
    let cap = Math.max(this.indexCap * 2, quads, 65536);
    const idx = new Uint32Array(cap * 6);
    for (let q = 0; q < cap; q++) {
      const v = q * 4, o = q * 6;
      idx[o] = v; idx[o + 1] = v + 1; idx[o + 2] = v + 2; idx[o + 3] = v; idx[o + 4] = v + 2; idx[o + 5] = v + 3;
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    this.indexCap = cap;
    // les VAO existants référencent le même buffer : rien à faire
  }

  resize() {
    const s = this.game.settings;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (s.resolution || 1);
    const w = Math.floor(this.canvas.clientWidth * dpr), h = Math.floor(this.canvas.clientHeight * dpr);
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
  }

  // ---------- Maillages de chunks ----------
  uploadMesh(part) {
    const gl = this.gl;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, part.data, gl.STATIC_DRAW);
    setupVertexAttribs(gl);
    this.ensureIndices(part.count / 4);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bindVertexArray(null);
    return { vao, vbo, count: part.count };
  }

  freeMeshPart(m) {
    if (!m) return;
    this.gl.deleteVertexArray(m.vao);
    this.gl.deleteBuffer(m.vbo);
  }

  disposeChunk(c) {
    for (let s = 0; s < c.meshes.length; s++) {
      const m = c.meshes[s];
      if (m) { this.freeMeshPart(m.opaque); this.freeMeshPart(m.trans); c.meshes[s] = null; }
    }
  }

  disposeAll(world) {
    if (!world) return;
    for (const c of world.chunks.values()) this.disposeChunk(c);
  }

  canMesh(world, c) {
    if (c.state < ST_LIT) return false;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const n = world.getChunk(c.cx + dx, c.cz + dz);
        if (!n || n.state < ST_LIT) return false;
      }
    return true;
  }

  updateMeshes(world, budgetMs) {
    const t0 = performance.now();
    const pcx = Math.floor(this.cam.x) >> 4, pcz = Math.floor(this.cam.z) >> 4;
    const R = this.game.settings.renderDistance;
    const q = [];
    for (const c of world.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      let any = false;
      for (let s = 0; s < 8; s++) if (c.dirty[s]) { any = true; break; }
      if (!any) continue;
      if (!this.canMesh(world, c)) continue;
      q.push([dx * dx + dz * dz, c]);
    }
    q.sort((a, b) => a[0] - b[0]);
    let n = 0;
    for (const [d, c] of q) {
      for (let s = 0; s < 8; s++) {
        if (!c.dirty[s]) continue;
        c.dirty[s] = 0;
        const old = c.meshes[s];
        if (old) { this.freeMeshPart(old.opaque); this.freeMeshPart(old.trans); c.meshes[s] = null; }
        if (!c.sectionHasBlocks[s]) continue;
        const res = buildSection(world, c, s);
        const m = {};
        if (res.opaque) m.opaque = this.uploadMesh(res.opaque);
        if (res.trans) m.trans = this.uploadMesh(res.trans);
        c.meshes[s] = m.opaque || m.trans ? m : null;
        n++;
      }
      if (d > 2 && performance.now() - t0 > budgetMs) break;
    }
    this.stats.meshedThisFrame = n;
    return n;
  }

  // ---------- Caméra ----------
  setupCamera(pt) {
    const game = this.game;
    const p = game.player;
    const s = game.settings;
    const cam = this.cam;
    const ix = M.lerp(p.prevX, p.x, pt), iy = M.lerp(p.prevY, p.y, pt), iz = M.lerp(p.prevZ, p.z, pt);
    cam.yaw = p.yaw;
    cam.pitch = p.pitch;
    let eye = p.eyeHeight();
    if (p.sleeping) eye = 0.3;
    cam.x = ix; cam.y = iy + eye; cam.z = iz;
    // balancement de la vue
    let bobX = 0, bobY = 0, roll = 0;
    if (s.viewBobbing && game.cameraMode === 0 && !p.flying) {
      const wd = M.lerp(p.prevWalkDist, p.walkDist, pt);
      const amt = M.lerp(p.prevBob, p.bob, pt);
      bobX = Math.sin(wd * Math.PI) * amt * 0.5;
      bobY = -Math.abs(Math.cos(wd * Math.PI) * amt);
      roll = Math.sin(wd * Math.PI) * amt * 0.05;
    }
    // secousse de dégâts
    let hurtRoll = 0;
    if (p.hurtTime > 0) {
      const t = (p.hurtTime - pt) / 10;
      hurtRoll = Math.sin(t * t * t * t * Math.PI) * 0.25 * (p.hurtDir || 1);
    }
    let fov = s.fov;
    if (p.sprinting) fov *= 1.12;
    if (p.flying && p.sprinting) fov *= 1.05;
    if (p.usingItem && p.useItemId === 256 + 17) fov *= 1 - Math.min(1, p.useTicks / 20) * 0.15; // arc
    this.fovCurrent = M.lerp(this.fovCurrent || fov, fov, 0.2);
    const aspect = this.canvas.width / this.canvas.height;
    M.perspective(this.proj, this.fovCurrent * M.DEG, aspect, 0.05, 1000);
    const v = this.view;
    M.identity(v);
    if (roll || hurtRoll) M.rotateZ(v, v, roll + hurtRoll);
    M.rotateX(v, v, -cam.pitch);
    M.rotateY(v, v, -cam.yaw);
    // caméra à la troisième personne
    if (game.cameraMode) {
      const dir = M.lookDir(cam.yaw, cam.pitch);
      const back = game.cameraMode === 1 ? -1 : 1;
      let dist = 4;
      // lancer de rayon pour éviter de traverser les murs
      for (let t = 0.2; t < 4; t += 0.1) {
        const tx = cam.x + dir[0] * t * back, ty = cam.y + dir[1] * t * back, tz = cam.z + dir[2] * t * back;
        const id = game.world.getBlock(Math.floor(tx), Math.floor(ty), Math.floor(tz));
        if (id && BLOCKS[id].opaque && BLOCKS[id].solid) { dist = Math.max(0.3, t - 0.3); break; }
      }
      cam.x += dir[0] * dist * back; cam.y += dir[1] * dist * back; cam.z += dir[2] * dist * back;
      if (game.cameraMode === 2) {
        M.identity(v);
        M.rotateX(v, v, cam.pitch);
        M.rotateY(v, v, -cam.yaw + Math.PI);
      }
    } else {
      M.translate(v, v, -bobX * Math.cos(cam.yaw), -bobY, bobX * Math.sin(cam.yaw));
    }
    M.multiply(this.viewProj, this.proj, v);
    M.invert(this.invViewProj, this.viewProj);
    M.frustumPlanes(this.viewProj, this.frustum);
  }

  // ---------- Rendu principal ----------
  render(pt, dt) {
    const gl = this.gl;
    const game = this.game;
    const world = game.world;
    this.time += dt;
    this.resize();
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.setupCamera(pt);
    const env = game.sky.environment(world, this.cam, pt);
    this.env = env;
    const R = game.settings.renderDistance * 16;
    meshSettings.fancyLeaves = game.settings.fancyLeaves;
    meshSettings.smooth = game.settings.smoothLighting;
    this.updateMeshes(world, 5);

    gl.clearColor(env.fog[0], env.fog[1], env.fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // ciel
    if (!env.underFluid) this.drawSky(env, R);

    // uniformes communs
    const W = this.world;
    gl.useProgram(W.program);
    gl.uniformMatrix4fv(W.u.u_viewProj, false, this.viewProj);
    gl.uniform1f(W.u.u_time, this.time);
    gl.uniform1f(W.u.u_sky, env.skyLight);
    gl.uniform3fv(W.u.u_skyTint, env.skyTint);
    gl.uniform3fv(W.u.u_fogColor, env.fog);
    gl.uniform2f(W.u.u_fog, env.fogStart, env.fogEnd);
    gl.uniform1f(W.u.u_ambient, env.ambient);
    gl.uniform1f(W.u.u_gamma, game.settings.brightness);
    gl.uniform4f(W.u.u_overlay, 0, 0, 0, 0);
    gl.uniform1f(W.u.u_alphaMul, 1);
    gl.uniform1f(W.u.u_fullbright, env.nightVision ? 0.6 : 0);
    gl.uniform1i(W.u.u_tex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.uniform1f(W.u.u_posScale, 1 / 16);
    gl.uniform1f(W.u.u_uvScale, 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.5);

    // passe opaque
    const cam = this.cam;
    const visible = [];
    const pcx = Math.floor(cam.x) >> 4, pcz = Math.floor(cam.z) >> 4;
    const RD = game.settings.renderDistance;
    let drawn = 0;
    for (const c of world.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (dx * dx + dz * dz > (RD + 0.5) * (RD + 0.5)) continue;
      for (let s = 0; s < 8; s++) {
        const m = c.meshes[s];
        if (!m) continue;
        const ox = c.cx * 16 - cam.x, oy = s * 16 - cam.y, oz = c.cz * 16 - cam.z;
        if (!M.boxInFrustum(this.frustum, ox, oy, oz, ox + 16, oy + 16, oz + 16)) continue;
        visible.push({ m, ox, oy, oz, d: (ox + 8) * (ox + 8) + (oy + 8) * (oy + 8) + (oz + 8) * (oz + 8) });
      }
    }
    visible.sort((a, b) => a.d - b.d);
    for (const v of visible) {
      if (!v.m.opaque) continue;
      gl.uniform3f(W.u.u_offset, v.ox, v.oy, v.oz);
      gl.bindVertexArray(v.m.opaque.vao);
      gl.drawElements(gl.TRIANGLES, (v.m.opaque.count / 4) * 6, gl.UNSIGNED_INT, 0);
      drawn++;
    }
    this.stats.drawn = drawn;

    // entités
    this.drawEntities(pt);
    // particules
    if (game.particles) this.drawParticles(pt);

    // passe translucide
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.useProgram(W.program);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.uniform1f(W.u.u_posScale, 1 / 16);
    gl.uniform1f(W.u.u_uvScale, 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.01);
    gl.uniform4f(W.u.u_overlay, 0, 0, 0, 0);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      if (!v.m.trans) continue;
      gl.uniform3f(W.u.u_offset, v.ox, v.oy, v.oz);
      gl.bindVertexArray(v.m.trans.vao);
      gl.drawElements(gl.TRIANGLES, (v.m.trans.count / 4) * 6, gl.UNSIGNED_INT, 0);
    }
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    // pluie / neige
    if (game.weather) this.drawWeather(pt, env);
    gl.disable(gl.BLEND);

    // sélection & fissures
    if (game.target && game.cameraMode === 0 && !game.hideHud) this.drawSelection(game.target);
    // main
    if (game.cameraMode === 0 && !game.hideHud) this.drawHand(pt, env);
    gl.bindVertexArray(null);
  }

  drawSky(env, R) {
    const gl = this.gl;
    const S = this.sky;
    gl.useProgram(S.program);
    gl.uniformMatrix4fv(S.u.u_invVP, false, this.invViewProj);
    gl.uniform3fv(S.u.u_zenith, env.zenith);
    gl.uniform3fv(S.u.u_horizon, env.fog);
    gl.uniform3fv(S.u.u_sunDir, env.sunDir);
    gl.uniform1f(S.u.u_night, env.night);
    gl.uniform1f(S.u.u_sunset, env.sunset);
    gl.uniform1i(S.u.u_dim, env.dim);
    gl.uniform3f(S.u.u_cam, this.cam.x, this.cam.y, this.cam.z);
    gl.uniform1f(S.u.u_time, this.game.time / 20);
    gl.uniform1f(S.u.u_cloudY, 116);
    gl.uniform1f(S.u.u_clouds, this.game.settings.clouds ? 1 : 0);
    gl.uniform1f(S.u.u_rain, env.rain);
    gl.uniform1f(S.u.u_far, R);
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  // ---------- Entités ----------
  drawEntities(pt) {
    const gl = this.gl;
    const game = this.game;
    const world = game.world;
    const buf = this.dyn;
    buf.reset();
    const ranges = [];
    const cam = this.cam;
    const R2 = (game.settings.renderDistance * 16) ** 2;
    for (const e of world.entities) {
      if (e.removed || e.invisible) continue;
      if (e === game.player && game.cameraMode === 0) continue;
      const ex = M.lerp(e.prevX, e.x, pt), ey = M.lerp(e.prevY, e.y, pt), ez = M.lerp(e.prevZ, e.z, pt);
      const dx = ex - cam.x, dy = ey - cam.y, dz = ez - cam.z;
      if (dx * dx + dy * dy + dz * dz > R2) continue;
      const r = Math.max(e.width, e.height) + (e.renderRadius || 0);
      if (!M.boxInFrustum(this.frustum, dx - r, dy - r, dz - r, dx + r, dy + r * 2, dz + r)) continue;
      const bx = Math.floor(ex), by = Math.floor(ey + e.height * 0.5), bz = Math.floor(ez);
      const sky = world.getSky(bx, by, bz) * 17, bl = world.getBlockLight(bx, by, bz) * 17;
      const start = buf.n;
      let kind;
      try {
        kind = e.render ? e.render(this, buf, pt, sky, e.fullbright ? 255 : bl) : null;
      } catch (err) {
        console.error(err);
        kind = null;
      }
      if (!kind || buf.n === start) { buf.n = start; e._heldId = 0; continue; }
      const overlay = e.overlay ? e.overlay(pt) : null;
      ranges.push({ start, count: buf.n - start, kind, ox: dx, oy: dy, oz: dz, overlay, alpha: e.renderAlpha });
      if (e._heldId) {
        const s2 = buf.n;
        this.renderItem(buf, e._heldMat, e._heldId, sky, e.fullbright ? 255 : bl, 0.5);
        if (buf.n > s2) ranges.push({ start: s2, count: buf.n - s2, kind: 'block', ox: dx, oy: dy, oz: dz, overlay });
        e._heldId = 0;
      }
    }
    if (!ranges.length) return;
    this.flushDyn();
    const W = this.world;
    gl.useProgram(W.program);
    gl.uniform1f(W.u.u_posScale, 1 / 256);
    gl.uniform1f(W.u.u_alphaTest, 0.1);
    gl.bindVertexArray(this.dynVao);
    let bound = null;
    for (const r of ranges) {
      const skin = r.kind === 'skin';
      if (bound !== r.kind) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, skin ? this.skinTex : this.blockTex);
        gl.uniform1f(W.u.u_uvScale, skin ? 1 / SKIN_SIZE : 1 / 16);
        bound = r.kind;
      }
      gl.uniform3f(W.u.u_offset, r.ox, r.oy, r.oz);
      const ov = r.overlay;
      if (ov) gl.uniform4f(W.u.u_overlay, ov[0], ov[1], ov[2], ov[3]);
      else gl.uniform4f(W.u.u_overlay, 0, 0, 0, 0);
      if (r.alpha) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(W.u.u_alphaMul, r.alpha); }
      gl.drawElements(gl.TRIANGLES, (r.count / 4) * 6, gl.UNSIGNED_INT, (r.start / 4) * 6 * 4);
      if (r.alpha) { gl.disable(gl.BLEND); gl.uniform1f(W.u.u_alphaMul, 1); }
    }
    gl.uniform4f(W.u.u_overlay, 0, 0, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
  }

  flushDyn() {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.dynVbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.dyn.u8.subarray(0, this.dyn.n * 20), gl.STREAM_DRAW);
    this.ensureIndices(this.dyn.n / 4 + 1);
  }

  // couches de texture des 6 faces d'un bloc (pour les cubes d'objets)
  blockFaceLayers(id, meta = 0) {
    const d = BLOCKS[id];
    const faces = [];
    for (let f = 0; f < 6; f++) {
      let name;
      if (d.render === 'model' && d.boxes) {
        const b = d.boxes(meta, null)[0];
        const spec = b.tex || d.key;
        if (typeof spec === 'string') name = spec;
        else name = f === 4 ? spec.top || spec.side : f === 5 ? spec.bottom || spec.top || spec.side : (f === 0 && spec.front) || spec.side || spec.top;
      } else name = d.texFn(f, meta);
      faces.push(tex(name));
    }
    return faces;
  }

  isCubeItem(id) {
    return id < 256 && (RENDER[id] === R_CUBE || [B.chest, B.enchanting_table, B.end_portal_frame, B.farmland, B.dirt_path, B.stone_slab, B.oak_slab, B.cactus, B.ender_chest, B.dragon_egg].includes(id));
  }

  // Rend un objet (pile) : cube pour les blocs pleins, sprite sinon
  renderItem(buf, mat, id, sky, bl, size = 0.25, meta = 0) {
    const d = ITEMS[id];
    if (!d) return;
    const bd = id < 256 ? BLOCKS[id] : null;
    if (bd && (RENDER[id] === R_CUBE || (bd.render === 'model' && !d.icon && !bd.hidden && [B.chest, B.enchanting_table, B.end_portal_frame, B.farmland, B.dirt_path, B.stone_slab, B.oak_slab, B.cactus, B.ender_chest, B.dragon_egg].includes(id)))) {
      const tint = bd.tint === 'grass' || bd.tint === 'foliage' ? [120, 190, 80] : bd.tint === 'birch' ? [128, 167, 85] : bd.tint === 'spruce' ? [97, 153, 97] : [255, 255, 255];
      const layers = this.blockFaceLayers(id, meta);
      if (id === B.grass_block) {
        renderBlockCube(buf, mat, layers, sky, bl, size, [255, 255, 255]);
        return;
      }
      renderBlockCube(buf, mat, layers, sky, bl, size, tint);
      return;
    }
    let layer;
    let color = [255, 255, 255];
    if (bd && (RENDER[id] === R_CROSS || RENDER[id] === R_CROP || bd.render === 'model')) {
      layer = tex(bd.texFn ? bd.texFn(0, 0) : bd.key);
      if (bd.tint === 'grass') color = [120, 190, 80];
      if (bd.render === 'model' && bd.boxes) {
        const b = bd.boxes(0, null)[0];
        const spec = b.tex || bd.key;
        layer = tex(typeof spec === 'string' ? spec : spec.side || spec.top);
      }
      if (id === B.torch) layer = tex('torch');
    } else {
      layer = tex('item_' + (d.icon || d.key));
      if (d.colors) color = [255, 255, 255];
    }
    renderSprite(buf, mat, layer, sky, bl, size * 1.6, color);
  }

  // ---------- Particules ----------
  drawParticles(pt) {
    const ps = this.game.particles;
    if (!ps.list.length) return;
    const gl = this.gl;
    const buf = this.dyn;
    buf.reset();
    const cam = this.cam;
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw), cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    // vecteurs droite / haut de la caméra
    const rx = cy, rz = -sy;
    const ux = sy * sp, uy = cp, uz = cy * sp;
    ps.build(buf, pt, cam, [rx, 0, rz], [ux, uy, uz]);
    if (!buf.n) return;
    this.flushDyn();
    const W = this.world;
    gl.useProgram(W.program);
    gl.uniform3f(W.u.u_offset, 0, 0, 0);
    gl.uniform1f(W.u.u_posScale, 1 / 256);
    gl.uniform1f(W.u.u_uvScale, 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.1);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.dynVao);
    gl.drawElements(gl.TRIANGLES, (buf.n / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.disable(gl.BLEND);
  }

  drawWeather(pt, env) {
    const w = this.game.weather;
    if (!w || w.strength < 0.05 || !this.game.world.hasSky) return;
    const gl = this.gl;
    const buf = this.dyn;
    buf.reset();
    const cam = this.cam;
    const world = this.game.world;
    const t = this.time;
    const cx = Math.floor(cam.x), cz = Math.floor(cam.z);
    const rainL = tex('particle_rain'), snowL = tex('particle_snow');
    const R = 10;
    for (let x = cx - R; x <= cx + R; x++)
      for (let z = cz - R; z <= cz + R; z++) {
        const dx = x + 0.5 - cam.x, dz = z + 0.5 - cam.z;
        if (dx * dx + dz * dz > R * R) continue;
        const h = (x * 73856093) ^ (z * 19349663);
        if ((h & 3) === 0 && w.strength < 0.6) continue;
        // hauteur du sol (précipitations bloquées)
        let top = -1;
        const c = world.getChunk(x >> 4, z >> 4);
        if (!c) continue;
        for (let y = Math.min(127, Math.floor(cam.y) + 20); y > 0; y--) {
          const id = c.blocks[(y << 8) | ((z & 15) << 4) | (x & 15)];
          if (id && BLOCKS[id].solid || (id && BLOCKS[id].liquid)) { top = y + 1; break; }
        }
        const y0 = Math.max(top, cam.y - 10), y1 = cam.y + 12;
        if (y1 <= y0) continue;
        const biome = c.biome[((z & 15) << 4) | (x & 15)];
        const snow = biome === 5 || biome === 12 || biome === 9 || (biome === 7 && top > 95);
        if (biome === 6) continue;
        const layer = snow ? snowL : rainL;
        const speed = snow ? 1.5 : 12;
        const off = ((t * speed + (h & 255) / 25) % 4);
        const sky = world.getSky(x, Math.floor(y0), z) * 17;
        // quad vertical orienté vers la caméra
        const len = Math.hypot(dx, dz) || 1;
        const px = -dz / len * 0.5, pz = dx / len * 0.5;
        const ox = x + 0.5 - cam.x, oz = z + 0.5 - cam.z;
        const vy0 = (y0 - cam.y), vy1 = (y1 - cam.y);
        const v0 = (vy1 - vy0) * 4 + off * 16, v1 = off * 16;
        buf.v(Math.round((ox - px) * 256), Math.round(vy0 * 256), Math.round((oz - pz) * 256), 0, Math.min(255, v0 % 256), layer, sky, 0, 255, 255, 255, 255, 0);
        buf.v(Math.round((ox + px) * 256), Math.round(vy0 * 256), Math.round((oz + pz) * 256), 16, Math.min(255, v0 % 256), layer, sky, 0, 255, 255, 255, 255, 0);
        buf.v(Math.round((ox + px) * 256), Math.round(vy1 * 256), Math.round((oz + pz) * 256), 16, v1 % 256, layer, sky, 0, 255, 255, 255, 255, 0);
        buf.v(Math.round((ox - px) * 256), Math.round(vy1 * 256), Math.round((oz - pz) * 256), 0, v1 % 256, layer, sky, 0, 255, 255, 255, 255, 0);
      }
    if (!buf.n) return;
    this.flushDyn();
    const W = this.world;
    gl.useProgram(W.program);
    gl.uniform3f(W.u.u_offset, 0, 0, 0);
    gl.uniform1f(W.u.u_posScale, 1 / 256);
    gl.uniform1f(W.u.u_uvScale, 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.05);
    gl.uniform1f(W.u.u_alphaMul, Math.min(1, w.strength) * 0.8);
    gl.depthMask(false);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.dynVao);
    gl.drawElements(gl.TRIANGLES, (buf.n / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.depthMask(true);
    gl.uniform1f(W.u.u_alphaMul, 1);
  }

  // ---------- Sélection & fissures ----------
  drawSelection(t) {
    const gl = this.gl;
    const world = this.game.world;
    const boxes = selectionBoxes(t.id, world.getMeta(t.x, t.y, t.z), (dx, dy, dz) => world.getBlock(t.x + dx, t.y + dy, t.z + dz));
    if (!boxes || !boxes.length) return;
    const lines = [];
    const e = 0.002;
    for (const b of boxes) {
      const x0 = b.x0 / 16 - e, y0 = b.y0 / 16 - e, z0 = b.z0 / 16 - e, x1 = b.x1 / 16 + e, y1 = b.y1 / 16 + e, z1 = b.z1 / 16 + e;
      const c = [[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], [x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]];
      const E = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b2] of E) lines.push(...c[a], ...c[b2]);
    }
    const L = this.line;
    gl.useProgram(L.program);
    gl.uniformMatrix4fv(L.u.u_viewProj, false, this.viewProj);
    gl.uniform3f(L.u.u_offset, t.x - this.cam.x, t.y - this.cam.y, t.z - this.cam.z);
    gl.uniform4f(L.u.u_color, 0, 0, 0, 0.6);
    gl.bindVertexArray(this.lineVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.lineVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(lines), gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.LINES, 0, lines.length / 3);
    gl.disable(gl.BLEND);
    // fissures
    const prog = this.game.breakProgress;
    if (prog > 0) {
      const stage = Math.min(9, Math.floor(prog * 10));
      const layer = tex('destroy_' + stage);
      const buf = this.dyn;
      buf.reset();
      const mat = M.mat4();
      for (const b of boxes) {
        const sx = (b.x1 - b.x0) / 16, sy = (b.y1 - b.y0) / 16, sz = (b.z1 - b.z0) / 16;
        M.identity(mat);
        M.translate(mat, mat, (b.x0 + b.x1) / 32, (b.y0 + b.y1) / 32, (b.z0 + b.z1) / 32);
        M.scale(mat, mat, sx * 1.006, sy * 1.006, sz * 1.006);
        renderBlockCube(buf, mat, [layer, layer, layer, layer, layer, layer], 255, 255, 1, [255, 255, 255], true);
      }
      this.flushDyn();
      const W = this.world;
      gl.useProgram(W.program);
      gl.uniform3f(W.u.u_offset, t.x - this.cam.x, t.y - this.cam.y, t.z - this.cam.z);
      gl.uniform1f(W.u.u_posScale, 1 / 256);
      gl.uniform1f(W.u.u_uvScale, 1 / 16);
      gl.uniform1f(W.u.u_alphaTest, 0.01);
      gl.uniform1f(W.u.u_fullbright, 1);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.DST_COLOR, gl.SRC_COLOR);
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-1, -1);
      gl.depthMask(false);
      gl.bindVertexArray(this.dynVao);
      gl.drawElements(gl.TRIANGLES, (buf.n / 4) * 6, gl.UNSIGNED_INT, 0);
      gl.depthMask(true);
      gl.disable(gl.POLYGON_OFFSET_FILL);
      gl.disable(gl.BLEND);
      gl.uniform1f(W.u.u_fullbright, 0);
    }
  }

  // ---------- Main à la première personne ----------
  drawHand(pt, env) {
    const gl = this.gl;
    const game = this.game;
    const p = game.player;
    if (p.sleeping || p.dead) return;
    const buf = this.dyn;
    buf.reset();
    const world = game.world;
    const bx = Math.floor(p.x), by = Math.floor(p.y + 1), bz = Math.floor(p.z);
    const sky = world.getSky(bx, by, bz) * 17, bl = world.getBlockLight(bx, by, bz) * 17;
    const stack = p.inventory.selected();
    const swing = p.getSwing(pt);
    const equip = M.lerp(p.prevEquip, p.equip, pt);
    const mat = M.mat4();
    const wd = M.lerp(p.prevWalkDist, p.walkDist, pt);
    const bobAmt = game.settings.viewBobbing ? M.lerp(p.prevBob, p.bob, pt) : 0;
    const sw = Math.sin(swing * Math.PI), sw2 = Math.sin(Math.sqrt(swing) * Math.PI);
    M.identity(mat);
    M.translate(mat, mat, Math.sin(wd * Math.PI) * bobAmt * 0.5, -Math.abs(Math.cos(wd * Math.PI) * bobAmt), 0);
    let kind = 'block';
    if (stack) {
      const d = ITEMS[stack.id];
      const isBlock = stack.id < 256 && RENDER[stack.id] === R_CUBE;
      M.translate(mat, mat, 0.56 - sw2 * 0.4 * 0.3, -0.52 - (1 - equip) * 0.6 + Math.sin(swing * Math.PI * 2) * 0.2 * 0.3, -0.72 - sw * 0.2);
      // animation de consommation / arc
      if (p.usingItem && d && d.food) {
        const t = p.useTicks + pt;
        M.translate(mat, mat, -0.3, Math.abs(Math.cos(t / 4 * Math.PI) * 0.1) + 0.1, 0.1);
      }
      if (p.usingItem && stack.id === 256 + 17) M.translate(mat, mat, -0.2, 0.1, 0.1);
      M.rotateY(mat, mat, 0.785 - sw2 * 0.35);
      M.rotateZ(mat, mat, -sw2 * 0.35);
      M.rotateX(mat, mat, -sw * 1.3);
      if (isBlock) {
        M.translate(mat, mat, 0.08, -0.02, -0.22);
        M.scale(mat, mat, 0.3, 0.3, 0.3);
        this.renderItem(buf, mat, stack.id, sky, bl, 1, 0);
      } else {
        M.rotateY(mat, mat, -1.2);
        M.rotateZ(mat, mat, 0.3);
        M.scale(mat, mat, 0.55, 0.55, 0.55);
        this.renderItem(buf, mat, stack.id, sky, bl, 0.6, 0);
      }
    } else {
      kind = 'skin';
      M.translate(mat, mat, 0.62 - sw2 * 0.25, -0.78 - (1 - equip) * 0.6 + Math.sin(swing * Math.PI * 2) * 0.12, -0.55 - sw * 0.25);
      M.rotateY(mat, mat, 0.35 - sw2 * 0.4);
      M.rotateX(mat, mat, 2.05 - sw * 0.7);
      M.rotateZ(mat, mat, 0.12);
      const m = MODELS.player;
      renderModel(buf, m, mat, { parts: {}, hidden: new Set(['head', 'body', 'larm', 'rleg', 'lleg']), offsets: { rarm: [5, -22, 0] } }, sky, bl);
    }
    if (!buf.n) return;
    this.flushDyn();
    const proj = M.mat4();
    M.perspective(proj, 70 * M.DEG, this.canvas.width / this.canvas.height, 0.01, 10);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    const W = this.world;
    gl.useProgram(W.program);
    gl.uniformMatrix4fv(W.u.u_viewProj, false, proj);
    gl.uniform3f(W.u.u_offset, 0, 0, 0);
    gl.uniform1f(W.u.u_posScale, 1 / 256);
    gl.uniform1f(W.u.u_uvScale, kind === 'skin' ? 1 / SKIN_SIZE : 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.1);
    gl.uniform2f(W.u.u_fog, 1000, 2000);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, kind === 'skin' ? this.skinTex : this.blockTex);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(this.dynVao);
    gl.drawElements(gl.TRIANGLES, (buf.n / 4) * 6, gl.UNSIGNED_INT, 0);
    gl.enable(gl.CULL_FACE);
    gl.uniformMatrix4fv(W.u.u_viewProj, false, this.viewProj);
    gl.uniform2f(W.u.u_fog, env.fogStart, env.fogEnd);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
  }
}
