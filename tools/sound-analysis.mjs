// Analyse des bruitages (après traitement) : sonie perçue, part d'aigus, crête
import { SOUND_NAMES, synth, loudness, harshness } from '../src/game/sfx.js';

const rows = [];
for (const n of SOUND_NAMES) {
  const d = synth(n, 0);
  const c = d.channels[0];
  let pk = 0;
  for (let i = 0; i < c.length; i++) pk = Math.max(pk, Math.abs(c[i]));
  rows.push([n, loudness(c).toFixed(1), (harshness(c) * 100).toFixed(0) + '%', pk.toFixed(2)]);
}
rows.sort((a, b) => parseFloat(b[1]) - parseFloat(a[1]));
console.log('son  sonie(dB)  aigus>3.5kHz  crête');
for (const r of rows) console.log(r.join('  '));
