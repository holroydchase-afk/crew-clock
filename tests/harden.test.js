// M1.5 hardening: unit-level tests for the HRD tickets. Run: node --test tests/harden.test.js
// Browser-level cases for the same tickets live in tests/e2e-harden.js.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Risk = require('../js/risk.js');

// ---------- HRD-6: one bad photo must not block the rest of the outbox ----------

// Loads js/api-supabase.js in a sandbox with a fake Supabase, a fake Backblaze and a fake outbox.
function loadSupabaseApi({ b2Status }) {
  const SB = 'https://fake.supabase.test';
  const calls = { sync: [], uploads: 0, puts: 0 };
  const ls = new Map([['cc.sbSession', JSON.stringify({
    accessToken: 'at', refreshToken: 'rt', expiresAt: Date.now() + 3600000, crewId: 'jake', me: { id: 'jake', role: 'crew' },
  })]]);
  const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, opts) => {
    if (url === `${SB}/functions/v1/photo-upload`) {
      calls.uploads++;
      const { punchId } = JSON.parse(opts.body);
      return json({ ok: true, key: `org/day/${punchId}.jpg`, url: `https://b2.test/${punchId}` });
    }
    if (url.startsWith('https://b2.test/')) {
      calls.puts++;
      return { ok: b2Status < 400, status: b2Status };
    }
    if (url === `${SB}/functions/v1/sync`) {
      const items = JSON.parse(opts.body).items;
      calls.sync.push(items);
      return json({ ok: true, accepted: items.map((i) => i.id), rejected: [], reasons: [] });
    }
    throw new Error('unexpected fetch ' + url);
  };
  const sandbox = {
    APP_CONFIG: { backend: 'supabase', supabaseUrl: SB, supabaseAnonKey: 'anon' },
    Store: { outbox: { add: async (it) => it }, local: { get: (k, d) => d, set() {} } },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) },
    fetch, Blob, atob, URLSearchParams, AbortController, setTimeout, clearTimeout, console,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/api-supabase.js'), 'utf8'), sandbox);
  return { api: sandbox.SupabaseApi, calls };
}

const PHOTO = 'data:image/jpeg;base64,' + Buffer.from('not really a jpeg').toString('base64');
const punch = (id, extra) => Object.assign({ kind: 'punch', id, crewId: 'jake', jobId: 'j1', type: 'in', at: Date.now() }, extra);

test('HRD-6 a punch whose photo upload keeps failing does not stop the other punches in the batch', async () => {
  const { api, calls } = loadSupabaseApi({ b2Status: 503 });
  const stuck = punch('p-photo', { photo: PHOTO });
  const fine = punch('p-plain');
  let res;
  await assert.doesNotReject(async () => { res = await api.sync({ crewId: 'jake' }, [stuck, fine]); },
    'sync threw for the whole batch because one photo upload failed');
  const sent = calls.sync.flat().map((i) => i.id);
  assert.ok(sent.includes('p-plain'), `the photo-less punch never reached the server (sent: ${JSON.stringify(sent)})`);
  assert.ok(!(res.accepted || []).includes('p-photo'), 'the punch with the failed photo must stay queued for a retry');
});

test('HRD-6 (guard) when every photo uploads, the batch still sends with photo keys and no photo data', async () => {
  const { api, calls } = loadSupabaseApi({ b2Status: 200 });
  await api.sync({ crewId: 'jake' }, [punch('p-photo', { photo: PHOTO }), punch('p-plain')]);
  const sent = calls.sync.flat();
  assert.deepStrictEqual(sent.map((i) => i.id), ['p-photo', 'p-plain']);
  assert.strictEqual(sent[0].photoKey, 'org/day/p-photo.jpg');
  assert.strictEqual(sent[0].photo, undefined);
});

// ---------- HRD-9: a foreman's teammate punch with no photo is flagged high risk ----------

const NOON = Date.parse('2026-10-21T12:00:00-04:00');
const noPhoto = { photo: null, photoKey: null, hasPhoto: false };
const withPhoto = { photo: PHOTO, photoKey: 'org/day/x.jpg', hasPhoto: true };
const mate = (extra) => Object.assign({ id: 'm1', crewId: 'cody', byCrewId: 'ray', jobId: 'j1', type: 'in', at: NOON, lat: null, lng: null, accuracy: null }, extra);

test('HRD-9 foreman clocks in a teammate without a photo: the punch is flagged high risk', () => {
  const flags = Risk.assess(mate(noPhoto), { receivedAt: NOON + 30000 });
  assert.strictEqual(Risk.topLevel(flags), 'high', `flags were ${JSON.stringify(flags)}`);
});

test('HRD-9 (guard) a teammate punch with a photo is not flagged high', () => {
  assert.notStrictEqual(Risk.topLevel(Risk.assess(mate(withPhoto), { receivedAt: NOON + 30000 })), 'high');
});

test('HRD-9 (guard) a worker clocking themselves in with no photo is not flagged high', () => {
  assert.notStrictEqual(Risk.topLevel(Risk.assess(mate(Object.assign({ byCrewId: 'cody' }, noPhoto)), { receivedAt: NOON + 30000 })), 'high');
});

// ---------- PS-6: the server never gets `photo`, so "no picture" means no photoKey ----------

test('PS-6 foreman teammate punch with every photo field omitted (what the server sees) is flagged high', () => {
  const p = mate({}); // no photo, photoKey or hasPhoto key at all
  const flags = Risk.assess(p, { receivedAt: NOON + 30000 });
  assert.ok(flags.some((f) => f.code === 'teammate_no_photo'), `flags were ${JSON.stringify(flags)}`);
  assert.strictEqual(Risk.topLevel(flags), 'high');
});

test('PS-6 (guard) foreman teammate punch that arrives with only a photoKey is not flagged teammate_no_photo', () => {
  const flags = Risk.assess(mate({ photoKey: 'org/day/m1.jpg' }), { receivedAt: NOON + 30000 });
  assert.ok(!flags.some((f) => f.code === 'teammate_no_photo'), `flags were ${JSON.stringify(flags)}`);
});

test('PS-6 (guard) a worker clocking themselves in with every photo field omitted is not flagged teammate_no_photo', () => {
  const flags = Risk.assess(mate({ byCrewId: 'cody' }), { receivedAt: NOON + 30000 });
  assert.ok(!flags.some((f) => f.code === 'teammate_no_photo'), `flags were ${JSON.stringify(flags)}`);
});
