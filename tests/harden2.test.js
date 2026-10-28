// M1.12 Harden: unit cases named by finding ID (PS-4, HRD-7, HRD-8, HRD-11, HRD-15).
// Run: node --test tests/harden2.test.js   (npm test runs it with the rest)
// Every name and record here is made up.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Geo = require('../js/geo.js');
const Report = require('../js/report.js');

const ROOT = path.join(__dirname, '..');
const H = 3600000;

// ---------- PS-4: a worker turned off before their last clock-out syncs keeps that clock-out ----------

function loadDemo() {
  const ls = new Map();
  const ctx = {
    Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) },
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  const db = () => JSON.parse(ls.get([...ls.keys()].find((k) => k.startsWith('cc.demo.db'))));
  // JSON round trip: arrays made inside the vm sandbox fail deepStrictEqual across realms.
  const call = (action, req) => ctx.DemoBackend.handle(action, req).then((r) => JSON.parse(JSON.stringify(r)), (e) => ({ thrown: e.message }));
  return { ctx, db, call };
}

test('PS-4 demo: a clock-out made before the boss turned the worker off still syncs and is kept', async () => {
  const { db, call } = loadDemo();
  const boss = (await call('demoLogin', { crewId: 'c0' })).auth;
  const jake = (await call('demoLogin', { crewId: 'c2' })).auth;
  const now = Date.now();
  // Jake clocked out 10 minutes ago with no signal; the boss turns him off before the phone syncs.
  const off = await call('sync', { auth: boss, items: [{ kind: 'crew', id: 'e-off', data: { id: 'c2', name: 'Jake R.', role: 'crew', active: false } }] });
  assert.deepStrictEqual(off.accepted, ['e-off'], JSON.stringify(off));
  const out = { kind: 'punch', id: 'p-ps4-out', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'out', at: now - 10 * 60000, lat: null, lng: null, accuracy: null };
  const r = await call('sync', { auth: jake, items: [out] });
  assert.ok(r.accepted && r.accepted.includes('p-ps4-out'), `the late clock-out was not accepted: ${JSON.stringify(r)}`);
  assert.ok(db().punches.some((p) => p.id === 'p-ps4-out'), 'the late clock-out was dropped from the store');
});

test('PS-4 demo (guard): a turned-off worker still cannot sign in', async () => {
  const { call } = loadDemo();
  const boss = (await call('demoLogin', { crewId: 'c0' })).auth;
  await call('sync', { auth: boss, items: [{ kind: 'crew', id: 'e-off', data: { id: 'c2', name: 'Jake R.', role: 'crew', active: false } }] });
  const r = await call('demoLogin', { crewId: 'c2' });
  assert.ok(r.thrown, `a turned-off worker signed in: ${JSON.stringify(r).slice(0, 120)}`);
  const list = await call('listCrew', {});
  assert.ok(!list.crew.some((c) => c.id === 'c2'), 'a turned-off worker is still on the sign-in list');
});

// ---------- HRD-11: worker and foreman both close the same shift offline ----------

test('HRD-11 worker and foreman both clock out the same shift: one shift, the second out is a flagged duplicate, no extra hours', () => {
  const punches = [
    { id: 'a', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'in', at: 7 * H, status: 'onsite' },
    { id: 'b', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'out', at: 15.5 * H, status: 'onsite' },
    { id: 'f', crewId: 'c2', byCrewId: 'c1', jobId: 'j1', type: 'out', at: 15.6 * H, status: 'onsite' },
  ];
  for (const order of [punches, [...punches].reverse()]) {
    const s = Report.pairShifts(order).filter((x) => x.crewId === 'c2');
    assert.strictEqual(s.length, 1, `expected 1 shift, got ${s.length}: ${JSON.stringify(s)}`);
    assert.strictEqual(s[0].hours, 8.5, 'hours must come from the first clock-out');
    assert.strictEqual(s[0].outId, 'b');
    assert.ok(!s[0].missingIn, 'the shift is flagged as having no clock-in');
    assert.deepStrictEqual(s[0].duplicateOuts, ['f'], 'the second clock-out must be kept on the shift as a duplicate');
  }
});

test('HRD-11 the foreman\'s clock-out lands first: it closes the shift, the worker\'s later one is the duplicate', () => {
  const s = Report.pairShifts([
    { id: 'a', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'in', at: 7 * H, status: 'onsite' },
    { id: 'f', crewId: 'c2', byCrewId: 'c1', jobId: 'j1', type: 'out', at: 15.4 * H, status: 'onsite' },
    { id: 'b', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'out', at: 15.5 * H, status: 'near' },
  ]);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.strictEqual(s[0].hours, 8.4);
  assert.deepStrictEqual(s[0].duplicateOuts, ['b']);
});

test('HRD-11 (guard) a clock-out with no clock-in at all is still flagged missing clock-in', () => {
  const s = Report.pairShifts([{ id: 'b', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'out', at: 15 * H, status: 'onsite' }]);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].missingIn, true);
});

// ---------- HRD-7: Today shows a shift still open across midnight ----------

test('HRD-7 Today keeps a shift that started last night and is still open', () => {
  assert.strictEqual(typeof Report.shiftsForDay, 'function', 'js/report.js has no shiftsForDay(punches, day0)');
  const day0 = new Date(2026, 9, 28).getTime();
  const punches = [
    { id: 'n1', crewId: 'c3', byCrewId: 'c3', jobId: 'j1', type: 'in', at: day0 - 2 * H, status: 'onsite' }, // 10 PM yesterday, still on
    { id: 'y1', crewId: 'c4', byCrewId: 'c4', jobId: 'j1', type: 'in', at: day0 - 10 * H, status: 'onsite' }, // yesterday, done
    { id: 'y2', crewId: 'c4', byCrewId: 'c4', jobId: 'j1', type: 'out', at: day0 - 4 * H, status: 'onsite' },
    { id: 't1', crewId: 'c2', byCrewId: 'c2', jobId: 'j1', type: 'in', at: day0 + 7 * H, status: 'onsite' },
  ];
  const s = Report.shiftsForDay(punches, day0);
  const night = s.find((x) => x.crewId === 'c3');
  assert.ok(night, `the overnight shift is missing from Today: ${JSON.stringify(s)}`);
  assert.strictEqual(night.open, true);
  assert.strictEqual(night.inAt, day0 - 2 * H);
  assert.ok(!s.some((x) => x.crewId === 'c4'), 'a shift that ended yesterday shows on Today');
  assert.ok(s.some((x) => x.crewId === 'c2'));
});

test('HRD-7 an overnight shift closed this morning shows on Today with its full hours', () => {
  const day0 = new Date(2026, 9, 28).getTime();
  const s = Report.shiftsForDay([
    { id: 'n1', crewId: 'c3', byCrewId: 'c3', jobId: 'j1', type: 'in', at: day0 - 2 * H, status: 'onsite' },
    { id: 'n2', crewId: 'c3', byCrewId: 'c3', jobId: 'j1', type: 'out', at: day0 + 4 * H, status: 'onsite' },
  ], day0);
  assert.strictEqual(s.length, 1, JSON.stringify(s));
  assert.strictEqual(s[0].hours, 6);
});

test('HRD-7 the boss Today list uses Report.shiftsForDay (not a filter that drops last night\'s clock-in)', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8');
  const body = src.slice(src.indexOf('function bossDay()'), src.indexOf('function bossTodayHtml()'));
  assert.match(body, /Report\.shiftsForDay\(/);
});

// ---------- HRD-8: checkFix at the fence edge ----------
// The rule (js/geo.js fenceStatus): the worker gets the benefit of the phone's stated error:
// closest = distance - accuracy; onsite if closest <= radius; accuracy over 152 m is weak; no fix is nogps.

const job = { lat: 38.4537, lng: -81.9290, radiusFt: 300 };
const R = Geo.toMeters(300);

test('HRD-8 (guard) exactly at the radius with a perfect fix counts as on site', () => {
  assert.strictEqual(Geo.fenceStatus(R, 0, R), 'onsite');
  assert.strictEqual(Geo.fenceStatus(R + 0.01, 0, R), 'near');
});

test('HRD-8 (guard) accuracy straddling the edge gives the worker the benefit', () => {
  assert.strictEqual(Geo.fenceStatus(R + 20, 20, R), 'onsite');
  assert.strictEqual(Geo.fenceStatus(R + 20, 19.9, R), 'near');
  assert.strictEqual(Geo.fenceStatus(R * 3 + 10, 10, R), 'near');
  assert.strictEqual(Geo.fenceStatus(R * 3 + 10.1, 10, R), 'offsite');
});

test('HRD-8 (guard) accuracy over 1 km is weak, never on site or off site', () => {
  assert.strictEqual(Geo.fenceStatus(0, 1500, R), 'weak');
  assert.strictEqual(Geo.fenceStatus(50000, 1500, R), 'weak');
  assert.ok(Geo.needsPhoto(Geo.checkFix({ lat: job.lat, lng: job.lng, accuracy: 1001 }, job).status));
});

test('HRD-8 (guard) missing accuracy is nogps (photo), not a guess', () => {
  assert.strictEqual(Geo.checkFix({ lat: job.lat, lng: job.lng }, job).status, 'nogps');
  assert.strictEqual(Geo.checkFix({ lat: job.lat, lng: job.lng, accuracy: null }, job).status, 'nogps');
});

test('HRD-8 NaN or negative accuracy is treated like missing (nogps), never off site', () => {
  for (const acc of [NaN, -5, 'abc']) {
    const near = Geo.checkFix({ lat: job.lat, lng: job.lng, accuracy: acc }, job);
    const far = Geo.checkFix({ lat: job.lat + 0.05, lng: job.lng, accuracy: acc }, job);
    assert.strictEqual(near.status, 'nogps', `accuracy ${acc} at the job gave ${near.status}`);
    assert.strictEqual(far.status, 'nogps', `accuracy ${acc} 5 km away gave ${far.status}`);
  }
});

test('HRD-8 a fix with NaN coordinates is nogps with no distance', () => {
  const r = Geo.checkFix({ lat: NaN, lng: job.lng, accuracy: 10 }, job);
  assert.deepStrictEqual(r, { status: 'nogps', distanceFt: null });
});

// ---------- HRD-15: the service worker never reads location or calls a server by name ----------

test('HRD-15 (guard) sw.js has no geolocation and no http(s):// host literal', () => {
  const src = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  assert.doesNotMatch(src, /geolocation/i);
  assert.doesNotMatch(src, /https?:\/\//i);
});
