// Generated from js/chain.ts by npm run build. Do not edit.
(function(root) {
  const VERSION = 1;
  const enc = new TextEncoder();
  const subtle = () => root.crypto && root.crypto.subtle || require("node:crypto").webcrypto.subtle;
  const ALG = { name: "ECDSA", namedCurve: "P-256" };
  const SIGN = { name: "ECDSA", hash: "SHA-256" };
  function b64url(bytes) {
    let s = "";
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64url(str) {
    const s = atob(str.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((str.length + 3) % 4));
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function canonical(p) {
    const n = (v, d) => v == null ? null : Math.round(v * 10 ** d) / 10 ** d;
    return JSON.stringify([
      VERSION,
      p.id,
      p.deviceId,
      p.crewId,
      p.byCrewId || p.crewId,
      p.jobId || null,
      p.type,
      p.at,
      n(p.lat, 7),
      n(p.lng, 7),
      n(p.accuracy, 1),
      p.voidsId || null,
      p.photoSha256 || null,
      p.seq,
      p.prevHash
    ]);
  }
  async function sha256(str) {
    return b64url(await subtle().digest("SHA-256", enc.encode(str)));
  }
  async function sha256Bytes(bytes) {
    return b64url(await subtle().digest("SHA-256", bytes));
  }
  function generateKey() {
    return subtle().generateKey(ALG, false, ["sign", "verify"]);
  }
  function exportPublic(publicKey) {
    return subtle().exportKey("jwk", publicKey);
  }
  async function signPunch(p, privateKey, prev) {
    const out = Object.assign({}, p, { seq: prev.seq + 1, prevHash: prev.hash });
    const c = canonical(out);
    out.hash = await sha256(c);
    out.signature = b64url(await subtle().sign(SIGN, privateKey, enc.encode(c)));
    return out;
  }
  async function verifyPunch(p, publicJwk, expected) {
    const c = canonical(p);
    if (await sha256(c) !== p.hash) return { ok: false, reason: "hash_mismatch" };
    const key = await subtle().importKey("jwk", publicJwk, ALG, false, ["verify"]);
    const good = await subtle().verify(SIGN, key, fromB64url(p.signature), enc.encode(c));
    if (!good) return { ok: false, reason: "bad_signature" };
    if (expected) {
      const seq = p.seq == null ? NaN : p.seq;
      if (seq <= expected.seq) return { ok: true, chain: "replay_or_old", reason: "seq_not_newer" };
      if (seq !== expected.seq + 1 || p.prevHash !== expected.hash) return { ok: true, chain: "gap" };
    }
    return { ok: true, chain: "linked" };
  }
  async function verifyAll(punches, keys) {
    const out = {};
    const byDevice = {};
    for (const p of punches) {
      if (!p.signature || !p.hash) {
        out[p.id] = "unsigned";
        continue;
      }
      const key = keys && keys[String(p.deviceId)];
      if (!key) {
        out[p.id] = "unknown_device";
        continue;
      }
      let v;
      try {
        v = await verifyPunch(p, key);
      } catch (e) {
        v = { ok: false };
      }
      if (!v.ok) {
        out[p.id] = "changed";
        continue;
      }
      out[p.id] = "ok";
      const dev = String(p.deviceId);
      (byDevice[dev] = byDevice[dev] || []).push(p);
    }
    for (const list of Object.values(byDevice)) {
      list.sort((a, b) => Number(a.seq) - Number(b.seq));
      for (let i = 1; i < list.length; i++) {
        const prev = list[i - 1];
        const p = list[i];
        if (p.seq === prev.seq || p.seq === Number(prev.seq) + 1 && p.prevHash !== prev.hash) out[p.id] = "broken_chain";
      }
    }
    return out;
  }
  const api = { VERSION, canonical, sha256, sha256Bytes, generateKey, exportPublic, signPunch, verifyPunch, verifyAll, b64url, fromB64url };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Chain = api;
})(typeof self !== "undefined" ? self : globalThis);
