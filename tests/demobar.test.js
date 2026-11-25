// Studio demo bar (docs/product/SPEC-DEMO-BAR.md, CRW M1.18), the static half. Run: node --test
// tests/demobar.test.js (also part of `npm test`, no browser). The browser half (DEMOBAR-1..12, 14,
// 17) is tests/e2e-demobar.js; DEMOBAR-15 and DEMOBAR-16 are manual.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
/** @param {string} p */
const read = (p) => fs.readFileSync(path.join(ROOT, p), 'utf8');
/** @param {string} dir @param {string} ext */
const filesIn = (dir, ext) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => `${dir}/${e.name}`);
// js/ (not the prebuilt vendor bundle) and css/
const SOURCES = () => filesIn('js', '.js').concat(filesIn('css', '.css'));

// The spec's "Removed" list: the old banner's classes and words
const GONE = ['demo-banner', 'demo-label', 'demo-actions', 'Sample data, made-up crew', 'Reset sample data', 'Back to chaseholroyd.com'];

test('DEMOBAR-13 js/ and css/ no longer hold the old banner: demo-banner, demo-label, demo-actions, "Sample data, made-up crew", "Reset sample data", "Back to chaseholroyd.com"', () => {
  const found = [];
  for (const f of SOURCES()) {
    const lines = read(f).split('\n');
    for (const g of GONE) {
      const i = lines.findIndex((l) => l.includes(g));
      if (i >= 0) found.push(`${f}:${i + 1} "${g}"`);
    }
  }
  assert.deepStrictEqual(found, [], `still there: ${found.join(', ')}`);
});

test('DEMOBAR-13 the demo reset makes no confirm() call (the question is inline: Reset / Keep)', () => {
  const src = read('js/app.js');
  // The handler for data-action="demo-reset": from its key to the next action key at the same indent
  const at = src.indexOf("'demo-reset':");
  if (at < 0) {
    // Renamed is fine, as long as no confirm() names the reset's old or new words anywhere
    assert.doesNotMatch(src, /confirm\([^)]*(sample crew|sample data|Start over|Reset)/i, 'a confirm() still asks about resetting the demo');
    return;
  }
  const rest = src.slice(at + 1);
  const next = rest.search(/\n {4}'[a-z-]+':/);
  const body = next < 0 ? rest : rest.slice(0, next);
  assert.doesNotMatch(body, /\bconfirm\s*\(/, `demo-reset still calls confirm():\n${body.split('\n').slice(0, 3).join('\n')}`);
  assert.doesNotMatch(src, /confirm\([^)]*(sample crew|sample data|Start over)/i, 'a confirm() elsewhere still asks about resetting the demo');
});

test('DEMOBAR-10 (static) the bar\'s tokens read the product\'s: --demo-bg/--demo-fg/--demo-muted/--demo-line from --surface/--ink/--muted/--line', () => {
  const css = filesIn('css', '.css').map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  const want = { '--demo-bg': '--surface', '--demo-fg': '--ink', '--demo-muted': '--muted', '--demo-line': '--line' };
  const wrong = Object.entries(want).filter(([k, v]) => !new RegExp(`${k}\\s*:\\s*var\\(\\s*${v}\\s*[,)]`).test(css)).map(([k, v]) => `${k} -> ${v}`);
  assert.deepStrictEqual(wrong, [], `not defined from the product tokens: ${wrong.join(', ')}`);
});

test('DEMOBAR-10 (static) the badge never uses --accent', () => {
  const css = filesIn('css', '.css').map(read).join('\n').replace(/\/\*[\s\S]*?\*\//g, '');
  // every rule whose selector names a badge in the demo bar
  const rules = [...css.matchAll(/([^{}]*demo[^{}]*badge[^{}]*)\{([^}]*)\}/g)];
  assert.ok(rules.length, 'no CSS rule for the demo bar\'s badge (a selector with "demo" and "badge")');
  const bad = rules.filter((m) => /var\(\s*--accent\s*[,)]/.test(m[2])).map((m) => m[1].trim());
  assert.deepStrictEqual(bad, [], `badge rules using --accent: ${bad.join(', ')}`);
});

test('DEMOBAR wiring: npm run test:e2e runs tests/e2e-demobar.js; npm test needs no browser for this file', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match(pkg.scripts['test:e2e'], /node tests\/e2e-demobar\.js/);
  assert.doesNotMatch(read('tests/demobar.test.js'), /require\(['"](\.\/browser\.js|playwright)['"]\)/);
});

test('DEMOBAR-2 UX-R1 (static) the back link has no short "← Back" form: no "← Back" and no demo-back-short in js/ or css/', () => {
  /** @type {string[]} */
  const found = [];
  for (const f of SOURCES()) {
    read(f).split('\n').forEach((l, i) => {
      for (const g of ['← Back', 'demo-back-short']) if (l.includes(g)) found.push(`${f}:${i + 1} "${g}"`);
    });
  }
  assert.deepStrictEqual(found, [], `still there: ${found.join(', ')}`);
});

test('DEMOBAR-3 PS-R1 (static) docs/PRIVACY.md S4 describes the Details drawer as decided: made-up crew, stays in this browser, never sent anywhere, public map servers see the area shown', () => {
  const privacy = read('docs/PRIVACY.md');
  const at = privacy.indexOf('- **S4**');
  assert.ok(at >= 0, 'no S4 in docs/PRIVACY.md');
  const end = privacy.indexOf('\n- **S5**', at);
  const s4 = privacy.slice(at, end < 0 ? undefined : end).replace(/\s+/g, ' ');
  const want = 'its Details drawer says the crew is made up, changes stay in this browser and are never sent anywhere, and map pictures come from public map servers, which can see what area the map shows (near the visitor only if they turn off "Pretend I\'m at the job")';
  assert.ok(s4.includes(want), `S4 does not hold the decided drawer clause.\nwant: ${want}\nS4:   ${s4}`);
  assert.doesNotMatch(s4, /only the map's pictures load from public map servers/, 'S4 still has the old drawer clause');
});
