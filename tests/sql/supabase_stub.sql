-- Local stand-ins for what Supabase provides, so migrations run on plain Postgres in CI.
-- Never deployed. Mirrors Supabase's roles, auth.users, auth.sessions, auth.uid() and its default
-- grants (from studio-agents templates/supabase/tests/sql/supabase_stub.sql, plus sequences: QA-R1).
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
  if not exists (select 1 from pg_roles where rolname = 'supabase_auth_admin') then create role supabase_auth_admin nologin; end if;
end $$;
create schema if not exists auth;
create table if not exists auth.users (id uuid primary key, email text);
create table if not exists auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null);
create or replace function auth.uid() returns uuid language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
grant usage on schema public, auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
-- Like hosted Supabase: new public tables, sequences and functions are open to the client roles
-- until a migration revokes them (supabase/migrations/20261123000000_revoke_defaults.sql does).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
