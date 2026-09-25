// Registre des types d'entités (évite les imports circulaires)
export const ENTITY_TYPES = {};

export function registerEntity(type, cls) {
  ENTITY_TYPES[type] = cls;
}

let nextId = 1;
export function newEntityId() {
  return nextId++;
}

export function spawnEntity(world, type, x, y, z, data) {
  const cls = ENTITY_TYPES[type];
  if (!cls) {
    console.warn('Type d\'entité inconnu', type);
    return null;
  }
  const e = new cls(world, data || {});
  if (!e.type || e.type === 'entity') e.type = type;
  e.setPos(x, y, z);
  world.addEntity(e);
  return e;
}
