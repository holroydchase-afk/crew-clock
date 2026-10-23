\set ON_ERROR_STOP on
-- M1.2 location consent (CON-4, PRIVACY C1-C3). Runs after rls_test.sql, which seeds the orgs and crew.
-- Jake (b1) agreed and withdrew; Cody (b2) agreed; Stranger (b9) is in another company.
insert into location_consents (id, org_id, crew_id, action, text_version, phone_at, device_id) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'agree', 'loc-v1', '2026-10-21 06:55-04', 'dev-jake'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'withdraw', 'loc-v1', '2026-10-22 06:55-04', 'dev-jake'),
  ('00000000-0000-0000-0000-0000000000f3', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'agree', 'loc-v1', '2026-10-21 07:05-04', 'dev-cody'),
  ('00000000-0000-0000-0000-0000000000f9', '00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b9', 'agree', 'loc-v1', '2026-10-21 07:05-04', null);
do $$ begin
  begin
    insert into location_consents (org_id, crew_id, action, text_version, phone_at) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'maybe', 'loc-v1', now());
    raise exception 'an action other than agree or withdraw was stored';
  exception when check_violation then null; end;
  raise notice 'OK consent actions';
end $$;

set role authenticated;
-- As Jake (crew)
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b1","crew_role":"crew"}', false);
do $$ declare n int; begin
  select count(*) into n from location_consents; if n <> 2 then raise exception 'crew should read only own consent records, saw %', n; end if;
  insert into location_consents (id, org_id, crew_id, action, text_version, phone_at, device_id) values
    ('00000000-0000-0000-0000-0000000000f4', '00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'agree', 'loc-v1', now(), 'dev-jake');
  begin
    insert into location_consents (org_id, crew_id, action, text_version, phone_at) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b2', 'agree', 'loc-v1', now());
    raise exception 'Jake made a consent record for Cody';
  exception when insufficient_privilege then null; end;
  begin
    insert into location_consents (org_id, crew_id, action, text_version, phone_at) values
      ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000b1', 'agree', 'loc-v1', now());
    raise exception 'Jake made a consent record in another company';
  exception when insufficient_privilege then null; end;
  begin
    update location_consents set action = 'agree' where id = '00000000-0000-0000-0000-0000000000f2';
    raise exception 'Jake edited a consent record';
  exception when insufficient_privilege then null; end;
  begin
    delete from location_consents where id = '00000000-0000-0000-0000-0000000000f2';
    raise exception 'Jake deleted a consent record';
  exception when insufficient_privilege then null; end;
  begin
    perform * from crew_consent_status();
    raise exception 'crew read everyone''s consent status';
  exception when insufficient_privilege then null; end;
  raise notice 'OK consent crew isolation';
end $$;

-- As Ray-like foreman (Cody promoted for the test): status only, never the records
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b2","crew_role":"foreman"}', false);
do $$ declare n int; a text; begin
  select count(*) into n from location_consents; if n <> 1 then raise exception 'foreman should read only own records, saw %', n; end if;
  select count(*) into n from crew_consent_status(); if n <> 2 then raise exception 'foreman status should list the 2 org workers with records, got %', n; end if;
  select action into a from crew_consent_status() where crew_id = '00000000-0000-0000-0000-0000000000b1';
  if a <> 'agree' then raise exception 'Jake''s latest should be his re-agree, got %', a; end if;
  raise notice 'OK foreman consent status';
end $$;

-- As Dad (boss): every record in the company, none from another, still no edits
select set_config('request.jwt.claims', '{"org_id":"00000000-0000-0000-0000-0000000000a1","crew_id":"00000000-0000-0000-0000-0000000000b0","crew_role":"boss"}', false);
do $$ declare n int; begin
  select count(*) into n from location_consents; if n <> 4 then raise exception 'boss should read all 4 company records, saw %', n; end if;
  begin
    insert into location_consents (org_id, crew_id, action, text_version, phone_at) values
      ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b1', 'agree', 'loc-v1', now());
    raise exception 'the boss agreed on Jake''s behalf';
  exception when insufficient_privilege then null; end;
  begin
    delete from location_consents;
    raise exception 'the boss deleted consent records';
  exception when insufficient_privilege then null; end;
  raise notice 'OK boss consent scope';
end $$;
reset role;
