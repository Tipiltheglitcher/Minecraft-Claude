// Sources GLSL du mode shader : éclairage HDR, ombres, eau, ciel, post-traitement

const WORLD_INPUTS = `
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_layer;
layout(location=3) in vec4 a_light;
layout(location=4) in vec4 a_color;
uniform vec3 u_offset;
uniform float u_posScale;
uniform float u_uvScale;
uniform float u_time;
uniform vec3 u_camPos;
uniform float u_waving;

// Feuilles et plantes qui ondulent au vent (5 = feuilles, 6 = plantes, sommets du haut)
vec3 waving(vec3 p, int flags) {
  if (u_waving < 0.5) return p;
  vec3 w = p + u_camPos;
  float t = u_time;
  if (flags == 5) {
    p += vec3(sin(t * 1.6 + w.x * 0.9 + w.z * 0.4 + w.y * 0.3),
              sin(t * 2.2 + w.x * 0.6 + w.y * 0.8) * 0.5,
              sin(t * 1.3 + w.z * 0.8 + w.y * 0.4)) * 0.035;
  } else if (flags == 6 && a_uv.y < 8.0) {
    float s = sin(t * 1.7 + w.x * 0.6 + w.z * 0.4) + 0.4 * sin(t * 3.1 + w.x * 1.3 + w.z * 0.2);
    p.xz += vec2(s, cos(t * 1.4 + w.z * 0.7 + w.x * 0.2)) * 0.06;
  }
  return p;
}

vec2 animUv(vec2 uv, int flags, vec3 w) {
  if (flags == 1) uv += vec2(sin(u_time * 0.7 + w.x * 0.3) * 0.03, u_time * 0.03);
  else if (flags == 2) uv += vec2(u_time * 0.006, u_time * 0.012);
  else if (flags == 3) uv += vec2(sin(u_time * 0.8) * 0.1, u_time * 0.12);
  return uv;
}
`;

export const FWORLD_VS = `#version 300 es
precision highp float;
${WORLD_INPUTS}
uniform mat4 u_viewProj;
out vec3 v_uv;
out vec3 v_light;
out vec4 v_color;
out vec3 v_rel;
flat out int v_flags;
void main() {
  vec3 p = a_pos * u_posScale + u_offset;
  int flags = int(a_light.w * 255.0 + 0.5);
  vec2 uv = animUv(a_uv * u_uvScale, flags, p + u_camPos);
  p = waving(p, flags);
  gl_Position = u_viewProj * vec4(p, 1.0);
  v_uv = vec3(uv, a_layer);
  v_light = a_light.xyz;
  v_color = a_color;
  v_rel = p;
  v_flags = flags;
}`;

export const FWORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
precision highp sampler2DShadow;
uniform sampler2DArray u_tex;
uniform sampler2DShadow u_shadow;
uniform sampler2D u_sceneColor;
uniform sampler2D u_sceneDepth;
uniform mat4 u_viewProj;
uniform mat4 u_shadowVP;
uniform float u_shadowOn;
uniform float u_shadowRange;
uniform float u_shadowSize;
uniform vec3 u_lightDir;
uniform vec3 u_sunCol;
uniform vec3 u_ambCol;
uniform vec3 u_flatAmb;
uniform vec3 u_blockCol;
uniform float u_minLight;
uniform vec3 u_fogColor;
uniform vec3 u_zenith;
uniform vec2 u_fog;
uniform float u_haze;
uniform float u_sunGlow;
uniform float u_alphaTest;
uniform vec4 u_overlay;
uniform float u_alphaMul;
uniform float u_fullbright;
uniform float u_waterPass;
uniform float u_ssr;
uniform float u_underwater;
uniform vec3 u_camPos;
uniform float u_time;
uniform vec2 u_screen;
uniform vec2 u_nearFar;
in vec3 v_uv;
in vec3 v_light;
in vec4 v_color;
in vec3 v_rel;
flat in int v_flags;
out vec4 o;

const vec2 POISSON[8] = vec2[8](vec2(-0.613, 0.617), vec2(0.170, -0.040), vec2(-0.299, -0.792), vec2(0.645, 0.493),
  vec2(-0.651, -0.018), vec2(0.421, -0.628), vec2(-0.015, 0.975), vec2(0.940, -0.107));

float curve(float l) { return l / (4.0 - 3.0 * l); }
float linDepth(float d) {
  float n = u_nearFar.x, f = u_nearFar.y;
  return 2.0 * n * f / (f + n - (d * 2.0 - 1.0) * (f - n));
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }

// Ombre du soleil : carte déformée (plus de détails près du joueur), filtrage PCF
float shadowAt(vec3 rel, vec3 N) {
  vec4 c = u_shadowVP * vec4(rel, 1.0);
  float f = length(c.xy) * 0.85 + 0.15;
  float texW = 2.0 * u_shadowRange / u_shadowSize * f;
  vec3 pr = rel + N * texW * 1.4 + u_lightDir * texW * 0.6;
  c = u_shadowVP * vec4(pr, 1.0);
  float d = length(c.xy);
  f = d * 0.85 + 0.15;
  vec3 sc = vec3(c.xy / f, c.z) * 0.5 + 0.5;
  if (d > 0.98 || sc.z > 1.0 || sc.z < 0.0) return -1.0;
  float ang = hash(gl_FragCoord.xy) * 6.2832;
  mat2 rot = mat2(cos(ang), sin(ang), -sin(ang), cos(ang));
  vec2 ts = vec2(1.3 / u_shadowSize);
  float s = 0.0;
  for (int i = 0; i < 8; i++) s += texture(u_shadow, vec3(sc.xy + rot * POISSON[i] * ts, sc.z - 0.0002));
  s /= 8.0;
  // fondu vers l'estimation par la lumière du ciel au bord de la zone couverte
  return mix(s, -1.0, smoothstep(0.8, 0.98, d));
}

vec3 waterNormal(vec2 p) {
  float t = u_time;
  vec2 d = vec2(0.0);
  d += vec2(0.6, 0.8) * cos(dot(p, vec2(0.6, 0.8)) * 1.1 + t * 1.5) * 0.07;
  d += vec2(-0.7, 0.5) * cos(dot(p, vec2(-0.7, 0.5)) * 1.9 + t * 2.0) * 0.05;
  d += vec2(0.2, -0.9) * cos(dot(p, vec2(0.2, -0.9)) * 3.3 + t * 2.7) * 0.03;
  d += vec2(-0.9, -0.3) * cos(dot(p, vec2(-0.9, -0.3)) * 5.1 + t * 3.6) * 0.018;
  d += vec2(0.5, -0.4) * cos(dot(p, vec2(0.5, -0.4)) * 8.7 + t * 4.4) * 0.01;
  return normalize(vec3(-d.x, 1.0, -d.y));
}

vec3 skyRefl(vec3 R) {
  float h = max(R.y, 0.0);
  vec3 c = mix(u_fogColor, u_zenith, smoothstep(0.0, 0.6, h));
  c += u_sunCol * pow(max(dot(R, u_lightDir), 0.0), 8.0) * 0.12 * u_sunGlow;
  return c;
}

// Réflexions en espace écran (marche le long du rayon réfléchi)
vec4 ssr(vec3 P, vec3 R) {
  float stepLen = 0.4 + length(P) * 0.015;
  vec3 pos = P, prev = P;
  for (int i = 0; i < 28; i++) {
    prev = pos;
    pos += R * stepLen;
    stepLen *= 1.15;
    vec4 c = u_viewProj * vec4(pos, 1.0);
    if (c.w <= 0.05) break;
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) break;
    float sz = linDepth(texture(u_sceneDepth, uv).r);
    if (c.w > sz + 0.03 && c.w - sz < stepLen * 2.5 + 0.6) {
      vec3 a = prev, b = pos;
      for (int j = 0; j < 5; j++) {
        vec3 m = (a + b) * 0.5;
        vec4 cm = u_viewProj * vec4(m, 1.0);
        float s2 = linDepth(texture(u_sceneDepth, cm.xy / cm.w * 0.5 + 0.5).r);
        if (cm.w > s2) b = m; else a = m;
      }
      vec4 cb = u_viewProj * vec4(b, 1.0);
      vec2 ub = cb.xy / cb.w * 0.5 + 0.5;
      vec2 e = smoothstep(0.0, 0.08, ub) * smoothstep(1.0, 0.92, ub);
      return vec4(texture(u_sceneColor, ub).rgb, e.x * e.y);
    }
  }
  return vec4(0.0);
}

void main() {
  vec4 tc = texture(u_tex, v_uv);
  if (tc.a < u_alphaTest) discard;
  if (u_fullbright > 0.99) {
    o = vec4(tc.rgb * v_color.rgb, tc.a * v_color.a * u_alphaMul);
    return;
  }
  vec3 N = normalize(cross(dFdx(v_rel), dFdy(v_rel)));
  if (dot(N, v_rel) > 0.0) N = -N;
  int fl = v_flags;
  bool plant = fl == 6;
  bool leaves = fl == 5;
  bool emissive = fl == 2 || fl == 3 || fl == 4 || fl == 7;
  vec3 albedo = pow(tc.rgb * v_color.rgb, vec3(2.2));
  float faceShade = N.y > 0.5 ? 1.0 : (N.y < -0.5 ? 0.5 : (abs(N.x) > 0.5 ? 0.6 : 0.8));
  float ao = plant ? 1.0 : clamp(v_light.z / faceShade, 0.0, 1.0);
  float skyL = v_light.x;
  float blk = v_light.y;
  vec3 L = u_lightDir;
  float NdotL = dot(N, L);
  float diff = plant ? 0.4 + 0.6 * max(L.y, 0.0) : max(NdotL, 0.0);
  if (leaves) diff = max(NdotL, 0.0) * 0.75 + 0.3;
  float sh = smoothstep(0.35, 0.9, skyL);
  if (u_shadowOn > 0.5 && diff > 0.0) {
    float s = shadowAt(v_rel, N);
    if (s >= 0.0) sh = s * smoothstep(0.0, 0.25, skyL);
  }
  vec3 sun = u_sunCol * diff * sh;
  float hemi = plant ? 0.85 : 0.6 + 0.4 * (N.y * 0.5 + 0.5);
  vec3 amb = u_ambCol * curve(skyL) * hemi;
  vec3 torch = u_blockCol * (pow(blk, 3.0) * 1.4 + blk * 0.06);
  vec3 lighting = sun + (amb + torch + u_flatAmb * hemi + vec3(u_minLight)) * ao;
  lighting = max(lighting, vec3(u_fullbright));
  vec3 col = albedo * lighting;
  if (emissive) col = albedo * (fl == 7 ? 2.6 : fl == 3 ? 1.1 : 2.0) + col * 0.3;
  col = mix(col, pow(u_overlay.rgb, vec3(2.2)), u_overlay.a);
  float alpha = tc.a * v_color.a * u_alphaMul;

  float dist = length(v_rel);
  vec3 V = v_rel / max(dist, 1e-4);
  if (fl == 1 && u_waterPass > 0.5) {
    vec3 n = N.y > 0.5 ? waterNormal((v_rel + u_camPos).xz) : N;
    if (u_underwater > 0.5) {
      col = mix(col, u_fogColor, 0.4);
      alpha = 0.55;
    } else {
      float cosT = clamp(dot(-V, n), 0.0, 1.0);
      float F = 0.02 + 0.98 * pow(1.0 - cosT, 5.0);
      vec3 R = reflect(V, n);
      if (R.y < 0.0) R.y = -R.y * 0.3;
      vec3 refl = skyRefl(R) * curve(skyL);
      if (u_ssr > 0.5) { vec4 h = ssr(v_rel, normalize(R)); refl = mix(refl, h.rgb, h.a); }
      vec2 suv = gl_FragCoord.xy / u_screen;
      float wz = (u_viewProj * vec4(v_rel, 1.0)).w;
      vec2 ruv = suv + n.xz * 0.05 / max(wz * 0.2, 1.0);
      float sz = linDepth(texture(u_sceneDepth, ruv).r);
      if (sz < wz) { ruv = suv; sz = linDepth(texture(u_sceneDepth, suv).r); }
      vec3 refr = texture(u_sceneColor, ruv).rgb;
      float thick = clamp(sz - wz, 0.0, 80.0);
      vec3 absorb = exp(-thick * vec3(0.30, 0.10, 0.07));
      vec3 scatter = albedo * (amb + u_sunCol * 0.12 * sh + torch * 0.5 + u_flatAmb) * 0.9;
      vec3 body = refr * absorb + scatter * (1.0 - absorb);
      vec3 spec = u_sunCol * pow(max(dot(normalize(R), L), 0.0), 350.0) * 5.0 * sh;
      col = mix(body, refl, F) + spec;
      alpha = 1.0;
    }
  }
  // brouillard (distance + brume), lumière diffusée vers le soleil
  float ff = clamp((dist - u_fog.x) / max(u_fog.y - u_fog.x, 0.001), 0.0, 1.0);
  ff = ff * ff * (3.0 - 2.0 * ff);
  float haze = 1.0 - exp(-dist * u_haze);
  vec3 fc = u_fogColor + u_sunCol * pow(max(dot(V, L), 0.0), 6.0) * 0.08 * u_sunGlow;
  col = mix(col, fc, max(ff, haze * 0.5));
  o = vec4(col, alpha);
}`;

export const SHADOW_VS = `#version 300 es
precision highp float;
${WORLD_INPUTS}
uniform mat4 u_lightVP;
out vec3 v_uv;
void main() {
  vec3 p = a_pos * u_posScale + u_offset;
  int flags = int(a_light.w * 255.0 + 0.5);
  p = waving(p, flags);
  vec4 c = u_lightVP * vec4(p, 1.0);
  c.xy /= length(c.xy) * 0.85 + 0.15;
  gl_Position = c;
  v_uv = vec3(a_uv * u_uvScale, a_layer);
}`;

export const SHADOW_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_alphaTest;
in vec3 v_uv;
void main() {
  if (texture(u_tex, v_uv).a < u_alphaTest) discard;
}`;

export const FSKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_invVP;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_sunDir;
uniform vec3 u_sunCol;
uniform float u_night;
uniform float u_sunset;
uniform int u_dim;
uniform vec3 u_cam;
uniform float u_time;
uniform float u_cloudY;
uniform float u_clouds;
uniform float u_rain;
uniform float u_far;
in vec2 v_ndc;
out vec4 o;
float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float hash2(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash2(i), hash2(i + vec2(1, 0)), f.x), mix(hash2(i + vec2(0, 1)), hash2(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) {
  float s = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { s += vnoise(p) * a; p = p * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  return s;
}
float cloudDensity(vec2 p) {
  float cov = mix(0.52, 0.32, u_rain);
  float n = fbm(p * 0.0045 + vec2(u_time * 0.004, 0.0));
  return clamp((n - cov) * 3.0, 0.0, 1.0);
}
void main() {
  vec4 p = u_invVP * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  if (u_dim == 1) { o = vec4(u_horizon, 1.0); return; }
  if (u_dim == 2) {
    vec3 d = dir * 60.0;
    float h = hash(floor(d));
    vec3 col = vec3(0.004, 0.002, 0.007) + vec3(0.012, 0.006, 0.018) * vnoise(dir.xz * 8.0 + dir.y * 3.0);
    if (h > 0.985) col += vec3(0.08, 0.06, 0.1) * (h - 0.985) * 60.0;
    o = vec4(col, 1.0);
    return;
  }
  float h = dir.y;
  vec3 col = mix(u_horizon, u_zenith, pow(smoothstep(-0.02, 1.0, h), 0.5));
  if (h < 0.0) col = mix(u_horizon, u_horizon * 0.3, smoothstep(0.0, -0.3, h));
  float sd = dot(dir, u_sunDir);
  col += vec3(1.0, 0.32, 0.07) * pow(max(sd, 0.0), 4.0) * u_sunset * (1.0 - smoothstep(0.0, 0.6, abs(h))) * 0.9;
  col += u_sunCol * (pow(max(sd, 0.0), 10.0) * 0.05 + pow(max(sd, 0.0), 300.0) * 0.5) * (1.0 - u_rain);
  // étoiles
  if (u_night > 0.01 && h > 0.0) {
    vec3 d = dir * 170.0;
    float s = hash(floor(d));
    if (s > 0.997) col += vec3(0.6, 0.65, 0.8) * u_night * (s - 0.997) * 300.0 * smoothstep(0.0, 0.25, h) * (1.0 - u_rain);
  }
  // soleil et lune (carrés, lumineux en HDR)
  vec3 ax = normalize(cross(u_sunDir, vec3(0.0, 0.0, 1.0)));
  vec3 ay = cross(ax, u_sunDir);
  float su = dot(dir, ax), sv = dot(dir, ay);
  if (sd > 0.0 && abs(su) < 0.07 && abs(sv) < 0.07) {
    float edge = max(abs(su), abs(sv));
    col = mix(col, vec3(1.0, 0.92, 0.75) * (edge < 0.058 ? 24.0 : 8.0), 1.0 - u_rain * 0.9);
  }
  if (sd < 0.0 && abs(su) < 0.05 && abs(sv) < 0.05) {
    vec2 mc = floor(vec2(su, sv) * 90.0);
    float cr = hash2(mc);
    vec3 mcol = vec3(0.7, 0.74, 0.85) * (cr > 0.8 ? 0.55 : 1.0) * 1.6;
    col = mix(col, mcol, 0.95 * (1.0 - u_rain));
  } else if (sd < 0.0) {
    col += vec3(0.15, 0.2, 0.35) * pow(max(-sd, 0.0), 60.0) * 0.4 * u_night;
  }
  // nuages volumétriques (couche 2D éclairée, ombrage vers le soleil)
  if (u_clouds > 0.5 && h > 0.005 && u_cam.y < u_cloudY) {
    float t = (u_cloudY - u_cam.y) / h;
    if (t < u_far * 3.0) {
      vec2 pos = u_cam.xz + dir.xz * t;
      float dens = cloudDensity(pos);
      if (dens > 0.0) {
        vec3 L = u_sunDir.y > 0.0 ? u_sunDir : -u_sunDir;
        float dl = cloudDensity(pos + L.xz * 18.0) + cloudDensity(pos + L.xz * 40.0) * 0.5;
        float lit = exp(-dl * 1.6);
        vec3 shade = mix(u_zenith * 0.9 + u_horizon * 0.3, u_horizon * 0.5, u_night) * (1.0 - 0.4 * u_rain);
        vec3 bright = u_sunCol * 0.55 + u_horizon * 0.6;
        vec3 cc = mix(shade, bright, lit * (1.0 - 0.7 * u_rain));
        cc += u_sunCol * pow(max(sd, 0.0), 12.0) * 0.6 * (1.0 - dens);
        float fade = 1.0 - smoothstep(u_far * 0.8, u_far * 3.0, t);
        col = mix(col, cc, clamp(dens * 1.6, 0.0, 1.0) * fade);
      }
    }
  }
  o = vec4(col, 1.0);
}`;

export const FULL_VS = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_uv;
void main() {
  v_uv = P[gl_VertexID] * 0.5 + 0.5;
  gl_Position = vec4(P[gl_VertexID], 0.0, 1.0);
}`;

export const BLOOM_DOWN_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_threshold;
uniform float u_first;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 a = texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb;
  vec3 b = texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  vec3 c = texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  vec3 d = texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  vec3 m = texture(u_src, v_uv).rgb;
  vec3 s = (a + b + c + d) * 0.125 + m * 0.5;
  if (u_first > 0.5) {
    s = min(s, vec3(40.0));
    float l = max(s.r, max(s.g, s.b));
    float k = clamp(l - u_threshold + 0.5, 0.0, 1.0);
    k = k * k * 0.5;
    float w = max(k, l - u_threshold) / max(l, 1e-4);
    s *= w;
  }
  o = vec4(s, 1.0);
}`;

export const BLOOM_UP_FS = `#version 300 es
precision highp float;
uniform sampler2D u_src;
uniform vec2 u_texel;
uniform float u_amount;
in vec2 v_uv;
out vec4 o;
void main() {
  vec3 s = texture(u_src, v_uv).rgb * 4.0;
  s += texture(u_src, v_uv + u_texel * vec2(-1.0, 0.0)).rgb * 2.0;
  s += texture(u_src, v_uv + u_texel * vec2(1.0, 0.0)).rgb * 2.0;
  s += texture(u_src, v_uv + u_texel * vec2(0.0, -1.0)).rgb * 2.0;
  s += texture(u_src, v_uv + u_texel * vec2(0.0, 1.0)).rgb * 2.0;
  s += texture(u_src, v_uv + u_texel * vec2(-1.0, -1.0)).rgb;
  s += texture(u_src, v_uv + u_texel * vec2(1.0, -1.0)).rgb;
  s += texture(u_src, v_uv + u_texel * vec2(-1.0, 1.0)).rgb;
  s += texture(u_src, v_uv + u_texel * vec2(1.0, 1.0)).rgb;
  o = vec4(s / 16.0 * u_amount, 1.0);
}`;

export const COMPOSITE_FS = `#version 300 es
precision highp float;
uniform sampler2D u_scene;
uniform sampler2D u_bloom;
uniform sampler2D u_depth;
uniform vec2 u_sunPos;
uniform float u_sunVis;
uniform vec3 u_sunCol;
uniform float u_godrays;
uniform float u_bloomAmt;
uniform float u_exposure;
uniform float u_sat;
uniform float u_vignette;
uniform float u_under;
uniform float u_time;
uniform float u_aspect;
uniform float u_ldr;
in vec2 v_uv;
out vec4 o;
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
vec3 aces(vec3 x) {
  const float a = 2.51, b = 0.03, c = 2.43, d = 0.59, e = 0.14;
  return clamp((x * (a * x + b)) / (x * (c * x + d) + e), 0.0, 1.0);
}
void main() {
  vec2 uv = v_uv;
  if (u_under > 0.5) uv += vec2(sin(uv.y * 25.0 + u_time * 2.0), cos(uv.x * 22.0 + u_time * 1.7)) * 0.0025;
  vec3 c = texture(u_scene, uv).rgb;
  if (u_ldr > 0.5) c *= 2.0;
  // rayons crépusculaires : flou radial des zones de ciel vers le soleil
  if (u_godrays > 0.0 && u_sunVis > 0.0) {
    vec2 delta = (u_sunPos - uv) / 36.0;
    vec2 p = uv + delta * hash(gl_FragCoord.xy + fract(u_time));
    float acc = 0.0, w = 1.0, tw = 0.0;
    for (int i = 0; i < 36; i++) {
      float dsk = texture(u_depth, p).r >= 0.99999 ? 1.0 : 0.0;
      acc += dsk * w;
      tw += w;
      w *= 0.97;
      p += delta;
    }
    acc /= tw;
    vec2 dd = (u_sunPos - uv) * vec2(u_aspect, 1.0);
    float fall = exp(-dot(dd, dd) * 3.0);
    c += u_sunCol * acc * fall * u_godrays * u_sunVis * 0.35;
  }
  c += texture(u_bloom, uv).rgb * u_bloomAmt;
  c = aces(c * u_exposure);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = max(mix(vec3(l), c, u_sat), 0.0);
  vec2 q = uv - 0.5;
  c *= 1.0 - u_vignette * dot(q, q) * 1.4;
  c = pow(c, vec3(1.0 / 2.2));
  c += (hash(gl_FragCoord.xy) - 0.5) / 255.0;
  o = vec4(c, 1.0);
}`;
