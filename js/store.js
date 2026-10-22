// On-phone storage. The outbox (punches, job and crew edits waiting to send)
// lives in IndexedDB because photos can be large; small settings use localStorage.
(function (root) {
  const DB_NAME = 'crewclock';
  const OUTBOX = 'outbox';
  let dbPromise = null;
  const memory = {}; // fallback when IndexedDB is unavailable (private mode)

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(OUTBOX, { keyPath: 'id' });
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
    return dbPromise;
  }

  function tx(mode, fn) {
    return openDb().then((db) => new Promise((resolve, reject) => {
      if (!db) return resolve(fn(null));
      const t = db.transaction(OUTBOX, mode);
      const store = t.objectStore(OUTBOX);
      const out = fn(store);
      t.oncomplete = () => resolve(out && out.result !== undefined ? out.result : out);
      t.onerror = () => reject(t.error);
    }));
  }

  const outbox = {
    add(item) {
      item.queuedAt = item.queuedAt || Date.now();
      return tx('readwrite', (s) => { if (s) s.put(item); else memory[item.id] = item; return item; });
    },
    all() {
      return tx('readonly', (s) => (s ? s.getAll() : Object.values(memory)))
        .then((r) => (Array.isArray(r) ? r : []).sort((a, b) => a.queuedAt - b.queuedAt));
    },
    remove(ids) {
      return tx('readwrite', (s) => {
        ids.forEach((id) => { if (s) s.delete(id); else delete memory[id]; });
      });
    },
    get(id) {
      return tx('readonly', (s) => (s ? s.get(id) : memory[id]));
    },
  };

  const local = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem('cc.' + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return memory['ls.' + key] !== undefined ? memory['ls.' + key] : fallback;
      }
    },
    set(key, value) {
      try { localStorage.setItem('cc.' + key, JSON.stringify(value)); }
      catch (e) { memory['ls.' + key] = value; }
    },
    remove(key) {
      try { localStorage.removeItem('cc.' + key); } catch (e) { delete memory['ls.' + key]; }
    },
  };

  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  root.Store = { outbox, local, uid };
})(self);
