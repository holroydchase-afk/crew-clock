#!/usr/bin/env node
// check-spec: validates the ```spec block that ends every staff-pm spec, so "the spec is ready" is something a
// script can check instead of a claim. The block (format in plugins/studio/agents/staff-pm.md, ## Output):
//
//   ```spec
//   verdict: ready                                   (ready | needs-decision | blocked | cut)
//   bet: who believes or does what; what proves it worked
//   step: M1.1 | what | done when | 1 session        (ID | what | done when | size)
//   criterion: PACE-1 | auto | Given ..., then the average is 0.40   (ID | auto|manual | text)
//   cut: Charts | not needed to prove the bet        (thing | reason)
//   risk: Time zone drift at midnight | PACE-1       (risk | the step or criterion ID that handles it)
//   decision: Per day or per week? | Per day         (question | recommendation)
//   handoff: qa-tdd | failing tests for PACE-1 | red for the right reason   (agent | task | done when)
//   blocked: what's missing                          (only when the verdict is blocked)
//   ```
//
// One verdict: and one non-empty bet:. Step IDs look like M1.1 (M1.1.1 too), sizes like "1 session" or "0.5 session".
// Criterion IDs look like PACE-1 or SZ-12, kind is auto or manual, and the text needs "then" or "->" plus a digit or a
// quoted value. At least one step, one criterion and one auto criterion, except when the verdict is cut, which needs a
// cut: line instead. At least one risk: and one handoff:; every risk names a step or criterion ID in this block.
// ready needs a handoff to qa-tdd (failing tests first); needs-decision needs a decision: line; blocked needs a
// non-empty blocked: line, and no other verdict may have one. IDs appear once. Unknown keys are errors. Keys and the
// verdict are case-insensitive. When a file has several blocks (a quoted example), the last one is checked; an unclosed
// last block is an error. The whole file is scanned for personal data and secrets (LEAKS from check-story-entry.mjs).
//
// Usage: node scripts/check-spec.mjs <spec.md> [--json]
//   --json   print {verdict, bet, blocked, steps, criteria, cuts, risks, decisions, handoffs} on stdout
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { LEAKS } from "./check-story-entry.mjs";

export const VERDICTS = ["ready", "needs-decision", "blocked", "cut"];
export const KEYS = ["verdict", "bet", "step", "criterion", "cut", "risk", "decision", "handoff", "blocked"];
// The studio roster (plugins/studio/agents) plus the product-specific agents that product repos add.
export const AGENTS = ["staff-pm", "qa-tdd", "engineer", "ux-reviewer", "privacy-security", "architect", "release-captain",
  "positioning", "story-keeper", "orchestrator", "focus-coach", "grandparent-ux"];
const USAGE = "usage: check-spec.mjs <spec.md> [--json]";

const STEP_ID = /^M\d+(?:\.\d+)+$/;
const CRITERION_ID = /^[A-Z][A-Z0-9]*-\d+$/;
const SIZE = /^\d+(?:\.\d+)?\s+sessions?$/i;
const QUOTED = /"[^"]+"|“[^”]+”|(?<!\w)'[^']+'(?!\w)/;

// Splits "a | b | c" into trimmed parts; checks the count and that none is empty.
function parts(key, val, names, errors) {
  const p = val.split("|").map((s) => s.trim());
  if (p.length !== names.length) {
    errors.push(`${key} "${val}" has ${p.length} parts, want ${names.length}: ${names.join(" | ")}`);
    return null;
  }
  const empty = p.map((s, i) => (s ? null : names[i])).filter(Boolean);
  if (empty.length) errors.push(`${key} "${val}" has an empty part: ${empty.join(", ")}`);
  return p;
}

// Returns { spec: {verdict, bet, blocked, steps, criteria, cuts, risks, decisions, handoffs} | null, errors: [string] }.
export function checkSpec(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  lines.forEach((line, i) => {
    for (const [re, what] of LEAKS) if (re.test(line)) errors.push(`line ${i + 1} has ${what}: personal data and secrets never go in a spec`);
  });
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    if (open === null && /^```spec[ \t]*$/.test(line)) open = i;
    else if (open !== null && /^```[ \t]*$/.test(line)) { blocks.push([open, i]); open = null; }
  });
  if (open !== null) return { spec: null, errors: [...errors, "the last ```spec block is not closed: end it with a line of ```"] };
  if (!blocks.length) return { spec: null, errors: [...errors, "no ```spec block: end the spec with one (see staff-pm.md, ## Output)"] };
  const [a, b] = blocks[blocks.length - 1];

  let verdict = null, bet = null, blocked = null;
  const seen = { verdict: 0, bet: 0, blocked: 0 };
  const steps = [], criteria = [], cuts = [], risks = [], decisions = [], handoffs = [];
  for (const raw of lines.slice(a + 1, b)) {
    const line = raw.trim();
    if (!line) continue;
    const kv = /^([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line);
    if (!kv) { errors.push(`line "${line}" is not a key: value line (keys: ${KEYS.join(", ")})`); continue; }
    const key = kv[1].toLowerCase(), val = kv[2].trim();
    if (!KEYS.includes(key)) { errors.push(`unknown key "${kv[1]}": the keys are ${KEYS.join(", ")}`); continue; }
    if (key in seen) {
      if (seen[key]++) { errors.push(`more than one ${key}: line; keep one`); continue; }
      if (!val) { errors.push(`${key}: line is empty: say ${key === "bet" ? "who has to believe or do what, and what proves it" : key === "blocked" ? "what's missing" : "one of " + VERDICTS.join(", ")}`); continue; }
      if (key === "verdict") {
        if (VERDICTS.includes(val.toLowerCase())) verdict = val.toLowerCase();
        else errors.push(`verdict "${val}" must be one of: ${VERDICTS.join(", ")}`);
      } else if (key === "bet") bet = val;
      else blocked = val;
      continue;
    }
    if (key === "step") {
      const p = parts("step", val, ["ID", "what", "done when", "size"], errors);
      if (!p) continue;
      const [id, what, doneWhen, size] = p;
      if (id && !STEP_ID.test(id)) errors.push(`step ID "${id}" must look like M1.1 (studio planning IDs)`);
      if (size && !SIZE.test(size)) errors.push(`step ${id || "?"} size "${size}" must look like "1 session" or "0.5 session"`);
      if (id && steps.some((s) => s.id === id)) errors.push(`duplicate step ID ${id}: each ID appears once`);
      steps.push({ id, what, doneWhen, size });
    } else if (key === "criterion") {
      const p = parts("criterion", val, ["ID", "auto|manual", "text"], errors);
      if (!p) continue;
      const [id, kindRaw, text] = p;
      const kind = kindRaw.toLowerCase();
      if (id && !CRITERION_ID.test(id)) errors.push(`criterion ID "${id}" must look like PACE-1 or SZ-12`);
      if (kindRaw && kind !== "auto" && kind !== "manual") errors.push(`criterion ${id || "?"} kind "${kindRaw}" must be auto or manual`);
      if (text && !/\bthen\b|->/i.test(text)) errors.push(`criterion ${id || "?"} text needs "then" or "->" before the expected result`);
      if (text && !/\d/.test(text) && !QUOTED.test(text)) errors.push(`criterion ${id || "?"} text needs a concrete expected value: a digit or a quoted value`);
      if (id && criteria.some((c) => c.id === id)) errors.push(`duplicate criterion ID ${id}: each ID appears once`);
      criteria.push({ id, kind, text });
    } else if (key === "cut") {
      const p = parts("cut", val, ["thing", "reason"], errors);
      if (p) cuts.push({ thing: p[0], reason: p[1] });
    } else if (key === "risk") {
      const p = parts("risk", val, ["risk", "handled by (step or criterion ID)"], errors);
      if (p) risks.push({ risk: p[0], handledBy: p[1] });
    } else if (key === "decision") {
      const p = parts("decision", val, ["question", "recommendation"], errors);
      if (p) decisions.push({ question: p[0], recommendation: p[1] });
    } else if (key === "handoff") {
      const p = parts("handoff", val, ["agent", "task", "done when"], errors);
      if (!p) continue;
      const agent = p[0].toLowerCase();
      if (p[0] && !AGENTS.includes(agent)) errors.push(`handoff agent "${p[0]}" is not a studio agent (${AGENTS.join(", ")})`);
      handoffs.push({ agent, task: p[1], doneWhen: p[2] });
    }
  }

  if (!seen.verdict) errors.push(`missing verdict: line (${VERDICTS.join(", ")})`);
  if (!seen.bet) errors.push("missing bet: line: who has to believe or do what, and what proves it worked");
  if (verdict !== "cut") {
    if (!steps.length) errors.push("no step: line: list the critical path as step: ID | what | done when | size");
    if (!criteria.length) errors.push("no criterion: line: every spec needs testable criteria (criterion: ID | auto|manual | text)");
    else if (!criteria.some((c) => c.kind === "auto")) errors.push("no auto criterion: at least one criterion must be auto, so qa-tdd can write a failing test");
  } else if (!cuts.length) errors.push("verdict cut needs a cut: line saying what is cut and why");
  if (!risks.length) errors.push("no risk: line: name the biggest risk and the step or criterion that handles it");
  const ids = new Set([...steps.map((s) => s.id), ...criteria.map((c) => c.id)]);
  for (const r of risks) if (r.handledBy && !ids.has(r.handledBy)) errors.push(`risk "${r.risk}" is handled by ${r.handledBy}, which is not a step or criterion ID in this block`);
  if (!handoffs.length) errors.push("no handoff: line: say agent | task | done when for each next lane");
  if (verdict === "ready" && !handoffs.some((h) => h.agent === "qa-tdd")) errors.push("verdict ready needs a handoff to qa-tdd: failing tests come before the build");
  if (verdict === "needs-decision" && !decisions.length) errors.push("verdict needs-decision needs a decision: line (question | recommendation)");
  if (verdict === "blocked" && !blocked && seen.blocked === 0) errors.push("verdict blocked needs a blocked: line saying what's missing");
  if (verdict && verdict !== "blocked" && seen.blocked) errors.push(`verdict ${verdict} can't have a blocked: line: use verdict: blocked`);
  return { spec: { verdict, bet, blocked, steps, criteria, cuts, risks, decisions, handoffs }, errors };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); process.exit(0); }
  const json = args.includes("--json");
  const files = args.filter((x) => x !== "--json");
  if (files.length !== 1 || files[0].startsWith("-")) { console.error(USAGE); process.exit(2); }
  let text;
  try { text = readFileSync(files[0], "utf8"); } catch { console.error(`can't read ${files[0]}`); process.exit(2); }
  const { spec, errors } = checkSpec(text);
  if (json && spec) console.log(JSON.stringify(spec, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
