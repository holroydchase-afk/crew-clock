#!/usr/bin/env node
// Scores a miss-eval run recorded by hand from subagent transcripts (no API key needed).
//   node tools/eval-miss-score.mjs <run-dir>          write <run-dir>/results.md from <run-dir>/results.json
//   node tools/eval-miss-score.mjs --check <run-dir>  exit 1 if results.md is stale or results.json breaks a rule
//   node tools/eval-miss-score.mjs --check-all        --check for every run under evals/agent-misses/runs/
// results.json: { "run": id, "date": "YYYY-MM-DD", "phase": "dev"|"heldout", "agent_model": ..., "grader_model": ...,
//   "results": [ { "case": "qa-tdd-miss-x", "arm": "agent"|"plain"|"cross", "by": "<agent that ran a cross row>", "pass": true|false, "reason": "...", "transcript": "transcripts/x-agent.md" } ] }
// Rules: every case exists in the specs; a dev run holds only dev cases and a held-out run only held-out cases;
// at most one result per case and arm; every transcript file exists and no two arms of a case share one;
// a cross row needs an agent row for the same case and `by` naming the other agent (not the case's own). The held-out set is scored once per change:
// a second held-out run needs a new run id and says what changed in `change`.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const RUNS = process.env.EVAL_MISS_RUNS_DIR || path.join(ROOT, "evals", "agent-misses", "runs");

async function loadSpecs() {
  const dir = path.join(ROOT, "evals", "agent-misses");
  const qa = (await import(pathToFileURL(path.join(dir, "qa-tdd-cases.mjs")).href)).QA_CASES;
  const pm = (await import(pathToFileURL(path.join(dir, "staff-pm-cases.mjs")).href)).PM_CASES;
  const map = new Map();
  for (const c of qa) map.set("qa-tdd-miss-" + c.id, { ...c, agent: "qa-tdd" });
  for (const c of pm) map.set("staff-pm-miss-" + c.id, { ...c, agent: "staff-pm" });
  return map;
}

export function problems(run, dir, specs) {
  const errs = [];
  if (!run || !Array.isArray(run.results)) return ["results.json: missing results array"];
  if (run.results.length === 0) return ["results.json: results is empty"];
  if (!["dev", "heldout"].includes(run.phase)) errs.push(`phase must be dev or heldout (got ${run.phase})`);
  if (!run.run || !run.date) errs.push("missing run or date");
  const seen = new Set();
  const seenT = new Set();
  for (const r of run.results) {
    if (!r || typeof r !== "object" || Array.isArray(r)) { errs.push("results entry is not an object"); continue; }
    const c = specs.get(r.case);
    if (!c) { errs.push(`unknown case ${r.case}`); continue; }
    if (!["agent", "plain", "cross"].includes(r.arm)) errs.push(`${r.case}: arm ${r.arm}`);
    if (typeof r.pass !== "boolean") errs.push(`${r.case}/${r.arm}: pass must be true or false`);
    if (typeof r.reason !== "string" || !r.reason.trim()) errs.push(`${r.case}/${r.arm}: missing reason`);
    if (c.split !== run.phase) errs.push(`${r.case}: a ${c.split} case in a ${run.phase} run`);
    const key = r.case + "|" + r.arm;
    if (seen.has(key)) errs.push(`${r.case}/${r.arm}: scored twice in one run`);
    seen.add(key);
    if (r.arm === "cross" && (typeof r.by !== "string" || !r.by.trim() || r.by === c.agent)) errs.push(`${r.case}/cross: cross result needs \`by\` naming an agent other than the case's own (${c.agent})`);
    const tp = typeof r.transcript === "string" ? path.resolve(dir, r.transcript) : "";
    if (!tp || path.isAbsolute(r.transcript) || path.relative(path.resolve(dir), tp).startsWith("..")) errs.push(`${r.case}/${r.arm}: transcript must be a file inside the run folder (${r.transcript})`);
    else if (!fs.existsSync(tp)) errs.push(`${r.case}/${r.arm}: transcript file missing (${r.transcript})`);
    else { const tk = r.case + "|" + tp; if (seenT.has(tk)) errs.push(`${r.case}/${r.arm}: transcript already used by another arm of this case (${r.transcript})`); seenT.add(tk); }
  }
  for (const r of run.results) if (r && r.arm === "cross" && !seen.has(r.case + "|agent")) errs.push(`${r.case}/cross: cross result has no agent result for the same case`);
  return errs;
}

const pct = (n, d) => (d ? `${n} of ${d}` : "n/a");

export function render(run, specs) {
  const rows = run.results.map((r) => ({ ...r, c: specs.get(r.case) }));
  const slice = (arm, f) => { const x = rows.filter((r) => r.arm === arm && f(r.c, r)); return pct(x.filter((r) => r.pass).length, x.length); };
  const arms = [...new Set(rows.map((r) => r.arm))].sort();
  const table = (title, keys, f) => {
    let t = `### ${title}\n\n| ${title.replace("By ", "")} | ${arms.map((a) => (a === "agent" ? "With agent" : a === "cross" ? "Other agent (cross-lane)" : "Plain session")).join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|\n`;
    for (const k of keys) t += `| ${k} | ${arms.map((a) => slice(a, (c, r) => f(c, r) === k)).join(" | ")} |\n`;
    return t + "\n";
  };
  const uniq = (g) => [...new Set(rows.map((r) => g(r.c)))].sort();
  let md = `# Miss eval run ${run.run}\n\n<!-- Generated by node tools/eval-miss-score.mjs; do not edit by hand. -->\n\n`;
  md += `Date ${run.date}. Phase **${run.phase}**. Agent model: ${run.agent_model || "not recorded"}. Grader model: ${run.grader_model || "not recorded"}.${run.change ? ` Change under test: ${run.change}.` : ""}\n\n`;
  md += `Graders are fresh subagents that saw only the report and the case's criteria, never the transcript of how the agent got there.\n\n`;
  md += `## Overall\n\n| | ${arms.map((a) => (a === "agent" ? "With agent" : a === "cross" ? "Other agent (cross-lane)" : "Plain session")).join(" | ")} |\n|---|${arms.map(() => "---").join("|")}|\n`;
  md += `| All cases | ${arms.map((a) => slice(a, () => true)).join(" | ")} |\n\n`;
  md += table("By agent", uniq((c) => c.agent), (c, r) => r.by || c.agent);
  md += table("By priority", uniq((c) => c.priority), (c) => c.priority);
  md += table("By pattern", uniq((c) => c.pattern), (c) => c.pattern);
  md += `## Cases\n\n| Case | Miss | Arm | Result | Reason |\n|---|---|---|---|---|\n`;
  for (const r of [...rows].sort((a, b) => a.case.localeCompare(b.case) || a.arm.localeCompare(b.arm)))
    md += `| \`${r.case}\` | ${r.c.miss} | ${r.arm} | ${r.pass ? "pass" : "FAIL"} | ${String(r.reason).replace(/\|/g, "/").replace(/\n/g, " ")} |\n`;
  return md;
}

async function one(dir, specs, check) {
  const file = path.join(dir, "results.json");
  if (!fs.existsSync(file)) return [`${dir}: no results.json`];
  let run;
  try { run = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return [`${path.basename(dir)}: results.json is not valid JSON (${e.message.split("\n")[0]})`]; }
  const errs = problems(run, dir, specs);
  if (errs.length) return errs.map((e) => `${path.basename(dir)}: ${e}`);
  const md = render(run, specs);
  const out = path.join(dir, "results.md");
  if (check) {
    if (!fs.existsSync(out) || fs.readFileSync(out, "utf8") !== md) return [`${path.basename(dir)}: results.md is stale, run node tools/eval-miss-score.mjs ${path.relative(ROOT, dir)}`];
  } else fs.writeFileSync(out, md);
  return [];
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2);
  const specs = await loadSpecs();
  let errs = [];
  if (args[0] === "--check-all") {
    if (!fs.existsSync(RUNS)) errs.push(`runs folder missing: ${RUNS}`);
    else {
      const ids = new Map();
      let heldouts = 0;
      for (const d of fs.readdirSync(RUNS).sort()) {
        const dir = path.join(RUNS, d);
        if (!fs.statSync(dir).isDirectory()) continue;
        errs.push(...(await one(dir, specs, true)));
        try {
          const run = JSON.parse(fs.readFileSync(path.join(dir, "results.json"), "utf8"));
          if (run.run) { if (ids.has(run.run)) errs.push(`${d}: run id ${run.run} is also used by ${ids.get(run.run)}`); else ids.set(run.run, d); }
          if (run.phase === "heldout" && heldouts++ > 0 && !String(run.change || "").trim()) errs.push(`${d}: a second held-out run must say what changed in \`change\``);
        } catch { /* reported by one() */ }
      }
    }
  } else if (args[0] === "--check" && args[1] && args.length === 2) errs = await one(path.resolve(args[1]), specs, true);
  else if (args.length === 1 && !args[0].startsWith("--")) errs = await one(path.resolve(args[0]), specs, false);
  else { console.error("usage: node tools/eval-miss-score.mjs <run-dir> | --check <run-dir> | --check-all"); process.exit(2); }
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  console.log("ok");
}
