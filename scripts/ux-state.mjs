#!/usr/bin/env node
// ux-state: the state the ux-reviewer keeps between runs, one JSON file in the product repo
// (docs/design/ux-state.json). Each run log is recorded into it: which findings are open, which were fixed
// (absent from a rechecked run), which came back. recordRun is pure; the CLI only reads and writes the file.
//
// Usage: node scripts/ux-state.mjs record <run.md> --state <state.json> [--issues issues.json]
//        node scripts/ux-state.mjs show --state <state.json>
//   --issues   JSON object of finding id to issue number, e.g. {"UX-R1": 42}
// record: exit 0 and one summary line; 1 when the run log is invalid (reasons on stderr, nothing written).
// show: prints the open findings. Exit 2 on a usage error or an unreadable file.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { checkUxRun } from "./check-ux-run.mjs";

const USAGE = "usage: ux-state.mjs record <run.md> --state <state.json> [--issues issues.json] | show --state <state.json>";

// Returns a new state; neither input is changed.
export function recordRun(state, run, opts = {}) {
  const { issues = {} } = opts;
  const prev = state && typeof state === "object" ? state : {};
  if (prev.product && prev.product !== run.product) throw new Error(`product differs ("${prev.product}" vs "${run.product}"): keep one state file per product`);
  const findings = JSON.parse(JSON.stringify(prev.findings || {}));
  const seen = new Set();
  for (const f of run.findings || []) {
    seen.add(f.id);
    const old = findings[f.id];
    const next = { priority: f.priority, rule: f.rule, title: f.problem || `${f.rule} rule broken (${f.priority})`,
      firstSeen: old ? old.firstSeen : run.date, lastSeen: run.date, status: "open" };
    if (old && old.reopened) next.reopened = true;
    if (old && old.status === "fixed") next.reopened = true;
    if (old && old.issue !== undefined) next.issue = old.issue;
    if (issues[f.id] !== undefined) next.issue = issues[f.id];
    findings[f.id] = next;
  }
  if (run.rechecked === "yes") {
    for (const [id, f] of Object.entries(findings)) {
      if (!seen.has(id) && f.status === "open") findings[id] = { ...f, status: "fixed", fixedOn: run.date };
    }
  }
  const entry = { date: run.date, score: run.score ?? null, verdict: run.verdict, tier: run.tier, rechecked: run.rechecked, findingIds: (run.findings || []).map((f) => f.id) };
  const runs = (prev.runs || []).filter((r) => r.date !== run.date);
  runs.push(entry);
  runs.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...prev, product: run.product, runs, findings };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  const cmd = args.shift();
  if (cmd === "-h" || cmd === "--help") { console.log(USAGE); process.exit(0); }
  if (cmd !== "record" && cmd !== "show") usage();
  let file = null, stateFile = null, issuesFile = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--state") { stateFile = args[++i]; if (stateFile === undefined) usage(); }
    else if (a === "--issues") { issuesFile = args[++i]; if (issuesFile === undefined) usage(); }
    else if (a.startsWith("-") || file || cmd === "show") usage();
    else file = a;
  }
  if (!stateFile || (cmd === "record" && !file)) usage();
  const readJson = (f) => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { console.error(`can't read ${f} as JSON`); process.exit(2); } };
  if (cmd === "show") {
    const s = readJson(stateFile);
    const open = Object.entries(s.findings || {}).filter(([, f]) => f.status === "open");
    console.log(`${s.product || "(no product)"}: ${open.length} open finding${open.length === 1 ? "" : "s"}`);
    for (const [id, f] of open) console.log(`${id} ${f.priority} ${f.rule} ${f.title}${f.issue !== undefined ? ` (#${f.issue})` : ""}${f.reopened ? " [reopened]" : ""}`);
  } else {
    let text, prev = null, issues = {};
    try { text = readFileSync(file, "utf8"); } catch { console.error(`can't read ${file}`); process.exit(2); }
    try { prev = JSON.parse(readFileSync(stateFile, "utf8")); } catch (e) { if (e.code !== "ENOENT") { console.error(`can't read ${stateFile} as JSON`); process.exit(2); } }
    if (issuesFile) issues = readJson(issuesFile);
    const { run, errors } = checkUxRun(text);
    if (errors.length || !run) { for (const e of errors) console.error(`${file}: ${e}`); process.exit(1); }
    let next;
    try { next = recordRun(prev, run, { issues }); } catch (e) { console.error(e.message); process.exit(1); }
    mkdirSync(dirname(resolve(stateFile)), { recursive: true });
    writeFileSync(stateFile, JSON.stringify(next, null, 2) + "\n");
    const open = Object.values(next.findings).filter((f) => f.status === "open").length;
    console.log(`recorded ${run.date} for ${run.product}: ${run.findings.length} in this run, ${open} open in all`);
  }
}
