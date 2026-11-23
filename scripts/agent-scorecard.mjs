#!/usr/bin/env node
// agent-scorecard: a per-agent scorecard (qa-tdd, staff-pm) from two sources, one section per agent, never mixed.
//   evals  evals/agent-misses/runs/*/results.json  (rows: case, arm agent|plain|cross, pass, optional by)
//   logged docs/runs/*.md ```agentrun blocks, validated with checkAgentRun (an invalid log is skipped, not counted)
// A row belongs to the agent named in `by` when present (cross rows), else the agent named by the case prefix.
// Rates are always "n of m", never a bare percent. Cost is "not measured" unless a run shows tokens or cost above 0.
// Lift is listed only for a heldout run that has both an agent and a plain arm over the SAME set of case names
// (plain-arm names must equal agent-arm names, per agent); a dev run never counts as lift.
// Local report only: nothing here is published.
// Usage: node tools/agent-scorecard.mjs [--root dir] [--agent qa-tdd|staff-pm] [--json]
// Exit 0 with the report; 2 on a usage error.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { checkAgentRun } from "./check-agent-run.mjs";

const USAGE = "usage: agent-scorecard.mjs [--root dir] [--agent qa-tdd|staff-pm] [--json]";
const AGENTS = ["qa-tdd", "staff-pm"];
const ARMS = ["agent", "plain", "cross"];

const rate = (s) => `${s.passed} of ${s.total}`;

export function buildScorecard(root) {
  const out = Object.fromEntries(AGENTS.map((a) => [a, { eval: [], logged: { runs: 0, escalated: 0, findings: 0, p0: 0, cost_measured: false, cost_usd: null, cost_runs: 0 }, lift: "not measured" }]));
  const cases = {}; // agent -> run -> arm -> Set of case names
  const runsDir = join(root, "evals", "agent-misses", "runs");
  const lifts = [];
  if (existsSync(runsDir)) {
    for (const id of readdirSync(runsDir).sort()) {
      const p = join(runsDir, id, "results.json");
      if (!existsSync(p)) continue;
      let j;
      try { j = JSON.parse(readFileSync(p, "utf8")); } catch { continue; }
      const agg = {};
      for (const r of Array.isArray(j.results) ? j.results : []) {
        const agent = r.by || AGENTS.find((a) => String(r.case).startsWith(`${a}-`));
        if (!AGENTS.includes(agent) || !ARMS.includes(r.arm)) continue;
        const k = `${agent}|${r.arm}`;
        const s = (agg[k] ||= { agent, arm: r.arm, passed: 0, total: 0, names: new Set() });
        s.total++; if (r.pass === true) s.passed++; s.names.add(r.case);
      }
      for (const s of Object.values(agg)) {
        out[s.agent].eval.push({ run: j.run || id, date: j.date || null, phase: j.phase || null, arm: s.arm, passed: s.passed, total: s.total });
        ((cases[s.agent] ||= {})[j.run || id] ||= {})[s.arm] = s.names;
      }
      if (j.phase === "heldout") for (const a of AGENTS) {
        const c = cases[a]?.[j.run || id];
        if (c?.agent && c?.plain && c.agent.size === c.plain.size && [...c.agent].every((n) => c.plain.has(n))) {
          const g = (arm) => out[a].eval.find((e) => e.run === (j.run || id) && e.arm === arm);
          lifts.push([a, { run: j.run || id, agent: { passed: g("agent").passed, total: g("agent").total }, plain: { passed: g("plain").passed, total: g("plain").total } }]);
        }
      }
    }
  }
  for (const [a, l] of lifts) out[a].lift = l; // latest qualifying run wins
  const logs = join(root, "docs", "runs");
  if (existsSync(logs)) {
    for (const f of readdirSync(logs).filter((n) => n.endsWith(".md")).sort()) {
      const { run, errors } = checkAgentRun(readFileSync(join(logs, f), "utf8"));
      if (!run || errors.length || !AGENTS.includes(run.agent)) continue;
      const l = out[run.agent].logged;
      l.runs++; l.findings += run.findings; l.p0 += run.p0;
      if (run.escalated === "yes") l.escalated++;
      if (run.tokens > 0 || run.cost_usd > 0) { l.cost_measured = true; l.cost_runs++; l.cost_usd = Math.round(((l.cost_usd || 0) + run.cost_usd) * 1e6) / 1e6; }
    }
  }
  return out;
}

export function renderScorecard(card, agents = AGENTS) {
  const lines = ["# Agent scorecard", "", "Local report. A dev score is not a quality claim: dev runs are what the agent files were tuned on. Only heldout scores count, and rates are \"n of m\".", ""];
  for (const a of agents) {
    const c = card[a], l = c.logged;
    lines.push(`## ${a}`, "");
    if (!c.eval.length) lines.push("eval: no eval runs");
    for (const e of c.eval) lines.push(`eval ${e.run} (${e.phase || "unknown phase"}, ${e.arm} arm): ${rate(e)}`);
    lines.push(c.lift === "not measured" ? "lift: not measured" : `lift (${c.lift.run}, heldout): agent arm ${rate(c.lift.agent)}, plain arm ${rate(c.lift.plain)}`);
    if (!l.runs) lines.push("no logged runs");
    else {
      lines.push(`logged runs: ${l.runs}`, `escalated: ${l.escalated}`, `findings: ${l.findings}, p0: ${l.p0}`);
    }
    lines.push(l.cost_measured ? `cost: ${l.cost_usd} dollars across ${l.cost_runs} of ${l.runs} runs` : "cost: not measured", "");
    lines.push("Claims allowed:");
    const held = c.eval.filter((e) => e.phase === "heldout");
    if (!held.length) lines.push("- no heldout score yet");
    for (const e of held) lines.push(`- ${e.run} (heldout, ${e.arm} arm): ${rate(e)}`);
    if (l.runs) lines.push(`- logged runs: ${l.runs}`);
    lines.push("");
  }
  return lines.join("\n");
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const fail = () => { console.error(USAGE); process.exit(2); };
  let root = resolve(dirname(fileURLToPath(import.meta.url)), ".."), agent = null, json = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--json") json = true;
    else if (a === "--root" || a === "--agent") {
      const v = args[++i];
      if (v === undefined || v.startsWith("-")) fail();
      if (a === "--root") root = resolve(v); else if (AGENTS.includes(v)) agent = v; else fail();
    } else fail();
  }
  const card = buildScorecard(root);
  const sel = agent ? [agent] : AGENTS;
  if (json) console.log(JSON.stringify(Object.fromEntries(sel.map((a) => [a, card[a]])), null, 2));
  else console.log(renderScorecard(card, sel));
}
