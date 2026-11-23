# qa-tdd run: Supabase pre-connect grants, red phase (intake #35, 2026-11-23)

```agentrun
date: 2026-11-23
agent: qa-tdd
product: Crew Clock
tier: supervised
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: failing tests for GRANT-1 to GRANT-13 (docs/product/SPEC-SUPABASE-GRANTS.md)
tool: Bash | ok | log-agent-run.sh --as qa-tdd
tool: agent-guard | ok | kill qa-tdd
tool: agent-memory | ok | grants revoke supabase stub run.sh, no past finding covers it
tool: Bash | ok | local Postgres 16, run.sh baseline 63 OK
tool: Bash | ok | 70_grants_test.sql on a Supabase-default stub, red at GRANT-2 naming anon and punches; green against a scratch revoke (not committed)
tool: Bash | ok | node --test tests/grants.test.js 0/6, tests/sql/runner.test.mjs 0/2, npm test 216/6, qa-run3 sql 1/0 x3
tool: Edit | ok | per coordinator, moved GRANT-1 run and GRANT-9 to tests/sql/runner.test.mjs (outside npm test), --list runs with PGHOST pointing nowhere, test:sql handoff added to the spec
tool: check-qa-report | ok | red block
tool: agent-guard | failed | only-tests trips on staff-pm's uncommitted docs/product/SPEC-SUPABASE-GRANTS.md, present at start; qa-tdd touched only tests and this log
verdict: red
findings: 6
p0: 0
artifact: tests/sql/70_grants_test.sql, tests/grants.test.js, tests/sql/runner.test.mjs
escalated: yes
escalation_reason: harness showed no token or cost count
```

QA-R1 | P1 | tests/sql/supabase_stub.sql (studio template too) | stub opens tables and functions by default but not sequences, unlike hosted Supabase; GRANT-5 would pass without the revoke | tests/grants.test.js
QA-R2 | P1 | tests/m19.test.js M1.9 run-locally-and-in-CI test | asserts literal m19_test.sql in run.sh and ci.yml, which GRANT-10 forbids; replace with the run.sh --list check in GRANT-11, never just delete | tests/grants.test.js
QA-R3 | P1 | tests/grants.test.js and npm test | GRANT-1 and GRANT-9 needed Postgres inside npm test (also agents.verify, no Postgres); fixed in tests: moved to tests/sql/runner.test.mjs, engineer wires test:sql | tests/sql/runner.test.mjs
QA-R4 | P2 | SPEC GRANT-7 | only tables named; new functions keep PUBLIC EXECUTE unless a global alter default privileges revokes it | tests/sql/70_grants_test.sql
QA-R5 | P2 | supabase/functions/digest/index.ts | header names supabase/migrations/*_schedules.sql; literal GRANT-13 check misses it | tests/grants.test.js
QA-R6 | P2 | SPEC GRANT-8 | Postgres 17 adds MAINTAIN; no PG17 run here | none
