# qa-tdd run: Studio demo bar red phase (CRW M1.18.1, intake #38)

```agentrun
date: 2026-11-23
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: red tests for SPEC-DEMO-BAR DEMOBAR-1..14 and 17 plus the superseded rewrites
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | demo banner reset: no past finding
tool: Bash | ok | npm test 1x, typecheck 1x, every e2e suite 1x against the demo build on 8123
tool: agent-guard | failed | only-tests: package.json (test:e2e wiring, asked for) and the staff-pm spec file
verdict: red
findings: 5
p0: 0
artifact: tests/e2e-demobar.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P2 | SPEC-DEMO-BAR superseded list | HINT-4 (e2e-hints) and UX-R40 (e2e-demo-chat) also used the old banner and were not listed; rewritten here | tests/e2e-hints.js
QA-R2 | P2 | SPEC-DEMO-BAR DEMOBAR-17 | says aria-expanded "false" after Reset with empty storage, which contradicts DEMOBAR-7; tested as "true" with working storage, "false" in private mode | tests/e2e-demobar.js
QA-R3 | P2 | SPEC-DEMO-BAR hooks | no hook named for the summary, badge or chevron; tests find them by words inside the toggle | tests/e2e-demobar.js
QA-R4 | P2 | tests/e2e-demobar.js | assertions past "the bar exists" have never run against a real bar; a test bug there shows up only in M1.18.2 | tests/e2e-demobar.js
QA-R5 | P2 | SPEC-DEMO-BAR Redraws | focus surviving an #app redraw is not tested (no redraw trigger that leaves focus alone) | none
