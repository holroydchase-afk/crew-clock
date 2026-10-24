\set ON_ERROR_STOP on
-- M1.4 retention and deletion (docs/PRIVACY.md "Retention" R1-R2, "Deletion").
-- Runs after rls_test.sql, auth_test.sql and consent_test.sql, which seed orgs a1/a2, the boss b0,
-- Jake b1, Cody b2 (let go in auth_test) and Stranger b9 (boss of a2). Every row below is made up.
-- Every cutoff is measured from a fixed p_now = 2030-06-01 12:00Z, with a row one day on each side.
-- By then the earlier tests' punches (Oct 2026) are past 3 years and their chat message past 30 days.

-- ---------- fixtures (as superuser, standing in for the service role) ----------
insert into crew (id, org_id, name, role, active, pin_hash) values
  ('00000000-0000-0000-0001-0000000000b3', '00000000-0000-0000-0000-0000000000a1', 'Test Former A', 'crew', false, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000b4', '00000000-0000-0000-0000-0000000000a1', 'Test Former B', 'crew', false, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000b5', '00000000-0000-0000-0000-0000000000a1', 'Test Active C', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0000-0000000000a1', 'Test Active D', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000b7', '00000000-0000-0000-0000-0000000000a1', 'Test Leaver E', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000b8', '00000000-0000-0000-0000-0000000000a1', 'Test Stayer F', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0000-0000000000a1', 'Test Eraser G', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000bb', '00000000-0000-0000-0000-0000000000a1', 'Test Keeper H', 'crew', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000bc', '00000000-0000-0000-0000-0000000000a1', 'Test Foreman I', 'foreman', true, 'pbkdf2$test'),
  ('00000000-0000-0000-0001-0000000000bd', '00000000-0000-0000-0000-0000000000a1', 'Test Leaver J', 'crew', true, 'pbkdf2$test');

-- Consent records for a worker who will be anonymized and one who will be erased. Nothing may touch them.
insert into location_consents (id, org_id, crew_id, action, text_version, phone_at, device_id) values
  ('00000000-0000-0000-0005-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b3', 'agree', 'loc-v1', '2026-10-20 07:00-04', 'dev-test-a'),
  ('00000000-0000-0000-0005-0000000000fa', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', 'agree', 'loc-v1', '2026-10-20 07:00-04', 'dev-test-g');
create temp table _consents_before as select * from location_consents;

-- Devices of Test Active D: revoked 91 days ago (goes), revoked 89 days ago (stays), in use (stays).
insert into devices (id, org_id, crew_id, public_key, revoked, revoked_at) values
  ('00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '{}', true, timestamptz '2030-06-01 12:00Z' - interval '91 days'),
  ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '{}', true, timestamptz '2030-06-01 12:00Z' - interval '89 days'),
  ('00000000-0000-0000-0002-000000000003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '{}', false, null);

-- Punches on each side of 3 years, 90 days (GPS) and 60 days (photos).
insert into punches (id, org_id, crew_id, by_crew_id, device_id, job_id, type, phone_at, lat, lng, accuracy_m, address, photo_key, photo_sha256) values
  -- Test Former A: only punch is past 3 years, so it goes and A is anonymized
  ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b3', '00000000-0000-0000-0001-0000000000b3', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '3 years' - interval '1 day', 38.45375, -81.92895, 8, 'Test address 1', null, null),
  -- Test Former B: a punch past 3 years (goes) that a newer void still points at (stays)
  ('00000000-0000-0000-0003-000000000002', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b4', '00000000-0000-0000-0001-0000000000b4', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '3 years' - interval '1 day', 38.45375, -81.92895, 8, 'Test address 2', null, null),
  ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b4', '00000000-0000-0000-0001-0000000000b4', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '3 years' + interval '1 day', 38.45375, -81.92895, 8, 'Test address 4', null, null),
  -- Test Active D: GPS 91 / 89 days old, photos 61 / 59 days old
  ('00000000-0000-0000-0003-000000000005', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0002-000000000001', '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '91 days', 38.4557, -81.9290, 10, 'Test address 5', null, null),
  ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0001-0000000000b6', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '89 days', 38.45375, -81.92895, 8, 'Test address 6', null, null),
  ('00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0001-0000000000b6', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '61 days', 38.45375, -81.92895, 8, 'Test address 7', 'a1/test-ret-61.jpg', 'sha-test-61'),
  ('00000000-0000-0000-0003-000000000008', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0001-0000000000b6', null, '00000000-0000-0000-0000-0000000000c1', 'in',
   timestamptz '2030-06-01 12:00Z' - interval '59 days', 38.45375, -81.92895, 8, 'Test address 8', 'a1/test-ret-59.jpg', 'sha-test-59');
insert into punches (id, org_id, crew_id, by_crew_id, type, voids_id, phone_at) values
  ('00000000-0000-0000-0003-000000000003', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b4', '00000000-0000-0000-0001-0000000000b4', 'void',
   '00000000-0000-0000-0003-000000000002', timestamptz '2030-06-01 12:00Z' - interval '3 years' + interval '1 day');
create temp table _punches_before as select id, status, distance_ft, photo_sha256 from punches;

-- Photo deletions already queued: done 31 days ago (goes), done 29 days ago (stays), never done (stays).
insert into app.photo_purge (org_id, photo_key, queued_at, done_at) values
  ('00000000-0000-0000-0000-0000000000a1', 'a1/test-purged-31.jpg', timestamptz '2030-06-01 12:00Z' - interval '40 days', timestamptz '2030-06-01 12:00Z' - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1/test-purged-29.jpg', timestamptz '2030-06-01 12:00Z' - interval '40 days', timestamptz '2030-06-01 12:00Z' - interval '29 days'),
  ('00000000-0000-0000-0000-0000000000a1', 'a1/test-pending-old.jpg', timestamptz '2030-06-01 12:00Z' - interval '400 days', null);

-- Chat ciphertext 31 / 29 days old, in the Smith crew group from rls_test.sql.
insert into mls_messages (org_id, group_id, sender_crew_id, kind, ciphertext, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b0', 'application', 'dGVzdC0zMQ==', timestamptz '2030-06-01 12:00Z' - interval '31 days'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000e1', '00000000-0000-0000-0000-0000000000b0', 'application', 'dGVzdC0yOQ==', timestamptz '2030-06-01 12:00Z' - interval '29 days');

-- Key packages: claimed 31 / 29 days ago, and one never claimed that is very old.
insert into mls_key_packages (org_id, crew_id, device_id, key_package, claimed, claimed_at, created_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0002-000000000003', 'kp-test-claimed-31', true, timestamptz '2030-06-01 12:00Z' - interval '31 days', timestamptz '2030-06-01 12:00Z' - interval '60 days'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0002-000000000003', 'kp-test-claimed-29', true, timestamptz '2030-06-01 12:00Z' - interval '29 days', timestamptz '2030-06-01 12:00Z' - interval '60 days'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0002-000000000003', 'kp-test-unclaimed-old', false, null, timestamptz '2030-06-01 12:00Z' - interval '1000 days');

-- ---------- RET-1 nobody but the owner's scheduled job can run retention ----------
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ begin
  perform app.apply_retention('2030-06-01 12:00Z');
  raise exception 'crew could run apply_retention';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ begin
  perform app.apply_retention('2030-06-01 12:00Z');
  raise exception 'the boss could run apply_retention';
exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
select set_config('request.jwt.claims', '', false);
do $$ begin
  perform app.apply_retention('2030-06-01 12:00Z');
  raise exception 'anon could run apply_retention';
exception when insufficient_privilege then null; end $$;
reset role;
do $$ declare n int; begin
  select count(*) into n from punches where id = '00000000-0000-0000-0003-000000000001';
  if n <> 1 then raise exception 'a refused retention call still deleted punches'; end if;
  raise notice 'OK RET-1 retention not callable by phones (crew, boss, anon)';
end $$;

-- ---------- RET-2 one run applies every rule ----------
create temp table _ret_runs (run int, result jsonb);
do $$ declare r jsonb; begin
  r := app.apply_retention('2030-06-01 12:00Z');
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'apply_retention should return a jsonb object of counts, got %', r; end if;
  if not exists (select 1 from jsonb_each(r) where jsonb_typeof(value) = 'number' and value::text::numeric > 0) then
    raise exception 'first run reported no work: %', r;
  end if;
  insert into _ret_runs values (1, r);
end $$;

do $$ declare n int; p record; b record; begin
  -- Hours: 3 years
  select count(*) into n from punches where id in ('00000000-0000-0000-0003-000000000001', '00000000-0000-0000-0003-000000000002');
  if n <> 0 then raise exception 'punches past 3 years were kept (%)', n; end if;
  select count(*) into n from punches where phone_at < timestamptz '2030-06-01 12:00Z' - interval '3 years';
  if n <> 0 then raise exception '% punches older than 3 years remain (incl. earlier tests)', n; end if;
  select * into p from punches where id = '00000000-0000-0000-0003-000000000003';
  if p.id is null then raise exception 'a void inside 3 years was deleted with the punch it voided'; end if;
  if p.voids_id is not null then raise exception 'void still points at a deleted punch'; end if;
  select * into p from punches where id = '00000000-0000-0000-0003-000000000004';
  if p.id is null then raise exception 'punch 3 years minus a day was deleted'; end if;
  raise notice 'OK RET-2a hours kept 3 years, voids do not block deletion';
end $$;

do $$ declare p record; b record; begin
  -- Raw GPS: 90 days
  for p in select * from punches where id in ('00000000-0000-0000-0003-000000000004', '00000000-0000-0000-0003-000000000005') loop
    if p.lat is not null or p.lng is not null or p.accuracy_m is not null or p.address is not null then
      raise exception 'GPS past 90 days kept on punch %', p.id;
    end if;
    select * into b from _punches_before where id = p.id;
    if p.status is distinct from b.status or p.distance_ft is distinct from b.distance_ft then
      raise exception 'status or distance changed on punch % (% %, was % %)', p.id, p.status, p.distance_ft, b.status, b.distance_ft;
    end if;
    if p.status is null or p.distance_ft is null then raise exception 'fixture punch % had no status/distance', p.id; end if;
  end loop;
  for p in select * from punches where id in ('00000000-0000-0000-0003-000000000006', '00000000-0000-0000-0003-000000000007', '00000000-0000-0000-0003-000000000008') loop
    if p.lat is null or p.lng is null or p.accuracy_m is null or p.address is null then
      raise exception 'GPS inside 90 days was removed from punch %', p.id;
    end if;
  end loop;
  raise notice 'OK RET-2b GPS nulled after 90 days, status and distance kept';
end $$;

do $$ declare p record; n int; begin
  -- Photos: 60 days
  select * into p from punches where id = '00000000-0000-0000-0003-000000000007';
  if p.photo_key is not null then raise exception 'photo key past 60 days kept'; end if;
  if p.photo_sha256 is distinct from 'sha-test-61' then raise exception 'photo_sha256 should be kept, got %', p.photo_sha256; end if;
  select count(*) into n from app.photo_purge
    where photo_key = 'a1/test-ret-61.jpg' and org_id = '00000000-0000-0000-0000-0000000000a1' and done_at is null and queued_at is not null;
  if n <> 1 then raise exception 'expected 1 queued B2 deletion for the 61-day photo, got %', n; end if;
  select * into p from punches where id = '00000000-0000-0000-0003-000000000008';
  if p.photo_key is distinct from 'a1/test-ret-59.jpg' then raise exception 'photo inside 60 days was removed'; end if;
  select count(*) into n from app.photo_purge where photo_key = 'a1/test-ret-59.jpg';
  if n <> 0 then raise exception 'photo inside 60 days was queued for deletion'; end if;
  -- Purge queue: done rows go after 30 days, undone rows stay
  select count(*) into n from app.photo_purge where photo_key = 'a1/test-purged-31.jpg';
  if n <> 0 then raise exception 'purge row done 31 days ago was kept'; end if;
  select count(*) into n from app.photo_purge where photo_key in ('a1/test-purged-29.jpg', 'a1/test-pending-old.jpg');
  if n <> 2 then raise exception 'recent done or undone purge rows were removed (% of 2 left)', n; end if;
  raise notice 'OK RET-2c photos queued for B2 deletion after 60 days, queue trimmed';
end $$;

do $$ declare n int; begin
  -- Chat ciphertext: 30 days
  select count(*) into n from mls_messages where ciphertext = 'dGVzdC0zMQ=='; if n <> 0 then raise exception 'chat ciphertext past 30 days kept'; end if;
  select count(*) into n from mls_messages where ciphertext = 'dGVzdC0yOQ=='; if n <> 1 then raise exception 'chat ciphertext inside 30 days removed'; end if;
  select count(*) into n from mls_messages where created_at < timestamptz '2030-06-01 12:00Z' - interval '30 days';
  if n <> 0 then raise exception '% messages older than 30 days remain', n; end if;
  -- Key packages: 30 days after claimed; unclaimed kept
  select count(*) into n from mls_key_packages where key_package = 'kp-test-claimed-31'; if n <> 0 then raise exception 'key package claimed 31 days ago kept'; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-claimed-29'; if n <> 1 then raise exception 'key package claimed 29 days ago removed'; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-unclaimed-old'; if n <> 1 then raise exception 'unclaimed key package removed'; end if;
  raise notice 'OK RET-2d chat after 30 days, used key packages 30 days after claimed';
end $$;

do $$ declare n int; d uuid; begin
  -- Devices: 90 days after revoked; a punch that used one keeps its hours
  select count(*) into n from devices where id = '00000000-0000-0000-0002-000000000001'; if n <> 0 then raise exception 'device revoked 91 days ago kept'; end if;
  select count(*) into n from devices where id in ('00000000-0000-0000-0002-000000000002', '00000000-0000-0000-0002-000000000003');
  if n <> 2 then raise exception 'device revoked 89 days ago or in use was removed (% of 2 left)', n; end if;
  select device_id into d from punches where id = '00000000-0000-0000-0003-000000000005';
  if not found then raise exception 'punch from a deleted device was deleted'; end if;
  if d is not null then raise exception 'punch still points at a deleted device'; end if;
  raise notice 'OK RET-2e devices deleted 90 days after revoked';
end $$;

do $$ declare c record; begin
  -- Crew: inactive with no punches left are anonymized
  select * into c from crew where id = '00000000-0000-0000-0001-0000000000b3';
  if c.name <> 'Former crew member' then raise exception 'inactive worker with no punches kept name %', c.name; end if;
  if c.pin_hash is not null then raise exception 'anonymized worker kept a PIN hash'; end if;
  select * into c from crew where id = '00000000-0000-0000-0001-0000000000b4';
  if c.name <> 'Test Former B' then raise exception 'inactive worker with punches left lost their name (%)', c.name; end if;
  select * into c from crew where id = '00000000-0000-0000-0001-0000000000b5';
  if c.name <> 'Test Active C' then raise exception 'active worker without punches lost their name (%)', c.name; end if;
  select * into c from crew where id = '00000000-0000-0000-0000-0000000000b0';
  if c.name <> 'Dad' then raise exception 'the boss lost their name (%)', c.name; end if;
  raise notice 'OK RET-2f inactive crew with no hours left anonymized';
end $$;

do $$ declare n int; begin
  select count(*) into n from location_consents; if n <> (select count(*) from _consents_before) then raise exception 'retention changed the number of consent records (%)', n; end if;
  select count(*) into n from (select * from _consents_before except select * from location_consents) x;
  if n <> 0 then raise exception 'retention edited or deleted % consent records', n; end if;
  select count(*) into n from (select * from location_consents except select * from _consents_before) x;
  if n <> 0 then raise exception 'retention edited % consent records', n; end if;
  raise notice 'OK RET-2g consent records untouched by retention';
end $$;

-- ---------- RET-3 a second run right after does nothing ----------
create temp table _snap as select
  (select count(*) from punches) punches, (select count(*) from punches where lat is not null) gps,
  (select count(*) from punches where photo_key is not null) photos, (select count(*) from app.photo_purge) purge,
  (select count(*) from mls_messages) msgs, (select count(*) from mls_key_packages) kps,
  (select count(*) from devices) devs, (select string_agg(name, ',' order by id) from crew) names;
do $$ declare r jsonb; n int; s record; begin
  r := app.apply_retention('2030-06-01 12:00Z');
  insert into _ret_runs values (2, r);
  select count(*) into n from jsonb_each(r) where value <> '0'::jsonb;
  if n <> 0 then raise exception 'second run was not a no-op: %', r; end if;
  if (select array_agg(k order by k) from jsonb_object_keys(r) k) is distinct from
     (select array_agg(k order by k) from _ret_runs, jsonb_object_keys(result) k where run = 1) then
    raise exception 'second run reported different rules: %', r;
  end if;
  select * into s from _snap;
  if s.punches <> (select count(*) from punches) or s.gps <> (select count(*) from punches where lat is not null)
     or s.photos <> (select count(*) from punches where photo_key is not null) or s.purge <> (select count(*) from app.photo_purge)
     or s.msgs <> (select count(*) from mls_messages) or s.kps <> (select count(*) from mls_key_packages)
     or s.devs <> (select count(*) from devices) or s.names <> (select string_agg(name, ',' order by id) from crew) then
    raise exception 'second run changed rows';
  end if;
  raise notice 'OK RET-3 retention is idempotent';
end $$;

-- ---------- RET-4 claiming a key package stamps claimed_at ----------
insert into mls_key_packages (org_id, crew_id, device_id, key_package) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b6', '00000000-0000-0000-0002-000000000003', 'kp-test-trigger');
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
update mls_key_packages set claimed = true where key_package = 'kp-test-trigger';
reset role;
do $$ declare t timestamptz; begin
  select claimed_at into t from mls_key_packages where key_package = 'kp-test-trigger';
  if t is null then raise exception 'claiming a key package did not set claimed_at'; end if;
  raise notice 'OK RET-4 claimed_at set when a key package is claimed';
end $$;

-- ---------- DEL-1 a worker is let go: devices revoked, push, chat and unclaimed key packages gone at once ----------
insert into devices (id, org_id, crew_id, public_key) values
  ('00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b7', '{}'),
  ('00000000-0000-0000-0002-000000000008', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b8', '{}'),
  ('00000000-0000-0000-0002-00000000000d', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bd', '{}');
insert into push_subscriptions (org_id, crew_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b7', 'https://push.example.invalid/test-b7', 'x', 'y'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b8', 'https://push.example.invalid/test-b8', 'x', 'y'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bd', 'https://push.example.invalid/test-bd', 'x', 'y');
insert into chat_groups (id, org_id, name, created_by) values
  ('00000000-0000-0000-0004-0000000000e2', '00000000-0000-0000-0000-0000000000a1', 'Test group', '00000000-0000-0000-0000-0000000000b0');
insert into chat_members values
  ('00000000-0000-0000-0004-0000000000e2', '00000000-0000-0000-0000-0000000000b0'),
  ('00000000-0000-0000-0004-0000000000e2', '00000000-0000-0000-0001-0000000000b7'),
  ('00000000-0000-0000-0004-0000000000e2', '00000000-0000-0000-0001-0000000000b8'),
  ('00000000-0000-0000-0004-0000000000e2', '00000000-0000-0000-0001-0000000000bd');
insert into mls_key_packages (org_id, crew_id, device_id, key_package, claimed, claimed_at) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b7', '00000000-0000-0000-0002-000000000007', 'kp-test-b7-unclaimed', false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b7', '00000000-0000-0000-0002-000000000007', 'kp-test-b7-claimed', true, now()),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b8', '00000000-0000-0000-0002-000000000008', 'kp-test-b8-unclaimed', false, null),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bd', '00000000-0000-0000-0002-00000000000d', 'kp-test-bd-unclaimed', false, null);
insert into punches (id, org_id, crew_id, by_crew_id, device_id, job_id, type, phone_at, lat, lng, accuracy_m) values
  ('00000000-0000-0000-0003-000000000071', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000b7', '00000000-0000-0000-0001-0000000000b7', '00000000-0000-0000-0002-000000000007', '00000000-0000-0000-0000-0000000000c1', 'in', '2026-10-20 07:00-04', 38.45375, -81.92895, 8);

update crew set active = false where id = '00000000-0000-0000-0001-0000000000b7';
do $$ declare n int; d record; begin
  select * into d from devices where id = '00000000-0000-0000-0002-000000000007';
  if d.id is null then raise exception 'leaver''s device was deleted at once (should be revoked, then kept 90 days)'; end if;
  if not d.revoked or d.revoked_at is null then raise exception 'leaver''s device not revoked with a time (revoked %, at %)', d.revoked, d.revoked_at; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000b7'; if n <> 0 then raise exception 'leaver kept % push subscriptions', n; end if;
  select count(*) into n from chat_members where crew_id = '00000000-0000-0000-0001-0000000000b7'; if n <> 0 then raise exception 'leaver still in % chat groups', n; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-b7-unclaimed'; if n <> 0 then raise exception 'leaver''s unclaimed key package kept'; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-b7-claimed'; if n <> 1 then raise exception 'leaver''s claimed key package removed'; end if;
  select count(*) into n from punches where crew_id = '00000000-0000-0000-0001-0000000000b7'; if n <> 1 then raise exception 'leaver''s punches removed (% left)', n; end if;
  -- another worker untouched
  select * into d from devices where id = '00000000-0000-0000-0002-000000000008';
  if d.revoked or d.revoked_at is not null then raise exception 'another worker''s device was revoked'; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000b8'; if n <> 1 then raise exception 'another worker lost push'; end if;
  select count(*) into n from chat_members where group_id = '00000000-0000-0000-0004-0000000000e2'; if n <> 3 then raise exception 'other members removed from the group (% left of 3)', n; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-b8-unclaimed'; if n <> 1 then raise exception 'another worker lost a key package'; end if;
  raise notice 'OK DEL-1 letting a worker go revokes devices, drops push, chat and unclaimed key packages';
end $$;

-- The same, done the way the app does it: the boss's Crew tab, as authenticated through RLS.
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
update crew set active = false where id = '00000000-0000-0000-0001-0000000000bd';
reset role;
do $$ declare n int; d record; begin
  select * into d from devices where id = '00000000-0000-0000-0002-00000000000d';
  if d.id is null or not d.revoked or d.revoked_at is null then raise exception 'boss''s Crew tab did not revoke the leaver''s device'; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000bd'; if n <> 0 then raise exception 'boss''s Crew tab left push'; end if;
  select count(*) into n from chat_members where crew_id = '00000000-0000-0000-0001-0000000000bd'; if n <> 0 then raise exception 'boss''s Crew tab left chat membership'; end if;
  select count(*) into n from mls_key_packages where key_package = 'kp-test-bd-unclaimed'; if n <> 0 then raise exception 'boss''s Crew tab left unclaimed key package'; end if;
  raise notice 'OK DEL-1b letting go from the boss''s Crew tab (RLS) does the same';
end $$;

-- ---------- DEL-2 the boss erases a worker's data on request ----------
insert into devices (id, org_id, crew_id, public_key) values
  ('00000000-0000-0000-0002-00000000000a', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', '{}'),
  ('00000000-0000-0000-0002-00000000000b', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bb', '{}');
insert into push_subscriptions (org_id, crew_id, endpoint, p256dh, auth) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', 'https://push.example.invalid/test-ba', 'x', 'y'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bb', 'https://push.example.invalid/test-bb', 'x', 'y');
insert into mls_key_packages (org_id, crew_id, device_id, key_package) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0002-00000000000a', 'kp-test-ba'),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bb', '00000000-0000-0000-0002-00000000000b', 'kp-test-bb');
insert into chat_groups (id, org_id, name, created_by) values
  ('00000000-0000-0000-0004-0000000000e3', '00000000-0000-0000-0000-0000000000a1', 'Test group 2', '00000000-0000-0000-0000-0000000000b0');
insert into mls_messages (org_id, group_id, sender_crew_id, kind, ciphertext) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-0000000000e3', '00000000-0000-0000-0001-0000000000ba', 'application', 'ZXJhc2UtMQ=='),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-0000000000e3', '00000000-0000-0000-0001-0000000000ba', 'application', 'ZXJhc2UtMg=='),
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0004-0000000000e3', '00000000-0000-0000-0001-0000000000bb', 'application', 'a2VlcC0x');
insert into punches (id, org_id, crew_id, by_crew_id, device_id, job_id, type, phone_at, lat, lng, accuracy_m, address, photo_key, photo_sha256) values
  ('00000000-0000-0000-0003-0000000000a1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0002-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'in',  '2026-10-20 07:00-04', 38.45375, -81.92895, 8, 'Test address a1', 'a1/test-erase-a1.jpg', 'sha-test-a1'),
  ('00000000-0000-0000-0003-0000000000a2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0001-0000000000ba', '00000000-0000-0000-0002-00000000000a', '00000000-0000-0000-0000-0000000000c1', 'out', '2026-10-20 15:30-04', 38.4557, -81.9290, 10, 'Test address a2', null, null),
  ('00000000-0000-0000-0003-0000000000b1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0001-0000000000bb', '00000000-0000-0000-0001-0000000000bb', '00000000-0000-0000-0002-00000000000b', '00000000-0000-0000-0000-0000000000c1', 'in',  '2026-10-20 07:00-04', 38.45375, -81.92895, 8, 'Test address b1', 'a1/test-keep-b1.jpg', 'sha-test-b1');

-- Only the boss of the same company may erase: not crew, not a foreman, not another company's boss.
create or replace function pg_temp.erase_untouched(who text) returns void language plpgsql as $$
declare n int; begin
  select count(*) into n from punches where crew_id = '00000000-0000-0000-0001-0000000000ba' and lat is not null and address is not null;
  if n <> 2 then raise exception '% erased GPS (% punches with GPS left of 2)', who, n; end if;
  select count(*) into n from punches where crew_id = '00000000-0000-0000-0001-0000000000ba' and photo_key is not null;
  if n <> 1 then raise exception '% erased photo keys', who; end if;
  select count(*) into n from app.photo_purge where photo_key = 'a1/test-erase-a1.jpg'; if n <> 0 then raise exception '% queued photo deletion', who; end if;
  select count(*) into n from devices where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 1 then raise exception '% deleted devices', who; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 1 then raise exception '% deleted push', who; end if;
  select count(*) into n from mls_key_packages where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 1 then raise exception '% deleted key packages', who; end if;
  select count(*) into n from mls_messages where sender_crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 2 then raise exception '% deleted messages', who; end if;
end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ begin
  perform public.erase_crew_data('00000000-0000-0000-0001-0000000000ba');
  raise exception 'crew could erase a worker''s data';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0001-0000000000bc","crew_role":"foreman"}', false);
do $$ begin
  perform public.erase_crew_data('00000000-0000-0000-0001-0000000000ba');
  raise exception 'a foreman could erase a worker''s data';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a2","crew_id":"00000000-0000-0000-0000-0000000000b9","crew_role":"boss"}', false);
do $$ begin
  perform public.erase_crew_data('00000000-0000-0000-0001-0000000000ba');
  raise exception 'another company''s boss could erase our worker''s data';
exception when insufficient_privilege then null; end $$;
reset role;
select pg_temp.erase_untouched('a refused caller');
do $$ begin raise notice 'OK DEL-2a only the same company''s boss can erase (crew, foreman, other boss refused)'; end $$;

set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ declare r jsonb; begin
  r := public.erase_crew_data('00000000-0000-0000-0001-0000000000ba');
  if r is null or jsonb_typeof(r) <> 'object' then raise exception 'erase_crew_data should return a jsonb object, got %', r; end if;
end $$;
reset role;
do $$ declare n int; p record; begin
  select count(*) into n from punches where crew_id = '00000000-0000-0000-0001-0000000000ba';
  if n <> 2 then raise exception 'erase removed hours (% punches left of 2)', n; end if;
  for p in select * from punches where crew_id = '00000000-0000-0000-0001-0000000000ba' loop
    if p.lat is not null or p.lng is not null or p.accuracy_m is not null or p.address is not null then raise exception 'erase left GPS on punch %', p.id; end if;
    if p.photo_key is not null then raise exception 'erase left a photo key on punch %', p.id; end if;
    if p.phone_at is null or p.type is null or p.job_id is null then raise exception 'erase damaged hours on punch %', p.id; end if;
  end loop;
  select count(*) into n from app.photo_purge where photo_key = 'a1/test-erase-a1.jpg' and org_id = '00000000-0000-0000-0000-0000000000a1' and done_at is null;
  if n <> 1 then raise exception 'erased photo not queued for B2 deletion (%)', n; end if;
  select count(*) into n from devices where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 0 then raise exception 'erase left devices'; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 0 then raise exception 'erase left push'; end if;
  select count(*) into n from mls_key_packages where crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 0 then raise exception 'erase left key packages'; end if;
  select count(*) into n from mls_messages where sender_crew_id = '00000000-0000-0000-0001-0000000000ba'; if n <> 0 then raise exception 'erase left sent messages'; end if;
  -- the other worker is untouched
  select * into p from punches where id = '00000000-0000-0000-0003-0000000000b1';
  if p.lat is null or p.address is null or p.photo_key is distinct from 'a1/test-keep-b1.jpg' then raise exception 'erase touched another worker''s punch'; end if;
  select count(*) into n from app.photo_purge where photo_key = 'a1/test-keep-b1.jpg'; if n <> 0 then raise exception 'erase queued another worker''s photo'; end if;
  select count(*) into n from devices where crew_id = '00000000-0000-0000-0001-0000000000bb'; if n <> 1 then raise exception 'erase touched another worker''s device'; end if;
  select count(*) into n from push_subscriptions where crew_id = '00000000-0000-0000-0001-0000000000bb'; if n <> 1 then raise exception 'erase touched another worker''s push'; end if;
  select count(*) into n from mls_key_packages where crew_id = '00000000-0000-0000-0001-0000000000bb'; if n <> 1 then raise exception 'erase touched another worker''s key package'; end if;
  select count(*) into n from mls_messages where sender_crew_id = '00000000-0000-0000-0001-0000000000bb'; if n <> 1 then raise exception 'erase touched another worker''s messages'; end if;
  raise notice 'OK DEL-2b boss erases GPS, photos, devices, push, key packages and sent chat; hours kept';
end $$;

-- ---------- DEL-3 consent records survive retention and erasure, unchanged ----------
do $$ declare n int; begin
  select count(*) into n from location_consents; if n <> (select count(*) from _consents_before) then raise exception 'consent record count changed (%)', n; end if;
  select count(*) into n from (select * from _consents_before except select * from location_consents) x;
  if n <> 0 then raise exception '% consent records were edited or deleted', n; end if;
  select count(*) into n from (select * from location_consents except select * from _consents_before) x;
  if n <> 0 then raise exception '% consent records were edited', n; end if;
  raise notice 'OK DEL-3 consent records never edited or deleted';
end $$;

-- ---------- RET-5 the photo deletion queue is server-only ----------
do $$ begin
  if not (select relrowsecurity from pg_class where oid = 'app.photo_purge'::regclass) then
    raise exception 'row-level security is off on app.photo_purge';
  end if;
end $$;
set role authenticated;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ begin
  perform 1 from app.photo_purge;
  raise exception 'the boss could read app.photo_purge';
exception when insufficient_privilege then null; end $$;
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ begin
  perform 1 from app.photo_purge;
  raise exception 'crew could read app.photo_purge';
exception when insufficient_privilege then null; end $$;
reset role;
set role anon;
do $$ begin
  perform 1 from app.photo_purge;
  raise exception 'anon could read app.photo_purge';
exception when insufficient_privilege then raise notice 'OK RET-5 photo_purge has RLS on and no grant to phones'; end $$;
reset role;
select set_config('request.jwt.claims', '', false);
