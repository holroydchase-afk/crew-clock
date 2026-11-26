// Copies only the phone app into dist/ for a static host (Cloudflare Pages), so the
// backend, migrations, tests and docs never go on the web. node scripts/build-site.mts
//
// It also:
// - fills config.js from environment variables when they are set (the host's dashboard),
//   so the real Supabase project doesn't have to be committed;
// - with --demo (the public GitHub Pages demo), ignores those variables and refuses to build
//   anything but demo mode, so a visitor can never reach the real crew's backend;
// - stamps the service worker VERSION with a hash of the app files, so phones always
//   pick up a new release even if nobody remembered to bump it;
// - always ships onPhoneAi: false (on-phone AI models are shelved), whatever the environment says.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const demoOnly = args.includes('--demo');
const out = resolve(root, args.find((a) => !a.startsWith('--')) || 'dist');

const COPY = ['index.html', 'config.js', 'manifest.webmanifest', 'sw.js', '_headers', 'css', 'js', 'vendor', 'icons', 'LICENSE', 'THIRD_PARTY_NOTICES.md'];

// config.js key <- environment variable
const ENV: Record<string, string> = {
  backend: 'CREW_BACKEND',
  supabaseUrl: 'SUPABASE_URL',
  supabaseAnonKey: 'SUPABASE_ANON_KEY',
  orgCode: 'ORG_CODE',
  vapidPublicKey: 'VAPID_PUBLIC_KEY',
  backendUrl: 'SHEETS_BACKEND_URL',
  sheetUrl: 'SHEET_URL',
};

export function fillConfig(src: string, env: Record<string, string | undefined>): string {
  let text = src;
  for (const [key, name] of Object.entries(ENV)) {
    const value = env[name];
    if (!value) continue;
    const re = new RegExp(`^(\\s*${key}:\\s*)'[^']*'`, 'm');
    if (!re.test(text)) throw new Error(`config.js has no ${key}: '...' line`);
    const quoted = `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
    text = text.replace(re, (_: string, head: string) => head + quoted);
  }
  return text;
}

// The public demo must never point at a real backend, whatever the config or environment says.
// On-phone AI models are shelved (Chase, 2026-11-23): both builds ship onPhoneAi false, no env var
// turns it on. Restoring it is a code change, reviewed like one.
export function shelveAi(src: string): string {
  const re = /^(\s*onPhoneAi:\s*)[^,\n]*/m;
  if (!re.test(src)) throw new Error('config.js has no onPhoneAi line');
  return src.replace(re, (_: string, head: string) => head + 'false');
}

export function assertDemo(config: string): void {
  const cfg = new Function('window', `${config}; return window.APP_CONFIG;`)({}) as Record<string, unknown>;
  const live = ['supabaseUrl', 'supabaseAnonKey', 'orgCode', 'vapidPublicKey', 'backendUrl', 'sheetUrl'].filter((k) => cfg[k]);
  if (cfg.backend !== 'demo' || live.length) {
    throw new Error(`--demo build has a live backend (backend: ${cfg.backend}${live.length ? `, ${live.join(', ')}` : ''})`);
  }
}

export function shellFiles(sw: string): string[] {
  const m = sw.match(/const SHELL_FILES = \[([\s\S]*?)\];/);
  if (!m) throw new Error('sw.js has no SHELL_FILES list');
  return [...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]);
}

export function stampVersion(sw: string, hash: string): string {
  const re = /const VERSION = '([^']*)';/;
  if (!re.test(sw)) throw new Error('sw.js has no VERSION line');
  return sw.replace(re, (_: string, v: string) => `const VERSION = '${v}-${hash}';`);
}

function build(): void {
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  // TS-2: js/*.ts (and js/globals.d.ts) are the source, not the site: only the emitted js/*.js ship.
  // PS-R1: TypeScript sources of any kind (.ts, .mts, .cts, .d.ts, .d.mts) never ship; plain .js does.
  const notTs = (src: string) => !/\.[cm]?ts$/.test(src);
  for (const p of COPY) cpSync(join(root, p), join(out, p), { recursive: true, filter: notTs });

  const configPath = join(out, 'config.js');
  const config = shelveAi(readFileSync(configPath, 'utf8'));
  if (demoOnly) assertDemo(config);
  writeFileSync(configPath, demoOnly ? config : fillConfig(config, process.env));

  const swPath = join(out, 'sw.js');
  const sw = readFileSync(swPath, 'utf8');
  const files = shellFiles(sw).filter((f) => f !== './');
  const missing = files.filter((f) => !existsSync(join(out, f)));
  if (missing.length) throw new Error(`sw.js caches files the site doesn't have: ${missing.join(', ')}`);
  const h = createHash('sha256').update(sw); // sw.js too, so a change to the worker itself gets a fresh cache
  for (const f of files) h.update(f).update(readFileSync(join(out, f)));
  const hash = h.digest('hex').slice(0, 10);
  writeFileSync(swPath, stampVersion(sw, hash));

  console.log(`Built ${out} (app version ${hash}${demoOnly ? ', demo only' : ''})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
