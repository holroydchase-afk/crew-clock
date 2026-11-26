// Studio standard (spec: docs/product/SPEC-STUDIO-STANDARD.md, SS-1..SS-15).
// File reads and local script runs only: no network, no clock. SS-16 and SS-17 are manual.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.join(import.meta.dirname, '..');
const exists = (p: string) => fs.existsSync(path.join(root, p));
const read = (p: string) => (exists(p) ? fs.readFileSync(path.join(root, p), 'utf8') : '');

// The text under a `## Heading` up to the next `## ` heading ('' when missing, so a test fails, not crashes).
function section(md: string, heading: string) {
  const lines = md.split('\n');
  const i = lines.findIndex((l) => l.trim() === heading);
  if (i < 0) return '';
  const out = [];
  for (let j = i + 1; j < lines.length; j++) {
    if (/^## /.test(lines[j])) break;
    out.push(lines[j]);
  }
  return out.join('\n');
}

// Bullet entries in a section: each `- ` line plus its indented continuation lines.
function bullets(text: string) {
  const out: (string|null)[] = [];
  for (const l of text.split('\n')) {
    if (/^- /.test(l)) out.push(l);
    else if (out.length && /^\s+\S/.test(l)) out[out.length - 1] += ' ' + l.trim();
    else if (out.length && l.trim() === '') out.push(null);
  }
  return (out.filter(Boolean) as string[]);
}

// Body rows of the markdown tables in a text (header and separator rows dropped), as cell arrays.
function tableRows(text: string) {
  const rows: string[][] = [];
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim();
    if (!l.startsWith('|')) continue;
    if (/^\|[\s:|-]+\|$/.test(l)) continue; // separator
    const next = (lines[i + 1] || '').trim();
    if (/^\|[\s:|-]+\|$/.test(next)) continue; // header (the row above a separator)
    rows.push(l.slice(1, -1).split('|').map((c) => c.trim()));
  }
  return rows;
}

const DATE = /\b(\d{4}-\d{2}-\d{2})\b/;

test('SS-1 CLAUDE.md has the self-check paragraph once, after Studio standard, and never "give Chase the fix"', () => {
  const md = read('CLAUDE.md');
  const start = 'Self-check before any ask:';
  const end = 'a copy box is the fallback.';
  const count = md.split(start).length - 1;
  assert.strictEqual(count, 1, `"${start}" appears ${count} times, want exactly 1`);
  const at = md.indexOf(start);
  const para = md.slice(at).split(/\n\s*\n/)[0];
  assert.ok(para.trimEnd().replace(/\*+$/, '').endsWith(end), `the self-check paragraph ends with "${end}"`);
  // Verbatim text from issue #46 (line wrapping in CLAUDE.md is allowed; words and punctuation are not).
  const want = 'Self-check before any ask: Chase never updates settings, environments or repos by hand. Before asking him to do anything, ask yourself: Can I do it myself? Can a thread or an MCP/tool do it so he only taps Allow (for example update_environment for allowed hosts)? Can it be a card with a button? If he must type, is it one code box to copy (one per paste, click path above it)? Only then ask, in the lightest form. If a host is blocked, request it via the environment tool; a copy box is the fallback.';
  assert.strictEqual(para.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(), want, 'self-check paragraph is verbatim from #46');
  const studio = md.search(/^\*\*Studio standard\.\*\*/m);
  const crew = md.indexOf('In this repo, `privacy-security`');
  assert.ok(studio >= 0, 'line starting **Studio standard.** present');
  assert.ok(crew >= 0, 'line starting In this repo, `privacy-security` present');
  assert.ok(studio < at && at < crew, 'self-check sits after **Studio standard.** and before the crew privacy-security line');
  const bad = md.split('\n').filter((l) => /give Chase the fix/i.test(l));
  assert.deepStrictEqual(bad, [], 'no line says "give Chase the fix"');
});

// The spec says 11 bullets, but CLAUDE.md at the start commit (5fe1626) has 13 and the intent is
// "kept, none dropped" (QA-R1). Pinned to 13 so no hard rule can be removed to satisfy a miscount.
test('SS-2 CLAUDE.md keeps all Hard rules bullets (13 at 5fe1626; spec miscounts 11, QA-R1)', () => {
  const rules = section(read('CLAUDE.md'), '## Hard rules (these win over any other instructions)');
  const items = rules.split('\n').filter((l) => /^- /.test(l));
  assert.strictEqual(items.length, 13, `Hard rules has ${items.length} bullets, want 13 (none dropped)`);
  const flat = rules.replace(/\s+/g, ' ');
  assert.ok(flat.includes('Never touch the real Supabase, Backblaze or Resend accounts.'));
  assert.ok(flat.includes('merge to `main`'));
});

test('SS-3 CLAUDE.md Studio agents table has 9 rows with the story-keeper row verbatim', () => {
  const md = read('CLAUDE.md');
  const s = section(md, '## Studio agents (use them by default; don\'t wait to be asked)');
  assert.ok(s, 'Studio agents section present');
  const rows = tableRows(s);
  assert.strictEqual(rows.length, 9, `Studio agents table has ${rows.length} rows, want 9`);
  const row = '| End of any turn where Chase made a call, a plan changed or a lesson was learned (runs in the background) | `story-keeper` |';
  assert.ok(s.split('\n').some((l) => l.trim() === row), 'story-keeper row verbatim');
});

test('SS-4 CLAUDE.md Read first links docs/product/NOTES.md and docs/architecture/README.md, and both exist', () => {
  const md = read('CLAUDE.md');
  const at = md.search(/^Read first:/m);
  assert.ok(at >= 0, 'Read first: line present');
  const para = md.slice(at).split(/\n\s*\n/)[0];
  for (const p of ['docs/product/NOTES.md', 'docs/architecture/README.md']) {
    assert.ok(para.includes('](' + p + ')'), `Read first links ${p}`);
    assert.ok(exists(p), `${p} exists`);
  }
});

const NOTES = 'docs/product/NOTES.md';

test('SS-5 NOTES.md has Decisions, Lessons, Accounts, Marketing claims register in that order', () => {
  const lines = read(NOTES).split('\n').map((l) => l.trim());
  const want = ['## Decisions', '## Lessons', '## Accounts', '## Marketing claims register'];
  const at = want.map((h) => lines.indexOf(h));
  want.forEach((h, i) => assert.ok(at[i] >= 0, `${h} present`));
  for (let i = 1; i < at.length; i++) assert.ok(at[i - 1] < at[i], `${want[i - 1]} comes before ${want[i]}`);
});

test('SS-6 NOTES Decisions has >= 10 entries CRW-DEC-1..n, no gap or repeat, each dated with Why: and Beat:', () => {
  const entries = bullets(section(read(NOTES), '## Decisions')).filter((e) => /CRW-DEC-\d+/.test(e));
  assert.ok(entries.length >= 10, `${entries.length} decision entries, want >= 10`);
  const ids = entries.map((e) => Number(((e.match(/CRW-DEC-(\d+)/)) as RegExpMatchArray)[1]));
  const sorted = [...ids].sort((a, b) => a - b);
  assert.deepStrictEqual(sorted, sorted.map((_, i) => i + 1), 'IDs run 1..n with no gap or repeat');
  for (const e of entries) {
    const id = (e.match(/CRW-DEC-\d+/) as RegExpMatchArray)[0];
    assert.match(e, DATE, `${id} has a YYYY-MM-DD date`);
    assert.ok(e.includes('Why:'), `${id} has Why:`);
    assert.ok(e.includes('Beat:'), `${id} has Beat:`);
  }
});

test('SS-7 NOTES Lessons has >= 5 entries newest first, the SW and ubuntu-24.04 lessons, each with Rule:', () => {
  const entries = bullets(section(read(NOTES), '## Lessons'));
  assert.ok(entries.length >= 5, `${entries.length} lessons, want >= 5`);
  const dates = entries.map((e) => (e.match(DATE) || [])[1]);
  dates.forEach((d, i) => assert.ok(d, `lesson ${i + 1} has a YYYY-MM-DD date`));
  for (let i = 1; i < dates.length; i++) assert.ok(dates[i] <= dates[i - 1], `lesson ${i + 1} (${dates[i]}) is newer than the one above (${dates[i - 1]}), want newest first`);
  assert.ok(entries.some((e) => e.includes('2026-10-28') && /service worker/i.test(e)), 'a 2026-10-28 service worker lesson');
  assert.ok(entries.some((e) => e.includes('ubuntu-24.04')), 'an ubuntu-24.04 lesson');
  entries.forEach((e, i) => assert.ok(e.includes('Rule:'), `lesson ${i + 1} has Rule:`));
});

test('SS-8 NOTES Accounts names the 7 account types, each with Rename cost:', () => {
  const rows = tableRows(section(read(NOTES), '## Accounts'));
  for (const name of ['Supabase', 'Backblaze', 'Resend', 'GitHub Pages', 'Cloudflare Pages', 'Google', 'registrar']) {
    const row = rows.find((r) => r[0].includes(name));
    assert.ok(row, `Accounts names ${name}`);
    assert.ok(row.join(' | ').includes('Rename cost:'), `${name} row has Rename cost:`);
  }
});

test('SS-9 NOTES Marketing is owned by positioning and every claim proof path exists (>= 5 claims)', () => {
  const s = section(read(NOTES), '## Marketing claims register');
  const first = s.trim().split(/\n\s*\n/)[0] || '';
  assert.match(first, /positioning/, 'first paragraph names positioning as owner');
  const rows = tableRows(s);
  assert.ok(rows.length >= 5, `${rows.length} claims, want >= 5`);
  const missing = [];
  for (const r of rows) {
    const proof = (r[r.length - 1].match(/`([^`]+)`/) || [])[1];
    if (!proof || !exists(proof)) missing.push(`${r[0]}: ${proof || '(no proof path)'}`);
  }
  assert.deepStrictEqual(missing, [], 'every claim proof path exists');
});

const ARCH = 'docs/architecture/README.md';

function migrationTables() {
  const dir = path.join(root, 'supabase/migrations');
  const names = new Set<string>();
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = fs.readFileSync(path.join(dir, f), 'utf8');
    for (const m of sql.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?([\w."]+)/gi)) {
      const n = m[1].replace(/"/g, '').toLowerCase();
      names.add(n.startsWith('public.') ? n.slice(7) : n);
    }
  }
  return [...names];
}

test('SS-10 architecture map links ../PRIVACY.md as the contract and names every migration table', () => {
  const md = read(ARCH);
  assert.ok(md, `${ARCH} exists`);
  assert.match(md.replace(/\s+/g, ' '), /contract[^\n]{0,40}\]\(\.\.\/PRIVACY\.md\)/i, 'links ../PRIVACY.md as the contract');
  const tables = migrationTables();
  assert.ok(tables.length > 0, 'parsed tables from supabase/migrations');
  const missing = [...tables, 'cc.team', 'cc.consents', 'crewclock-chat', 'outbox'].filter((t) => !md.includes(t));
  assert.deepStrictEqual(missing, [], 'every table and phone store is named');
});

test('SS-11 architecture map retention matches PRIVACY (90 days, 60 days, 3 years, 30 days, For good)', () => {
  const rows = tableRows(read(ARCH));
  const privacy = read('docs/PRIVACY.md');
  const want: Array<[RegExp, string[]]> = [
    [/raw gps/i, ['90 days']],
    [/pictures/i, ['60 days']],
    [/^hours/i, ['3 years']],
    [/chat ciphertext/i, ['30 days']],
    [/consent records/i, ['For good']], // spec: `For good`/`never deleted`, read as either; the map says both
  ];
  for (const [what, words] of want) {
    const hits = rows.filter((r) => what.test(r[0]));
    assert.ok(hits.length, `map has a row for ${what}`);
    for (const w of words) {
      assert.ok(hits.some((r) => r.join(' | ').toLowerCase().includes(w.toLowerCase())), `${what} row says ${w}`);
    }
    const pRow = privacy.split('\n').find((l) => l.startsWith('|') && what.test(l.split('|')[1].trim()));
    assert.ok(pRow && pRow.toLowerCase().includes(words[0].toLowerCase()), `PRIVACY agrees: ${what} ${words[0]}`);
  }
});

test('SS-12 NOTES.md and the architecture map carry no email, link, project ref or storage host', () => {
  const bad = [
    /[\w.+-]+@[\w-]+\.\w+/,
    /https?:\/\//,
    /supabase\.co/,
    /\b[a-z]{20}\b/,
    /backblazeb2\.com/,
  ];
  for (const f of [NOTES, ARCH]) {
    const md = read(f);
    assert.ok(md, `${f} exists`);
    for (const re of bad) assert.doesNotMatch(md, re, `${f} matches ${re}`);
  }
});

test('SS-13 synced studio files exist, agents-check names both checks, check-agents.sh exits 0', () => {
  for (const p of ['scripts/check-findings.mjs', 'scripts/ux-rules.mjs', '.claude/design-rules.md']) assert.ok(exists(p), `${p} exists`);
  const y = read('.github/workflows/agents-check.yml');
  assert.match(y, /scripts\/check-agents\.sh/);
  assert.match(y, /scripts\/check-agent-runs\.sh/);
  const r = spawnSync('bash', ['scripts/check-agents.sh'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0, r.stdout + r.stderr);
});

test('SS-14 .claude/agents files carry no product facts (Crew Clock, CRW-)', () => {
  const dir = path.join(root, '.claude/agents');
  const hits = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
    .filter((f) => /Crew Clock|CRW-/.test(fs.readFileSync(path.join(dir, f), 'utf8')));
  assert.deepStrictEqual(hits, [], 'agent files mention Crew Clock or CRW-');
});

test('SS-15 HANDOFF status header in lines 1-15, check-handoff-status.sh 0 warnings, one Done entry names #39 #40 #46', () => {
  const md = read('HANDOFF.md');
  const head = md.split('\n').slice(0, 15);
  const open = head.findIndex((l) => /^\s*<!-- status/.test(l));
  const close = head.findIndex((l, i) => i > open && /^\s*-->/.test(l));
  assert.ok(open >= 0 && close > open, '<!-- status ... --> within lines 1-15');
  const block = head.slice(open + 1, close).join('\n');
  for (const k of ['stage', 'goal', 'milestone', 'now', 'next', 'waiting_on_chase', 'blockers']) {
    assert.match(block, new RegExp('^\\s*' + k + ':', 'm'), `status key ${k}`);
  }
  const r = spawnSync('bash', ['scripts/check-handoff-status.sh', 'HANDOFF.md'], { cwd: root, encoding: 'utf8' });
  assert.strictEqual(r.status, 0);
  assert.doesNotMatch(r.stdout + r.stderr, /::warning/, 'check-handoff-status.sh warnings');
  const done = bullets(section(md, '## Done')).filter((e) => e.includes('#39') && e.includes('#40') && e.includes('#46'));
  assert.strictEqual(done.length, 1, `${done.length} Done entries name #39, #40 and #46, want 1`);
});
