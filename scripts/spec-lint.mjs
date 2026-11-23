#!/usr/bin/env node
// spec-lint: flags the gaps staff-pm keeps missing in a spec (docs/product/SPEC-SPEC-LINT.md, rules SL-1..SL-11).
// check-spec says the ```spec block is well formed; spec-lint says the spec is not missing a pinned clock, an empty
// case, a rollback, a phone height budget, a measured bar, both auth cases, a released-version check, the stale
// artifacts in a done list, or a P0 for a privacy or unreleased-claim risk. Keywords and structure only: no model,
// no network, no clock, nothing written to disk.
//
// Usage: node tools/spec-lint.mjs <spec.md> [--json] [--rules SL-1,SL-3]
//   Exit 0 no findings; 1 findings, one per line on stderr as "<file>:<line> SL-n name: message";
//   2 usage error, unreadable file, no spec block, or a block that fails check-spec (its errors are printed).
//   --json   also prints {findings:[{rule,line,message}], waived:[{rule,line,reason}]} on stdout
//   --rules  only run the listed rules
// Waiver: a prose line "lint-ok: SL-3 <reason>" silences SL-3 for the file and is listed under waived. A waiver
// with no reason silences nothing and is itself a finding.
//
// Regions: the last spec block's criterion: and step: lines, and the prose above it (after the previous block when
// a file has several). Markdown headings are titles and lines inside other ``` fences are code, so neither is
// prose. CRLF and LF read the same.
// Keywords match whole words, case-insensitive: "released" is not "release", "summary" is not "sum", and an ID such
// as LIST-1 is not the word "list". Triggers are exact words; requirements may be looser (any "revert..." counts).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkSpec } from "./check-spec.mjs";

// Whole-word, case-insensitive matcher for a list of words or phrases. A word next to a letter, digit, "_" or a
// leading "-" is not a match, and neither is a word followed by "-<digit>" (an ID such as LIST-1).
function words(...list) {
  const alt = list.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+")).join("|");
  return new RegExp(`(?<![\\w-])(?:${alt})(?![\\w]|-\\d)`, "i");
}
const any = (...res) => ({ test: (s) => res.some((r) => r.test(s)) });

// ---- The keyword table. A new miss is one new row here, plus a failing and a passing fixture. ----
const K = {
  clock: words("today", "tonight", "now", "yesterday", "tomorrow", "this week", "last week", "next week", "this month",
    "per day", "weekday", "weekdays", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "january", "february", "march", "april", "june", "july", "august", "september", "october", "november", "december"),
  pinned: any(/\b\d{4}-\d{2}-\d{2}\b/, words("pinned", "fixed clock", "clock of")),
  numbers: words("count", "total", "totals", "sum", "average", "list", "lists", "rows", "items", "price", "prices"),
  emptyCase: words("zero", "empty", "none", "missing", "no items", "no rows", "no entries"),
  public: any(words("public", "live", "deploy", "deploys", "publish", "publishes", "release", "releases"), /(?<![\w-])Pages\b/),
  rollback: /\brollbacks?\b|\broll(?:s|ed)?\s+back\b|\brevert\w*|\bundo\w*/i,
  phone: any(words("phone", "phones", "mobile", "viewport"), /(?<![\w.-])\d{3,4}\s?px\b/i),
  heightBudget: any(/\d+(?:\.\d+)?\s*(?:px\s+)?screens?\b/i, /\d+\s*px\s+(?:tall|high)\b/i, /\bby\s+\d+\s*px\b/i,
    /\b\d+\s*[x×]\s*\d+\s*px\b/i, /\bheight\b[^.|]*\d/i, /\babove\s+the\s+fold\b/i,
    /\b\d+\s+scrolls?\b/i),
  claim: words("safety", "safe", "fair", "fairness", "unfair", "accuracy", "accurate", "works for"),
  measuredBar: any(/\d+(?:\.\d+)?\s*%/, words("percent", "share of", "rate"), /\bat\s+least\s+\d+/i, /\b\d+\s+(?:out\s+)?of\s+\d+\b/i),
  auth: words("login", "log in", "log-in", "sign-in", "sign in", "signin", "privacy", "owner-only", "owner only",
    "permission", "permissions"),
  signedOut: any(words("signed out", "signed-out", "logged out", "logged-out", "not signed in", "anonymous"), /\bno\s+session\b/i),
  otherUser: any(/\banother\b[^.|]{0,25}\b(?:user|account|member|owner)s?\b/i, words("different user", "different account",
    "non-owner", "other user", "other account", "second user", "second account", "not the owner")),
  copy: words("readme", "copy", "landing", "quickstart", "claim", "claims"),
  doneLine: /\bdone\s+(?:when|list)\b/i,
  released: words("registry", "released", "release", "published", "tag", "npm"),
  codeOrTests: words("code", "test", "tests"),
  artifacts: any(words("readme", "screenshot", "screenshots", "docs", "doc page", "changelog", "case study", "case studies")),
  riskRank: /(?<![\w-])P[12](?![\w]|-\d)/,
  privacyRisk: words("privacy", "private", "personal", "personal data", "secret", "secrets", "token", "tokens", "password",
    "credential", "credentials", "leak", "leaks", "live data", "unreleased", "not released"),
  newRule: words("red flag", "red-flag", "penalty", "penalties", "detector", "flag rule", "scoring rule", "auto-flag"),
  feedback: words("mark", "marks", "wrong", "dismiss", "dismisses", "false positive", "false positives", "override", "overrides",
    "feedback", "skip reason", "review the hits", "reviews the hits", "reject", "rejects", "rejected", "note", "reason", "reasons"),
  samplesOnly: words("saved sample", "saved samples", "sample files", "fixtures", "samples"),
  liveish: words("live", "adapter", "feed"),
  liveRun: any(words("first live run", "live run", "real run", "real host"), /\bfirst\s+run\s+against\b/i, /\bon\s+a\s+(?:machine|laptop)\b/i, /\breal\s+(?:api|host|source|service)\b/i),
};

// One row per finding a rule can raise. mode "file": one finding at the first trigger line when the requirement is
// nowhere in its region. mode "line": one finding per trigger line whose requirement is not on that same line.
// where: regions the trigger is read from (prose, criteria, steps); needIn: where the requirement is read from
// ("same" = that line, "all" = the whole file). when: every matcher must hit; skip: trigger lines to ignore.
export const RULES = [
  { id: "SL-1", name: "pinned-clock", mode: "line", where: ["criteria"], when: [K.clock], unless: K.pinned, needIn: "same",
    message: "this criterion depends on today, a weekday, a month or a per-day window but has no pinned clock: add one to it (an ISO date, \"a clock of ...\" or \"fixed clock\")" },
  { id: "SL-2", name: "empty-input", mode: "file", where: ["prose", "criteria", "steps"], when: [K.numbers], unless: K.emptyCase, needIn: ["criteria"],
    message: "the spec handles counts, totals or lists but no criterion covers the empty case: add one for zero, empty, none or missing input" },
  { id: "SL-3", name: "rollback", mode: "file", where: ["prose", "criteria", "steps"], when: [K.public], unless: K.rollback, needIn: "all",
    message: "the spec ships something public or live but has no rollback: add a line saying how to roll back (revert the merge commit and redeploy, or a flag)" },
  { id: "SL-4", name: "phone-budget", mode: "file", where: ["prose", "criteria", "steps"], when: [K.phone], unless: K.heightBudget, needIn: ["prose", "criteria", "steps"],
    message: "the spec targets a phone or a viewport width but has no height budget: add a criterion with a height or screen count (for example \"at most 2 screens tall at 360px by 640px\")" },
  { id: "SL-5", name: "measured-bar", mode: "file", where: ["prose", "criteria", "steps"], when: [K.claim], unless: K.measuredBar, needIn: ["criteria"],
    message: "the spec makes a safety, fairness or accuracy claim but no criterion measures it: add one with a rate, a percent or \"at least N of M\"" },
  { id: "SL-6", name: "auth-cases", mode: "file", where: ["prose", "criteria", "steps"], when: [K.auth], unless: K.signedOut, needIn: ["criteria"],
    message: "the spec changes sign-in, privacy or owner-only behavior but no criterion covers a signed-out visitor: add one" },
  { id: "SL-6", name: "auth-cases", mode: "file", where: ["prose", "criteria", "steps"], when: [K.auth], unless: K.otherUser, needIn: ["criteria"],
    message: "the spec changes sign-in, privacy or owner-only behavior but no criterion covers a different user (another account, a non-owner): add one" },
  { id: "SL-7", name: "claim-parity", mode: "file", where: ["prose", "criteria", "steps"], skip: K.doneLine, when: [K.copy], unless: K.released, needIn: ["criteria", "steps"],
    message: "the spec changes README, landing or copy claims but no criterion or step checks them against the released version: add one (for example every quickstart command exits 0 on the registry version)" },
  { id: "SL-8", name: "stale-artifacts", mode: "line", where: ["prose", "criteria", "steps"], when: [K.doneLine, K.codeOrTests], unless: K.artifacts, needIn: "same",
    message: "this done definition names code or tests but no public artifact: list each one it makes stale (README, screenshots, docs, changelog, case study)" },
  { id: "SL-9", name: "risk-rank", mode: "line", where: ["prose"], when: [K.riskRank, K.privacyRisk], unless: null, needIn: "same",
    message: "a privacy, personal-data, secret, live-data or unreleased-claim risk is ranked P1 or P2: rank it P0" },
  { id: "SL-10", name: "feedback-loop", mode: "file", where: ["prose", "criteria", "steps"], when: [K.newRule], unless: K.feedback, needIn: ["criteria"],
    message: "the spec adds a rule, penalty, flag or detector but no criterion covers a feedback loop: add one for how the owner marks a hit wrong (with a reason) and how the hits are reviewed" },
  { id: "SL-11", name: "samples-only", mode: "file", where: ["prose", "criteria", "steps"], when: [K.samplesOnly, K.liveish], unless: K.liveRun, needIn: "all",
    message: "the spec leans on saved samples or fixtures for something live: add a named step or criterion for a first live run on a machine that can reach the real source, saying which kinds of data the samples lack" },
];
export const RULE_IDS = [...new Set(RULES.map((r) => r.id))];
const NAME = Object.fromEntries(RULES.map((r) => [r.id, r.name]));
const ruleNum = (id) => Number(id.slice(3));
const USAGE = "usage: spec-lint.mjs <spec.md> [--json] [--rules SL-1,SL-3]";

// Splits the file into the regions lint reads. Lines are { n (1-based), text }.
function regions(lines) {
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    if (open === null && /^```spec[ \t]*$/.test(line)) open = i;
    else if (open !== null && /^```[ \t]*$/.test(line)) { blocks.push([open, i]); open = null; }
  });
  const [a, b] = blocks[blocks.length - 1];
  const from = blocks.length > 1 ? blocks[blocks.length - 2][1] + 1 : 0;
  const prose = [];
  let fence = false;
  for (let i = from; i < a; i++) {
    if (/^\s*```/.test(lines[i])) { fence = !fence; continue; }
    if (!fence && !/^\s*#/.test(lines[i])) prose.push({ n: i + 1, text: lines[i] });
  }
  const criteria = [], steps = [];
  for (let i = a + 1; i < b; i++) {
    const m = /^\s*(criterion|step)\s*:\s*(.*)$/i.exec(lines[i]);
    if (m) (m[1].toLowerCase() === "criterion" ? criteria : steps).push({ n: i + 1, text: m[2] });
  }
  return { prose, criteria, steps, all: lines.map((text, i) => ({ n: i + 1, text })), blockLine: a + 2 };
}

// Lints one spec. Returns { findings: [{rule, name, line, message}], waived: [{rule, line, reason}], errors }.
// errors holds the check-spec errors; when there are any, nothing is linted.
export function lintSpec(text, { rules = RULE_IDS } = {}) {
  const { errors } = checkSpec(text);
  if (errors.length) return { findings: [], waived: [], errors };
  const lines = text.split(/\r?\n/);
  const R = regions(lines);
  const pick = (names) => names.flatMap((w) => R[w]).sort((x, y) => x.n - y.n);

  const waived = [], findings = [], silenced = new Set();
  for (const { n, text: t } of R.prose) {
    const m = /^\s*lint-ok:\s*(SL-\d+)\b(.*)$/i.exec(t);
    if (!m) continue;
    const rule = m[1].toUpperCase(), reason = m[2].trim();
    if (!rules.includes(rule)) continue;
    if (/[A-Za-z]/.test(reason)) { waived.push({ rule, line: n, reason }); silenced.add(rule); }
    else findings.push({ rule, name: NAME[rule] || "waiver", line: n,
      message: `the waiver "lint-ok: ${rule}" has no reason, so it silences nothing: write "lint-ok: ${rule} <reason>" or fix the gap` });
  }

  for (const r of RULES) {
    if (!rules.includes(r.id) || silenced.has(r.id)) continue;
    const triggers = pick(r.where).filter((l) => !(r.skip && r.skip.test(l.text)) && r.when.every((k) => k.test(l.text)));
    if (!triggers.length) continue;
    if (r.mode === "line") {
      for (const l of triggers) if (!r.unless || !r.unless.test(l.text)) findings.push({ rule: r.id, name: r.name, line: l.n, message: r.message });
    } else {
      const pool = r.needIn === "all" ? R.all : pick(r.needIn);
      if (!pool.some((l) => r.unless.test(l.text))) findings.push({ rule: r.id, name: r.name, line: triggers[0].n || R.blockLine, message: r.message });
    }
  }
  findings.sort((x, y) => x.line - y.line || ruleNum(x.rule) - ruleNum(y.rule));
  return { findings, waived, errors: [] };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const args = process.argv.slice(2);
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); process.exit(0); }
  const fail = (msg) => { console.error(msg); process.exit(2); };
  let json = false, rules = RULE_IDS;
  const files = [];
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--json") json = true;
    else if (a === "--rules" || a.startsWith("--rules=")) {
      const val = a === "--rules" ? args[++i] : a.slice(8);
      if (val === undefined || !val.trim()) fail(`--rules needs a list such as SL-1,SL-3\n${USAGE}`);
      rules = val.split(",").map((s) => s.trim().toUpperCase());
      const bad = rules.filter((id) => !RULE_IDS.includes(id));
      if (bad.length) fail(`unknown rule ${bad.join(", ")}: the rules are ${RULE_IDS.join(", ")}`);
    } else if (a.startsWith("-")) fail(`unknown option ${a}\n${USAGE}`);
    else files.push(a);
  }
  if (files.length !== 1) fail(USAGE);
  let text;
  try { text = readFileSync(files[0], "utf8"); } catch { fail(`can't read ${files[0]}`); }
  const { findings, waived, errors } = lintSpec(text, { rules });
  if (errors.length) { for (const e of errors) console.error(e); process.exit(2); }
  if (json) console.log(JSON.stringify({ findings: findings.map(({ rule, line, message }) => ({ rule, line, message })), waived }, null, 2));
  for (const f of findings) console.error(`${files[0]}:${f.line} ${f.rule} ${f.name}: ${f.message}`);
  process.exit(findings.length ? 1 : 0);
}
