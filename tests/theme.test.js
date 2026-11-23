// Studio design-system restyle (docs/design/CRW-RESTYLE.md, DS-1..DS-9): static checks on
// css/app.css and sw.js. Run: node --test tests/theme.test.js (also part of `npm test`).
// The rendered-page side (computed font sizes, 48 px targets, the font actually loading) is in
// tests/e2e-design.js.
//
// What is exempt, and why:
// - Rules whose every selector is a Leaflet one (`.leaflet-...`) are exempt from DS-4 (space and
//   corners), DS-5 (shadows) and DS-9 (outlines): they restyle Leaflet's own controls (spec DS-4).
//   They are NOT exempt from DS-2 (weights) or DS-3 (font sizes): text on the map is still text.
// - Map dot and pin sizes are width/height, which DS-4 doesn't check at all; their corners are
//   still checked (50% for a round dot is allowed).
// - DS-5 allows a shadow on focus rules and on the map's markers and legend (.crew-dot, .job-pin,
//   .map-legend): they sit on a photo map and need solid backing (principle 5).
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const CSS = fs.readFileSync(path.join(ROOT, 'css/app.css'), 'utf8');
const SW = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const TOKENS = JSON.parse(fs.readFileSync(path.join(ROOT, 'docs/design/tokens.json'), 'utf8'));
const FONT_DIR = 'vendor/fonts/atkinson-hyperlegible-next';
const FONT_FILES = [400, 500, 600].map((w) => `${FONT_DIR}/atkinson-hyperlegible-next-latin-${w}-normal.woff2`);
const FAMILY = 'Atkinson Hyperlegible Next';

// ---------- a small CSS reader ----------
// Returns every style rule as { media, selector, decls: [{ prop, value }] }. Nested @media (and
// @supports) blocks are walked and their conditions joined with " and "; @font-face is kept as a
// rule with selector "@font-face"; @keyframes and other at-rules are skipped.
/**
 * @typedef {{ prop: string, value: string }} Decl
 * @typedef {{ media: string | null, selector: string, decls: Decl[] }} CssRule
 * @param {string} src @returns {CssRule[]}
 */
function parseCss(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '');
  /** @type {CssRule[]} */
  const rules = [];
  /** @param {string} s @param {string | null} media */
  const walk = (s, media) => {
    let i = 0;
    while (i < s.length) {
      const open = s.indexOf('{', i);
      if (open < 0) break;
      const prelude = s.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (depth && j < s.length) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
      const body = s.slice(open + 1, j - 1);
      if (/^@(media|supports)/.test(prelude)) {
        const cond = prelude.replace(/^@(media|supports)\s*/, '');
        walk(body, media ? `${media} and ${cond}` : cond);
      } else if (prelude.startsWith('@font-face')) rules.push({ media, selector: '@font-face', decls: declsOf(body) });
      else if (!prelude.startsWith('@')) rules.push({ media, selector: prelude.replace(/\s+/g, ' '), decls: declsOf(body) });
      i = j;
    }
  };
  walk(src, null);
  return rules;
}
// Splits a block body on semicolons that are not inside parentheses (url(), calc()).
/** @param {string} body @returns {Decl[]} */
function declsOf(body) {
  /** @type {Decl[]} */
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i <= body.length; i++) {
    const c = body[i];
    if (c === '(') depth++;
    else if (c === ')') depth--;
    else if ((c === ';' && depth === 0) || i === body.length) {
      const d = body.slice(start, i).trim();
      start = i + 1;
      const k = d.indexOf(':');
      if (k > 0) out.push({ prop: d.slice(0, k).trim().toLowerCase(), value: d.slice(k + 1).trim().replace(/\s*!important$/, '') });
    }
  }
  return out;
}
const RULES = parseCss(CSS);
/** @param {CssRule} r @param {Decl} d */
const where = (r, d) => `${r.media ? `@media ${r.media} ` : ''}${r.selector} { ${d.prop}: ${d.value} }`;
/** @param {(prop: string, r: CssRule) => boolean} pred */
const decls = (pred) => RULES.flatMap((r) => r.decls.filter((d) => pred(d.prop, r)).map((d) => ({ r, d })));
/** @param {CssRule} r @param {RegExp} re */
const allSelectors = (r, re) => r.selector.split(',').every((s) => re.test(s));
/** @param {CssRule} r */
const isLeaflet = (r) => allSelectors(r, /\.leaflet-/);

// ---------- tokens, mode by mode, following the cascade ----------
/** @type {Record<string, { dark: boolean, hc: boolean }>} */
const MODES = {
  light: { dark: false, hc: false },
  dark: { dark: true, hc: false },
  'hc-light': { dark: false, hc: true },
  'hc-dark': { dark: true, hc: true },
};
// Does a media condition apply in this mode? Only colour scheme and contrast are understood; a
// condition with anything else in it (widths etc.) doesn't hold the theme tokens.
/** @param {string | null} media @param {{ dark: boolean, hc: boolean }} mode */
function mediaApplies(media, mode) {
  if (!media) return true;
  if (/prefers-color-scheme:\s*dark/.test(media) && !mode.dark) return false;
  if (/prefers-color-scheme:\s*light/.test(media) && mode.dark) return false;
  if (/prefers-contrast:\s*more/.test(media) && !mode.hc) return false;
  const rest = media.replace(/\(\s*prefers-color-scheme:\s*(dark|light)\s*\)|\(\s*prefers-contrast:\s*more\s*\)|\band\b|\b(screen|all)\b|\s/g, '');
  return rest === '';
}
/** @param {string} modeName @returns {Record<string, string>} */
function tokensFor(modeName) {
  const mode = MODES[modeName];
  /** @type {Record<string, string>} */
  const raw = {};
  for (const r of RULES) {
    if (!r.selector.split(',').some((s) => s.trim() === ':root') || !mediaApplies(r.media, mode)) continue;
    for (const d of r.decls) if (d.prop.startsWith('--')) raw[d.prop.slice(2)] = d.value;
  }
  /** @param {string} v @param {number} [seen] @returns {string} */
  const resolve = (v, seen = 0) => (seen > 10 ? v : v.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)/g,
    (/** @type {string} */ m, /** @type {string} */ n, /** @type {string | undefined} */ fb) => (raw[n] != null ? resolve(raw[n], seen + 1) : (fb != null ? fb : m))));
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolve(v).trim().toLowerCase()]));
}
const T = Object.fromEntries(Object.keys(MODES).map((m) => [m, tokensFor(m)]));
// Light tokens resolve var() in any value (used for spacing and type tokens).
/** @param {string} v */
const resolveLight = (v) => v.replace(/var\(\s*--([\w-]+)\s*(?:,\s*([^)]*))?\)/g, (/** @type {string} */ m, /** @type {string} */ n, /** @type {string | undefined} */ fb) => T.light[n] || fb || m);

// ---------- WCAG 2 contrast (same maths as tests/harden.test.js UX-16) ----------
/** @param {string | null | undefined} h */
const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h || '');
/** @param {string} hex */
function lum(hex) {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
/** @param {string} a @param {string} b */
function contrast(a, b) {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}
/** @param {string} h */
const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
// `top` mixed into `page`, with `pagePart` of the page (0.93 light, 0.82 dark), like safeSoft.
/** @param {string} top @param {string} page @param {number} pagePart */
const mix = (top, page, pagePart) => rgb(top).map((v, i) => Math.round(v * (1 - pagePart) + rgb(page)[i] * pagePart));
/** @param {string} hex @param {number[]} want */
const near = (hex, want) => isHex(hex) && rgb(hex).every((v, i) => Math.abs(v - want[i]) <= 1);

/** @param {string} s */
const kebab = (s) => s.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const STUDIO = ['bg', 'surface', 'ink', 'muted', 'line', 'fill', 'accent', 'accent-ink', 'accent-soft', 'safe', 'safe-soft',
  'danger', 'on-danger', 'danger-text', 'tab-line', 'scrim'];

// ================= DS-1 Font =================

test('DS-1 the three Atkinson Hyperlegible Next files (400/500/600 woff2) and the OFL licence are in vendor/fonts', () => {
  const missing = [...FONT_FILES, `${FONT_DIR}/OFL.txt`].filter((f) => !fs.existsSync(path.join(ROOT, f)));
  assert.deepStrictEqual(missing, []);
});

test('DS-1 app.css declares @font-face for Atkinson Hyperlegible Next 400, 500 and 600 from the bundled woff2, with font-display: swap', () => {
  const faces = RULES.filter((r) => r.selector === '@font-face').map((r) => Object.fromEntries(r.decls.map((d) => [d.prop, d.value])));
  const errs = [];
  for (const w of ['400', '500', '600']) {
    const f = faces.find((x) => (x['font-family'] || '').replace(/["']/g, '') === FAMILY && x['font-weight'] === w);
    if (!f) { errs.push(`no @font-face for ${FAMILY} ${w}`); continue; }
    if (f['font-display'] !== 'swap') errs.push(`${w}: font-display is ${f['font-display'] || 'missing'}, want swap`);
    if (f['font-style'] && f['font-style'] !== 'normal') errs.push(`${w}: font-style ${f['font-style']}`);
    const urls = [...(f.src || '').matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/g)].map((m) => m[1]);
    const want = FONT_FILES.find((x) => x.includes(`-${w}-`));
    if (!urls.some((u) => path.normalize(path.join(ROOT, 'css', u)) === path.join(ROOT, /** @type {string} */ (want)))) errs.push(`${w}: src ${JSON.stringify(urls)} is not ../${want}`);
    if (urls.some((u) => /^(https?:)?\/\//.test(u))) errs.push(`${w}: src points off the site`);
  }
  assert.deepStrictEqual(errs, []);
});

test('DS-1 body uses "Atkinson Hyperlegible Next", system-ui, sans-serif', () => {
  const body = RULES.filter((r) => r.selector.split(',').some((s) => s.trim() === 'body'));
  let family = null;
  for (const r of body) {
    for (const d of r.decls) {
      if (d.prop === 'font-family') family = d.value;
      if (d.prop === 'font') { const m = d.value.match(/\d[\w.%]*(?:\/\S+)?\s+(.+)$/); if (m) family = m[1]; }
    }
  }
  /** @param {string | null | undefined} s */
  const norm = (s) => (s || '').replace(/'/g, '"').replace(/\s*,\s*/g, ', ').trim();
  assert.strictEqual(norm(family), `"${FAMILY}", system-ui, sans-serif`);
});

test('DS-1 sw.js SHELL_FILES lists the three woff2 files, so the font works with no signal', () => {
  const list = (SW.match(/const SHELL_FILES = \[([\s\S]*?)\];/) || [, ''])[1];
  const files = [...list.matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepStrictEqual(FONT_FILES.filter((f) => !files.includes(f)), []);
});

test('DS-1 no other font: no font host, no @import, no other font file in the repo', () => {
  const errs = [];
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  for (const [name, src] of [['css/app.css', CSS], ['index.html', html]]) {
    if (/fonts\.(googleapis|gstatic)\.com|use\.typekit|fonts\.bunny/i.test(src)) errs.push(`${name} loads a font host`);
  }
  if (/@import/i.test(CSS)) errs.push('app.css has an @import');
  if (/url\(\s*["']?(https?:)?\/\//i.test(CSS)) errs.push('app.css has an off-site url()');
  const skip = new Set(['node_modules', '.git', 'dist']);
  /** @param {string} dir @returns {string[]} */
  const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (skip.has(e.name)) return [];
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : [path.relative(ROOT, p)];
  });
  const fonts = walk(ROOT).filter((f) => /\.(woff2?|ttf|otf|eot)$/i.test(f)).filter((f) => !FONT_FILES.includes(f.split(path.sep).join('/')));
  if (fonts.length) errs.push(`other font files: ${fonts.join(', ')}`);
  assert.deepStrictEqual(errs, []);
});

// ================= DS-2 Weights =================

test('DS-2 font-weight is only 400, 500 or 600 (no bold, 700, 800); no uppercase; no italic', () => {
  const ok = new Set(['400', '500', '600', 'normal', 'inherit']);
  const bad = [];
  for (const { r, d } of decls((p) => p === 'font-weight')) if (!ok.has(d.value)) bad.push(where(r, d));
  for (const { r, d } of decls((p) => p === 'font')) if (/\b(bold|bolder|[7-9]00|lighter|[1-3]00|italic|oblique)\b/.test(d.value)) bad.push(where(r, d));
  for (const { r, d } of decls((p) => p === 'text-transform')) if (/uppercase/.test(d.value)) bad.push(where(r, d));
  for (const { r, d } of decls((p) => p === 'font-style')) if (/italic|oblique/.test(d.value)) bad.push(where(r, d));
  assert.deepStrictEqual(bad, []);
});

// ================= DS-3 Type ramp =================

test('DS-3 the ramp tokens are --type-base 17px, --type-title 22px, --type-display 28px, --type-large 34px; body line-height 22px', () => {
  const want = { 'type-base': '17px', 'type-title': '22px', 'type-display': '28px', 'type-large': '34px' };
  const got = Object.fromEntries(Object.keys(want).map((k) => [k, T.light[k]]));
  assert.deepStrictEqual(got, want);
  let lh = null;
  for (const r of RULES.filter((x) => !x.media && x.selector.split(',').some((s) => s.trim() === 'body'))) {
    for (const d of r.decls) {
      if (d.prop === 'line-height') lh = resolveLight(d.value);
      if (d.prop === 'font') { const m = resolveLight(d.value).match(/\d+px\/(\S+)/); if (m) lh = m[1]; }
    }
  }
  assert.strictEqual(lh, '22px', 'body line-height');
});

test('DS-3 every font-size in app.css is 17, 22, 28 or 34 px, a ramp var(), inherit or 1em (font shorthand too)', () => {
  const okPx = new Set(['17px', '22px', '28px', '34px']);
  const okVar = /^var\(--type-(base|title|display|large)\)$/;
  /** @param {string} v */
  const fine = (v) => okPx.has(v) || okVar.test(v) || v === 'inherit' || v === '1em';
  const bad = [];
  for (const { r, d } of decls((p) => p === 'font-size' || p === '--type-base' || p === '--type-title' || p === '--type-display' || p === '--type-large')) {
    if (!fine(d.value)) bad.push(where(r, d));
  }
  for (const { r, d } of decls((p) => p === 'font')) {
    if (d.value === 'inherit') continue;
    const size = (d.value.match(/(?:^|\s)((?:\d*\.?\d+)(?:px|em|rem|%|pt)|var\([^)]+\))(?:\/|\s)/) || [])[1];
    if (!size || !fine(size)) bad.push(where(r, d));
  }
  assert.deepStrictEqual(bad, []);
});

// ================= DS-4 Space and corners =================

const SPACE = new Set([0, 4, 8, 12, 16, 24, 32]);
// Every number with a length unit in a value (after var() is resolved); unitless multipliers in
// calc() are fine. em/rem count as off-grid unless 0, so they can't slip past the px check.
/** @param {string} value */
function lengths(value) {
  return [...resolveLight(value).matchAll(/(-?\d*\.?\d+)(px|em|rem|pt|vw|vh|%)?/g)]
    .filter((m) => m[2] || Number(m[1]) === 0)
    .map((m) => ({ n: Math.abs(Number(m[1])), unit: m[2] || 'px' }));
}

test('DS-4 every padding, margin and gap is 0, 4, 8, 12, 16, 24 or 32 px (negatives allowed; Leaflet controls exempt)', () => {
  const bad = [];
  for (const { r, d } of decls((p) => /^(padding|margin)(-|$)|^(row-|column-)?gap$|^--gutter$/.test(p))) {
    if (isLeaflet(r) || d.value === 'auto' || d.value === 'inherit') continue;
    const off = lengths(d.value).filter((x) => !(x.unit === 'px' && SPACE.has(x.n)) && x.n !== 0);
    if (off.length) bad.push(where(r, d));
  }
  assert.deepStrictEqual(bad, []);
});

test('DS-4 corners are 4, 12, 999 px or 50% (via --radius-small/medium/pill), Leaflet controls exempt', () => {
  const want = { 'radius-small': '4px', 'radius-medium': '12px', 'radius-pill': '999px' };
  assert.deepStrictEqual(Object.fromEntries(Object.keys(want).map((k) => [k, T.light[k]])), want);
  const bad = [];
  for (const { r, d } of decls((p) => /^border(-[a-z]+)*-radius$|^--radius/.test(p))) {
    if (isLeaflet(r)) continue;
    const off = lengths(d.value.replace(/\s*\/\s*/g, ' ')).filter((x) => !(x.n === 0 || (x.unit === 'px' && [4, 12, 999].includes(x.n)) || (x.unit === '%' && x.n === 50)));
    if (off.length) bad.push(where(r, d));
  }
  assert.deepStrictEqual(bad, []);
});

// ================= DS-5 Depth =================

test('DS-5 no box-shadow except focus rings and the map markers and legend (.crew-dot, .job-pin, .map-legend)', () => {
  const allowed = /:focus|\.crew-dot|\.job-pin|\.map-legend|\.leaflet-/;
  const bad = decls((p) => p === 'box-shadow' || p === '-webkit-box-shadow' || p === '--shadow')
    .filter(({ r, d }) => d.value !== 'none' && !allSelectors(r, allowed))
    .map(({ r, d }) => where(r, d));
  assert.deepStrictEqual(bad, []);
});

// ================= DS-6 Paper theme =================

test('DS-6 :root light tokens equal tokens.json themes.paper.light (studio names)', () => {
  const paper = TOKENS.themes.paper.light;
  const want = Object.fromEntries(STUDIO.map((k) => [k, paper[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())].toLowerCase().replace(/\s/g, '')]));
  const got = Object.fromEntries(STUDIO.map((k) => [k, (T.light[k] || '(missing)').replace(/\s/g, '')]));
  assert.deepStrictEqual(got, want);
});

test('DS-6 prefers-color-scheme: dark tokens equal tokens.json themes.paper.dark', () => {
  const paper = TOKENS.themes.paper.dark;
  const want = Object.fromEntries(STUDIO.map((k) => [k, paper[k.replace(/-([a-z])/g, (m, c) => c.toUpperCase())].toLowerCase().replace(/\s/g, '')]));
  const got = Object.fromEntries(STUDIO.map((k) => [k, (T.dark[k] || '(missing)').replace(/\s/g, '')]));
  assert.deepStrictEqual(got, want);
});

test('DS-6 product extras --danger-soft and --warn-soft are mixed into the page like safeSoft (93% light, 82% dark)', () => {
  const errs = [];
  for (const [mode, part] of /** @type {[string, number][]} */ ([['light', 0.93], ['dark', 0.82]])) {
    const t = T[mode];
    if (!isHex(t.warn)) errs.push(`${mode}: --warn missing or not a hex colour (${t.warn})`);
    else if (!near(t['warn-soft'], mix(t.warn, t.bg, part))) errs.push(`${mode}: --warn-soft ${t['warn-soft']} is not --warn mixed into --bg`);
    const bases = ['danger', 'danger-text'].filter((k) => isHex(t[k]) && isHex(t.bg));
    if (!bases.some((k) => near(t['danger-soft'], mix(t[k], t.bg, part)))) errs.push(`${mode}: --danger-soft ${t['danger-soft']} is not --danger or --danger-text mixed into --bg`);
  }
  assert.deepStrictEqual(errs, []);
});

test('DS-6 the old blue/gray palette names are gone (--card, --blue*, --gray*, --green*, --red*, --amber*, --shadow, --radius)', () => {
  const old = /^--(card|blue|blue-soft|blue-ink|gray|gray-soft|green|green-bg|green-soft|red|red-bg|red-soft|amber|amber-soft|shadow|radius)$/;
  const defined = decls((p) => old.test(p)).map(({ r, d }) => where(r, d));
  const used = [...new Set([...CSS.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]).filter((n) => old.test(n)))];
  assert.deepStrictEqual({ defined, used }, { defined: [], used: [] });
});

test('DS-6 prefers-contrast: more has a light and a dark block', () => {
  const hc = RULES.filter((r) => r.selector.split(',').some((s) => s.trim() === ':root') && /prefers-contrast:\s*more/.test(r.media || ''));
  assert.ok(hc.some((r) => !/prefers-color-scheme:\s*dark/.test(/** @type {string} */ (r.media))), 'no high contrast block for light');
  assert.ok(hc.some((r) => /prefers-color-scheme:\s*dark/.test(/** @type {string} */ (r.media))), 'no high contrast block for dark');
  for (const [hcMode, base] of [['hc-light', 'light'], ['hc-dark', 'dark']]) {
    assert.notStrictEqual(T[hcMode].muted, T[base].muted, `${hcMode} --muted is the same as ${base}`);
  }
});

test('DS-6 high contrast: accent moves at least 30% toward ink (light and dark)', () => {
  const errs = [];
  for (const [hcMode, base] of [['hc-light', 'light'], ['hc-dark', 'dark']]) {
    const a = T[base].accent; const ink = T[base].ink; const got = T[hcMode].accent;
    if (![a, ink, got].every(isHex)) { errs.push(`${hcMode}: accent/ink missing (${a}, ${ink}, ${got})`); continue; }
    /** @param {string} p @param {string} q */
    const dist = (p, q) => Math.hypot(...rgb(p).map((v, i) => v - rgb(q)[i]));
    if (dist(got, ink) > 0.7 * dist(a, ink) + 1.5) errs.push(`${hcMode}: --accent ${got} is not 30%+ of the way from ${a} to ink ${ink}`);
  }
  assert.deepStrictEqual(errs, []);
});

// ================= DS-7 Contrast (STUDIO-CORE section 7 step 3) =================

for (const mode of Object.keys(MODES)) {
  test(`DS-7 ${mode}: every studio contrast pair passes WCAG 2`, () => {
    const t = T[mode];
    const hc = MODES[mode].hc;
    /** @type {[string, string, string, number][]} */
    const pairs = [
      ['ink on bg', 'ink', 'bg', 7],
      ['muted on bg', 'muted', 'bg', hc ? 7 : 4.5], ['muted on fill', 'muted', 'fill', hc ? 7 : 4.5],
      ['accent on bg', 'accent', 'bg', 4.5], ['accent on fill', 'accent', 'fill', 4.5], ['accent on accent-soft', 'accent', 'accent-soft', 4.5],
      ['accent-ink on accent', 'accent-ink', 'accent', hc ? 7 : 4.5],
      ['safe on bg', 'safe', 'bg', 4.5], ['danger-text on bg', 'danger-text', 'bg', 4.5],
      ['tab-line on bg', 'tab-line', 'bg', 3], ['tab-line on surface', 'tab-line', 'surface', 3],
      ['warn on warn-soft', 'warn', 'warn-soft', 4.5], ['danger-text on danger-soft', 'danger-text', 'danger-soft', 4.5],
      ['white on punch-in (Clock in)', '#ffffff', 'punch-in', 4.5], ['white on punch-out (Clock out)', '#ffffff', 'punch-out', 4.5],
      .../** @type {[string, string, string, number][]} */ (hc ? [['line on bg (high contrast)', 'line', 'bg', 4.5]] : []),
    ];
    /** @param {string} k */
    const col = (k) => (k.startsWith('#') ? k : t[k]);
    const bad = pairs.flatMap(([name, fg, bg, min]) => {
      if (!isHex(col(fg)) || !isHex(col(bg))) return [`${name}: missing token (--${fg}=${col(fg)}, --${bg}=${col(bg)})`];
      const r = contrast(col(fg), col(bg));
      return r < min ? [`${name}: ${col(fg)} on ${col(bg)} ${r.toFixed(2)}:1 < ${min}:1`] : [];
    });
    assert.deepStrictEqual(bad, []);
  });
}

// ================= DS-9 Focus =================

test('DS-9 every outline is 2px solid var(--accent) (or none); a :focus-visible rule has one; focus never changes size', () => {
  const bad = [];
  for (const { r, d } of decls((p) => /^outline(-(width|style|color))?$/.test(p))) {
    if (isLeaflet(r) || /^(none|0|0px)$/.test(d.value)) continue;
    if (d.prop !== 'outline' || d.value !== '2px solid var(--accent)') bad.push(where(r, d));
  }
  const ring = RULES.some((r) => /:focus-visible/.test(r.selector) && r.decls.some((d) => d.prop === 'outline' && d.value === '2px solid var(--accent)'));
  if (!ring) bad.push('no :focus-visible rule with outline: 2px solid var(--accent)');
  for (const r of RULES.filter((x) => /:focus/.test(x.selector) && !isLeaflet(x))) {
    for (const d of r.decls) if (/^(border(-(top|right|bottom|left))?(-width)?|padding.*|margin.*|width|height)$/.test(d.prop)) bad.push(`${where(r, d)} (layout shift)`);
  }
  assert.deepStrictEqual(bad, []);
});

// ================= ux-reviewer findings on the restyle =================

test('AC-R62 the map job pin (.job-pin span) background is var(--ink), not a hardcoded hex', () => {
  const bad = [];
  const rules = RULES.filter((r) => r.selector.split(',').some((s) => /\.job-pin\s+span\b/.test(s.trim())));
  if (!rules.length) bad.push('no .job-pin span rule');
  for (const r of rules) {
    for (const d of r.decls) {
      if (/^background(-color)?$/.test(d.prop) && /#[0-9a-f]{3,8}\b/i.test(d.value)) bad.push(where(r, d));
    }
  }
  const bg = rules.flatMap((r) => r.decls.filter((d) => /^background(-color)?$/.test(d.prop)).map((d) => d.value));
  if (rules.length && !bg.includes('var(--ink)')) bad.push(`.job-pin span background is ${JSON.stringify(bg)}, want var(--ink)`);
  assert.deepStrictEqual(bad, []);
});
