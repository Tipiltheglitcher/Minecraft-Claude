// Sauvegarde des mondes (IndexedDB, avec repli en mémoire)
const DB_NAME = 'minecraft-js';
const DB_VERSION = 1;

export class SaveStore {
  constructor() {
    this.db = null;
    this.memory = { worlds: new Map(), chunks: new Map() };
    this.ready = this.open();
  }

  open() {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        resolve(null);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('worlds')) db.createObjectStore('worlds', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
      };
      req.onsuccess = () => { this.db = req.result; resolve(this.db); };
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
      setTimeout(() => resolve(this.db), 3000);
    });
  }

  tx(store, mode = 'readonly') {
    return this.db.transaction(store, mode).objectStore(store);
  }

  req(r) {
    return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
  }

  async listWorlds() {
    await this.ready;
    if (!this.db) return [...this.memory.worlds.values()];
    const all = await this.req(this.tx('worlds').getAll());
    return all.sort((a, b) => (b.lastPlayed || 0) - (a.lastPlayed || 0));
  }

  async getWorld(id) {
    await this.ready;
    if (!this.db) return this.memory.worlds.get(id);
    return this.req(this.tx('worlds').get(id));
  }

  async putWorld(meta) {
    await this.ready;
    if (!this.db) { this.memory.worlds.set(meta.id, meta); return; }
    return this.req(this.tx('worlds', 'readwrite').put(meta));
  }

  async deleteWorld(id) {
    await this.ready;
    if (!this.db) {
      this.memory.worlds.delete(id);
      for (const k of [...this.memory.chunks.keys()]) if (k.startsWith(id + '|')) this.memory.chunks.delete(k);
      return;
    }
    await this.req(this.tx('worlds', 'readwrite').delete(id));
    const store = this.tx('chunks', 'readwrite');
    const range = IDBKeyRange.bound(id + '|', id + '|￿');
    await this.req(store.delete(range));
  }

  // Chunks d'une dimension : Map(chunkKey -> données)
  async loadChunks(worldId, dim) {
    await this.ready;
    const prefix = worldId + '|' + dim + '|';
    const out = new Map();
    if (!this.db) {
      for (const [k, v] of this.memory.chunks) if (k.startsWith(prefix)) out.set(Number(k.slice(prefix.length)), v);
      return out;
    }
    const store = this.tx('chunks');
    const range = IDBKeyRange.bound(prefix, prefix + '￿');
    const keys = await this.req(store.getAllKeys(range));
    const vals = await this.req(store.getAll(range));
    for (let i = 0; i < keys.length; i++) out.set(Number(keys[i].slice(prefix.length)), vals[i]);
    return out;
  }

  async saveChunks(worldId, dim, entries) {
    await this.ready;
    const prefix = worldId + '|' + dim + '|';
    if (!this.db) {
      for (const [k, v] of entries) this.memory.chunks.set(prefix + k, v);
      return;
    }
    return new Promise((resolve) => {
      const t = this.db.transaction('chunks', 'readwrite');
      const store = t.objectStore('chunks');
      for (const [k, v] of entries) store.put(v, prefix + k);
      t.oncomplete = () => resolve();
      t.onerror = () => resolve();
      t.onabort = () => resolve();
    });
  }

  get persistent() {
    return !!this.db;
  }
}
