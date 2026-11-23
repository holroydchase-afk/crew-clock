#!/usr/bin/env node
// agent-guard: the three agent fail-safes from docs/agent-training-plan.md (guardrails row), one CLI.
//
//   kill <agent> [--root DIR]          trips when DIR/.claude/agents.off (halts every agent) or
//                                      DIR/.claude/<agent>.off exists as a file. Run before an agent starts work.
//   cost <run.md> [--cap USD]          reads the ```agentrun block (validated by check-agent-run.mjs) and trips when
//                                      cost_usd is over the cap (default 1.00) without escalated: yes, or when
//                                      tokens and cost are both 0 (nothing shown) without escalated: yes.
//   only-tests [--base REF] [--root DIR]
//                                      trips when anything other than test files, fixtures or run logs changed
//                                      versus REF (default HEAD): committed, staged, unstaged, untracked or deleted.
//                                      Renames count on both sides. Read-only: never touches the index or worktree.
//
// Every subcommand takes --json (prints {"ok": bool, "reasons": [..]} on stdout).
// Exit 0 pass, 1 tripped (one reason per line on stderr), 2 usage error or unreadable input.
// Plain Node, no network. Needs check-agent-run.mjs and check-story-entry.mjs beside it (sync all three).
import { readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { checkAgentRun, AGENTS } from "./check-agent-run.mjs";

export const DEFAULT_CAP = 1.0;
const USAGE = [
  "usage: agent-guard.mjs kill <agent> [--root DIR] [--json]",
  "       agent-guard.mjs cost <run.md> [--cap USD] [--json]",
  "       agent-guard.mjs only-tests [--base REF] [--root DIR] [--json]",
].join("\n");

class UsageError extends Error {}

// ---------- only-tests: which paths count as test changes ----------
const TEST_DIRS = new Set(["tests", "test", "__tests__", "e2e", "fixtures"]);
const TEST_NAME = [/\.(test|spec)\.[^/]+$/, /_test\.[^/.]+$/, /^test_[^/]+\.[^/.]+$/];

// True when a repo-relative path is a test file, a fixture, a run log or an agent-run log.
export function isTestPath(p) {
  const parts = p.split("/");
  const base = parts[parts.length - 1];
  if (parts.slice(0, -1).some((d) => TEST_DIRS.has(d))) return true;
  if (TEST_NAME.some((re) => re.test(base))) return true;
  if (parts.length >= 3 && parts[0] === "docs" && parts[1] === "runs" && base.endsWith(".md")) return true;
  if (parts.length === 3 && parts[0] === ".claude" && parts[1] === "agent-runs" && base.endsWith(".log")) return true;
  return false;
}

// ---------- the three guards (each returns reasons; throws UsageError for exit 2) ----------
const isDir = (p) => { try { return statSync(p).isDirectory(); } catch { return false; } };
const isFile = (p) => { try { return statSync(p).isFile(); } catch { return false; } };

export function guardKill(agent, root = process.cwd()) {
  if (!AGENTS.includes(agent)) throw new UsageError(`unknown agent "${agent}": use one of ${AGENTS.join(", ")}`);
  if (!isDir(root)) throw new UsageError(`--root ${root} is not a folder`);
  const reasons = [];
  if (isFile(join(root, ".claude", "agents.off"))) reasons.push("kill switch .claude/agents.off is on: every agent is halted (delete the file to resume)");
  if (isFile(join(root, ".claude", `${agent}.off`))) reasons.push(`kill switch .claude/${agent}.off is on: ${agent} is halted (delete the file to resume)`);
  return { reasons, notes: [] };
}

export function parseCap(s) {
  if (!/^\d+(\.\d+)?$/.test(s) || !(Number(s) > 0)) throw new UsageError(`--cap "${s}" must be a positive number of dollars, like 1.00`);
  return Number(s);
}

export function guardCost(text, cap = DEFAULT_CAP) {
  const { run, errors } = checkAgentRun(text);
  if (errors.length || !run) throw new UsageError(["the run log is not valid (check-agent-run):", ...errors].join("\n"));
  const reasons = [];
  const notes = [];
  const escalated = run.escalated === "yes";
  if (run.tokens === 0 && run.cost_usd === 0) {
    if (!escalated) reasons.push("cost not shown but not escalated: tokens and cost_usd are both 0; fill in what the harness showed, or escalate and say why");
  } else if (run.cost_usd > cap) {
    if (escalated) notes.push(`over cap, escalated: cost_usd ${run.cost_usd} is over the ${cap.toFixed(2)} cap and the run escalated`);
    else reasons.push(`cost_usd ${run.cost_usd} is over the ${cap.toFixed(2)} cap and the run did not escalate: set escalated: yes with an escalation_reason`);
  }
  return { reasons, notes };
}

function git(cwd, args) {
  const r = spawnSync("git", ["-c", "core.quotepath=false", ...args], {
    cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
  });
  return { ok: r.status === 0, out: r.stdout || "", err: (r.stderr || "").trim() };
}

export function guardOnlyTests(base = "HEAD", root = process.cwd()) {
  if (!isDir(root)) throw new UsageError(`--root ${root} is not a folder`);
  const top = git(root, ["rev-parse", "--show-toplevel"]);
  if (!top.ok) throw new UsageError(`${root} is not inside a git repo`);
  const repoRoot = top.out.replace(/\n$/, "");
  if (base.startsWith("-")) throw new UsageError(`--base "${base}" is not a commit in this repo`);
  const rev = git(repoRoot, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${base}^{commit}`]);
  if (!rev.ok) throw new UsageError(`--base "${base}" is not a commit in this repo`);
  const sha = rev.out.trim();
  // Tracked changes (committed since base, staged, unstaged), with renames split into delete + add.
  const diff = git(repoRoot, ["diff", "--name-only", "--no-renames", "-z", sha, "--"]);
  if (!diff.ok) throw new UsageError(`git diff failed: ${diff.err}`);
  const untracked = git(repoRoot, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!untracked.ok) throw new UsageError(`git ls-files failed: ${untracked.err}`);
  const paths = [...new Set([...diff.out.split("\0"), ...untracked.out.split("\0")].filter(Boolean))].sort();
  const reasons = paths.filter((p) => !isTestPath(p)).map((p) => `not a test file: ${p}`);
  return { reasons, notes: [] };
}

// ---------- CLI ----------
function parseArgs(argv, flags) {
  const pos = [];
  const opts = { json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") opts.json = true;
    else if (flags.includes(a)) {
      const v = argv[i + 1];
      if (v === undefined || (v.startsWith("-") && v !== "" && !/^-\d/.test(v))) throw new UsageError(`${a} needs a value`);
      opts[a.slice(2)] = v;
      i++;
    } else if (a.startsWith("--")) throw new UsageError(`unknown option ${a}`);
    else pos.push(a);
  }
  return { pos, opts };
}

export function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === "-h" || sub === "--help") return { code: 0, out: USAGE };
  const json = rest.includes("--json");
  try {
    let result;
    if (sub === "kill") {
      const { pos, opts } = parseArgs(rest, ["--root"]);
      if (pos.length !== 1) throw new UsageError("kill takes one agent name");
      if (opts.root === "") throw new UsageError("--root needs a value");
      result = guardKill(pos[0], opts.root !== undefined ? resolve(opts.root) : process.cwd());
    } else if (sub === "cost") {
      const { pos, opts } = parseArgs(rest, ["--cap"]);
      if (pos.length !== 1) throw new UsageError("cost takes one run log path");
      const cap = opts.cap !== undefined ? parseCap(opts.cap) : DEFAULT_CAP;
      let text;
      try { text = readFileSync(pos[0], "utf8"); } catch { throw new UsageError(`can't read ${pos[0]}`); }
      result = guardCost(text, cap);
    } else if (sub === "only-tests") {
      const { pos, opts } = parseArgs(rest, ["--base", "--root"]);
      if (pos.length) throw new UsageError("only-tests takes no positional arguments");
      if (opts.base === "" || opts.root === "") throw new UsageError("--base and --root need a value");
      result = guardOnlyTests(opts.base ?? "HEAD", opts.root !== undefined ? resolve(opts.root) : process.cwd());
    } else {
      throw new UsageError(sub === undefined ? "no subcommand" : `unknown subcommand "${sub}"`);
    }
    const ok = result.reasons.length === 0;
    const out = json ? JSON.stringify({ ok, reasons: result.reasons }) : result.notes.join("\n");
    // In --json mode stdout is only the JSON, so notes go to stderr.
    const err = [...result.reasons, ...(json ? result.notes : [])].join("\n");
    return { code: ok ? 0 : 1, out, err };
  } catch (e) {
    if (e instanceof UsageError) return { code: 2, out: "", err: `${e.message}\n${USAGE}` };
    throw e;
  }
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const { code, out, err } = main(process.argv.slice(2));
  if (out) console.log(out);
  if (err) console.error(err);
  process.exit(code);
}
