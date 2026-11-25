# qa-tdd run: demo bar review fixes, green phase (CRW M1.18, intake #38)

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: rewrite SEP-3 (tests/e2e-demo.js) and UX-R43/R49 at 360 (tests/e2e-polish.js) to the decided UX-R1/UX-R5 behaviour, review the engineer's type-only edits, then all suites 3x
tool: agent-guard | ok | kill qa-tdd not tripped
tool: agent-memory | ok | demo bar made-up Sample data 360: past QA-R1..R6 of 2026-11-25 and QA-R1..R3 of 2026-11-23, none covers the two old tests
tool: Bash | ok | old SEP-3 and UX-R43/R49 360 red on the current build, rewritten ones pass
tool: Bash | ok | qa-run3 3x unit, typecheck, sql (local Postgres 16), edge (deno 2.9.6), mls, e2e against the demo build on 8123
tool: agent-guard | failed | only-tests: the working tree still holds earlier lanes' uncommitted product and doc edits; this run edited only tests/e2e-demo.js and tests/e2e-polish.js
verdict: green
findings: 4
p0: 0
artifact: tests/e2e-polish.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P2 | css/app.css .demo-sum at 600px | closed: long summary no longer cut off (e2e-demobar DEMOBAR-2 green 3x) | tests/e2e-demobar.js
QA-R2 | P2 | SPEC-DEMO-BAR Design answers | closed: Back link, Summary and drawer copy lines match the decisions | none
QA-R3 | P2 | docs/PRIVACY.md S4 | closed: says "Sample data" is hidden below 390px | none
QA-R4 | P2 | tests/e2e-demobar.js DEMOBAR-3 | open: accepts the short fallback copy without proving the long form ran to 5 lines | tests/e2e-demobar.js
QA-R5 | P2 | decision UX-R2 at 1280 | open: drawer link arrow alignment checked only when the link starts its own row | tests/e2e-demobar.js
QA-R6 | P2 | scripts/qa-run3.mjs with the e2e runner | open: runner prints "all passed" with no counts, so e2e reads 1/0 per run | none
QA-R7 | P2 | tests/e2e-demo.js SEP-3, tests/e2e-polish.js UX-R43/R49 360 | closed: rewritten to UX-R5 (made[-U+2011]up) and UX-R1 (summary hidden at 360, "← Portfolio" whole; "Sample data" kept from 390) | tests/e2e-polish.js
