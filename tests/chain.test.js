const test = require('node:test');
const assert = require('node:assert');
const Chain = require('../js/chain.js');

const base = { id: 'p1', deviceId: 'd1', crewId: 'c1', jobId: 'j1', type: 'in', at: 1761130000000,
  lat: 38.4537123, lng: -81.929011, accuracy: 8.24 };

test('signed punch verifies and links to genesis', async () => {
  const keys = await Chain.generateKey();
  const jwk = await Chain.exportPublic(keys.publicKey);
  const p = await Chain.signPunch(base, keys.privateKey, { seq: 0, hash: 'genesis' });
  assert.strictEqual(p.seq, 1);
  const r = await Chain.verifyPunch(p, jwk, { seq: 0, hash: 'genesis' });
  assert.deepStrictEqual(r, { ok: true, chain: 'linked' });
});

test('private key cannot be exported', async () => {
  const keys = await Chain.generateKey();
  await assert.rejects(Chain.exportPublic(keys.privateKey));
});

test('editing any field after signing is caught', async () => {
  const keys = await Chain.generateKey();
  const jwk = await Chain.exportPublic(keys.publicKey);
  const p = await Chain.signPunch(base, keys.privateKey, { seq: 0, hash: 'genesis' });
  for (const [k, v] of [['at', base.at - 3600000], ['lat', 38.5], ['jobId', 'j2'], ['type', 'out']]) {
    const forged = Object.assign({}, p, { [k]: v });
    const r = await Chain.verifyPunch(forged, jwk, null);
    assert.strictEqual(r.ok, false, k);
  }
  // re-hashing the forged punch doesn't help without the private key
  const forged = Object.assign({}, p, { at: base.at - 3600000 });
  forged.hash = await Chain.sha256(Chain.canonical(forged));
  assert.strictEqual((await Chain.verifyPunch(forged, jwk, null)).reason, 'bad_signature');
});

test('another phone key cannot sign for this device', async () => {
  const a = await Chain.generateKey();
  const b = await Chain.generateKey();
  const p = await Chain.signPunch(base, b.privateKey, { seq: 0, hash: 'genesis' });
  const r = await Chain.verifyPunch(p, await Chain.exportPublic(a.publicKey), null);
  assert.strictEqual(r.reason, 'bad_signature');
});

test('a deleted punch shows as a chain gap; a replay is spotted', async () => {
  const keys = await Chain.generateKey();
  const jwk = await Chain.exportPublic(keys.publicKey);
  const p1 = await Chain.signPunch(base, keys.privateKey, { seq: 0, hash: 'genesis' });
  const p2 = await Chain.signPunch(Object.assign({}, base, { id: 'p2', type: 'out' }), keys.privateKey, { seq: 1, hash: p1.hash });
  const p3 = await Chain.signPunch(Object.assign({}, base, { id: 'p3' }), keys.privateKey, { seq: 2, hash: p2.hash });
  assert.strictEqual((await Chain.verifyPunch(p2, jwk, { seq: 1, hash: p1.hash })).chain, 'linked');
  assert.strictEqual((await Chain.verifyPunch(p3, jwk, { seq: 1, hash: p1.hash })).chain, 'gap');
  assert.strictEqual((await Chain.verifyPunch(p1, jwk, { seq: 2, hash: p2.hash })).chain, 'replay_or_old');
});
