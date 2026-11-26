# qa-tdd run: TS-4 green phase, M0.6.4 (2026-11-26)

Spec: docs/product/SPEC-TS-4.md. Test: tests/ts4.test.ts (26 tests, TS4-1..TS4-11 plus PS-R1). Branch
claude/project-thread-4p3a4i, uncommitted engineer build on main cb2fb62, after the PS-R1 fix.
All suites 3x green, deno on PATH and local Postgres up, so nothing in ts4 skipped:
ts4 26/0 x3, npm test 322/0 x3 (296 on main + 26), typecheck x3, test:sql 2/0 x3, test:mls x3, test:edge 49/0 x3,
deno check --config supabase/functions/deno.json scripts/new-company.ts x3, eval:geofence --check x3,
e2e 17 files x3 (logs /tmp/claude-0/ts4f-e2e-1..3.log; demo built with build-site.mts, VERSION b95449e9fb).
agents.verify once in a bare temp copy with no node_modules: exit 0, 322 tests, 320 pass, 2 skips (LIC1-5
without messenger/node_modules; TS4-9 test:sql because su postgres cannot read a 0700 temp dir, QA-R11).
ts3 diff checked: the two allowed edits plus TS3-10's sql extension filter (.mjs to .mts). grants and ts2
regex-literal edits path-only. Port 8123 stopped, dist removed.

QA-R1 | P1 | SPEC-TS-4 TS4-3 vs TS4-6, sw.js line 2 | resolved by decision: sw.js exempt, VERSION pin kept | tests/ts4.test.ts
QA-R2 | P2 | SPEC-TS-4 TS4-1 | resolved: 6 .sh | tests/ts4.test.ts
QA-R3 | P1 | SPEC-TS-4 TS4-9, tests/ts3.test.ts | resolved by decision: two allowed ts3 edits | tests/ts4.test.ts
QA-R4 | P2 | SPEC-TS-4 TS4-3, TS4-9 | 13 e2e files beyond the 9 listed; path-only check covers all 21 | tests/ts4.test.ts
QA-R5 | P2 | SPEC-TS-4 TS4-3 | resolved: living docs only | tests/ts4.test.ts
QA-R6 | P2 | SPEC-TS-4 TS4-8 (ARCH-R3) | deno test skips where deno is missing; ran here with --config | tests/ts4.test.ts
QA-R7 | P2 | tests/ts4.test.ts TS4-6, TS4-7 | main pins apply in the TS-4 window only; app change on main before merge needs a re-pin | tests/ts4.test.ts
QA-R8 | P2 | tests/ts4.test.ts | needle widened to the escaped regex-literal form | tests/ts4.test.ts
QA-R9 | P2 | tests/ts4.test.ts TS4-9 test:sql | nested CI-shape copy: 0700 dir and shared database; nested runs skip | tests/ts4.test.ts
QA-R10 | P2 | scripts/build-site.mts (PS-R1) | .mts, .cts, .d.mts shipped; red then green after the engineer's fix | tests/ts4.test.ts
QA-R11 | P2 | tests/ts4.test.ts TS4-9 test:sql | bare 0700 copy unreadable by su postgres; skips only then | tests/ts4.test.ts
QA-R12 | P2 | local e2e environment | browser download blocked; e2e ran with playwright 1.63.0 on preinstalled chromium-1243, not CI's 1.56.1 | none

```agentrun
date: 2026-11-26
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: TS-4 green phase, all suites 3x after the engineer's build and PS-R1 fix (SPEC-TS-4, M0.6.4)
tool: agent-memory | ok | TS-4 mts build-site vendored, no prior finding covers these
tool: Bash | ok | qa-run3 ts4, npm test, typecheck, test:sql, test:mls, test:edge, deno check, eval:geofence 3x each, all green
tool: Bash | ok | e2e 3x against build-site.mts demo dist on port 8123, all 17 files passed each run
tool: Bash | ok | agents.verify once in a bare copy with no node_modules, exit 0
tool: agent-guard | failed | only-tests flags the engineer's TS-4 product edits and staff-pm's spec, not qa-tdd changes; qa-tdd edited only tests/ts4.test.ts, the spec lines the chief of staff decided and run logs
verdict: green
findings: 12
p0: 0
artifact: tests/ts4.test.ts
escalated: yes
escalation_reason: harness showed no token or cost count
```
