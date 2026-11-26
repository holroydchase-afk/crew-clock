# qa-tdd run: TS-3 ARCH-R1 red step (2026-11-26)

Architect ARCH-R1 (P1, docs/reviews/2026-11-26-architect-ts3.md): agents-check reruns agents.verify with no npm ci.
The chief-of-staff decision is that `agents.verify` must be exactly `npm ci --ignore-scripts && npm test`.
SPEC-TS-3: design answer 2 and the TS3-2 criterion now say that and cite ARCH-R1.
tests/ts3.test.ts:
- TS3-2 now requires that exact string.
- New test "TS3-2 CI shape (ARCH-R1)" copies the working tree and .git with no node_modules and runs bash -c "$verify". Inside the copy that test skips itself (CRW_TS3_CI_SHAPE=1), so it doesn't recurse. It skips only when npm ci can't reach the registry or cache.
Red (studio-checks.json still says "npm test"): TS3-2 expected 'npm ci --ignore-scripts && npm test', actual 'npm test'. The CI-shape test fails with nested not ok on TS3-2, TS3-3 (ts2 and ts2-review skips break the pins) and TS3-5 (typescript not installed), which is exactly ARCH-R1. tsc 0 errors.

QA-R8 | P1 | studio-checks.json agents.verify | agents-check reruns "npm test" with no node_modules, so TS3-3 and TS3-5 fail on CI (ARCH-R1); verify must be "npm ci --ignore-scripts && npm test" | tests/ts3.test.ts
QA-R9 | P2 | tests/ts3.test.ts TS3-2 CI shape | the test runs a full npm ci plus npm test in a copy, adding time to every npm test and needing the npm registry or cache; it skips with a reason when the network is down, so offline runs don't prove ARCH-R1 | tests/ts3.test.ts

```agentrun
date: 2026-11-26
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: red step for ARCH-R1, agents.verify must be npm ci --ignore-scripts && npm test (SPEC-TS-3 TS3-2)
tool: agent-guard | ok | kill qa-tdd
tool: Bash | ok | node --test TS3-2 tests, both red for the right reason; tsc 0 errors
verdict: red
findings: 2
p0: 0
artifact: tests/ts3.test.ts
escalated: yes
escalation_reason: harness showed no token or cost count
```
