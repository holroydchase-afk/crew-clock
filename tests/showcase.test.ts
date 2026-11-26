// M1.6 showcase polish: the demo as GitHub Pages ships it has no unfinished markers and no
// broken same-site links. Builds a fresh demo into a temp folder.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.join(import.meta.dirname, '..');
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-show-'));
execFileSync(process.execPath, [path.join(ROOT, 'scripts/build-site.mts'), OUT, '--demo'], { cwd: ROOT, stdio: 'ignore' });

function files(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return d.name === 'vendor' ? [] : files(p); // third-party bundles
    return /\.(html|js|css|json|webmanifest)$/.test(d.name) ? [p] : [];
  });
}

test('no TODO, FIXME, "coming soon" or placeholder text in the shipped demo', () => {
  const hits: string[] = [];
  for (const f of files(OUT)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      if (/\bTODO\b|\bFIXME\b|coming soon|lorem ipsum/i.test(l)) hits.push(`${path.relative(OUT, f)}:${i + 1}`);
    });
  }
  assert.deepStrictEqual(hits, []);
});

test('every same-site link, script, stylesheet and icon in the demo exists', () => {
  const missing = [];
  const refs = (f: string, src: string) => [...src.matchAll(/(?:href|src)="([^"#?]+)/g)].map((m) => m[1])
    .filter((u) => !/^(https?:|mailto:|data:|\$\{|\/\/)/.test(u)).map((u) => [f, u]);
  const html = fs.readFileSync(path.join(OUT, 'index.html'), 'utf8');
  const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.webmanifest'), 'utf8'));
  const all = [...refs('index.html', html), ...(manifest.icons || []).map((i: { src: string }) => ['manifest', i.src])];
  for (const [from, u] of all) {
    if (!fs.existsSync(path.join(OUT, u.replace(/^\.?\//, '')))) missing.push(`${from} -> ${u}`);
  }
  assert.deepStrictEqual(missing, []);
});

test('the demo\'s outside links point where they say', () => {
  const app = fs.readFileSync(path.join(OUT, 'js/app.js'), 'utf8');
  const outside = [...app.matchAll(/href="(https?:[^"]+)"/g)].map((m) => m[1]);
  assert.ok(outside.length > 0, 'no outside links found');
  for (const u of outside) assert.match(u, /^https:\/\/(chaseholroyd\.com|github\.com\/holroydchase-afk\/crew-clock)/, u);
});
