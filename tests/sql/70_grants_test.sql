\set ON_ERROR_STOP on
-- M2.0 Supabase pre-connect grants (GRANT-2 to GRANT-8, intake #35, docs/product/SPEC-SUPABASE-GRANTS.md).
-- Runs last, after every migration, on a stub that grants like hosted Supabase (default privileges
-- give anon and authenticated ALL on new public tables, sequences and functions). Expects
-- supabase/migrations/20261123000000_revoke_defaults.sql. No data rows: grants only.
-- Every failing check raises naming the role, the table (or function) and the privilege.

-- ---------- GRANT-2: anon holds nothing on public tables or columns ----------
-- Runs first so a missing revoke migration fails here, naming anon and punches (GRANT-1).
do $$
declare n int; t int; c int; what text;
begin
  select count(*) into t from information_schema.role_table_grants
   where grantee = 'anon' and table_schema = 'public';
  select count(*) into c from information_schema.role_column_grants
   where grantee = 'anon' and table_schema = 'public';
  n := t + c;
  if n <> 0 then
    select string_agg(table_name || ' ' || privilege_type, ', ' order by table_name = 'punches' desc, table_name, privilege_type)
      into what from information_schema.role_table_grants
     where grantee = 'anon' and table_schema = 'public';
    raise exception 'GRANT-2 anon holds % grant rows in schema public (% table, % column), expected 0: %',
      n, t, c, coalesce(what, '(column grants only)');
  end if;
  raise notice 'OK GRANT-2 anon holds 0 table and 0 column grants in public';
end $$;

-- ---------- GRANT-3: authenticated holds exactly the grants the app uses ----------
-- Table level from pg_class.relacl, column level from pg_attribute.attacl, compared as sets.
create function pg_temp.grant3_diff() returns text language sql as $$
  with want_t(tbl, priv) as (values
      ('orgs','SELECT'), ('devices','SELECT'), ('punches','SELECT'),
      ('jobs','SELECT'), ('jobs','INSERT'), ('jobs','UPDATE'),
      ('chat_groups','SELECT'), ('chat_groups','INSERT'), ('chat_groups','UPDATE'),
      ('chat_members','SELECT'), ('chat_members','INSERT'), ('chat_members','UPDATE'),
      ('mls_messages','SELECT'), ('mls_messages','INSERT'), ('mls_messages','UPDATE'),
      ('mls_key_packages','SELECT'), ('mls_key_packages','INSERT'), ('mls_key_packages','UPDATE'),
      ('push_subscriptions','SELECT'), ('push_subscriptions','INSERT'), ('push_subscriptions','UPDATE'), ('push_subscriptions','DELETE'),
      ('location_consents','SELECT')),
  have_t as (
    select c.relname::text as tbl, a.privilege_type::text as priv
      from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       and a.grantee = 'authenticated'::regrole),
  want_c(tbl, col, priv) as (values
      ('crew','id','SELECT'), ('crew','org_id','SELECT'), ('crew','name','SELECT'),
      ('crew','role','SELECT'), ('crew','active','SELECT'), ('crew','created_at','SELECT'),
      ('crew','name','UPDATE'), ('crew','role','UPDATE'), ('crew','active','UPDATE'),
      ('location_consents','id','INSERT'), ('location_consents','org_id','INSERT'),
      ('location_consents','crew_id','INSERT'), ('location_consents','action','INSERT'),
      ('location_consents','text_version','INSERT'), ('location_consents','phone_at','INSERT'),
      ('location_consents','device_id','INSERT')),
  have_c as (
    select c.relname::text as tbl, att.attname::text as col, a.privilege_type::text as priv
      from pg_class c join pg_attribute att on att.attrelid = c.oid
      cross join lateral aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       and att.attnum > 0 and not att.attisdropped
       and a.grantee = 'authenticated'::regrole),
  diff as (
    select 'extra authenticated ' || priv || ' on ' || tbl as d from (select * from have_t except select * from want_t) x
    union all
    select 'missing authenticated ' || priv || ' on ' || tbl from (select * from want_t except select * from have_t) x
    union all
    select 'extra authenticated ' || priv || ' on ' || tbl || '.' || col from (select * from have_c except select * from want_c) x
    union all
    select 'missing authenticated ' || priv || ' on ' || tbl || '.' || col from (select * from want_c except select * from have_c) x)
  select string_agg(d, ', ' order by d) from diff
$$;

do $$
declare d text; nt int; nc int;
begin
  d := pg_temp.grant3_diff();
  if d is not null then raise exception 'GRANT-3 authenticated grants differ from the spec list: %', d; end if;
  select count(*) into nt from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and a.grantee = 'authenticated'::regrole;
  select count(*) into nc from pg_class c join pg_attribute att on att.attrelid = c.oid cross join lateral aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and att.attnum > 0 and a.grantee = 'authenticated'::regrole;
  if nt <> 23 or nc <> 16 then
    raise exception 'GRANT-3 authenticated holds % table-level and % column grants, expected 23 and 16', nt, nc;
  end if;
  raise notice 'OK GRANT-3 authenticated holds exactly the 23 table and 16 column grants in the spec';
end $$;

-- The check itself must catch one extra or one missing grant (changes rolled back).
do $$
declare d text;
begin
  begin
    grant insert on public.crew to authenticated;
    d := pg_temp.grant3_diff();
    raise exception 'grant3_rollback';
  exception when raise_exception then
    if sqlerrm <> 'grant3_rollback' then raise; end if;
  end;
  if d is null or d not like '%extra authenticated INSERT on crew%' then
    raise exception 'GRANT-3 check missed an extra authenticated INSERT on crew (got %)', coalesce(d, 'no difference');
  end if;
  raise notice 'OK GRANT-3 check raises on one extra crew INSERT';

  d := null;
  begin
    revoke update on public.jobs from authenticated;
    d := pg_temp.grant3_diff();
    raise exception 'grant3_rollback';
  exception when raise_exception then
    if sqlerrm <> 'grant3_rollback' then raise; end if;
  end;
  if d is null or d not like '%missing authenticated UPDATE on jobs%' then
    raise exception 'GRANT-3 check missed a missing authenticated UPDATE on jobs (got %)', coalesce(d, 'no difference');
  end if;
  raise notice 'OK GRANT-3 check raises on one missing jobs UPDATE';
end $$;

-- ---------- GRANT-4: no TRUNCATE, REFERENCES or TRIGGER for the phone roles ----------
do $$
declare what text;
begin
  select string_agg(who || ' ' || priv || ' on ' || tbl, ', ' order by who, tbl, priv) into what from (
    select a.grantee::regrole::text as who, a.privilege_type as priv, c.relname::text as tbl
      from pg_class c cross join lateral aclexplode(c.relacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
       and a.privilege_type in ('TRUNCATE','REFERENCES','TRIGGER')
    union all
    select a.grantee::regrole::text, a.privilege_type, c.relname || '.' || att.attname
      from pg_class c join pg_attribute att on att.attrelid = c.oid
      cross join lateral aclexplode(att.attacl) a
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and att.attnum > 0
       and a.grantee in ('anon'::regrole, 'authenticated'::regrole)
       and a.privilege_type = 'REFERENCES') x;
  if what is not null then raise exception 'GRANT-4 phone roles hold TRUNCATE, REFERENCES or TRIGGER: %', what; end if;
  raise notice 'OK GRANT-4 anon and authenticated hold no TRUNCATE, REFERENCES or TRIGGER in public';
end $$;

-- ---------- GRANT-5: the chat message id sequence ----------
do $$ begin
  if has_sequence_privilege('anon', 'public.mls_messages_id_seq', 'USAGE') then
    raise exception 'GRANT-5 anon holds USAGE on sequence mls_messages_id_seq'; end if;
  if has_sequence_privilege('anon', 'public.mls_messages_id_seq', 'SELECT') then
    raise exception 'GRANT-5 anon holds SELECT on sequence mls_messages_id_seq'; end if;
  if not has_sequence_privilege('authenticated', 'public.mls_messages_id_seq', 'USAGE') then
    raise exception 'GRANT-5 authenticated lost USAGE on sequence mls_messages_id_seq (chat send would fail)'; end if;
  if not has_sequence_privilege('authenticated', 'public.mls_messages_id_seq', 'SELECT') then
    raise exception 'GRANT-5 authenticated lost SELECT on sequence mls_messages_id_seq'; end if;
  if has_sequence_privilege('authenticated', 'public.mls_messages_id_seq', 'UPDATE') then
    raise exception 'GRANT-5 authenticated holds UPDATE on sequence mls_messages_id_seq (setval)'; end if;
  raise notice 'OK GRANT-5 mls_messages_id_seq: anon none, authenticated usage and select only';
end $$;

-- ---------- GRANT-6: functions in public the phone roles can execute ----------
-- Extension members (pgcrypto sits in public locally, in extensions on hosted) are left out.
do $$
declare what text; n int;
begin
  select string_agg(p.oid::regprocedure::text, ', ' order by p.proname) into what
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('anon', p.oid, 'EXECUTE');
  if what is not null then raise exception 'GRANT-6 anon can EXECUTE public functions: %', what; end if;
  raise notice 'OK GRANT-6 anon can execute 0 public functions';

  select count(*), string_agg(p.proname, ', ' order by p.proname) into n, what
    from pg_proc p
   where p.pronamespace = 'public'::regnamespace
     and not exists (select 1 from pg_depend d where d.classid = 'pg_proc'::regclass and d.objid = p.oid and d.deptype = 'e')
     and has_function_privilege('authenticated', p.oid, 'EXECUTE');
  if n <> 3 or what is distinct from 'crew_consent_status, erase_crew_data, shifts' then
    raise exception 'GRANT-6 authenticated can EXECUTE % public functions (%), expected crew_consent_status, erase_crew_data, shifts',
      n, coalesce(what, 'none');
  end if;
  raise notice 'OK GRANT-6 authenticated executes exactly shifts, crew_consent_status, erase_crew_data';
end $$;

-- ---------- GRANT-7: a table, sequence or function added later starts closed ----------
-- Created as the migration role (the one that ran alter default privileges), then dropped.
create table public.zz_probe (id int);
create sequence public.zz_probe_seq;
create function public.zz_probe_fn() returns int language sql as $$ select 1 $$;
do $$ begin
  if has_table_privilege('anon', 'public.zz_probe', 'SELECT') then
    raise exception 'GRANT-7 anon holds SELECT on new table zz_probe (default privileges still open)'; end if;
  if has_table_privilege('authenticated', 'public.zz_probe', 'SELECT') then
    raise exception 'GRANT-7 authenticated holds SELECT on new table zz_probe (default privileges still open)'; end if;
  if not has_table_privilege('service_role', 'public.zz_probe', 'SELECT') then
    raise exception 'GRANT-7 service_role lacks SELECT on new table zz_probe (Edge Functions would break)'; end if;
  raise notice 'OK GRANT-7 new table: anon and authenticated closed, service_role open';
  if has_sequence_privilege('anon', 'public.zz_probe_seq', 'USAGE') or has_sequence_privilege('authenticated', 'public.zz_probe_seq', 'USAGE') then
    raise exception 'GRANT-7 anon or authenticated holds USAGE on new sequence zz_probe_seq'; end if;
  raise notice 'OK GRANT-7 new sequence: anon and authenticated closed';
  if has_function_privilege('anon', 'public.zz_probe_fn()', 'EXECUTE') then
    raise exception 'GRANT-7 anon can EXECUTE new function zz_probe_fn() (PUBLIC or default privileges still open)'; end if;
  if has_function_privilege('authenticated', 'public.zz_probe_fn()', 'EXECUTE') then
    raise exception 'GRANT-7 authenticated can EXECUTE new function zz_probe_fn() (PUBLIC or default privileges still open)'; end if;
  raise notice 'OK GRANT-7 new function: anon and authenticated closed';
end $$;
drop function public.zz_probe_fn();
drop sequence public.zz_probe_seq;
drop table public.zz_probe;

-- ---------- GRANT-8: the server roles keep what they need ----------
do $$
declare ntab int; n int; what text;
begin
  select count(*) into ntab from pg_class where relnamespace = 'public'::regnamespace and relkind in ('r','p');
  if ntab <> 11 then
    raise exception 'GRANT-8 public has % tables, expected 11 (a new table needs its grants added to GRANT-3)', ntab; end if;
  select count(*) into n from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
     and a.grantee = 'service_role'::regrole
     and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER');
  if n <> 77 then
    select string_agg(c.relname, ', ' order by c.relname) into what from pg_class c
     where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p')
       and (select count(*) from aclexplode(c.relacl) a where a.grantee = 'service_role'::regrole
              and a.privilege_type in ('SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER')) <> 7;
    raise exception 'GRANT-8 service_role holds % of 77 table privileges; short on: %', n, coalesce(what, 'none');
  end if;
  raise notice 'OK GRANT-8 service_role holds all 7 privileges on all 11 public tables';

  select string_agg(c.relname || ' ' || a.privilege_type, ', ') into what
    from pg_class c cross join lateral aclexplode(c.relacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and a.grantee = 'supabase_auth_admin'::regrole;
  if what is not null then raise exception 'GRANT-8 supabase_auth_admin holds table-level grants: %', what; end if;
  select count(*), string_agg(c.relname || '.' || att.attname || ' ' || a.privilege_type, ', ' order by att.attname) into n, what
    from pg_class c join pg_attribute att on att.attrelid = c.oid cross join lateral aclexplode(att.attacl) a
   where c.relnamespace = 'public'::regnamespace and c.relkind in ('r','p') and att.attnum > 0
     and a.grantee = 'supabase_auth_admin'::regrole;
  if n <> 4 or what is distinct from 'crew.active SELECT, crew.id SELECT, crew.org_id SELECT, crew.role SELECT' then
    raise exception 'GRANT-8 supabase_auth_admin holds % column grants (%), expected SELECT on crew id, org_id, role, active',
      n, coalesce(what, 'none');
  end if;
  raise notice 'OK GRANT-8 supabase_auth_admin holds only SELECT on crew id, org_id, role, active';
end $$;
