// CRW-R1, CRW-R2: Edge Function logs never carry a whole error object (it can hold punch or user
// data, URLs or keys). npm test runs scripts/check-logs.mjs over js/ and supabase/functions/; this
// proves the checker itself on made-up fixtures kept outside those roots.
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FIX = path.join('tests', 'fixtures', 'check-logs');
const run = (file) => spawnSync(process.execPath, ['scripts/check-logs.mjs', path.join(FIX, file)], { cwd: ROOT, encoding: 'utf8' });

test('CRW-R1 log check fails on a bare console.error(e)', () => {
  const r = run('bare-error.js');
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  assert.match(r.stdout, /bare-error\.js:2 logs a whole error object/);
});

test('CRW-R2 log check passes on console.error(\'x\', e.name)', () => {
  const r = run('error-name.js');
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /Log check OK \(1 file\(s\)\)/);
});
