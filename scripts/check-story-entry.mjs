#!/usr/bin/env node
// check-story-entry: validates a story-keeper reply, so "one short entry, no personal data" is something a script
// can check instead of a claim. The contract (plugins/studio/agents/story-keeper.md, ## Reply) is exactly one of:
//
//   No entry: <why, in a few words>                  (at the start of a line; no ```story block)
//
//   ```story
//   ### 2026-10-28 · Decision: Ship the beta without comments      (real date; Decision | Lesson | Pivot | Win; a title)
//   - Problem: ...                                   (Problem, Chase's call, Decision and why, Result, Story angle:
//   - Chase's call: ...                               each once, non-empty)
//   - Decision and why: ...
//   - Result: ...
//   - Lesson: ...                                    (required for Lesson and Pivot, allowed on any type)
//   - Story angle: ...
//   ```
//   Memory: <the rule, one line>                     (optional, after the block, at most once)
//
// No other labels. 120 words or fewer inside the block, header included. No personal data or secrets in the block,
// the Memory line or the No entry reason: email addresses, phone numbers, claude.ai URLs, trig_/env_/cmsg_/session_ ids,
// API keys (sk-, ghp_/ghs_/gho_/ghu_/ghr_, github_pat_, xoxb-/xoxp-). The rest of the reply is scanned for the same
// leaks. Inside the block, a line that starts with "- " must be a known label; any other line continues the field above it.
//
// Usage: node scripts/check-story-entry.mjs <reply.md> [--json]
//   --json   print {kind: "entry"|"none", type, date, title, words, fields: {<label>: <text>}, memory} on stdout
// Exit 0 when valid; 1 with one reason per line on stderr; 2 on a usage error or unreadable file.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TYPES = ["Decision", "Lesson", "Pivot", "Win"];
export const LABELS = ["Problem", "Chase's call", "Decision and why", "Result", "Lesson", "Story angle"];
export const REQUIRED = ["Problem", "Chase's call", "Decision and why", "Result", "Story angle"];
export const MAX_WORDS = 120;
const USAGE = "usage: check-story-entry.mjs <reply.md> [--json]";

// Personal data and secret shapes. Each message names what it found, never the value itself.
export const LEAKS = [
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/, "an email address"],
  [/(?<![\w+])(?:\+\d{1,3}[ .-]?)?(?:\(\d{3}\)[ .-]?|\d{3}[ .-])?\d{3}[ .-]\d{4}(?!\w|[.-]\d)/, "a phone number"],
  [/(?:https?:\/\/)?(?:[\w-]+\.)*claude\.ai\b\S*/i, "a claude.ai link"],
  [/\btrig_[A-Za-z0-9]{10,}/, "a trig_ id"],
  [/\benv_[A-Za-z0-9]{10,}/, "an env_ id"],
  [/\bcmsg_[A-Za-z0-9]{10,}/, "a cmsg_ id"],
  [/\bsession_[A-Za-z0-9]{10,}/, "a session_ id"],
  [/\bsk-[A-Za-z0-9_-]{10,}/, "an API key (sk-)"],
  [/\bghp_[A-Za-z0-9]{10,}/, "an API key (ghp_)"],
  [/\bgithub_pat_[A-Za-z0-9_]{10,}/, "an API key (github_pat_)"],
  [/\bgh[sour]_[A-Za-z0-9]{10,}/, "an API key (GitHub token)"],
  [/\bxox[bp]-[A-Za-z0-9-]{10,}/, "an API key (Slack token)"],
];

const realDate = (d) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
  if (!m) return false;
  const t = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return t.getUTCFullYear() === +m[1] && t.getUTCMonth() === +m[2] - 1 && t.getUTCDate() === +m[3];
};
const label = (l) => l.replace(/’/g, "'").trim();
const leaks = (where, text) => LEAKS.filter(([re]) => re.test(text)).map(([, what]) => `${where} has ${what}: personal data and secrets never go in a story entry`);

// Returns { entry: {kind, type, date, title, words, fields, memory} | null, errors: [string] }.
export function checkStoryEntry(text) {
  const lines = text.split(/\r?\n/);
  const errors = [];
  const blocks = [];
  let open = null;
  lines.forEach((line, i) => {
    if (open === null && /^```story[ \t]*$/.test(line)) open = i;
    else if (open !== null && /^```[ \t]*$/.test(line)) { blocks.push([open, i]); open = null; }
  });
  if (open !== null) return { entry: null, errors: ["unclosed ```story block: end it with a line of ```"] };
  const inBlock = (i) => blocks.some(([a, b]) => i >= a && i <= b);
  const noEntry = lines.map((l, i) => [l, i]).filter(([l, i]) => !inBlock(i) && /^No entry:/.test(l));
  const memories = lines.map((l, i) => [l, i]).filter(([l, i]) => !inBlock(i) && /^Memory:/.test(l));
  // The rest of the reply (the "appended to" line, anything stray) is scanned too: a leak anywhere is a leak.
  const rest = lines.filter((l, i) => !inBlock(i) && !/^(?:No entry|Memory):/.test(l));
  errors.push(...leaks("reply outside the block", rest.join("\n")));

  if (noEntry.length && blocks.length) return { entry: null, errors: ["both a No entry: line and a ```story block: reply with one or the other"] };
  if (!noEntry.length && !blocks.length) return { entry: null, errors: ["neither a ```story block nor a No entry: <reason> line: reply with exactly one"] };
  if (blocks.length > 1) return { entry: null, errors: [`${blocks.length} \`\`\`story blocks: one moment, one entry (exactly one block)`] };

  let memory = null;
  if (memories.length > 1) errors.push(`${memories.length} Memory: lines: at most one`);
  if (memories.length) {
    const [line, i] = memories[0];
    memory = line.replace(/^Memory:/, "").trim();
    if (!memory) errors.push("Memory: line is empty: give the rule, one line");
    else errors.push(...leaks("Memory: line", memory));
    if (blocks.length && i < blocks[0][0]) errors.push("Memory: line comes before the ```story block: put it after");
  }

  if (noEntry.length) {
    if (noEntry.length > 1) errors.push(`${noEntry.length} No entry: lines: keep one`);
    const reason = noEntry[0][0].replace(/^No entry:/, "").trim();
    if (!reason) errors.push("No entry: line has no reason: say why, in a few words");
    else errors.push(...leaks("No entry: reason", reason));
    return { entry: { kind: "none", reason, memory }, errors };
  }

  const [a, b] = blocks[0];
  const body = lines.slice(a + 1, b);
  if (body.some((l) => /^\s*No entry:/.test(l))) errors.push("a No entry: line inside the ```story block: reply with one or the other");
  const words = body.join(" ").split(/\s+/).filter(Boolean).length;
  if (words > MAX_WORDS) errors.push(`entry has ${words} words, max ${MAX_WORDS} (header included): cut it`);
  errors.push(...leaks("entry", body.join("\n")));

  let type = null, date = null, title = null;
  const content = body.map((l, i) => [l.trim(), i]).filter(([l]) => l);
  const headerAt = content.length ? content[0] : null;
  const h = headerAt && /^###\s+(\S+)\s+·\s+([^:]+?)\s*:\s*(.*)$/.exec(headerAt[0]);
  if (!h) errors.push("missing header: the block starts with ### YYYY-MM-DD · Decision|Lesson|Pivot|Win: <title>");
  else {
    [, date, type, title] = h;
    title = title.trim();
    if (!realDate(date)) errors.push(`header date "${date}" is not a real YYYY-MM-DD date`);
    if (!TYPES.includes(type)) errors.push(`header type "${type}" must be one of: ${TYPES.join(", ")}`);
    if (!title) errors.push("header has an empty title: name the moment");
  }

  const fields = {};
  let last = null;
  for (const [line] of content.slice(h ? 1 : 0)) {
    if (/^No entry:/.test(line)) { last = null; continue; }
    const f = /^-\s+([^:]+):(.*)$/.exec(line);
    if (!f && /^-\s/.test(line)) { errors.push(`a "- " line has no known label: start it with one of ${LABELS.join(", ")} and a colon`); last = null; continue; }
    if (f) {
      const name = label(f[1]);
      if (!LABELS.includes(name)) { errors.push(`unknown label "${name}": use only ${LABELS.join(", ")}`); last = null; continue; }
      if (name in fields) { errors.push(`duplicate ${name}: line: each field appears once`); last = null; continue; }
      fields[name] = f[2].trim();
      last = name;
    } else if (last) fields[last] = `${fields[last]} ${line}`.trim();
    else errors.push(`line "${line}" is not a field: use "- <label>: <text>"`);
  }
  const need = TYPES.includes(type) && (type === "Lesson" || type === "Pivot") ? [...REQUIRED, "Lesson"] : REQUIRED;
  for (const name of need) {
    if (!(name in fields)) errors.push(`missing - ${name}: line${name === "Lesson" ? ` (required for a ${type})` : ""}`);
  }
  for (const [name, val] of Object.entries(fields)) if (!val) errors.push(`${name}: is empty: fill it in (Result can say "pending")`);
  const ordered = Object.fromEntries(LABELS.filter((n) => n in fields).map((n) => [n, fields[n]]));
  return { entry: { kind: "entry", type, date, title, words, fields: ordered, memory }, errors };
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
  const { entry, errors } = checkStoryEntry(text);
  if (json && entry) console.log(JSON.stringify(entry, null, 2));
  for (const e of errors) console.error(e);
  process.exit(errors.length ? 1 : 0);
}
