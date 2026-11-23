#!/usr/bin/env node
// Builds the qa-tdd miss eval cases from evals/agent-misses/qa-tdd-cases.mjs.
//   node tools/eval-miss-cases.mjs            write plugins/studio/evals/qa-tdd-miss-<id>/
//   node tools/eval-miss-cases.mjs --check    exit 1 if any generated file is missing, stale or orphaned
//   node tools/eval-miss-cases.mjs --verify   prove each repro: shipped test green, gap test red (needs node --test)
// Generated files are never edited by hand: change the spec, regenerate, commit both.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const EVALS = process.env.EVAL_MISS_EVALS_DIR || path.join(ROOT, "plugins", "studio", "evals");
const PREFIX = "qa-tdd-miss-";
const SRC_TAGS = { cc: "src-cc", es: "src-es", he: "src-he", rr: "src-rr", ch: "src-ch", ck: "src-ck", co: "src-co", ps: "src-ps" };

export function caseFiles(c) {
  const tags = ["qa-tdd", "miss", c.priority.toLowerCase(), SRC_TAGS[c.src], c.pattern, `split-${c.split}`];
  const prompt = `---
description: "miss ${c.miss} (${c.pattern}), ${c.id}"
tags: [${tags.join(", ")}]
runs: 1
max_turns: 25
allowed_tools: [Agent, Read, Write, Edit, Glob, Grep, Bash]
---

Use the studio:qa-tdd agent. ${c.ask} It's done and the test passes. Check it before I merge.

Create these ${c.extra?.length ? ["three","four","five","six","seven","eight"][c.extra.length - 1] ?? "more" : "two"} files in the working directory exactly as written. You can run the suite with \`node --test\`. The shell here only allows commands that start with \`node\`, so run \`node --test\` on its own each time (no \`cd\`, \`&&\` or loops).

\`${c.file}\`:
\`\`\`js
${c.code.trimEnd()}
\`\`\`

\`${c.testFile}\`:
\`\`\`js
${c.test.trimEnd()}
\`\`\`
${(c.extra || []).map((e) => `
\`${e.name}\`:
\`\`\`
${e.content.trimEnd()}
\`\`\`
`).join("")}`;
  const criteria = `---
type: llm
weight: 3
---

Recall of ${c.miss}, a miss we already know was real (pattern: ${c.pattern}). Pass only if the report names this specific gap, ranked ${c.priority} or higher: ${c.gapText}. It must also write a failing test for this gap (${c.gapTest}) and run it red, or show its red output. It must not fix \`${c.file}\`; the fix goes to the engineer. Fail if the gap is missing, ranked lower than ${c.priority}, named without a test that ran red, or fixed in the source. Calling the change ready or green while this gap is open also fails. Other findings don't change the result.
`;
  const dispatched = `---
type: tool_used
tool: Agent
input_match: '"subagent_type"\\s*:\\s*"(?:studio:)?qa-tdd"'
arm: with-only
---
`;
  const dir = path.join(EVALS, PREFIX + c.id);
  return [
    [path.join(dir, "prompt.md"), prompt],
    [path.join(dir, "graders", "criteria.md"), criteria],
    [path.join(dir, "graders", "dispatched.md"), dispatched],
  ];
}

export function validate(cases) {
  const errs = [];
  const ids = new Set();
  for (const c of cases) {
    for (const k of ["id", "miss", "pattern", "priority", "split", "src", "ask", "file", "code", "testFile", "test", "gapName", "gap", "gapText", "gapTest"])
      if (typeof c[k] !== "string" || !c[k].trim()) errs.push(`${c.id ?? "?"}: missing ${k}`);
    if (typeof c.id !== "string" || !/^[a-z0-9-]+$/.test(c.id)) { errs.push(`${c.id}: id must match [a-z0-9-]+`); continue; }
    if (ids.has(c.id)) errs.push(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!/^P[012]$/.test(c.priority)) errs.push(`${c.id}: priority ${c.priority}`);
    if (!["dev", "heldout"].includes(c.split)) errs.push(`${c.id}: split ${c.split}`);
    if (!SRC_TAGS[c.src]) errs.push(`${c.id}: src ${c.src}`);
    if (!/^[A-Z]{2}-[QS]\d+$/.test(c.miss)) errs.push(`${c.id}: miss id ${c.miss}`);
    if (typeof c.code !== "string" || typeof c.test !== "string" || typeof c.ask !== "string") continue;
    if (!/^[a-z0-9-]+$/.test(c.pattern)) errs.push(`${c.id}: pattern must match [a-z0-9-]+`);
    if (c.flaky !== undefined && typeof c.flaky !== "boolean") errs.push(`${c.id}: flaky must be true or false`);
    if (c.extra !== undefined) {
      if (!Array.isArray(c.extra)) errs.push(`${c.id}: extra must be an array`);
      else {
        const seen = new Set([c.file, c.testFile, c.gapName]);
        for (const e of c.extra) {
          if (!e || typeof e.name !== "string" || typeof e.content !== "string") { errs.push(`${c.id}: each extra needs a string name and content`); continue; }
          if (!/^[A-Za-z0-9._/-]+$/.test(e.name) || e.name.startsWith("/") || e.name.split("/").includes("..")) errs.push(`${c.id}: unsafe extra name ${e.name}`);
          if (seen.has(e.name)) errs.push(`${c.id}: extra name ${e.name} duplicates another file`);
          seen.add(e.name);
          if (e.content.includes("```")) errs.push(`${c.id}: a code fence in extra ${e.name} breaks the prompt`);
          if (/\b(gaps?|bugs?|fix(es|ed)?|broken|wrong)\b/i.test(e.content)) errs.push(`${c.id}: extra ${e.name} hints at the gap (words gap/bug/fix/broken/wrong)`);
        }
      }
    }
    if (c.code.trimEnd().split("\n").length > 25) errs.push(`${c.id}: source over 25 lines`);
    if (new Set([c.file, c.testFile, c.gapName]).size !== 3) errs.push(`${c.id}: file, testFile and gapName must differ`);
    for (const f of [c.file, c.testFile, c.gapName]) if (!/^[a-z0-9.-]+\.mjs$/.test(f ?? "")) errs.push(`${c.id}: bad file name ${f}`);
    if ((c.code + c.test + c.ask).includes("```")) errs.push(`${c.id}: a code fence in code, test or ask breaks the prompt`);
    if (/\b(gaps?|bugs?|fix(es|ed)?|broken|wrong)\b/i.test(c.code + c.test + c.ask)) errs.push(`${c.id}: repro or ask hints at the gap (words gap/bug/fix/broken/wrong)`);
  }
  return errs;
}

const PM_PREFIX = "staff-pm-miss-";

export function pmCaseFiles(c) {
  const hasRepo = c.repo && typeof c.repo === "object" && !Array.isArray(c.repo) && Object.keys(c.repo).length > 0;
  const repoNote = hasRepo ? "\nThe repo is in the working directory. Read what you need from it.\n" : "";
  const tags = ["staff-pm", "miss", c.priority.toLowerCase(), SRC_TAGS[c.src], c.pattern, `split-${c.split}`];
  const prompt = `---
description: "miss ${c.miss} (${c.pattern}), ${c.id}"
tags: [${tags.join(", ")}]
runs: 1
max_turns: 20
allowed_tools: [Agent, Read, Glob, Grep]
---

Use the studio:staff-pm agent. ${c.ask}
${repoNote}
What the repo already says:
${c.context}
`;
  const criteria = `---
type: llm
weight: 3
---

Recall of ${c.miss}, a spec miss we already know was real (pattern: ${c.pattern}). The answer (a spec, plan or go/no-go verdict) must give testable criteria or evidence-based verdicts, and it passes only if it explicitly includes: ${c.mustCover}. Generic criteria, or a mention in passing with nothing testable, do not count. Rank at ${c.priority} or higher where it ranks anything. Other content doesn't change the result.
`;
  const dispatched = `---
type: tool_used
tool: Agent
input_match: '"subagent_type"\\s*:\\s*"(?:studio:)?staff-pm"'
arm: with-only
---
`;
  const dir = path.join(EVALS, PM_PREFIX + c.id);
  const out = [
    [path.join(dir, "prompt.md"), prompt],
    [path.join(dir, "graders", "criteria.md"), criteria],
    [path.join(dir, "graders", "dispatched.md"), dispatched],
  ];
  if (hasRepo) {
    out.push([path.join(dir, "case.yaml"), `schema_version: "1.1"\nname: ${PM_PREFIX}${c.id}\ncontext:\n  scaffold_script: setup.sh\n`]);
    out.push([path.join(dir, "setup.sh"), `#!/bin/bash\n# Copies the fixture repo into the working directory. Needs --scaffold.\ncp -R "$(dirname "$0")/fixture/." .\n`]);
    for (const [rel, body] of Object.entries(c.repo)) out.push([path.join(dir, "fixture", ...rel.split("/")), body]);
  }
  return out;
}

function repoErrors(id, repo) {
  if (repo === undefined) return [];
  if (!repo || typeof repo !== "object" || Array.isArray(repo) || Object.keys(repo).length === 0) return [`${id}: repo must be a non-empty object of path to text`];
  const errs = [];
  for (const [rel, body] of Object.entries(repo)) {
    const parts = rel.split("/");
    if (!rel || rel.startsWith("/") || parts.some((x) => x === ".." || x === "." || x === "")) errs.push(`${id}: repo path ${JSON.stringify(rel)} must be relative and stay inside the fixture`);
    if (typeof body !== "string") errs.push(`${id}: repo file ${rel} must be text`);
  }
  return errs;
}

export function validatePm(cases) {
  const errs = [];
  const ids = new Set();
  for (const c of cases) {
    for (const k of ["id", "miss", "pattern", "priority", "split", "src", "ask", "context", "mustCover"])
      if (typeof c[k] !== "string" || !c[k].trim()) errs.push(`${c.id ?? "?"}: missing ${k}`);
    if (typeof c.id !== "string" || !/^[a-z0-9-]+$/.test(c.id)) { errs.push(`${c.id}: id must match [a-z0-9-]+`); continue; }
    if (ids.has(c.id)) errs.push(`duplicate id ${c.id}`);
    ids.add(c.id);
    if (!/^P[012]$/.test(c.priority)) errs.push(`${c.id}: priority ${c.priority}`);
    if (!["dev", "heldout"].includes(c.split)) errs.push(`${c.id}: split ${c.split}`);
    if (!SRC_TAGS[c.src]) errs.push(`${c.id}: src ${c.src}`);
    if (!/^[A-Z]{2}-[QS]\d+$/.test(c.miss)) errs.push(`${c.id}: miss id ${c.miss}`);
    errs.push(...repoErrors(c.id, c.repo));
    if (typeof c.ask !== "string" || typeof c.context !== "string") continue;
    if (/\b(gaps?|bugs?|fix(es|ed)?|broken|wrong)\b/i.test(c.ask + " " + c.context)) errs.push(`${c.id}: ask or context hints at the miss`);
    if (c.mustCover.includes("```")) errs.push(`${c.id}: a code fence in mustCover`);
    if (!/^[a-z0-9-]+$/.test(c.pattern)) errs.push(`${c.id}: pattern must match [a-z0-9-]+`);
    if ((c.ask + c.context).includes("```")) errs.push(`${c.id}: a code fence breaks the prompt`);
  }
  return errs;
}

function filesUnder(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesUnder(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}

function extras(c, files = caseFiles, prefix = PREFIX) {
  const want = new Set(files(c).map(([p]) => p));
  return filesUnder(path.join(EVALS, prefix + c.id)).filter((f) => !want.has(f));
}

function write(cases, files = caseFiles, prefix = PREFIX) {
  for (const c of cases) {
    for (const f of extras(c, files, prefix)) fs.rmSync(f);
    for (const [p, body] of files(c)) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, body);
    }
  }
}

function check(cases, files = caseFiles, prefix = PREFIX) {
  const bad = [];
  for (const c of cases) for (const [p, body] of files(c)) {
    if (!fs.existsSync(p)) bad.push(`missing ${path.relative(ROOT, p)}`);
    else if (fs.readFileSync(p, "utf8") !== body) bad.push(`stale ${path.relative(ROOT, p)}`);
  }
  for (const c of cases) for (const f of extras(c, files, prefix)) bad.push(`extra ${path.relative(ROOT, f)}`);
  const want = new Set(cases.map((c) => prefix + c.id));
  for (const d of fs.readdirSync(EVALS)) if (d.startsWith(prefix) && !want.has(d)) bad.push(`orphan ${d}`);
  return bad;
}

// Runs `node --test` in dir with the TAP reporter; returns { status, out, pass, fail }.
function nodeTest(dir, files) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // set when this tool itself runs under node --test; it would make the child run vacuous
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd: dir, encoding: "utf8", env, timeout: 30000 });
  const out = (r.stdout || "") + (r.stderr || "");
  const num = (k) => Number((out.match(new RegExp(`^# ${k} (\\d+)`, "m")) || [])[1] || 0);
  return { status: r.status, timedOut: r.error?.code === "ETIMEDOUT", out, pass: num("pass"), fail: num("fail") };
}

function verify(cases) {
  const bad = [];
  for (const c of cases) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "missrepro-"));
    try {
      for (const e of Array.isArray(c.extra) ? c.extra : []) {
        fs.mkdirSync(path.dirname(path.join(dir, e.name)), { recursive: true });
        fs.writeFileSync(path.join(dir, e.name), e.content);
      }
      fs.writeFileSync(path.join(dir, c.file), c.code);
      fs.writeFileSync(path.join(dir, c.testFile), c.test);
      fs.writeFileSync(path.join(dir, c.gapName), c.gap);
      let shipped = nodeTest(dir, [c.testFile]);
      // a flaky case's shipped test fails by chance: retry up to 5 times and accept the first pass
      for (let n = 1; c.flaky === true && n < 5 && (shipped.status !== 0 || shipped.pass < 1) && !shipped.timedOut; n++) shipped = nodeTest(dir, [c.testFile]);
      if (shipped.timedOut) bad.push(`${c.id}: the shipped test timed out`);
      else if (shipped.status !== 0 || shipped.pass < 1) bad.push(`${c.id}: the shipped test does not pass (pass ${shipped.pass}, fail ${shipped.fail})`);
      const gap = nodeTest(dir, [c.gapName]);
      if (gap.timedOut) bad.push(`${c.id}: the gap test timed out`);
      else if (gap.status === 0) bad.push(`${c.id}: the gap test passes, so the repro has no gap`);
      else if (gap.fail < 1 || /ERR_MODULE_NOT_FOUND|SyntaxError|does not provide an export|ReferenceError/.test(gap.out))
        bad.push(`${c.id}: the gap test is red for the wrong reason (an import, syntax or reference error, not the bug)`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }
  return bad;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const specUrl = (env, name) => pathToFileURL(process.env[env] || path.join(ROOT, "evals", "agent-misses", name)).href;
  const { QA_CASES } = await import(specUrl("EVAL_MISS_SPEC", "qa-tdd-cases.mjs"));
  const { PM_CASES } = await import(specUrl("EVAL_MISS_PM_SPEC", "staff-pm-cases.mjs"));
  const mode = process.argv[2] || "write";
  if (process.argv.length > 3 || !["write", "--check", "--verify"].includes(mode)) {
    console.error("usage: node tools/eval-miss-cases.mjs [--check | --verify]");
    process.exit(2);
  }
  const errs = [...validate(QA_CASES), ...validatePm(PM_CASES)];
  if (errs.length) { console.error(errs.join("\n")); process.exit(1); }
  if (mode === "--check") {
    const bad = [...check(QA_CASES), ...check(PM_CASES, pmCaseFiles, PM_PREFIX)];
    if (bad.length) { console.error(bad.join("\n") + "\nRun: node tools/eval-miss-cases.mjs (it rewrites stale files and removes extras; delete an orphan folder by hand)"); process.exit(1); }
    console.log(`ok: ${QA_CASES.length} qa-tdd and ${PM_CASES.length} staff-pm miss cases are up to date`);
  } else if (mode === "--verify") {
    // staff-pm cases have no repro to run; validatePm above is their check.
    const bad = verify(QA_CASES);
    if (bad.length) { console.error(bad.join("\n")); process.exit(1); }
    console.log(`ok: ${QA_CASES.length} qa-tdd repros hold (shipped test green, gap test red); ${PM_CASES.length} staff-pm cases validated`);
  } else {
    write(QA_CASES);
    write(PM_CASES, pmCaseFiles, PM_PREFIX);
    console.log(`wrote ${QA_CASES.length} qa-tdd and ${PM_CASES.length} staff-pm cases under plugins/studio/evals/`);
  }
}
