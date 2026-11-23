// AI-SHELF (Chase, 2026-11-23): on-phone AI models (tiers 1 and 2) are shelved behind
// config `onPhoneAi`, default false. Tier 0 (pixel photo check, plain summary) keeps working.
// Seam: AI.modelTier(config, nav) is 0 unless config.onPhoneAi === true, then it is AI.tier(nav);
// AI.labelPhoto / AI.writeSummary refuse (reject mentioning onPhoneAi) before any import
// unless the config they are given (or self.APP_CONFIG) has onPhoneAi true.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const AI = require('../js/ai.js');

const ROOT = path.join(__dirname, '..');
const script = path.join(ROOT, 'scripts', 'build-site.mjs');
/** @param {string} file @returns {AppConfig} */
const readCfg = (file) => new Function('window', `${fs.readFileSync(file, 'utf8')}; return window.APP_CONFIG;`)({});
const BIG = { deviceMemory: 8, hardwareConcurrency: 8, gpu: {} };
const MID = { deviceMemory: 4, hardwareConcurrency: 8 };
const SMALL = { deviceMemory: 2, hardwareConcurrency: 8 };

test('AISHELF-1 config.js ships with on-phone AI off (onPhoneAi === false)', () => {
  assert.strictEqual(readCfg(path.join(ROOT, 'config.js')).onPhoneAi, false);
});

test('AISHELF-2 demo and crew-app builds both ship onPhoneAi false, whatever the environment says', () => {
  const env = { ...process.env, CREW_ONPHONE_AI: 'true', ONPHONE_AI: 'true', ON_PHONE_AI: 'true' };
  for (const args of [['--demo'], []]) {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-aishelf-'));
    try {
      const extra = args.length ? {} : { CREW_BACKEND: 'supabase', SUPABASE_URL: 'https://x.supabase.co' };
      execFileSync(process.execPath, [script, out, ...args], { env: { ...env, ...extra } });
      assert.strictEqual(readCfg(path.join(out, 'config.js')).onPhoneAi, false, `build ${args.join(' ') || 'crew app'}`);
    } finally {
      fs.rmSync(out, { recursive: true, force: true });
    }
  }
});

test('AISHELF-3 with onPhoneAi false (or missing) no phone gets a model tier', () => {
  assert.strictEqual(typeof AI.modelTier, 'function', 'AI.modelTier(config, nav) is the gate');
  for (const cfg of [{ onPhoneAi: false }, {}, undefined, { onPhoneAi: 'true' }]) {
    for (const nav of [BIG, MID, SMALL]) assert.strictEqual(AI.modelTier(cfg, nav), 0);
  }
});

test('AISHELF-3 with onPhoneAi off, labelPhoto and writeSummary refuse before loading anything', async () => {
  await assert.rejects(AI.labelPhoto('data:image/png;base64,', { onPhoneAi: false }), /onPhoneAi/);
  await assert.rejects(AI.writeSummary('Facts for today: none', { onPhoneAi: false }), /onPhoneAi/);
  await assert.rejects(AI.labelPhoto('data:image/png;base64,'), /onPhoneAi/); // no config anywhere = off
});

test('AISHELF-3 the app gates the summary button and photo labels on AI.modelTier, not the raw tier', () => {
  const app = fs.readFileSync(path.join(ROOT, 'js', 'app.js'), 'utf8');
  assert.doesNotMatch(app, /AI\.tier\(/, 'app.js still gates models on AI.tier() alone');
  assert.match(app, /AI\.modelTier\(/);
});

test('AISHELF-4 tier 0 still works with AI shelved: dark/blurry photo check and plain summary', () => {
  /** @param {(x: number, y: number) => number} fn */
  const img = (fn) => { const d = new Uint8ClampedArray(64 * 64 * 4);
    for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) { const i = (y * 64 + x) * 4; d[i] = d[i + 1] = d[i + 2] = fn(x, y); d[i + 3] = 255; }
    return d; };
  assert.strictEqual(AI.analyzePixels(img(() => 10), 64, 64).problem, 'dark');
  assert.strictEqual(AI.analyzePixels(img((x) => 100 + x), 64, 64).problem, 'blurry');
  assert.ok(AI.PHOTO_WORDS.dark && AI.PHOTO_WORDS.blurry);
  assert.strictEqual(AI.tenths(8.45), '8.5');
  assert.match(AI.plainSummary([{ crewId: 'a', jobId: 'j1', status: 'onsite', hours: 8 }], { a: 'Demo Worker' }, { j1: 'Demo job' }, []),
    /1 person worked 8\.0 hours across 1 job/);
});

test('AISHELF-5 with onPhoneAi true the tier logic is what it was (reversible)', () => {
  assert.strictEqual(typeof AI.modelTier, 'function');
  const on = { onPhoneAi: true };
  for (const nav of [BIG, MID, SMALL, {}, { ...BIG, connection: { saveData: true } }]) {
    assert.strictEqual(AI.modelTier(on, nav), AI.tier(nav));
  }
  assert.strictEqual(AI.modelTier(on, BIG), 2);
  assert.strictEqual(AI.modelTier(on, MID), 1);
});

test('AISHELF-6 README says on-phone AI models are shelved, not that the crew app runs them', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  assert.doesNotMatch(readme, /Transformers\.js models on capable phones/);
  assert.doesNotMatch(readme, /On phones that can run it/);
  assert.match(readme, /on-phone AI[^\n]*(shelved|off)/i);
});
