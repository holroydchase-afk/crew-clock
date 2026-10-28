#!/usr/bin/env node
// Log check (from holroydchase-afk/studio-agents; proved in Hearth). Static check of every console.*
// call: never log keys, URLs, emails or raw errors. Its own test is tests/check_logs_test.sh in studio-agents.
// Rules, applied to the call's arguments with string literals blanked (template ${...} parts are kept):
//   1. no variable or property whose name contains a banned word (key, secret, token, url, uri, email,
//      password, header, authorization, body, plus the repo's own words from studio-checks.json)
//   2. an error's .message only as .message.replace(/https?:\S+/g, ...), so a URL inside it is cut
//   3. no bare error object (e, err, error): it prints the message and stack unfiltered
//   4. no JSON.stringify: it dumps whatever the object holds
// Config: studio-checks.json at the repo root, section "logs":
//   { "logs": { "roots": ["src"], "banned": ["caption"] } }   ("banned" adds to the defaults)
// Usage: node scripts/check-logs.mjs [file or dir ...]   (default: the configured roots, else src)
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const DEFAULT_BANNED = ["key", "secret", "token", "url", "uri", "email", "password", "header", "authorization", "body"];
const configFile = process.env.STUDIO_CHECKS || "studio-checks.json";
const config = existsSync(configFile) ? JSON.parse(readFileSync(configFile, "utf8")).logs ?? {} : {};
const BANNED = [...new Set([...DEFAULT_BANNED, ...(config.banned ?? [])])];

const args = process.argv.slice(2);
const ROOTS = args.length ? args : config.roots?.length ? config.roots : ["src"];
const SKIP = /(__tests__|\/test\/|\.test\.[jt]sx?$|_test\.ts$|node_modules)/;
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const SECRETISH = new RegExp(`\\b[A-Za-z_$]*(${BANNED.map(escapeRe).join("|")})[A-Za-z_$]*\\b`, "i");

function files(p) {
  if (statSync(p).isDirectory()) return readdirSync(p).flatMap((f) => files(join(p, f)));
  return /\.(ts|tsx|js|jsx|mjs|cjs)$/.test(p) && !SKIP.test(p) ? [p] : [];
}

// The argument text of a call that starts at `open` (the "("), or null if unbalanced.
function callArgs(src, open) {
  let depth = 0, q = null;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (q) { if (c === "\\") i++; else if (c === q) q = null; continue; }
    if (c === "'" || c === '"' || c === "`") q = c;
    else if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return src.slice(open + 1, i);
  }
  return null;
}

// Blank out string literals; keep ${...} expressions inside template literals.
function code(args) {
  let out = "", i = 0;
  while (i < args.length) {
    const c = args[i];
    if (c === "'" || c === '"') {
      i++; while (i < args.length && args[i] !== c) { if (args[i] === "\\") i++; i++; } i++; out += '""';
    } else if (c === "`") {
      i++;
      while (i < args.length && args[i] !== "`") {
        if (args[i] === "\\") { i += 2; continue; }
        if (args[i] === "$" && args[i + 1] === "{") {
          let d = 1, j = i + 2;
          while (j < args.length && d) { if (args[j] === "{") d++; else if (args[j] === "}") d--; j++; }
          out += " " + args.slice(i + 2, j - 1) + " "; i = j; continue;
        }
        i++;
      }
      i++; out += '""';
    } else if (c === "/" && /[(,=:]\s*$/.test(out)) {   // regex literal
      i++; while (i < args.length && args[i] !== "/") { if (args[i] === "\\") i++; i++; } i++;
      while (/[a-z]/.test(args[i] ?? "")) i++; out += "/re/";
    } else { out += c; i++; }
  }
  return out;
}

const problems = [];
let scanned = 0;
for (const root of ROOTS) {
  if (!existsSync(root)) { console.log(`log check: ${root} not found, skipped (fix "logs.roots" in ${configFile})`); continue; }
  for (const f of files(root)) {
    scanned++;
    const src = readFileSync(f, "utf8");
    const re = /console\.(log|info|warn|error|debug|trace)\s*\(/g;
    let m;
    while ((m = re.exec(src))) {
      const raw = callArgs(src, m.index + m[0].length - 1);
      if (raw === null) continue;
      const line = src.slice(0, m.index).split("\n").length;
      const where = `${relative(process.cwd(), f)}:${line}`;
      const c = code(raw);
      const name = c.match(SECRETISH);
      if (name) problems.push(`${where} logs "${name[0]}" (keys, URLs, emails and bodies are never logged)`);
      if (/\.message\b(?!\.replace\(\/https\?:\\S\+\/g)/.test(raw)) problems.push(`${where} logs an error .message without cutting URLs (use .message.replace(/https?:\\S+/g, ""))`);
      if (/(^|[,(?:]\s*)(e|err|error)\s*($|[,)])/.test(c.trim()) || /\$\{\s*(e|err|error)\s*\}/.test(raw))
        problems.push(`${where} logs a whole error object (log e.name or a fixed word)`);
      if (/\b(e|err|error)\.(stack|cause)\b/.test(c)) problems.push(`${where} logs an error's stack or cause`);
      if (/JSON\.stringify/.test(c)) problems.push(`${where} logs JSON.stringify(...) (could dump anything)`);
    }
  }
}
if (problems.length) {
  console.log(problems.join("\n"));
  console.log(`Log check: ${problems.length} problem(s)`);
  process.exit(1);
}
console.log(`Log check OK (${scanned} file(s))`);
