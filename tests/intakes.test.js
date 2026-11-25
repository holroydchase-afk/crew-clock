// M2.0.5 intakes #56, #53 (EF-CK-1, EF-CK-11) and #57: the parts that need no browser.
// Spec: docs/product/SPEC-INTAKES-2026-11-25.md (CRW-1 to CRW-16). The browser halves (CRW-6, CRW-7,
// CRW-8's screen, CRW-14, CRW-16) are in tests/e2e-intakes.js. Every clock here is pinned to
// 2026-11-25 local time, never today's date. Run: node --test tests/intakes.test.js
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
/** @param {string} f */
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

/** 2026-11-25 at h:m, local time. @param {number} h @param {number} [m] */
const AT = (h, m = 0) => new Date(2026, 10, 25, h, m, 0, 0).getTime();
/** @param {number} ms */
const hhmm = (ms) => new Date(ms).toTimeString().slice(0, 5);

// CRW-1: the made-up town's box, in rural Kansas, nowhere near the crew.
const BOX = { latMin: 38.7, latMax: 38.95, lngMin: -98.4, lngMax: -98.0 };
/** @param {number} lat @param {number} lng */
const inBox = (lat, lng) => lat >= BOX.latMin && lat <= BOX.latMax && lng >= BOX.lngMin && lng <= BOX.lngMax;
/** @param {number} n */
const decimals = (n) => (String(n).split('.')[1] || '').length;
/** Metres between two pins. @param {{ lat: number, lng: number }} a @param {{ lat: number, lng: number }} b */
function metres(a, b) {
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
}

/**
 * The demo backend in a sandbox with its own localStorage and a clock the test moves.
 * @param {number} start
 */
function demoAt(start) {
  let now = start;
  const RealDate = Date;
  class FixedDate extends RealDate {
    /** @param {number[]} a  any Date arguments; none means the pinned time */
    constructor(...a) { super(.../** @type {[number]} */ (a.length ? a : [now])); }
    static now() { return now; }
  }
  const ls = new Map();
  /** @type {string[]} */
  const fetched = [];
  const ctx = /** @type {TestSandbox} */ (/** @type {unknown} */ ({
    Date: FixedDate, Math, JSON, Promise, setTimeout, clearTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (/** @type {string} */ k) => (ls.has(k) ? ls.get(k) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => ls.set(k, String(v)), removeItem: (/** @type {string} */ k) => ls.delete(k) },
    fetch: (/** @type {string} */ url) => { fetched.push(String(url)); return Promise.reject(new Error('network is off in this test')); },
  }));
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  const key = () => [...ls.keys()].find((k) => k.startsWith('cc.demo.db'));
  return {
    ctx, ls, fetched, key,
    /** @param {number} t */
    setNow: (t) => { now = t; },
    /** @returns {DemoDb} */
    db: () => JSON.parse(ls.get(/** @type {string} */ (key()))),
    /** @param {DemoDb} db */
    write: (db) => ls.set(/** @type {string} */ (key()), JSON.stringify(db)),
  };
}

// ---------- #56 made-up town and pins ----------

test('CRW-1 seed at 2026-11-25 10:00: 4 jobs in "Fernhollow (sample town)", no ", WV", pins of at most 3 decimals inside the rural Kansas box', async () => {
  const d = demoAt(AT(10));
  await d.ctx.DemoBackend.handle('listCrew', {});
  const jobs = d.db().jobs;
  assert.strictEqual(jobs.length, 4, `expected 4 sample jobs, got ${jobs.length}`);
  const errs = [];
  for (const j of jobs) {
    const where = `${j.id} ${j.name} "${j.address}" (${j.lat}, ${j.lng})`;
    if (!String(j.address || '').endsWith('Fernhollow (sample town)')) errs.push(`address does not end "Fernhollow (sample town)": ${where}`);
    if (String(j.address || '').includes(', WV')) errs.push(`address names ", WV": ${where}`);
    if (decimals(Number(j.lat)) > 3 || decimals(Number(j.lng)) > 3) errs.push(`pin has more than 3 decimals: ${where}`);
    if (!inBox(Number(j.lat), Number(j.lng))) errs.push(`pin outside lat 38.700-38.950, lng -98.400 to -98.000: ${where}`);
  }
  assert.deepStrictEqual(errs, []);
});

test('CRW-2 the 4 pins are each at least 3 km apart, fit in a 30 km box, and the map default view centres among them', async () => {
  const d = demoAt(AT(10));
  await d.ctx.DemoBackend.handle('listCrew', {});
  const pins = d.db().jobs.map((j) => ({ id: j.id, lat: Number(j.lat), lng: Number(j.lng) }));
  const errs = [];
  // Given those 4 pins: the CRW-1 pins in the made-up town
  for (const p of pins) if (!inBox(p.lat, p.lng)) errs.push(`seed not moved: ${p.id} pin (${p.lat}, ${p.lng}) is outside the CRW-1 box`);
  for (let i = 0; i < pins.length; i++) {
    for (let k = i + 1; k < pins.length; k++) {
      const m = metres(pins[i], pins[k]);
      if (m < 3000) errs.push(`${pins[i].id}-${pins[k].id} only ${Math.round(m)} m apart`);
    }
  }
  const lats = pins.map((p) => p.lat);
  const lngs = pins.map((p) => p.lng);
  const box = { latMin: Math.min(...lats), latMax: Math.max(...lats), lngMin: Math.min(...lngs), lngMax: Math.max(...lngs) };
  const tall = metres({ lat: box.latMin, lng: box.lngMin }, { lat: box.latMax, lng: box.lngMin });
  const wide = metres({ lat: (box.latMin + box.latMax) / 2, lng: box.lngMin }, { lat: (box.latMin + box.latMax) / 2, lng: box.lngMax });
  if (tall > 30000 || wide > 30000) errs.push(`pins span ${Math.round(tall / 100) / 10} x ${Math.round(wide / 100) / 10} km, over 30 km`);
  // js/app.js: the boss map and the job form's map open on a fixed view when there is nothing to fit.
  const views = [...read('js/app.js').matchAll(/setView\(\[\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)]
    .map((m) => ({ lat: Number(m[1]), lng: Number(m[2]) }));
  if (views.length < 2) errs.push(`expected the 2 default map views in js/app.js, found ${views.length}`);
  for (const v of views) {
    if (!(v.lat >= box.latMin && v.lat <= box.latMax && v.lng >= box.lngMin && v.lng <= box.lngMax)) {
      errs.push(`map default view (${v.lat}, ${v.lng}) is outside the pins' box ${JSON.stringify(box)}`);
    }
  }
  assert.deepStrictEqual(errs, []);
});

// What each sample punch scored at 9adcf3b (21:30, so p6-p8 exist), and its offset from its job's pin
// in degrees. Kept as offsets only, so this file carries no old coordinate.
const BEFORE = /** @type {Record<string, { status: string, off: [number, number] | null }>} */ ({
  p1: { status: 'onsite', off: [0.00005, 0.00005] },
  p2: { status: 'onsite', off: [0.00032, 0.0004] },
  p3: { status: 'near', off: [0.0016, -0.0024] },
  p4: { status: 'nogps', off: null },
  p5: { status: 'onsite', off: [0.0002, 0] },
  p6: { status: 'onsite', off: [-0.00002, -0.00002] },
  p7: { status: 'onsite', off: [0.00021, 0.00029] },
  p8: { status: 'near', off: [0.00151, -0.00252] },
});

test('CRW-3 the moved seed at 2026-11-25 21:30: every job is in the new town, and p1-p8 keep their 9adcf3b geofence status and offset from the pin', async () => {
  const d = demoAt(AT(21, 30));
  await d.ctx.DemoBackend.handle('listCrew', {});
  const db = d.db();
  const errs = [];
  // Given the moved seed: every job pin is in the CRW-1 box
  for (const j of db.jobs) if (!inBox(Number(j.lat), Number(j.lng))) errs.push(`seed not moved: ${j.id} pin (${j.lat}, ${j.lng}) is outside the CRW-1 box`);
  for (const [id, was] of Object.entries(BEFORE)) {
    const p = db.punches.find((x) => x.id === id);
    if (!p) { errs.push(`${id} missing from the 21:30 seed`); continue; }
    if (p.status !== was.status) errs.push(`${id} status ${p.status}, was ${was.status}`);
    const job = /** @type {Job} */ (db.jobs.find((j) => j.id === p.jobId));
    if (was.off == null) {
      if (p.lat != null || p.lng != null) errs.push(`${id} had no GPS, now (${p.lat}, ${p.lng})`);
      continue;
    }
    const off = [Number(p.lat) - Number(job.lat), Number(p.lng) - Number(job.lng)];
    if (Math.abs(off[0] - was.off[0]) > 1e-6 || Math.abs(off[1] - was.off[1]) > 1e-6) {
      errs.push(`${id} offset from ${job.id} is ${off.map((x) => x.toFixed(5)).join(', ')}, was ${was.off.join(', ')}`);
    }
  }
  assert.deepStrictEqual(errs, []);
});

// The old place names, built from pieces so this file never matches its own search.
const OLD_NAMES = [['Te', 'ays'], ['Cross', ' Lanes'], ['Scott', ' Depot'], ['Hurri', 'cane'], ['Charles', 'ton']].map((p) => p.join(''));
const OLD_COORD = /38\.4\d+,\s*-8[12]\.\d+/;
// "The repo minus .git and node_modules": also skips the gitignored build and screenshot output.
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'dist-review', 'tests/shots', 'supabase/.temp']);
/** @param {string} rel @param {string[]} out */
function walk(rel, out) {
  for (const e of fs.readdirSync(path.join(ROOT, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) { if (!SKIP_DIRS.has(r)) walk(r, out); continue; }
    if (!e.isFile()) continue;
    const buf = fs.readFileSync(path.join(ROOT, r));
    if (buf.subarray(0, 8000).includes(0)) continue; // binary (images, fonts)
    out.push(r);
  }
  return out;
}

test('CRW-4 the repo has 0 hits for the old place names, js/ and tests/ have 0 old coordinates, and the demo store key is cc.demo.db.v8', async () => {
  const errs = [];
  for (const f of walk('', [])) {
    const lines = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n');
    lines.forEach((line, i) => {
      for (const n of OLD_NAMES) if (line.includes(n)) errs.push(`${f}:${i + 1} names "${n}"`);
      if ((f.startsWith('js/') || f.startsWith('tests/')) && OLD_COORD.test(line)) errs.push(`${f}:${i + 1} has an old coordinate`);
    });
  }
  const d = demoAt(AT(10));
  await d.ctx.DemoBackend.handle('listCrew', {});
  if (d.key() !== 'cc.demo.db.v8') errs.push(`demo store key is ${d.key()}, want cc.demo.db.v8`);
  assert.deepStrictEqual(errs, [], `${errs.length} hits:\n${errs.join('\n')}`);
});

test('CRW-5 demo geocode "Main St, Fernhollow" answers a "(sample)" place inside the CRW-1 box, with no network call', async () => {
  const d = demoAt(AT(10));
  const { auth } = await d.ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  const res = await d.ctx.DemoBackend.handle('geocode', { auth, address: 'Main St, Fernhollow' });
  assert.deepStrictEqual(d.fetched, [], `demo geocode fetched ${d.fetched.join(', ')}`);
  const first = res && Array.isArray(res.results) ? res.results[0] : null;
  assert.ok(first, `no geocode answer: ${JSON.stringify(res)}`);
  assert.ok(String(first.label).endsWith('(sample)'), `label "${first.label}" does not end "(sample)"`);
  assert.ok(inBox(Number(first.lat), Number(first.lng)), `answer "${first.label}" pin (${first.lat}, ${first.lng}) is outside the CRW-1 box`);
});

// ---------- EF-CK-1 evening top-up ----------

/** @param {DemoDb} db @param {string} crewId */
const outsOf = (db, crewId) => db.punches.filter((p) => p.crewId === crewId && p.type === 'out');
/** @param {DemoDb} db @param {string} crewId */
const lastOf = (db, crewId) => db.punches.filter((p) => p.crewId === crewId && p.type !== 'void').sort((a, b) => a.at - b.at).pop();

test('CRW-8 a store seeded at 14:00 and loaded twice at 21:30: Ray T., Jake R. and Cody M. each get exactly 1 clock-out (15:24, 15:30, 15:12)', async () => {
  const d = demoAt(AT(14));
  await d.ctx.DemoBackend.handle('listCrew', {});
  const before = d.db();
  assert.deepStrictEqual(['c1', 'c2', 'c3'].map((c) => outsOf(before, c).length), [0, 0, 0], 'at 14:00 c1-c3 should be on the clock');
  d.setNow(AT(21, 30));
  await d.ctx.DemoBackend.handle('listCrew', {});
  await d.ctx.DemoBackend.handle('listCrew', {});
  const db = d.db();
  const want = { c1: '15:24', c2: '15:30', c3: '15:12' };
  const errs = [];
  for (const [c, at] of Object.entries(want)) {
    const outs = outsOf(db, c);
    if (outs.length !== 1) errs.push(`${c} has ${outs.length} clock-outs, want 1`);
    else if (hhmm(outs[0].at) !== at) errs.push(`${c} clocked out at ${hhmm(outs[0].at)}, want ${at}`);
    const last = lastOf(db, c);
    if (!last || last.type !== 'out') errs.push(`${c} is still on the clock at 21:30 (last punch ${last && last.type})`);
  }
  assert.deepStrictEqual(errs, []);
});

test('CRW-8 a seeded worker the visitor already clocked out gets 0 extra clock-outs at 21:30 (never "clocked out twice")', async () => {
  const d = demoAt(AT(14));
  await d.ctx.DemoBackend.handle('listCrew', {});
  d.setNow(AT(16));
  const res = await d.ctx.DemoBackend.handle('sync', { auth: { crewId: 'c2', pin: '1111' }, items: [
    { kind: 'punch', id: 'visitor-out-c2', crewId: 'c2', jobId: 'j1', type: 'out', at: AT(16), lat: null, lng: null, accuracy: null },
  ] });
  assert.deepStrictEqual(Array.from(res.accepted || []), ['visitor-out-c2']);
  d.setNow(AT(21, 30));
  await d.ctx.DemoBackend.handle('listCrew', {});
  await d.ctx.DemoBackend.handle('listCrew', {});
  const db = d.db();
  assert.deepStrictEqual(outsOf(db, 'c2').map((p) => p.id), ['visitor-out-c2'], 'Jake R. got a second clock-out');
  // Precondition of the top-up itself: the two the visitor left alone are clocked out.
  assert.deepStrictEqual(['c1', 'c3'].map((c) => outsOf(db, c).length), [1, 1], 'c1 and c3 should each get their 1 clock-out');
});

test('CRW-8 an emptied store (0 punches, after the visitor voided them all) gets 0 punches added at 21:30', async () => {
  const d = demoAt(AT(14));
  await d.ctx.DemoBackend.handle('listCrew', {});
  const db = d.db();
  db.punches = [];
  d.write(db);
  d.setNow(AT(21, 30));
  await d.ctx.DemoBackend.handle('listCrew', {});
  await d.ctx.DemoBackend.handle('listCrew', {});
  assert.strictEqual(d.db().punches.length, 0);
});

test('CRW-8 edge: a store seeded before 9 AM (sample day is yesterday, already finished) gets no second clock-out at 21:30', async () => {
  const d = demoAt(AT(8));
  await d.ctx.DemoBackend.handle('listCrew', {});
  d.setNow(AT(21, 30));
  await d.ctx.DemoBackend.handle('listCrew', {});
  await d.ctx.DemoBackend.handle('listCrew', {});
  const db = d.db();
  assert.deepStrictEqual(['c1', 'c2', 'c3'].map((c) => outsOf(db, c).length), [1, 1, 1]);
});

// ---------- EF-CK-11 no Sheets route ----------

/**
 * js/api.js as index.html loads it, with a given config and a fetch that counts calls.
 * @param {AppConfig} cfg
 */
function apiWith(cfg) {
  const ls = new Map();
  /** @type {string[]} */
  const fetched = [];
  const supabase = /** @type {SupabaseApiShape} */ (/** @type {unknown} */ ({ marker: 'SupabaseApi' }));
  const ctx = /** @type {TestSandbox} */ (/** @type {unknown} */ ({
    Date, Math, JSON, Promise, setTimeout, clearTimeout, console, AbortController, navigator: { onLine: true },
    localStorage: { getItem: (/** @type {string} */ k) => (ls.has(k) ? ls.get(k) : null), setItem: (/** @type {string} */ k, /** @type {string} */ v) => ls.set(k, String(v)), removeItem: (/** @type {string} */ k) => ls.delete(k) },
    fetch: (/** @type {string} */ url) => { fetched.push(String(url)); return Promise.reject(new TypeError('Failed to fetch')); },
    APP_CONFIG: cfg,
    SupabaseApi: supabase,
  }));
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js', 'js/api.js']) {
    vm.runInContext(read(f), ctx, { filename: f });
  }
  return { ctx, fetched, supabase };
}

/** @param {AppConfig} cfg */
async function noSheetsRoute(cfg) {
  const { ctx, fetched } = apiWith(cfg);
  /** @type {AppError | null} */
  let err = null;
  try { await ctx.Api.listCrew(); } catch (e) { err = /** @type {AppError} */ (e); }
  const errs = [];
  if (!err) errs.push('listCrew resolved; want a rejection');
  else if (err.offline !== true) errs.push(`listCrew rejected without offline: true (${err.message})`);
  if (fetched.length !== 0) errs.push(`fetch called ${fetched.length} time(s): ${fetched.join(', ')}`);
  if (ctx.Api.isDemo !== false) errs.push(`Api.isDemo is ${ctx.Api.isDemo}, want false`);
  return errs;
}

test('CRW-10 backend "supabase" with no supabaseUrl and a backendUrl: listCrew rejects offline, 0 fetches, not the demo', async () => {
  assert.deepStrictEqual(await noSheetsRoute({ backend: 'supabase', supabaseUrl: '', backendUrl: 'https://sheets.example.invalid/exec' }), []);
});

test('CRW-11 backend "sheets" with a backendUrl: listCrew rejects offline, 0 fetches, not the demo', async () => {
  assert.deepStrictEqual(await noSheetsRoute({ backend: 'sheets', backendUrl: 'https://sheets.example.invalid/exec' }), []);
});

test('CRW-12 no regression: backend "demo" with no keys lists the 6 sample crew; "supabase" with a URL is SupabaseApi', async () => {
  const demo = apiWith({ backend: 'demo' });
  const res = await demo.ctx.Api.listCrew();
  assert.strictEqual(demo.ctx.Api.isDemo, true);
  assert.strictEqual((res.crew || []).length, 6, `demo listCrew gave ${JSON.stringify(res.crew)}`);
  assert.deepStrictEqual(demo.fetched, []);
  const sb = apiWith({ backend: 'supabase', supabaseUrl: 'https://project.example.invalid' });
  assert.strictEqual(sb.ctx.Api, sb.supabase, 'Api is not SupabaseApi');
});

/** @param {string[]} args @param {Record<string, string>} [extra] */
function build(args, extra = {}) {
  const env = { PATH: String(process.env.PATH), HOME: String(process.env.HOME || os.tmpdir()), ...extra };
  return spawnSync(process.execPath, [path.join(ROOT, 'scripts/build-site.mjs'), ...args], { cwd: ROOT, env, encoding: 'utf8' });
}
/** @param {string} name */
const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `crw-${name}-`));

test('CRW-13 a crew build with SHEETS_BACKEND_URL set fails with "Sheets backend is demo-only", and js/api.js has 0 fetch( calls', () => {
  const out = tmp('sheets');
  try {
    const r = build([out], { SHEETS_BACKEND_URL: 'https://sheets.example.invalid/exec' });
    const said = `${r.stdout}${r.stderr}`;
    assert.notStrictEqual(r.status, 0, `crew build with SHEETS_BACKEND_URL exited 0: ${said.trim()}`);
    assert.match(said, /Sheets backend is demo-only/);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  const calls = (read('js/api.js').match(/\bfetch\(/g) || []).length;
  assert.strictEqual(calls, 0, `js/api.js has ${calls} fetch( call(s)`);
});

test('CRW-13 other direction: a crew build without SHEETS_BACKEND_URL still builds', () => {
  const out = tmp('crew');
  try {
    const r = build([out]);
    assert.strictEqual(r.status, 0, `crew build failed: ${r.stdout}${r.stderr}`);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

// ---------- #57 portfolio header, demo build only ----------

const DEMO_BAR = '<script src="/assets/demo-bar.js" data-page="white" defer></script>';
/** @param {string} dir @returns {string[]} */
function filesIn(dir) {
  return fs.readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile()).map((e) => path.join(e.parentPath, e.name));
}

test('CRW-15 the --demo build has exactly 1 demo-bar tag directly before </body>; a crew build and sw.js SHELL_FILES have 0', () => {
  const demo = tmp('demo');
  const crew = tmp('crew');
  try {
    const d = build([demo, '--demo']);
    assert.strictEqual(d.status, 0, `demo build failed: ${d.stdout}${d.stderr}`);
    const html = fs.readFileSync(path.join(demo, 'index.html'), 'utf8');
    const count = html.split(DEMO_BAR).length - 1;
    assert.strictEqual(count, 1, `demo index.html has ${count} copies of ${DEMO_BAR}`);
    assert.match(html, /<script src="\/assets\/demo-bar\.js" data-page="white" defer><\/script>\s*<\/body>/, 'the tag is not directly before </body>');

    const c = build([crew]);
    assert.strictEqual(c.status, 0, `crew build failed: ${c.stdout}${c.stderr}`);
    const hits = filesIn(crew).filter((f) => !fs.readFileSync(f).subarray(0, 8000).includes(0) && fs.readFileSync(f, 'utf8').includes('demo-bar'))
      .map((f) => path.relative(crew, f));
    assert.deepStrictEqual(hits, [], 'crew build mentions demo-bar');
  } finally {
    fs.rmSync(demo, { recursive: true, force: true });
    fs.rmSync(crew, { recursive: true, force: true });
  }
  const m = read('sw.js').match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  assert.ok(m, 'sw.js has no SHELL_FILES');
  assert.ok(!m[1].includes('demo-bar'), 'sw.js SHELL_FILES caches demo-bar');
});
