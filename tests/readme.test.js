// M1.7 README for recruiters: everything the README points at exists, and the demo walkthrough
// names people who are in the demo's made-up crew with the roles it says.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const README = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');

test('the README has the live demo link, the CI badge and the MIT license', () => {
  assert.match(README, /\]\(https:\/\/chaseholroyd\.com\/crew-clock\/\)/);
  assert.match(README, /actions\/workflows\/ci\.yml\/badge\.svg/);
  assert.match(README, /\[MIT\]\(LICENSE\)/);
  assert.ok(fs.existsSync(path.join(ROOT, 'LICENSE')));
});

test('every file the README links or shows exists', () => {
  const refs = [...README.matchAll(/\]\(([^)#\s]+)\)|src="([^"]+)"/g)].map((m) => m[1] || m[2])
    .filter((u) => !/^https?:/.test(u));
  assert.ok(refs.some((r) => r.endsWith('.png')), 'no screenshot in the README');
  const missing = refs.filter((r) => !fs.existsSync(path.join(ROOT, r)));
  assert.deepStrictEqual(missing, []);
});

test('the walkthrough names people in the demo crew, in the roles it gives them', () => {
  const ls = new Map();
  const ctx = { Date, Math, JSON, Promise, setTimeout, console, navigator: { onLine: true },
    localStorage: { getItem: (k) => (ls.has(k) ? ls.get(k) : null), setItem: (k, v) => ls.set(k, String(v)), removeItem: (k) => ls.delete(k) } };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['js/report.js', 'js/geo.js', 'js/demo-backend.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  const crew = ctx.DemoBackend;
  const walk = README.slice(README.indexOf('## What to try'), README.indexOf('## Product decisions'));
  const names = [...walk.matchAll(/\*\*([A-Z][a-z]+ [A-Z]\.)\*\*/g)].map((m) => m[1]);
  assert.ok(names.length >= 3, `walkthrough names: ${names}`);
  return crew.handle('listCrew', {}).then((res) => {
    const byName = Object.fromEntries((res.crew || res).map((c) => [c.name, c]));
    for (const n of names) assert.ok(byName[n], `${n} is not in the demo crew`);
    assert.strictEqual(byName['Sam W.'].role, 'boss');
    assert.match(walk, /Sam W\.\*\* \(the boss\)/);
  });
});
