#!/usr/bin/env node
// stamp-run: run by the CALLER (never the agent being measured) after a subagent finishes. It writes facts the agent
// cannot edit into the agent's run log: token sums from the subagent transcript, the commit, and optionally a test count.
// Usage: node tools/stamp-run.mjs <run.md> --transcript <subagent.jsonl> [--sha REF] [--test CMD] [--prices prices.json]
//   tokens = input + output + cache creation + cache read, deduplicated by message.id (last record wins; a record
//   with no id counts on its own). Lines that are not assistant records with usage are ignored.
//   --sha REF       resolved to 40 hex (default HEAD). --test CMD runs once; only its "# pass N" / "# fail M" counts are
//                   kept ("<CMD> | <pass>/<fail>", or "<CMD> | unparsed"); its output is never echoed or stored.
//   --prices FILE   JSON {model, input_per_mtok, output_per_mtok, cache_creation_per_mtok, cache_read_per_mtok, source,
//                   as_of}: cost_usd is computed (4 decimals) and stamp_prices "<source> <as_of>" is written. Without it
//                   cost_usd is left as is and "stamp_cost: not measured" is written.
// Re-stamping replaces the stamp_ lines, never duplicates them. Exit 0 stamped; 1 transcript unreadable, no usage,
// no agentrun block or sha not found (run.md untouched); 2 usage error.
import { readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const USAGE = "usage: stamp-run.mjs <run.md> --transcript <subagent.jsonl> [--sha REF] [--test CMD] [--prices prices.json]";
const FLAGS = ["--transcript", "--sha", "--test", "--prices"];
const RATES = ["input_per_mtok", "output_per_mtok", "cache_creation_per_mtok", "cache_read_per_mtok"];

const usage = (msg) => { console.error(msg ? `${msg}\n${USAGE}` : USAGE); process.exit(2); };
const fail = (msg) => { console.error(msg); process.exit(1); };
const count = (v) => (Number.isInteger(v) && v >= 0 ? v : 0);

export function sumUsage(text) {
  const byId = new Map();
  let anon = 0;
  for (const line of text.split(/\r?\n/)) {
    let o;
    try { o = JSON.parse(line); } catch { continue; }
    if (!o || typeof o !== "object" || o.type !== "assistant") continue;
    const u = o.message && o.message.usage;
    if (!u || typeof u !== "object") continue;
    const id = typeof o.message.id === "string" && o.message.id ? o.message.id : `\0anon${anon++}`;
    byId.set(id, u);
  }
  if (!byId.size) return null;
  const t = { input: 0, output: 0, cache_creation: 0, cache_read: 0 };
  for (const u of byId.values()) {
    t.input += count(u.input_tokens);
    t.output += count(u.output_tokens);
    t.cache_creation += count(u.cache_creation_input_tokens);
    t.cache_read += count(u.cache_read_input_tokens);
  }
  return t;
}

function main(args) {
  if (args.includes("-h") || args.includes("--help")) { console.log(USAGE); process.exit(0); }
  const opt = {};
  let runPath = null;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      if (!FLAGS.includes(a)) usage(`unknown flag ${a}`);
      if (i + 1 >= args.length || (args[i + 1].startsWith("--") && a !== "--test")) usage(`${a} needs a value`);
      opt[a.slice(2)] = args[++i];
    } else if (runPath === null) runPath = a;
    else usage("only one run.md");
  }
  if (!runPath) usage("no run.md given");
  if (!opt.transcript) usage("--transcript is required");
  let md;
  try { md = readFileSync(runPath, "utf8"); } catch { usage(`can't read ${runPath}`); }
  let prices = null;
  if (opt.prices) {
    let p;
    try { p = JSON.parse(readFileSync(opt.prices, "utf8")); } catch { usage("can't read --prices as JSON"); }
    const ok = p && typeof p === "object" && RATES.every((k) => typeof p[k] === "number" && Number.isFinite(p[k]) && p[k] >= 0)
      && ["source", "as_of"].every((k) => typeof p[k] === "string" && p[k].trim());
    if (!ok) usage(`--prices needs ${RATES.join(", ")} (numbers) and source, as_of (text)`);
    prices = p;
  }

  let transcript;
  try { transcript = readFileSync(opt.transcript, "utf8"); } catch { fail(`can't read ${opt.transcript}`); }
  const t = sumUsage(transcript);
  if (!t) fail("no assistant usage records found in the transcript");

  const lines = md.split("\n");
  const blocks = [];
  let open = null;
  lines.forEach((l, i) => {
    if (open === null && /^```agentrun[ \t]*\r?$/.test(l)) open = i;
    else if (open !== null && /^```[ \t]*\r?$/.test(l)) { blocks.push([open, i]); open = null; }
  });
  if (open !== null || blocks.length !== 1) fail("run.md needs exactly one closed ```agentrun block");

  const rev = spawnSync("git", ["rev-parse", "--verify", "--quiet", `${opt.sha || "HEAD"}^{commit}`], { encoding: "utf8" });
  const sha = (rev.stdout || "").trim();
  if (rev.status !== 0 || !/^[0-9a-f]{40}$/.test(sha)) fail(`can't resolve ${opt.sha || "HEAD"} to a commit`);

  let testLine = null;
  if (opt.test !== undefined) {
    const cmd = opt.test.replace(/\s+/g, " ").trim();
    const r = spawnSync(opt.test, { shell: true, encoding: "utf8", timeout: 600000, maxBuffer: 64 * 1024 * 1024 });
    const out = `${r.stdout || ""}\n${r.stderr || ""}`;
    const pass = /^\s*#\s*pass\s+(\d+)/m.exec(out);
    const nfail = /^\s*#\s*fail\s+(\d+)/m.exec(out);
    testLine = pass ? `stamp_test: ${cmd} | ${pass[1]}/${nfail ? nfail[1] : 0}` : `stamp_test: ${cmd} | unparsed`;
  }

  const total = t.input + t.output + t.cache_creation + t.cache_read;
  const [start, end] = blocks[0];
  const keyOf = (l) => { const m = /^\s*([A-Za-z0-9_]+):/.exec(l); return m ? m[1].toLowerCase() : null; };
  let body = lines.slice(start + 1, end).filter((l) => { const k = keyOf(l); return !(k === "stamped" || (k && k.startsWith("stamp_"))); });
  const setKey = (key, value) => {
    const i = body.findIndex((l) => keyOf(l) === key);
    if (i >= 0) body[i] = `${key}: ${value}`; else body.push(`${key}: ${value}`);
  };
  setKey("tokens", String(total));
  const add = [`stamped: yes`, `stamp_input: ${t.input}`, `stamp_output: ${t.output}`, `stamp_cache_creation: ${t.cache_creation}`, `stamp_cache_read: ${t.cache_read}`, `stamp_sha: ${sha}`];
  if (testLine) add.push(testLine);
  if (prices) {
    const cost = (t.input * prices.input_per_mtok + t.output * prices.output_per_mtok + t.cache_creation * prices.cache_creation_per_mtok + t.cache_read * prices.cache_read_per_mtok) / 1e6;
    setKey("cost_usd", String(Number(cost.toFixed(4))));
    add.push(`stamp_prices: ${prices.source.trim().replace(/\s+/g, "-")} ${prices.as_of.trim()}`);
  } else add.push("stamp_cost: not measured");
  body = body.concat(add);
  writeFileSync(runPath, [...lines.slice(0, start + 1), ...body, ...lines.slice(end)].join("\n"));
  console.log(`stamped ${runPath}: tokens ${total} (input ${t.input}, output ${t.output}, cache creation ${t.cache_creation}, cache read ${t.cache_read}), sha ${sha.slice(0, 12)}`);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) main(process.argv.slice(2));
