#!/usr/bin/env node
// qa-run3: runs a test command N times (default 3) and prints what qa-tdd pastes into its ```qa block, so
// "green, 3x" comes from a script instead of a claim. It never prints the command's own output (only counts).
//
//   run 1: exit 0, 9 passed, 0 failed, 412 ms
//   run 2: exit 1, counts unknown, 380 ms          (no counts found in the output)
//   run 3: timed out after 60 s                    (the whole process group was killed)
//   verdict: flaky
//   suite: unit | npm test | 9/0 0/1 0/1
//
// Each run goes through a shell (so pipes and && work), detached in its own process group; on --timeout the
// whole group is killed and the remaining runs still happen. Counts come from the last "# pass N" / "# fail M"
// lines (node:test, TAP), else the last "N passed" / "M failed" (jest, vitest, pytest, playwright); when only
// one of the two is found the other is 0, and when neither is found both are null. A run fails when it exits
// non-zero, times out, can't start, or reports failed > 0. Verdict: flaky when runs differ in pass/fail or in
// counts (flaky wins), red when every run fails the same way, else green. In the suite line a "|" in the
// command becomes "/", a run with no counts is 1/0 when it passed and 0/1 when it failed, and a failed run
// always shows at least 1 failed, so check-qa-report reads it the same way.
//
// Usage: node scripts/qa-run3.mjs [--runs N] [--timeout SECONDS] [--name NAME] [--json] -- <command words...>
//   --runs N       1..10, default 3
//   --timeout S    a positive whole number of seconds per run (default: none)
//   --name NAME    the suite name (default: the command's first word)
//   --json         print only {name, command, runs: [{n, exit, passed, failed, ms, timedOut, error}], verdict, suite}
// Exit 0 green; 1 red or flaky; 2 on a usage error (the command never runs).
import { spawn } from "node:child_process";
import { constants } from "node:os";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "usage: qa-run3.mjs [--runs N] [--timeout SECONDS] [--name NAME] [--json] -- <command words...>";
const KEEP = 1 << 20; // keep only the last 1 MB of output for counting
const KILL_GRACE_MS = 1000;

export class UsageError extends Error {}

export function parseArgs(argv) {
  const sep = argv.indexOf("--");
  if (sep === -1) throw new UsageError("missing -- before the command");
  const flags = argv.slice(0, sep);
  const command = argv.slice(sep + 1).join(" ").trim();
  if (!command) throw new UsageError("no command after --");
  const opts = { runs: 3, timeout: null, name: null, json: false, command };
  const posInt = (flag, v) => {
    if (v === undefined || !/^\d+$/.test(v) || Number(v) < 1) throw new UsageError(`${flag} needs a positive whole number`);
    return Number(v);
  };
  for (let i = 0; i < flags.length; i++) {
    const f = flags[i];
    if (f === "--json") opts.json = true;
    else if (f === "--runs") {
      opts.runs = posInt(f, flags[++i]);
      if (opts.runs > 10) throw new UsageError("--runs must be 1 to 10");
    } else if (f === "--timeout") opts.timeout = posInt(f, flags[++i]);
    else if (f === "--name") {
      const v = flags[++i];
      if (v === undefined || !v.trim() || v.startsWith("--")) throw new UsageError("--name needs a value");
      opts.name = v.trim();
    } else throw new UsageError(`unknown option ${f}`);
  }
  if (!opts.name) opts.name = command.split(/\s+/)[0];
  return opts;
}

const lastNum = (re, text) => {
  const all = [...text.matchAll(re)];
  return all.length ? Number(all[all.length - 1][1]) : null;
};

// Returns {passed, failed}; both null when the output has no counts.
export function parseCounts(text) {
  let passed = lastNum(/^# pass (\d+)\s*$/gm, text);
  let failed = lastNum(/^# fail (\d+)\s*$/gm, text);
  if (passed === null && failed === null) {
    passed = lastNum(/\b(\d+) passed\b/g, text);
    failed = lastNum(/\b(\d+) failed\b/g, text);
  }
  if (passed === null && failed === null) return { passed: null, failed: null };
  return { passed: passed ?? 0, failed: failed ?? 0 };
}

export const runFailed = (r) => r.timedOut || r.error !== null || r.exit !== 0 || (r.failed ?? 0) > 0;

export function verdictOf(runs) {
  const key = (r) => `${runFailed(r)}|${r.passed}|${r.failed}`;
  if (runs.some((r) => key(r) !== key(runs[0]))) return "flaky";
  return runFailed(runs[0]) ? "red" : "green";
}

export function runToken(r) {
  const bad = runFailed(r);
  if (r.passed === null) return bad ? "0/1" : "1/0";
  return `${r.passed}/${bad ? Math.max(r.failed, 1) : r.failed}`;
}

const clean = (s) => s.replace(/\|/g, "/").replace(/\s+/g, " ").trim();
export const suiteLine = (name, command, runs) => `suite: ${clean(name)} | ${clean(command)} | ${runs.map(runToken).join(" ")}`;

export function runLine(r, timeout) {
  if (r.timedOut) return `run ${r.n}: timed out after ${timeout} s`;
  const counts = r.passed === null ? "counts unknown" : `${r.passed} passed, ${r.failed} failed`;
  const note = r.error ? ` (error: ${r.error})` : "";
  return `run ${r.n}: exit ${r.exit ?? "none"}, ${counts}, ${r.ms} ms${note}`;
}

const killGroup = (pid, sig) => { try { process.kill(-pid, sig); } catch { /* already gone */ } };

// One attempt: resolves {exit, passed, failed, ms, timedOut, error}. error is set only when the shell can't start.
function attempt(command, timeoutS) {
  return new Promise((done) => {
    const t0 = performance.now();
    let out = "", timedOut = false, finished = false, timer = null, grace = null;
    const keep = (b) => { out += b.toString("utf8"); if (out.length > KEEP) out = out.slice(-KEEP); };
    let child;
    const finish = (exit, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer); clearTimeout(grace);
      const ms = Math.round(performance.now() - t0);
      const counts = error ? { passed: null, failed: null } : parseCounts(out);
      done({ exit: timedOut ? null : exit, ...counts, ms, timedOut, error });
    };
    try {
      child = spawn(command, { shell: true, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      finish(null, e.message);
      return;
    }
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    child.on("error", (e) => finish(null, e.message));
    child.on("close", (code, signal) => finish(code ?? (signal ? 128 + (constants.signals[signal] || 0) : null), null));
    // A background child that keeps the pipes open would hold "close" forever: give up 2 s after the shell exits.
    child.on("exit", () => { grace = setTimeout(() => { child.stdout.destroy(); child.stderr.destroy(); }, 2000); });
    if (timeoutS) {
      timer = setTimeout(() => {
        timedOut = true;
        killGroup(child.pid, "SIGTERM");
        setTimeout(() => killGroup(child.pid, "SIGKILL"), KILL_GRACE_MS).unref();
      }, timeoutS * 1000);
    }
  });
}

export async function runSuite(opts) {
  const runs = [];
  for (let n = 1; n <= opts.runs; n++) {
    let r = await attempt(opts.command, opts.timeout);
    if (r.error) r = await attempt(opts.command, opts.timeout); // a spawn error gets one retry
    runs.push({ n, ...r });
  }
  const verdict = verdictOf(runs);
  return { name: opts.name, command: opts.command, runs, verdict, suite: suiteLine(opts.name, opts.command, runs) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const argv = process.argv.slice(2);
  if (argv[0] === "-h" || argv[0] === "--help") { console.log(USAGE); process.exit(0); }
  let opts;
  try { opts = parseArgs(argv); } catch (e) {
    if (!(e instanceof UsageError)) throw e;
    console.error(`${e.message}\n${USAGE}`);
    process.exit(2);
  }
  const result = await runSuite(opts);
  if (opts.json) console.log(JSON.stringify(result, null, 2));
  else {
    for (const r of result.runs) console.log(runLine(r, opts.timeout));
    console.log(`verdict: ${result.verdict}`);
    console.log(result.suite);
  }
  process.exit(result.verdict === "green" ? 0 : 1);
}
