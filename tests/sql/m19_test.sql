\set ON_ERROR_STOP on
-- M1.9 crew sign-in hardening (F-03): per-IP limits and lockout rounds. Runs after harden_test.sql,
-- on the orgs and crew seeded by rls_test.sql. Every row below is made up.
-- Expects migration 20261029000000_crew_auth.sql: crew.lock_rounds, lock_rounds_from, pin_blocked;
-- app.rate_hits (key, at) holding only hashed keys; public.rate_limit(key, limit, window_s, add) for
-- the service role only; apply_retention also drops rate hits older than a day.

-- ---------- crew lock columns: defaults, and phones can't read them ----------
do $$ declare r record; begin
  select lock_rounds, lock_rounds_from, pin_blocked into r from crew where id = '00000000-0000-0000-0000-0000000000b1';
  if r.lock_rounds <> 0 or r.lock_rounds_from is not null or r.pin_blocked then raise exception 'F-03 lock columns default wrong: %', r; end if;
  raise notice 'OK F-03 crew lock columns default to 0, null, false';
end $$;

set role authenticated;
do $$ begin
  perform pin_blocked from crew limit 1;
  raise exception 'F-03 a phone could read pin_blocked';
exception when insufficient_privilege then raise notice 'OK F-03 phones cannot read the lock columns'; end $$;
reset role;

-- ---------- rate_limit: counts hits per key inside the window ----------
do $$ declare ok boolean; i int; begin
  for i in 1..3 loop
    ok := public.rate_limit('pin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3, 3600, true);
    if not ok then raise exception 'F-03 hit % of 3 was refused', i; end if;
  end loop;
  if public.rate_limit('pin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3, 3600, false) then raise exception 'F-03 a 4th try was allowed'; end if;
  if (select count(*) from app.rate_hits where key = 'pin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa') <> 3 then raise exception 'F-03 a check-only call added a hit'; end if;
  if not public.rate_limit('pin:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', 3, 3600, false) then raise exception 'F-03 another key was limited'; end if;
  raise notice 'OK F-03 rate_limit allows up to the limit per key, then refuses; a check adds nothing';
end $$;

do $$ begin
  update app.rate_hits set at = now() - interval '2 hours' where key = 'pin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  if not public.rate_limit('pin:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', 3, 3600, false) then raise exception 'F-03 old hits still counted'; end if;
  raise notice 'OK F-03 hits older than the window no longer count';
end $$;

-- ---------- rate_hits never hold a raw IP ----------
do $$ begin
  insert into app.rate_hits (key) values ('pin:203.0.113.7');
  raise exception 'F-03 a raw IP was stored as a rate key';
exception when check_violation then raise notice 'OK F-03 a rate key must be scope:hex hash, never an IP'; end $$;

-- ---------- only the server (service role) can call rate_limit ----------
set role authenticated;
do $$ begin
  perform public.rate_limit('pin:cccccccccccccccccccccccccccccccc', 3, 3600, true);
  raise exception 'F-03 a phone could call rate_limit';
exception when insufficient_privilege then raise notice 'OK F-03 phones cannot call rate_limit'; end $$;
reset role;
set role anon;
do $$ begin
  perform public.rate_limit('pin:cccccccccccccccccccccccccccccccc', 3, 3600, true);
  raise exception 'F-03 anon could call rate_limit';
exception when insufficient_privilege then raise notice 'OK F-03 anon cannot call rate_limit'; end $$;
reset role;
set role service_role;
do $$ begin
  if not public.rate_limit('pin:dddddddddddddddddddddddddddddddd', 3, 3600, true) then raise exception 'F-03 service role refused'; end if;
  raise notice 'OK F-03 the service role can call rate_limit';
end $$;
reset role;

-- ---------- retention: rate hits go after a day ----------
do $$ declare n jsonb; begin
  delete from app.rate_hits;
  insert into app.rate_hits (key, at) values ('crew-list:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', '2030-06-01 12:00Z'::timestamptz - interval '25 hours'),
    ('crew-list:ffffffffffffffffffffffffffffffff', '2030-06-01 12:00Z'::timestamptz - interval '2 hours');
  n := app.apply_retention('2030-06-01 12:00Z');
  if (select count(*) from app.rate_hits) <> 1 then raise exception 'F-03 retention left % rate hits', (select count(*) from app.rate_hits); end if;
  if (n->>'rate_hits_deleted')::int <> 1 then raise exception 'F-03 retention result %', n; end if;
  if not (n ? 'photos_queued') then raise exception 'F-03 retention lost its earlier steps: %', n; end if;
  raise notice 'OK F-03 apply_retention deletes rate hits older than a day and still runs the rest';
end $$;

-- ---------- PS-M19-2: rate_limit counts under a per-key lock, so a burst can't all pass ----------
do $$ begin
  if pg_get_functiondef('public.rate_limit(text, integer, integer, boolean)'::regprocedure) !~ 'pg_advisory_xact_lock' then
    raise exception 'PS-M19-2 rate_limit counts without a per-key lock';
  end if;
  raise notice 'OK PS-M19-2 rate_limit takes a per-key advisory lock before counting';
end $$;

-- ---------- F-03a..d / PS-M19-2: pin_fail counts wrong PINs in one locked update ----------
-- Lock rounds: 5 wrong PINs lock 15 min (round 1); the 3rd lock inside 24 h blocks the PIN; a round
-- older than 24 h starts over. Runs on made-up crew b2 (Cody M. in rls_test.sql).
do $$ declare r text; c record; i int; t timestamptz := '2026-10-29 07:00-04'; begin
  update crew set failed_pins = 0, locked_until = null, lock_rounds = 0, lock_rounds_from = null, pin_blocked = false
    where id = '00000000-0000-0000-0000-0000000000b2';
  for i in 1..4 loop
    r := public.pin_fail('00000000-0000-0000-0000-0000000000b2', t);
    if r <> 'none' then raise exception 'F-03a wrong PIN % locked (%)', i, r; end if;
  end loop;
  select * into c from crew where id = '00000000-0000-0000-0000-0000000000b2';
  if c.failed_pins <> 4 or c.locked_until is not null then raise exception 'F-03a after 4: %', c; end if;
  raise notice 'OK F-03a four wrong PINs count up and lock nothing';

  r := public.pin_fail('00000000-0000-0000-0000-0000000000b2', t);
  select * into c from crew where id = '00000000-0000-0000-0000-0000000000b2';
  if r <> 'timed' or c.failed_pins <> 0 or c.locked_until <> t + interval '15 minutes' or c.lock_rounds <> 1
     or c.lock_rounds_from <> t or c.pin_blocked then raise exception 'F-03b fifth: % %', r, c; end if;
  raise notice 'OK F-03b the fifth wrong PIN locks for 15 minutes and starts round 1';

  for i in 1..5 loop r := public.pin_fail('00000000-0000-0000-0000-0000000000b2', t + interval '1 hour'); end loop;
  if r <> 'timed' then raise exception 'F-03c second round gave %', r; end if;
  for i in 1..5 loop r := public.pin_fail('00000000-0000-0000-0000-0000000000b2', t + interval '5 hours'); end loop;
  select * into c from crew where id = '00000000-0000-0000-0000-0000000000b2';
  if r <> 'blocked' or not c.pin_blocked or c.lock_rounds <> 3 then raise exception 'F-03c third: % %', r, c; end if;
  raise notice 'OK F-03c the third lockout in a day blocks the PIN';

  update crew set failed_pins = 0, locked_until = null, lock_rounds = 2, lock_rounds_from = t - interval '25 hours', pin_blocked = false
    where id = '00000000-0000-0000-0000-0000000000b2';
  for i in 1..5 loop r := public.pin_fail('00000000-0000-0000-0000-0000000000b2', t); end loop;
  select * into c from crew where id = '00000000-0000-0000-0000-0000000000b2';
  if r <> 'timed' or c.lock_rounds <> 1 or c.lock_rounds_from <> t then raise exception 'F-03d old rounds: % %', r, c; end if;
  raise notice 'OK F-03d lock rounds older than a day start over at one';

  update crew set failed_pins = 0, locked_until = null, lock_rounds = 0, lock_rounds_from = null, pin_blocked = false
    where id = '00000000-0000-0000-0000-0000000000b2';
end $$;

do $$ begin
  if pg_get_functiondef('public.pin_fail(uuid, timestamptz)'::regprocedure) !~* 'for update' then
    raise exception 'PS-M19-2 pin_fail reads the row without locking it';
  end if;
  raise notice 'OK PS-M19-2 pin_fail locks the crew row (parallel wrong PINs each count)';
end $$;

set role authenticated;
do $$ begin
  perform public.pin_fail('00000000-0000-0000-0000-0000000000b2', now());
  raise exception 'PS-M19-2 a phone could call pin_fail';
exception when insufficient_privilege then raise notice 'OK PS-M19-2 phones cannot call pin_fail'; end $$;
reset role;

-- ---------- PS-M19-7: a right PIN signs in only if no lock landed meanwhile ----------
do $$ declare t timestamptz := '2026-10-29 07:00-04'; begin
  update crew set failed_pins = 3, locked_until = null, pin_blocked = false where id = '00000000-0000-0000-0000-0000000000b2';
  if not public.pin_ok('00000000-0000-0000-0000-0000000000b2', t) then raise exception 'PS-M19-7 a clean row was refused'; end if;
  if (select failed_pins from crew where id = '00000000-0000-0000-0000-0000000000b2') <> 0 then raise exception 'PS-M19-7 count not cleared'; end if;
  update crew set locked_until = t + interval '10 minutes' where id = '00000000-0000-0000-0000-0000000000b2';
  if public.pin_ok('00000000-0000-0000-0000-0000000000b2', t) then raise exception 'PS-M19-7 a locked row signed in'; end if;
  update crew set locked_until = null, pin_blocked = true where id = '00000000-0000-0000-0000-0000000000b2';
  if public.pin_ok('00000000-0000-0000-0000-0000000000b2', t) then raise exception 'PS-M19-7 a blocked row signed in'; end if;
  update crew set failed_pins = 0, locked_until = null, lock_rounds = 0, lock_rounds_from = null, pin_blocked = false
    where id = '00000000-0000-0000-0000-0000000000b2';
  raise notice 'OK PS-M19-7 pin_ok refuses a row locked or blocked by a guess in the same burst';
end $$;

set role authenticated;
do $$ begin
  perform public.pin_ok('00000000-0000-0000-0000-0000000000b2', now());
  raise exception 'PS-M19-7 a phone could call pin_ok';
exception when insufficient_privilege then raise notice 'OK PS-M19-7 phones cannot call pin_ok'; end $$;
reset role;
