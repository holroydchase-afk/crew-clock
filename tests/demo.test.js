// M1.1 demo separation, the parts that need no browser. Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

// Loads the demo backend in a sandbox with its own localStorage, and a fetch that records every call.
function loadDemo() {
  const ls = new Map();
  const fetched = [];
  const ctx = {
    Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
    fetch: (url) => { fetched.push(String(url)); return Promise.reject(new Error('network is off in this test')); },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const db = () => JSON.parse(ls.get([...ls.keys()].find((k) => k.startsWith('cc.demo.db'))));
  return { ctx, db, fetched };
}

const decimals = (n) => (String(n).split('.')[1] || '').length;

test('SEP-6 every demo job pin has at most 3 decimal places (about 100 m, off any one house)', async () => {
  const { ctx, db } = loadDemo();
  await ctx.DemoBackend.handle('listCrew', {});
  const jobs = db().jobs;
  assert.ok(jobs.length >= 4, `only ${jobs.length} demo jobs seeded`);
  const precise = jobs.filter((j) => decimals(j.lat) > 3 || decimals(j.lng) > 3)
    .map((j) => `${j.id} ${j.name} (${j.lat}, ${j.lng})`);
  assert.deepStrictEqual(precise, [], `job pins with 4+ decimals: ${precise.join('; ')}`);
});

test('SEP-2 the demo address search answers from sample results, without calling any server', async () => {
  const { ctx, fetched } = loadDemo();
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  let res;
  try { res = await ctx.DemoBackend.handle('geocode', { auth, address: 'Main St, Hurricane WV' }); } catch (e) { res = { error: e.message }; }
  assert.deepStrictEqual(fetched, [], `demo geocode fetched ${fetched.join(', ')}`);
  assert.ok(res && Array.isArray(res.results) && res.results.length > 0, `demo geocode gave ${JSON.stringify(res)}`);
  for (const r of res.results) {
    assert.ok(r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng), `bad result ${JSON.stringify(r)}`);
  }
});

// ---------- M1.10-b EVENING: a visitor at night sees a finished day, not a crew on the clock till 11 PM ----------

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
  const key = [...ls.keys()].find((k) => k.startsWith('cc.demo.db'));
  return JSON.parse(ls.get(key)).punches;
}
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);
const onClock = (punches) => {
  const last = {};
  punches.filter((p) => p.type === 'in' || p.type === 'out').sort((a, b) => a.at - b.at).forEach((p) => { last[p.crewId] = p; });
  return Object.values(last).filter((p) => p.type === 'in').map((p) => p.crewId).sort();
};

for (const [label, h, m] of [['6:00 PM', 18, 0], ['8:45 PM', 20, 45], ['11:20 PM', 23, 20]]) {
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
