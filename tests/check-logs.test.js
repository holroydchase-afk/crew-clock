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

// ---------- M1.12 Harden: CRW-R3, CRW-R4, CRW-R5 ----------
const fs = require('fs');

test('CRW-R3 log check flags a variable named lat, lng, coords, pin, punch, claims, phone or photo', () => {
  const r = run('personal-vars.js');
  assert.strictEqual(r.status, 1, r.stdout + r.stderr);
  const words = ['lat', 'lng', 'coords', 'pin', 'punch', 'claims', 'phone', 'photo'];
  const missed = words.filter((w, i) => !new RegExp(`personal-vars\\.js:${i + 2} logs "${w}"`).test(r.stdout));
  assert.deepStrictEqual(missed, [], `not flagged: ${missed.join(', ')}\n${r.stdout}`);
});

test('CRW-R4 the log check also covers sw.js and config.js', () => {
  const roots = JSON.parse(fs.readFileSync(path.join(ROOT, 'studio-checks.json'), 'utf8')).logs.roots;
  for (const f of ['sw.js', 'config.js', 'js', 'supabase/functions']) assert.ok(roots.includes(f), `logs.roots is missing ${f}: ${roots.join(', ')}`);
});

// Every console.* call in an Edge Function starts with a fixed where-tag such as 'sync:push' or
// 'http:serve', so a log line says where it came from without carrying any data.
test('CRW-R5 every Edge Function log starts with a fixed where-tag (\'function:step\')', () => {
  const dir = path.join(ROOT, 'supabase', 'functions');
  const files = (p) => fs.statSync(p).isDirectory()
    ? fs.readdirSync(p).filter((f) => f !== 'vendor').flatMap((f) => files(path.join(p, f)))
    : (/\.ts$/.test(p) ? [p] : []);
  const bad = [];
  for (const f of files(dir)) {
    const src = fs.readFileSync(f, 'utf8');
    const re = /console\.(log|info|warn|error|debug)\s*\(\s*/g;
    let m;
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length);
      if (!/^(['"])[a-z][\w-]*:[a-z][\w-]*\1/.test(rest)) {
        const line = src.slice(0, m.index).split('\n').length;
        bad.push(`${path.relative(ROOT, f)}:${line} ${rest.split('\n')[0].slice(0, 60)}`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `logs with no 'function:step' tag:\n${bad.join('\n')}`);
});
