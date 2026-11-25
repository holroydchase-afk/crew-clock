# qa-tdd run: demo bar review fixes, red phase (CRW M1.18, intake #38, UX-R1..R5 + PS-R1)

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: red tests for the demo bar review fixes UX-R1..R5 and PS-R1 (DEMOBAR-2, DEMOBAR-3 rewritten per the chief of staff's decisions)
tool: agent-guard | ok | kill qa-tdd not tripped
tool: agent-memory | ok | demo bar portfolio drawer: past QA-R1..R5 of 2026-11-23 only, none covers these fixes
tool: Bash | ok | qa-run3 3x demobar-static and e2e-demobar against the demo build on 8123
tool: agent-guard | failed | only-tests: the working tree already held earlier lanes' uncommitted product edits; this run's only non-test edit is SPEC-DEMO-BAR DEMOBAR-2/3 text, as asked
verdict: red
findings: 6
p0: 0
artifact: tests/e2e-demobar.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P2 | css/app.css .demo-sum at 600px | the long summary is cut off by 2px (scrollWidth 319, clientWidth 317); DEMOBAR-2 only checked it at 1280 | tests/e2e-demobar.js
QA-R2 | P2 | SPEC-DEMO-BAR Design answers | Summary (from 360), Drawer copy and the "← Back" decision line still state the old choices; this run edited DEMOBAR-2/3 only | none
QA-R3 | P2 | docs/PRIVACY.md S4 | says every demo screen shows "Sample data"; below 390 it will be hidden, so the bar clause needs the same update as the drawer clause | none
QA-R4 | P2 | tests/e2e-demobar.js DEMOBAR-3 | accepts the long copy or the "which see the area" fallback; cannot prove the fallback was only used because the long form ran to 5 lines | tests/e2e-demobar.js
QA-R5 | P2 | decision UX-R2 at 1280 | the drawer link sits beside Reset demo, so its arrow is checked only when it starts its own row; the decision is silent on 1280 | tests/e2e-demobar.js
QA-R6 | P2 | scripts/qa-run3.mjs with tests/e2e-demobar.js | the e2e runner prints "N failed" but no "N passed", so the suite line reads 0/11 though 27 of 38 passed | none
