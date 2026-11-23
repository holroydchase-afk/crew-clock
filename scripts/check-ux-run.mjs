#!/usr/bin/env node
// check-ux-run: validates a ux-reviewer run log, so "the agent ran, here is what it did and why it flagged
// each thing" is a record a script can check. The log holds exactly one ```uxrun block of `key: value` lines
// (contract and tiers: docs/ux-agent-bar.md):
//
//   date: 2026-11-20                   (real YYYY-MM-DD)
//   product: <name>                    tier: advisory | supervised | full
//   model: <id>                        tokens: <integer>      cost_usd: <number>
//   flow: <name> | phone,laptop | <shots path>          (one or more; widths from phone, laptop)
//   finding: UX-R1 | P0-P2 | <rule id> | <evidence path> [| <problem> | <fix>]   (zero or more; unique ids)
//   verdict: Ready | Needs changes | Blocker             (Blocker needs a P0; Ready allows none)
//   rechecked: yes | no | n/a                            (n/a is invalid when there are findings)
//   escalated: yes | no                                  (yes needs `escalation_reason: <text>`)
//
// No email, phone, claude.ai URL, trig_/env_/cmsg_/session_ id or API key anywhere in the file.
// Usage: node scripts/check-ux-run.mjs <run.md> [--json]
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEAKS } from "./check-story-entry.mjs";

export const TIERS = ["advisory", "supervised", "full"];
export const VERDICTS = ["Ready", "Needs changes", "Blocker"];
export const WIDTHS = ["phone", "laptop"];
const USAGE = "usage: check-ux-run.mjs <run.md> [--json]";
const KEYS = ["date", "product", "tier", "model", "tokens", "cost_usd", "flow", "finding", "verdict", "rechecked", "escalated", "escalation_reason"];
const SINGLE = ["date", "product", "tier", "model", "tokens", "cost_usd", "verdict", "rechecked", "escalated", "escalation_reason"];

const realDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
};

// Returns { run: {...} | null, errors: [string] }.
export function checkUxRun(text) {
  const errors = [];
  for (const [re, what] of LEAKS) if (re.test(text)) errors.push(`the log has ${what}: personal data and secrets never go in a run log`);
  const lines = text.split(/\r?\n/);
  const blocks = [];
  let open = null;
  lines.forEach((l, i) => {
    if (open === null && /^```uxrun[ \t]*$/.test(l)) open = i;
    else if (open !== null && /^```[ \t]*$/.test(l)) { blocks.push([open, i]); open = null; }
  });
  if (open !== null) return { run: null, errors: [...errors, "unclosed ```uxrun block: end it with a line of ```"] };
  if (blocks.length !== 1) return { run: null, errors: [...errors, `${blocks.length} uxrun blocks: exactly one \`\`\`uxrun block per run log`] };

  const kv = {};
  const flows = [], findings = [];
  for (const line of lines.slice(blocks[0][0] + 1, blocks[0][1]).map((l) => l.trim()).filter(Boolean)) {
    const m = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!m || !KEYS.includes(m[1])) { errors.push(`line "${line}" is not a known key: use ${KEYS.join(", ")}`); continue; }
    const [, k, v] = m;
    if (k === "flow") flows.push(v);
    else if (k === "finding") findings.push(v);
    else if (k in kv) errors.push(`duplicate ${k}: line: each appears once`);
    else kv[k] = v;
  }
  for (const k of ["date", "product", "tier", "model", "tokens", "cost_usd", "verdict", "rechecked", "escalated"]) {
    if (!(k in kv)) errors.push(`missing ${k}: line`);
    else if (!kv[k]) errors.push(`${k}: is empty: fill it in`);
  }
  if (kv.date && !realDate(kv.date)) errors.push(`date "${kv.date}" is not a real YYYY-MM-DD date`);
  if (kv.tier && !TIERS.includes(kv.tier)) errors.push(`tier "${kv.tier}" must be one of: ${TIERS.join(", ")}`);
  if (kv.tokens && !/^\d+$/.test(kv.tokens)) errors.push(`tokens "${kv.tokens}" must be a non-negative integer`);
  if (kv.cost_usd && !/^\d+(\.\d+)?$/.test(kv.cost_usd)) errors.push(`cost_usd "${kv.cost_usd}" must be a non-negative number`);
  if (kv.verdict && !VERDICTS.includes(kv.verdict)) errors.push(`verdict "${kv.verdict}" must be one of: ${VERDICTS.join(", ")}`);
  if (kv.rechecked && !["yes", "no", "n/a"].includes(kv.rechecked)) errors.push(`rechecked "${kv.rechecked}" must be yes, no or n/a`);
  if (kv.escalated && !["yes", "no"].includes(kv.escalated)) errors.push(`escalated "${kv.escalated}" must be yes or no`);

  const outFlows = [];
  if (!flows.length) errors.push("no flow: line: a run reviews at least one flow (flow: <name> | phone,laptop | <shots path>)");
  for (const f of flows) {
    const p = f.split("|").map((s) => s.trim());
    if (p.length !== 3 || p.some((s) => !s)) { errors.push(`flow "${f}" must be <name> | <widths> | <shots path>`); continue; }
    const widths = p[1].split(",").map((s) => s.trim());
    const bad = widths.filter((w) => !WIDTHS.includes(w));
    if (bad.length) errors.push(`flow "${p[0]}" has an unknown width "${bad[0]}": use ${WIDTHS.join(", ")}`);
    outFlows.push({ name: p[0], widths, shots: p[2] });
  }
  const outFindings = [], seen = new Set();
  for (const f of findings) {
    const p = f.split("|").map((s) => s.trim());
    if ((p.length !== 4 && p.length !== 6) || p.some((s) => !s)) { errors.push(`finding "${f}" must be <ID> | <P0-P2> | <rule> | <evidence path> [| <problem> | <fix>]`); continue; }
    if (!/^[A-Z][A-Z0-9]*-R\d+$/.test(p[0])) errors.push(`finding id "${p[0]}" must look like UX-R1`);
    if (seen.has(p[0])) errors.push(`duplicate finding id ${p[0]}: each id appears once`);
    seen.add(p[0]);
    if (!/^P[0-2]$/.test(p[1])) errors.push(`finding ${p[0]} has priority "${p[1]}": use P0, P1 or P2`);
    outFindings.push({ id: p[0], priority: p[1], rule: p[2], shots: p[3], problem: p[4] ?? null, fix: p[5] ?? null });
  }
  const p0 = outFindings.some((f) => f.priority === "P0");
  if (kv.verdict === "Blocker" && !p0) errors.push("verdict Blocker needs at least one P0 finding");
  if (kv.verdict === "Ready" && p0) errors.push("verdict Ready cannot have a P0 finding");
  if (outFindings.length && kv.rechecked === "n/a") errors.push("rechecked is n/a but there are findings: say yes or no");
  if (kv.escalated === "yes" && !kv.escalation_reason) errors.push("escalated yes needs an escalation_reason: line saying why");

  const run = {
    date: kv.date, product: kv.product, tier: kv.tier, model: kv.model,
    tokens: /^\d+$/.test(kv.tokens || "") ? Number(kv.tokens) : null,
    cost_usd: /^\d+(\.\d+)?$/.test(kv.cost_usd || "") ? Number(kv.cost_usd) : null,
    flows: outFlows, findings: outFindings, verdict: kv.verdict, rechecked: kv.rechecked, escalated: kv.escalated,
    escalation_reason: kv.escalation_reason ?? null,
  };
  return { run, errors };
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
  const { run, errors } = checkUxRun(text);
  if (json && run) console.log(JSON.stringify(run, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
