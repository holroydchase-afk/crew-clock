// TS-4 (issue #36 PR 4, milestone M0.6, docs/product/SPEC-TS-4.md): the hand-written repo scripts move to
// strict TypeScript as .mts files; the 24 studio-synced scripts stay .mjs and are marked linguist-vendored.
// TS4-1 to TS4-11, written red on main cb2fb62 by qa-tdd (M0.6.1).
//
// Byte-identity baselines are pinned here from main cb2fb62 (demo and crew dist digests, VERSION, the
// build-ts output digest, the studio and shell script hashes), so a changed build cannot re-pin itself.
// The "TS-4 window" is while the merge base with main still has the old scripts/build-site .mjs: inside it
// the pins are exact; after TS-4 merges the generic checks (new script vs the base's script on the same
// inputs, build-ts vs the committed js/*.js) keep guarding without breaking every later app change.
//
// Regression guards (green on main today, must stay green): TS4-2 hashes of the 24 studio scripts,
// TS4-1 shell and new-company.ts hashes, TS4-6 and TS4-7 "(guard)" tests that run whichever build script
// exists, TS4-8 "(guard)" no scripts .mjs in tsc and tsc 0 errors, TS4-9 "(guard)" assert pins, path-only
// diff and the suite total. Everything else is red on main for the reason in its message.
// Its own needles are built from pieces so its scans never match this file's text.
import test from 'node:test';
import { after } from 'node:test';
import assert from 'node:assert';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const SELF = path.basename(import.meta.filename);
const read = (f: string) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = (f: string) => fs.existsSync(path.join(ROOT, f));
const sha = (b: string | Buffer) => crypto.createHash('sha256').update(b).digest('hex');
const git = (args: string[], enc: 'utf8' | 'buffer' = 'utf8') => spawnSync('git', args, { cwd: ROOT, encoding: enc === 'utf8' ? 'utf8' : 'buffer', maxBuffer: 64 << 20 });
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const tmpDirs: string[] = [];
const tmp = (tag: string) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), `crew-ts4-${tag}-`)); tmpDirs.push(d); return d; };
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const MAIN = 'cb2fb62096d38bdbd197c357352bd1102dd24797';
const OLD_EXT = '.m' + 'js';
const NEW_EXT = '.m' + 'ts';
// The 5 repo-owned files that become .mts (TS-4 design answer 1), by repo path without extension.
const CONVERTED = ['scripts/build-site', 'scripts/build-ts', 'tests/sql/runner.test', 'evals/geofence/model', 'evals/geofence/run'];
// Old names as they appear in text: a bare basename not preceded by a word char, "-" or "." (so the studio
// check-agent-run and qa-run3 tools never match).
// QA-R8: the same names inside a regex literal (`runner\.test\.mjs`, `build-site\.mjs`) count too, and are
// renamed the same way: only the extension changes, the escaping is kept.
const OLD_RE = new RegExp('(?<![\\w.-])(build-site|build-ts|runner\\\\?\\.test|model|run)(\\\\?\\.)' + OLD_EXT.slice(1) + '\\b', 'g');
const toNew = (s: string) => s.replace(OLD_RE, (_m, n: string, dot: string) => n + dot + NEW_EXT.slice(1));

// ---------- pins from main cb2fb62 ----------
// sha256 (first 16 hex) of each studio-owned scripts/*.mjs: 23 from studio-agents sync-tools.sh, check-logs
// from its install-rules.sh.
const STUDIO: Record<string, string> = {
  'agent-guard': '81ef3e1ab3a964f7', 'agent-memory': 'b05158b8dbcc6592', 'agent-scorecard': 'aa5e3f4cbb6d0daa',
  'check-agent-run': '51730836e5468a38', 'check-findings': '394e3085130f7020', 'check-logs': 'b68ee0439b23f987',
  'check-qa-report': '9b7f0ecd40816607', 'check-spec': '86422f2353268db1', 'check-story-entry': '1f7d7d24f87e3563',
  'check-ux-run': '88ad2aa99ba4714d', 'eval-miss-cases': 'ada0efd387386ba3', 'eval-miss-score': '68a0b1535d0cc812',
  'qa-run3': 'd9fa2b66de545fb8', 'spec-lint': '37c87defd52d13ce', 'stamp-run': 'e2291b2b198849f5',
  'triage-report': 'b3b4198a8bdf056f', 'ux-flows': '1181443c93b67677', 'ux-issues': '6759acf60404045d',
  'ux-recheck': '4d19689b19b7d315', 'ux-refs': 'c3909b23a860531e', 'ux-rules': '1f1880a38bb60b41',
  'ux-search': '31ff6017739bd465', 'ux-shots': '2d959a46bdfd9b0d', 'ux-state': '28b07f239561e64d',
};
// scripts/*.sh on main: 6 files (spec fixed from 9, QA-R2). Pinned by name and hash.
const SHELL: Record<string, string> = {
  'agent-prompt.sh': '5d3226642ab7b67f', 'check-agent-runs.sh': '341232a94fb931e1', 'check-agents.sh': '382251be89ee7f7e',
  'check-handoff-status.sh': '2223db0a8db89616', 'log-agent-run.sh': '475e6fde78abc17c', 'sync-shared.sh': '916adec35856a3c7',
};
const NEW_COMPANY = 'c59f8e6f33ebe674';
// dist digest = sha256 over sorted "<path> <sha256>\n" lines (see digest()).
const DEMO_PIN = { files: 39, digest: 'c0aaf9e05d984107192d843cf121a8232359c36ffd73107da9b8997d6edd7b07', version: 'v3-b95449e9fb' };
const CREW_PIN = { files: 39, digest: '4b28fe834adcca8e67d01b9996f980f4a7f7287e3a5450a6bd5281c26ecfdd6b', version: 'v3-d72d7f8d9d' };
const BUILD_TS_PIN = { files: 14, digest: '7f69100c950c6cb4412e11bff505e3261d9a508542be2ef240416a522d5ba2dd' };
const NO_ESBUILD_MSG = 'build-ts: esbuild is not installed. Run npm ci first.\n';
// The crew build's fake test env (tests/site.test.ts uses the same made-up values). Nothing real.
const BACKEND_VARS = ['CREW_BACKEND', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'ORG_CODE', 'VAPID_PUBLIC_KEY', 'SHEETS_BACKEND_URL', 'SHEET_URL'];
const CREW_ENV = { CREW_BACKEND: 'supabase', SUPABASE_URL: 'https://x.supabase.co', ORG_CODE: 'EXAMPLE1' };
// The 9 tests that name the scripts by path (SPEC-TS-4), with their assert calls on main (ts3's counting).
const EDITED_ASSERTS: Record<string, number> = {
  ts2: 60, 'ts2-review': 24, ts3: 44, site: 17, aishelf: 21, license: 53, showcase: 4, grants: 40, 'eval-geofence': 62,
};
// npm test on main cb2fb62: 296 tests in tests/*.test.ts, all passing.
const MAIN_TOTAL = 296;

/** The merge base with main (CI checks out with fetch-depth 0), else main's pinned commit if git has it. */
function baseCommit(): string | null {
  for (const ref of ['origin/main', 'main']) {
    const r = git(['merge-base', 'HEAD', ref]);
    if (r.status === 0 && String(r.stdout).trim()) return String(r.stdout).trim();
  }
  return git(['cat-file', '-e', `${MAIN}^{commit}`]).status === 0 ? MAIN : null;
}
const BASE = baseCommit();
const atBase = (p: string): Buffer | null => {
  if (!BASE) return null;
  const r = git(['show', `${BASE}:${p}`], 'buffer');
  return r.status === 0 ? (r.stdout as Buffer) : null;
};
/** TS-4 window: the base still has the old build-site, so the main pins apply exactly. */
const WINDOW = !BASE || atBase('scripts/build-site' + OLD_EXT) !== null;

function digest(dir: string) {
  const files = walk(dir).map((f) => path.relative(dir, f).split(path.sep).join('/')).sort();
  return { files: files.length, digest: sha(files.map((f) => `${f} ${sha(fs.readFileSync(path.join(dir, f)))}\n`).join('')) };
}
const versionOf = (dir: string) => (/const VERSION = '([^']*)'/.exec(fs.readFileSync(path.join(dir, 'sw.js'), 'utf8')) || [])[1];
const cleanEnv = (extra: Record<string, string> = {}) => {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const k of BACKEND_VARS) delete env[k];
  delete env.NODE_TEST_CONTEXT;
  return { ...env, ...extra };
};
/** The build script as it is now: the .mts once converted, else main's .mjs (for the guards). */
const current = (base: string) => (exists(base + NEW_EXT) ? base + NEW_EXT : base + OLD_EXT);
const requireMts = (base: string) => assert.ok(exists(base + NEW_EXT), `${base}${NEW_EXT} does not exist yet (TS-4 not done)`);

function runBuildSite(script: string, out: string, demo: boolean, cwd = ROOT) {
  const r = spawnSync(process.execPath, [script, out, ...(demo ? ['--demo'] : [])], { cwd, encoding: 'utf8', env: cleanEnv(demo ? {} : CREW_ENV) });
  assert.strictEqual(r.status, 0, `${path.basename(script)} ${demo ? '--demo' : 'crew'} failed:\n${r.stdout}${r.stderr}`);
  return r;
}

// ---------- TS4-1 ----------
test('TS4-1 the 5 repo-owned scripts are .mts and their .mjs names are gone', () => {
  const missing = CONVERTED.filter((b) => !exists(b + NEW_EXT));
  const left = CONVERTED.filter((b) => exists(b + OLD_EXT));
  assert.deepStrictEqual(missing, [], `not yet converted to ${NEW_EXT}`);
  assert.deepStrictEqual(left, [], `old ${OLD_EXT} still present`);
});

test('TS4-1 (guard) e2e stays JS: 17 tests/e2e*.js and tests/browser.js; scripts/*.sh and new-company.ts byte-identical to main', () => {
  const top = fs.readdirSync(path.join(ROOT, 'tests'));
  assert.strictEqual(top.filter((f) => /^e2e.*\.js$/.test(f)).length, 17, '17 tests/e2e*.js');
  assert.ok(top.includes('browser.js'), 'tests/browser.js');
  const sh = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith('.sh')).sort();
  assert.deepStrictEqual(sh, Object.keys(SHELL).sort(), 'scripts/*.sh names equal main');
  const bad = sh.filter((f) => sha(fs.readFileSync(path.join(ROOT, 'scripts', f))).slice(0, 16) !== SHELL[f]);
  assert.deepStrictEqual(bad, [], 'scripts/*.sh byte-identical to main');
  assert.strictEqual(sha(fs.readFileSync(path.join(ROOT, 'scripts', 'new-company.ts'))).slice(0, 16), NEW_COMPANY, 'new-company.ts byte-identical');
});

// ---------- TS4-2 ----------
test('TS4-2 (guard) the 24 studio-owned scripts are byte-identical to main', () => {
  assert.strictEqual(Object.keys(STUDIO).length, 24);
  const bad: string[] = [];
  for (const [n, h] of Object.entries(STUDIO)) {
    const f = path.join(ROOT, 'scripts', n + OLD_EXT);
    if (!fs.existsSync(f)) bad.push(`${n}${OLD_EXT} missing`);
    else if (sha(fs.readFileSync(f)).slice(0, 16) !== h) bad.push(`${n}${OLD_EXT} changed`);
  }
  assert.deepStrictEqual(bad, []);
});

test('TS4-2 scripts/*.mjs are exactly the 24 studio-owned tools (no extra, none missing)', () => {
  const mjs = fs.readdirSync(path.join(ROOT, 'scripts')).filter((f) => f.endsWith(OLD_EXT)).map((f) => f.slice(0, -OLD_EXT.length)).sort();
  const want = Object.keys(STUDIO).sort();
  assert.deepStrictEqual(mjs.filter((n) => !want.includes(n)), [], `extra scripts/*${OLD_EXT} (repo-owned ones must be ${NEW_EXT})`);
  assert.deepStrictEqual(want.filter((n) => !mjs.includes(n)), [], `missing studio scripts`);
  assert.strictEqual(mjs.length, 24);
});

// ---------- TS4-3 ----------
test('TS4-3 package.json build, test:sql and eval:geofence run the .mts files', () => {
  const s = JSON.parse(read('package.json')).scripts || {};
  assert.strictEqual(s.build, 'node scripts/build-ts' + NEW_EXT);
  assert.ok(String(s['test:sql']).endsWith('node --test tests/sql/runner.test' + NEW_EXT), `test:sql is: ${s['test:sql']}`);
  assert.strictEqual(s['eval:geofence'], 'node evals/geofence/run' + NEW_EXT);
});

test('TS4-3 pages.yml builds with build-site.mts --demo and never runs npm', () => {
  const pages = read('.github/workflows/pages.yml');
  assert.ok(pages.includes('node scripts/build-site' + NEW_EXT + ' dist --demo'), 'pages.yml runs the .mts demo build');
  assert.doesNotMatch(pages, /\bnpm\b/, 'Pages needs no npm install (Node strips the types itself)');
});

// "docs" read as the living docs: top-level docs/*.md plus architecture, eng, evals and design. Dated records
// (docs/product specs, reviews, runs, postmortems) keep the names they had (QA-R5).
function staleScanFiles() {
  // sw.js is exempt (QA-R1, chief of staff): it is hashed whole into VERSION, so its stale line 2 comment
  // stays until a PR changes sw.js anyway (like TS-3's css/app.css, ARCH-R3).
  const files = ['README.md', 'CLAUDE.md'];
  for (const f of fs.readdirSync(ROOT)) if (/^tsconfig.*\.json$/.test(f)) files.push(f);
  for (const f of fs.readdirSync(path.join(ROOT, 'docs'))) if (f.endsWith('.md')) files.push(`docs/${f}`);
  for (const d of ['docs/architecture', 'docs/eng', 'docs/evals', 'docs/design', '.github', 'tests']) {
    if (!exists(d)) continue;
    for (const f of walk(path.join(ROOT, d))) {
      const rel = path.relative(ROOT, f).split(path.sep).join('/');
      if (/\.(png|jpe?g|gif|webp|woff2?|ico|pdf)$/i.test(rel) || rel.startsWith('tests/shots/') || path.basename(rel) === SELF) continue;
      files.push(rel);
    }
  }
  for (const b of CONVERTED) for (const e of [NEW_EXT, OLD_EXT]) if (exists(b + e)) files.push(b + e); // usage headers
  return files;
}
test('TS4-3 no README, CLAUDE.md, living docs, tsconfig, .github, tests or script header names the 5 old .mjs files', () => {
  assert.ok(('node scripts/build-site' + OLD_EXT).match(OLD_RE) && !('check-agent-run' + OLD_EXT + ' qa-run3' + OLD_EXT).match(OLD_RE), 'needle sanity');
  const esc = '/runner\\.test\\' + OLD_EXT + '/ /build-site\\' + OLD_EXT + '/';
  assert.strictEqual(toNew(esc), '/runner\\.test\\' + NEW_EXT + '/ /build-site\\' + NEW_EXT + '/', 'escaped regex form renames the extension only (QA-R8)');
  assert.ok(!('runnerXtest\\' + OLD_EXT).match(OLD_RE) && !('build-site\\\\' + OLD_EXT).match(OLD_RE), 'no looser than the rename');
  const hits: string[] = [];
  for (const f of staleScanFiles()) {
    read(f).split('\n').forEach((l, i) => { if (l.match(OLD_RE)) hits.push(`${f}:${i + 1}: ${l.trim().slice(0, 120)}`); });
  }
  assert.deepStrictEqual(hits, [], `${hits.length} stale mentions`);
});

// ---------- TS4-4 ----------
test('TS4-4 .node-version is one exact version >= 22.18.0; ci, pages and agents-check read it', () => {
  assert.ok(exists('.node-version'), '.node-version missing');
  const v = read('.node-version').trim();
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(v);
  assert.ok(m, `.node-version is one exact version, got ${JSON.stringify(v)}`);
  const [maj, min] = [Number(m[1]), Number(m[2])];
  assert.ok(maj > 22 || (maj === 22 && min >= 18), `${v} >= 22.18.0 (type stripping on by default)`);
  for (const w of ['ci', 'pages', 'agents-check']) {
    const y = read(`.github/workflows/${w}.yml`);
    assert.match(y, /node-version-file:\s*['"]?\.node-version['"]?\s*$/m, `${w}.yml setup-node uses node-version-file: .node-version`);
    assert.doesNotMatch(y, /node-version:\s*['"]?22['"]?\s*$/m, `${w}.yml has no node-version: 22`);
  }
});

// ---------- TS4-5 ----------
const NODE_WARN = /MODULE_TYPELESS_PACKAGE_JSON|ExperimentalWarning/;
test('TS4-5 build-site.mts --demo, build-ts.mts --out and run.mts --check exit 0 with no typeless or experimental warning', () => {
  for (const b of ['scripts/build-site', 'scripts/build-ts', 'evals/geofence/run']) requireMts(b);
  const dir = tmp('t5');
  const runs: [string, string[]][] = [
    ['scripts/build-site' + NEW_EXT, [path.join(dir, 'dist'), '--demo']],
    ['scripts/build-ts' + NEW_EXT, ['--out', path.join(dir, 'js')]],
    ['evals/geofence/run' + NEW_EXT, ['--check']],
  ];
  for (const [f, args] of runs) {
    const r = spawnSync(process.execPath, [f, ...args], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
    assert.strictEqual(r.status, 0, `${f} exited ${r.status}:\n${r.stdout}${r.stderr}`);
    assert.doesNotMatch(r.stderr, NODE_WARN, `${f} stderr has a Node warning:\n${r.stderr}`);
  }
});

// ---------- TS4-6 ----------
function checkPin(dir: string, pin: { files: number, digest: string, version?: string }, what: string) {
  const d = digest(dir);
  assert.strictEqual(d.files, pin.files, `${what}: ${pin.files} files`);
  if (pin.version) assert.strictEqual(versionOf(dir), pin.version, `${what}: VERSION`);
  assert.strictEqual(d.digest, pin.digest, `${what}: byte-identical to main cb2fb62`);
}

test('TS4-6 (guard) the build-site there is now gives main\'s demo and crew dist (pinned digests, VERSION v3-b95449e9fb)', { timeout: 120000, skip: !WINDOW && 'TS-4 merged: the main pins no longer apply; the .mts-vs-base test still runs' }, () => {
  const dir = tmp('t6g');
  const script = path.join(ROOT, current('scripts/build-site'));
  runBuildSite(script, path.join(dir, 'demo'), true);
  runBuildSite(script, path.join(dir, 'crew'), false);
  checkPin(path.join(dir, 'demo'), DEMO_PIN, 'demo build');
  checkPin(path.join(dir, 'crew'), CREW_PIN, 'crew build');
});

// QA-R13: a shallow checkout (CI's actions/checkout default, and copies of it) has no base commit, so there is
// nothing to compare against: skip with that reason. The (guard) test above still holds the build to main's
// pinned digests while the window is open. With a base present, any difference fails hard.
test('TS4-6 build-site.mts gives byte-identical demo and crew dist to main\'s build-site.mjs on the same files', { timeout: 120000, skip: !BASE && 'git has no base commit here (shallow checkout); the TS4-6 (guard) test still checks main\'s pinned digests' }, () => {
  requireMts('scripts/build-site');
  const dir = tmp('t6');
  // The base's build script, run from a copy of the current tree's app files so only the script differs.
  const baseSrc = atBase('scripts/build-site' + OLD_EXT) || atBase('scripts/build-site' + NEW_EXT);
  assert.ok(baseSrc, `the base ${BASE} has scripts/build-site (.mjs or .mts)`);
  const baseExt = atBase('scripts/build-site' + OLD_EXT) ? OLD_EXT : NEW_EXT;
  const tree = path.join(dir, 'tree');
  fs.mkdirSync(path.join(tree, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'scripts', 'build-site' + baseExt), baseSrc);
  const copyList = /const COPY = \[([^\]]*)\]/.exec(baseSrc.toString('utf8'));
  assert.ok(copyList, 'base build-site has a COPY list');
  for (const item of [...copyList[1].matchAll(/'([^']+)'/g)].map((m) => m[1])) {
    fs.cpSync(path.join(ROOT, item), path.join(tree, item), { recursive: true });
  }
  const mts = path.join(ROOT, 'scripts', 'build-site' + NEW_EXT);
  const old = path.join(tree, 'scripts', 'build-site' + baseExt);
  for (const demo of [true, false]) {
    const kind = demo ? 'demo' : 'crew';
    runBuildSite(old, path.join(dir, `${kind}-base`), demo, tree);
    runBuildSite(mts, path.join(dir, `${kind}-new`), demo);
    const a = digest(path.join(dir, `${kind}-base`));
    const b = digest(path.join(dir, `${kind}-new`));
    assert.deepStrictEqual(b, a, `${kind} dist from build-site${NEW_EXT} equals the base's`);
  }
  if (WINDOW) {
    checkPin(path.join(dir, 'demo-new'), DEMO_PIN, 'demo build (.mts)');
    checkPin(path.join(dir, 'crew-new'), CREW_PIN, 'crew build (.mts)');
  }
});

// ---------- TS4-7 ----------
function buildTsChecks(script: string, t5: boolean) {
  const dir = tmp(t5 ? 't7' : 't7g');
  // 1. reproduces the 14 committed js files byte for byte (TS2-3)
  const out = path.join(dir, 'out');
  const r = spawnSync(process.execPath, [script, '--out', out], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `${path.basename(script)} --out failed:\n${r.stdout}${r.stderr}`);
  const built = fs.readdirSync(out).sort();
  assert.strictEqual(built.length, 14, `14 files built: ${built.join(', ')}`);
  const differ = built.filter((f) => !fs.readFileSync(path.join(out, f)).equals(fs.readFileSync(path.join(ROOT, 'js', f))));
  assert.deepStrictEqual(differ, [], 'build output equals the committed js/*.js');
  if (WINDOW) assert.deepStrictEqual(digest(out), BUILD_TS_PIN, 'build output equals main cb2fb62 byte for byte');
  // 2. ARCH-R1: any esbuild warning exits 1 and writes nothing
  const src = path.join(dir, 'src');
  const wout = path.join(dir, 'wout');
  fs.mkdirSync(src);
  fs.writeFileSync(path.join(src, 'ok.ts'), 'const a: number = 1;\nconsole.log(a);\n');
  fs.writeFileSync(path.join(src, 'warn.ts'), 'export declare const x: number;\nconst api = { a: 1, a: 2 };\nconsole.log(api);\n');
  const w = spawnSync(process.execPath, [script, '--src', src, '--out', wout], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(w.status, 1, `exit 1 on a warning, got ${w.status}`);
  assert.ok(!fs.existsSync(wout) || fs.readdirSync(wout).length === 0, 'nothing written on a warning');
  // 3. esbuild hidden (a copy outside the repo, so no node_modules resolves): same message as main, non-zero
  const h = path.join(dir, 'hidden');
  fs.mkdirSync(path.join(h, 'scripts'), { recursive: true });
  fs.mkdirSync(path.join(h, 'js'));
  fs.copyFileSync(script, path.join(h, 'scripts', path.basename(script)));
  fs.copyFileSync(path.join(ROOT, 'js', 'geo.ts'), path.join(h, 'js', 'geo.ts'));
  const nh = spawnSync(process.execPath, [path.join(h, 'scripts', path.basename(script))], { cwd: h, encoding: 'utf8', env: cleanEnv() });
  assert.notStrictEqual(nh.status, 0, 'non-zero exit with esbuild hidden');
  assert.strictEqual(nh.stderr.replace(NODE_WARN, ''), NO_ESBUILD_MSG, 'same message as main with esbuild hidden');
}
test('TS4-7 (guard) the build-ts there is now reproduces js/*.js, fails on a warning, and names a missing esbuild', { timeout: 120000 }, () => {
  buildTsChecks(path.join(ROOT, current('scripts/build-ts')), false);
});
test('TS4-7 build-ts.mts reproduces the 14 js files, exits 1 writing nothing on a warning (ARCH-R1), same message with esbuild hidden', { timeout: 120000 }, () => {
  requireMts('scripts/build-ts');
  buildTsChecks(path.join(ROOT, 'scripts', 'build-ts' + NEW_EXT), true);
});

// ---------- TS4-8 ----------
const TSC = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
const listed = () => {
  const r = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json', '--listFilesOnly'], { cwd: ROOT, encoding: 'utf8' });
  return new Set(r.stdout.split('\n').map((l) => path.relative(ROOT, l.trim()).split(path.sep).join('/')).filter(Boolean));
};
test('TS4-8 (guard) tsc checks no scripts/*.mjs and reports 0 errors', { timeout: 120000 }, () => {
  assert.ok(fs.existsSync(TSC), 'typescript installed (npm ci --ignore-scripts); this check must not skip');
  const studio = [...listed()].filter((f) => f.startsWith('scripts/') && f.endsWith(OLD_EXT));
  assert.deepStrictEqual(studio, [], 'studio scripts stay out of tsconfig');
  const r = spawnSync(process.execPath, [TSC, '-p', 'tsconfig.json'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `tsc errors:\n${(r.stdout + r.stderr).slice(-3000)}`);
});

// Explicit any, scanned like TS3-6 (comment lines and one-line strings blanked).
const blank = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l))
  .map((l) => l.replace(/'(?:\\.|[^'\\])*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""').replace(/`(?:\\.|[^`\\])*`/g, '``').replace(/\s\/\/\s.*$/, ''))
  .join('\n');
const ANY_RE = new RegExp('(?::|\\bas)\\s*' + 'any\\b', 'g');
test('TS4-8 tsc lists the 5 .mts files; no suppressions; at most 3 explicit any; ci.yml deno-checks new-company.ts', { timeout: 120000 }, () => {
  assert.ok(fs.existsSync(TSC), 'typescript installed (npm ci --ignore-scripts); this check must not skip');
  const files = CONVERTED.map((b) => b + NEW_EXT);
  const set = listed();
  assert.deepStrictEqual(files.filter((f) => !set.has(f)), [], 'tsconfig include covers the 5 .mts files');
  const sup: string[] = [];
  let anys = 0;
  for (const f of files) {
    const src = read(f);
    for (const m of src.matchAll(/@ts-(nocheck|ignore|expect-error)\b/g)) sup.push(`${f}: ${m[0]}`);
    anys += (blank(src).match(ANY_RE) || []).length;
  }
  assert.deepStrictEqual(sup, [], 'no type-check suppressions');
  console.log(`TS4-8 explicit any count in the 5 .mts: ${anys}`);
  assert.ok(anys <= 3, `${anys} explicit any (cap 3)`);
  assert.match(read('.github/workflows/ci.yml'), /deno check\b[^\n]*scripts\/new-company\.ts/, 'ci.yml runs deno check scripts/new-company.ts');
});

const HAS_DENO = spawnSync('deno', ['--version'], { encoding: 'utf8' }).status === 0;
test('TS4-8 deno check scripts/new-company.ts exits 0', { timeout: 300000, skip: !HAS_DENO && 'deno not installed here; CI\'s Edge step has deno and runs this check' }, () => {
  // ARCH-R3: the same --config as ci.yml, so the two checks cannot disagree.
  const r = spawnSync('deno', ['check', '--config', 'supabase/functions/deno.json', 'scripts/new-company.ts'], { cwd: ROOT, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, `deno check failed:\n${r.stdout}${r.stderr}`);
});

// ---------- TS4-9 ----------
const codeLines = (src: string) => src.split('\n').filter((l) => !/^\s*(\/\/|\/\*|\*)/.test(l)).join('\n');
const countAsserts = (src: string) => (codeLines(src).match(/\bassert\.\w+/g) || []).length;
test('TS4-9 (guard) the 9 edited tests keep at least their assert calls from main', () => {
  const bad: string[] = [];
  for (const [n, want] of Object.entries(EDITED_ASSERTS)) {
    const c = countAsserts(read(`tests/${n}.test.ts`));
    if (c < want) bad.push(`${n}: ${c} < ${want}`);
  }
  assert.deepStrictEqual(bad, []);
});

// ts3 is left out of the path-only check: TS3-1 must admit this file and TS3-9 builds main with main's own
// script name (it must use whichever build-site the archived tree has), neither of which is a path rename.
// Chief of staff allowed exactly those two ts3 edits (QA-R3); its assert count is still pinned above.
const PATH_ONLY_EXEMPT = new Set(['tests/ts3.test.ts', `tests/${SELF}`]);
test('TS4-9 (guard) tests that named the old scripts on main changed only those path strings', { skip: !BASE && 'git has no main history here; CI checks out with fetch-depth 0' }, () => {
  const ls = git(['ls-tree', '-r', '--name-only', String(BASE), 'tests/']);
  assert.strictEqual(ls.status, 0, String(ls.stderr));
  const bad: string[] = [];
  let checked = 0;
  for (const f of String(ls.stdout).split('\n').filter((x) => /\.(ts|js|mjs)$/.test(x))) {
    if (PATH_ONLY_EXEMPT.has(f)) continue;
    const before = atBase(f);
    if (!before) continue;
    const text = before.toString('utf8');
    if (!text.match(OLD_RE)) continue;
    checked++;
    const now = path.join(ROOT, toNew(f));
    if (!fs.existsSync(now)) { bad.push(`${f}: gone`); continue; }
    if (toNew(fs.readFileSync(now, 'utf8')) !== toNew(text)) bad.push(`${f}: changed beyond the 5 path renames`);
  }
  if (WINDOW) assert.ok(checked >= 21, `checked ${checked} files that named the old scripts (8 unit, 13 e2e)`);
  assert.deepStrictEqual(bad, []);
});

test('TS4-9 tests/sql/runner.test.mts holds exactly GRANT-1 and GRANT-9', () => {
  requireMts('tests/sql/runner.test');
  const titles = [...read('tests/sql/runner.test' + NEW_EXT).matchAll(/^test\(\s*'([A-Z]+-\d+)\b/gm)].map((m) => m[1]);
  assert.deepStrictEqual(titles, ['GRANT-1', 'GRANT-9']);
});

const pgUp = () => {
  if (spawnSync('psql', ['--version']).status !== 0) return false;
  const q = process.env.PGHOST ? spawnSync('psql', ['-tAc', 'select 1'], { encoding: 'utf8' })
    : spawnSync('su', ['postgres', '-c', 'psql -tAc "select 1"'], { encoding: 'utf8' });
  if (q.status !== 0) return false;
  // QA-R11: with no PGHOST, run.sh runs psql as the postgres user, which must be able to read this checkout
  // (a mkdtemp copy is mode 0700, so agents.verify in a bare temp copy could not).
  if (!process.env.PGHOST) {
    const r = spawnSync('su', ['postgres', '-c', `test -r '${path.join(ROOT, 'tests', 'sql', 'supabase_stub.sql')}'`]);
    if (r.status !== 0) return false;
  }
  return true;
};
const PG = pgUp();
// QA-R9: inside a nested copy (ts3's CI shape) this failed: the copy is a mkdtemp dir (mode 0700) and run.sh,
// with no PGHOST, runs psql as the postgres user through su, which cannot read the copy's SQL files. It would
// also race the outer run on run.sh's one fixed database. Only the outer run checks it.
const SQL_NESTED = process.env.CRW_TS3_CI_SHAPE === '1' || process.env.CRW_TS4_NESTED === '1';
test('TS4-9 npm run test:sql runs 2 tests (GRANT-1, GRANT-9), both pass', { timeout: 600000, skip: (SQL_NESTED && 'nested copy: its temp dir is private to su postgres and run.sh shares one database; the outer run checks test:sql') || (!PG && 'Postgres is not reachable here, or its postgres user cannot read this checkout; CI\'s SQL step runs npm run test:sql') }, () => {
  const r = spawnSync('npm', ['run', 'test:sql'], { cwd: ROOT, encoding: 'utf8', env: cleanEnv() });
  const out = r.stdout + r.stderr;
  assert.strictEqual(r.status, 0, out.slice(-3000));
  assert.match(out, /tests\/sql\/runner\.test\.mts/, 'test:sql runs the .mts runner');
  // tap (# tests 2) or spec (ℹ tests 2) reporter, whichever Node picks for a pipe
  assert.match(out, /^(#|ℹ) tests 2$/m, 'two tests');
  assert.match(out, /^(#|ℹ) pass 2$/m, 'both pass');
  assert.match(out, /(ok \d+ - |✔ )GRANT-1/);
  assert.match(out, /(ok \d+ - |✔ )GRANT-9/);
});

// The full unit suite minus this file, in a throwaway copy (GRANT-11 writes temp files into the tree).
// Nested runs (ts3's CI-shape copy) skip it: the outer run checks it.
function copyTree() {
  const dir = tmp('copy');
  const ls = git(['ls-files', '--cached', '--others', '--exclude-standard']);
  for (const f of String(ls.stdout).split('\n')) {
    if (!f || /(^|\/)\d+_tmp(_test)?\.sql$/.test(f)) continue;
    if (f === 'node_modules' || f === 'messenger/node_modules') continue; // a linked install shows up as a file; linked below
    try {
      fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
      fs.copyFileSync(path.join(ROOT, f), path.join(dir, f));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
    }
  }
  fs.cpSync(path.join(ROOT, '.git'), path.join(dir, '.git'), { recursive: true });
  // The links are files to git ("node_modules/" ignores only directories), so ts3's own copy of this copy
  // would try to copy them: the copy's private exclude list hides them.
  fs.mkdirSync(path.join(dir, '.git', 'info'), { recursive: true });
  fs.appendFileSync(path.join(dir, '.git', 'info', 'exclude'), '\nnode_modules\nmessenger/node_modules\n');
  for (const nm of ['node_modules', 'messenger/node_modules']) {
    if (fs.existsSync(path.join(ROOT, nm))) fs.symlinkSync(path.join(ROOT, nm), path.join(dir, nm), 'dir');
  }
  return dir;
}
const NESTED = process.env.CRW_TS3_CI_SHAPE === '1' || process.env.CRW_TS4_NESTED === '1';
test('TS4-9 (guard) the rest of npm test still runs main\'s 296 tests, fail 0, only the known skips', { timeout: 900000, skip: NESTED && 'nested inside another full-suite run; the outer run checks it' }, async () => {
  const dir = copyTree();
  const files = fs.readdirSync(path.join(dir, 'tests')).filter((f) => f.endsWith('.test.ts') && f !== SELF).sort().map((f) => `tests/${f}`);
  const env: NodeJS.ProcessEnv = { ...cleanEnv(), CRW_TS3_CI_SHAPE: '1', CRW_TS4_NESTED: '1' };
  const out = await new Promise<string>((resolve) => {
    const p = spawn(process.execPath, ['--test', '--test-reporter=tap', ...files], { cwd: dir, env });
    let o = '';
    p.stdout.on('data', (d) => { o += d; });
    p.stderr.on('data', (d) => { o += d; });
    p.on('close', () => resolve(o));
  });
  const n = (k: string) => { const m = new RegExp(`^# ${k} (\\d+)$`, 'm').exec(out); return m ? Number(m[1]) : -1; };
  // Known skips: ts3's CI-shape test (nested by CRW_TS3_CI_SHAPE), and license LIC1-3 without messenger/node_modules.
  const skips = [...out.matchAll(/# SKIP ([^\n]*)/g)].map((m) => m[1]);
  const unknown = skips.filter((s) => !/nested inside the CI-shape run|messenger\/node_modules is not installed/.test(s));
  const failed = out.split('\n').filter((l) => /^\s*not ok /.test(l)).join('\n');
  assert.deepStrictEqual(unknown, [], 'no skips beyond the known environment ones');
  if (n('fail') !== 0) fs.writeFileSync(path.join(os.tmpdir(), 'crew-ts4-suite.tap'), out); // full output for the red report
  assert.strictEqual(n('fail'), 0, `failures (full TAP in ${path.join(os.tmpdir(), 'crew-ts4-suite.tap')}):\n${failed}\n${out.slice(-1500)}`);
  assert.strictEqual(n('tests'), MAIN_TOTAL, `main's ${MAIN_TOTAL} tests outside ${SELF}`);
  assert.strictEqual(n('pass'), MAIN_TOTAL - skips.length);
});

// ---------- TS4-10 ----------
test('TS4-10 git check-attr: the 24 studio scripts are linguist-vendored; build-site.mts, build-ts.mts and tests/e2e.js are not', () => {
  const studio = Object.keys(STUDIO).map((n) => `scripts/${n}${OLD_EXT}`);
  const own = ['scripts/build-site' + NEW_EXT, 'scripts/build-ts' + NEW_EXT, 'tests/e2e.js'];
  const r = git(['check-attr', 'linguist-vendored', '--', ...studio, ...own]);
  assert.strictEqual(r.status, 0, String(r.stderr));
  const val = new Map(String(r.stdout).trim().split('\n').map((l) => { const m = /^(.*): linguist-vendored: (\S+)$/.exec(l); return m ? [m[1], m[2]] : [l, '?']; }));
  assert.deepStrictEqual(studio.filter((f) => val.get(f) !== 'set'), [], 'studio scripts linguist-vendored: set');
  assert.deepStrictEqual(own.filter((f) => val.get(f) !== 'unspecified'), [], 'repo-owned files stay counted');
});

// ---------- TS4-11 ----------
/** Entries: a line starting at column 0 opens one; indented lines continue it. */
const entries = (md: string) => md.split('\n').reduce<string[]>((acc, l) => { if (/^\S/.test(l) || !acc.length) acc.push(l); else acc[acc.length - 1] += '\n' + l; return acc; }, []);
test('TS4-11 HANDOFF has a Done entry for TS-4 and no "TS-3 ... not committed"', () => {
  const h = read('HANDOFF.md');
  const done = /^## Done\n([\s\S]*?)(?=^## )/m.exec(h);
  assert.ok(done, 'HANDOFF has a ## Done section');
  assert.ok(entries(done[1]).some((e) => /^- /.test(e) && /\bTS-4\b/.test(e)), 'a Done entry names TS-4');
  const stale = entries(h).filter((e) => /\bTS-3\b/.test(e) && /not committed/.test(e)).map((e) => e.slice(0, 100));
  assert.deepStrictEqual(stale, [], 'TS-3 is merged (#68): no entry says it is not committed');
});
test('TS4-11 PLAN has an M0.6 row naming SPEC-TS-4', () => {
  assert.ok(read('PLAN.md').split('\n').some((l) => /`M0\.6`/.test(l) && l.includes('SPEC-TS-4')), 'PLAN `M0.6` row with SPEC-TS-4');
});
test('TS4-11 SETUP step 5 names .node-version or NODE_VERSION 22.18 or later', () => {
  const s = /^## 5\.[^\n]*\n([\s\S]*?)(?=^## )/m.exec(read('docs/SETUP.md'));
  assert.ok(s, 'SETUP has step 5');
  const nv = /NODE_VERSION[^\n0-9]*(\d+)\.(\d+)/.exec(s[1]);
  const ok = s[1].includes('.node-version') || (!!nv && (Number(nv[1]) > 22 || (Number(nv[1]) === 22 && Number(nv[2]) >= 18)));
  assert.ok(ok, 'step 5 tells Cloudflare which Node to use (.node-version, or NODE_VERSION >= 22.18)');
});

// ---------- PS-R1 (privacy-security review, P2) ----------
// build-site must keep every TypeScript source out of the site, not only .ts: .mts, .cts and .d.mts too (ASVS
// V14.3 unintended disclosure). Fixture: a temp tree with the current build-site and the app files, plus
// made-up source files dropped into the COPY folders.
test('PS-R1 build-site.mts leaves .ts, .mts, .cts and .d.mts sources out of the built site', { timeout: 120000 }, () => {
  requireMts('scripts/build-site');
  const dir = tmp('psr1');
  const tree = path.join(dir, 'tree');
  const script = read('scripts/build-site' + NEW_EXT);
  fs.mkdirSync(path.join(tree, 'scripts'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'scripts', 'build-site' + NEW_EXT), script);
  const copyList = /const COPY = \[([^\]]*)\]/.exec(script);
  assert.ok(copyList, 'build-site has a COPY list');
  for (const item of [...copyList[1].matchAll(/'([^']+)'/g)].map((m) => m[1])) {
    fs.cpSync(path.join(ROOT, item), path.join(tree, item), { recursive: true });
  }
  const planted = ['js/ps-r1-a.ts', 'js/ps-r1-b' + NEW_EXT, 'js/ps-r1-c.cts', 'js/ps-r1-d.d' + NEW_EXT, 'vendor/ps-r1-e' + NEW_EXT, 'css/ps-r1-f.cts'];
  for (const f of planted) fs.writeFileSync(path.join(tree, f), '// made-up source for PS-R1\nexport const x: number = 1;\n');
  fs.writeFileSync(path.join(tree, 'js', 'ps-r1-keep.js'), '// a plain script still ships\n');
  const out = path.join(dir, 'dist');
  runBuildSite(path.join(tree, 'scripts', 'build-site' + NEW_EXT), out, true, tree);
  const shipped = walk(out).map((f) => path.relative(out, f).split(path.sep).join('/'));
  assert.ok(shipped.includes('js/ps-r1-keep.js'), 'the fixture reached dist (plain .js ships)');
  assert.deepStrictEqual(shipped.filter((f) => /\.[cm]?ts$/.test(f)), [], 'no .ts, .mts, .cts or .d.mts in the built site');
});
