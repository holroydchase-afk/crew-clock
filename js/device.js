// This phone's identity: a random device id and a P-256 key pair whose private
// half cannot be exported. Every punch is signed and chained (see chain.js).
(function (root) {
  const DB = 'crewclock-keys';
  const STORE = 'device';
  let cached = null;

  function idb(mode, fn) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => {
        const t = req.result.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => resolve(r && r.result);
        t.onerror = () => reject(t.error);
      };
    });
  }

  function supported() {
    return !!(root.crypto && root.crypto.subtle && root.indexedDB && root.Chain);
  }

  async function get() {
    if (cached) return cached;
    if (!supported()) return null;
    let d = await idb('readonly', (s) => s.get('me')).catch(() => null);
    if (!d) {
      const keys = await root.Chain.generateKey();
      d = {
        id: root.Store.uid(),
        privateKey: keys.privateKey, // CryptoKey, stored as-is; IndexedDB keeps it non-extractable
        publicJwk: await root.Chain.exportPublic(keys.publicKey),
        seq: 0,
        hash: 'genesis',
      };
      await idb('readwrite', (s) => s.put(d, 'me'));
    }
    cached = d;
    return d;
  }

  // Signs and advances the chain. Calls are serialized so two quick taps can't share a seq.
  let queue = Promise.resolve();
  function sign(punch) {
    const run = queue.then(async () => {
      const d = await get();
      if (!d) return punch;
      const p = Object.assign({}, punch, { deviceId: d.id });
      if (p.photo) p.photoSha256 = await root.Chain.sha256Bytes(root.Chain.fromB64url(p.photo.split(',')[1]));
      const signed = await root.Chain.signPunch(p, d.privateKey, { seq: d.seq, hash: d.hash });
      d.seq = signed.seq;
      d.hash = signed.hash;
      await idb('readwrite', (s) => s.put(d, 'me'));
      return signed;
    });
    queue = run.catch(() => {});
    return run;
  }

  async function publicInfo() {
    const d = await get();
    return d ? { deviceId: d.id, publicKey: d.publicJwk } : null;
  }

  root.Device = { get, sign, publicInfo, supported };
})(self);
