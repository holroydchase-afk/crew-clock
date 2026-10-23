const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const script = path.join(__dirname, '..', 'scripts', 'build-site.mjs');
const load = () => import(script);

test('config values come from the environment, the rest stays', async () => {
  const { fillConfig } = await load();
  const src = fs.readFileSync(path.join(__dirname, '..', 'config.js'), 'utf8');
  const out = fillConfig(src, { CREW_BACKEND: 'supabase', SUPABASE_URL: 'https://abc.supabase.co', ORG_CODE: "O'K" });
  const cfg = new Function('window', `${out}; return window.APP_CONFIG;`)({});
  assert.equal(cfg.backend, 'supabase');
  assert.equal(cfg.supabaseUrl, 'https://abc.supabase.co');
  assert.equal(cfg.orgCode, "O'K");
  assert.equal(cfg.supabaseAnonKey, '');
  assert.equal(cfg.gpsTimeoutMs, 20000);
  assert.equal(fillConfig(src, {}), src);
});

test('build publishes only the app, with a stamped service worker', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-site-'));
  execFileSync(process.execPath, [script, out], { env: { ...process.env, SUPABASE_URL: 'https://x.supabase.co' } });
  for (const f of ['index.html', 'sw.js', '_headers', 'js/app.js', 'vendor/leaflet/leaflet.js', 'icons/icon-512.png']) {
    assert.ok(fs.existsSync(path.join(out, f)), f);
  }
  for (const f of ['supabase', 'backend', 'tests', 'docs', 'scripts', 'messenger', 'package.json', 'README.md']) {
    assert.ok(!fs.existsSync(path.join(out, f)), `${f} should not be published`);
  }
  assert.match(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'), /const VERSION = 'v\d+-[0-9a-f]{10}';/);
  assert.match(fs.readFileSync(path.join(out, 'config.js'), 'utf8'), /supabaseUrl: 'https:\/\/x\.supabase\.co'/);
  fs.rmSync(out, { recursive: true, force: true });
});
