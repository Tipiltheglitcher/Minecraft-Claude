export const CS = 16; // taille d'un chunk (X/Z)
export const WH = 128; // hauteur du monde
export const NSEC = WH / 16; // sections par chunk
export const SEA = 62; // niveau de la mer
export const TPS = 20; // ticks par seconde
export const DAY = 24000; // durée d'un jour en ticks

// Faces : 0 nord(-Z) 1 sud(+Z) 2 ouest(-X) 3 est(+X) 4 haut(+Y) 5 bas(-Y)
export const FACE_DIRS = [
  [0, 0, -1],
  [0, 0, 1],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
];
export const OPPOSITE = [1, 0, 3, 2, 5, 4];

export const chunkKey = (cx, cz) => (cx + 32768) * 65536 + (cz + 32768);
export const blockIndex = (x, y, z) => (y << 8) | (z << 4) | x;
