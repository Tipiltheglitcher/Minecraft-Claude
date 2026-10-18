// Icône de l'application (bloc d'herbe en pixel art) encodée en PNG sans dépendance
import { deflateSync } from 'node:zlib';

const CRC = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

// Motif 16×16 : haut d'herbe, terre en dessous (pseudo-aléatoire déterministe)
function texel(x, y) {
  const h = ((x * 73856093) ^ (y * 19349663)) >>> 0;
  const n = (h % 7) - 3;
  const edge = 4 + ((h >> 3) % 3 === 0 ? 1 : 0);
  if (y < edge) return [95 + n * 6, 159 + n * 7, 53 + n * 4];
  return [134 + n * 7, 96 + n * 6, 67 + n * 5];
}

export function iconPng(size) {
  const raw = Buffer.alloc((size * 3 + 1) * size);
  const pad = Math.round(size * 0.1), inner = size - 2 * pad;
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0;
    for (let x = 0; x < size; x++) {
      let c = [24, 24, 28];
      const ix = x - pad, iy = y - pad;
      if (ix >= 0 && iy >= 0 && ix < inner && iy < inner) c = texel(Math.floor((ix * 16) / inner), Math.floor((iy * 16) / inner));
      raw.set(c, y * (size * 3 + 1) + 1 + x * 3);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

// Manifeste : lancé depuis l'écran d'accueil, le jeu s'ouvre en plein écran (sans barre d'adresse) et en paysage
export const MANIFEST = {
  name: 'Minecraft JS',
  short_name: 'Minecraft JS',
  display: 'fullscreen',
  orientation: 'landscape',
  background_color: '#000000',
  theme_color: '#000000',
  icons: [
    { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
    { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
  ],
};
