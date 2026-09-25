// Sources GLSL

export const WORLD_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
layout(location=1) in vec2 a_uv;
layout(location=2) in float a_layer;
layout(location=3) in vec4 a_light;
layout(location=4) in vec4 a_color;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
uniform float u_posScale;
uniform float u_uvScale;
uniform float u_time;
out vec3 v_uv;
out vec3 v_light;
out vec4 v_color;
out float v_dist;
void main() {
  vec3 p = a_pos * u_posScale + u_offset;
  int flags = int(a_light.w * 255.0 + 0.5);
  vec2 uv = a_uv * u_uvScale;
  if (flags == 1) uv += vec2(sin(u_time * 0.7 + p.x * 0.3) * 0.03, u_time * 0.03);
  else if (flags == 2) uv += vec2(u_time * 0.006, u_time * 0.012);
  else if (flags == 3) uv += vec2(sin(u_time * 0.8) * 0.1, u_time * 0.12);
  gl_Position = u_viewProj * vec4(p, 1.0);
  v_uv = vec3(uv, a_layer);
  v_light = a_light.xyz;
  v_color = a_color;
  v_dist = length(p);
}`;

export const WORLD_FS = `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray u_tex;
uniform float u_sky;
uniform vec3 u_skyTint;
uniform vec3 u_fogColor;
uniform vec2 u_fog;
uniform float u_alphaTest;
uniform float u_ambient;
uniform float u_gamma;
uniform vec4 u_overlay;
uniform float u_alphaMul;
uniform float u_fullbright;
in vec3 v_uv;
in vec3 v_light;
in vec4 v_color;
in float v_dist;
out vec4 o;
float curve(float l) { return l / (4.0 - 3.0 * l); }
void main() {
  vec4 c = texture(u_tex, v_uv);
  if (c.a < u_alphaTest) discard;
  float sky = curve(v_light.x * u_sky);
  float blk = curve(v_light.y);
  vec3 light = max(vec3(sky) * u_skyTint, vec3(blk) * vec3(1.0, 0.88, 0.72));
  light = max(light, vec3(u_fullbright));
  light = mix(light, 1.0 - pow(1.0 - light, vec3(3.0)), u_gamma);
  light = light * (1.0 - u_ambient) + u_ambient;
  vec3 col = c.rgb * v_color.rgb * light * v_light.z;
  col = mix(col, u_overlay.rgb, u_overlay.a);
  float f = clamp((v_dist - u_fog.x) / (u_fog.y - u_fog.x), 0.0, 1.0);
  col = mix(col, u_fogColor, f);
  o = vec4(col, c.a * v_color.a * u_alphaMul);
}`;

export const SKY_VS = `#version 300 es
precision highp float;
const vec2 P[3] = vec2[3](vec2(-1.0, -1.0), vec2(3.0, -1.0), vec2(-1.0, 3.0));
out vec2 v_ndc;
void main() {
  v_ndc = P[gl_VertexID];
  gl_Position = vec4(P[gl_VertexID], 0.9999, 1.0);
}`;

export const SKY_FS = `#version 300 es
precision highp float;
uniform mat4 u_invVP;
uniform vec3 u_zenith;
uniform vec3 u_horizon;
uniform vec3 u_sunDir;
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
void main() {
  vec4 p = u_invVP * vec4(v_ndc, 1.0, 1.0);
  vec3 dir = normalize(p.xyz / p.w);
  if (u_dim == 1) { o = vec4(u_horizon, 1.0); return; }
  if (u_dim == 2) {
    vec3 d = dir * 60.0;
    float h = hash(floor(d));
    vec3 col = vec3(0.04, 0.02, 0.06) + vec3(0.1, 0.06, 0.12) * vnoise(dir.xz * 8.0 + dir.y * 3.0);
    if (h > 0.985) col += vec3(0.25, 0.2, 0.3) * (h - 0.985) * 60.0;
    o = vec4(col, 1.0);
    return;
  }
  float h = dir.y;
  vec3 col = mix(u_horizon, u_zenith, smoothstep(-0.02, 0.45, h));
  if (h < 0.0) col = mix(u_horizon, u_horizon * 0.35, smoothstep(0.0, -0.4, h));
  // coucher de soleil
  float sd = dot(dir, u_sunDir);
  col += vec3(1.0, 0.45, 0.15) * pow(max(sd, 0.0), 6.0) * u_sunset * (1.0 - smoothstep(0.0, 0.5, abs(h))) * 0.9;
  // étoiles
  if (u_night > 0.01 && h > 0.0) {
    vec3 d = dir * 170.0;
    float s = hash(floor(d));
    if (s > 0.9975) col += vec3(0.9) * u_night * (s - 0.9975) * 400.0 * smoothstep(0.0, 0.2, h) * (1.0 - u_rain);
  }
  // soleil et lune (carrés)
  vec3 sunUp = normalize(vec3(-u_sunDir.y, u_sunDir.x, 0.0));
  vec3 side = vec3(0.0, 0.0, 1.0);
  float su = dot(dir, side), sv = dot(dir, sunUp);
  if (sd > 0.0 && abs(su) < 0.075 && abs(sv) < 0.075) {
    float edge = max(abs(su), abs(sv));
    col = mix(col, vec3(1.0, 0.98, 0.8), (1.0 - u_rain) * (edge < 0.06 ? 1.0 : 0.6));
  } else if (sd > 0.0) {
    col += vec3(1.0, 0.9, 0.6) * pow(max(sd, 0.0), 180.0) * 0.5 * (1.0 - u_rain);
  }
  if (sd < 0.0 && abs(su) < 0.055 && abs(sv) < 0.055) {
    vec2 mc = floor(vec2(su, sv) * 90.0);
    float cr = hash2(mc);
    vec3 mcol = vec3(0.85, 0.87, 0.95) * (cr > 0.8 ? 0.75 : 1.0);
    col = mix(col, mcol, 0.95 * (1.0 - u_rain));
  }
  // nuages (plan)
  if (u_clouds > 0.5) {
    float t = (u_cloudY - u_cam.y) / dir.y;
    if (t > 0.0 && t < u_far * 1.8) {
      vec2 pos = u_cam.xz + dir.xz * t + vec2(u_time * 0.6, 0.0);
      vec2 cell = floor(pos / 12.0);
      float n = vnoise(cell * 0.18) * 0.75 + hash2(cell) * 0.25;
      if (n > 0.63) {
        float fade = 1.0 - smoothstep(u_far * 0.6, u_far * 1.8, t);
        vec3 cc = mix(vec3(1.0), u_horizon, 0.1) * (u_cam.y > u_cloudY ? 1.0 : 0.95);
        cc *= mix(1.0, 0.18, u_night);
        cc = mix(cc, vec3(0.55, 0.57, 0.6) * mix(1.0, 0.4, u_night), u_rain);
        col = mix(col, cc, 0.9 * fade);
      }
    }
  }
  o = vec4(col, 1.0);
}`;

export const LINE_VS = `#version 300 es
precision highp float;
layout(location=0) in vec3 a_pos;
uniform mat4 u_viewProj;
uniform vec3 u_offset;
void main() { gl_Position = u_viewProj * vec4(a_pos + u_offset, 1.0); }`;

export const LINE_FS = `#version 300 es
precision highp float;
uniform vec4 u_color;
out vec4 o;
void main() { o = u_color; }`;
