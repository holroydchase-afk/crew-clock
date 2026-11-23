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

test('TS-1 tsconfig.json checks js/ and tests/, skips vendored and other-runtime code', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'tsconfig.json')), 'tsconfig.json missing');
  const c = jsonc(read('tsconfig.json'));
  const inc = (c.include || []).join(' ');
  assert.match(inc, /(^|\s)js\/(\*\*\/)?\*(\.js)?(\s|$)/, 'include covers js/*.js');
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
