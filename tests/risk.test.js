const test = require('node:test');
const assert = require('node:assert');
const Risk = require('../js/risk.js');
const codes = (f) => f.map((x) => x.code).sort();
const noon = Date.parse('2026-10-21T12:00:00-04:00');
const base = { id: 'n', crewId: 'c1', byCrewId: 'c1', deviceId: 'd1', type: 'in', at: noon, lat: 38.4537, lng: -81.929, accuracy: 9 };

test('a normal punch has no flags', () => {
  assert.deepStrictEqual(Risk.assess(base, { receivedAt: noon + 5000, chain: 'linked' }), []);
});
test('impossible travel: Charleston to Teays Valley in 2 minutes', () => {
  const prev = { id: 'a', crewId: 'c1', at: noon - 2 * 60000, lat: 38.3498, lng: -81.6326 };
  assert.deepStrictEqual(codes(Risk.assess(base, { crewHistory: [prev] })), ['impossible_travel']);
});
test('normal drive between jobs is fine', () => {
  const prev = { id: 'a', crewId: 'c1', at: noon - 40 * 60000, lat: 38.3498, lng: -81.6326 };
  assert.deepStrictEqual(Risk.assess(base, { crewHistory: [prev] }), []);
});
test('frozen GPS: exact same coordinates as yesterday', () => {
  const prev = { id: 'a', crewId: 'c1', at: noon - 24 * 3600000, lat: base.lat, lng: base.lng };
  assert.deepStrictEqual(codes(Risk.assess(base, { crewHistory: [prev] })), ['frozen_gps']);
});
test("buddy punching on someone else's phone, but not foreman clock-ins", () => {
  const other = { id: 'b', crewId: 'c2', byCrewId: 'c2', deviceId: 'd1', at: noon - 3 * 60000 };
  assert.deepStrictEqual(codes(Risk.assess(base, { deviceHistory: [other] })), ['shared_phone']);
  const lead = Object.assign({}, base, { byCrewId: 'c9', photoKey: 'x' }); // a foreman clock-in with a picture (PS-6)
  assert.deepStrictEqual(Risk.assess(lead, { deviceHistory: [other] }), []);
});
test('chain, clock and timing flags', () => {
  assert.deepStrictEqual(codes(Risk.assess(Object.assign({}, base, { accuracy: 0 }), {})), ['too_perfect']);
  assert.deepStrictEqual(codes(Risk.assess(base, { chain: 'bad_signature' })), ['bad_signature']);
  assert.deepStrictEqual(codes(Risk.assess(base, { receivedAt: noon - 30 * 60000 })), ['future_time']);
  assert.deepStrictEqual(codes(Risk.assess(base, { receivedAt: noon + 13 * 3600000 })), ['late_sync']);
  const late = Object.assign({}, base, { at: Date.parse('2026-10-21T23:30:00-04:00') });
  assert.deepStrictEqual(codes(Risk.assess(late, {})), ['odd_hours']);
  assert.strictEqual(Risk.topLevel([{ level: 'low' }, { level: 'high' }]), 'high');
});
