// M1.9 crew sign-in and server hardening: the parts that are wiring, not logic (F-03, F-06, F-12,
// F-13, F-15). The logic is in tests/edge/m19.test.ts and tests/sql/m19_test.sql.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const fn = (name) => read(`supabase/functions/${name}/index.ts`);

// The old code is matched by its SHA-256, so this test doesn't repeat it (PS-M19-6).
const OLD_CODE_SHA256 = '8ba5c35c0598a768747c0602a2f26dcab9908ff51c2d8f25fc92653d71cd6a7d';
test('F-03 the old real company code is nowhere in the repo, reviews included', () => {
  const crypto = require('node:crypto');
  const files = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
    .filter((f) => !f.startsWith('js/vendor/') && !/\.(png|jpg|ico|woff2?)$/.test(f));
  const hits = files.filter((f) => {
    let text; try { text = read(f); } catch (e) { return false; }
    return (text.match(/\b[A-Z]{5}\b/g) || []).some((w) => crypto.createHash('sha256').update(w).digest('hex') === OLD_CODE_SHA256);
  });
  assert.deepStrictEqual(hits, []);
});

test('F-03 new-company makes a random 8+ character code and refuses a short one', () => {
  const src = read('scripts/new-company.ts');
  assert.match(src, /randomOrgCode/);
  assert.match(src, /orgCodeOk/);
  assert.match(read('docs/SETUP.md'), /8 or more|random code/i);
});

test('F-03 pin-login counts every try per IP and per company before the PIN, and alerts the boss', () => {
  const src = fn('pin-login');
  assert.match(src, /RATE\.pinTriesPerIp/);
  assert.match(src, /RATE\.pinTriesPerOrg/);
  assert.match(src, /p_add: true/);
  assert.doesNotMatch(src, /p_add: false/, 'PS-M19-2: a try is counted before the PIN is checked, not after');
  assert.ok(src.indexOf('rate_limit') < src.indexOf('verifyPin('), 'limits before the PIN');
  assert.ok(src.indexOf('pinGate(') > -1 && src.indexOf('pinGate(') < src.indexOf('verifyPin('), 'lock checked before the PIN');
  assert.match(src, /rpc\('pin_fail'/, 'PS-M19-2: wrong PINs counted in one locked SQL update');
  assert.match(src, /lockoutAlert\(/);
  assert.match(src, /pushTo\(/);
});

test('PS-M19-7 a right PIN signs in only through pin_ok (re-checks the lock), never a plain reset', () => {
  const src = fn('pin-login');
  assert.match(src, /rpc\('pin_ok'/);
  assert.doesNotMatch(src, /update\(\{ failed_pins: 0, locked_until: null \}\)/);
});

test('PS-M19-8 the boss hears once an hour when the company cap pauses sign-ins', () => {
  const src = fn('pin-login');
  assert.match(src, /'pin-alert'/);
  assert.match(src, /capAlert/);
  const g = read('supabase/functions/_shared/guard.ts');
  assert.match(g, /export function capAlert/);
});

test('PS-M19-5 the IP hash has its own secret, not the service-role key', () => {
  for (const name of ['pin-login', 'crew-list']) {
    const src = fn(name);
    assert.match(src, /env\('RATE_HMAC_KEY'\)/, name);
    assert.doesNotMatch(src, /ipKey\([^)]*SERVICE_ROLE/, name);
  }
  assert.match(read('docs/SETUP.md'), /RATE_HMAC_KEY/);
});

test('F-03 crew-list is limited per IP', () => {
  const src = fn('crew-list');
  assert.match(src, /rate_limit/);
  assert.match(src, /RATE\.crewListPerIp/);
  assert.match(src, /ipKey\(/);
});

test('F-06 the functions never fall back to CORS *', () => {
  const src = read('supabase/functions/_shared/http.ts');
  assert.doesNotMatch(src, /\|\|\s*'\*'/);
  assert.match(src, /corsFor\(Deno\.env\.get\('APP_ORIGIN'\)\)/);
});

test('F-12 photo-upload checks the punch before signing a link', () => {
  const src = fn('photo-upload');
  assert.match(src, /photoCheck\(/);
  assert.ok(src.indexOf('photoCheck(') < src.indexOf('presign('), 'checked before the link is made');
  assert.match(src, /photoKeyFor\(/, 'PS-M19-4: the key names the uploader');
});

test('F-13 report-export compares the token in constant time and sends only allowed fields', () => {
  const src = fn('report-export');
  assert.match(src, /tokenOk\(/);
  assert.match(src, /reportPayload\(/);
  assert.doesNotMatch(src, /token !== /);
  assert.doesNotMatch(src, /per-company REPORT_TOKEN/, 'the comment no longer claims a per-company token');
});

test('F-15 CI scans the whole history for secrets with gitleaks', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /gitleaks/);
  assert.match(ci, /fetch-depth: 0/);
  assert.match(ci, /ghcr\.io\/gitleaks\/gitleaks:v\d+\.\d+\.\d+/, 'image pinned to an exact version');
});

test('M1.9 the new migration and SQL test run locally and in CI', () => {
  for (const f of ['tests/sql/run.sh', '.github/workflows/ci.yml']) {
    const src = read(f);
    assert.match(src, /20261029000000_crew_auth\.sql/, f);
    assert.match(src, /tests\/sql\/m19_test\.sql/, f);
  }
});

test('F-15 .gitleaksignore only waves through test fixtures, one exact finding at a time', () => {
  const lines = read('.gitleaksignore').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
  for (const l of lines) assert.match(l, /^[0-9a-f]{40}:tests\/[^:]+:[a-z0-9-]+:\d+$/, `ignore entry ${l}`);
});
