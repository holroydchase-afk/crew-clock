# Spec: Supabase pre-connect grants (CRW, intake #35)

One PR before the real Supabase project is connected (SETUP 1). Schema, SQL tests, runner and CI;
no app or demo change. Source: issue #35, CLAUDE.md hard rules, PRIVACY section S.

**Bet.** The first `supabase db push` gives phones only the rights the app uses, proven in CI on a
stub that acts like hosted Supabase: grants_test red without the migration, green with it 3x.

**Found (2026-11-23, local Postgres 16, Supabase-default stub):**
- `anon` and `authenticated` get ALL on 10 of 11 public tables, TRUNCATE included (RLS does not
  cover TRUNCATE). `crew` keeps INSERT, DELETE, TRUNCATE: init.sql revokes only SELECT and UPDATE.
- `anon` can execute `public.shifts` (never revoked from PUBLIC; RLS still returns nothing).
- `20261022000100_schedules.sql` is in neither runner and is not schema: it needs pg_cron (absent
  locally and on CI's postgres:16) and holds `PROJECT_REF` / `CRON_SECRET` placeholders. SETUP 1.2's
  `db push` would run it too, so "Leave it for step 6" is false today. It creates no tables.
- SQL tests share one database (`rls_test.sql` seeds). Alphabetical order runs `auth_test.sql`
  first and fails (`new PIN left 2 sessions`). Studio stub, today's order: 63 OK, all pass.

**`authenticated` keeps exactly today's grant lines:** orgs, devices, punches: SELECT. jobs,
chat_groups, chat_members, mls_messages, mls_key_packages: SELECT, INSERT, UPDATE.
push_subscriptions: SELECT, INSERT, UPDATE, DELETE. location_consents: SELECT, plus INSERT on (id,
org_id, crew_id, action, text_version, phone_at, device_id). crew: column SELECT on (id, org_id,
name, role, active, created_at) and UPDATE on (name, role, active). Sequence `mls_messages_id_seq`:
USAGE, SELECT. EXECUTE on `shifts`, `crew_consent_status`, `erase_crew_data`. `anon`: nothing.
`service_role` keeps ALL; `supabase_auth_admin` keeps SELECT (id, org_id, role, active) on crew.

**Build.** `supabase/migrations/20261123000000_revoke_defaults.sql` revokes all on tables and
sequences in public from anon, authenticated, regrants the list above, revokes execute on `shifts`
from public, anon, and alters default privileges in public so new tables, sequences and functions
start closed to both. Stub copies studio `supabase_stub.sql`. Tests renamed in today's order
(`10_rls_test.sql` .. `60_m19_test.sql`) plus `70_grants_test.sql`; node checks in
`tests/grants.test.js`. `run.sh` globs with `LC_ALL=C`, takes `--list` and `--skip <file>`, uses
`PGHOST` when set; CI calls it. Postgres checks (GRANT-1, GRANT-9) live in `tests/sql/runner.test.mjs`,
outside `npm test` (no Postgres there or in agents-check): `test:sql` becomes
`sh tests/sql/run.sh && node --test tests/sql/runner.test.mjs`. `--list` never starts psql. Schedules moves to `supabase/manual/schedules.sql`.

**Edges.** Column grants, sequences, extension functions (pgcrypto: public locally, `extensions`
hosted), a later table (GRANT-7). Each SQL check raises naming role, table and privilege.

**Done, three states.** Merged: green 3x, HANDOFF updated, #35 commented. Deployed: SETUP 1.2
`db push` at M2.1, recorded in HANDOFF. Checked: GRANT-15. Stale: SETUP 1.2 and 6, digest
function header comment, NOTES Accounts row, PRIVACY S. README, demo, screenshots untouched.
Undo: a new migration that re-grants; never edit an applied one.

lint-ok: SL-6 signed-out is anon (GRANT-2); other-user rows are rls_test.sql's existing checks
lint-ok: SL-4 no screen changes
lint-ok: SL-7 no README or landing claim changes

```spec
verdict: ready
bet: The first db push gives phones only the rights the app uses; it worked when grants_test fails without the migration, passes with it 3x, and the real project shows 0 anon grants after M2.1
step: M2.0.1 | Stub with Supabase default grants, renamed tests, glob runner with list and skip, CI calls it | GRANT-1 and GRANT-9 to GRANT-11 green | 1 session
step: M2.0.2 | Revoke migration and grants test | GRANT-2 to GRANT-8 green 3x | 1 session
step: M2.0.3 | Move schedules out of migrations, fix SETUP, digest comment, NOTES, PRIVACY | GRANT-12 and GRANT-13 green | 0.5 session
step: M2.0.4 | privacy-security review and HANDOFF | GRANT-14 no P0 or P1 | 0.5 session
criterion: GRANT-1 | auto | Given the new stub and every migration but the revoke one (run.sh --skip 20261123000000_revoke_defaults.sql), then exit is non-zero and the ERROR names "anon" and "punches"
criterion: GRANT-2 | auto | Given all migrations, then role_table_grants plus role_column_grants rows for anon in schema public -> 0
criterion: GRANT-3 | auto | Given all migrations, then authenticated table and column grants equal the list above as sets (23 table-level rows; 16 column entries in pg_attribute.attacl); one extra crew INSERT or one missing jobs UPDATE -> "raises"
criterion: GRANT-4 | auto | Given all migrations, then TRUNCATE, REFERENCES or TRIGGER held by anon or authenticated on any public table -> 0 rows
criterion: GRANT-5 | auto | Given all migrations, then has_sequence_privilege anon usage on mls_messages_id_seq -> "false"; authenticated usage and select -> "true", update -> "false"
criterion: GRANT-6 | auto | Given all migrations, then public functions not owned by an extension that anon can execute -> 0 (1 before the migration: shifts); authenticated executes exactly shifts, crew_consent_status, erase_crew_data -> 3
criterion: GRANT-7 | auto | Given all migrations, when the test creates public.zz_probe (id int), then anon select -> "false", authenticated select -> "false", service_role select -> "true"; probe dropped
criterion: GRANT-8 | auto | Given all migrations, then service_role has all 7 table privileges on all 11 tables -> 77; supabase_auth_admin column entries on crew -> 4 and nothing else
criterion: GRANT-9 | auto | Given run.sh, then exit 0 and OK notices >= 63 plus the new ones
criterion: GRANT-10 | auto | Given run.sh and ci.yml, then hits for a 14-digit migration name or a *_test.sql file name -> 0, and the CI SQL step runs tests/sql/run.sh
criterion: GRANT-11 | auto | Given temp files tests/sql/98_tmp_test.sql and migration 29990101000000_tmp.sql, when run.sh --list runs, then each appears 1 time, migrations in filename order before 10_rls_test.sql; temps removed
criterion: GRANT-12 | auto | Given supabase/migrations, then each name matches 14 digits, underscore, lowercase words, .sql, and files containing "PROJECT_REF", "CRON_SECRET", "cron.schedule" or "supabase.co" -> 0
criterion: GRANT-13 | auto | Given the repo, then files outside docs/runs and docs/product naming 20261022000100_schedules.sql -> 0, and SETUP step 6 names "supabase/manual/schedules.sql"
criterion: GRANT-14 | manual | privacy-security reviews the migration -> 0 P0 or P1 findings
criterion: GRANT-15 | manual | After M2.1 the GRANT-2 query on the real project -> 0 rows, noted in HANDOFF
cut: Fresh database per SQL test file | numbered order keeps today's behavior; isolation is a bigger rewrite
cut: Tightening mls_key_packages UPDATE to the claimed column | changes app rights; needs an app usage audit first
cut: Scheduling alerts through a secret-free migration | belongs to M2.4 with pg_cron
risk: A plain glob runs auth_test before the seed and turns CI red | GRANT-11
risk: The revoke drops a grant a phone screen needs and breaks clock-in after connect | GRANT-3
decision: Move the schedules file out of migrations so db push cannot run it with placeholders | yes, to supabase/manual, reversible
decision: Rename SQL tests with numeric prefixes to keep their order | yes, cheapest way to make the glob safe
handoff: qa-tdd | failing tests for GRANT-1 to GRANT-13 | red for the right reason, GRANT-9 green before the build
handoff: engineer | build M2.0.1 to M2.0.3; package.json test:sql = sh tests/sql/run.sh && node --test tests/sql/runner.test.mjs | all GRANT auto criteria green 3x
handoff: privacy-security | review the revoke migration and stub | GRANT-14 met
```
