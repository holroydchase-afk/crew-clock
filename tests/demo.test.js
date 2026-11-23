// M1.1 demo separation, the parts that need no browser. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Loads the demo backend in a sandbox with its own localStorage, and a fetch that records every call.
function loadDemo() {
  const ls = new Map();
  /** @type {string[]} */
  const fetched = [];
  const ctx = /** @type {TestSandbox} */ (/** @type {unknown} */ ({
    Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (/** @type {string} */ k) => (ls.has(k) ? ls.get(k) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => ls.set(k, String(v)), removeItem: (/** @type {string} */ k) => ls.delete(k) },
    fetch: (/** @type {string} */ url) => { fetched.push(String(url)); return Promise.reject(new Error('network is off in this test')); },
  }));
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const db = () => JSON.parse(ls.get([...ls.keys()].find((k) => k.startsWith('cc.demo.db'))));
  return { ctx, db, fetched };
}

/** @param {number} n */
const decimals = (n) => (String(n).split('.')[1] || '').length;

test('SEP-6 every demo job pin has at most 3 decimal places (about 100 m, off any one house)', async () => {
  const { ctx, db } = loadDemo();
  await ctx.DemoBackend.handle('listCrew', {});
  const jobs = db().jobs;
  assert.ok(jobs.length >= 4, `only ${jobs.length} demo jobs seeded`);
  const precise = jobs.filter((/** @type {Job} */ j) => decimals(Number(j.lat)) > 3 || decimals(Number(j.lng)) > 3)
    .map((/** @type {Job} */ j) => `${j.id} ${j.name} (${j.lat}, ${j.lng})`);
  assert.deepStrictEqual(precise, [], `job pins with 4+ decimals: ${precise.join('; ')}`);
});

test('SEP-2 the demo address search answers from sample results, without calling any server', async () => {
  const { ctx, fetched } = loadDemo();
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  /** @type {ApiResult} */
  let res;
  try { res = await ctx.DemoBackend.handle('geocode', { auth, address: 'Main St, Hurricane WV' }); } catch (e) { res = { error: /** @type {Error} */ (e).message }; }
  assert.deepStrictEqual(fetched, [], `demo geocode fetched ${fetched.join(', ')}`);
  assert.ok(res && Array.isArray(res.results) && res.results.length > 0, `demo geocode gave ${JSON.stringify(res)}`);
  for (const r of res.results) {
    assert.ok(r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng), `bad result ${JSON.stringify(r)}`);
  }
});

// ---------- M1.10-b EVENING: a visitor at night sees a finished day, not a crew on the clock till 11 PM ----------

// Loads the demo backend with the clock stopped at `at` (local time) and returns the seeded punches.
/** @param {number} at @returns {Promise<Punch[]>} */
async function seedAt(at) {
  const RealDate = Date;
  class FixedDate extends RealDate {
    /** @param {number[]} a  any Date arguments; none means the fixed time */
    constructor(...a) { super(.../** @type {[number]} */ (a.length ? a : [at])); }
    static now() { return at; }
  }
  const ls = new Map();
  const ctx = /** @type {TestSandbox} */ (/** @type {unknown} */ ({
    Date: FixedDate, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (/** @type {string} */ k) => (ls.has(k) ? ls.get(k) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => ls.set(k, String(v)), removeItem: (/** @type {string} */ k) => ls.delete(k) },
  }));
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  await ctx.DemoBackend.handle('listCrew', {});
  const key = [...ls.keys()].find((k) => k.startsWith('cc.demo.db'));
  return JSON.parse(ls.get(key)).punches;
}
/** @param {number} ms */
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
/** @param {Punch[]} punches */
const onClock = (punches) => {
  /** @type {Record<string, Punch>} */
  const last = {};
  punches.filter((p) => p.type === 'in' || p.type === 'out').sort((a, b) => a.at - b.at).forEach((p) => { last[p.crewId] = p; });
  return Object.values(last).filter((p) => p.type === 'in').map((p) => p.crewId).sort();
};

for (const [label, h, m] of /** @type {[string, number, number][]} */ ([['6:00 PM', 18, 0], ['8:45 PM', 20, 45], ['11:20 PM', 23, 20]])) {
  test(`M1.10-b EVENING demo seeded at ${label}: the sample day is done (everyone clocked out by 4 PM, nothing before 6 AM)`, async () => {
    const now = new Date(2026, 9, 27, h, m).getTime();
    const punches = await seedAt(now);
    assert.deepStrictEqual(onClock(punches), [], `still on the clock at ${label}: ${onClock(punches).join(', ')}`);
    for (const crewId of [...new Set(punches.filter((p) => p.type === 'in').map((p) => p.crewId))]) {
      const ins = punches.filter((p) => p.crewId === crewId && p.type === 'in').length;
      const outs = punches.filter((p) => p.crewId === crewId && p.type === 'out').length;
      assert.ok(outs >= ins, `${crewId} has ${ins} clock-in(s) and ${outs} clock-out(s)`);
    }
    for (const p of punches) {
      const d = new Date(p.at);
      const mins = d.getHours() * 60 + d.getMinutes();
      assert.ok(mins >= 6 * 60, `${p.crewId} ${p.type} at ${hhmm(p.at)} is before 6 AM`);
      if (p.type === 'out') assert.ok(mins <= 16 * 60, `${p.crewId} clocks out at ${hhmm(p.at)}, after 4 PM`);
    }
  });
}

test('M1.10-b EVENING (guard) demo seeded at 1:30 PM keeps Ray, Jake and Cody on the clock', async () => {
  const punches = await seedAt(new Date(2026, 9, 27, 13, 30).getTime());
  assert.deepStrictEqual(onClock(punches), ['c1', 'c2', 'c3'], `on the clock at 1:30 PM: ${onClock(punches).join(', ')}`);
});

// PS-M110-1: a crew build that fell back to demo (backend 'supabase', no URL) must never get the
// sample chat or its sample keys, the same guard as fakeGps and forgetCrewApp.
test('PS-M110-1 the sample chat seeds only in a real demo build', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'js/messenger.js'), 'utf8');
  const body = src.slice(src.indexOf('async function seedDemoChat'), src.indexOf('const sync = '));
  assert.match(body.split('\n')[1], /Api\.isDemo/);
  assert.match(body.split('\n')[1], /cfg\.backend\s*!==\s*'demo'/);
});

// RST-1 flake (1 in 6 runs): a demo request still in flight when the visitor taps "Reset sample data"
// wrote the visit back into the fresh store, so after the reload Travis K. was still on the clock.
test('RST-2 a demo request in flight during "Reset sample data" never writes the visit back', async () => {
  const { ctx } = loadDemo();
  const store = () => { const k = ['cc.demo.db.v6', 'cc.demo.db.v7', 'cc.demo.db.v8'].find((x) => ctx.localStorage.getItem(x)); return k && ctx.localStorage.getItem(k); };
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c5' });
  const punch = { kind: 'punch', id: 'rst-2-punch', crewId: 'c5', jobId: 'j1', type: 'in', at: Date.now(), lat: 38.454, lng: -81.929, accuracy: 8 };
  const inFlight = ctx.DemoBackend.handle('sync', { auth, items: [punch] }).catch(() => null);
  ctx.DemoBackend.reset();
  await inFlight;
  const raw = store();
  const kept = raw ? JSON.parse(raw).punches.filter((/** @type {Punch} */ p) => p.id === punch.id) : [];
  assert.deepStrictEqual(kept, [], 'the reset store holds the punch sent just before the reset');
});
