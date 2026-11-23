# staff-pm run: Supabase pre-connect grants scope, intake #35 (2026-11-23)

```agentrun
date: 2026-11-23
agent: staff-pm
product: Crew Clock
tier: advisory
model: claude-opus-5-5
tokens: 0
cost_usd: 0
input: scope one PR for intake 35, Supabase pre-connect grants
tool: Bash | ok | log-agent-run.sh --as staff-pm
tool: agent-guard | ok | kill staff-pm
tool: agent-memory | ok | grants revoke supabase stub glob, no matches
tool: Read | ok | issue 35, supabase/migrations, tests/sql/run.sh, supabase_stub.sql, ci.yml, PRIVACY, SETUP, HANDOFF, studio stub template
tool: Bash | ok | local Postgres 16 probes with the studio stub, throwaway database dropped
tool: check-spec | ok | docs/product/SPEC-SUPABASE-GRANTS.md
tool: spec-lint | ok | SL-4, SL-6, SL-7 waived with reasons
verdict: ready
findings: 5
p0: 0
escalated: yes
escalation_reason: harness showed no token or cost count
```

PM-R1 | P1 | supabase/migrations/20261022000000_init.sql | under Supabase default grants anon and authenticated hold ALL, TRUNCATE included, on 10 of 11 public tables; crew keeps INSERT, DELETE, TRUNCATE | revoke migration 20261123000000_revoke_defaults.sql, GRANT-2 to GRANT-4
PM-R2 | P2 | supabase/migrations/20261022000000_init.sql | anon can execute public.shifts (PUBLIC default never revoked) | revoke in the same migration, GRANT-6
PM-R3 | P1 | supabase/migrations/20261022000100_schedules.sql | never tested, needs pg_cron (absent locally and on CI), holds placeholders, and SETUP 1.2 db push would apply it | move to supabase/manual/schedules.sql, GRANT-12, GRANT-13
PM-R4 | P1 | tests/sql/*_test.sql | tests share one database and depend on rls_test.sql's seed; alphabetical glob fails at auth_test.sql | numeric prefixes in today's order, GRANT-11
PM-R5 | P2 | docs/SETUP.md step 1.2 | says db push runs two files and to leave schedules for step 6; db push runs all seven | fix with the move, GRANT-13
