// Moteur de rendu WebGL2
import * as M from '../core/math.js';
import { createProgram, createTextureArray, setupVertexAttribs } from './gl.js';
import { WORLD_VS, WORLD_FS, SKY_VS, SKY_FS, LINE_VS, LINE_FS } from './shaders.js';
import { buildTextures, tex, TEX_SIZE } from './textures.js';
import { buildSkins, SKIN_SIZE, MODELS, renderModel, renderBlockCube, renderSprite } from './models.js';
import { buildSection, gatherSection, GeoBuffer, meshSettings, PAIR_BIT, VIS_ALL } from './mesher.js';
import { chunkKey } from '../core/constants.js';
import { ST_LIT } from '../world/chunk.js';
import { BLOCKS, OPAQUE, selectionBoxes, RENDER, R_CUBE, R_CROSS, R_CROP } from '../data/blocks.js';
import { ITEMS } from '../data/items.js';
import { B } from '../data/ids.js';
import { Fancy } from './fancy.js';

// Directions des faces (N, S, O, E, haut, bas) et face opposée
const DIRX = [0, 0, -1, 1, 0, 0];
const DIRY = [0, 0, 0, 0, 1, -1];
const DIRZ = [-1, 1, 0, 0, 0, 0];
const OPP = [1, 0, 3, 2, 5, 4];

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
    // géométrie des entités (conservée pour la passe d'ombres)
    this.ent = new GeoBuffer(8192);
    this.entVbo = gl.createBuffer();
    this.entVao = gl.createVertexArray();
    gl.bindVertexArray(this.entVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.entVbo);
    setupVertexAttribs(gl);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.indexBuf);
    gl.bindVertexArray(null);
    this.entRanges = [];
    this.W = this.world;
    this.meshSeq = 0;
    this.meshInflight = 0;
    this.changedChunks = []; // chunks remaillés depuis la dernière passe d'ombres
    this.meshResults = []; // maillages reçus des workers, à envoyer à la carte graphique
    this.meshQ = [];
    this.visList = [];
    this.visPool = [];
    this.visFrame = 0;
    this.fancy = null;
    this.fancyError = null;

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
    // taille CSS relue seulement après un redimensionnement (évite une mise en page forcée par image)
    if (!this.sizeObs) {
      this.cssW = this.canvas.clientWidth; this.cssH = this.canvas.clientHeight;
      this.sizeObs = true;
      const upd = () => { this.cssW = this.canvas.clientWidth; this.cssH = this.canvas.clientHeight; };
      if (typeof ResizeObserver !== 'undefined') new ResizeObserver(upd).observe(this.canvas);
      else window.addEventListener('resize', upd);
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * (s.resolution || 1) * (this.dynScale || 1);
    const w = Math.max(1, Math.floor(this.cssW * dpr)), h = Math.max(1, Math.floor(this.cssH * dpr));
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

  // Remaillage des sections modifiées : dans les workers, sauf à côté du joueur (réactivité)
  // Applique les maillages reçus des workers, les plus proches d'abord, dans un budget de temps
  applyMeshResults(world, budgetMs) {
    const q = this.meshResults;
    if (!q.length) return;
    const t0 = performance.now();
    const pcx = Math.floor(this.cam.x) >> 4, pcz = Math.floor(this.cam.z) >> 4;
    if (q.length > 1) q.sort((a, b) => (Math.abs(a.c.cx - pcx) + Math.abs(a.c.cz - pcz)) - (Math.abs(b.c.cx - pcx) + Math.abs(b.c.cz - pcz)));
    let k = 0;
    while (k < q.length) {
      const j = q[k++];
      if (j.world === world && world.chunks.get(chunkKey(j.c.cx, j.c.cz)) === j.c) this.applyMesh(j.c, j.s, j.r, j.seq);
      if (performance.now() - t0 > budgetMs) break;
    }
    q.splice(0, k);
  }

  updateMeshes(world, budgetMs) {
    this.applyMeshResults(world, 3);
    const t0 = performance.now();
    const pool = this.game.workers && this.game.workers.ok ? this.game.workers : null;
    const pcx = Math.floor(this.cam.x) >> 4, pcz = Math.floor(this.cam.z) >> 4;
    const R = this.game.settings.renderDistance;
    const q = this.meshQ;
    q.length = 0;
    for (const c of world.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const d = c.dirty;
      if (!(d[0] | d[1] | d[2] | d[3] | d[4] | d[5] | d[6] | d[7])) continue;
      if (!this.canMesh(world, c)) continue;
      c._d = dx * dx + dz * dz;
      q.push(c);
    }
    q.sort((a, b) => a._d - b._d);
    const maxInflight = pool ? pool.workers.length * 8 : 0;
    const opts = { fancyLeaves: meshSettings.fancyLeaves, smooth: meshSettings.smooth };
    const camSy = Math.floor(this.cam.y) >> 4;
    let n = 0, sync = 0;
    outer:
    for (const c of q) {
      for (let s = 0; s < 8; s++) {
        if (!c.dirty[s]) continue;
        if (!c.sectionHasBlocks[s]) {
          c.dirty[s] = 0;
          c.meshSeq[s] = ++this.meshSeq;
          this.setMesh(c, s, null);
          c.vis[s] = VIS_ALL;
          continue;
        }
        const near = c._d <= 2 && Math.abs(s - camSy) <= 1;
        if (!pool || (near && sync < 6)) {
          c.dirty[s] = 0;
          this.applyMesh(c, s, buildSection(world, c, s), ++this.meshSeq);
          sync++;
          n++;
          if (!pool && c._d > 2 && performance.now() - t0 > budgetMs) break outer;
          continue;
        }
        if (this.meshInflight >= maxInflight) break outer;
        c.dirty[s] = 0;
        const g = gatherSection(world, c, s);
        const seq = ++this.meshSeq;
        const msg = {
          type: 'mesh', ids: g.ids.slice(), metas: g.metas.slice(), lights: g.lights.slice(),
          tint: c.tint, biome: c.biome, cx: c.cx, cz: c.cz, sy: s, opts,
        };
        this.meshInflight++;
        pool.run(msg, [msg.ids.buffer, msg.metas.buffer, msg.lights.buffer], (r) => {
          this.meshInflight--;
          // envoyé à la carte graphique plus tard, dans le budget de l'image (pas de rafale)
          this.meshResults.push({ world, c, s, r, seq });
        }, 0, () => { this.meshInflight--; c.dirty[s] = 1; });
        n++;
        if (performance.now() - t0 > budgetMs) break outer;
      }
    }
    this.stats.meshedThisFrame = n;
    return n;
  }

  // Applique un maillage (sauf s'il est plus ancien que celui déjà affiché)
  applyMesh(c, s, res, seq) {
    if (seq < c.meshSeq[s]) return;
    c.meshSeq[s] = seq;
    const m = {};
    if (res.opaque) m.opaque = this.uploadMesh(res.opaque);
    if (res.trans) m.trans = this.uploadMesh(res.trans);
    this.setMesh(c, s, m.opaque || m.trans ? m : null);
    c.vis[s] = res.vis ?? VIS_ALL;
  }

  setMesh(c, s, m) {
    const old = c.meshes[s];
    if (old) { this.freeMeshPart(old.opaque); this.freeMeshPart(old.trans); }
    c.meshes[s] = m;
    if (this.changedChunks.length < 4096) this.changedChunks.push(c);
  }

  // ---------- Sections visibles ----------
  // Parcours en largeur depuis la section de la caméra, à travers les faces connectées
  // (algorithme de Minecraft) : les grottes cachées sous le sol ne sont pas dessinées.
  collectVisible(world) {
    const cam = this.cam;
    const RD = this.game.settings.renderDistance;
    const list = this.visList;
    list.length = 0;
    let used = 0;
    const push = (m, ox, oy, oz, d) => {
      let v = this.visPool[used];
      if (!v) { v = {}; this.visPool[used] = v; }
      used++;
      v.m = m; v.ox = ox; v.oy = oy; v.oz = oz; v.d = d;
      list.push(v);
    };
    const pcx = Math.floor(cam.x) >> 4, pcz = Math.floor(cam.z) >> 4;
    const eye = world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    const cull = this.game.settings.caveCulling !== false && cam.y >= 0 && cam.y < 128 && !OPAQUE[eye] && world.getChunk(pcx, pcz);
    this.cullActive = !!cull;
    if (!cull) {
      // repli : frustum seul, tri par distance
      for (const c of world.chunks.values()) {
        const dx = c.cx - pcx, dz = c.cz - pcz;
        if (dx * dx + dz * dz > (RD + 0.5) * (RD + 0.5)) continue;
        for (let s = 0; s < 8; s++) {
          const m = c.meshes[s];
          if (!m) continue;
          const ox = c.cx * 16 - cam.x, oy = s * 16 - cam.y, oz = c.cz * 16 - cam.z;
          if (!M.boxInFrustum(this.frustum, ox, oy, oz, ox + 16, oy + 16, oz + 16)) continue;
          push(m, ox, oy, oz, (ox + 8) * (ox + 8) + (oy + 8) * (oy + 8) + (oz + 8) * (oz + 8));
        }
      }
      list.sort((a, b) => a.d - b.d);
      return list;
    }
    const half = RD + 1, G = half * 2 + 1, N = G * G * 8;
    if (!this.visStamp || this.visStamp.length < N) {
      this.visStamp = new Int32Array(N);
      this.visQ = new Int32Array(N);
      this.visFrom = new Int8Array(N);
      this.visMask = new Uint8Array(N);
      this.visCols = new Array(G * G);
    }
    this.visG = G; this.visHalf = half; this.visPcx = pcx; this.visPcz = pcz;
    const stamp = this.visStamp, Q = this.visQ, FROM = this.visFrom, MASK = this.visMask, cols = this.visCols;
    for (let i = 0; i < G; i++) for (let j = 0; j < G; j++) cols[i * G + j] = world.getChunk(pcx + i - half, pcz + j - half) || null;
    const frame = ++this.visFrame;
    const lim = (RD + 0.5) * (RD + 0.5);
    const sy0 = Math.floor(cam.y) >> 4;
    const start = ((half * G) + half) * 8 + sy0;
    stamp[start] = frame;
    Q[0] = start; FROM[0] = -1; MASK[0] = 0;
    let head = 0, tail = 1;
    const fr = this.frustum;
    while (head < tail) {
      const idx = Q[head], from = FROM[head], mask = MASK[head];
      head++;
      const sy = idx & 7, col = idx >> 3;
      const gi = (col / G) | 0, gj = col - gi * G;
      const c = cols[col];
      const ox = (pcx + gi - half) * 16 - cam.x, oy = sy * 16 - cam.y, oz = (pcz + gj - half) * 16 - cam.z;
      let vis = VIS_ALL;
      if (c) {
        const m = c.meshes[sy];
        if (m) push(m, ox, oy, oz, 0);
        vis = c.vis[sy];
      }
      for (let d = 0; d < 6; d++) {
        if (mask & (1 << OPP[d])) continue;
        if (from >= 0 && vis !== VIS_ALL && !(vis & PAIR_BIT[from * 6 + d])) continue;
        const ni = gi + DIRX[d], nj = gj + DIRZ[d], ny = sy + DIRY[d];
        if (ny < 0 || ny > 7 || ni < 0 || nj < 0 || ni >= G || nj >= G) continue;
        const rx = ni - half, rz = nj - half;
        if (rx * rx + rz * rz > lim) continue;
        const nidx = (ni * G + nj) * 8 + ny;
        if (stamp[nidx] === frame) continue;
        stamp[nidx] = frame;
        const bx = ox + DIRX[d] * 16, by = oy + DIRY[d] * 16, bz = oz + DIRZ[d] * 16;
        if (!M.boxInFrustum(fr, bx, by, bz, bx + 16, by + 16, bz + 16)) continue;
        Q[tail] = nidx; FROM[tail] = OPP[d]; MASK[tail] = mask | (1 << d);
        tail++;
      }
    }
    return list;
  }

  // La section contenant ce point a-t-elle été atteinte par le parcours de visibilité ?
  sectionSeen(x, y, z) {
    if (!this.cullActive || y < 0 || y >= 128) return true;
    const gi = (Math.floor(x) >> 4) - this.visPcx + this.visHalf, gj = (Math.floor(z) >> 4) - this.visPcz + this.visHalf;
    const G = this.visG;
    if (gi < 0 || gj < 0 || gi >= G || gj >= G) return true;
    return this.visStamp[(gi * G + gj) * 8 + (Math.floor(y) >> 4)] === this.visFrame;
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
    if (game.zooming) fov = s.fov * 0.25;
    this.fovCurrent = M.lerp(this.fovCurrent || fov, fov, game.zooming ? 0.3 : 0.2);
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
  // Mode shader disponible et activé ?
  useFancy() {
    const s = this.game.settings;
    if (!s.shaders || this.fancyError) return false;
    if (!this.fancy) {
      try {
        this.fancy = new Fancy(this);
      } catch (e) {
        console.warn(e);
        this.fancyError = e.message;
        this.game.ui?.chat?.('Mode shader indisponible : ' + e.message, '#f55');
        return false;
      }
    }
    return true;
  }

  // Résolution dynamique : baisse la résolution de rendu quand les images ralentissent
  adaptResolution(dt) {
    const s = this.game.settings;
    if (!s.dynamicRes) { this.dynScale = 1; return; }
    if (!this.dynScale) { this.dynScale = 1; this.dynDts = []; this.dynT = 0; this.dynGood = 0; this.dynBad = 0; }
    this.dynDts.push(dt);
    this.dynT += dt;
    if (this.dynT < 1) return;
    const a = this.dynDts.sort((x, y) => x - y);
    const fps = 1 / a[a.length >> 1];
    this.dynDts.length = 0;
    this.dynT = 0;
    // changement de taille rare (il coûte une réallocation) : 3 s lentes pour baisser, 8 s fluides pour remonter
    if (fps < 38) { this.dynGood = 0; if (++this.dynBad >= 3 && this.dynScale > 0.5) { this.dynScale = Math.max(0.5, this.dynScale - 0.15); this.dynBad = 0; } }
    else if (fps > 56 && this.dynScale < 1) { this.dynBad = 0; if (++this.dynGood >= 8) { this.dynScale = Math.min(1, this.dynScale + 0.15); this.dynGood = 0; } }
    else { this.dynGood = 0; this.dynBad = 0; }
  }

  render(pt, dt) {
    const gl = this.gl;
    const game = this.game;
    const world = game.world;
    this.time += dt;
    this.pt = pt;
    if (dt > 0) this.adaptResolution(dt);
    this.resize();
    this.setupCamera(pt);
    const env = game.sky.environment(world, this.cam, pt);
    this.env = env;
    const R = game.settings.renderDistance * 16;
    meshSettings.fancyLeaves = game.settings.fancyLeaves;
    meshSettings.smooth = game.settings.smoothLighting;
    this.updateMeshes(world, 5);
    const fancy = this.useFancy() ? this.fancy : null;
    const cam = this.cam;
    const visible = this.collectVisible(world);
    this.buildEntities(pt);

    if (fancy) {
      fancy.computeLight(env, game);
      fancy.ensureTargets(this.canvas.width, this.canvas.height);
      if (game.settings.shaderShadows && env.dim !== 1) fancy.shadowPass(world, cam);
      else { fancy.lastShadow = -1; this.changedChunks.length = 0; }
      fancy.bindScene();
      this.W = fancy.world;
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      this.W = this.world;
      this.changedChunks.length = 0;
    }
    const W = this.W;
    gl.useProgram(W.program);
    if (fancy) fancy.setWorldUniforms(W, env, cam);
    const fog = fancy ? fancy.fogLin : env.fog;
    gl.clearColor(fog[0], fog[1], fog[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    // ciel
    if (!env.underFluid) {
      if (fancy) fancy.drawSky(env, R, cam);
      else this.drawSky(env, R);
    }

    // uniformes communs
    gl.useProgram(W.program);
    gl.uniformMatrix4fv(W.u.u_viewProj, false, this.viewProj);
    gl.uniform1f(W.u.u_time, this.time);
    gl.uniform1f(W.u.u_sky, env.skyLight);
    gl.uniform3fv(W.u.u_skyTint, env.skyTint);
    if (!fancy) gl.uniform3fv(W.u.u_fogColor, env.fog);
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

    // passe opaque (ordre du parcours : de l'avant vers l'arrière)
    let drawn = 0;
    for (const v of visible) {
      if (!v.m.opaque) continue;
      gl.uniform3f(W.u.u_offset, v.ox, v.oy, v.oz);
      gl.bindVertexArray(v.m.opaque.vao);
      gl.drawElements(gl.TRIANGLES, (v.m.opaque.count / 4) * 6, gl.UNSIGNED_INT, 0);
      drawn++;
    }
    this.stats.drawn = drawn;

    // entités
    this.drawEntities();
    // copie de la scène opaque pour l'eau (réfraction / réflexions)
    if (fancy) {
      fancy.copyScene();
      gl.useProgram(W.program);
    }
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
    if (fancy) gl.uniform1f(W.u.u_waterPass, 1);
    gl.disable(gl.CULL_FACE);
    for (let i = visible.length - 1; i >= 0; i--) {
      const v = visible[i];
      if (!v.m.trans) continue;
      gl.uniform3f(W.u.u_offset, v.ox, v.oy, v.oz);
      gl.bindVertexArray(v.m.trans.vao);
      gl.drawElements(gl.TRIANGLES, (v.m.trans.count / 4) * 6, gl.UNSIGNED_INT, 0);
    }
    if (fancy) gl.uniform1f(W.u.u_waterPass, 0);
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
    if (fancy) fancy.post(env, cam, dt);
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
  // Construit la géométrie de toutes les entités visibles (réutilisée par la passe d'ombres)
  buildEntities(pt) {
    const gl = this.gl;
    const game = this.game;
    const world = game.world;
    const buf = this.ent;
    buf.reset();
    const ranges = [];
    const cam = this.cam;
    const R2 = (game.settings.renderDistance * 16) ** 2;
    for (const e of world.entities) {
      if (e.removed || e.invisible) continue;
      if (e === game.player && game.cameraMode === 0) continue;
      const ex = M.lerp(e.prevX, e.x, pt), ey = M.lerp(e.prevY, e.y, pt), ez = M.lerp(e.prevZ, e.z, pt);
      const dx = ex - cam.x, dy = ey - cam.y, dz = ez - cam.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 > R2 || (d2 > 64 * 64 && !e.renderRadius)) continue;
      const r = Math.max(e.width, e.height) + (e.renderRadius || 0);
      let inView = M.boxInFrustum(this.frustum, dx - r, dy - r, dz - r, dx + r, dy + r * 2, dz + r);
      if (inView && dx * dx + dz * dz > 64 && !this.sectionSeen(ex, ey + e.height * 0.5, ez)) inView = false;
      // hors champ : gardée seulement si proche (son ombre peut être visible)
      if (!inView && dx * dx + dz * dz > 32 * 32) continue;
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
      ranges.push({ start, count: buf.n - start, kind, ox: dx, oy: dy, oz: dz, overlay, alpha: e.renderAlpha, inView });
      if (e._heldId) {
        const s2 = buf.n;
        this.renderItem(buf, e._heldMat, e._heldId, sky, e.fullbright ? 255 : bl, 0.5);
        if (buf.n > s2) ranges.push({ start: s2, count: buf.n - s2, kind: 'block', ox: dx, oy: dy, oz: dz, overlay, inView });
        e._heldId = 0;
      }
    }
    this.entRanges = ranges;
    if (!ranges.length) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.entVbo);
    gl.bufferData(gl.ARRAY_BUFFER, buf.u8.subarray(0, buf.n * 20), gl.STREAM_DRAW);
    this.ensureIndices(buf.n / 4 + 1);
  }

  // Dessine les entités avec le programme donné (rendu normal ou passe d'ombres)
  drawEntityRanges(P, shadow = false) {
    const ranges = this.entRanges;
    if (!ranges.length) return;
    const gl = this.gl;
    gl.uniform1f(P.u.u_posScale, 1 / 256);
    gl.uniform1f(P.u.u_alphaTest, shadow ? 0.5 : 0.1);
    gl.bindVertexArray(this.entVao);
    let bound = null;
    for (const r of ranges) {
      if (shadow ? r.alpha : !r.inView) continue;
      const skin = r.kind === 'skin';
      if (bound !== r.kind) {
        gl.bindTexture(gl.TEXTURE_2D_ARRAY, skin ? this.skinTex : this.blockTex);
        gl.uniform1f(P.u.u_uvScale, skin ? 1 / SKIN_SIZE : 1 / 16);
        bound = r.kind;
      }
      gl.uniform3f(P.u.u_offset, r.ox, r.oy, r.oz);
      if (!shadow) {
        const ov = r.overlay;
        if (ov) gl.uniform4f(P.u.u_overlay, ov[0], ov[1], ov[2], ov[3]);
        else gl.uniform4f(P.u.u_overlay, 0, 0, 0, 0);
        if (r.alpha) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.uniform1f(P.u.u_alphaMul, r.alpha); }
      }
      gl.drawElements(gl.TRIANGLES, (r.count / 4) * 6, gl.UNSIGNED_INT, (r.start / 4) * 6 * 4);
      if (!shadow && r.alpha) { gl.disable(gl.BLEND); gl.uniform1f(P.u.u_alphaMul, 1); }
    }
    if (!shadow) gl.uniform4f(P.u.u_overlay, 0, 0, 0, 0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.blockTex);
  }

  drawEntities() {
    const W = this.W;
    this.gl.useProgram(W.program);
    this.drawEntityRanges(W, false);
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
    const W = this.W;
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
    const W = this.W;
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
      const W = this.W;
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
    const W = this.W;
    gl.useProgram(W.program);
    gl.uniformMatrix4fv(W.u.u_viewProj, false, proj);
    gl.uniform3f(W.u.u_offset, 0, 0, 0);
    gl.uniform1f(W.u.u_posScale, 1 / 256);
    gl.uniform1f(W.u.u_uvScale, kind === 'skin' ? 1 / SKIN_SIZE : 1 / 16);
    gl.uniform1f(W.u.u_alphaTest, 0.1);
    gl.uniform2f(W.u.u_fog, 1000, 2000);
    if (W !== this.world) { gl.uniform1f(W.u.u_shadowOn, 0); gl.uniform1f(W.u.u_haze, 0); }
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
