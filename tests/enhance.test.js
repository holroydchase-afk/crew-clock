// M1.13 enhancements, the parts that need no browser. Run: node --test tests/
// ENH-1 visible tamper check (Chain.verifyAll and the signed demo seed), ENH-2 the demo's "No signal"
// switch, ENH-3 the weekly timesheet and its CSV.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Chain = require('../js/chain.js');

// ---------- ENH-1: Chain.verifyAll ----------
async function phone(n) {
  const keys = await Chain.generateKey();
  const pub = await Chain.exportPublic(keys.publicKey);
  let prev = { seq: 0, hash: 'genesis' };
  const out = [];
  for (let i = 0; i < n; i++) {
    const p = await Chain.signPunch({ id: 'p' + i, deviceId: 'd1', crewId: 'c2', jobId: 'j1', type: i % 2 ? 'out' : 'in',
      at: 1761000000000 + i * 3600000, lat: 38.454, lng: -81.929, accuracy: 9 }, keys.privateKey, prev);
    prev = { seq: p.seq, hash: p.hash };
    out.push(p);
  }
  return { punches: out, keys: { d1: pub } };
}

test('ENH-1 verifyAll: every signed, chained punch from a known phone is ok', async () => {
  const { punches, keys } = await phone(4);
  const r = await Chain.verifyAll(punches, keys);
  assert.deepStrictEqual(Object.values(r), ['ok', 'ok', 'ok', 'ok']);
});

test('ENH-1 verifyAll: a punch whose time was edited after it was sent is "changed", the rest stay ok', async () => {
  const { punches, keys } = await phone(4);
  punches[1] = Object.assign({}, punches[1], { at: punches[1].at - 30 * 60000 });
  const r = await Chain.verifyAll(punches, keys);
  assert.strictEqual(r.p1, 'changed');
  assert.deepStrictEqual([r.p0, r.p2, r.p3], ['ok', 'ok', 'ok']);
});

test('ENH-1 verifyAll: a punch put in with a re-made hash breaks the chain or the signature', async () => {
  const { punches, keys } = await phone(3);
  const forged = Object.assign({}, punches[1], { at: punches[1].at - 600000 });
  forged.hash = await Chain.sha256(Chain.canonical(forged));
  punches[1] = forged;
  const r = await Chain.verifyAll(punches, keys);
  assert.notStrictEqual(r.p1, 'ok', 'a re-hashed punch still needs the phone\'s signature');
});

test('ENH-1 verifyAll: a punch that does not point at the one before it is "broken_chain"', async () => {
  const keys = await Chain.generateKey();
  const pub = await Chain.exportPublic(keys.publicKey);
  const base = (i) => ({ id: 'p' + i, deviceId: 'd1', crewId: 'c2', jobId: 'j1', type: 'in', at: 1761000000000 + i * 3600000 });
  const p0 = await Chain.signPunch(base(0), keys.privateKey, { seq: 0, hash: 'genesis' });
  const p1 = await Chain.signPunch(base(1), keys.privateKey, { seq: p0.seq, hash: p0.hash });
  // Signed by the right phone, next in line, but pointing at a punch that is not the one before it
  const p2 = await Chain.signPunch(base(2), keys.privateKey, { seq: p1.seq, hash: 'not-the-last-hash' });
  const r = await Chain.verifyAll([p0, p1, p2], { d1: pub });
  assert.deepStrictEqual(r, { p0: 'ok', p1: 'ok', p2: 'broken_chain' });
});

test('ENH-1 verifyAll: an unsigned punch is "unsigned" and a punch from an unknown phone is "unknown_device"', async () => {
  const { punches, keys } = await phone(2);
  const r = await Chain.verifyAll([...punches, { id: 'x1', crewId: 'c3', type: 'in', at: 1 }], { other: keys.d1 });
  assert.strictEqual(r.x1, 'unsigned');
  assert.strictEqual(r.p0, 'unknown_device');
});

// ---------- the demo backend in a sandbox, with WebCrypto ----------
function loadDemo(opts = {}) {
  const ls = new Map(Object.entries(opts.ls || {}));
  const ctx = {
    Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true }, crypto: globalThis.crypto,
    TextEncoder, btoa, atob, Uint8Array, Object, Array, String, Number,
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/chain.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
  }
  const db = () => JSON.parse(ls.get([...ls.keys()].find((k) => k.startsWith('cc.demo.db'))));
  return { ctx, db, ls };
}
const keysOf = (team) => Object.fromEntries((team.devices || []).map((d) => [d.id, d.publicKey]));

test('ENH-1 the demo seed is signed and chained, and the boss\'s team view carries the phones\' public keys', async () => {
  const { ctx } = loadDemo();
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  const team = await ctx.DemoBackend.handle('team', { auth });
  assert.ok(team.punches.length >= 5, `only ${team.punches.length} sample punches`);
  const r = await Chain.verifyAll(team.punches, keysOf(team));
  const notOk = Object.entries(r).filter(([, v]) => v !== 'ok');
  assert.deepStrictEqual(notOk, [], 'every sample punch checks out');
});

test('ENH-1 demo tamper() edits one stored punch\'s time (Jake R.\'s clock-in); the check names it; untamper() puts it back', async () => {
  const { ctx } = loadDemo();
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  const before = await ctx.DemoBackend.handle('team', { auth });
  const t = ctx.DemoBackend.tamper();
  assert.ok(ctx.DemoBackend.isTampered());
  const after = await ctx.DemoBackend.handle('team', { auth });
  const p = after.punches.find((x) => x.id === t.id);
  assert.strictEqual(p.crewId, 'c2');
  assert.strictEqual(p.type, 'in');
  assert.notStrictEqual(p.at, before.punches.find((x) => x.id === t.id).at, 'the time changed');
  const r = await Chain.verifyAll(after.punches, keysOf(after));
  assert.deepStrictEqual(Object.entries(r).filter(([, v]) => v !== 'ok').map(([id]) => id), [t.id]);
  ctx.DemoBackend.untamper();
  assert.ok(!ctx.DemoBackend.isTampered());
  const back = await ctx.DemoBackend.handle('team', { auth });
  const r2 = await Chain.verifyAll(back.punches, keysOf(back));
  assert.ok(Object.values(r2).every((v) => v === 'ok'));
});

test('ENH-1 the demo without WebCrypto still seeds (unsigned), so an old browser still gets the demo', async () => {
  const ls = new Map();
  const ctx = { Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx);
  const res = await ctx.DemoBackend.handle('listCrew', {});
  assert.ok(res.crew.length >= 5);
});

test('ENH-1 a signed punch synced to the demo keeps its signature and chain fields', async () => {
  const { ctx, db } = loadDemo();
  const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c5' });
  const k = await Chain.generateKey();
  const pub = await Chain.exportPublic(k.publicKey);
  const p = await Chain.signPunch({ id: 'v1', deviceId: 'dev-v', crewId: 'c5', byCrewId: 'c5', jobId: 'j1', type: 'in',
    at: Date.now() - 1000, lat: 38.4542, lng: -81.9291, accuracy: 9 }, k.privateKey, { seq: 0, hash: 'genesis' });
  const res = await ctx.DemoBackend.handle('sync', { auth, device: { deviceId: 'dev-v', publicKey: pub }, items: [Object.assign({ kind: 'punch' }, p)] });
  assert.deepStrictEqual([...res.accepted], ['v1']); // an array from the sandbox's realm
  const stored = db().punches.find((x) => x.id === 'v1');
  for (const f of ['deviceId', 'seq', 'prevHash', 'hash', 'signature']) assert.ok(stored[f] != null, `stored punch lost ${f}`);
  const boss = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
  const team = await ctx.DemoBackend.handle('team', { auth: boss.auth });
  const r = await Chain.verifyAll(team.punches, keysOf(team));
  assert.strictEqual(r.v1, 'ok');
});

test('ENH-3 the demo seed has earlier sample days for the week view: 3+ days of work, all daytime, all signed', async () => {
  for (const at of [new Date(2026, 9, 26, 10).getTime(), new Date(2026, 9, 28, 14).getTime(), new Date(2026, 10, 1, 20).getTime()]) {
    const RealDate = Date;
    class FixedDate extends RealDate {
      constructor(...a) { if (a.length) super(...a); else super(at); }
      static now() { return at; }
    }
    const { ctx } = loadDemo();
    ctx.Date = FixedDate;
    const { auth } = await ctx.DemoBackend.handle('demoLogin', { crewId: 'c0' });
    const team = await ctx.DemoBackend.handle('team', { auth });
    const days = new Set(team.punches.map((p) => new RealDate(p.at).toDateString()));
    assert.ok(days.size >= 3, `sample punches on only ${days.size} day(s) when opened ${new RealDate(at)}`);
    for (const p of team.punches) {
      const d = new RealDate(p.at);
      const h = d.getHours() + d.getMinutes() / 60;
      assert.ok(h >= 6 && h <= 18, `sample punch at ${d.toTimeString().slice(0, 5)}`);
    }
    const r = await Chain.verifyAll(team.punches, keysOf(team));
    assert.ok(Object.values(r).every((v) => v === 'ok'), 'every sample punch checks out');
  }
});

// ---------- ENH-2: the demo's "No signal" switch ----------
test('ENH-2 with "No signal" on, every demo request fails the way no signal does (offline), and works again when off', async () => {
  const { ctx } = loadDemo();
  await ctx.DemoBackend.handle('listCrew', {});
  ctx.DemoBackend.setOffline(true);
  assert.strictEqual(ctx.DemoBackend.isOffline(), true);
  await assert.rejects(ctx.DemoBackend.handle('listCrew', {}), (e) => e.offline === true && !e.server);
  ctx.DemoBackend.setOffline(false);
  const res = await ctx.DemoBackend.handle('listCrew', {});
  assert.ok(res.ok);
});

// ---------- ENH-3: weekly timesheet ----------
const Report = require('../js/report.js');
const H = 3600000;
const monday = new Date(2026, 9, 26).getTime(); // Mon 26 Oct 2026, local midnight
const day = (n, h) => monday + n * 24 * H + h * H;
const pin = (id, crewId, type, at, extra) => Object.assign({ id, crewId, jobId: 'j1', type, at, status: 'onsite' }, extra);

test('ENH-3 weekTotals: hours per person per day Mon to Sun, and a week total', () => {
  const punches = [
    pin('a', 'c2', 'in', day(0, 7)), pin('b', 'c2', 'out', day(0, 15.5)),
    pin('c', 'c2', 'in', day(2, 7)), pin('d', 'c2', 'out', day(2, 11)),
    pin('e', 'c3', 'in', day(1, 6.5)), pin('f', 'c3', 'out', day(1, 14.5)),
    pin('g', 'c3', 'in', day(7, 7)), pin('h', 'c3', 'out', day(7, 9)), // next Monday: not this week
  ];
  const w = Report.weekTotals(punches, monday);
  assert.strictEqual(w.days.length, 7);
  assert.strictEqual(w.days[0], monday);
  assert.deepStrictEqual(w.byCrew.c2.days, [8.5, 0, 4, 0, 0, 0, 0]);
  assert.strictEqual(w.byCrew.c2.total, 12.5);
  assert.deepStrictEqual(w.byCrew.c3.days, [0, 8, 0, 0, 0, 0, 0]);
  assert.strictEqual(w.byCrew.c3.total, 8);
});

test('ENH-3 weekTotals: a voided clock-in and an open shift add no hours', () => {
  const punches = [
    pin('a', 'c2', 'in', day(0, 7)), pin('v', 'c2', 'void', day(0, 7.1), { voidsId: 'a' }),
    pin('b', 'c2', 'in', day(0, 7.2)), pin('c', 'c2', 'out', day(0, 9.2)),
    pin('d', 'c4', 'in', day(3, 7)),
  ];
  const w = Report.weekTotals(punches, monday);
  assert.deepStrictEqual(w.byCrew.c2.days, [2, 0, 0, 0, 0, 0, 0]);
  assert.strictEqual((w.byCrew.c4 || { total: 0 }).total, 0);
});

test('ENH-3 weekStart: Monday 00:00 of the week holding a time (Sunday belongs to the week before)', () => {
  assert.strictEqual(Report.weekStart(day(3, 10)), monday);
  assert.strictEqual(Report.weekStart(day(6, 23)), monday);
  assert.strictEqual(Report.weekStart(monday), monday);
});

test('ENH-3 timesheetCsv: name, date, in, out, hours, and nothing else (no GPS, job pin, photo or risk)', () => {
  const punches = [
    pin('a', 'c2', 'in', day(0, 7), { lat: 38.4543, lng: -81.9286, accuracy: 15, photoKey: 'k/abc.jpg', risk: [{ code: 'odd_hours' }], hash: 'h', signature: 's' }),
    pin('b', 'c2', 'out', day(0, 15.5), { lat: 38.4542, lng: -81.9287 }),
  ];
  const csv = Report.timesheetCsv(punches, { c2: 'Jake R.' }, monday);
  const lines = csv.trim().split(/\r?\n/);
  assert.strictEqual(lines[0], 'Name,Date,In,Out,Hours');
  assert.strictEqual(lines.length, 2);
  const cells = lines[1].split(',');
  assert.strictEqual(cells[0], 'Jake R.');
  assert.strictEqual(cells[1], '2026-10-26');
  assert.strictEqual(cells[4], '8.50');
  assert.doesNotMatch(csv, /38\.45|81\.92|abc\.jpg|odd_hours|accuracy/);
});

test('ENH-3 timesheetCsv: cells starting with = + - @ are escaped with a leading quote, and commas are quoted', () => {
  const punches = [pin('a', 'x1', 'in', day(1, 7)), pin('b', 'x1', 'out', day(1, 8)),
    pin('c', 'x2', 'in', day(1, 7)), pin('d', 'x2', 'out', day(1, 8)),
    pin('e', 'x3', 'in', day(1, 7)), pin('f', 'x3', 'out', day(1, 8)),
    pin('g', 'x4', 'in', day(1, 7)), pin('h', 'x4', 'out', day(1, 8)),
    pin('i', 'x5', 'in', day(1, 7)), pin('j', 'x5', 'out', day(1, 8))];
  const csv = Report.timesheetCsv(punches, { x1: '=HYPERLINK("http://x")', x2: '+1', x3: '-2', x4: '@SUM(A1)', x5: 'Doe, J.' }, monday);
  assert.match(csv, /^"'=HYPERLINK\(""http:\/\/x""\)",/m);
  assert.match(csv, /^'\+1,/m);
  assert.match(csv, /^'-2,/m);
  assert.match(csv, /^'@SUM\(A1\),/m);
  assert.match(csv, /^"Doe, J\.",/m);
});

test('ENH-3 csvCell: plain cells are left alone', () => {
  assert.strictEqual(Report.csvCell('Jake R.'), 'Jake R.');
  assert.strictEqual(Report.csvCell(8.5), '8.5');
  assert.strictEqual(Report.csvCell("'already"), "'already");
});

// ---------- M1.13 round 2: privacy-security and ux-reviewer findings ----------
const D = 86400000;

test('PS-M113-1 Report.dropOldGps: punches older than 8 days keep their times but lose lat, lng, accuracy, address and distance', () => {
  const now = new Date(2026, 9, 28, 13, 30).getTime();
  const gps = { lat: 38.4543, lng: -81.9286, accuracy: 15, address: 'Near 38.4543, -81.9286', distanceFt: 40 };
  const old = pin('old', 'c2', 'in', now - 9 * D, Object.assign({}, gps));
  const edge = pin('edge', 'c2', 'out', now - 8 * D - 60000, Object.assign({}, gps));
  const recent = pin('new', 'c2', 'in', now - 7 * D, Object.assign({}, gps));
  const out = Report.dropOldGps([old, edge, recent], now);
  for (const p of [out[0], out[1]]) {
    for (const f of ['lat', 'lng', 'accuracy', 'address', 'distanceFt']) assert.ok(p[f] == null, `${p.id} still has ${f}`);
    assert.ok(p.at && p.type && p.crewId && p.jobId && p.status, `${p.id} lost what the week view needs`);
  }
  assert.strictEqual(out[2].lat, 38.4543, 'a punch from the last 8 days keeps its GPS (Today and the map use it)');
  assert.strictEqual(old.lat, 38.4543, 'the input punches are not changed');
});

test('PS-M113-1 the crew app\'s team view hands back no GPS older than 8 days (it is held and cached in cc.team)', async () => {
  const SB = 'https://fake.supabase.test';
  const now = Date.now();
  const row = (id, at) => ({ id, crew_id: 'c2', by_crew_id: 'c2', job_id: 'j1', type: 'in', phone_at: new Date(at).toISOString(),
    received_at: new Date(at + 30000).toISOString(), lat: 38.4543, lng: -81.9286, accuracy_m: 15, distance_ft: 40,
    status: 'onsite', address: 'Near 38.4543, -81.9286', risk: [] });
  const json = (body) => ({ ok: true, status: 200, json: async () => body });
  const fetch = async (url) => {
    if (url.includes('/rest/v1/punches')) return json([row('old', now - 12 * D), row('new', now - 2 * D)]);
    if (url.includes('/rest/v1/crew') || url.includes('/rest/v1/jobs') || url.includes('/rpc/')) return json([]);
    throw new Error('unexpected fetch ' + url);
  };
  const ls = new Map([['cc.sbSession', JSON.stringify({ accessToken: 'at', refreshToken: 'rt', expiresAt: now + 3600000, crewId: 'boss', me: { id: 'boss', role: 'boss' } })]]);
  const sandbox = {
    APP_CONFIG: { backend: 'supabase', supabaseUrl: SB, supabaseAnonKey: 'anon' }, Report,
    Store: { outbox: { add: async (it) => it }, local: { get: (k, d) => d, set() {} } },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, v), removeItem: (k) => ls.delete(k) },
    fetch, Blob, atob, URLSearchParams, AbortController, setTimeout, clearTimeout, console, Date,
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/api-supabase.js'), 'utf8'), sandbox);
  const team = await sandbox.SupabaseApi.team({ crewId: 'boss' }, now - 13 * D);
  const old = team.punches.find((p) => p.id === 'old');
  const recent = team.punches.find((p) => p.id === 'new');
  for (const f of ['lat', 'lng', 'accuracy', 'address', 'distanceFt']) assert.ok(old[f] == null, `a 12-day-old punch still has ${f}`);
  assert.ok(old.at, 'the old punch keeps its time');
  assert.strictEqual(recent.lat, 38.4543);
});

test('PS-M113-3 csvCell: a formula after leading spaces is escaped too', () => {
  assert.strictEqual(Report.csvCell(' =1+1'), "' =1+1");
  assert.strictEqual(Report.csvCell('  +1'), "'  +1");
  assert.strictEqual(Report.csvCell(' -2'), "' -2");
  assert.strictEqual(Report.csvCell('   @SUM(A1)'), "'   @SUM(A1)");
  assert.strictEqual(Report.csvCell(' Jake R.'), ' Jake R.');
});

test('UX-R35 the day summary says "1 of 1 shift was" for a single shift', () => {
  const AI = require('../js/ai.js');
  const s = AI.plainSummary([{ crewId: 'a', jobId: 'j1', status: 'onsite', hours: 8 }], { a: 'Jake' }, { j1: 'Smith kitchen' }, []);
  assert.match(s, /1 of 1 shift was fully on site/);
  assert.doesNotMatch(s, /shifts were/);
});

test('PS-M113-2 docs/PRIVACY.md: the team cache row says GPS for 8 days only, and the weekly CSV has its own row', () => {
  const doc = fs.readFileSync(path.join(__dirname, '../docs/PRIVACY.md'), 'utf8');
  const cache = doc.split('\n').find((l) => l.includes('`cc.team`'));
  assert.match(cache, /13 days/);
  assert.match(cache, /GPS only for the last 8/);
  const csv = doc.split('\n').find((l) => /^\|\s*Weekly (timesheet )?CSV/i.test(l));
  assert.ok(csv, 'no retention row for the weekly CSV');
  assert.match(csv, /Downloads/);
  assert.match(csv, /Name, Date, In, Out, Hours/);
  assert.match(csv, /no GPS/i);
});

test('UX-R33 weekTotals with { now }: a shift still open counts its hours so far and is marked open on its day', () => {
  const punches = [pin('a', 'c2', 'in', day(2, 7)), pin('b', 'c3', 'in', day(2, 7)), pin('c', 'c3', 'out', day(2, 11))];
  const w = Report.weekTotals(punches, monday, { now: day(2, 13.6) });
  assert.strictEqual(w.byCrew.c2.days[2], 6.6);
  assert.strictEqual(w.byCrew.c2.total, 6.6);
  assert.deepStrictEqual(w.byCrew.c2.open, [false, false, true, false, false, false, false]);
  assert.deepStrictEqual(w.byCrew.c3.open, [false, false, false, false, false, false, false]);
  const plain = Report.weekTotals(punches, monday);
  assert.strictEqual((plain.byCrew.c2 || { total: 0 }).total, 0, 'without now, open shifts still add nothing (the CSV)');
});
