#!/usr/bin/env node
// ux-refs: the ux-reviewer's cited reference library (docs/references/ux/*.md). Search it, show an entry, and
// check a review: every reference ID a review cites must exist, and for the topics it touched every hard
// entry must be cited in a finding or listed on a "Hard rules checked:" line. Entries with status pending
// (source blocked or not yet read) are never enforced; they are reported as open. No network.
//
// Usage: node scripts/ux-refs.mjs search <words> [--limit N] [--json] [--root dir]
//        node scripts/ux-refs.mjs show <ID> [--root dir]
//        node scripts/ux-refs.mjs cite <review.md> [--topics dark,contrast] [--root dir]
// Exit 0 ok; 1 a finding (unknown id, skipped hard rule, no such entry); 2 usage error.
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { search } from "./ux-search.mjs";

const USAGE = "usage: ux-refs.mjs search <words> [--limit N] [--json] | show <ID> | cite <review.md> [--topics a,b] [--root dir]";
const ID = /\b([A-Z]{3,8})-(\d+)\b/g;

export function loadRefs(root) {
  const dir = join(root, "docs", "references", "ux");
  const refs = [];
  if (!existsSync(dir)) return refs;
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".md") && n !== "README.md").sort()) {
    let cur = null;
    const push = () => { if (cur) { cur.body = cur.body.trim(); refs.push(cur); } };
    for (const l of readFileSync(join(dir, f), "utf8").split(/\r?\n/)) {
      const h = /^##\s+([A-Z]{3,8}-\d+)\s+(.*)$/.exec(l);
      if (h) { push(); cur = { id: h[1], title: h[2].trim(), topic: h[1].split("-")[0].toLowerCase(), file: f, strength: "", status: "", source: "", tags: [], body: "" }; continue; }
      if (!cur) continue;
      const kv = /^- (strength|status|source|tags):\s*(.*)$/.exec(l);
      if (kv) cur[kv[1]] = kv[1] === "tags" ? kv[2].split(",").map((s) => s.trim().toLowerCase()).filter(Boolean) : kv[2].trim();
      else cur.body += `${l}\n`;
    }
    push();
  }
  return refs;
}

export function searchRefs(query, refs, opts = {}) {
  const docs = refs.map((r) => ({ id: r.id, source: r.source, text: `${r.title}\n${r.body}\n${r.tags.join(" ")}`, tags: [...r.tags, r.topic] }));
  return search(query, docs, opts);
}

export const STRENGTHS = ["hard", "guide"];
export const STATUSES = ["fetched", "search-summary", "pending"];

// A typo in strength or status would silently drop a rule from enforcement, so every entry is validated.
export function validateRefs(refs) {
  const errors = [];
  for (const r of refs) {
    if (!STRENGTHS.includes(r.strength)) errors.push(`${r.id}: strength "${r.strength}" must be one of ${STRENGTHS.join(", ")}`);
    if (!STATUSES.includes(r.status)) errors.push(`${r.id}: status "${r.status}" must be one of ${STATUSES.join(", ")}`);
    if (!/^https:\/\//.test(r.source)) errors.push(`${r.id}: source must be an https link`);
  }
  return errors;
}

// What a review accounts for: a finding row's rule field (ID | P | rule | where | problem | fix), and entries on
// the "Hard rules checked:" line (`ID pass`, `ID fail (UX-R3)`, `ID not verifiable (why)`, `ID open`). A fail must
// name its finding. An ID mentioned anywhere else (prose) accounts for nothing.
export function accounted(text) {
  const ids = new Set(), errors = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("|");
    if (cells.length >= 6) for (const m of (cells[2] || "").matchAll(ID)) ids.add(m[0].toUpperCase());
    const hc = /^\s*(?:\*\*)?Hard rules checked:?(?:\*\*)?:?\s*(.*)$/i.exec(line);
    if (!hc) continue;
    for (const m of hc[1].matchAll(/\b([A-Za-z]{3,8}-\d+)\s+(pass|fail|not verifiable|open)\b(?:\s*\(([^)]*)\))?/gi)) {
      const id = m[1].toUpperCase(), word = m[2].toLowerCase();
      if (word === "fail" && !/\b[A-Z]{2,}-R\d+\b/.test(m[3] || "")) { errors.push(`${id} is marked fail with no finding: write "${id} fail (UX-R1)" and add that finding row`); continue; }
      ids.add(id);
    }
  }
  return { ids, errors };
}

// topics: ["dark", ...]. Returns { errors: [string], open: [id] }.
export function citeCheck(text, refs, topics = []) {
  const errors = validateRefs(refs);
  const known = new Set(refs.map((r) => r.id));
  const families = new Set(refs.map((r) => r.id.split("-")[0]));
  for (const m of text.matchAll(/\b([A-Za-z]{3,8})-(\d+)\b/g)) {
    const id = m[0].toUpperCase();
    if (!families.has(m[1].toUpperCase())) continue; // not a reference family (UX-R1, DS-1, G7...)
    if (!known.has(id)) errors.push(`unknown reference ${id}: not in docs/references/ux`);
  }
  const want = new Set(topics.map((t) => t.trim().toLowerCase()).filter(Boolean));
  const have = new Set(refs.map((r) => r.topic));
  for (const t of want) if (!have.has(t)) errors.push(`unknown topic "${t}" (have: ${[...have].join(", ")})`);
  const acc = accounted(text);
  errors.push(...acc.errors);
  const open = [];
  for (const r of refs) {
    if (!want.has(r.topic) || r.strength !== "hard") continue;
    if (r.status === "pending") { open.push(r.id); continue; }
    if (!acc.ids.has(r.id)) errors.push(`hard rule ${r.id} (${r.title}) is neither cited in a finding row nor listed under "Hard rules checked:"`);
  }
  return { errors: [...new Set(errors)], open };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  const usage = () => { console.error(USAGE); process.exit(2); };
  const pos = []; let root = process.cwd(), limit = 5, json = false, topics = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { console.log(USAGE); process.exit(0); }
    else if (a === "--json") json = true;
    else if (a === "--root") { root = args[++i]; if (root === undefined) usage(); }
    else if (a === "--topics") { const v = args[++i]; if (v === undefined) usage(); topics = v.split(",").map((x) => x.trim()).filter(Boolean); }
    else if (a === "--limit") { const v = args[++i]; if (v === undefined || !/^[1-9]\d*$/.test(v)) usage(); limit = Number(v); }
    else if (a.startsWith("-")) usage();
    else pos.push(a);
  }
  const [cmd, ...rest] = pos;
  const refs = loadRefs(root);
  if (cmd === "search" && rest.length) {
    const r = searchRefs(rest.join(" "), refs, { limit });
    if (json) console.log(JSON.stringify(r, null, 2));
    else if (!r.length) console.log("no matches");
    else for (const x of r) console.log(`${x.id}  ${x.snippet.split("\n")[0]}  ${x.source}`);
  } else if (cmd === "show" && rest.length === 1) {
    const r = refs.find((x) => x.id === rest[0]);
    if (!r) { console.error(`no such reference: ${rest[0]}`); process.exit(1); }
    console.log(`${r.id} ${r.title}\nstrength: ${r.strength}  status: ${r.status}\nsource: ${r.source}\n\n${r.body}`);
  } else if (cmd === "cite" && rest.length === 1) {
    let text;
    try { text = readFileSync(rest[0], "utf8"); } catch (e) { console.error(`cannot read ${rest[0]}`); process.exit(2); }
    const { errors, open } = citeCheck(text, refs, topics);
    for (const id of open) console.log(`open: ${id} is pending (source not read yet), not enforced`);
    if (errors.length) { for (const e of errors) console.error(e); process.exit(1); }
  } else usage();
}
