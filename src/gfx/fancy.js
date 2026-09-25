// Mode shader : rendu HDR hors écran, ombres du soleil, eau réfléchissante,
// ciel et nuages volumétriques, bloom, rayons crépusculaires, adaptation de l'œil.
import * as M from '../core/math.js';
import { createProgram } from './gl.js';
import { SKY_VS } from './shaders.js';
import { FWORLD_VS, FWORLD_FS, SHADOW_VS, SHADOW_FS, FSKY_FS, FULL_VS, BLOOM_DOWN_FS, BLOOM_UP_FS, COMPOSITE_FS } from './fancy_shaders.js';
import { dayFactor } from './sky.js';

const lin = (c) => c.map((v) => Math.pow(v, 2.2));
const smooth = (a, b, x) => { const t = M.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const TILT = 0.4; // inclinaison de la course du soleil (ombres plus intéressantes)
const SHADOW_SIZES = [1024, 2048, 4096];

// Réglages appliqués par chaque préréglage
export const SHADER_PRESETS = [
  null,
  { shaderShadows: true, shaderShadowQuality: 0, shaderShadowDist: 48, shaderWaving: true, shaderWater: false, shaderBloom: true, shaderGodrays: false },
  { shaderShadows: true, shaderShadowQuality: 1, shaderShadowDist: 64, shaderWaving: true, shaderWater: true, shaderBloom: true, shaderGodrays: true },
  { shaderShadows: true, shaderShadowQuality: 1, shaderShadowDist: 96, shaderWaving: true, shaderWater: true, shaderBloom: true, shaderGodrays: true },
  { shaderShadows: true, shaderShadowQuality: 2, shaderShadowDist: 128, shaderWaving: true, shaderWater: true, shaderBloom: true, shaderGodrays: true },
];

export class Fancy {
  constructor(renderer) {
    this.r = renderer;
    const gl = (this.gl = renderer.gl);
    this.floatOK = !!gl.getExtension('EXT_color_buffer_float');
    this.world = createProgram(gl, FWORLD_VS, FWORLD_FS, 'monde (shader)');
    // uniformes du rendu standard absents ici : emplacements nuls (appels ignorés)
    for (const k of Object.keys(renderer.world.u)) if (!(k in this.world.u)) this.world.u[k] = null;
    this.shadowProg = createProgram(gl, SHADOW_VS, SHADOW_FS, 'ombres');
    this.sky = createProgram(gl, SKY_VS, FSKY_FS, 'ciel (shader)');
    this.down = createProgram(gl, FULL_VS, BLOOM_DOWN_FS, 'bloom');
    this.up = createProgram(gl, FULL_VS, BLOOM_UP_FS, 'bloom+');
    this.comp = createProgram(gl, FULL_VS, COMPOSITE_FS, 'composition');
    this.w = 0; this.h = 0;
    this.shadowSize = 0;
    this.lightView = M.mat4();
    this.lightProj = M.mat4();
    this.lightVP = M.mat4();
    this.lightFrustum = new Float32Array(24);
    this.exposure = 1;
    this.lastShadow = -1;
    this.ensureShadow(1);
  }

  // ---------- cibles de rendu ----------
  makeTex(w, h, fmt, filter) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, fmt, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  makeFbo(color, depth) {
    const gl = this.gl;
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    if (color) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, color, 0);
    if (depth) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, depth, 0);
    if (!color) { gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); }
    const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error('Framebuffer incomplet (' + st + ')');
    return f;
  }

  ensureTargets(w, h) {
    if (w === this.w && h === this.h) return;
    const gl = this.gl;
    this.freeTargets();
    this.w = w; this.h = h;
    const cf = this.floatOK ? gl.RGBA16F : gl.RGBA8;
    this.sceneColor = this.makeTex(w, h, cf, gl.LINEAR);
    this.sceneDepth = this.makeTex(w, h, gl.DEPTH_COMPONENT24, gl.NEAREST);
    this.sceneFbo = this.makeFbo(this.sceneColor, this.sceneDepth);
    this.copyColor = this.makeTex(w, h, cf, gl.LINEAR);
    this.copyDepth = this.makeTex(w, h, gl.DEPTH_COMPONENT24, gl.NEAREST);
    this.copyFbo = this.makeFbo(this.copyColor, this.copyDepth);
    this.bloom = [];
    let bw = w, bh = h;
    for (let i = 0; i < 6; i++) {
      bw = Math.max(1, bw >> 1); bh = Math.max(1, bh >> 1);
      const t = this.makeTex(bw, bh, cf, gl.LINEAR);
      this.bloom.push({ tex: t, fbo: this.makeFbo(t, null), w: bw, h: bh });
      if (bw < 8 || bh < 8) break;
    }
  }

  freeTargets() {
    const gl = this.gl;
    for (const k of ['sceneColor', 'sceneDepth', 'copyColor', 'copyDepth']) if (this[k]) gl.deleteTexture(this[k]);
    for (const k of ['sceneFbo', 'copyFbo']) if (this[k]) gl.deleteFramebuffer(this[k]);
    if (this.bloom) for (const b of this.bloom) { gl.deleteTexture(b.tex); gl.deleteFramebuffer(b.fbo); }
    this.bloom = null;
    this.w = this.h = 0;
  }

  ensureShadow(size) {
    if (size === this.shadowSize) return;
    const gl = this.gl;
    if (this.shadowTex) { gl.deleteTexture(this.shadowTex); gl.deleteFramebuffer(this.shadowFbo); }
    size = Math.min(size, gl.getParameter(gl.MAX_TEXTURE_SIZE));
    this.shadowSize = size;
    const t = this.makeTex(size, size, gl.DEPTH_COMPONENT24, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
    this.shadowTex = t;
    this.shadowFbo = this.makeFbo(null, t);
    // carte vide : entièrement éclairée
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  // ---------- lumière du jour ----------
  computeLight(env, game) {
    const s = game.settings;
    const L = { dir: [0.3, 0.9, 0.3], sun: [0, 0, 0], amb: [0, 0, 0], flat: [0, 0, 0], sunDir: [0, 1, 0], hasSun: 0, glow: 0 };
    const rain = env.rain || 0;
    if (env.dim === 1) {
      L.flat = [0.42, 0.2, 0.13];
    } else if (env.dim === 2) {
      L.flat = [0.2, 0.17, 0.27];
      L.dir = normalize([0.3, 0.9, 0.2]);
      L.sun = [0.25, 0.2, 0.35];
      L.hasSun = 1;
    } else {
      const t = ((game.time + (this.r.pt || 0)) % 24000) / 24000;
      const a = t * Math.PI * 2;
      const sd = [Math.cos(a), Math.sin(a) * Math.cos(TILT), Math.sin(a) * Math.sin(TILT)];
      L.sunDir = sd;
      const day = dayFactor(game.time);
      if (sd[1] > -0.03) {
        const k = smooth(-0.03, 0.18, sd[1]);
        const warm = M.clamp(env.sunset * 1.3, 0, 1);
        const c = [1.0, M.lerp(0.93, 0.58, warm), M.lerp(0.84, 0.32, warm)];
        L.sun = c.map((v) => v * 1.75 * k);
        L.dir = sd;
      } else {
        const k = smooth(0.03, 0.2, -sd[1]);
        L.sun = [0.3, 0.38, 0.62].map((v) => v * 0.16 * k);
        L.dir = [-sd[0], -sd[1], -sd[2]];
      }
      L.sun = L.sun.map((v) => v * (1 - 0.85 * rain));
      const dayAmb = [0.3, 0.4, 0.62], nightAmb = [0.018, 0.024, 0.05];
      L.amb = dayAmb.map((v, i) => M.lerp(nightAmb[i], v, day) * (1 - 0.35 * rain));
      if (env.sunset > 0.2) L.amb = L.amb.map((v, i) => v * [1.1, 0.95, 0.85][i] ** env.sunset);
      L.hasSun = 1;
      L.glow = 1 - rain;
    }
    L.blockCol = [1.0, 0.62, 0.32].map((v) => v * 1.25);
    L.minLight = 0.004 + s.brightness * 0.03;
    this.L = L;
    return L;
  }

  // ---------- passe d'ombres ----------
  shadowPass(world, cam) {
    const r = this.r, gl = this.gl, s = r.game.settings;
    const L = this.L;
    const size = SHADOW_SIZES[s.shaderShadowQuality] || 2048;
    this.ensureShadow(size);
    const range = s.shaderShadowDist || 64;
    this.range = range;
    const d = L.dir;
    const back = 200;
    // cible légèrement alignée sur une grille pour limiter le scintillement
    const up = Math.abs(d[2]) > 0.95 ? [1, 0, 0] : [0, 0, 1];
    M.lookAt(this.lightView, d[0] * back, d[1] * back, d[2] * back, 0, 0, 0, up[0], up[1], up[2]);
    M.ortho(this.lightProj, -range, range, -range, range, 1, back * 2);
    M.multiply(this.lightVP, this.lightProj, this.lightView);
    M.frustumPlanes(this.lightVP, this.lightFrustum);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.shadowFbo);
    gl.viewport(0, 0, this.shadowSize, this.shadowSize);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    if (L.sun[0] + L.sun[1] + L.sun[2] < 0.01) { this.lastShadow = 0; return; }
    const P = this.shadowProg;
    gl.useProgram(P.program);
    gl.uniformMatrix4fv(P.u.u_lightVP, false, this.lightVP);
    gl.uniform1f(P.u.u_time, r.time);
    gl.uniform3f(P.u.u_camPos, cam.x, cam.y, cam.z);
    gl.uniform1f(P.u.u_waving, s.shaderWaving ? 1 : 0);
    gl.uniform1i(P.u.u_tex, 0);
    gl.uniform1f(P.u.u_alphaTest, 0.5);
    gl.uniform1f(P.u.u_posScale, 1 / 16);
    gl.uniform1f(P.u.u_uvScale, 1 / 16);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D_ARRAY, r.blockTex);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1.5, 2);
    const pcx = Math.floor(cam.x) >> 4, pcz = Math.floor(cam.z) >> 4;
    const CR = Math.ceil(range / 16) + 1;
    for (const c of world.chunks.values()) {
      const dx = c.cx - pcx, dz = c.cz - pcz;
      if (Math.abs(dx) > CR || Math.abs(dz) > CR) continue;
      for (let sy = 0; sy < 8; sy++) {
        const m = c.meshes[sy];
        if (!m || !m.opaque) continue;
        const ox = c.cx * 16 - cam.x, oy = sy * 16 - cam.y, oz = c.cz * 16 - cam.z;
        if (!M.boxInFrustum(this.lightFrustum, ox, oy, oz, ox + 16, oy + 16, oz + 16)) continue;
        gl.uniform3f(P.u.u_offset, ox, oy, oz);
        gl.bindVertexArray(m.opaque.vao);
        gl.drawElements(gl.TRIANGLES, (m.opaque.count / 4) * 6, gl.UNSIGNED_INT, 0);
      }
    }
    // créatures
    r.drawEntityRanges(P, true);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.CULL_FACE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    this.lastShadow = 1;
  }

  bindScene() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFbo);
    gl.viewport(0, 0, this.w, this.h);
  }

  // ---------- ciel ----------
  drawSky(env, R, cam) {
    const gl = this.gl, S = this.sky, L = this.L, g = this.r.game;
    gl.useProgram(S.program);
    gl.uniformMatrix4fv(S.u.u_invVP, false, this.r.invViewProj);
    gl.uniform3fv(S.u.u_zenith, this.zenithLin);
    gl.uniform3fv(S.u.u_horizon, this.fogLin);
    gl.uniform3fv(S.u.u_sunDir, L.sunDir);
    gl.uniform3fv(S.u.u_sunCol, L.hasSun && env.dim === 0 ? L.sun : [0, 0, 0]);
    gl.uniform1f(S.u.u_night, env.night);
    gl.uniform1f(S.u.u_sunset, env.sunset);
    gl.uniform1i(S.u.u_dim, env.dim);
    gl.uniform3f(S.u.u_cam, cam.x, cam.y, cam.z);
    gl.uniform1f(S.u.u_time, g.time / 20);
    gl.uniform1f(S.u.u_cloudY, 150);
    gl.uniform1f(S.u.u_clouds, g.settings.clouds ? 1 : 0);
    gl.uniform1f(S.u.u_rain, env.rain);
    gl.uniform1f(S.u.u_far, Math.max(R, 128));
    gl.depthMask(false);
    gl.disable(gl.DEPTH_TEST);
    gl.bindVertexArray(this.r.emptyVao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);
  }

  // ---------- uniformes du monde ----------
  setWorldUniforms(W, env, cam) {
    const gl = this.gl, L = this.L, s = this.r.game.settings;
    this.fogLin = env.dim === 0 && !env.underFluid ? saturate(lin(env.fog), 1.25, 0.85) : lin(env.fog);
    this.zenithLin = env.dim === 0 ? saturate(lin(env.zenith), 1.35, 0.75) : lin(env.zenith);
    gl.uniform3fv(W.u.u_lightDir, L.dir);
    gl.uniform3fv(W.u.u_sunCol, L.sun);
    gl.uniform3fv(W.u.u_ambCol, L.amb);
    gl.uniform3fv(W.u.u_flatAmb, L.flat);
    gl.uniform3fv(W.u.u_blockCol, L.blockCol);
    gl.uniform1f(W.u.u_minLight, L.minLight);
    gl.uniform3fv(W.u.u_fogColor, this.fogLin);
    gl.uniform3fv(W.u.u_zenith, this.zenithLin);
    gl.uniform1f(W.u.u_haze, env.dim === 0 && !env.underFluid ? 0.0012 + env.rain * 0.006 : 0);
    gl.uniform1f(W.u.u_sunGlow, env.dim === 0 && !env.underFluid ? L.glow : 0);
    gl.uniform3f(W.u.u_camPos, cam.x, cam.y, cam.z);
    gl.uniform1f(W.u.u_waving, s.shaderWaving ? 1 : 0);
    gl.uniform1f(W.u.u_waterPass, 0);
    gl.uniform1f(W.u.u_ssr, s.shaderWater ? 1 : 0);
    gl.uniform1f(W.u.u_underwater, env.underFluid ? 1 : 0);
    gl.uniform2f(W.u.u_screen, this.w, this.h);
    gl.uniform2f(W.u.u_nearFar, 0.05, 1000);
    const shadows = s.shaderShadows && this.lastShadow === 1 && env.dim !== 1;
    gl.uniform1f(W.u.u_shadowOn, shadows ? 1 : 0);
    gl.uniformMatrix4fv(W.u.u_shadowVP, false, this.lightVP);
    gl.uniform1f(W.u.u_shadowRange, this.range || 64);
    gl.uniform1f(W.u.u_shadowSize, this.shadowSize);
    gl.uniform1i(W.u.u_shadow, 1);
    gl.uniform1i(W.u.u_sceneColor, 2);
    gl.uniform1i(W.u.u_sceneDepth, 3);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.shadowTex);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.copyColor);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.copyDepth);
    gl.activeTexture(gl.TEXTURE0);
  }

  // Copie couleur + profondeur de la scène opaque (réfraction, réflexions, rayons)
  copyScene() {
    const gl = this.gl;
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.sceneFbo);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.copyFbo);
    gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null);
    this.bindScene();
  }

  // ---------- post-traitement ----------
  post(env, cam, dt) {
    const gl = this.gl, r = this.r, s = r.game.settings, L = this.L;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.bindVertexArray(r.emptyVao);
    // bloom : chaîne de réductions puis remontée additive
    const bloomOn = s.shaderBloom && this.bloom.length > 2;
    if (bloomOn) {
      const D = this.down;
      gl.useProgram(D.program);
      gl.uniform1i(D.u.u_src, 0);
      gl.uniform1f(D.u.u_threshold, this.floatOK ? 1.1 : 0.75);
      gl.activeTexture(gl.TEXTURE0);
      let src = this.sceneColor, sw = this.w, sh = this.h;
      for (let i = 0; i < this.bloom.length; i++) {
        const b = this.bloom[i];
        gl.bindFramebuffer(gl.FRAMEBUFFER, b.fbo);
        gl.viewport(0, 0, b.w, b.h);
        gl.bindTexture(gl.TEXTURE_2D, src);
        gl.uniform2f(D.u.u_texel, 1 / sw, 1 / sh);
        gl.uniform1f(D.u.u_first, i === 0 ? 1 : 0);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = b.tex; sw = b.w; sh = b.h;
      }
      const U = this.up;
      gl.useProgram(U.program);
      gl.uniform1i(U.u.u_src, 0);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      for (let i = this.bloom.length - 1; i > 0; i--) {
        const small = this.bloom[i], big = this.bloom[i - 1];
        gl.bindFramebuffer(gl.FRAMEBUFFER, big.fbo);
        gl.viewport(0, 0, big.w, big.h);
        gl.bindTexture(gl.TEXTURE_2D, small.tex);
        gl.uniform2f(U.u.u_texel, 1 / small.w, 1 / small.h);
        gl.uniform1f(U.u.u_amount, 1);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
      }
      gl.disable(gl.BLEND);
    }
    // adaptation de l'œil : on ouvre les yeux dans le noir
    const target = this.eyeTarget(env);
    this.exposure += (target - this.exposure) * Math.min(1, dt * 1.5);
    // position du soleil à l'écran
    let sunVis = 0, sx = 0.5, sy = 0.5;
    if (s.shaderGodrays && env.dim === 0 && !env.underFluid) {
      const d = L.sunDir[1] > 0 ? L.sunDir : null;
      if (d) {
        const v = [0, 0, 0, 0];
        const m = r.viewProj;
        const x = d[0] * 500, y = d[1] * 500, z = d[2] * 500;
        v[0] = m[0] * x + m[4] * y + m[8] * z + m[12];
        v[1] = m[1] * x + m[5] * y + m[9] * z + m[13];
        v[3] = m[3] * x + m[7] * y + m[11] * z + m[15];
        if (v[3] > 0) {
          sx = (v[0] / v[3]) * 0.5 + 0.5; sy = (v[1] / v[3]) * 0.5 + 0.5;
          const edge = Math.max(Math.abs(sx - 0.5), Math.abs(sy - 0.5));
          sunVis = (1 - smooth(0.6, 1.1, edge)) * smooth(0, 0.12, d[1]) * (1 - env.rain);
        }
      }
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, r.canvas.width, r.canvas.height);
    const C = this.comp;
    gl.useProgram(C.program);
    gl.uniform1i(C.u.u_scene, 0);
    gl.uniform1i(C.u.u_bloom, 1);
    gl.uniform1i(C.u.u_depth, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneColor);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, bloomOn ? this.bloom[0].tex : this.copyColor);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.copyDepth);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform2f(C.u.u_sunPos, sx, sy);
    gl.uniform1f(C.u.u_sunVis, sunVis);
    gl.uniform3fv(C.u.u_sunCol, L.sun);
    gl.uniform1f(C.u.u_godrays, s.shaderGodrays ? 1 : 0);
    gl.uniform1f(C.u.u_bloomAmt, bloomOn ? 0.09 : 0);
    gl.uniform1f(C.u.u_exposure, this.exposure * (s.shaderExposure || 1));
    gl.uniform1f(C.u.u_sat, s.shaderSaturation ?? 1.1);
    gl.uniform1f(C.u.u_vignette, s.shaderVignette === false ? 0 : 0.45);
    gl.uniform1f(C.u.u_under, env.underFluid ? 1 : 0);
    gl.uniform1f(C.u.u_time, r.time);
    gl.uniform1f(C.u.u_aspect, r.canvas.width / r.canvas.height);
    gl.uniform1f(C.u.u_ldr, this.floatOK ? 0 : 1);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.enable(gl.DEPTH_TEST);
    gl.enable(gl.CULL_FACE);
  }

  // Exposition cible selon la lumière autour des yeux du joueur
  eyeTarget(env) {
    const g = this.r.game, p = g.player, w = g.world;
    if (!p || !w) return 1;
    const x = Math.floor(p.x), y = Math.floor(p.y + p.eyeHeight()), z = Math.floor(p.z);
    const sky = w.getSky(x, y, z) / 15, bl = w.getBlockLight(x, y, z) / 15;
    const L = this.L;
    const sunLum = env.dim === 0 ? (L.amb[0] + L.amb[1] + L.amb[2]) / 3 : 0.35;
    const lum = Math.max(sky * sky * Math.max(sunLum, 0.04) * 2, bl * bl * bl * 1.2, env.dim ? 0.3 : 0.01);
    return M.clamp(0.9 / Math.sqrt(Math.max(lum, 0.02)) * 0.55, 0.95, 2.0);
  }

  dispose() {
    this.freeTargets();
  }
}

// Sature une couleur linéaire autour de sa luminance puis l'atténue
function saturate(c, k, gain) {
  const l = c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
  return c.map((v) => Math.max(0, (l + (v - l) * k) * gain));
}

function normalize(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
