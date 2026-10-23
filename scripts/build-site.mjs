// Copies only the phone app into dist/ for a static host (Cloudflare Pages), so the
// backend, migrations, tests and docs never go on the web. node scripts/build-site.mjs
//
// It also:
// - fills config.js from environment variables when they are set (the host's dashboard),
//   so the real Supabase project doesn't have to be committed;
// - stamps the service worker VERSION with a hash of the app files, so phones always
//   pick up a new release even if nobody remembered to bump it.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, process.argv[2] || 'dist');

const COPY = ['index.html', 'config.js', 'manifest.webmanifest', 'sw.js', '_headers', 'css', 'js', 'vendor', 'icons'];

// config.js key <- environment variable
const ENV = {
  backend: 'CREW_BACKEND',
  supabaseUrl: 'SUPABASE_URL',
  supabaseAnonKey: 'SUPABASE_ANON_KEY',
  orgCode: 'ORG_CODE',
  vapidPublicKey: 'VAPID_PUBLIC_KEY',
  backendUrl: 'SHEETS_BACKEND_URL',
  sheetUrl: 'SHEET_URL',
};

export function fillConfig(src, env) {
  let text = src;
  for (const [key, name] of Object.entries(ENV)) {
    const value = env[name];
    if (!value) continue;
    const re = new RegExp(`^(\\s*${key}:\\s*)'[^']*'`, 'm');
    if (!re.test(text)) throw new Error(`config.js has no ${key}: '...' line`);
    const quoted = `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    text = text.replace(re, (_, head) => head + quoted);
  }
  return text;
}

export function shellFiles(sw) {
  const m = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  if (!m) throw new Error('sw.js has no SHELL_FILES list');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function stampVersion(sw, hash) {
  const re = /const VERSION = '([^']*)';/;
  if (!re.test(sw)) throw new Error('sw.js has no VERSION line');
  return sw.replace(re, (_, v) => `const VERSION = '${v}-${hash}';`);
}

function build() {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  for (const p of COPY) cpSync(join(root, p), join(out, p), { recursive: true });

  writeFileSync(join(out, 'config.js'), fillConfig(readFileSync(join(out, 'config.js'), 'utf8'), process.env));

  const swPath = join(out, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const files = shellFiles(sw).filter((f) => f !== './');
  const missing = files.filter((f) => !existsSync(join(out, f)));
  if (missing.length) throw new Error(`sw.js caches files the site doesn't have: ${missing.join(', ')}`);
  const h = createHash('sha256');
  for (const f of files) h.update(f).update(readFileSync(join(out, f)));
  const hash = h.digest('hex').slice(0, 10);
  writeFileSync(swPath, stampVersion(sw, hash));

  console.log(`Built ${out} (app version ${hash})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
