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

// ---------- UX-7: the demo seed must read as real shifts at any hour ----------

// Loads the demo backend with the clock stopped at `at` (local time) and returns the seeded punches.
async function seedAt(at) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    constructor(...a) { super(...(a.length ? a : [at])); }
    static now() { return at; }
  }
  const ls = new Map();
  const ctx = {
    Date: FixedDate, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  await ctx.DemoBackend.handle('listCrew', {});
  // The demo store key carries a version (cc.demo.db.v2 after the boss rename)
  const key = [...ls.keys()].find((k) => k.startsWith('cc.demo.db'));
  return { punches: JSON.parse(ls.get(key)).punches, Report: ctx.Report };
}

for (const [label, h, m] of [['6:30 AM', 6, 30], ['7:30 AM', 7, 30], ['9:15 AM', 9, 15], ['2:00 PM', 14, 0]]) {
  // M1.6 (showcase SC-2): before 9 AM the sample day is yesterday, which the boss's day list shows
  // as "Yesterday (sample day)", so every time on screen is a daytime time.
  test(`UX-7 demo seed at ${label}: every seeded shift lasts more than 1 h, in daytime, on the day the boss's list shows`, async () => {
    const now = new Date(2026, 9, 23, h, m).getTime();
    const { punches, Report } = await seedAt(now);
    const shifts = Report.pairShifts(punches);
    assert.ok(shifts.length >= 4, `only ${shifts.length} shifts seeded`);
    const today0 = Report.startOfDay(now);
    const shown0 = h < 9 ? Report.startOfDay(today0 - 1) : today0;
    for (const s of shifts) {
      const span = (s.outAt || now) - s.inAt;
      assert.ok(s.inAt && span > 3600000, `${s.crewId} shift is ${(span / 3600000).toFixed(2)} h (in ${new Date(s.inAt).toTimeString().slice(0, 5)})`);
      assert.ok(s.inAt >= shown0 && s.inAt < shown0 + 86400000, `${s.crewId} shift is not on the day the boss's list shows`);
      assert.ok((s.outAt || s.inAt) < now, `${s.crewId} shift ends in the future`);
      for (const at of [s.inAt, s.outAt].filter(Boolean)) {
        const hr = new Date(at).getHours();
        assert.ok(hr >= 6 && hr < 18, `${s.crewId} has a punch at ${new Date(at).toTimeString().slice(0, 5)}`);
      }
    }
  });
}

// ---------- UX-8: Today summary names each person once, with no ".." after "Ray T." ----------

test('UX-8 Today summary lists a person with two flagged shifts once and never ends a sentence with ".."', () => {
  const AI = require('../js/ai.js');
  const s = AI.plainSummary([
    { crewId: 'c1', jobId: 'j1', status: 'offsite', hours: 2 },
    { crewId: 'c1', jobId: 'j2', status: 'near', hours: 3 },
    { crewId: 'c2', jobId: 'j1', status: 'onsite', hours: 8 },
  ], { c1: 'Ray T.', c2: 'Jake R.' }, { j1: 'Smith kitchen', j2: 'Miller roof' }, ['Travis K.', 'Billy S.']);
  assert.strictEqual((s.match(/Ray T\./g) || []).length, 1, s);
  assert.ok(!/\.\./.test(s), s);
  assert.match(s, /Check Ray T\. /, s);
  assert.match(s, /Didn't clock in: Travis K\., Billy S\.$/, s);
});

// ---------- UX-16: text on the muted, green and red-soft tokens meets 4.5:1 in light and dark ----------

function cssTokens() {
  const css = fs.readFileSync(path.join(__dirname, '../css/app.css'), 'utf8');
  const block = (src) => Object.fromEntries([...src.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
  const light = block(css.match(/:root\s*\{([^}]*)\}/)[1]);
  const dark = Object.assign({}, light, block(css.match(/@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^}]*)\}/)[1]));
  return { light, dark };
}
function contrast(a, b) {
  const lum = (hex) => {
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('UX-16 muted, white-on-green and red-on-red-soft text meet 4.5:1 in light and dark', () => {
  const { light, dark } = cssTokens();
  const pairs = [
    ['light muted on bg', light.muted, light.bg], ['light muted on card', light.muted, light.card],
    ['light white on green-bg (CLOCK IN)', '#ffffff', light['green-bg']], ['dark white on green-bg (CLOCK IN)', '#ffffff', dark['green-bg']],
    ['light red on red-soft', light.red, light['red-soft']], ['dark red on red-soft', dark.red, dark['red-soft']],
    ['dark ink on red-soft (Not in yet names)', dark.ink, dark['red-soft']],
    ['dark muted on bg', dark.muted, dark.bg], ['dark muted on card', dark.muted, dark.card],
  ];
  const low = pairs.map(([n, fg, bg]) => [n, contrast(fg, bg)]).filter(([, r]) => r < 4.5);
  assert.deepStrictEqual(low.map(([n, r]) => `${n} ${r.toFixed(2)}:1`), []);
});
