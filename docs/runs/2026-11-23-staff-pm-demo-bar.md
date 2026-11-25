# staff-pm run: studio demo bar scope, intake #38 (2026-11-23)

```agentrun
date: 2026-11-23
agent: staff-pm
product: Crew Clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: scope intake 38, replace the demo banner with the studio demo bar
tool: Bash | ok | log-agent-run.sh --as staff-pm
tool: agent-guard | ok | kill staff-pm
tool: agent-memory | ok | demo banner bar, no matching finding
tool: Read | ok | issue 38, DEMO-BANNER.md, pm-tools fake-db.js bar, js/app.js banner and hints, css/app.css, SPEC-DEMO-HINTS, CRW-RESTYLE, design-rules, PRIVACY S4, README, HANDOFF, tests/e2e-*.js
tool: check-spec | ok | docs/product/SPEC-DEMO-BAR.md
tool: spec-lint | ok | SL-1 waived with reason
verdict: ready
findings: 5
p0: 0
escalated: yes
escalation_reason: harness showed no token or cost count
```

PM-R1 | P1 | DEMO-BANNER.md vs CRW-RESTYLE DS-2/DS-3/DS-8/DS-9 | standard's 14 px text, 12 px uppercase 700 badge, 44 px targets and ink focus ring break Crew Clock's design tests | product rules win: 17 px, title case 600 badge, 48 px with divider inside, accent focus ring, DEMOBAR-1/10
PM-R2 | P1 | js/app.js demoBanner, hint step 7 | No signal leaves the always-visible banner for the drawer; step 7 target hidden when collapsed | dot on the Details toggle first, then the switch, DEMOBAR-9
PM-R3 | P2 | js/app.js demo-reset | window.confirm, standard wants inline confirm and a restored message | inline Reset/Keep, sessionStorage crewclock.restored, DEMOBAR-6/7/17
PM-R4 | P2 | js/app.js render | #app redraws would close the drawer and drop focus | state survives redraws, DEMOBAR-8
PM-R5 | P2 | back link target | demo lives at chaseholroyd.com/crew-clock/, so a crew-clock back link loops; no case-study path in the repo | keep https://chaseholroyd.com/, decision for Chase
