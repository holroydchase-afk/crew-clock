#!/usr/bin/env node
// Inbox for real-world agent misses: classify a reported issue into UX, Staff PM or QA-TDD, record it, track its eval case.
//   node tools/triage-report.mjs add --product P --lane ux [--lane qa-tdd] --summary "..." [--evidence x] [--confirmed yes|no|unchecked] [--pattern tag]
//   node tools/triage-report.mjs suggest "report text"      keyword hint for the lane (a hint, not the decision)
//   node tools/triage-report.mjs list [--lane l] [--status s]
//   node tools/triage-report.mjs status RPT-n open|case-added|rejected [--case name]
//   node tools/triage-report.mjs --check                    validate the inbox
// Store: $TRIAGE_REPORTS_DIR/inbox.jsonl (default evals/reports). Split alternates dev, heldout per lane.
import fs from "node:fs";
import path from "node:path";

const LANES = ["ux", "staff-pm", "qa-tdd"];
const ALIAS = { pm: "staff-pm", qa: "qa-tdd" };
const STATUSES = ["open", "case-added", "rejected"];
const CONFIRMED = ["yes", "no", "unchecked"];
const NEXT = {
  ux: "ux: add plugins/studio/evals/ux-reviewer-fresh-real-<product>-<screen> from the real screenshot (prompt must not hint at the problem)",
  "staff-pm": "staff-pm: add a case to evals/agent-misses/staff-pm-cases-batch<n>.mjs (a spec that lacks the case)",
  "qa-tdd": "qa-tdd: add a rebuilt repro to evals/agent-misses/qa-tdd-cases-batch<n>.mjs (shipped test green, gap test red)",
};
const RULES = [
  ["ux", /overlap|layout|contrast|tap target|wording|confusing|ugly|screenshot|looks|spacing|truncat|too small|font|color|colour/i],
  ["staff-pm", /missing requirement|spec|scope|criteri|should have asked|forgot to plan|not specified|edge case not/i],
  ["qa-tdd", /wrong number|crash|regression|broke|passes tests|test missed|flaky|shipped bug|error|exception/i],
];
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const PHONE = /(?:\+?\d[\s.-]?)?(?:\(\d{3}\)|\d{3})[\s.-]?\d{3}[\s.-]?\d{4}/;

const dir = () => process.env.TRIAGE_REPORTS_DIR || path.join("evals", "reports");
const file = () => path.join(dir(), "inbox.jsonl");
const die = (msg) => { console.error(msg); process.exit(1); };
const privacy = (...vals) => vals.some((v) => v && (EMAIL.test(v) || PHONE.test(v)));

function read() {
  if (!fs.existsSync(file())) return [];
  return fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
}
const write = (entries) => { fs.mkdirSync(dir(), { recursive: true }); fs.writeFileSync(file(), entries.map((e) => JSON.stringify(e)).join("\n") + "\n"); };

function parse(argv) {
  const o = { _: [], lane: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), v = argv[i + 1];
      if (k === "check") o.check = true;
      else { i++; if (k === "lane") o.lane.push(v); else o[k] = v; }
    } else o._.push(a);
  }
  return o;
}

const [cmd0, ...rest] = process.argv.slice(2);
const o = parse(process.argv.slice(2));
const cmd = o.check ? "check" : cmd0;

if (cmd === "add") {
  const lanes = [...new Set(o.lane.map((l) => ALIAS[l] || l))];
  if (!o.product || !o.product.trim()) die("product is required");
  if (!lanes.length) die("at least one --lane is required (ux, staff-pm, qa-tdd)");
  const badLane = lanes.find((l) => !LANES.includes(l));
  if (badLane) die(`unknown lane: ${badLane} (use ux, staff-pm, qa-tdd)`);
  if (!o.summary || !o.summary.trim()) die("summary is required");
  const confirmed = o.confirmed ?? "unchecked";
  if (!CONFIRMED.includes(confirmed)) die(`confirmed must be one of ${CONFIRMED.join(", ")}`);
  if (privacy(o.summary, o.evidence)) die("privacy: summary and evidence must not contain an email address or phone number");
  const entries = read();
  const split = {};
  for (const l of lanes) split[l] = entries.filter((e) => e.lanes.includes(l)).length % 2 === 0 ? "dev" : "heldout";
  const entry = {
    id: `RPT-${entries.length + 1}`, date: new Date().toISOString().slice(0, 10), product: o.product, lanes,
    summary: o.summary.trim(), evidence: o.evidence ?? "", confirmed, pattern: o.pattern ?? "", split, status: "open", case: null,
  };
  write([...entries, entry]);
  console.log(JSON.stringify(entry));
  for (const l of lanes) console.error(NEXT[l]);
} else if (cmd === "suggest") {
  const text = o._.slice(1).join(" ");
  const lanes = [], reasons = [];
  for (const [lane, re] of RULES) { const m = text.match(re); if (m) { lanes.push(lane); reasons.push(`${lane}: matched "${m[0]}"`); } }
  console.log(JSON.stringify(lanes.length ? { lanes, reasons } : { lanes: [], reasons: ["no keyword match: route by hand"] }));
} else if (cmd === "list") {
  for (const e of read()) {
    if (o.lane[0] && !e.lanes.includes(ALIAS[o.lane[0]] || o.lane[0])) continue;
    if (o.status && e.status !== o.status) continue;
    console.log(`${e.id} | ${e.product} | ${e.lanes.join(",")} | ${e.status} | ${e.summary}`);
  }
} else if (cmd === "status") {
  const [, id, status] = o._;
  if (!STATUSES.includes(status)) die(`status must be one of ${STATUSES.join(", ")}`);
  if (status === "case-added" && !o.case) die("--case <name> is required for case-added");
  const entries = read();
  const e = entries.find((x) => x.id === id);
  if (!e) die(`unknown id: ${id}`);
  e.status = status;
  if (o.case) e.case = o.case;
  write(entries);
  console.log(JSON.stringify(e));
} else if (cmd === "check") {
  if (!fs.existsSync(file())) process.exit(0);
  const bad = [];
  fs.readFileSync(file(), "utf8").split("\n").filter(Boolean).forEach((l, i) => {
    const n = i + 1, why = (m) => bad.push(`line ${n}: ${m}`);
    let e; try { e = JSON.parse(l); } catch { return why("cannot parse JSON"); }
    if (e.id !== `RPT-${n}`) why(`id ${e.id} is not sequential (want RPT-${n})`);
    if (!Array.isArray(e.lanes) || !e.lanes.length || e.lanes.some((x) => !LANES.includes(x))) why("lane missing or unknown");
    else if (!e.split || Object.keys(e.split).sort().join() !== [...e.lanes].sort().join()) why("split does not match lanes");
    if (privacy(e.summary, e.evidence)) why("email or phone number in summary or evidence");
    if (!e.summary) why("empty summary");
  });
  if (bad.length) die(bad.join("\n"));
} else die("usage: triage-report.mjs add|suggest|list|status|--check");
