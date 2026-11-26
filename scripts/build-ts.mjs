// TS-2 (issue #36, M0.4): strip the types from js/*.ts into the classic scripts phones load.
//   node scripts/build-ts.mjs [--src DIR] [--out DIR]      (npm run build; both default to js)
// esbuild transforms each file on its own: loader ts, target es2022, no bundling, no format
// change, no minify, no source map. tsconfig's erasableSyntaxOnly keeps this a pure type strip.
// The emitted js/*.js are committed (no deploy-time build) and CI fails if they differ.
// All files are transformed before any is written, so a syntax error or any esbuild warning
// writes nothing and exits 1.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** @param {string[]} argv @param {string} name @param {string} fallback */
function flag(argv, name, fallback) {
  const i = argv.indexOf(name);
  return resolve(root, i >= 0 && argv[i + 1] ? argv[i + 1] : fallback);
}

const argv = process.argv.slice(2);
const src = flag(argv, '--src', 'js');
const out = flag(argv, '--out', 'js');

const names = existsSync(src)
  ? readdirSync(src).filter((f) => f.endsWith('.ts') && !f.endsWith('.d.ts')).sort()
  : [];
if (!names.length) {
  console.error(`build-ts: no js/*.ts found in ${src}`);
  process.exit(1);
}

let transform;
try {
  ({ transform } = await import('esbuild'));
} catch {
  console.error('build-ts: esbuild is not installed. Run npm ci first.');
  process.exit(1);
}

/** @type {{ file: string, code: string }[]} */
const built = [];
let failed = false;
/** @param {string} f @param {{ text: string, location?: { line: number, column: number } | null }} m */
const where = (f, m) => `js/${f}${m.location ? `:${m.location.line}:${m.location.column}` : ''}: ${m.text}`;
for (const f of names) {
  const name = f.slice(0, -3);
  try {
    const r = await transform(readFileSync(join(src, f), 'utf8'), {
      loader: 'ts',
      target: 'es2022',
      sourcefile: `js/${f}`,
      logLevel: 'silent',
    });
    // ARCH-R1: a warning (a duplicate key, say) is a real bug, so it fails the build like an error.
    if (r.warnings.length) {
      failed = true;
      for (const w of r.warnings) console.error(`build-ts: warning: ${where(f, w)}`);
      continue;
    }
    built.push({ file: `${name}.js`, code: `// Generated from js/${name}.ts by npm run build. Do not edit.\n${r.code}` });
  } catch (e) {
    failed = true;
    const errors = /** @type {{ errors?: { text: string, location?: { line: number, column: number } }[] }} */ (e).errors;
    for (const er of errors || [{ text: String(e) }]) console.error(`build-ts: ${where(f, er)}`);
  }
}
if (failed) {
  console.error('build-ts: nothing written.');
  process.exit(1);
}

mkdirSync(out, { recursive: true });
for (const b of built) writeFileSync(join(out, b.file), b.code);
console.log(`build-ts: ${built.length} files written to ${out}`);
