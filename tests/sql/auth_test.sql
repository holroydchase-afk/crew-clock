\set ON_ERROR_STOP on
-- Runs after rls_test.sql (same seed). Token hook and sign-out on PIN change.
reset role;
set role supabase_auth_admin;
do $$ declare r jsonb; begin
  r := public.crew_access_token_hook('{"user_id":"00000000-0000-0000-0000-0000000000b1","claims":{"sub":"00000000-0000-0000-0000-0000000000b1","role":"authenticated","aud":"authenticated","session_id":"s1"}}');
  if r #>> '{claims,crew_id}' <> '00000000-0000-0000-0000-0000000000b1' or r #>> '{claims,org_id}' <> '00000000-0000-0000-0000-0000000000a1'
     or r #>> '{claims,crew_role}' <> 'crew' or r #>> '{claims,session_id}' <> 's1' or r #>> '{claims,role}' <> 'authenticated' then
    raise exception 'hook claims wrong: %', r;
  end if;
  r := public.crew_access_token_hook('{"user_id":"00000000-0000-0000-0000-00000000ffff","claims":{}}');
  if r #>> '{error,http_code}' <> '403' then raise exception 'stranger got a token: %', r; end if;
  raise notice 'OK token hook';
end $$;
reset role;

set role authenticated;
do $$ begin
  perform public.crew_access_token_hook('{}');
  raise exception 'phones can call the token hook';
exception when insufficient_privilege then raise notice 'OK hook not callable by phones'; end $$;
reset role;

insert into auth.sessions (user_id) values
  ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b1'), ('00000000-0000-0000-0000-0000000000b2');
update crew set pin_hash = 'pbkdf2$new' where id = '00000000-0000-0000-0000-0000000000b1';
update crew set name = 'Cody M' where id = '00000000-0000-0000-0000-0000000000b2';
do $$ declare n int; r jsonb; begin
  select count(*) into n from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b1';
  if n <> 0 then raise exception 'new PIN left % sessions', n; end if;
  select count(*) into n from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b2';
  if n <> 1 then raise exception 'name change ended sessions'; end if;
  update crew set active = false where id = '00000000-0000-0000-0000-0000000000b2';
  select count(*) into n from auth.sessions where user_id = '00000000-0000-0000-0000-0000000000b2';
  if n <> 0 then raise exception 'deactivating left sessions'; end if;
  r := public.crew_access_token_hook('{"user_id":"00000000-0000-0000-0000-0000000000b2","claims":{}}');
  if r ? 'claims' then raise exception 'inactive crew got a token'; end if;
  raise notice 'OK sign-out on new PIN or let go';
end $$;
