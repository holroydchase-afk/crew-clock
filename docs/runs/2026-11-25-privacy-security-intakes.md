# privacy-security run: intakes #56, #53 (EF-CK-1, EF-CK-11), #57 (CRW-18)

```agentrun
date: 2026-11-25
agent: privacy-security
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: git diff origin/main...HEAD for docs/product/SPEC-INTAKES-2026-11-25.md
tool: Bash | ok | log-agent-run.sh --as privacy-security
tool: Bash | ok | git diff origin/main...HEAD: js/api.js, js/app.js, js/demo-backend.js, scripts/build-site.mjs, css/app.css, tests
tool: Bash | ok | coordinate sweep of js/, tests/, backend/ for West Virginia points
tool: Bash | ok | node --test tests/intakes.test.js: 15 pass, 0 fail
tool: Bash | failed | npm test: 250 pass, 1 fail (TS-1 tsc: js/demo-backend.js:234 db.sampleDay possibly null), 1 skipped
verdict: pass
findings: 5
p0: 0
escalated: yes
escalation_reason: harness showed no token or cost count; TS-1 red belongs to qa-tdd
```

PS-R1 | P2 | tests/edge/core.test.ts, harden.test.ts, m19.test.ts, tests/sql/10_rls_test.sql, tests/e2e-demo.js | fixture coordinates 38.5,-81.9 / 38.4,-81.9 / 38.0,-81.0 / 38.1,-81.1 are 1-decimal (about 11 km) West Virginia points; 38.5,-81.9 sits about 10 km from the old sample towns. Not personal data (no address, site or punch), but it hints at the crew's area | move to Fernhollow points (38.8,-98.2) and widen the CRW-4 regex to any 38.x,-8[12].x | standard: CLAUDE.md hard rule 1, LINDDUN identifiability
PS-R2 | P2 | build-site.mjs addDemoBar, #57 | /assets/demo-bar.js is first-party, same origin, outside the SW scope and only in --demo (CRW-15), but its code lives in another repo and runs with the demo origin's storage and geolocation grant | record the contract in docs/PRIVACY.md S4: no analytics, no network beyond same origin, no geolocation or storage reads; privacy-security reviews the portfolio script before the deploy | standard: ASVS L2 V14.2 (third-party code)
PS-R3 | P2 | docs/PRIVACY.md S5, config.js comments | S5 still says "[to build: refuse sheets]" and cites js/app.js:295; config.js still offers 'sheets' and a "Sheets MVP backendUrl" | point S5 at CRW-10..13 as built; say in config.js that 'sheets' and backendUrl are ignored outside demo | standard: method step 4 (promise matches code)
PS-R4 | P2 | js/app.js:1058, 1420 | the crew app's empty map now opens on the made-up Kansas town; accepted for privacy (it no longer names the crew's town in public code); UX cost goes to ux-reviewer | none for privacy | standard: data minimization
PS-R5 | P2 | git history | old town names and pins stay in history; rewriting is forbidden by the hard rules | accepted | standard: CLAUDE.md hard rules
