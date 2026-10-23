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
