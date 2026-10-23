// M1.3 / PRIVACY L1: location is read only inside the punch flow, the first-sign-in permission
// primer and the boss's "Use where I'm standing". A new geolocation call anywhere else fails here.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const GEO = /\bgeolocation\b|watchPosition|getCurrentPosition/;
// Where in js/app.js a location read may start: the enclosing function or action name.
const ALLOWED_IN_APP = ['sortJobsByDistance', 'locate', 'prime-location', 'job-here'];

function jsFiles(dir) {
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'vendor' ? [] : jsFiles(rel);
    return /\.(m?js)$/.test(d.name) ? [rel] : [];
  });
}

test('the service worker never touches location (L1)', () => {
  assert.ok(!GEO.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')));
  assert.ok(!/periodicsync|backgroundFetch/i.test(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8')));
});

test('only js/app.js and js/geo.js mention geolocation (L1)', () => {
  const hits = jsFiles('js').filter((f) => GEO.test(fs.readFileSync(path.join(ROOT, f), 'utf8')));
  assert.deepStrictEqual(hits.sort(), ['js/app.js', 'js/geo.js']);
});

test('js/geo.js reads location only through bestFix, which the caller passes geolocation to', () => {
  const src = fs.readFileSync(path.join(ROOT, 'js/geo.js'), 'utf8');
  assert.ok(!/navigator\.geolocation/.test(src));
});

test('every location read in js/app.js sits in an allowed place (L1)', () => {
  const lines = fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8').split('\n');
  const owner = (i) => {
    for (let j = i; j >= 0; j--) {
      const m = lines[j].match(/^\s{2,4}(?:async )?function (\w+)|^\s{4}'([\w-]+)':/);
      if (m) return m[1] || m[2];
    }
    return '(top level)';
  };
  const where = [];
  lines.forEach((l, i) => { if (/navigator\.geolocation/.test(l)) where.push(owner(i)); });
  assert.ok(where.length > 0);
  for (const w of where) assert.ok(ALLOWED_IN_APP.includes(w), `a location read in ${w}()`);
});

test('no watchPosition in js/app.js: watches go through Geo.bestFix, which always clears them', () => {
  assert.ok(!/watchPosition/.test(fs.readFileSync(path.join(ROOT, 'js/app.js'), 'utf8')));
});
