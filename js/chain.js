// Tamper-evident punches. Each phone holds a P-256 key that cannot be exported;
// every punch is signed and carries the hash of the phone's previous punch, so
// a punch edited or deleted after the fact breaks the chain.
// Runs in browsers, Deno (Edge Functions) and Node 20+ (tests): WebCrypto only.
(function (root) {
  const VERSION = 1;
  const enc = new TextEncoder();
  const subtle = () => (root.crypto && root.crypto.subtle) || require('node:crypto').webcrypto.subtle;
  const ALG = { name: 'ECDSA', namedCurve: 'P-256' };
  const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

  /** @param {ArrayBuffer | Uint8Array} bytes */
  function b64url(bytes) {
    let s = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  /** @param {string} str */
  function fromB64url(str) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Fixed field order; numbers rounded so every runtime serializes them the same.
  /** @param {Punch} p */
  function canonical(p) {
    /** @param {number | null | undefined} v @param {number} d */
    const n = (v, d) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
    return JSON.stringify([VERSION, p.id, p.deviceId, p.crewId, p.byCrewId || p.crewId, p.jobId || null,
      p.type, p.at, n(p.lat, 7), n(p.lng, 7), n(p.accuracy, 1), p.voidsId || null,
      p.photoSha256 || null, p.seq, p.prevHash]);
  }

  /** @param {string} str */
  async function sha256(str) {
    return b64url(await subtle().digest('SHA-256', enc.encode(str)));
  }

  // For photos: hash the JPEG bytes themselves, so the stored file can be checked later.
  /** @param {BufferSource} bytes */
  async function sha256Bytes(bytes) {
    return b64url(await subtle().digest('SHA-256', bytes));
  }

  /** @returns {Promise<CryptoKeyPair>} */
  function generateKey() {
    // extractable=false: the private key can be used but never read out, even by this app.
    return subtle().generateKey(ALG, false, ['sign', 'verify']);
  }

  /** @param {CryptoKey} publicKey */
  function exportPublic(publicKey) {
    return subtle().exportKey('jwk', publicKey);
  }

  // prev = { seq, hash } of this phone's last signed punch ({0, 'genesis'} for the first).
  /**
   * @template {Punch} P
   * @param {P} p @param {CryptoKey} privateKey @param {{ seq: number, hash: string }} prev
   * @returns {Promise<P & { seq: number, prevHash: string, hash: string, signature: string }>}
   */
  async function signPunch(p, privateKey, prev) {
    const out = /** @type {P & { seq: number, prevHash: string, hash: string, signature: string }} */ (
      Object.assign({}, p, { seq: prev.seq + 1, prevHash: prev.hash }));
    const c = canonical(out);
    out.hash = await sha256(c);
    out.signature = b64url(await subtle().sign(SIGN, privateKey, enc.encode(c)));
    return out;
  }

  // expected = { seq, hash } the server last saw from this device.
  /**
   * @param {Punch} p @param {JsonWebKey} publicJwk @param {{ seq: number, hash: string } | null} [expected]
   * @returns {Promise<{ ok: boolean, chain?: string, reason?: string }>}
   */
  async function verifyPunch(p, publicJwk, expected) {
    const c = canonical(p);
    if ((await sha256(c)) !== p.hash) return { ok: false, reason: 'hash_mismatch' };
    const key = await subtle().importKey('jwk', publicJwk, ALG, false, ['verify']);
    const good = await subtle().verify(SIGN, key, fromB64url(/** @type {string} */ (p.signature)), enc.encode(c));
    if (!good) return { ok: false, reason: 'bad_signature' };
    if (expected) {
      const seq = p.seq == null ? NaN : p.seq;
      if (seq <= expected.seq) return { ok: true, chain: 'replay_or_old', reason: 'seq_not_newer' };
      if (seq !== expected.seq + 1 || p.prevHash !== expected.hash) return { ok: true, chain: 'gap' };
    }
    return { ok: true, chain: 'linked' };
  }

  // Checks a whole list at once, the way the boss's screen shows it (M1.13 ENH-1).
  // keys: { deviceId: public JWK }. Returns { punchId: 'ok' | 'changed' | 'broken_chain' |
  // 'unsigned' | 'unknown_device' }. 'changed': the punch no longer matches what its phone signed.
  // 'broken_chain': signed, but it doesn't point at the punch before it from the same phone.
  // A punch missing from the list (older than the window) is not counted against the next one.
  /**
   * @param {Punch[]} punches @param {Record<string, JsonWebKey> | null | undefined} keys
   * @returns {Promise<Record<string, string>>}
   */
  async function verifyAll(punches, keys) {
    /** @type {Record<string, string>} */
    const out = {};
    /** @type {Record<string, Punch[]>} */
    const byDevice = {};
    for (const p of punches) {
      if (!p.signature || !p.hash) { out[p.id] = 'unsigned'; continue; }
      const key = keys && keys[String(p.deviceId)];
      if (!key) { out[p.id] = 'unknown_device'; continue; }
      let v;
      try { v = await verifyPunch(p, key); } catch (e) { v = { ok: false }; }
      if (!v.ok) { out[p.id] = 'changed'; continue; }
      out[p.id] = 'ok';
      const dev = String(p.deviceId);
      (byDevice[dev] = byDevice[dev] || []).push(p);
    }
    for (const list of Object.values(byDevice)) {
      list.sort((a, b) => Number(a.seq) - Number(b.seq));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const p = list[i];
        if (p.seq === prev.seq || (p.seq === Number(prev.seq) + 1 && p.prevHash !== prev.hash)) out[p.id] = 'broken_chain';
      }
    }
    return out;
  }

  const api = { VERSION, canonical, sha256, sha256Bytes, generateKey, exportPublic, signPunch, verifyPunch, verifyAll, b64url, fromB64url };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Chain = api;
})(typeof self !== 'undefined' ? self : globalThis);
