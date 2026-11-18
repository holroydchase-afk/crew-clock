// M1.16 geofence fairness eval (EVAL-1..EVAL-7). Run: node --test tests/eval-geofence.test.js
// Everything here is simulated from a seeded random generator. No real location data.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const Geo = require('../js/geo.js');

const ROOT = path.join(__dirname, '..');
const MODEL = path.join(ROOT, 'evals', 'geofence', 'model.mjs');
const RUNNER = path.join(ROOT, 'evals', 'geofence', 'run.mjs');
const REPORT_MD = path.join(ROOT, 'docs', 'evals', 'geofence.md');
const REPORT_JSON = path.join(ROOT, 'docs', 'evals', 'geofence.json');

// model.mjs is ESM; this file is CommonJS like the rest of tests/.
const load = () => import(pathToFileURL(MODEL).href);

const SEED = 20261118;
const TRIALS_ALL = 1500;   // runAll, determinism only
const TRIALS_CELL = 5000;  // single cells with thresholds
const ENV_NAMES = ['open_sky', 'tree_cover', 'hollow', 'overconfident', 'cell_only'];
const POLICY_NAMES = ['strict', 'fair', 'capped'];
const METRICS = ['onsiteWronglyFlagged', 'onsitePhotoAsked', 'onsiteClean',
  'offsitePassed15', 'offsitePassed3', 'offsitePassedMile',
  'offsitePhoto15', 'offsitePhoto3', 'offsitePhotoMile'];
const pct = (x) => (x * 100).toFixed(2) + '%';
const findCell = (result, env, radiusFt, policy) =>
  result.cells.find((c) => c.env === env && c.radiusFt === radiusFt && c.policy === policy);

test('EVAL-1 determinism: mulberry32 repeats for a seed and gives numbers in [0, 1)', async () => {
  const m = await load();
  const a = m.mulberry32(SEED);
  const b = m.mulberry32(SEED);
  const c = m.mulberry32(SEED + 1);
  const seqA = Array.from({ length: 50 }, () => a());
  const seqB = Array.from({ length: 50 }, () => b());
  const seqC = Array.from({ length: 50 }, () => c());
  assert.deepStrictEqual(seqA, seqB);
  assert.notDeepStrictEqual(seqA, seqC);
  assert.ok(seqA.every((x) => x >= 0 && x < 1));
  assert.strictEqual(m.DEFAULT_SEED, SEED);
  assert.strictEqual(m.DEFAULT_TRIALS, 20000);
});

test('EVAL-1 determinism: runAll is the same for the same seed and differs for another seed', async () => {
  const m = await load();
  const one = m.runAll({ trials: TRIALS_ALL, seed: SEED });
  const two = m.runAll({ trials: TRIALS_ALL, seed: SEED });
  const other = m.runAll({ trials: TRIALS_ALL, seed: SEED + 1 });
  assert.deepStrictEqual(one, two);
  assert.notDeepStrictEqual(one.cells, other.cells);

  assert.strictEqual(one.seed, SEED);
  assert.strictEqual(one.trials, TRIALS_ALL);
  assert.deepStrictEqual(m.RADII_FT, [150, 300, 600]);
  assert.strictEqual(one.cells.length, ENV_NAMES.length * 3 * POLICY_NAMES.length);
  for (const env of ENV_NAMES) for (const radiusFt of [150, 300, 600]) for (const policy of POLICY_NAMES) {
    const cell = findCell(one, env, radiusFt, policy);
    assert.ok(cell, `missing cell ${env} ${radiusFt} ft ${policy}`);
    for (const k of METRICS) {
      assert.ok(typeof cell[k] === 'number' && cell[k] >= 0 && cell[k] <= 1, `${env}/${radiusFt}/${policy}.${k} = ${cell[k]}`);
      assert.strictEqual(cell[k], Math.round(cell[k] * 1e4) / 1e4, `${k} is rounded to 4 places`);
    }
    const sum = cell.onsiteClean + cell.onsiteWronglyFlagged + cell.onsitePhotoAsked;
    assert.ok(Math.abs(sum - 1) < 0.001, `on-site outcomes add up to 1, got ${sum}`);
  }
});

test('EVAL-2 error model: the five environments carry the stated parameters and a plain-words label', async () => {
  const m = await load();
  const want = {
    open_sky: [4, 12, 1], tree_cover: [15, 45, 1], hollow: [40, 120, 1],
    overconfident: [8, 20, 3], cell_only: [300, 1500, 1],
  };
  assert.deepStrictEqual(Object.keys(m.ENVIRONMENTS).sort(), ENV_NAMES.slice().sort());
  for (const name of ENV_NAMES) {
    const e = m.ENVIRONMENTS[name];
    assert.deepStrictEqual([e.accuracyMinM, e.accuracyMaxM, e.honesty], want[name], name);
    assert.ok(typeof e.label === 'string' && e.label.length > 3, `${name} has a label`);
  }
});

test('EVAL-2 error model: an honest phone is within its stated accuracy about 95% of the time, an overconfident one is not', async () => {
  const m = await load();
  assert.ok(Math.abs(m.R95_OVER_SIGMA - 2.4477) < 0.001, `got ${m.R95_OVER_SIGMA}`);
  assert.ok(Math.abs(m.sigmaFor(30, 1) - 30 / 2.4477) < 0.01);
  assert.ok(Math.abs(m.sigmaFor(30, 3) - 90 / 2.4477) < 0.01);

  const N = 20000;
  const within = (envName, statedAccuracyM) => {
    const rng = m.mulberry32(SEED);
    const sigma = m.sigmaFor(statedAccuracyM, m.ENVIRONMENTS[envName].honesty);
    let n = 0;
    for (let i = 0; i < N; i++) {
      const e = m.sampleError(rng, sigma);
      assert.ok(Number.isFinite(e.x) && Number.isFinite(e.y));
      if (Math.hypot(e.x, e.y) <= statedAccuracyM) n++;
    }
    return n / N;
  };
  for (const [env, acc] of [['open_sky', 8], ['tree_cover', 30], ['hollow', 80], ['cell_only', 900]]) {
    const f = within(env, acc);
    assert.ok(f >= 0.93 && f <= 0.97, `${env}: ${pct(f)} within stated accuracy, want 93 to 97%`);
  }
  const bad = within('overconfident', 14);
  assert.ok(bad < 0.60, `overconfident: ${pct(bad)} within stated accuracy, want under 60%`);
});

test('EVAL-3 the fair policy is the shipped Geo.fenceStatus, strict never says near or weak, capped caps the doubt at the radius', async () => {
  const m = await load();
  assert.deepStrictEqual(Object.keys(m.POLICIES).sort(), POLICY_NAMES.slice().sort());
  const dists = [0, 5, 45, 91, 92, 137, 183, 200, 274, 275, 300, 549, 550, 700, 1609, 5000];
  const accs = [0, 4, 12, 30, 45, 91, 120, 152, 153, 400, 1500];
  const radii = [150, 300, 600].map(Geo.toMeters);
  let checked = 0;
  for (const d of dists) for (const a of accs) for (const r of radii) {
    assert.strictEqual(m.POLICIES.fair(d, a, r), Geo.fenceStatus(d, a, r), `fair(${d}, ${a}, ${r})`);
    const s = m.POLICIES.strict(d, a, r);
    assert.strictEqual(s, d <= r ? 'onsite' : 'offsite', `strict(${d}, ${a}, ${r})`);
    const closest = d - Math.min(a, r);
    const wantCapped = a > Geo.WEAK_ACCURACY_M ? 'weak'
      : closest <= r ? 'onsite' : closest <= r * Geo.NEAR_FACTOR ? 'near' : 'offsite';
    assert.strictEqual(m.POLICIES.capped(d, a, r), wantCapped, `capped(${d}, ${a}, ${r})`);
    checked++;
  }
  assert.ok(checked > 500);
  // Readings no phone should send still follow the shipped rule: a photo, never "off site".
  for (const [d, a] of [[null, 10], [50, null], [NaN, 10], [50, -1], [50, 'abc']]) {
    assert.strictEqual(m.POLICIES.fair(d, a, 91.44), Geo.fenceStatus(d, a, 91.44));
    assert.strictEqual(m.POLICIES.fair(d, a, 91.44), 'nogps');
  }
  // Where the candidate differs from the shipped rule: 200 m out, 120 m stated accuracy, 300 ft fence.
  const r300 = Geo.toMeters(300);
  assert.strictEqual(m.POLICIES.fair(200, 120, r300), 'onsite');
  assert.strictEqual(m.POLICIES.capped(200, 120, r300), 'near');
});

test('EVAL-4 fairness threshold: at 300 ft the shipped rule wrongly flags at most 1% of on-site workers, and strict flags clearly more', async () => {
  const m = await load();
  const cell = (env, policy) => m.runCell({ env, radiusFt: 300, policy, trials: TRIALS_CELL, seed: SEED });
  for (const env of ['open_sky', 'tree_cover', 'hollow']) {
    const fair = cell(env, 'fair');
    assert.ok(fair.onsiteWronglyFlagged <= 0.01,
      `${env}: fair wrongly flags ${pct(fair.onsiteWronglyFlagged)} of on-site workers, limit 1%`);
  }
  const tree = { fair: cell('tree_cover', 'fair'), strict: cell('tree_cover', 'strict') };
  const hollow = { fair: cell('hollow', 'fair'), strict: cell('hollow', 'strict') };
  assert.ok(tree.strict.onsiteWronglyFlagged > tree.fair.onsiteWronglyFlagged,
    `tree_cover: strict ${pct(tree.strict.onsiteWronglyFlagged)} vs fair ${pct(tree.fair.onsiteWronglyFlagged)}`);
  assert.ok(hollow.strict.onsiteWronglyFlagged - hollow.fair.onsiteWronglyFlagged >= 0.05,
    `hollow: strict ${pct(hollow.strict.onsiteWronglyFlagged)} vs fair ${pct(hollow.fair.onsiteWronglyFlagged)}, want a gap of at least 5 points`);
});

test('EVAL-5 never a refusal: with no GPS lock the shipped rule asks for a photo and passes nobody a mile away', async () => {
  const m = await load();
  for (const radiusFt of [150, 300, 600]) {
    const c = m.runCell({ env: 'cell_only', radiusFt, policy: 'fair', trials: TRIALS_CELL, seed: SEED });
    assert.ok(c.onsitePhotoAsked >= 0.99, `${radiusFt} ft: ${pct(c.onsitePhotoAsked)} of on-site workers asked for a photo, want at least 99%`);
    assert.strictEqual(c.offsitePassedMile, 0, `${radiusFt} ft: someone a mile away passed as on site`);
    assert.ok(c.onsiteWronglyFlagged <= 0.01, `${radiusFt} ft: a weak fix is a photo, not a flag`);
  }
  // The other direction: with a good fix, someone a mile away is not waved through either.
  const sky = m.runCell({ env: 'open_sky', radiusFt: 300, policy: 'fair', trials: TRIALS_CELL, seed: SEED });
  assert.strictEqual(sky.offsitePassedMile, 0);
  assert.ok(sky.onsiteClean >= 0.99, `open_sky: ${pct(sky.onsiteClean)} of on-site workers clean`);
});

test('EVAL-6 the known weakness is measured, not hidden: fair passes more people at 1.5x the radius in a hollow than strict', async () => {
  const m = await load();
  const cell = (policy) => m.runCell({ env: 'hollow', radiusFt: 300, policy, trials: TRIALS_CELL, seed: SEED });
  const fair = cell('fair');
  const strict = cell('strict');
  const capped = cell('capped');
  assert.strictEqual(typeof fair.offsitePassed15, 'number');
  assert.ok(fair.offsitePassed15 > strict.offsitePassed15, `fair ${pct(fair.offsitePassed15)} vs strict ${pct(strict.offsitePassed15)}`);
  assert.ok(capped.offsitePassed15 <= fair.offsitePassed15, `capped ${pct(capped.offsitePassed15)} vs fair ${pct(fair.offsitePassed15)}`);

  // The committed numbers carry it too.
  const json = JSON.parse(fs.readFileSync(REPORT_JSON, 'utf8'));
  assert.strictEqual(json.seed, SEED);
  assert.strictEqual(json.trials, 20000);
  const jf = findCell(json, 'hollow', 300, 'fair');
  const js = findCell(json, 'hollow', 300, 'strict');
  const jc = findCell(json, 'hollow', 300, 'capped');
  assert.ok(jf && js && jc, 'geofence.json has the hollow 300 ft cells for all three policies');
  assert.strictEqual(typeof jf.offsitePassed15, 'number');
  assert.ok(jf.offsitePassed15 > js.offsitePassed15);
  assert.ok(jc.offsitePassed15 <= jf.offsitePassed15);
});

test('EVAL-7 the committed report is current and says what it is', () => {
  assert.ok(fs.existsSync(RUNNER), 'evals/geofence/run.mjs exists');
  const r = spawnSync(process.execPath, [RUNNER, '--check'], { cwd: ROOT, encoding: 'utf8', timeout: 120000 });
  assert.strictEqual(r.status, 0, `run.mjs --check exited ${r.status}: ${r.stdout}${r.stderr}`);

  const md = fs.readFileSync(REPORT_MD, 'utf8');
  assert.ok(md.startsWith('<!--'), 'starts with a generated-file comment');
  assert.match(md.slice(0, md.indexOf('-->')), /npm run eval:geofence/);
  assert.match(md, /Geofence fairness eval/);
  assert.ok(!md.includes('—'), 'no em-dash in the report');
  for (const name of ENV_NAMES.concat(POLICY_NAMES)) assert.ok(md.includes(name), `report names ${name}`);
  assert.match(md, /simulated/i);
  assert.match(md, /not field data/i);
  assert.doesNotMatch(md, /\b20\d\d-\d\d-\d\dT?/, 'no date or timestamp (byte-stable output)');

  const json = fs.readFileSync(REPORT_JSON, 'utf8');
  assert.doesNotMatch(json, /\b20\d\d-\d\d-\d\dT?/, 'no date or timestamp in the JSON');

  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.strictEqual(pkg.scripts['eval:geofence'], 'node evals/geofence/run.mjs');
});
