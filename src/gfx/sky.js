// Calcul de l'environnement : couleurs du ciel, brouillard, lumière du jour
import { clamp, lerp, lookDir } from '../core/math.js';
import { B } from '../data/ids.js';

export function dayFactor(time) {
  const t = (time % 24000) / 24000;
  const a = t * Math.PI * 2;
  return clamp(Math.sin(a) * 2.5 + 0.35, 0, 1);
}

export class Sky {
  constructor(game) {
    this.game = game;
  }

  environment(world, cam, pt) {
    const game = this.game;
    const s = game.settings;
    const R = s.renderDistance * 16;
    const time = game.time + pt;
    const t = (time % 24000) / 24000;
    const a = t * Math.PI * 2;
    const sunDir = [Math.cos(a), Math.sin(a), 0];
    const rain = game.weather ? game.weather.strength : 0;
    const env = {
      dim: 0, zenith: [0.47, 0.65, 1.0], fog: [0.75, 0.85, 1.0], sunDir, night: 0, sunset: 0,
      skyLight: 1, skyTint: [1, 1, 1], ambient: 0.025 + s.brightness * 0.06, fogStart: R * 0.65, fogEnd: R * 0.98, rain: 0,
      underFluid: false, nightVision: game.player && game.player.hasEffect && game.player.hasEffect('night_vision'),
    };
    if (world.dim === 'nether') {
      env.dim = 1;
      env.fog = [0.24, 0.04, 0.03];
      env.ambient = 0.2;
      env.fogStart = R * 0.1;
      env.fogEnd = Math.min(100, R * 0.7);
      env.skyLight = 0;
    } else if (world.dim === 'end') {
      env.dim = 2;
      env.fog = [0.05, 0.035, 0.07];
      env.ambient = 0.18;
      env.fogStart = R * 0.5;
      env.fogEnd = R;
      env.skyLight = 0;
    } else {
      const day = dayFactor(time);
      const sunset = Math.exp(-sunDir[1] * sunDir[1] * 25) * (sunDir[1] > -0.35 ? 1 : 0);
      env.night = clamp(1 - day * 1.6, 0, 1);
      env.sunset = sunset;
      env.zenith = [lerp(0.012, 0.47, day), lerp(0.012, 0.65, day), lerp(0.04, 1.0, day)];
      let fog = [lerp(0.03, 0.75, day), lerp(0.04, 0.85, day), lerp(0.08, 1.0, day)];
      // teinte orangée vers le soleil au coucher/lever
      const d = lookDir(cam.yaw, 0);
      const toward = Math.max(0, d[0] * Math.sign(sunDir[0] || 1));
      const k = sunset * toward * 0.7;
      fog = [lerp(fog[0], 1.0, k), lerp(fog[1], 0.5, k), lerp(fog[2], 0.25, k)];
      if (rain > 0) {
        const g = (fog[0] + fog[1] + fog[2]) / 3;
        fog = fog.map((c) => lerp(c, g * 0.6, rain * 0.8));
        env.zenith = env.zenith.map((c) => lerp(c, g * 0.5, rain * 0.8));
      }
      env.fog = fog;
      env.rain = rain;
      env.skyLight = (0.27 + 0.73 * day) * (1 - rain * 0.25);
      env.skyTint = [lerp(0.7, 1, day), lerp(0.75, 1, day), 1];
      if (sunset > 0.3) env.skyTint = [1, lerp(1, 0.88, sunset), lerp(1, 0.78, sunset)];
    }
    // sous l'eau / dans la lave
    const eyeId = world.getBlock(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
    if (eyeId === B.water) {
      const m = world.getMeta(Math.floor(cam.x), Math.floor(cam.y), Math.floor(cam.z));
      const h = m & 8 || m === 0 ? 0.9 : 1 - (m & 7) / 9;
      if (cam.y - Math.floor(cam.y) < h) {
        const day = world.dim === 'overworld' ? dayFactor(time) : 0.5;
        env.fog = [0.05 * (0.3 + day), 0.15 * (0.3 + day), 0.4 * (0.3 + day)];
        env.fogStart = 0;
        env.fogEnd = game.player && game.player.hasEffect && game.player.hasEffect('water_breathing') ? 48 : 22;
        env.underFluid = true;
      }
    } else if (eyeId === B.lava) {
      env.fog = [0.6, 0.12, 0.0];
      env.fogStart = 0;
      env.fogEnd = game.player && game.player.hasEffect && game.player.hasEffect('fire_resistance') ? 5 : 1.5;
      env.underFluid = true;
    } else if (eyeId === B.powder_snow) {
      env.underFluid = true;
    }
    return env;
  }

  // Assombrissement de la lumière du ciel (0..11) pour la logique du jeu
  skyDarken(time, rain) {
    const day = dayFactor(time);
    return Math.round((1 - day) * 11 + (rain || 0) * 3);
  }
}
