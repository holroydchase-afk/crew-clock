#!/usr/bin/env node
// ux-recheck: the planner behind the ux-reviewer's recheck step. After a fix merges the agent re-shoots the
// flows into a NEW run log; this compares it with the run that found the problems and decides which issues to
// close, reopen or leave. It never calls GitHub; the agent applies the plan. Convention: a finding that
// persists keeps its original id in the new run, and a fixed one is simply absent.
//
// Usage: node scripts/ux-recheck.mjs <before.md> <after.md> [--existing issues.json]
//   --existing   JSON array of the repo's issues: [{"title": "[UX-R1] ...", "state": "open"|"closed"}]
// Prints {close, reopen, keep, newFindings, errors} as JSON. Exit 0 when a plan is made; 1 when a run log is
// invalid (reasons on stderr, each prefixed with the file); 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkUxRun } from "./check-ux-run.mjs";

const USAGE = "usage: ux-recheck.mjs <before.md> <after.md> [--existing issues.json]";

export function planRecheck(before, after, opts = {}) {
  const { existing = [] } = opts;
  const out = { close: [], reopen: [], keep: [], newFindings: [], errors: [] };
  if (after.rechecked !== "yes") { out.errors.push("rechecked is not yes in the new run: a recheck run re-shoots the flows and says so"); return out; }
  if (before.product !== after.product) { out.errors.push(`product differs ("${before.product}" vs "${after.product}"): compare two runs of the same product`); return out; }
  const issueFor = (id) => existing.find((e) => e && String(e.title).includes(`[${id}]`));
  const now = new Map((after.findings || []).map((f) => [f.id, f]));
  const was = new Set((before.findings || []).map((f) => f.id));
  for (const f of before.findings || []) {
    const issue = issueFor(f.id), still = now.get(f.id);
    if (!still) {
      if (issue && issue.state === "open") out.close.push({ id: f.id, reason: `fixed: ${f.id} is gone from the ${after.date} re-shoot` });
    } else if (issue && issue.state === "closed") {
      out.reopen.push({ id: f.id, priority: still.priority, evidence: still.shots, reason: `still there in the ${after.date} re-shoot after the issue was closed` });
    } else out.keep.push({ id: f.id });
  }
  for (const f of after.findings || []) if (!was.has(f.id)) out.newFindings.push(f);
  return out;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  const files = []; let existingFile = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--existing") { existingFile = args[++i]; if (existingFile === undefined) usage(); }
    else if (a.startsWith("-")) usage();
    else files.push(a);
  }
  if (files.length !== 2) usage();
  const runs = [];
  for (const f of files) {
    let text;
    try { text = readFileSync(f, "utf8"); } catch { console.error(`can't read ${f}`); process.exit(2); }
    runs.push({ f, ...checkUxRun(text) });
  }
  let existing = [];
  if (existingFile) {
    try { existing = JSON.parse(readFileSync(existingFile, "utf8")); } catch { console.error(`can't read ${existingFile} as JSON`); process.exit(2); }
    if (!Array.isArray(existing) || existing.some((e) => !e || typeof e.title !== "string" || typeof e.state !== "string")) { console.error(`${existingFile} must be a JSON array of {title, state}`); process.exit(2); }
  }
  const bad = runs.filter((r) => r.errors.length || !r.run);
  if (bad.length) { for (const r of bad) for (const e of r.errors) console.error(`${r.f}: ${e}`); process.exit(1); }
  console.log(JSON.stringify(planRecheck(runs[0].run, runs[1].run, { existing }), null, 2));
}
