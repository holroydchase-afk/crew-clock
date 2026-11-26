// TS-2 (issue #36 PR 2, milestone M0.4): the front end moves to strict TypeScript with an esbuild
// step that only strips types. Spec: docs/product/SPEC-TS-2.md, criteria TS2-1 to TS2-12.
// No browser, no Postgres. Tests that need esbuild skip with a reason when it is not installed;
// TS2-3 also requires CI to run `npm ci` before `npm test`, so on CI they never skip.
//
// build-ts contract these tests fix (the spec says "writes to a temp dir" and "an empty input dir"
// without naming flags; this is the simplest shape that satisfies both):
//   node scripts/build-ts.mts [--src DIR] [--out DIR]     defaults: --src js --out js
//   reads DIR/*.ts (not *.d.ts), writes OUT/NAME.js with line 1
//   "// Generated from js/NAME.ts by npm run build. Do not edit."
//   exit 1 on any syntax error, writing nothing; exit 1 with "no js/*.ts found" for an empty --src.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { spawnSync, execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

const ROOT = path.join(import.meta.dirname, '..');
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));

const NAMES = ['ai', 'api-supabase', 'api', 'app', 'chain', 'demo-backend', 'device', 'geo', 'icons',
  'messenger', 'push', 'report', 'risk', 'store'];
const SHARED = ['geo', 'report', 'chain', 'risk'];
const banner = (n: string) => `// Generated from js/${n}.ts by npm run build. Do not edit.`;
const BUILD_TS = path.join(ROOT, 'scripts', 'build-ts.mts');
const BUILD_SITE = path.join(ROOT, 'scripts', 'build-site.mts');

function hasEsbuild(): boolean {
  try { require.resolve('esbuild', { paths: [ROOT] }); return true; } catch { return false; }
}
const NO_ESBUILD = !hasEsbuild() && 'esbuild not installed (run npm ci); CI runs npm ci before npm test and the build-diff step';

/** tsconfig allows comments and trailing commas; strip them outside strings only. */
function jsonc(src: string) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') { const m = ((/^"(?:[^"\\]|\\.)*"/.exec(src.slice(i))) as RegExpExecArray); out += m[0]; i += m[0].length - 1; }
    else if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; }
    else if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; }
    else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

/** every file under dir, relative to ROOT */
function walk(dir: string): string[] {
  if (!exists(dir)) return [];
  return fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
    const rel = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'node_modules' ? [] : walk(rel);
    return [rel];
  });
}
const tsSources = (p: string) => fs.readdirSync(p).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort();
const tmp = (tag: string) => fs.mkdtempSync(path.join(os.tmpdir(), `crew-ts2-${tag}-`));
const runBuild = (args: string[]) => spawnSync(process.execPath, [BUILD_TS, ...args], { cwd: ROOT, encoding: 'utf8' });
function snapshot(dir: string): Record<string,string> {
  const o: Record<string,string> = {};
  for (const f of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile()) o[f] = crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  }
  return o;
}

// ---------------------------------------------------------------- TS2-1
test('TS2-1 js/ holds the 14 hand-written modules as .ts (no .d.ts), none under js/vendor or vendor', () => {
  assert.deepStrictEqual(tsSources(path.join(ROOT, 'js')), NAMES.map((n) => `${n}.ts`).sort(),
    'js/*.ts (excluding .d.ts) must be exactly the 14 modules');
  const vendored = [...walk('js/vendor'), ...walk('vendor')].filter((f) => f.endsWith('.ts'));
  assert.deepStrictEqual(vendored, [], 'no .ts under js/vendor or vendor');
});

// ---------------------------------------------------------------- TS2-2
test('TS2-2 every emitted js/NAME.js starts with the generated banner', () => {
  const wrong = NAMES.filter((n) => read(`js/${n}.js`).split('\n')[0] !== banner(n));
  assert.deepStrictEqual(wrong, [], `line 1 must be "${banner('NAME')}"`);
});

test('TS2-2 .gitattributes marks js/*.js generated and keeps both vendored lines', () => {
  const ga = read('.gitattributes');
  assert.match(ga, /^js\/\*\.js\s+linguist-generated\b/m, 'js/*.js linguist-generated');
  assert.match(ga, /^vendor\/\*\*\s+linguist-vendored/m);
  assert.match(ga, /^js\/vendor\/\*\*\s+linguist-vendored/m);
});

// ---------------------------------------------------------------- TS2-3
test('TS2-3 CI installs dev tools before npm test, then runs npm run build and git diff --exit-code on js/', () => {
  const ci = read('.github/workflows/ci.yml');
  // QA-R10: PS-R3 makes the root install `npm ci --ignore-scripts` (no install scripts on CI), strictly.
  const install = ci.search(/^\s*run:\s*npm ci --ignore-scripts\s*$/m);
  const unit = ci.search(/^\s*run:\s*npm test\s*$/m);
  assert.ok(install >= 0 && unit >= 0, 'ci.yml has both `npm ci --ignore-scripts` and `npm test` steps');
  assert.ok(install < unit, 'npm ci comes before npm test, so esbuild-dependent tests run on CI instead of skipping');
  const build = ci.search(/npm run build\b/);
  assert.ok(build >= 0, 'ci.yml runs npm run build');
  const diff = ci.slice(build).search(/git diff --exit-code\b[^\n]*\bjs\/?(\s|$)/);
  assert.ok(diff >= 0, 'git diff --exit-code on js/ follows npm run build');
});

test('TS2-3 build-ts into a temp dir reproduces the 14 committed js/NAME.js byte for byte', { skip: NO_ESBUILD }, () => {
  const out = tmp('diff');
  try {
    const r = runBuild(['--out', out]);
    assert.strictEqual(r.status, 0, `build-ts failed: ${r.stderr}`);
    const differ = NAMES.filter((n) => !fs.existsSync(path.join(out, `${n}.js`))
      || !fs.readFileSync(path.join(out, `${n}.js`)).equals(fs.readFileSync(path.join(ROOT, 'js', `${n}.js`))));
    assert.deepStrictEqual(differ, [], 'emitted output differs from committed js/: run npm run build and commit');
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- TS2-4
test('TS2-4 two builds in a row give identical output', { skip: NO_ESBUILD }, () => {
  const a = tmp('a'), b = tmp('b');
  try {
    for (const d of [a, b]) { const r = runBuild(['--out', d]); assert.strictEqual(r.status, 0, r.stderr); }
    const sa = snapshot(a);
    assert.strictEqual(Object.keys(sa).length, NAMES.length, '14 outputs');
    assert.deepStrictEqual(snapshot(b), sa);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('TS2-4 a .ts with a syntax error exits 1 and leaves the committed js/ unchanged', { skip: NO_ESBUILD }, () => {
  const src = tmp('bad');
  try {
    for (const f of tsSources(path.join(ROOT, 'js'))) fs.copyFileSync(path.join(ROOT, 'js', f), path.join(src, f));
    fs.writeFileSync(path.join(src, 'zz-broken.ts'), 'export const x: number = (;\n');
    const before = snapshot(path.join(ROOT, 'js'));
    const r = runBuild(['--src', src, '--out', path.join(ROOT, 'js')]);
    assert.strictEqual(r.status, 1, 'exit 1 on a syntax error');
    assert.deepStrictEqual(snapshot(path.join(ROOT, 'js')), before, 'nothing in js/ was written');
  } finally { fs.rmSync(src, { recursive: true, force: true }); }
});

test('TS2-4 an empty input dir exits 1 with "no js/*.ts found"', () => {
  assert.ok(fs.existsSync(BUILD_TS), 'scripts/build-ts.mts missing');
  const src = tmp('empty'), out = tmp('emptyout');
  try {
    const r = runBuild(['--src', src, '--out', out]);
    assert.strictEqual(r.status, 1);
    assert.match(`${r.stdout}${r.stderr}`, /no js\/\*\.ts found/);
    assert.deepStrictEqual(fs.readdirSync(out), [], 'nothing written');
  } finally { for (const d of [src, out]) fs.rmSync(d, { recursive: true, force: true }); }
});

test('TS2-4 two build-site --demo runs give identical files and the same VERSION hash', () => {
  const a = tmp('site-a'), b = tmp('site-b');
  try {
    for (const d of [a, b]) execFileSync(process.execPath, [BUILD_SITE, d, '--demo'], { cwd: ROOT, stdio: 'pipe' });
    const ver = (d: string) => (/const VERSION = '([^']*)';/.exec(fs.readFileSync(path.join(d, 'sw.js'), 'utf8')) || [])[1];
    assert.match(String(ver(a)), /-[0-9a-f]{10}$/);
    assert.strictEqual(ver(b), ver(a));
    const files = (d: string) => walk(path.relative(ROOT, d)).map((f) => path.relative(path.relative(ROOT, d), f)).sort();
    assert.deepStrictEqual(files(b), files(a));
    for (const f of files(a)) assert.ok(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), `${f} differs`);
  } finally { for (const d of [a, b]) fs.rmSync(d, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- TS2-5 (replaces TS-1's js/*.js include check)
test('TS2-5 package.json: build script, serve builds first, esbuild pinned exact in package.json and lockfile', () => {
  const pkg = JSON.parse(read('package.json'));
  const s = pkg.scripts || {};
  assert.strictEqual(s.build, 'node scripts/build-ts.mts');
  assert.ok(String(s.serve || '').startsWith('npm run build'), `serve starts with npm run build (got ${s.serve})`);
  const v = (pkg.devDependencies || {}).esbuild;
  assert.ok(v, 'esbuild in devDependencies');
  assert.match(v, /^\d+\.\d+\.\d+$/, `esbuild pinned to an exact version, no ^ or ~ (got ${v})`);
  const lock = JSON.parse(read('package-lock.json'));
  assert.strictEqual(((lock.packages || {})['node_modules/esbuild'] || {}).version, v, 'lockfile esbuild matches package.json');
});

test('TS2-5 tsconfig.json: erasableSyntaxOnly and noEmit, includes js/*.ts and not js/*.js', () => {
  const c = jsonc(read('tsconfig.json'));
  const o = c.compilerOptions || {};
  assert.strictEqual(o.erasableSyntaxOnly, true, 'erasableSyntaxOnly');
  assert.strictEqual(o.noEmit, true, 'noEmit');
  const inc = c.include || [];
  assert.ok(inc.includes('js/*.ts'), `include has js/*.ts (got ${inc.join(', ')})`);
  assert.ok(!inc.includes('js/*.js'), 'include drops js/*.js (it is generated)');
});

// ---------------------------------------------------------------- TS2-6
// Export keys of the four shared modules on main 444c5f8, before the rename.
const KEYS: Record<string, string[]> = {
  geo: ['FT_PER_M', 'NEAR_FACTOR', 'WEAK_ACCURACY_M', 'bestFix', 'checkFix', 'distanceM', 'fenceStatus', 'formatDistance', 'needsPhoto', 'toFeet', 'toMeters'],
  report: ['SEVERITY', 'csvCell', 'dropOldGps', 'fmtHours', 'lastPunchByCrew', 'pairShifts', 'shiftsForDay', 'startOfDay', 'timesheetCsv', 'weekDays', 'weekStart', 'weekTotals', 'worse'],
  chain: ['VERSION', 'b64url', 'canonical', 'exportPublic', 'fromB64url', 'generateKey', 'sha256', 'sha256Bytes', 'signPunch', 'verifyAll', 'verifyPunch'],
  risk: ['RULES', 'assess', 'describe', 'topLevel'],
};
const GLOBAL: Record<string, string> = { geo: 'Geo', report: 'Report', chain: 'Chain', risk: 'Risk' };

test('TS2-6 emitted shared modules stay classic scripts: no import/export lines, same export keys', () => {
  for (const n of SHARED) {
    const src = read(`js/${n}.js`);
    const io = src.split('\n').filter((l) => /^(import|export) /.test(l));
    assert.deepStrictEqual(io, [], `js/${n}.js has import/export lines`);
    const mod = require(path.join(ROOT, 'js', `${n}.js`)) as Record<string, unknown>;
    assert.deepStrictEqual(Object.keys(mod).sort(), KEYS[n], `js/${n}.js export keys`);
  }
});

test('TS2-6 emitted shared modules define Geo, Report, Chain, Risk on self in a vm (4 of 4)', () => {
  const got = SHARED.filter((n) => {
    const ctx: Record<string, unknown> = { console, crypto: globalThis.crypto, TextEncoder, TextDecoder };
    ctx.self = ctx;
    vm.runInNewContext(read(`js/${n}.js`), ctx, { filename: `js/${n}.js` });
    const g = ctx[GLOBAL[n]];
    return Boolean(g) && typeof g === 'object';
  });
  assert.deepStrictEqual(got, SHARED);
});

// ---------------------------------------------------------------- TS2-7
test('TS2-7 build-site --demo ships no .ts (globals.d.ts included), every SHELL_FILES entry, pages.yml has no npm or esbuild', async () => {
  const out = tmp('dist');
  try {
    execFileSync(process.execPath, [BUILD_SITE, out, '--demo'], { cwd: ROOT, stdio: 'pipe' });
    const rel = path.relative(ROOT, out);
    const ts = walk(rel).filter((f) => f.endsWith('.ts')).map((f) => path.relative(rel, f));
    assert.deepStrictEqual(ts, [], 'no .ts files in dist');
    const { shellFiles } = await import(BUILD_SITE);
    const missing = shellFiles(read('sw.js')).filter((f: string) => f !== './' && !fs.existsSync(path.join(out, f)));
    assert.deepStrictEqual(missing, []);
  } finally { fs.rmSync(out, { recursive: true, force: true }); }
  const pages = read('.github/workflows/pages.yml');
  assert.strictEqual((pages.match(/npm/g) || []).length, 0, 'pages.yml mentions npm');
  assert.strictEqual((pages.match(/esbuild/g) || []).length, 0, 'pages.yml mentions esbuild');
  assert.match(pages, /build-site\.mts dist --demo/, 'Pages still builds --demo only');
});

// ---------------------------------------------------------------- TS2-8
// Budget re-baselined to main 444c5f8 (QA-R1, chief of staff decision): was 215063 in the first spec draft.
const BYTE_BUDGET = 221763;
test('TS2-8 the 14 emitted js/*.js total <= 221763 bytes (the phone byte budget, main 444c5f8)', () => {
  const total = NAMES.reduce((s, n) => s + fs.statSync(path.join(ROOT, 'js', `${n}.js`)).size, 0);
  assert.ok(total <= BYTE_BUDGET, `emitted js/*.js total ${total} bytes > ${BYTE_BUDGET}`);
});

// ---------------------------------------------------------------- TS2-9
test('TS2-9 ci.yml runs the build-diff step before the sync-shared step', () => {
  const ci = read('.github/workflows/ci.yml');
  const diff = ci.search(/npm run build\b[\s\S]*?git diff --exit-code\b[^\n]*\bjs\/?(\s|$)/);
  const sync = ci.search(/sync-shared\.sh/);
  assert.ok(diff >= 0, 'build-diff step present');
  assert.ok(sync >= 0, 'sync-shared step present');
  assert.ok(diff < sync, 'build-diff comes before sync-shared');
});

test('TS2-9 the 4 emitted shared files equal their Edge copies (4 of 4), and shared.test checks all 4', () => {
  const equal = SHARED.filter((n) => fs.readFileSync(path.join(ROOT, 'js', `${n}.js`))
    .equals(fs.readFileSync(path.join(ROOT, 'supabase/functions/_shared/vendor', `${n}.js`))));
  assert.deepStrictEqual(equal, SHARED);
  const st = read('tests/shared.test.ts');
  for (const n of SHARED) assert.ok(st.includes(`'${n}'`), `shared.test.ts covers ${n}`);
  assert.match(st, /'\.\.\/js'/, 'shared.test.ts reads the emitted js/ files');
});

// ---------------------------------------------------------------- TS2-10
test('TS2-10 location.test.ts reads the TypeScript sources js/app.ts and js/geo.ts', () => {
  const src = read('tests/location.test.ts');
  assert.ok(src.includes('js/app.ts'), 'location.test.ts reads js/app.ts');
  assert.ok(src.includes('js/geo.ts'), 'location.test.ts reads js/geo.ts');
});

test('TS2-10 check-logs flags console.log(lat) in a js/zz.ts fixture (exit 1)', () => {
  const dir = tmp('logs');
  try {
    fs.mkdirSync(path.join(dir, 'js'));
    const f = path.join(dir, 'js', 'zz.ts');
    fs.writeFileSync(f, 'export function f(lat: number): void {\n  console.log(lat);\n}\n');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-logs.mjs'), f], { cwd: ROOT, encoding: 'utf8' });
    assert.strictEqual(r.status, 1, `check-logs should fail on console.log(lat) in .ts: ${r.stdout}${r.stderr}`);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ---------------------------------------------------------------- TS2-11
// Dated records are history and stay as written (QA-R2, chief of staff decision): docs/runs, docs/reviews,
// docs/product (specs and review shots, SPEC-TS-2.md included).
const HISTORY = ['runs', 'reviews', 'product'].map((d) => `docs${path.sep}${d}${path.sep}`);
const DOCS = ['README.md', 'CLAUDE.md', 'PLAN.md', ...walk('docs').filter((f) => f.endsWith('.md') && !HISTORY.some((h) => f.startsWith(h)))];
const CITE = new RegExp(`js/(${NAMES.join('|')})\\.js:\\d+`, 'g');

test('TS2-11 docs cite no js/NAME.js:LINE for the 14 modules (README, CLAUDE.md, PLAN.md, docs outside docs/runs, docs/reviews, docs/product)', () => {
  const hits = DOCS.flatMap((f) => (read(f).match(CITE) || []).map((m) => `${f}: ${m}`));
  assert.deepStrictEqual(hits, [], `${hits.length} stale js/*.js line citations`);
});

test('TS2-11 "no build step" only alongside "deploy-time", and CLAUDE.md says npm run build', () => {
  const hits = DOCS.flatMap((f) => read(f).split('\n').map((l, i) => [l, i + 1])
    .filter(([l]) => /no build step/i.test(String(l)) && !/deploy-time/i.test(String(l))).map(([, i]) => `${f}:${i}`));
  assert.deepStrictEqual(hits, [], 'lines saying "no build step" without "deploy-time"');
  assert.ok(read('CLAUDE.md').includes('npm run build'), 'CLAUDE.md mentions npm run build');
});

// ---------------------------------------------------------------- TS2-12
// JSDoc `any` on main 444c5f8: every word `any` inside a {type} of a /** */ comment in js/*.js.
// ai 1, api-supabase 3, device 1, messenger 2, store 2 = 9. The .ts may not use more.
const MAIN_JSDOC_ANY = 9;
/** Code with comments and string/template text removed, so only real `any` types count. */
function codeOnly(s: string) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '/' && s[i + 1] === '/') { while (i < s.length && s[i] !== '\n') i++; out += '\n'; }
    else if (c === '/' && s[i + 1] === '*') { i = s.indexOf('*/', i + 2); if (i < 0) break; i++; }
    else if (c === "'" || c === '"' || c === '`') { i++; while (i < s.length && s[i] !== c) { if (s[i] === '\\') i++; i++; } out += '""'; }
    else out += c;
  }
  return out;
}

// The title is built so this file holds no literal suppression comment text (TS3-5 scans every test).
const SUPPRESSIONS = ['nocheck', 'ignore', 'expect-error'].map((w) => '@ts-' + w).join('/');
test(`TS2-12 js/*.ts: no ${SUPPRESSIONS}, and any-annotations <= the JSDoc any count on main (9)`, () => {
  const ts = tsSources(path.join(ROOT, 'js'));
  assert.strictEqual(ts.length, NAMES.length, `expected 14 js/*.ts, found ${ts.length}`);
  const sup = ts.filter((f) => /@ts-(nocheck|ignore|expect-error)/.test(read(`js/${f}`)));
  assert.deepStrictEqual(sup, [], 'type-check suppressions in js/*.ts');
  const anyCount = ts.reduce((n, f) => n + (codeOnly(read(`js/${f}`)).match(/\bany\b/g) || []).length, 0);
  assert.ok(anyCount <= MAIN_JSDOC_ANY, `any in js/*.ts: ${anyCount} > ${MAIN_JSDOC_ANY} JSDoc any on main`);
});

const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
test('TS2-12 tsc -p tsconfig.json over js/*.ts: 0 errors', { skip: !fs.existsSync(TSC) && 'typescript not installed (npm ci); CI runs npm run typecheck' }, () => {
  assert.ok(tsSources(path.join(ROOT, 'js')).length === NAMES.length, 'no js/*.ts to type-check yet');
  const r = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `tsc errors:\n${r.stdout}`);
});
