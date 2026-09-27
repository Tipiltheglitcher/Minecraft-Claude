// Index nom de texture -> couche de l'atlas (module léger, partagé avec les workers)
export const texIndex = new Map();

// Index reçu du fil principal (workers : pas besoin de peindre les textures)
export function setTextureIndex(entries) {
  texIndex.clear();
  for (const [k, v] of entries) texIndex.set(k, v);
}

export function tex(name) {
  const i = texIndex.get(name);
  if (i === undefined) {
    if (!tex.warned) tex.warned = new Set();
    if (!tex.warned.has(name)) { tex.warned.add(name); console.warn('Texture manquante', name); }
    return texIndex.get('stone') ?? 0;
  }
  return i;
}

export function hasTex(name) {
  return texIndex.has(name);
}
