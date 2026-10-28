const test = require('node:test');
const assert = require('node:assert');
const AI = require('../js/ai.js');

test('tiers: cheap phones never get a model', () => {
  assert.strictEqual(AI.tier({ deviceMemory: 2, hardwareConcurrency: 8 }), 0);
  assert.strictEqual(AI.tier({ deviceMemory: 8, hardwareConcurrency: 8, connection: { saveData: true } }), 0);
  assert.strictEqual(AI.tier({}), 0); // unknown (Safari) counts as modest
  assert.strictEqual(AI.tier({ deviceMemory: 4, hardwareConcurrency: 8 }), 1);
  assert.strictEqual(AI.tier({ deviceMemory: 8, hardwareConcurrency: 8, gpu: {} }), 2);
});

function img(w, h, fn) {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y); const i = (y * w + x) * 4;
    d[i] = d[i + 1] = d[i + 2] = v; d[i + 3] = 255;
  }
  return d;
}

test('photo checks: dark, washed out, blurry, fine', () => {
  assert.strictEqual(AI.analyzePixels(img(64, 64, () => 10), 64, 64).problem, 'dark');
  assert.strictEqual(AI.analyzePixels(img(64, 64, () => 252), 64, 64).problem, 'bright');
  assert.strictEqual(AI.analyzePixels(img(64, 64, (x) => 100 + x), 64, 64).problem, 'blurry');
  assert.strictEqual(AI.analyzePixels(img(64, 64, (x, y) => ((x >> 2) + (y >> 2)) % 2 ? 200 : 60), 64, 64).problem, null);
});

test('plain summary names who to check and who did not show', () => {
  const s = AI.plainSummary([
    { crewId: 'a', jobId: 'j1', status: 'onsite', hours: 8 },
    { crewId: 'b', jobId: 'j1', status: 'offsite', hours: 7.5 },
  ], { a: 'Jake', b: 'Cody' }, { j1: 'Smith kitchen' }, ['Travis']);
  assert.match(s, /2 people worked 15\.5 hours across 1 job/);
  assert.match(s, /1 of 2 shifts were fully on site; Smith kitchen had the most crew/);
  assert.match(s, /Check: off site for Cody/);
  assert.match(s, /Didn't clock in: Travis/);
});

test('UX-R21 plain summary counts open shifts up to now and says "so far today" while anyone is on the clock', () => {
  const H = 3600000;
  const now = 13.5 * H;
  const s = AI.plainSummary([
    { crewId: 'a', jobId: 'j1', status: 'onsite', inAt: 7 * H, outAt: 11 * H, hours: 4, open: false },
    { crewId: 'b', jobId: 'j1', status: 'onsite', inAt: 7.5 * H, outAt: null, hours: null, open: true },
  ], { a: 'Jake', b: 'Cody' }, { j1: 'Smith kitchen' }, [], now);
  assert.match(s, /2 people have worked 10\.0 hours so far today across 1 job/);
  const done = AI.plainSummary([
    { crewId: 'a', jobId: 'j1', status: 'onsite', inAt: 7 * H, outAt: 11 * H, hours: 4, open: false },
  ], { a: 'Jake' }, { j1: 'Smith kitchen' }, [], now);
  assert.match(done, /1 person worked 4\.0 hours across 1 job/);
  assert.doesNotMatch(done, /so far/);
});
