// Run: node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const Geo = require('../js/geo.js');
const Report = require('../js/report.js');

const job = { lat: 38.4537, lng: -81.9290, radiusFt: 300 };
const offsetNorth = (ft) => job.lat + Geo.toMeters(ft) / 111320;

test('distance: 300 ft north is about 300 ft', () => {
  const d = Geo.toFeet(Geo.distanceM(job.lat, job.lng, offsetNorth(300), job.lng));
  assert.ok(Math.abs(d - 300) < 2, `got ${d}`);
});

test('on site inside the fence with a good fix', () => {
  assert.strictEqual(Geo.checkFix({ lat: offsetNorth(100), lng: job.lng, accuracy: 5 }, job).status, 'onsite');
});

test('benefit of the doubt: 380 ft away with 30 m accuracy counts as on site', () => {
  assert.strictEqual(Geo.checkFix({ lat: offsetNorth(380), lng: job.lng, accuracy: 30 }, job).status, 'onsite');
});

test('near: parked down the road', () => {
  const r = Geo.checkFix({ lat: offsetNorth(700), lng: job.lng, accuracy: 10 }, job);
  assert.strictEqual(r.status, 'near');
  assert.ok(Math.abs(r.distanceFt - 700) < 3);
});

test('off site beyond 3x the fence', () => {
  assert.strictEqual(Geo.checkFix({ lat: offsetNorth(2000), lng: job.lng, accuracy: 10 }, job).status, 'offsite');
});

test('weak GPS beats a lucky distance', () => {
  assert.strictEqual(Geo.checkFix({ lat: job.lat, lng: job.lng, accuracy: 400 }, job).status, 'weak');
});

test('no fix is nogps and needs a photo', () => {
  const r = Geo.checkFix(null, job);
  assert.strictEqual(r.status, 'nogps');
  assert.ok(Geo.needsPhoto(r.status));
  assert.ok(!Geo.needsPhoto('near'));
});

test('fence size changes the answer', () => {
  const fix = { lat: offsetNorth(250), lng: job.lng, accuracy: 5 };
  assert.strictEqual(Geo.checkFix(fix, Object.assign({}, job, { radiusFt: 150 })).status, 'near');
  assert.strictEqual(Geo.checkFix(fix, Object.assign({}, job, { radiusFt: 600 })).status, 'onsite');
});

test('formatDistance', () => {
  assert.strictEqual(Geo.formatDistance(203), '200 ft');
  assert.strictEqual(Geo.formatDistance(7392), '1.4 mi');
});

test('bestFix keeps the most accurate reading and stops early', async () => {
  let cb;
  const fake = {
    watchPosition(ok) { cb = ok; return 1; },
    clearWatch() {},
  };
  const p = Geo.bestFix(fake, { timeoutMs: 1000, goodEnoughM: 20 });
  cb({ coords: { latitude: 1, longitude: 1, accuracy: 80 }, timestamp: 1 });
  cb({ coords: { latitude: 2, longitude: 2, accuracy: 15 }, timestamp: 2 });
  const fix = await p;
  assert.strictEqual(fix.accuracy, 15);
  assert.strictEqual(fix.lat, 2);
});

test('bestFix resolves null when GPS never answers', async () => {
  const fake = { watchPosition() { return 1; }, clearWatch() {} };
  assert.strictEqual(await Geo.bestFix(fake, { timeoutMs: 50 }), null);
});

const H = 3600000;
test('pairShifts: in/out pairs, hours, worst status', () => {
  const s = Report.pairShifts([
    { id: 'a', crewId: 'c1', jobId: 'j1', type: 'in', at: 7 * H, status: 'onsite' },
    { id: 'b', crewId: 'c1', jobId: 'j1', type: 'out', at: 15.5 * H, status: 'near' },
    { id: 'c', crewId: 'c2', jobId: 'j1', type: 'in', at: 8 * H, status: 'onsite' },
  ]);
  assert.strictEqual(s.length, 2);
  assert.strictEqual(s[0].hours, 8.5);
  assert.strictEqual(s[0].status, 'near');
  assert.strictEqual(s[1].open, true);
});

test('pairShifts: wrong-job fix voids the first clock-in', () => {
  const s = Report.pairShifts([
    { id: 'a', crewId: 'c1', jobId: 'j1', type: 'in', at: 7 * H, status: 'offsite' },
    { id: 'v', crewId: 'c1', type: 'void', voidsId: 'a', at: 7.01 * H },
    { id: 'b', crewId: 'c1', jobId: 'j2', type: 'in', at: 7 * H, status: 'onsite' },
  ]);
  assert.strictEqual(s.length, 1);
  assert.strictEqual(s[0].jobId, 'j2');
});

test('pairShifts: clock-in twice flags the first as missing clock-out', () => {
  const s = Report.pairShifts([
    { id: 'a', crewId: 'c1', jobId: 'j1', type: 'in', at: 7 * H, status: 'onsite' },
    { id: 'b', crewId: 'c1', jobId: 'j2', type: 'in', at: 12 * H, status: 'onsite' },
  ]);
  assert.strictEqual(s[0].missingOut, true);
  assert.strictEqual(s[0].open, false);
  assert.strictEqual(s[1].open, true);
});

test('lastPunchByCrew ignores voided punches', () => {
  const last = Report.lastPunchByCrew([
    { id: 'a', crewId: 'c1', type: 'in', at: 1 },
    { id: 'b', crewId: 'c1', type: 'in', at: 2 },
    { id: 'v', crewId: 'c1', type: 'void', voidsId: 'b', at: 3 },
  ]);
  assert.strictEqual(last.c1.id, 'a');
});

test('server copy of the fence rule matches the app', () => {
  const fs = require('fs');
  const vm = require('vm');
  const src = fs.readFileSync(require('path').join(__dirname, '../backend/Code.gs'), 'utf8');
  const ctx = {};
  vm.createContext(ctx);
  vm.runInContext(src + '\nthis.checkFix = checkFix; this.pairShifts = pairShifts;', ctx);
  for (const ft of [50, 280, 380, 700, 1000, 5000]) {
    for (const acc of [5, 30, 120, 300]) {
      const fix = { lat: offsetNorth(ft), lng: job.lng, accuracy: acc };
      assert.deepStrictEqual(JSON.parse(JSON.stringify(ctx.checkFix(fix, job))), Geo.checkFix(fix, job), `${ft}ft acc ${acc}`);
    }
  }
});

test('a void the server rejected does not hide the punch', () => {
  const s = Report.pairShifts([
    { id: 'a', crewId: 'c1', jobId: 'j1', type: 'in', at: 7 * H, status: 'onsite' },
    { id: 'v', crewId: 'c2', type: 'void', voidsId: 'a', at: 7.01 * H, status: 'void_rejected' },
  ]);
  assert.strictEqual(s.length, 1);
});
