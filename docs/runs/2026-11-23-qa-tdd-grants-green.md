# qa-tdd run: Supabase pre-connect grants, green phase (intake #35, 2026-11-23)

```agentrun
date: 2026-11-23
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: green phase for GRANT-1 to GRANT-13 (docs/product/SPEC-SUPABASE-GRANTS.md), all suites 3x
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | grants revoke run.sh m19, matched only this intake's red-phase QA-R1 to QA-R6
tool: Bash | ok | red-phase test files untouched (grants.test.js, runner.test.mjs, 70_grants_test.sql mtime 16:01:35, before engineer at 16:01:56); renamed 10..60 SQL tests byte-identical to HEAD originals
tool: Bash | ok | m19.test.js M1.9 rewrite checks run.sh --list runs crew_auth migration before 60_m19_test.sql and CI Database step runs test:sql; intent kept
tool: Bash | ok | run.sh 76 OK notices (63 plus 13 GRANT); --skip revoke migration fails at GRANT-2 naming anon and punches
tool: Bash | ok | qa-run3 unit 222/0 x3, sql 2/0 x3, edge 49/0 x3, mls x3, typecheck x3, e2e x3 against the --demo build, all green
tool: check-qa-report | ok | green block
tool: agent-guard | ok | cost
tool: agent-guard | failed | only-tests trips on the engineer and staff-pm uncommitted files present at start; qa-tdd added only this log
verdict: green
findings: 7
p0: 0
artifact: tests/sql/70_grants_test.sql, tests/grants.test.js, tests/sql/runner.test.mjs, tests/m19.test.js
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P1 | tests/sql/supabase_stub.sql | closed: stub opens sequences by default | tests/grants.test.js
QA-R2 | P1 | tests/m19.test.js M1.9 | closed: run.sh --list check replaces literal names, intent kept | tests/m19.test.js
QA-R3 | P1 | package.json test:sql | closed: runner.test.mjs wired into test:sql and CI | tests/sql/runner.test.mjs
QA-R4 | P2 | revoke_defaults.sql | closed: global revoke of PUBLIC execute, GRANT-7 function check green | tests/sql/70_grants_test.sql
QA-R5 | P2 | supabase/functions/digest/index.ts | closed: header fixed | tests/grants.test.js
QA-R6 | P2 | SPEC GRANT-8 | open: no Postgres 17 run (MAINTAIN) | none
QA-R7 | P2 | revoke_defaults.sql section 3 | open: default privileges cover only objects created by the migrating role; GRANT-15 manual check is the only catch | none
