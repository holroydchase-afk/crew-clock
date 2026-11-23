#!/usr/bin/env node
// ux-issues: the planner behind the ux-reviewer's "file issues" step. It reads a validated run log and
// decides which findings become issues on the product repo; it never calls GitHub. The agent files the
// planned issues through its GitHub tool. Slow on purpose (GitHub suspended the account once for automation
// volume): P0 and P1 only, at most --max a run (default 3), nothing already open, and nothing at all while the
// agent is at the Advisory tier unless --allow-advisory says Chase turned it on (docs/ux-agent-bar.md).
//
// Usage: node scripts/ux-issues.mjs <run.md> [--existing issues.json] [--max N] [--allow-advisory]
//   --existing   JSON array of the repo's issues: [{"title": "...", "state": "open"|"closed"}]
// Prints {issues, skipped, errors} as JSON. Exit 0 when a plan is made; 1 when the run log is invalid
// (reasons on stderr); 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkUxRun } from "./check-ux-run.mjs";
import { similarity } from "./ux-search.mjs";

const USAGE = "usage: ux-issues.mjs <run.md> [--existing issues.json] [--max N] [--allow-advisory]";
const MAX_TITLE = 120;
const DUP_SIMILARITY = 0.6;

export function renderBody(f, run) {
  const lines = [
    `**${f.id}** · ${f.priority} · rule ${f.rule}`,
    "",
    `Product: ${run.product}`,
    `Found in the ux-reviewer run of ${run.date}.`,
    `Evidence: \`${f.shots}\``,
  ];
  if (f.problem) lines.push("", `**Problem:** ${f.problem}`);
  if (f.fix) lines.push("", `**Fix:** ${f.fix}`);
  lines.push("", "_Filed by the studio ux-reviewer. When a fix merges, it re-shoots the same flow and closes this issue or reopens it with the new shot._");
  return lines.join("\n");
}

const titleFor = (f) => {
  const t = `[${f.id}] ${f.problem || `${f.rule} rule broken (${f.priority})`}`;
  return t.length > MAX_TITLE ? `${t.slice(0, MAX_TITLE - 1)}…` : t;
};

export function planIssues(run, opts = {}) {
  const { existing = [], max = 3, allowAdvisory = false } = opts;
  const out = { issues: [], skipped: [], errors: [] };
  if (run.tier === "advisory" && !allowAdvisory) {
    out.errors.push("tier is advisory: the agent reports only and files no issues until it is promoted or Chase passes --allow-advisory");
    return out;
  }
  const open = existing.filter((e) => e && e.state === "open").map((e) => String(e.title));
  const rank = { P0: 0, P1: 1 };
  const candidates = [];
  for (const f of run.findings || []) {
    if (!(f.priority in rank)) { out.skipped.push({ id: f.id, reason: `${f.priority} findings stay in the review, not the issue list` }); continue; }
    if (open.some((t) => t.includes(`[${f.id}]`))) { out.skipped.push({ id: f.id, reason: "duplicate: an open issue already has this id" }); continue; }
    const near = f.problem && open.find((t) => similarity(f.problem, t.replace(/^\s*\[[^\]]*\]\s*/, "")) >= DUP_SIMILARITY);
    if (near) { out.skipped.push({ id: f.id, reason: `possible duplicate of: ${near}` }); continue; }
    candidates.push(f);
  }
  candidates.sort((a, b) => rank[a.priority] - rank[b.priority]);
  candidates.forEach((f, i) => {
    if (i >= max) { out.skipped.push({ id: f.id, reason: `cap: at most ${max} issues a run` }); return; }
    out.issues.push({ id: f.id, title: titleFor(f), body: renderBody(f, run), labels: ["ux", f.priority.toLowerCase()] });
  });
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  let file = null, existingFile = null, max = 3, allow = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--allow-advisory") allow = true;
    else if (a === "--existing") { existingFile = args[++i]; if (existingFile === undefined) usage(); }
    else if (a === "--max") { const v = args[++i]; if (v === undefined || !/^[1-9]\d*$/.test(v)) usage(); max = Number(v); }
    else if (a.startsWith("-") || file) usage();
    else file = a;
  }
  if (!file) usage();
  let text, existing = [];
  try { text = readFileSync(file, "utf8"); } catch { console.error(`can't read ${file}`); process.exit(2); }
  if (existingFile) {
    try { existing = JSON.parse(readFileSync(existingFile, "utf8")); } catch { console.error(`can't read ${existingFile} as JSON`); process.exit(2); }
    if (!Array.isArray(existing)) { console.error(`${existingFile} must be a JSON array`); process.exit(2); }
  }
  const { run, errors } = checkUxRun(text);
  if (errors.length || !run) { for (const e of errors) console.error(e); process.exit(1); }
  console.log(JSON.stringify(planIssues(run, { existing, max, allowAdvisory: allow }), null, 2));
}
