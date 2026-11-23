#!/usr/bin/env node
// ux-search: keyword search over the ux-reviewer's memory: the design rules, the findings in past run logs
// and the findings in the state file. Used before filing, to see whether a problem is already known. No
// embeddings and no network: lowercase words, rarer words weigh more, a query word equal to a tag (a finding
// id or rule id) adds a bonus. similarity() is the Jaccard overlap the issue planner uses to spot near-duplicates.
//
// Usage: node scripts/ux-search.mjs <query words> [--root dir] [--state state.json] [--limit N] [--json]
//   --root    product repo root (default: current folder); reads docs/design-rules.md and runs/*.md
//   --state   state file (default: <root>/docs/design/ux-state.json when it exists)
// Exit 0 with ranked results; 2 on a usage error.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { checkUxRun } from "./check-ux-run.mjs";

const USAGE = "usage: ux-search.mjs <query words> [--root dir] [--state state.json] [--limit N] [--json]";
const STOP = new Set(["the", "and", "are", "was", "were", "for", "with", "that", "this", "has", "have", "not", "but", "too", "its", "from", "into", "than", "then", "when", "you", "can", "all", "any"]);
const TAG_BONUS = 2;

export function tokenize(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9]+/)
    .map((w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w))
    .filter((w) => w.length >= 3 && !STOP.has(w));
}

export function similarity(a, b) {
  const x = new Set(tokenize(a)), y = new Set(tokenize(b));
  if (!x.size || !y.size) return 0;
  let both = 0;
  for (const w of x) if (y.has(w)) both++;
  return both / (x.size + y.size - both);
}

export function search(query, docs, opts = {}) {
  const { limit = 5 } = opts;
  const q = [...new Set(tokenize(query))];
  const raw = new Set(String(query || "").toLowerCase().split(/[\s,]+/).filter(Boolean));
  if (!q.length && !raw.size) return [];
  const sets = docs.map((d) => new Set(tokenize(d.text)));
  const idf = (w) => Math.log(1 + docs.length / (1 + sets.filter((s) => s.has(w)).length));
  const scored = [];
  docs.forEach((d, i) => {
    let score = 0;
    for (const w of q) if (sets[i].has(w)) score += idf(w);
    for (const t of d.tags || []) if (raw.has(String(t).toLowerCase())) score += TAG_BONUS;
    if (score > 0) scored.push({ id: d.id, source: d.source, score: Math.round(score * 1000) / 1000, snippet: d.text.length > 120 ? `${d.text.slice(0, 119)}…` : d.text, i });
  });
  scored.sort((a, b) => b.score - a.score || a.i - b.i);
  return scored.slice(0, limit).map(({ i, ...r }) => r);
}

// Reads <root>/docs/design-rules.md (one doc per heading), <root>/runs/*.md (one per finding) and an optional state file.
export function loadDocs(root, opts = {}) {
  const docs = [];
  const rules = join(root, "docs", "design-rules.md");
  if (existsSync(rules)) {
    let cur = null;
    const push = () => { if (cur && cur.text.trim()) docs.push({ id: cur.id, source: "rule", text: cur.text.trim(), tags: [] }); };
    for (const l of readFileSync(rules, "utf8").split(/\r?\n/)) {
      const h = /^#{1,6}\s+(.*)$/.exec(l);
      if (h) { push(); cur = { id: h[1].trim(), text: `${h[1].trim()}\n` }; }
      else if (cur) cur.text += `${l}\n`;
    }
    push();
  }
  const runs = join(root, "runs");
  if (existsSync(runs)) {
    for (const f of readdirSync(runs).filter((n) => n.endsWith(".md")).sort()) {
      const { run } = checkUxRun(readFileSync(join(runs, f), "utf8"));
      if (!run) continue;
      for (const x of run.findings) docs.push({ id: `${f}#${x.id}`, source: "finding", text: [x.problem, x.fix].filter(Boolean).join(". ") || `${x.rule} rule broken`, tags: [x.id, x.rule] });
    }
  }
  if (opts.state && existsSync(opts.state)) {
    try {
      const s = JSON.parse(readFileSync(opts.state, "utf8"));
      for (const [id, x] of Object.entries(s.findings || {})) docs.push({ id, source: "state", text: `${x.title} (${x.status})`, tags: [id, x.rule].filter(Boolean) });
    } catch { /* an unreadable state file adds nothing */ }
  }
  return docs;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  const words = []; let root = process.cwd(), state = null, limit = 5, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--json") json = true;
    else if (a === "--root") { root = args[++i]; if (root === undefined) usage(); }
    else if (a === "--state") { state = args[++i]; if (state === undefined) usage(); }
    else if (a === "--limit") { const v = args[++i]; if (v === undefined || !/^[1-9]\d*$/.test(v)) usage(); limit = Number(v); }
    else if (a.startsWith("-")) usage();
    else words.push(a);
  }
  if (!words.length) usage();
  if (!state) state = join(root, "docs", "design", "ux-state.json");
  const results = search(words.join(" "), loadDocs(root, { state }), { limit });
  if (json) console.log(JSON.stringify(results, null, 2));
  else if (!results.length) console.log("no matches");
  else for (const r of results) console.log(`${r.score}  ${r.source}  ${r.id}  ${r.snippet.replace(/\s+/g, " ")}`);
}
