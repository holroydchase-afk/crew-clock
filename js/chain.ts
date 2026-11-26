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

  function b64url(bytes: ArrayBuffer | Uint8Array) {
    let s = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str: string) {
    const s = atob(str.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }

  // Fixed field order; numbers rounded so every runtime serializes them the same.
  function canonical(p: Punch) {
    const n = (v: number | null | undefined, d: number) => (v == null ? null : Math.round(v * 10 ** d) / 10 ** d);
    return JSON.stringify([VERSION, p.id, p.deviceId, p.crewId, p.byCrewId || p.crewId, p.jobId || null,
      p.type, p.at, n(p.lat, 7), n(p.lng, 7), n(p.accuracy, 1), p.voidsId || null,
      p.photoSha256 || null, p.seq, p.prevHash]);
  }

  async function sha256(str: string) {
    return b64url(await subtle().digest('SHA-256', enc.encode(str)));
  }

  // For photos: hash the JPEG bytes themselves, so the stored file can be checked later.
  async function sha256Bytes(bytes: BufferSource) {
    return b64url(await subtle().digest('SHA-256', bytes));
  }

  function generateKey(): Promise<CryptoKeyPair> {
    // extractable=false: the private key can be used but never read out, even by this app.
    return subtle().generateKey(ALG, false, ['sign', 'verify']);
  }

  function exportPublic(publicKey: CryptoKey) {
    return subtle().exportKey('jwk', publicKey);
  }

  // prev = { seq, hash } of this phone's last signed punch ({0, 'genesis'} for the first).
  async function signPunch<P extends Punch>(p: P, privateKey: CryptoKey, prev: { seq: number, hash: string }): Promise<P & { seq: number, prevHash: string, hash: string, signature: string }> {
    const out = Object.assign({}, p, { seq: prev.seq + 1, prevHash: prev.hash }) as P & { seq: number, prevHash: string, hash: string, signature: string };
    const c = canonical(out);
    out.hash = await sha256(c);
    out.signature = b64url(await subtle().sign(SIGN, privateKey, enc.encode(c)));
    return out;
  }

  // expected = { seq, hash } the server last saw from this device.
  async function verifyPunch(p: Punch, publicJwk: JsonWebKey, expected?: { seq: number, hash: string } | null): Promise<{ ok: boolean, chain?: string, reason?: string }> {
    const c = canonical(p);
    if ((await sha256(c)) !== p.hash) return { ok: false, reason: 'hash_mismatch' };
    const key = await subtle().importKey('jwk', publicJwk, ALG, false, ['verify']);
    const good = await subtle().verify(SIGN, key, fromB64url(p.signature as string), enc.encode(c));
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
  async function verifyAll(punches: Punch[], keys: Record<string, JsonWebKey> | null | undefined): Promise<Record<string, string>> {
    const out: Record<string, string> = {};
    const byDevice: Record<string, Punch[]> = {};
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

// What require('./chain.js') returns (the tests, Node) and what globals.d.ts gives self.Chain.
// Type-only: the build erases `export declare`, so js/chain.js stays a classic script.
export declare const VERSION: number;
export declare function canonical(p: Punch): string;
export declare function sha256(str: string): Promise<string>;
export declare function sha256Bytes(bytes: BufferSource): Promise<string>;
export declare function generateKey(): Promise<CryptoKeyPair>;
export declare function exportPublic(publicKey: CryptoKey): Promise<JsonWebKey>;
export declare function signPunch<P extends Punch>(p: P, privateKey: CryptoKey, prev: { seq: number, hash: string }): Promise<P & { seq: number, prevHash: string, hash: string, signature: string }>;
export declare function verifyPunch(p: Punch, publicJwk: JsonWebKey, expected?: { seq: number, hash: string } | null): Promise<{ ok: boolean, chain?: string, reason?: string }>;
export declare function verifyAll(punches: Punch[], keys: Record<string, JsonWebKey> | null | undefined): Promise<Record<string, string>>;
export declare function b64url(bytes: ArrayBuffer | Uint8Array): string;
export declare function fromB64url(str: string): Uint8Array<ArrayBuffer>;
