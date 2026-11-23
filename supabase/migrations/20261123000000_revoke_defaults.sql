-- M2.0 pre-connect grants (intake #35, docs/product/SPEC-SUPABASE-GRANTS.md, PRIVACY section S).
-- Hosted Supabase's default privileges give anon and authenticated ALL on every new public table,
-- sequence and function (TRUNCATE included, which row-level security does not cover). This closes
-- them all, then grants back exactly what the phones use. service_role and supabase_auth_admin keep
-- theirs. Tested in tests/sql/70_grants_test.sql (GRANT-2..8). Undo: a new migration that re-grants.

-- 1. Close every public table, sequence and function to the phone roles.
--    REVOKE on a table also drops its column grants.
revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Functions: skip extension members (pgcrypto sits in public locally, in extensions on hosted).
do $$
declare f regprocedure;
begin
  for f in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'public'::regnamespace
       and not exists (select 1 from pg_depend d
                        where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
  loop
    execute format('revoke all on function %s from public, anon, authenticated', f);
  end loop;
end $$;

-- 2. Grant back exactly what the app uses (authenticated only; anon gets nothing).
grant select on public.orgs, public.devices, public.punches to authenticated;
grant select, insert, update on public.jobs, public.chat_groups, public.chat_members,
  public.mls_messages, public.mls_key_packages to authenticated;
grant select, insert, update, delete on public.push_subscriptions to authenticated;
grant select on public.location_consents to authenticated;
grant insert (id, org_id, crew_id, action, text_version, phone_at, device_id) on public.location_consents to authenticated;
grant select (id, org_id, name, role, active, created_at) on public.crew to authenticated;
grant update (name, role, active) on public.crew to authenticated;
grant usage, select on sequence public.mls_messages_id_seq to authenticated;
grant execute on function public.shifts(timestamptz, timestamptz, uuid) to authenticated;
grant execute on function public.crew_consent_status() to authenticated;
grant execute on function public.erase_crew_data(uuid) to authenticated;

-- 3. Anything a later migration adds starts closed to the phone roles (service_role keeps its
--    defaults). Functions lose PUBLIC execute everywhere, so a new one needs its own grant (QA-R4).
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke all on sequences from anon, authenticated;
alter default privileges in schema public revoke all on functions from anon, authenticated;
alter default privileges revoke execute on functions from public;
