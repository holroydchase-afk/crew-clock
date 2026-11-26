# qa-tdd run: TS-2 final green phase (review fixes in, all suites 3x)

```agentrun
date: 2026-11-26
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: TS-2 after the engineer's review fixes; TS2-3 and ARCH-1 aligned to PS-R3 by chief-of-staff decision; final 3x run of every suite
tool: agent-memory | ok | npm ci ignore-scripts axe-core e2e tools: 2026-11-23 QA-R5 already notes e2e needs axe-core installed ad hoc
tool: Bash | ok | TS2-3 (tests/ts2.test.js) and ARCH-1 (tests/typecheck.test.js) now require the root install to be exactly run: npm ci --ignore-scripts; the npm ci before npm test ordering assertion is unchanged
tool: Bash | ok | qa-run3 unit 282/0 x3, ts2+typecheck+ts2-review tests 47/0 x3, typecheck x3, sql 2/0 x3, mls 1/0 x3, edge 49/0 x3 (deno 2.9.6)
tool: Bash | failed | e2e first pass 3/3 exit 1 at e2e-showcase.js: Cannot find module axe-core/axe.min.js; the engineer's npm ci removed the ad hoc e2e tools; reinstalled as ci.yml does (npm install --no-save playwright@1.56.1 http-server@14.1.1 axe-core@4.11.3), package files unchanged
tool: Bash | ok | e2e 3x on a quiet machine, each run logged to /tmp/claude-0/e2e-run-N.log: exit 0, 239 ok lines each, 536-542 s; e2e-update reports "a phone on an old deploy picks up the new one"
tool: Bash | ok | npm run build rewrites js/*.js byte-identically; vendor geo/report/chain/risk match js/
tool: agent-guard | failed | only-tests trips on the engineer's uncommitted TS-2 build and review fixes and the reviewers' docs/reviews files; this run changed only tests/ts2.test.js, tests/typecheck.test.js and this log
verdict: green
findings: 3
p0: 0
artifact: tests/ts2.test.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R6 | P1 | npm run test:e2e | closed: not reproduced; 3x green on a quiet machine (239/0 each); the earlier run-2 failure overlapped the parallel review agents | none
QA-R10 | P2 | tests/ts2.test.js TS2-3, tests/typecheck.test.js ARCH-1 | required a bare `run: npm ci` and so conflicted with PS-R3; now require exactly `npm ci --ignore-scripts`; SPEC-TS-2.md TS2-3 does not name the install command, so no spec edit | tests/ts2.test.js
QA-R11 | P2 | local test env | npm ci wipes playwright, http-server and axe-core (not in package.json; ci.yml installs them ad hoc), so test:e2e dies at e2e-showcase.js after any local npm ci; same root as 2026-11-23 QA-R5 | none
