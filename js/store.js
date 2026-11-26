// Generated from js/store.ts by npm run build. Do not edit.
(function(root) {
  const DB_NAME = "crewclock";
  const OUTBOX = "outbox";
  let dbPromise = null;
  const memory = {};
  let volatile = null;
  function openDb() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore(OUTBOX, { keyPath: "id" });
        };
        req.onsuccess = () => {
          req.result.onversionchange = () => {
            req.result.close();
            dbPromise = null;
          };
          resolve(req.result);
        };
        req.onerror = () => {
          volatile = true;
          resolve(null);
        };
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
      const isReq = typeof IDBRequest !== "undefined" && out instanceof IDBRequest;
      t.oncomplete = () => resolve(isReq ? out.result : out);
      t.onerror = () => reject(t.error);
    }));
  }
  const outbox = {
    add(item) {
      item.queuedAt = item.queuedAt || Date.now();
      return tx("readwrite", (s) => {
        if (s) s.put(item);
        else memory[item.id] = item;
        return item;
      });
    },
    all() {
      return tx("readonly", (s) => s ? s.getAll() : Object.values(memory)).then((r) => (Array.isArray(r) ? r : []).sort((a, b) => a.queuedAt - b.queuedAt));
    },
    remove(ids) {
      return tx("readwrite", (s) => {
        ids.forEach((id) => {
          if (s) s.delete(id);
          else delete memory[id];
        });
      });
    },
    get(id) {
      return tx("readonly", (s) => s ? s.get(id) : memory[id]);
    }
  };
  const local = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem("cc." + key);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) {
        return memory["ls." + key] !== void 0 ? memory["ls." + key] : fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem("cc." + key, JSON.stringify(value));
      } catch (e) {
        memory["ls." + key] = value;
        volatile = true;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem("cc." + key);
      } catch (e) {
        delete memory["ls." + key];
      }
    }
  };
  function uid() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    const b = new Uint8Array(16);
    if (root.crypto && root.crypto.getRandomValues) root.crypto.getRandomValues(b);
    else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
    b[6] = b[6] & 15 | 64;
    b[8] = b[8] & 63 | 128;
    const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  }
  function isVolatile() {
    if (volatile === null) {
      try {
        localStorage.setItem("cc.probe", "1");
        localStorage.removeItem("cc.probe");
        volatile = false;
      } catch (e) {
        volatile = true;
      }
    }
    return volatile;
  }
  root.Store = { outbox, local, uid, isVolatile };
})(self);
