#!/usr/bin/env node
// check-agent-run: validates a run log for any studio agent (qa-tdd, staff-pm and every later one), so "the agent
// ran, on what, with which tools, what it concluded and what it cost" is a record a script can check. Modeled on
// check-ux-run.mjs (ux-reviewer keeps its richer ```uxrun log). The log holds exactly one ```agentrun block of
// `key: value` lines; keys are case-insensitive, values are not:
//
//   date: 2026-11-22                     (real YYYY-MM-DD)
//   agent: qa-tdd                        (one of the ten studio agents, see AGENTS)
//   product: <name>                      tier: advisory | supervised | full
//   model: <id>                          tokens: <integer>      cost_usd: <number>   (what the harness shows)
//   input: <the task, one line>
//   tool: <name> | ok | failed | <note>  (zero or more; name has no spaces)
//   verdict: <see VERDICTS; any non-empty text for agents without a fixed list>
//   findings: <integer>                  p0: <integer, at most findings>
//   artifact: <repo-relative path>       (optional; no leading slash, no .. segment)
//   escalated: yes | no                  (yes needs `escalation_reason: <text>`; no forbids it)
//   retries: <integer>                   (optional)
//   stamped: yes                         (optional, written by tools/stamp-run.mjs; then these are needed:)
//     stamp_input / stamp_output / stamp_cache_creation / stamp_cache_read: <integer>; tokens must equal their sum
//     stamp_sha: <40 hex>; one of stamp_cost: not measured | stamp_prices: <source> <YYYY-MM-DD>
//     stamp_test: <command> | <pass>/<fail> or <command> | unparsed   (optional)
//
// Cross rules: a qa-tdd green needs p0: 0; any verdict "blocked" needs escalated: yes.
// No email, phone, claude.ai URL, trig_/env_/cmsg_/session_ id or API key anywhere in the file; errors never
// repeat the value they found.
// Usage: node scripts/check-agent-run.mjs <run.md> [--json]
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEAKS } from "./check-story-entry.mjs";

export const AGENTS = ["qa-tdd", "staff-pm", "engineer", "ux-reviewer", "privacy-security", "architect", "positioning", "release-captain", "story-keeper", "orchestrator"];
export const TIERS = ["advisory", "supervised", "full"];
export const VERDICTS = {
  "qa-tdd": ["green", "red", "flaky", "blocked"],
  "staff-pm": ["ready", "needs-decision", "blocked", "cut"],
  "ux-reviewer": ["Ready", "Needs changes", "Blocker"],
};
const USAGE = "usage: check-agent-run.mjs <run.md> [--json]";
const REQUIRED = ["date", "agent", "product", "tier", "model", "tokens", "cost_usd", "input", "verdict", "findings", "p0", "escalated"];
// stamp_* lines are written by tools/stamp-run.mjs (run by the caller, not the agent): see the STAMP block below.
export const STAMP_COUNTS = ["stamp_input", "stamp_output", "stamp_cache_creation", "stamp_cache_read"];
const STAMP_KEYS = ["stamped", ...STAMP_COUNTS, "stamp_sha", "stamp_test", "stamp_prices", "stamp_cost"];
const OPTIONAL = ["artifact", "escalation_reason", "retries", ...STAMP_KEYS];
const KEYS = [...REQUIRED, ...OPTIONAL, "tool"];
const INT = /^\d+$/;
const NUM = /^\d+(\.\d+)?$/;

const realDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
};
const LEAKS_G = LEAKS.map(([re]) => new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g"));
// Any error that quotes a value (an unknown line, a bad verdict) must never repeat a secret it holds.
const redact = (s) => LEAKS_G.reduce((acc, re) => acc.replace(re, "[redacted]"), s);

// Returns { run: {...} | null, errors: [string] }.
export function checkAgentRun(text) {
  const errors = [];
  for (const [re, what] of LEAKS) if (re.test(text)) errors.push(`the log has ${what}: personal data and secrets never go in a run log`);
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let open = null;
  lines.forEach((l, i) => {
    if (open === null && /^```agentrun[ \t]*$/.test(l)) open = i;
    else if (open !== null && /^```[ \t]*$/.test(l)) { blocks.push([open, i]); open = null; }
  });
  if (open !== null) return { run: null, errors: [...errors, "unclosed ```agentrun block: end it with a line of ```"] };
  if (blocks.length !== 1) return { run: null, errors: [...errors, `${blocks.length} agentrun blocks: exactly one \`\`\`agentrun block per run log`] };

  const found = [];
  const kv = {};
  const tools = [];
  for (const line of lines.slice(blocks[0][0] + 1, blocks[0][1]).map((l) => l.trim()).filter(Boolean)) {
    const m = /^([A-Za-z0-9_]+):\s*(.*)$/.exec(line);
    const k = m ? m[1].toLowerCase() : null;
    if (!m || !KEYS.includes(k)) { found.push(`line "${line}" is not a known key: use ${KEYS.join(", ")}`); continue; }
    const v = m[2].trim();
    if (k === "tool") tools.push(v);
    else if (k in kv) found.push(`duplicate ${k}: line: each appears once`);
    else kv[k] = v;
  }
  for (const k of REQUIRED) {
    if (!(k in kv)) found.push(`missing ${k}: line`);
    else if (!kv[k]) found.push(`${k}: is empty: fill it in`);
  }
  for (const k of OPTIONAL) if (k in kv && !kv[k]) found.push(`${k}: is empty: fill it in or leave the line out`);

  if (kv.date && !realDate(kv.date)) found.push(`date "${kv.date}" is not a real YYYY-MM-DD date`);
  if (kv.agent && !AGENTS.includes(kv.agent)) found.push(`agent "${kv.agent}" must be one of: ${AGENTS.join(", ")}`);
  if (kv.tier && !TIERS.includes(kv.tier)) found.push(`tier "${kv.tier}" must be one of: ${TIERS.join(", ")}`);
  if (kv.tokens && !INT.test(kv.tokens)) found.push(`tokens "${kv.tokens}" must be a non-negative integer`);
  if (kv.cost_usd && !NUM.test(kv.cost_usd)) found.push(`cost_usd "${kv.cost_usd}" must be a non-negative number`);
  const allowed = VERDICTS[kv.agent];
  if (kv.verdict && allowed && !allowed.includes(kv.verdict)) found.push(`verdict "${kv.verdict}" for ${kv.agent} must be one of: ${allowed.join(", ")}`);
  if (kv.findings && !INT.test(kv.findings)) found.push(`findings "${kv.findings}" must be a non-negative integer`);
  if (kv.p0 && !INT.test(kv.p0)) found.push(`p0 "${kv.p0}" must be a non-negative integer`);
  if (INT.test(kv.findings || "") && INT.test(kv.p0 || "") && +kv.p0 > +kv.findings) found.push(`p0 (${kv.p0}) cannot be more than findings (${kv.findings})`);
  if (kv.artifact) {
    const a = kv.artifact;
    if (/^[\\/]/.test(a) || /^[A-Za-z]:/.test(a)) found.push(`artifact "${a}" must be a repo-relative path (no leading slash)`);
    if (a.split(/[\\/]/).includes("..")) found.push(`artifact "${a}" must not have a .. segment`);
  }
  if (kv.escalated && !["yes", "no"].includes(kv.escalated)) found.push(`escalated "${kv.escalated}" must be yes or no`);
  if (kv.escalated === "yes" && !("escalation_reason" in kv)) found.push("escalated yes needs an escalation_reason: line saying why");
  if (kv.escalated === "no" && "escalation_reason" in kv) found.push("escalation_reason: given but escalated is no: drop it or say yes");
  if (kv.retries && !INT.test(kv.retries)) found.push(`retries "${kv.retries}" must be a non-negative integer`);

  const stampKeys = STAMP_KEYS.filter((k) => k in kv);
  if ("stamped" in kv && kv.stamped !== "yes") found.push(`stamped "${kv.stamped}" must be yes (or leave the line out)`);
  if (kv.stamped !== "yes" && stampKeys.some((k) => k !== "stamped")) found.push("stamp_ lines need stamped: yes");
  if (kv.stamped === "yes") {
    for (const k of STAMP_COUNTS) {
      if (!(k in kv)) found.push(`stamped yes needs a ${k}: line`);
      else if (kv[k] && !INT.test(kv[k])) found.push(`${k} "${kv[k]}" must be a non-negative integer`);
    }
    if (!("stamp_sha" in kv)) found.push("stamped yes needs a stamp_sha: line");
    else if (kv.stamp_sha && !/^[0-9a-f]{40}$/.test(kv.stamp_sha)) found.push(`stamp_sha "${kv.stamp_sha}" must be 40 lowercase hex characters`);
    if (STAMP_COUNTS.every((k) => INT.test(kv[k] || "")) && INT.test(kv.tokens || "")) {
      const sum = STAMP_COUNTS.reduce((a, k) => a + Number(kv[k]), 0);
      if (Number(kv.tokens) !== sum) found.push(`tokens (${kv.tokens}) must equal the sum of the four stamp_ counts (${sum})`);
    }
    if ("stamp_cost" in kv && kv.stamp_cost && kv.stamp_cost !== "not measured") found.push(`stamp_cost "${kv.stamp_cost}" must be: not measured`);
    if ("stamp_cost" in kv && "stamp_prices" in kv) found.push("stamp_cost and stamp_prices together: a run is priced or not measured, not both");
    if (!("stamp_cost" in kv) && !("stamp_prices" in kv)) found.push("stamped yes needs stamp_cost: not measured or a stamp_prices: line");
    if (kv.stamp_prices) {
      const m = /^\S+ (\d{4}-\d{2}-\d{2})$/.exec(kv.stamp_prices);
      if (!m || !realDate(m[1])) found.push(`stamp_prices "${kv.stamp_prices}" must be <source> <YYYY-MM-DD>`);
    }
    if (kv.stamp_test && !/^.+ \| (\d+\/\d+|unparsed)$/.test(kv.stamp_test)) found.push(`stamp_test "${kv.stamp_test}" must be <command> | <pass>/<fail> or <command> | unparsed`);
  }

  const outTools = [];
  for (const t of tools) {
    const p = t.split("|").map((s) => s.trim());
    if (p.length !== 3 || p.some((s) => !s)) { found.push(`tool "${t}" must be <name> | ok or failed | <note>, all three filled in`); continue; }
    if (/\s/.test(p[0])) { found.push(`tool name "${p[0]}" has a space: use the tool's exact name`); continue; }
    if (!["ok", "failed"].includes(p[1])) { found.push(`tool ${p[0]} has status "${p[1]}": use ok or failed`); continue; }
    outTools.push({ name: p[0], status: p[1], note: p[2] });
  }

  if (kv.agent === "qa-tdd" && kv.verdict === "green" && INT.test(kv.p0 || "") && +kv.p0 > 0) found.push(`qa-tdd verdict green needs p0: 0 (got ${kv.p0})`);
  if (kv.verdict === "blocked" && kv.escalated !== "yes") found.push("verdict blocked needs escalated: yes and an escalation_reason: someone must unblock it");

  const int = (v) => (INT.test(v || "") ? Number(v) : null);
  const run = {
    date: kv.date, agent: kv.agent, product: kv.product, tier: kv.tier, model: kv.model,
    tokens: int(kv.tokens), cost_usd: NUM.test(kv.cost_usd || "") ? Number(kv.cost_usd) : null,
    input: kv.input, tools: outTools, verdict: kv.verdict, findings: int(kv.findings), p0: int(kv.p0),
    artifact: kv.artifact ?? null, escalated: kv.escalated, escalation_reason: kv.escalation_reason ?? null,
    retries: "retries" in kv ? int(kv.retries) : null,
  };
  return { run, errors: [...errors, ...found.map(redact)] };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); process.exit(0); }
  const json = args.includes("--json");
  const files = args.filter((a) => a !== "--json");
  if (files.length !== 1 || files[0].startsWith("-")) { console.error(USAGE); process.exit(2); }
  let text;
  try { text = readFileSync(files[0], "utf8"); } catch { console.error(`can't read ${files[0]}`); process.exit(2); }
  const { run, errors } = checkAgentRun(text);
  if (json && run) console.log(JSON.stringify(run, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
