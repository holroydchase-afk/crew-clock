\set ON_ERROR_STOP on
-- Seed as superuser (stands in for the service role used by Edge Functions)
insert into orgs (id, name, code) values
  ('00000000-0000-0000-0000-0000000000a1', 'Example Construction', 'EXAMPLE1'),
  ('00000000-0000-0000-0000-0000000000a2', 'Other Co', 'OTHER');
insert into crew (id, org_id, name, role) values
  ('00000000-0000-0000-0000-0000000000b0', '00000000-0000-0000-0000-0000000000a1', 'Dad', 'boss'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000a1', 'Jake R.', 'crew'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000a1', 'Cody M.', 'crew'),
  ('00000000-0000-0000-0000-0000000000b9', '00000000-0000-0000-0000-0000000000a2', 'Stranger', 'boss');
update crew set pin_hash = 'pbkdf2$secret';
insert into jobs (id, org_id, name, lat, lng, radius_ft) values
  ('00000000-0000-0000-0000-0000000000c1', '00000000-0000-0000-0000-0000000000a1', 'Smith kitchen', 38.4537, -81.9290, 300),
  ('00000000-0000-0000-0000-0000000000c9', '00000000-0000-0000-0000-0000000000a2', 'Their job', 38.0, -81.0, 300);
-- punches: Jake on site, then out near; Cody wrong job fixed
insert into punches (id, org_id, crew_id, by_crew_id, job_id, type, phone_at, lat, lng, accuracy_m) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-10-21 07:00-04', 38.45375, -81.92895, 8),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'out', '2026-10-21 15:30-04', 38.4557, -81.9290, 10),
  ('00000000-0000-0000-0000-0000000000d3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-10-21 07:10-04', 38.50, -81.90, 10),
  ('00000000-0000-0000-0000-0000000000d4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', null, 'void', '2026-10-21 07:11-04', null, null, null);
update punches set voids_id = '00000000-0000-0000-0000-0000000000d3' where id = '00000000-0000-0000-0000-0000000000d4';
-- the void trigger runs on insert, so re-run its effect for this seed
update punches set status = 'voided' where id = '00000000-0000-0000-0000-0000000000d3';

do $$ declare s text; n int; begin
  select status into s from punches where id = '00000000-0000-0000-0000-0000000000d1';
  if s <> 'onsite' then raise exception 'expected onsite, got %', s; end if;
  select status into s from punches where id = '00000000-0000-0000-0000-0000000000d2';
  if s <> 'near' then raise exception 'expected near, got %', s; end if;
  select count(*) into n from shifts('2026-10-21 00:00-04', '2026-10-22 00:00-04', '00000000-0000-0000-0000-0000000000a1');
  if n <> 1 then raise exception 'expected 1 shift (void excluded), got %', n; end if;
  select (hours*10)::int into n from shifts('2026-10-21 00:00-04', '2026-10-22 00:00-04', '00000000-0000-0000-0000-0000000000a1');
  if n <> 85 then raise exception 'expected 8.5h, got %', n; end if;
  raise notice 'OK scoring + shifts';
end $$;

-- Voids: someone else's punch, or an old one, can't be voided
insert into punches (id, org_id, crew_id, by_crew_id, type, voids_id, phone_at) values
  ('00000000-0000-0000-0000-0000000000d5', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000b2', 'void', '00000000-0000-0000-0000-0000000000d1', '2026-10-21 07:01-04'),
  ('00000000-0000-0000-0000-0000000000d6', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'void', '00000000-0000-0000-0000-0000000000d1', '2026-10-21 12:00-04');
do $$ declare s text; begin
  select status into s from punches where id = '00000000-0000-0000-0000-0000000000d1';
  if s <> 'onsite' then raise exception 'void abuse worked: %', s; end if;
  select status into s from punches where id = '00000000-0000-0000-0000-0000000000d5';
  if s <> 'void_rejected' then raise exception 'bad void not marked: %', s; end if;
  raise notice 'OK void limits';
end $$;

-- As Jake (crew)
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ declare n int; begin
  select count(*) into n from punches; if n <> 3 then raise exception 'crew should see only own punches, saw %', n; end if;
  select count(*) into n from crew; if n <> 3 then raise exception 'crew should see own org names only, saw %', n; end if;
  select count(*) into n from jobs; if n <> 1 then raise exception 'jobs leaked across orgs: %', n; end if;
  begin
    insert into jobs (org_id, name) values ('00000000-0000-0000-0000-0000000000a1', 'Sneaky');
    raise exception 'crew could add a job';
  exception when insufficient_privilege then null; end;
  begin
    insert into punches (id, org_id, crew_id, by_crew_id, type, phone_at) values (gen_random_uuid(), '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000b1', 'in', now());
    raise exception 'crew could write a punch directly';
  exception when insufficient_privilege then null; end;
  raise notice 'OK crew isolation';
end $$;
do $$ begin
  perform pin_hash from crew limit 1;
  raise exception 'pin_hash readable';
exception when insufficient_privilege then raise notice 'OK pin hashes hidden';
end $$;

-- As Dad (boss)
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ declare n int; begin
  select count(*) into n from punches; if n <> 6 then raise exception 'boss should see all org punches, saw %', n; end if;
  insert into jobs (org_id, name, lat, lng) values ('00000000-0000-0000-0000-0000000000a1', 'Miller roof', 38.42, -81.79);
  begin
    insert into jobs (org_id, name) values ('00000000-0000-0000-0000-0000000000a2', 'Other org job');
    raise exception 'boss wrote into another org';
  exception when insufficient_privilege then null; end;
  select count(*) into n from shifts('2026-10-21 00:00-04', '2026-10-22 00:00-04'); if n <> 1 then raise exception 'shifts as boss %', n; end if;
  raise notice 'OK boss scope';
end $$;

-- Messenger: Dad creates a group with Jake, Cody can't read it
do $$ declare n int; begin
  insert into chat_groups (id, org_id, name, created_by) values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000a1', 'Smith crew', '00000000-0000-0000-0000-0000000000b0');
  insert into chat_members values ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b0'), ('00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b1');
  insert into mls_messages (org_id, group_id, sender_crew_id, kind, ciphertext) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b0', 'application', 'Y2lwaGVy');
  raise notice 'OK boss posts';
end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b2","crew_role":"crew"}', false);
do $$ declare n int; begin
  select count(*) into n from mls_messages; if n <> 0 then raise exception 'non-member read messages'; end if;
  begin
    insert into mls_messages (org_id, group_id, sender_crew_id, kind, ciphertext) values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b2', 'application', 'eA==');
    raise exception 'non-member posted';
  exception when insufficient_privilege then null; end;
  raise notice 'OK messenger membership';
end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ declare n int; begin
  select count(*) into n from mls_messages; if n <> 1 then raise exception 'member could not read, %', n; end if;
  raise notice 'OK member reads';
end $$;
reset role;
