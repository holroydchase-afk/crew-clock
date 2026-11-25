# qa-tdd run: second pass on SPEC-INTAKES-2026-11-25 (three older tests reconciled, all suites 3x)

Start commit `77eae63ed4d51caa47804f1c7b4ec6710f0c4efc`. Changed: `tests/showcase.test.js` (allow exactly
`index.html -> /assets/demo-bar.js`, CRW-15), `tests/e2e-demo.js` (SEP-2 PSR-2 now asserts the offline
sign-in screen with no sample crew and no demo banner per CRW-10, still asserts cc.sbSession is kept; the
stale-session Stale Job pin moved from West Virginia to 38.75,-98.35 per PS-R1), `tests/e2e-showcase.js`
(SHOW-1 stubs /assets/demo-bar.js as tests/e2e-intakes.js does).

```agentrun
date: 2026-11-25
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: second pass on SPEC-INTAKES-2026-11-25, reconcile 3 older tests with CRW-10 and CRW-15, run all suites 3x
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | demo-bar, showcase, e2e: QA-R7 axe-core missing (now installed), nothing else covering these
tool: Bash | ok | red before edit: showcase.test.js missing index.html -> /assets/demo-bar.js; SEP-2 (PSR-2) timed out waiting for .name-btn
tool: Bash | ok | unit 251/0 x3, typecheck 1/0 x3, sql 2/0 x3, edge --no-check 49/0 x3, mls 1/0 x3, e2e 1/0 x3 on a fresh --demo build on 8123
tool: Bash | failed | npm run test:edge with type-check: deno 2.5.6 cannot find constraint @types/node (sandbox)
tool: agent-guard | failed | only-tests --base 77eae63 trips on HANDOFF.md, config.js, docs/PRIVACY.md, js/demo-backend.js: the engineer's uncommitted edits, not this run's
verdict: green
findings: 2
p0: 0
artifact: tests/e2e-demo.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P2 | test:edge | deno type-check fails on @types/node before any test; run with --no-check | none
QA-R2 | P2 | tests/e2e-*.js output | no pass/fail counts for qa-run3 to read; e2e runs count from exit code only | none
