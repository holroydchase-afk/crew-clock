// Demo hints (docs/product/SPEC-DEMO-HINTS.md), the static half. Run: node --test tests/hints.test.ts
// (also part of `npm test`). The browser half (HINT-1, HINT-3..HINT-12) is tests/e2e-hints.js.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(import.meta.dirname, '..');
const read = (p: string) => fs.readFileSync(path.join(ROOT, p), 'utf8');
const filesIn = (dir: string, ext: string) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(ext)).map((e) => `${dir}/${e.name}`);

// HINT-1's words: the pitch, the descriptors and the "Demo: ..." explainers the spec removes
const GONE_WORDS = [/GPS time clock/, /\bTry it\b/, /Start here/, /Clock in as a worker/, /Or pick someone else/,
  /Demo: turn on No signal/, /Each punch is signed/, /Demo: pretend/];
// The classes that held them (I1-I3, I7, I8, I10); `.pitch-title` goes with `.pitch`
const GONE_CLASSES = ['pitch', 'pitch-title', 'proof', 'pick-note', 'demo-hint', 'verify-hint'];

test('HINT-2 js/app.js no longer says any of the pitch, descriptor or "Demo:" explainer words', () => {
  const src = read('js/app.js');
  const found = GONE_WORDS.filter((re) => re.test(src)).map((re) => {
    const line = src.split('\n').findIndex((l) => re.test(l)) + 1;
    return `${re} (js/app.js:${line})`;
  });
  assert.deepStrictEqual(found, [], `still in js/app.js: ${found.join(', ')}`);
});

test('HINT-2 the .pitch, .proof, .pick-note, .demo-hint and .verify-hint classes are gone from js/ and css/', () => {
  const found = [];
  // css/: as a selector, comments stripped
  for (const f of filesIn('css', '.css')) {
    const css = read(f).replace(/\/\*[\s\S]*?\*\//g, '');
    for (const c of GONE_CLASSES) if (new RegExp(`\\.${c}(?![\\w-])`).test(css)) found.push(`${f}: .${c}`);
  }
  // js/ (not the prebuilt vendor bundle): in a class="..." attribute, a classList call or a selector string
  for (const f of filesIn('js', '.js')) {
    const src = read(f);
    const classAttrs = [...src.matchAll(/class(?:Name)?\s*=\s*["'`]([^"'`]*)["'`]/g)].map((m) => m[1].split(/\s+/)).flat();
    const listCalls = [...src.matchAll(/classList\.(?:add|remove|toggle|contains)\(([^)]*)\)/g)].map((m) => m[1]);
    for (const c of GONE_CLASSES) {
      if (classAttrs.includes(c)) found.push(`${f}: class="${c}"`);
      if (listCalls.some((a) => new RegExp(`["'\`]${c}["'\`]`).test(a))) found.push(`${f}: classList '${c}'`);
      if (new RegExp(`["'\`][^"'\`\\n]*\\.${c}(?![\\w-])[^"'\`\\n]*["'\`]`).test(src)) found.push(`${f}: selector .${c}`);
    }
  }
  assert.deepStrictEqual([...new Set(found)], [], `still there: ${[...new Set(found)].join(', ')}`);
});
