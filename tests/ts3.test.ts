// TS-3 (issue #36 PR 3, docs/product/SPEC-TS-3.md): the unit tests move to strict TypeScript on Node 22
// type stripping. TS3-1 to TS3-10, written red on main 72764fc by qa-tdd (M0.5.1).
// It was written as plain JS so main's npm test glob ran it, and was renamed last, in M0.5.3, to
// tests/ts3 with a .ts extension (ESM imports, import.meta.dirname); it counts as the 30th .ts test.
// Its own needles are built so that its scans never match this file's text.
// Regression guards (green on main today, must stay green): the pin checks for TS3-3 and TS3-7 on any
// file not yet renamed, and TS3-9 (dist has no tests/ path and the same VERSION hash as main).
import test from 'node:test';
import { after } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const SELF = path.basename(import.meta.filename);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));
const JS = '.test' + '.js';
const TS = '.test' + '.ts';

// Per-file test counts on main 72764fc (node --test, tap reporter): 282 tests in 29 files.
const TEST_PINS: Record<string, number> = {
  ai: 4, aishelf: 8, chain: 5, 'check-logs': 5, demo: 8, demobar: 7, enhance: 26, 'eval-geofence': 9,
  grants: 6, harden: 14, harden2: 19, hints: 2, license: 13, livecheck: 4, location: 6, m19: 13, readme: 3,
  risk: 6, shared: 1, 'shelf-docs': 2, showcase: 3, site: 4, 'studio-standard': 15, 'studio-wiring': 8,
  theme: 23, 'ts2-review': 15, ts2: 23, typecheck: 9, unit: 21,
};
// Assert calls per file on main 72764fc, before the rename: matches of /\bassert\.\w+/ (so t.assert. counts
// too) on lines that are not comment lines. 738 in total. After the rename each file must have at least these.
const ASSERT_PINS: Record<string, number> = {
  ai: 16, aishelf: 21, chain: 9, 'check-logs': 8, demo: 13, demobar: 13, enhance: 86, 'eval-geofence': 62,
  grants: 40, harden: 23, harden2: 48, hints: 2, license: 53, livecheck: 7, location: 8, m19: 41, readme: 10,
  risk: 12, shared: 1, 'shelf-docs': 3, showcase: 4, site: 17, 'studio-standard': 53, 'studio-wiring': 25,
  theme: 24, 'ts2-review': 24, ts2: 60, typecheck: 19, unit: 36,
};
const NAMES = Object.keys(TEST_PINS);
const NO_MESSENGER_SKIP = fs.existsSync(path.join(ROOT, 'messenger', 'node_modules')); // installed: no skip allowed
const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
const commentLines = (src: string) => src.split('\n').filter((l) => /^\s*(\/\/|\/\*|\*)/.test(l) || /\s\/\/\s/.test(l));
const countAsserts = (src: string) => (codeLines(src).match(/\bassert\.\w+/g) || []).length;
const topTests = () => fs.readdirSync(path.join(ROOT, 'tests')).sort();
const tsTests = () => topTests().filter((f) => f.endsWith(TS));

/** The 30 .ts unit tests must exist before any per-file .ts check means anything (0 files would pass vacuously). */
function requireTsTests() {
  const ts = tsTests();
  const missing = NAMES.filter((n) => !ts.includes(n + TS));
  assert.deepStrictEqual(missing, [], `not yet renamed to ${TS} (TS-3 not done): ${missing.length} of 29`);
  assert.ok(ts.includes('ts3' + TS), `ts3${TS} is in the set (renamed last, M0.5.3)`);
  return ts;
}

// ---------- running test files without racing the outer npm test ----------
// grants GRANT-11 writes fixed temp files into the repo, so a second copy of it running beside the outer
// `npm test` would race. Child runs go in a throwaway copy of the working tree (node_modules linked).
let copyDir: string | undefined;
function workCopy() {
  if (copyDir) return copyDir;
  copyDir = makeCopy(true);
  return copyDir;
}
/** A copy of the working tree plus .git; node_modules linked only when link is true (false = CI's checkout). */
function makeCopy(link: boolean) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ts3-'));
  const ls = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(ls.status, 0, `git ls-files: ${ls.stderr}`);
  for (const f of ls.stdout.split('\n')) {
    if (!f || /(^|\/)\d+_tmp(_test)?\.sql$/.test(f)) continue; // GRANT-11's own temp files, mid-run in the outer suite
    try {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; // deleted since ls-files
    }
  }
  fs.cpSync(path.join(ROOT, '.git'), path.join(dir, '.git'), { recursive: true });
  for (const nm of ['node_modules', 'messenger/node_modules']) {
    if (link && fs.existsSync(path.join(ROOT, nm))) fs.symlinkSync(path.join(ROOT, nm), path.join(dir, nm), 'dir');
  }
  return dir;
}
after(() => { if (copyDir) fs.rmSync(copyDir, { recursive: true, force: true }); });

/** tests/<name> with extension */
function runFile(file: string): Promise<{ code: number | null, tests: number, pass: number, fail: number, skipped: number, todos: number, cancelled: number, tail: string, full: string }> {
  const cwd = workCopy();
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // else the child talks the parent's protocol instead of TAP
  return new Promise((resolve) => {
    const p = spawn(process.execPath, ['--test', '--test-reporter=tap', file], { cwd, env });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => {
      const n = (k: string) => { const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(out); return m ? Number(m[1]) : -1; };
      resolve({ code, tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todos: n('todo'), cancelled: n('cancelled'), tail: out.slice(-1500), full: out });
    });
  });
}

async function checkCounts(names: string[], ext: string) {
  const bad: string[] = [];
  let total = 0;
  const queue = [...names];
  const worker = async () => {
    for (let n = queue.shift(); n !== undefined; n = queue.shift()) {
      const r = await runFile(`tests/${n}${ext}`);
      total += r.tests;
      const want = TEST_PINS[n];
      // The one environment skip on main: license LIC1-3's lockfile check needs messenger/node_modules, which
      // CI's unit step does not install (QA-R1). Allowed only there, only for that file, only once.
      const okSkip = n === 'license' && !NO_MESSENGER_SKIP && /# SKIP messenger\/node_modules is not installed/.test(r.full) ? 1 : 0;
      if (r.code !== 0 || r.tests !== want || r.pass !== want - okSkip || r.fail !== 0 || r.skipped !== okSkip || r.todos !== 0 || r.cancelled !== 0) {
        bad.push(`${n}${ext}: want ${want} passing, got tests ${r.tests} pass ${r.pass} fail ${r.fail} skipped ${r.skipped} todo ${r.todos} cancelled ${r.cancelled} exit ${r.code}\n${r.tail}`);
      }
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return { bad, total };
}

// ---------- TS3-1 ----------
test('TS3-1 tests/ holds 0 unit tests in JS and 30 in TypeScript; the 19 e2e, browser and sql runner files stay JS', () => {
  const top = topTests();
  const js = top.filter((f) => f.endsWith(JS));
  const e2e = top.filter((f) => /^e2e.*\.js$/.test(f));
  assert.strictEqual(e2e.length, 17, `17 tests/e2e*.js stay JS: ${e2e.join(', ')}`);
  assert.ok(top.includes('browser.js'), 'tests/browser.js stays JS');
  assert.ok(exists('tests/sql/runner.test.mjs'), 'tests/sql/runner.test.mjs stays as it is');
  assert.strictEqual(e2e.length + 1 + 1, 19, '19 JS files stay');
  assert.deepStrictEqual(js, [], `no tests/*${JS} left (found ${js.length})`);
  const ts = tsTests();
  assert.strictEqual(ts.length, 30, `30 tests/*${TS} (29 renamed plus ts3), found ${ts.length}`);
  assert.deepStrictEqual(ts, [...NAMES, 'ts3'].map((n) => n + TS).sort(), 'exactly the 29 pinned names plus ts3');
});

// ---------- TS3-2 ----------
// ARCH-R1: agents-check reruns agents.verify after only checkout and setup-node (no npm ci), so verify must
// install the dev tools itself.
const VERIFY = 'npm ci --ignore-scripts && npm test';
test('TS3-2 npm test runs the .ts glob, engines pins Node >=22.18, agents.verify is npm ci then npm test (ARCH-R1)', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.strictEqual(JSON.parse(read('studio-checks.json')).agents.verify, VERIFY, 'studio-checks agents.verify (ARCH-R1)');
  assert.ok(String((pkg.scripts || {}).test).startsWith('node --test tests/*.test.ts'), `scripts.test starts with the .ts glob, is: ${pkg.scripts.test}`);
  assert.strictEqual((pkg.engines || {}).node, '>=22.18', 'engines.node (type stripping on by default)');
});

// The CI shape of agents-check: a checkout with no node_modules, then bash -c "$verify". The copy's own npm test
// runs this file again, so the nested run skips this one test (CRW_TS3_CI_SHAPE) instead of recursing.
const NET_DOWN = /ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|network request|ENETUNREACH/;
test('TS3-2 CI shape (ARCH-R1): agents.verify succeeds in a copy of the repo with no node_modules', {
  timeout: 900000,
  skip: process.env.CRW_TS3_CI_SHAPE === '1' && 'nested inside the CI-shape run; the outer run checks it',
}, async (t) => {
  const verify = String(JSON.parse(read('studio-checks.json')).agents.verify);
  const dir = makeCopy(false);
  try {
    assert.ok(!fs.existsSync(path.join(dir, 'node_modules')), 'the copy starts with no node_modules, like CI');
    const env: NodeJS.ProcessEnv = { ...process.env, CRW_TS3_CI_SHAPE: '1' };
    delete env.NODE_TEST_CONTEXT;
    const r = await new Promise<{ code: number | null, out: string }>((resolve) => {
      const p = spawn('bash', ['-c', verify], { cwd: dir, env });
      let out = '';
      p.stdout.on('data', (d) => { out += d; });
      p.stderr.on('data', (d) => { out += d; });
      p.on('close', (code) => resolve({ code, out }));
    });
    if (r.code !== 0 && verify.startsWith('npm ci') && NET_DOWN.test(r.out) && !/# (pass|fail) \d+/.test(r.out)) {
      t.skip('npm ci could not reach the registry or cache here; CI has the network');
      return;
    }
    const failed = r.out.split('\n').filter((l) => /^not ok /.test(l)).join('\n');
    assert.strictEqual(r.code, 0, `bash -c "${verify}" in a no-node_modules copy failed:\n${failed}\n${r.out.slice(-2000)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---------- TS3-3 ----------
test('TS3-3 pins: 29 files, 282 tests, 738 asserts on main', () => {
  assert.strictEqual(NAMES.length, 29);
  assert.strictEqual(sum(TEST_PINS), 282);
  assert.deepStrictEqual(Object.keys(ASSERT_PINS), NAMES);
  assert.strictEqual(sum(ASSERT_PINS), 738);
});

test('TS3-3 guard: any test not yet renamed still has exactly its pinned count, all passing', { timeout: 600000 }, async () => {
  const left = NAMES.filter((n) => exists(`tests/${n}${JS}`));
  const { bad } = await checkCounts(left, JS);
  assert.deepStrictEqual(bad, [], 'pinned counts on the JS files');
});

test('TS3-3 each tests/*.test.ts runs its pinned number of tests: 282 in total, fail 0, skipped 0, never 0 found', { timeout: 600000 }, async () => {
  requireTsTests();
  const { bad, total } = await checkCounts(NAMES, TS);
  assert.deepStrictEqual(bad, [], 'per-file counts on the .ts files');
  assert.strictEqual(total, 282, 'total tests across the 29 renamed files');
});

// ---------- TS3-4 ----------
test('TS3-4 .ts tests: require only for js/, no CJS dirname, no import-require, enums or namespaces', () => {
  const dn = '__dir' + 'name';
  const bad: string[] = [];
  for (const f of requireTsTests()) {
    const src = read(`tests/${f}`);
    for (const m of src.matchAll(/\brequire\s*\(([^)\n]*)\)?/g)) {
      const arg = m[1];
      const underJs = /^\s*(['"`])(\.\.\/|\.\/\.\.\/)js\//.test(arg) || /['"`]js['"`]/.test(arg) || /['"`]js\//.test(arg);
      if (!underJs) bad.push(`${f}: ${'require'}(${arg})`);
    }
    if (src.includes(dn)) bad.push(`${f}: ${dn}`);
    if (/\bimport\s+\w+\s*=\s*require\b/.test(src)) bad.push(`${f}: import-equals require`);
    if (/\benum\s+\w/.test(src)) bad.push(`${f}: enum`);
    if (/\bnamespace\s+\w/.test(src)) bad.push(`${f}: namespace`);
  }
  assert.deepStrictEqual(bad, []);
});

// ---------- TS3-5 ----------
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
test('TS3-5 tsc -p tsconfig.json checks every .ts test with 0 errors and no suppression comments', { timeout: 300000 }, () => {
  const ts = requireTsTests();
  const sup: string[] = [];
  for (const f of ts) for (const m of read(`tests/${f}`).matchAll(/@ts-(nocheck|ignore|expect-error)\b/g)) sup.push(`${f}: ${m[0]}`);
  assert.deepStrictEqual(sup, [], 'no type-check suppressions in tests/*.test.ts');
  assert.ok(fs.existsSync(TSC), 'typescript installed (npm ci --ignore-scripts); this check must not skip');
  const list = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--listFilesOnly'], { cwd: ROOT, encoding: 'utf8' });
  const listed = new Set(list.stdout.split('\n').map((l) => path.relative(ROOT, l.trim())));
  assert.deepStrictEqual(ts.filter((f) => !listed.has(`tests/${f}`)), [], 'tsconfig include covers every tests/*.test.ts');
  const r = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `tsc errors:\n${(r.stdout + r.stderr).slice(-3000)}`);
});

// ---------- TS3-6 ----------
// TypeScript here is 7.x (native), which has no JS parser API, so the scan runs on code with comment lines,
// trailing // comments and one-line string or template text blanked out: a test title such as
// "guard: any test" never counts. It catches `: any`, `as any`, `<any>`, `, any>`, `| any`, `=> any`, `any[]`.
const blankStrings = (line: string) => line
  .replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '``')
  .replace(/\s\/\/\s.*$/, '');
const ANY_RE = new RegExp('(?::|\\bas|<|,|\\||&|=>)\\s*' + 'any\\b|\\b' + 'any\\s*\\[\\]', 'g');
const countAny = (src: string) => codeLines(src).split('\n').map(blankStrings).join('\n').match(ANY_RE) || [];
test('TS3-6 explicit any in the .ts tests: at most 10 in total', () => {
  const probe = "test('guard: any test', () => {}); const a: Record<string, any> = {}; let b = 1 as any; type C = string | any; const d: any[] = [];";
  assert.strictEqual(countAny(probe).length, 4, 'the scan counts the 4 real any types in the probe and not the title');
  const hits: string[] = [];
  for (const f of requireTsTests()) for (const m of countAny(read(`tests/${f}`))) hits.push(`${f}: ${m}`);
  console.log(`TS3-6 explicit any count: ${hits.length}`);
  assert.ok(hits.length <= 10, `${hits.length} explicit any (cap 10, write the count in the PR):\n${hits.join('\n')}`);
});

// ---------- TS3-7 ----------
test('TS3-7 guard: the not-yet-renamed JS tests keep their pinned assert counts', () => {
  const bad: string[] = [];
  for (const n of NAMES) {
    if (!exists(`tests/${n}${JS}`)) continue;
    const c = countAsserts(read(`tests/${n}${JS}`));
    if (c < ASSERT_PINS[n]) bad.push(`${n}${JS}: ${c} < ${ASSERT_PINS[n]}`);
  }
  assert.deepStrictEqual(bad, []);
});

test('TS3-7 each renamed test keeps at least its pinned assert calls, and none is skipped, todo or only', () => {
  requireTsTests();
  const bad: string[] = [];
  for (const n of NAMES) {
    const src = read(`tests/${n}${TS}`);
    const c = countAsserts(src);
    if (c < ASSERT_PINS[n]) bad.push(`${n}${TS}: ${c} assert calls < ${ASSERT_PINS[n]} on main`);
  }
  for (const f of tsTests()) {
    const src = read(`tests/${f}`);
    if (/\b(test|it|describe)\.skip\b/.test(src)) bad.push(`${f}: skip`);
    if (/\btodo\s*:/.test(src)) bad.push(`${f}: todo option`);
    if (/\.only\s*\(|\bonly\s*:\s*true/.test(src)) bad.push(`${f}: only`);
  }
  assert.deepStrictEqual(bad, []);
});

// ---------- TS3-8 ----------
test('TS3-8 ts2 reads the renamed shared and location tests; typecheck still asserts include covers tests/ and js/*.ts', () => {
  requireTsTests();
  const ts2 = read(`tests/ts2${TS}`);
  assert.ok(ts2.includes(`tests/shared${TS}`), `ts2 reads tests/shared${TS}`);
  assert.ok(ts2.includes(`tests/location${TS}`), `ts2 reads tests/location${TS}`);
  assert.ok(!ts2.includes(`tests/shared${JS}`) && !ts2.includes(`tests/location${JS}`), 'ts2 no longer reads the old names');
  const tc = read(`tests/typecheck${TS}`);
  assert.match(tc, /include covers js\/\*\.ts/, 'typecheck still asserts include covers js/*.ts');
  assert.match(tc, /include covers tests\//, 'typecheck still asserts include covers tests/');
  const inc = read('tsconfig.json').match(/"include"\s*:\s*\[([^\]]*)\]/);
  assert.ok(inc && /"js\/\*\.ts"/.test(inc[1]) && /"tests\/?[^"]*"/.test(inc[1]), 'tsconfig include lists js/*.ts and tests/');
});

// ---------- TS3-9 (regression guard: true on main) ----------
const MAIN_VERSION = 'b95449e9fb'; // build-site --demo on main 72764fc
function buildDemo(root: string, out: string) {
  const r = spawnSync(process.execPath, [path.join(root, 'scripts', 'build-site.mjs'), out, '--demo'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `build-site failed:\n${r.stdout}${r.stderr}`);
  const m = /const VERSION = '[^']*-([0-9a-f]{10})';/.exec(fs.readFileSync(path.join(out, 'sw.js'), 'utf8'));
  assert.ok(m, 'sw.js VERSION stamped');
  return m[1];
}
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));

test('TS3-9 the demo dist has no tests/ path and the same VERSION hash as main', { timeout: 120000 }, () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-ts3-dist-'));
  try {
    const here = buildDemo(ROOT, path.join(tmp, 'head'));
    const leaked = walk(path.join(tmp, 'head')).map((f) => path.relative(path.join(tmp, 'head'), f)).filter((f) => f.split(path.sep).join('/').includes('tests/'));
    assert.deepStrictEqual(leaked, [], 'no tests/ in dist');
    // main as git knows it (CI checks out with fetch-depth 0); the pin when git has no main.
    let want = MAIN_VERSION;
    const base = spawnSync('git', ['merge-base', 'HEAD', 'origin/main'], { cwd: ROOT, encoding: 'utf8' });
    if (base.status === 0 && base.stdout.trim()) {
      const src = path.join(tmp, 'main');
      fs.mkdirSync(src);
      const ar = spawnSync('sh', ['-c', `git -C "${ROOT}" archive ${base.stdout.trim()} | tar -x -C "${src}"`], { encoding: 'utf8' });
      assert.strictEqual(ar.status, 0, `git archive main: ${ar.stderr}`);
      want = buildDemo(src, path.join(tmp, 'main-dist'));
    }
    assert.strictEqual(here, want, 'VERSION hash equals main (dist unchanged by TS-3)');
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

// ---------- TS3-10 ----------
test('TS3-10 no old unit-test file names in docs, scripts, workflows or test comments; CLAUDE.md names the .ts glob or npm test', () => {
  const files: string[] = ['README.md', 'CLAUDE.md', 'docs/SETUP.md'];
  for (const d of ['scripts', '.github/workflows']) for (const f of walk(path.join(ROOT, d))) files.push(path.relative(ROOT, f));
  const hits: string[] = [];
  for (const f of files) {
    read(f).split('\n').forEach((l, i) => { if (l.includes(JS)) hits.push(`${f}:${i + 1}: ${l.trim()}`); });
  }
  const testFiles = topTests().filter((f) => /\.(js|ts|mjs)$/.test(f) && !f.endsWith('.d.ts')).map((f) => `tests/${f}`);
  testFiles.push(...fs.readdirSync(path.join(ROOT, 'tests', 'sql')).filter((f) => f.endsWith('.mjs')).map((f) => `tests/sql/${f}`));
  for (const f of testFiles) {
    if (path.basename(f) === SELF) continue;
    for (const l of commentLines(read(f))) if (l.includes(JS)) hits.push(`${f} comment: ${l.trim()}`);
  }
  assert.deepStrictEqual(hits, [], `${hits.length} stale mentions`);
  const claude = read('CLAUDE.md');
  assert.ok(claude.includes('node --test tests/*.test.ts') || claude.includes('npm test'), 'CLAUDE.md says how to run the unit tests');
});
