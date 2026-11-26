// TS-1 (issue #36, PR 1 of 2): type-check the plain JS with tsc, no build step.
// Does not run tsc itself unless typescript is already installed (npm test stays offline).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
/** @param {string} f */
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
// tsconfig allows comments and trailing commas; strip them outside strings only ("js/**/*.js" is not a comment)
/** @param {string} src */
function jsonc(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"') { const m = /** @type {RegExpExecArray} */ (/^"(?:[^"\\]|\\.)*"/.exec(src.slice(i))); out += m[0]; i += m[0].length - 1; }
    else if (ch === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; out += '\n'; }
    else if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; }
    else out += ch;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
}

test('TS-1 tsconfig.json: strict, checkJs, allowJs, noEmit', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tsconfig.json')), 'tsconfig.json missing');
  const o = jsonc(read('tsconfig.json')).compilerOptions || {};
  for (const k of ['strict', 'checkJs', 'allowJs', 'noEmit']) assert.strictEqual(o[k], true, k);
});

// Rewritten for TS2-5 (docs/product/SPEC-TS-2.md): js/*.js is now generated, so tsc checks js/*.ts.
test('TS-1/TS2-5 tsconfig.json checks js/*.ts (not the generated js/*.js) and tests/, skips vendored and other-runtime code', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tsconfig.json')), 'tsconfig.json missing');
  const c = jsonc(read('tsconfig.json'));
  const inc = (c.include || []).join(' ');
  assert.match(inc, /(^|\s)js\/\*\.ts(\s|$)/, 'include covers js/*.ts');
  assert.doesNotMatch(inc, /(^|\s)js\/(\*\*\/)?\*(\.js)?(\s|$)/, 'include no longer covers js/*.js (generated)');
  assert.match(inc, /(^|\s)tests(\/|\s|$)/, 'include covers tests/');
  const exc = (c.exclude || []).map((/** @type {string} */ e) => e.replace(/\/(\*\*)?\/?$/, ''));
  for (const d of ['js/vendor', 'vendor', 'messenger', 'supabase']) assert.ok(exc.includes(d), `exclude ${d}`);
});

test('TS-1 package.json: typecheck script runs tsc, typescript is a dev dependency', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.match((pkg.scripts || {}).typecheck || '', /^tsc\b.*-p tsconfig\.json/);
  assert.ok((pkg.devDependencies || {}).typescript, 'typescript in devDependencies');
});

test('TS-1 CI runs npm run typecheck', () => {
  assert.match(read('.github/workflows/ci.yml'), /run:\s*npm run typecheck/);
});

test('TS-1 .gitattributes marks vendor/** and js/vendor/** linguist-vendored', () => {
  assert.ok(fs.existsSync(path.join(ROOT, '.gitattributes')), '.gitattributes missing');
  const ga = read('.gitattributes');
  assert.match(ga, /^vendor\/\*\*\s+linguist-vendored/m);
  assert.match(ga, /^js\/vendor\/\*\*\s+linguist-vendored/m);
});

const tsc = path.join(ROOT, 'node_modules', 'typescript', 'bin', 'tsc');
test('TS-1 tsc -p tsconfig.json passes', { skip: !fs.existsSync(tsc) && 'typescript not installed (npm install); CI runs npm run typecheck' }, () => {
  execFileSync(process.execPath, [tsc, '-p', 'tsconfig.json'], { cwd: ROOT, stdio: 'pipe' });
});

// ARCH-1 / PS-SHELF-3: reproducible, least-privilege CI install of the dev tools.
// No ci.yml job needs more than read access today (checkout, git diff, docker, local postgres;
// nothing pushes, comments or uploads), so one top-level `permissions: contents: read` covers all jobs.
test('ARCH-1 root package-lock.json exists and pins typescript at the devDependencies version', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'package-lock.json')), 'package-lock.json missing at the repo root');
  const want = JSON.parse(read('package.json')).devDependencies.typescript;
  const lock = JSON.parse(read('package-lock.json'));
  const ts = (lock.packages || {})['node_modules/typescript'] || {};
  assert.strictEqual(ts.version, want, 'lockfile typescript version matches package.json exactly');
});

test('ARCH-1 CI installs the root dev tools with npm ci, not npm install --no-package-lock', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.doesNotMatch(ci, /npm install --no-package-lock/);
  // QA-R10: PS-R3 makes the root install `npm ci --ignore-scripts`, strictly (not optional).
  assert.match(ci, /^\s*run:\s*npm ci --ignore-scripts\s*$/m, 'a root step runs `npm ci --ignore-scripts`');
});

test('PS-SHELF-3 ci.yml declares top-level permissions: contents: read', () => {
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /^permissions:\s*\n\s+contents:\s*read\s*$/m, 'top-level (unindented) permissions block with contents: read');
  assert.doesNotMatch(ci, /^\s+\w[\w-]*:\s*write\s*$/m, 'no job asks for write access');
});
