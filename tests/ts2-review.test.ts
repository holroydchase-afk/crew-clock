// TS-2 review findings fixed in the same PR (docs/reviews/2026-11-26-architect-ts2.md,
// docs/reviews/2026-11-26-privacy-security-ts2.md). One test (or more) per finding ID, written
// before the fix. No browser, no Postgres; ARCH-R1 skips with a reason when esbuild is missing
// (CI runs npm ci before npm test, so it never skips there).
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.join(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const BUILD_TS = path.join(ROOT, 'scripts', 'build-ts.mts');

function hasEsbuild(): boolean {
  try { require.resolve('esbuild', { paths: [ROOT] }); return true; } catch { return false; }
}
const NO_ESBUILD = !hasEsbuild() && 'esbuild not installed (run npm ci); CI runs npm ci before npm test';

function tempSrc(files: Record<string, string>): { src: string, out: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts2-review-'));
  const src = path.join(dir, 'src');
  const out = path.join(dir, 'out');
  fs.mkdirSync(src);
  for (const [name, body] of Object.entries(files)) fs.writeFileSync(path.join(src, name), body);
  return { src, out };
}
const buildTs = (src: string, out: string) => spawnSync(process.execPath, [BUILD_TS, '--src', src, '--out', out], { cwd: ROOT, encoding: 'utf8' });
const written = (out: string) => (fs.existsSync(out) ? fs.readdirSync(out) : []);

// --- ARCH-R1: a warning from esbuild fails the build and writes nothing -----------------------

// The review's suggested repro (top-level `this` beside an `export declare`) gives no warning with
// build-ts's settings (no format, so esbuild leaves `this` alone; checked with esbuild 0.28.2: QA-R8).
// A duplicate object key is a warning esbuild always reports and a real bug, so it stands in for
// "any warning".
const WARNS = 'export declare const x: number;\nconst api = { a: 1, a: 2 };\nconsole.log(api);\n';

test('ARCH-R1 (guard) the warning file is a valid transform: esbuild warns, does not error', { skip: NO_ESBUILD }, async () => {
  const { transform } = await import('esbuild');
  const r = await transform(WARNS, { loader: 'ts', target: 'es2022', logLevel: 'silent' });
  assert.ok(r.warnings.length > 0, 'esbuild reports a warning for a duplicate object key');
});

test('ARCH-R1 build-ts exits 1 and writes nothing when esbuild reports any warning', { skip: NO_ESBUILD }, () => {
  const { src, out } = tempSrc({ 'ok.ts': 'const a: number = 1;\nconsole.log(a);\n', 'warn.ts': WARNS });
  const r = buildTs(src, out);
  assert.strictEqual(r.status, 1, `build-ts must fail on a warning; got exit ${r.status}, stdout: ${r.stdout.trim()}`);
  assert.deepStrictEqual(written(out), [], 'nothing written, not even the clean file');
  assert.match(r.stderr, /warn\.ts:\d+:\d+/, 'the warning is printed with its file and line:column');
});

test('ARCH-R1 (guard) a clean temp source still builds with exit 0', { skip: NO_ESBUILD }, () => {
  const { src, out } = tempSrc({ 'ok.ts': 'const a: number = 1;\nconsole.log(a);\n' });
  const r = buildTs(src, out);
  assert.strictEqual(r.status, 0, r.stderr);
  assert.deepStrictEqual(written(out), ['ok.js']);
});

// --- ARCH-R2: the `export declare` names equal the runtime api keys ---------------------------

const declaredNames = (src: string): string[] => [...src.matchAll(/^export declare (?:const|let|var|function) (\w+)/gm)].map((m) => m[1]).sort();

test('ARCH-R2 (guard) the declare parser catches a missing and an extra name', () => {
  const src = 'export declare const A: number;\nexport declare function b(x: number): number;\n';
  assert.deepStrictEqual(declaredNames(src), ['A', 'b']);
  assert.notDeepStrictEqual(declaredNames(src), ['A', 'b', 'c'].sort());
  assert.notDeepStrictEqual(declaredNames(src), ['A']);
});

for (const name of ['geo', 'report', 'chain', 'risk', 'ai']) {
  test(`ARCH-R2 js/${name}.ts export declare names equal Object.keys(require('js/${name}.js'))`, () => {
    const declared = declaredNames(read(`js/${name}.ts`));
    const runtime = Object.keys(require(path.join(ROOT, 'js', `${name}.js`)) as Record<string, unknown>).sort();
    assert.ok(declared.length > 0, `js/${name}.ts declares its exports`);
    assert.deepStrictEqual(declared, runtime, `js/${name}.ts declares exactly what js/${name}.js exports`);
  });
}

// --- ARCH-R3: no orphan or hand-written js/*.js ------------------------------------------------

test('ARCH-R3 every top-level js/*.js has a js/*.ts beside it and starts with the generated banner (js/vendor excluded)', () => {
  const js = fs.readdirSync(path.join(ROOT, 'js'), { withFileTypes: true })
    .filter((d) => d.isFile() && d.name.endsWith('.js')).map((d) => d.name).sort();
  assert.ok(js.length > 0);
  const orphans = js.filter((f) => !fs.existsSync(path.join(ROOT, 'js', f.replace(/\.js$/, '.ts'))));
  assert.deepStrictEqual(orphans, [], 'every js/*.js is emitted from a js/*.ts');
  const noBanner = js.filter((f) => read(`js/${f}`).split('\n')[0] !== `// Generated from js/${f.replace(/\.js$/, '.ts')} by npm run build. Do not edit.`);
  assert.deepStrictEqual(noBanner, [], 'every js/*.js starts with the generated banner');
});

// --- PS-R3: npm ci never runs install scripts -------------------------------------------------

test('PS-R3 ci.yml installs the root dev tools with npm ci --ignore-scripts', () => {
  const ci = read('.github/workflows/ci.yml');
  // The root install (TypeScript, esbuild); the messenger job's own `cd messenger && npm ci` is out of PS-R3's scope.
  const installs = [...ci.matchAll(/^\s*run: (npm ci\b.*)$/gm)].map((m) => m[1].trim());
  assert.ok(installs.length > 0, 'ci.yml runs the root npm ci');
  for (const line of installs) assert.match(line, /--ignore-scripts/, `ci.yml: "${line}" must pass --ignore-scripts`);
});

for (const doc of ['README.md', 'CLAUDE.md']) {
  test(`PS-R3 ${doc} setup line says npm ci --ignore-scripts`, () => {
    const lines = read(doc).split('\n').filter((l) => /^\s+npm ci\b/.test(l));
    assert.ok(lines.length > 0, `${doc} has an npm ci setup line`);
    for (const l of lines) assert.match(l, /npm ci --ignore-scripts/, `${doc}: "${l.trim()}"`);
  });
}

// --- PS-R1 / PS-R2: PRIVACY.md [true] citations point at the code they claim ---------------------

/** e.g. "179-199,220-233" */
const ranges = (cite: string): [number, number][] => cite.split(',').map((r) => { const [a, b] = r.split('-').map(Number); return [a, b ?? a]; });
/** 1-based lines matching */
const linesOf = (file: string, marker: RegExp): number[] => read(file).split('\n').flatMap((l, i) => (marker.test(l) ? [i + 1] : []));
function cited(row: string, file: string): [number, number][] {
  const m = row.match(new RegExp('`' + file.replace(/\./g, '\\.') + ':([\\d,-]+)`'));
  assert.ok(m, `the row cites ${file}`);
  return ranges((m as RegExpMatchArray)[1]);
}
const covers = (rs: [number, number][], n: number) => rs.some(([a, b]) => n >= a && n <= b);
const privacyRow = (rowMarker: RegExp) => {
  const row = read('docs/PRIVACY.md').split('\n').filter((l) => rowMarker.test(l));
  assert.strictEqual(row.length, 1, `exactly one PRIVACY.md line matches ${rowMarker}`);
  return row[0];
};

test('PS-R1 PRIVACY.md map-tiles citation of sw.js covers isTile and the tile branch of the fetch handler', () => {
  const rs = cited(privacyRow(/sw\.js:\d/), 'sw.js');
  for (const [what, re] of (([
    ['function isTile', /^function isTile\(/],
    ['the tile branch', /^\s+if \(isTile\(url\)\)/],
  ]) as [string, RegExp][])) {
    const at = linesOf('sw.js', re);
    assert.strictEqual(at.length, 1, `sw.js has one ${what}`);
    assert.ok(covers(rs, at[0]), `the citation ${JSON.stringify(rs)} covers ${what} at sw.js:${at[0]}`);
  }
});

test('PS-R2 PRIVACY.md outbox citation of js/app.ts covers the stub builder and "Refused stubs are never resent"', () => {
  const rs = cited(privacyRow(/^\| Unsent punches and pictures/), 'js/app.ts');
  for (const [what, re] of (([
    ['toStub', /const toStub = /],
    ['the never-resent filter', /Refused stubs are never resent/],
    ['the rejected-to-stub loop', /Store\.outbox\.add\(toStub\(/],
  ]) as [string, RegExp][])) {
    const at = linesOf('js/app.ts', re);
    assert.strictEqual(at.length, 1, `js/app.ts has one ${what}`);
    assert.ok(covers(rs, at[0]), `the citation ${JSON.stringify(rs)} covers ${what} at js/app.ts:${at[0]}`);
  }
});
