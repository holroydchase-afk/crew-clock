// Bugs found on the live demo check of 2026-10-29 (LIVE-1..4). Browser halves are in tests/e2e-enhance.js.
const test = require('node:test');
const assert = require('node:assert');
const AI = require('../js/ai.js');

const NOW = Date.UTC(2026, 9, 29, 8, 0);
const sample = [
  { crewId: 'a', jobId: 'j1', status: 'onsite', hours: 8.45 },
  { crewId: 'b', jobId: 'j1', status: 'onsite', hours: 8.5 },
];
const mine = { crewId: 'c', jobId: 'j2', status: 'onsite', open: true, inAt: NOW - 30 * 60000 };

test('LIVE-2 a past sample day with the visitor clocked in says "so far", never "so far today"', () => {
  const s = AI.plainSummary(sample.concat(mine), { a: 'Jake', b: 'Ray', c: 'Travis' }, { j1: 'Smith', j2: 'Miller' }, [], NOW, { pastDay: true });
  assert.match(s, /have worked [\d.]+ hours so far across/);
  assert.doesNotMatch(s, /today/i);
});

test('LIVE-2 a real today with someone clocked in still says "so far today"', () => {
  const s = AI.plainSummary(sample.concat(mine), {}, {}, [], NOW);
  assert.match(s, /so far today/);
});

test('LIVE-3 the summary total adds up the tenths each row shows (8.45 h shows as 8.5)', () => {
  const s = AI.plainSummary(sample, {}, {}, [], NOW);
  assert.match(s, /worked 17\.0 hours/);
});

test('LIVE-3 one rounding rule for every hours figure: half a tenth rounds up', () => {
  assert.strictEqual(AI.tenths(8.45), '8.5');
  assert.strictEqual(AI.tenths(8.44), '8.4');
  assert.strictEqual(AI.tenths(0), '0.0');
});
