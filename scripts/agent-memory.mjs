#!/usr/bin/env node
// agent-memory: keyword and tag search over qa-tdd's and staff-pm's memory, plus dedupe() for "is this finding
// already known". Two sources, no embeddings, no network. Reuses search/tokenize/similarity from ux-search.mjs.
//   run   one doc per finding line in docs/runs/*.md, id "<file>#<finding id>", tags [finding id, agent]
//   miss  one doc per past eval miss: plugins/studio/evals/<case>/graders/criteria.md (front matter dropped),
//         id = the case folder name (so its prefix names the agent: qa-tdd-miss-..., staff-pm-miss-...)
//
// Finding lines convention: the ```agentrun block only holds a findings COUNT, so the ids and text come from
// lines in the run-log body OUTSIDE the block, in the qa / PM report shape:
//   QA-R<n> | P<n> | where | problem | failing test path or none      (qa-tdd)
//   PM-R<n> | P<n> | where | problem | ...                             (staff-pm)
// The text indexed is everything after the priority. A log with a missing or invalid agentrun block (checked with
// check-agent-run) is skipped entirely, its finding lines are not indexed. The run's agent: field sets the agent.
//
// Usage: node scripts/agent-memory.mjs <query words> [--root dir] [--agent qa-tdd|staff-pm] [--limit N] [--json]
// Exit 0 with ranked results (or "no matches"); 2 on a usage error.
// Needs ux-search.mjs and check-agent-run.mjs (and its check-story-entry.mjs) beside it.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { search, similarity } from "./ux-search.mjs";
import { checkAgentRun } from "./check-agent-run.mjs";

const USAGE = "usage: agent-memory.mjs <query words> [--root dir] [--agent qa-tdd|staff-pm] [--limit N] [--json]";
const AGENTS = ["qa-tdd", "staff-pm"];
const FINDING = /^((?:QA|PM)-R\d+)\s*\|\s*(P\d)\s*\|\s*(.*\S)\s*$/;
const DEDUPE_AT = 0.5; // inclusive: a doc at exactly the threshold counts as a duplicate

export function loadMemory(root) {
  const docs = [];
  const runs = join(root, "docs", "runs");
  if (existsSync(runs)) {
    for (const f of readdirSync(runs).filter((n) => n.endsWith(".md")).sort()) {
      const text = readFileSync(join(runs, f), "utf8");
      const { run, errors } = checkAgentRun(text);
      if (!run || errors.length || !AGENTS.includes(run.agent)) continue;
      let inBlock = false;
      for (const l of text.split(/\r?\n/)) {
        if (/^```agentrun[ \t]*$/.test(l)) { inBlock = true; continue; }
        if (inBlock) { if (/^```[ \t]*$/.test(l)) inBlock = false; continue; }
        const m = FINDING.exec(l);
        if (m) docs.push({ id: `${f}#${m[1]}`, source: "run", text: m[3], tags: [m[1], run.agent], agent: run.agent });
      }
    }
  }
  const evals = join(root, "plugins", "studio", "evals");
  if (existsSync(evals)) {
    for (const c of readdirSync(evals).sort()) {
      const p = join(evals, c, "graders", "criteria.md");
      if (!existsSync(p)) continue;
      const body = readFileSync(p, "utf8").replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "").trim();
      if (body) docs.push({ id: c, source: "miss", text: body, tags: [], agent: AGENTS.find((a) => c.startsWith(`${a}-`)) || null });
    }
  }
  return docs;
}

// The doc most similar to `text` at or above the threshold, or null.
export function dedupe(text, docs, threshold = DEDUPE_AT) {
  let best = null, top = 0;
  for (const d of docs) {
    const s = similarity(text, d.text);
    if (s >= threshold && s > top) { best = d; top = s; }
  }
  return best;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  const words = []; let root = process.cwd(), agent = null, limit = 5, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--json") json = true;
    else if (a === "--root") { root = args[++i]; if (root === undefined) usage(); }
    else if (a === "--agent") { agent = args[++i]; if (!AGENTS.includes(agent)) usage(); }
    else if (a === "--limit") { const v = args[++i]; if (v === undefined || !/^[1-9]\d*$/.test(v)) usage(); limit = Number(v); }
    else if (a.startsWith("-")) usage();
    else words.push(a);
  }
  if (!words.length) usage();
  let docs = loadMemory(root);
  if (agent) docs = docs.filter((d) => d.agent === agent);
  const results = search(words.join(" "), docs, { limit });
  if (json) console.log(JSON.stringify(results, null, 2));
  else if (!results.length) console.log("no matches");
  else for (const r of results) console.log(`${r.score}  ${r.source}  ${r.id}  ${r.snippet.replace(/\s+/g, " ")}`);
}
