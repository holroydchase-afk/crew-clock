#!/usr/bin/env node
// check-findings: validates the ```findings block that ends every ux-reviewer review, so a review the
// engineer and qa-tdd act on can be parsed instead of re-read. The block (format in
// plugins/studio/agents/ux-reviewer.md, ## Output):
//
//   ```findings
//   verdict: Needs changes            (Ready | Needs changes | Blocker)
//   score: 6/10                       (whole number, 0-10)
//   UX-R1 | P0 | G3 | Projects, 390px | Dialog has no way out | Add a Cancel button
//   ```
//
// One finding per line: ID | priority | rule | where | problem | fix, all six filled in. IDs look like
// UX-R1 and appear once; priority is P0, P1 or P2. One verdict: and one score: line. When a review has
// several blocks (a quoted example, last round's), the last one is checked. Ready needs a score of 8 or more and no P0; Blocker needs a P0.
//
// Usage: node scripts/check-findings.mjs <review.md> [--json]
//   --json   print {verdict, score, findings: [{id, priority, rule, where, problem, fix}]} on stdout
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const VERDICTS = ["Ready", "Needs changes", "Blocker"];
export const FIELDS = ["id", "priority", "rule", "where", "problem", "fix"];
const USAGE = "usage: check-findings.mjs <review.md> [--json]";

// Returns { block: {verdict, score, findings} | null, errors: [string] }.
export function checkFindings(text) {
  // The block goes last, so when a review quotes an earlier one (the format, last round's), the last one counts.
  const m = [...text.matchAll(/^```findings[ \t]*\r?\n([\s\S]*?)^```[ \t]*$/gm)].pop();
  if (!m) return { block: null, errors: ["no ```findings block: end the review with one (see ux-reviewer.md, ## Output)"] };
  const errors = [];
  let verdict = null, score = null, sawVerdict = false, sawScore = false;
  const findings = [];
  for (const raw of m[1].split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const kv = /^(verdict|score)\s*:\s*(.*)$/i.exec(line);
    if (kv && kv[1].toLowerCase() === "verdict") {
      if (sawVerdict) { errors.push(`more than one verdict: line; keep one`); continue; }
      sawVerdict = true;
      if (VERDICTS.includes(kv[2])) verdict = kv[2];
      else errors.push(`verdict "${kv[2]}" must be one of: ${VERDICTS.join(", ")}`);
      continue;
    }
    if (kv) {
      if (sawScore) { errors.push(`more than one score: line; keep one`); continue; }
      sawScore = true;
      const s = /^(\d+)\/10$/.exec(kv[2]);
      if (s && Number(s[1]) <= 10) score = Number(s[1]);
      else errors.push(`score "${kv[2]}" must be a whole number out of 10, like 6/10`);
      continue;
    }
    const parts = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((p) => p.trim());
    if (parts.length !== FIELDS.length) {
      errors.push(`finding "${line}" has ${parts.length} fields, want 6: ID | priority | rule | where | problem | fix`);
      continue;
    }
    const empty = parts.map((p, i) => (p ? null : FIELDS[i])).filter(Boolean);
    if (empty.length) errors.push(`finding "${line}" has an empty field: ${empty.join(", ")}`);
    const [id, priority, rule, where, problem, fix] = parts;
    if (id && !/^[A-Z]+-R[0-9]+$/.test(id)) errors.push(`finding ID "${id}" must look like UX-R1 (capital code, -R, number)`);
    if (priority && !/^P[0-2]$/.test(priority)) errors.push(`finding ${id || "?"} priority "${priority}" must be P0, P1 or P2`);
    if (id && findings.some((f) => f.id === id)) errors.push(`duplicate finding ID ${id}: each ID appears once`);
    findings.push({ id, priority, rule, where, problem, fix });
  }
  if (!sawVerdict) errors.push("missing verdict: line (Ready, Needs changes or Blocker)");
  if (!sawScore) errors.push("missing score: line, like score: 6/10");
  const p0 = findings.filter((f) => f.priority === "P0").map((f) => f.id);
  if (verdict === "Ready" && p0.length) errors.push(`verdict Ready can't have a P0 finding (${p0.join(", ")}): use Blocker or Needs changes`);
  if (verdict === "Ready" && score !== null && score < 8) errors.push(`verdict Ready needs a score of 8/10 or more, got ${score}/10`);
  if (verdict === "Blocker" && !p0.length) errors.push("verdict Blocker needs at least one P0 finding");
  return { block: { verdict, score, findings }, errors };
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
  const { block, errors } = checkFindings(text);
  if (json && block) console.log(JSON.stringify(block, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
