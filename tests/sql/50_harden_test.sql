\set ON_ERROR_STOP on
-- M1.12 Harden (HRD-14 bad input, HRD-11 duplicate clock-out). Runs last, after retention_test.sql,
-- on the orgs, crew and jobs seeded by rls_test.sql. Every row below is made up.
-- HRD-14 expects a new migration with check constraints: crew/job names <= 60 chars, job address
-- <= 200, lat -90..90, lng -180..180, accuracy_m >= 0, punch phone_at from 2020 on (and before 2100).
-- No "not in the future" check here: the sync function caps a future phone time itself (a check on
-- now() would turn a fast phone clock into a server error and a stuck outbox).

-- ---------- HRD-14: each bad value is refused by a check constraint ----------
do $$ begin
  insert into crew (id, org_id, name) values ('00000000-0000-0000-0012-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Test Person ' || repeat('x', 49));
  raise exception 'HRD-14 a crew name of 61 chars was stored';
exception when check_violation then raise notice 'OK HRD-14 crew name over 60 chars refused'; end $$;

do $$ begin
  insert into jobs (id, org_id, name) values ('00000000-0000-0000-0012-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Test job ' || repeat('x', 52));
  raise exception 'HRD-14 a job name of 61 chars was stored';
exception when check_violation then raise notice 'OK HRD-14 job name over 60 chars refused'; end $$;

do $$ begin
  insert into jobs (id, org_id, name, address) values ('00000000-0000-0000-0012-0000000000c2', '00000000-0000-0000-0000-0000000000a1', 'Test job', repeat('y', 201));
  raise exception 'HRD-14 a job address of 201 chars was stored';
exception when check_violation then raise notice 'OK HRD-14 job address over 200 chars refused'; end $$;

do $$ begin
  insert into jobs (id, org_id, name, lat, lng) values ('00000000-0000-0000-0012-0000000000c3', '00000000-0000-0000-0000-0000000000a1', 'Test job', 90.5, -81.9);
  raise exception 'HRD-14 a job lat of 90.5 was stored';
exception when check_violation then raise notice 'OK HRD-14 job lat out of range refused'; end $$;

do $$ begin
  insert into jobs (id, org_id, name, lat, lng) values ('00000000-0000-0000-0012-0000000000c4', '00000000-0000-0000-0000-0000000000a1', 'Test job', 38.5, 180.5);
  raise exception 'HRD-14 a job lng of 180.5 was stored';
exception when check_violation then raise notice 'OK HRD-14 job lng out of range refused'; end $$;

do $$ begin
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
    ('00000000-0000-0000-0012-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-11-03 07:00-05', -90.5, -81.9, 8);
  raise exception 'HRD-14 a punch lat of -90.5 was stored';
exception when check_violation then raise notice 'OK HRD-14 punch lat out of range refused'; end $$;

do $$ begin
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
    ('00000000-0000-0000-0012-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-11-03 07:00-05', 38.5, -180.5, 8);
  raise exception 'HRD-14 a punch lng of -180.5 was stored';
exception when check_violation then raise notice 'OK HRD-14 punch lng out of range refused'; end $$;

do $$ begin
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
    ('00000000-0000-0000-0012-000000000003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-11-03 07:00-05', 38.5, -81.9, -1);
  raise exception 'HRD-14 a negative accuracy was stored';
exception when check_violation then raise notice 'OK HRD-14 negative accuracy refused'; end $$;

do $$ begin
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at) values
    ('00000000-0000-0000-0012-000000000004', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '2019-12-31 23:00Z');
  raise exception 'HRD-14 a punch from 2019 was stored';
exception when check_violation then raise notice 'OK HRD-14 punch before 2020 refused'; end $$;

do $$ begin
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at) values
    ('00000000-0000-0000-0012-000000000005', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '3026-11-03 07:00Z');
  raise exception 'HRD-14 a punch from the year 3026 was stored';
exception when check_violation then raise notice 'OK HRD-14 punch after 2100 refused'; end $$;

-- Edge values are fine (both directions).
do $$ begin
  insert into crew (id, org_id, name) values ('00000000-0000-0000-0012-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Test Person ' || repeat('x', 48));
  insert into jobs (id, org_id, name, address, lat, lng) values
    ('00000000-0000-0000-0012-0000000000c5', '00000000-0000-0000-0000-0000000000a1', 'Test job ' || repeat('x', 51), repeat('y', 200), -90, 180);
  insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
    ('00000000-0000-0000-0012-000000000006', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0012-0000000000b2', '00000000-0000-0000-0012-0000000000b2', '00000000-0000-0000-0012-0000000000c5', 'in', '2020-01-01 00:00Z', 90, -180, 0);
  raise notice 'OK HRD-14 edge values (60/200 chars, lat +-90, lng +-180, accuracy 0, 2020-01-01) stored';
end $$;

-- ---------- HRD-11: worker and foreman both clock out the same shift ----------
insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
  ('00000000-0000-0000-0012-000000000011', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in',  '2026-11-03 07:00-05', 38.45375, -81.92895, 8),
  ('00000000-0000-0000-0012-000000000012', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'out', '2026-11-03 15:30-05', 38.45375, -81.92895, 8),
  ('00000000-0000-0000-0012-000000000013', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000c1', 'out', '2026-11-03 15:36-05', 38.45375, -81.92895, 8);

do $$ declare n int; total numeric; dup int; begin
  select count(*), coalesce(sum(hours), 0), count(*) filter (where note ~* 'duplicate')
    into n, total, dup
    from shifts('2026-11-03 00:00-05', '2026-11-04 00:00-05', '00000000-0000-0000-0000-0000000000a1')
    where crew_id = '00000000-0000-0000-0000-0000000000b1';
  if n <> 1 then raise exception 'HRD-11 expected 1 shift for the double clock-out, got %', n; end if;
  if total <> 8.5 then raise exception 'HRD-11 expected 8.5 h, got %', total; end if;
  if dup <> 1 then raise exception 'HRD-11 the shift does not note the duplicate clock-out'; end if;
  raise notice 'OK HRD-11 a second clock-out for the same shift is one shift, noted, no extra hours';
end $$;

-- ---------- PS-M112-3: the checks hold for every row, old ones too ----------
-- A NOT VALID check leaves old out-of-range rows in place, and the next update of such a row (a
-- boss erasing a worker's data) would fail on it. The migration cleans old rows, then validates.
do $$ declare bad text; begin
  select string_agg(conname, ', ') into bad from pg_constraint
    where conname in ('crew_name_len', 'jobs_name_len', 'jobs_address_len', 'jobs_lat_range', 'jobs_lng_range',
                      'punches_lat_range', 'punches_lng_range', 'punches_accuracy_nonneg', 'punches_phone_at_range')
      and not convalidated;
  if bad is not null then raise exception 'PS-M112-3 checks not validated (old rows unchecked): %', bad; end if;
  if (select count(*) from pg_constraint where conname in ('crew_name_len', 'jobs_name_len', 'jobs_address_len', 'jobs_lat_range',
      'jobs_lng_range', 'punches_lat_range', 'punches_lng_range', 'punches_accuracy_nonneg', 'punches_phone_at_range')) <> 9 then
    raise exception 'PS-M112-3 a harden check constraint is missing';
  end if;
  raise notice 'OK PS-M112-3 all nine harden checks are validated';
end $$;

-- The boss erases the data of a worker whose punches sit on the edge values: it goes through.
insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m, hash, signature) values
  ('00000000-0000-0000-0012-000000000021', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0012-0000000000b2', '00000000-0000-0000-0012-0000000000b2', '00000000-0000-0000-0012-0000000000c5', 'out', '2099-12-31 23:59Z', -90, 180, 0, 'h-test-edge', 's-test-edge');
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ begin
  perform public.erase_crew_data('00000000-0000-0000-0012-0000000000b2');
  raise notice 'OK PS-M112-3 erasing a worker with edge-valued punches (2099, lat -90, lng 180, accuracy 0) succeeds';
end $$;
reset role;
select set_config('request.jwt.claims', '', false);
do $$ begin
  if exists (select 1 from punches where crew_id = '00000000-0000-0000-0012-0000000000b2' and (lat is not null or hash is not null)) then
    raise exception 'PS-M112-3 erase left GPS or a hash on the edge-valued punches';
  end if;
end $$;
