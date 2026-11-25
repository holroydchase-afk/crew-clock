// LIC-1 license audit (docs/product/SPEC-LIC-1.md). Anyone opening the public repo or demo sees
// what ships, under which license, and that Crew Clock is MIT with no AGPL code.
// LIC1-11 (rebuild the MLS bundle, git diff exits 0) and LIC1-12 (live demo serves the notices)
// are manual cases in the spec.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
const MESSENGER = path.join(ROOT, 'messenger');
const NOTICES_PATH = path.join(ROOT, 'THIRD_PARTY_NOTICES.md');
const LEAFLET_LICENSE = path.join(ROOT, 'vendor', 'leaflet', 'LICENSE');
const OFL_PATH = path.join(ROOT, 'vendor', 'fonts', 'atkinson-hyperlegible-next', 'OFL.txt');

// A copyright statement, not prose that starts with the word (OFL.txt has "Copyright Holder. ...").
const COPYRIGHT = /^Copyright\s+(?:\(c\)\s*)?\d{4}/;

/** @param {string} p */
const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const readNotices = () => {
  assert.ok(fs.existsSync(NOTICES_PATH), 'THIRD_PARTY_NOTICES.md is missing at the repo root');
  return fs.readFileSync(NOTICES_PATH, 'utf8');
};

/**
 * Split the notices into `## ` sections.
 * @param {string} md
 * @returns {{ heading: string, body: string }[]}
 */
function sections(md) {
  /** @type {{ heading: string, body: string }[]} */
  const out = [];
  for (const line of md.split('\n')) {
    const m = /^## (.+?)\s*$/.exec(line);
    if (m) out.push({ heading: m[1], body: '' });
    else if (out.length) out[out.length - 1].body += line + '\n';
  }
  return out;
}

/**
 * The packages that ship in js/vendor/crew-mls.js, read from a lockfile's `packages` map:
 * every non-dev entry except the root and esbuild (build-only), nested entries included.
 * @param {Record<string, { version?: string, dev?: boolean }>} packages
 * @returns {{ key: string, name: string, version: string }[]}
 */
function shippedFromLock(packages) {
  /** @type {{ key: string, name: string, version: string }[]} */
  const out = [];
  for (const [key, entry] of Object.entries(packages)) {
    if (!key || entry.dev) continue;
    const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
    if (name === 'esbuild' || name.startsWith('@esbuild/')) continue;
    out.push({ key, name, version: String(entry.version) });
  }
  return out;
}

/**
 * LIC1-4 drift guard: a shipped lockfile package with no `## <name> <version>` heading, or a
 * heading that appears twice.
 * @param {Record<string, { version?: string, dev?: boolean }>} packages
 * @param {string} md
 */
function drift(packages, md) {
  const headings = sections(md).map((s) => s.heading);
  const missing = shippedFromLock(packages)
    .map((p) => `${p.name} ${p.version}`)
    .filter((h) => !headings.includes(h));
  const duplicates = headings.filter((h, i) => headings.indexOf(h) !== i);
  return { missing, duplicates };
}

/**
 * The body of the section whose heading is exactly `heading`.
 * @param {string} md
 * @param {string} heading
 */
function sectionBody(md, heading) {
  const s = sections(md).find((x) => x.heading === heading);
  assert.ok(s, `THIRD_PARTY_NOTICES.md has no "## ${heading}" section`);
  return s.body;
}

const LOCK = readJson(path.join(MESSENGER, 'package-lock.json'));

// The seven packages the spec found in the bundle (PM-R1: the nested @noble/hashes 2.0.1 too).
const BUNDLED = [
  { key: 'node_modules/ts-mls', name: 'ts-mls', version: '1.6.4' },
  { key: 'node_modules/@noble/curves', name: '@noble/curves', version: '2.0.1' },
  { key: 'node_modules/@noble/hashes', name: '@noble/hashes', version: '2.4.0' },
  { key: 'node_modules/@noble/curves/node_modules/@noble/hashes', name: '@noble/hashes', version: '2.0.1' },
  { key: 'node_modules/@noble/ciphers', name: '@noble/ciphers', version: '2.1.1' },
  { key: 'node_modules/@hpke/core', name: '@hpke/core', version: '1.9.0' },
  { key: 'node_modules/@hpke/common', name: '@hpke/common', version: '1.10.1' },
];

test('LIC1-1 both package.json files declare license MIT, and both lockfile roots match (PM-R3)', () => {
  for (const dir of [ROOT, MESSENGER]) {
    const rel = path.relative(ROOT, path.join(dir, 'package.json')) || 'package.json';
    assert.equal(readJson(path.join(dir, 'package.json')).license, 'MIT', `${rel} license`);
    const lockRel = path.relative(ROOT, path.join(dir, 'package-lock.json'));
    assert.equal(readJson(path.join(dir, 'package-lock.json')).packages[''].license, 'MIT',
      `${lockRel} root entry is stale: run npm install --package-lock-only`);
  }
});

test('LIC1-2 the notices have exactly 9 sections, with both @noble/hashes versions separate', () => {
  const headings = sections(readNotices()).map((s) => s.heading);
  assert.equal(headings.length, 9, `expected 9 "## " headings, got ${headings.length}: ${headings.join(' | ')}`);
  assert.ok(headings.includes('@noble/hashes 2.4.0'), 'no "## @noble/hashes 2.4.0" heading');
  assert.ok(headings.includes('@noble/hashes 2.0.1'), 'no "## @noble/hashes 2.0.1" heading (nested under @noble/curves)');
  assert.ok(headings.some((h) => /^Leaflet\b/.test(h)), 'no Leaflet heading');
  assert.ok(headings.some((h) => /^Atkinson Hyperlegible Next\b/.test(h)), 'no Atkinson Hyperlegible Next heading');
});

test('LIC1-3 each bundled heading carries the version in messenger/package-lock.json (no node_modules needed)', () => {
  // The lockfile itself is the source of truth; this part never reads node_modules.
  for (const b of BUNDLED) {
    assert.ok(LOCK.packages[b.key], `lockfile has no ${b.key}`);
    assert.equal(LOCK.packages[b.key].version, b.version, `${b.key} version in the lockfile`);
  }
  const headings = sections(readNotices()).map((s) => s.heading);
  const byName = new Map(shippedFromLock(LOCK.packages).map((p) => [p.name, p]));
  for (const h of headings) {
    const m = /^(@?[^\s]+) (\d\S*)$/.exec(h);
    if (!m || !byName.has(m[1])) continue;
    const versions = shippedFromLock(LOCK.packages).filter((p) => p.name === m[1]).map((p) => p.version);
    assert.ok(versions.includes(m[2]), `"## ${h}" does not match the lockfile (${m[1]}: ${versions.join(', ')})`);
  }
  for (const b of BUNDLED) {
    assert.ok(headings.includes(`${b.name} ${b.version}`), `no "## ${b.name} ${b.version}" heading`);
  }
});

test('LIC1-4 drift guard: the guard itself catches a missing package and a duplicate heading', () => {
  const okMd = BUNDLED.map((b) => `## ${b.name} ${b.version}\n`).join('\n');
  const lock = Object.fromEntries(BUNDLED.map((b) => [b.key, { version: b.version }]));
  assert.deepEqual(drift({ '': {}, ...lock, 'node_modules/esbuild': { version: '0.28.2' },
    'node_modules/@esbuild/linux-x64': { version: '0.28.2' }, 'node_modules/typescript': { version: '7.0.2', dev: true } }, okMd),
  { missing: [], duplicates: [] }, 'esbuild, @esbuild/* and dev packages need no notice');
  const added = drift({ ...lock, 'node_modules/new-dep': { version: '1.0.0' } }, okMd);
  assert.deepEqual(added.missing, ['new-dep 1.0.0'], 'a new runtime package with no heading is caught by name');
  const nested = drift({ ...lock, 'node_modules/ts-mls/node_modules/@noble/hashes': { version: '1.9.9' } }, okMd);
  assert.deepEqual(nested.missing, ['@noble/hashes 1.9.9'], 'a nested runtime package is caught too');
  assert.deepEqual(drift(lock, okMd + '\n## ts-mls 1.6.4\n').duplicates, ['ts-mls 1.6.4'], 'a duplicate heading is caught');
});

test('LIC1-4 drift guard: every shipped package in messenger/package-lock.json has one heading', () => {
  const { missing, duplicates } = drift(LOCK.packages, readNotices());
  assert.deepEqual(missing, [], `lockfile packages with no notice: ${missing.join(', ')}`);
  assert.deepEqual(duplicates, [], `duplicate notice headings: ${duplicates.join(', ')}`);
});

const hasModules = fs.existsSync(path.join(MESSENGER, 'node_modules'));
test('LIC1-5 every Copyright line of each bundled LICENSE is quoted in its section',
  { skip: hasModules ? false : 'messenger/node_modules is not installed (run npm ci in messenger/); LIC1-3 still checks versions' },
  () => {
    const md = readNotices();
    for (const p of shippedFromLock(LOCK.packages)) {
      const dir = path.join(MESSENGER, p.key);
      assert.ok(fs.existsSync(dir), `${p.key} is in the lockfile but not installed: rerun npm ci in messenger/`);
      const file = fs.readdirSync(dir).find((f) => /^licen[cs]e/i.test(f));
      assert.ok(file, `${p.key} has no LICENSE file`);
      const lines = fs.readFileSync(path.join(dir, file), 'utf8').split('\n')
        .map((l) => l.trim()).filter((l) => COPYRIGHT.test(l));
      assert.ok(lines.length > 0, `${p.key}/${file} has no Copyright line`);
      if (p.name === '@noble/ciphers') assert.equal(lines.length, 2, '@noble/ciphers carries 2 copyright lines');
      const body = sectionBody(md, `${p.name} ${p.version}`);
      for (const l of lines) assert.ok(body.includes(l), `"## ${p.name} ${p.version}" is missing: ${l}`);
    }
  });

test('LIC1-6 Leaflet reads BSD-2-Clause 1.9.4; Atkinson reads OFL-1.1 with the OFL.txt copyright verbatim', () => {
  const all = sections(readNotices());
  const leaflet = all.find((s) => /^Leaflet\b/.test(s.heading));
  assert.ok(leaflet, 'no Leaflet section');
  assert.match(`${leaflet.heading}\n${leaflet.body}`, /1\.9\.4/);
  assert.match(leaflet.body, /BSD-2-Clause/);
  const atkinson = all.find((s) => /^Atkinson Hyperlegible Next\b/.test(s.heading));
  assert.ok(atkinson, 'no Atkinson Hyperlegible Next section');
  assert.match(atkinson.body, /OFL-1\.1/);
  const ofl = fs.readFileSync(OFL_PATH, 'utf8').split('\n').map((l) => l.trim()).filter((l) => COPYRIGHT.test(l));
  assert.ok(ofl.length > 0, 'OFL.txt has no Copyright line');
  for (const l of ofl) assert.ok(atkinson.body.includes(l), `Atkinson section is missing: ${l}`);
});

test('LIC1-7 vendor/leaflet/LICENSE ships the BSD-2-Clause text from leaflet@1.9.4', () => {
  assert.ok(fs.existsSync(LEAFLET_LICENSE), 'vendor/leaflet/LICENSE is missing');
  const text = fs.readFileSync(LEAFLET_LICENSE, 'utf8');
  assert.ok(text.includes('Copyright (c) 2010-2023, Volodymyr Agafonkin'));
  assert.ok(text.includes('Copyright (c) 2010-2011, CloudMade'));
  assert.ok(text.includes('Redistribution and use in source and binary forms'));
});

test('LIC1-8 README License section links both LICENSE and THIRD_PARTY_NOTICES.md', () => {
  const readme = fs.readFileSync(path.join(ROOT, 'README.md'), 'utf8');
  const m = /^## License\s*$([\s\S]*?)(?=^## |(?![\s\S]))/m.exec(readme);
  assert.ok(m, 'README has no "## License" section');
  assert.ok(m[1].includes('](LICENSE)'), 'License section lost its [MIT](LICENSE) link');
  assert.ok(m[1].includes('](THIRD_PARTY_NOTICES.md)'), 'License section has no link to THIRD_PARTY_NOTICES.md');
});

test('LIC1-9 messenger/src/mls.js says in lines 1-5 it is original MIT work, not copied from Hearth', () => {
  const head = fs.readFileSync(path.join(MESSENGER, 'src', 'mls.js'), 'utf8').split('\n').slice(0, 5).join('\n');
  assert.ok(head.includes('Not copied from Hearth'), 'mls.js lines 1-5 lack "Not copied from Hearth"');
  assert.ok(head.includes('MIT'), 'mls.js lines 1-5 lack "MIT"');
});

test('LIC1-10 the --demo build ships THIRD_PARTY_NOTICES.md and vendor/leaflet/LICENSE', () => {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-lic-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-site.mjs'), out, '--demo'], { stdio: 'pipe' });
    assert.ok(fs.existsSync(path.join(out, 'THIRD_PARTY_NOTICES.md')), 'demo build has no THIRD_PARTY_NOTICES.md');
    assert.ok(fs.existsSync(path.join(out, 'vendor', 'leaflet', 'LICENSE')), 'demo build has no vendor/leaflet/LICENSE');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
  assert.ok(!fs.existsSync(out), 'temp build dir was not removed');
});

// PS-R1 (privacy-security, P1 on LIC-1): MIT requires "this permission notice" in all copies, so
// a heading plus "License: MIT" and the copyright lines is not enough. The standard MIT text must
// appear in the notices (once, said to apply to every MIT section, or in each MIT section), and
// the [LICENSE](LICENSE) link in the notices must resolve on the Pages build.
// Keep LIC1-2 in mind: a new "## " heading for the text would change the section count.
const MIT_START = 'Permission is hereby granted, free of charge';
const MIT_END = 'OTHER DEALINGS IN THE SOFTWARE.';
/** Whitespace-normalize Markdown, dropping blockquote markers so a quoted copy still counts. */
const norm = (/** @type {string} */ s) => s.replace(/^[ \t]*>[ \t]?/gm, '').replace(/\s+/g, ' ').trim();
/** The standard MIT permission text, from the repo's own LICENSE. */
function mitPermissionText() {
  const lic = norm(fs.readFileSync(path.join(ROOT, 'LICENSE'), 'utf8'));
  const a = lic.indexOf(MIT_START);
  const b = lic.indexOf(MIT_END);
  assert.ok(a >= 0 && b > a, 'LICENSE does not hold the standard MIT permission text');
  const text = lic.slice(a, b + MIT_END.length);
  assert.ok(text.includes('The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.'));
  assert.ok(text.includes('THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND'));
  return text;
}

test('PS-R1 the notices carry the full MIT permission text and say it applies to every MIT section', () => {
  const md = readNotices();
  const text = mitPermissionText();
  assert.ok(norm(md).includes(text),
    `THIRD_PARTY_NOTICES.md lacks the full MIT permission text ("${MIT_START} ... ${MIT_END}", whitespace-normalized)`);
  const mit = sections(md).filter((s) => /^License:\s*MIT\s*$/m.test(s.body));
  assert.equal(mit.length, 7, `expected 7 "License: MIT" sections, got ${mit.length}`);
  const inEach = mit.every((s) => norm(s.body).includes(text));
  const saysAll = /\b(?:appl(?:y|ies))\b[^.]*\b(?:every|each|all)\b[^.]*\bMIT\b|\b(?:every|each|all)\b[^.]*\bMIT\b[^.]*\bappl(?:y|ies)\b/i.test(norm(md));
  assert.ok(inEach || saysAll,
    'the MIT text is neither in every "License: MIT" section nor stated to apply to every MIT section');
});

test('PS-R1 the --demo build ships LICENSE and THIRD_PARTY_NOTICES.md, so the notices\' [LICENSE](LICENSE) link resolves', () => {
  assert.ok(readNotices().includes('](LICENSE)'), 'the notices no longer link [LICENSE](LICENSE)');
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'crew-lic-'));
  try {
    execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'build-site.mjs'), out, '--demo'], { stdio: 'pipe' });
    assert.ok(fs.existsSync(path.join(out, 'THIRD_PARTY_NOTICES.md')), 'demo build has no THIRD_PARTY_NOTICES.md');
    assert.ok(fs.existsSync(path.join(out, 'LICENSE')), 'demo build has no LICENSE, so the notices\' [LICENSE](LICENSE) link 404s');
    assert.ok(norm(fs.readFileSync(path.join(out, 'LICENSE'), 'utf8')).includes(mitPermissionText()), 'built LICENSE lacks the MIT text');
  } finally {
    fs.rmSync(out, { recursive: true, force: true });
  }
});
