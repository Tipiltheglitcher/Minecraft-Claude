// Pool de Web Workers : génération des chunks, maillage, synthèse des sons.
// Dans le fichier unique (dist), le code du worker est intégré et lancé depuis une URL blob ;
// en développement, le module src/worker/worker.js est chargé directement.
/* global __WORKER_SRC__ */

function createWorker() {
  if (typeof __WORKER_SRC__ !== 'undefined') {
    const url = URL.createObjectURL(new Blob([__WORKER_SRC__], { type: 'text/javascript' }));
    return new Worker(url);
  }
  return new Worker(new URL('../worker/worker.js', import.meta.url), { type: 'module' });
}

export class WorkerPool {
  constructor(count, initMsg) {
    this.workers = [];
    this.jobs = new Map();
    this.queue = [[], [], []]; // files par priorité (0 = urgent)
    this.nextId = 1;
    this.failed = false;
    this.initMsg = initMsg;
    try {
      for (let i = 0; i < count; i++) {
        const w = createWorker();
        const slot = { w, busy: 0, ready: false };
        w.onmessage = (e) => this.onMessage(slot, e.data);
        w.onerror = (e) => this.fail(e.message || 'erreur du worker');
        w.postMessage(initMsg);
        this.workers.push(slot);
      }
    } catch (e) {
      this.fail(e.message);
    }
  }

  get ok() {
    return !this.failed && this.workers.length > 0;
  }

  // Nombre de tâches en cours ou en attente
  get pending() {
    return this.jobs.size;
  }

  fail(msg) {
    if (this.failed) return;
    this.failed = true;
    console.warn('Workers indisponibles, calcul sur le fil principal :', msg);
    for (const s of this.workers) { try { s.w.terminate(); } catch (e) { /* ignoré */ } }
    // les tâches en cours sont rendues à l'appelant (qui refera le travail lui-même)
    const jobs = [...this.jobs.values()];
    this.jobs.clear();
    this.queue = [[], [], []];
    for (const j of jobs) if (j.onFail) j.onFail();
  }

  // Soumet une tâche ; cb(résultat) est appelé à la fin, onFail() si les workers tombent en panne
  run(msg, transfer, cb, priority = 1, onFail = null) {
    if (!this.ok) { if (onFail) onFail(); return false; }
    const id = this.nextId++;
    msg.id = id;
    const job = { msg, transfer, cb, onFail };
    this.jobs.set(id, job);
    this.queue[priority].push(job);
    this.pump();
    return true;
  }

  pump() {
    for (const slot of this.workers) {
      while (slot.busy < 2) {
        const job = this.queue[0].shift() || this.queue[1].shift() || this.queue[2].shift();
        if (!job) return;
        slot.busy++;
        try {
          slot.w.postMessage(job.msg, job.transfer || []);
        } catch (e) {
          this.fail(e.message);
          return;
        }
      }
    }
  }

  onMessage(slot, data) {
    const job = this.jobs.get(data.id);
    slot.busy = Math.max(0, slot.busy - 1);
    if (job) {
      this.jobs.delete(data.id);
      try {
        if (data.type === 'error') {
          console.error('Worker :', data.message);
          if (job.onFail) job.onFail();
        } else job.cb(data);
      } catch (e) { console.error(e); }
    }
    this.pump();
  }

  // Tâches d'une priorité encore en file (pas encore envoyées)
  queued(priority) {
    return this.queue[priority].length;
  }
}
