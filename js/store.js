// On-phone storage. The outbox (punches, job and crew edits waiting to send)
// lives in IndexedDB because photos can be large; small settings use localStorage.
(function (root) {
  const DB_NAME = 'crewclock';
  const OUTBOX = 'outbox';
  let dbPromise = null;
  const memory = {}; // fallback when IndexedDB is unavailable (private mode)
  let volatile = null; // true once a storage write has failed: nothing here outlives the tab

  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(OUTBOX, { keyPath: 'id' });
        };
        req.onsuccess = () => {
          // Let "Reset sample data" delete the database instead of waiting on this open connection
          req.result.onversionchange = () => { req.result.close(); dbPromise = null; };
          resolve(req.result);
        };
        req.onerror = () => { volatile = true; resolve(null); };
      } catch (e) {
        volatile = true;
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
      // A request resolves to its result, even when that is undefined (a get() that found nothing).
      const isReq = typeof IDBRequest !== 'undefined' && out instanceof IDBRequest;
      t.oncomplete = () => resolve(isReq ? out.result : out);
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
      catch (e) { memory['ls.' + key] = value; volatile = true; }
    },
    remove(key) {
      try { localStorage.removeItem('cc.' + key); } catch (e) { delete memory['ls.' + key]; }
    },
  };

  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    // Older phones (iOS before 15.4): build a v4 UUID by hand.
    const b = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }

  // Private mode on some phones: storage is there but every write throws (HRD-13). Checked once
  // with a throwaway key, then kept true if any later write fails.
  function isVolatile() {
    if (volatile === null) {
      try {
        localStorage.setItem('cc.probe', '1');
        localStorage.removeItem('cc.probe');
        volatile = false;
      } catch (e) {
        volatile = true;
      }
    }
    return volatile;
  }

  root.Store = { outbox, local, uid, isVolatile };
})(self);
