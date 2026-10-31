-- M1.9 crew sign-in hardening (F-03, docs/reviews/2026-10-23-privacy-security.md).
-- Lock rounds on the crew row: the third PIN lockout in a day blocks the PIN until the boss sets a
-- new one. Per-IP limits for pin-login and crew-list, counted under an HMAC of the IP (never the IP),
-- kept a day at most. Tests: tests/sql/m19_test.sql, tests/edge/m19.test.ts.

alter table public.crew
  add column if not exists lock_rounds integer not null default 0 check (lock_rounds >= 0),
  add column if not exists lock_rounds_from timestamptz,
  add column if not exists pin_blocked boolean not null default false;
-- Phones read crew through column grants (init.sql), so the new columns stay server-only.

create table if not exists app.rate_hits (
  key text not null check (key ~ '^[a-z-]+:[0-9a-f]{32}$'), -- scope:HMAC of the IP, never the IP
  at timestamptz not null default now()
);
create index if not exists rate_hits_key_at on app.rate_hits (key, at);
revoke all on app.rate_hits from public, anon, authenticated;

-- True when p_key has fewer than p_limit hits in the last p_window_s seconds. p_add records one more
-- (only when allowed). Called by the Edge Functions with the service role; phones can't.
create or replace function public.rate_limit(p_key text, p_limit integer, p_window_s integer, p_add boolean)
returns boolean language plpgsql security definer set search_path = '' as $$
declare n int;
begin
  -- One caller at a time per key, so a burst of parallel requests can't all count the same total (PS-M19-2).
  perform pg_advisory_xact_lock(hashtext(p_key));
  select count(*) into n from app.rate_hits where key = p_key and at > now() - make_interval(secs => p_window_s);
  if n >= p_limit then return false; end if;
  if p_add then insert into app.rate_hits (key) values (p_key); end if;
  return true;
end $$;
revoke all on function public.rate_limit(text, integer, integer, boolean) from public, anon, authenticated;
grant execute on function public.rate_limit(text, integer, integer, boolean) to service_role;

-- One wrong PIN for p_crew, counted in one locked update so parallel guesses each count (PS-M19-2).
-- Five lock the PIN for 15 minutes and start (or add to) the day's lock rounds; the third round inside
-- 24 hours blocks the PIN until the boss sets a new one. Returns 'none', 'timed' or 'blocked'.
create or replace function public.pin_fail(p_crew uuid, p_now timestamptz default now())
returns text language plpgsql security definer set search_path = '' as $$
declare c record; rounds int; same_day boolean;
begin
  select failed_pins, lock_rounds, lock_rounds_from into c from public.crew where id = p_crew for update;
  if not found then return 'none'; end if;
  if c.failed_pins + 1 < 5 then
    update public.crew set failed_pins = c.failed_pins + 1 where id = p_crew;
    return 'none';
  end if;
  same_day := c.lock_rounds_from is not null and p_now - c.lock_rounds_from < interval '24 hours';
  rounds := case when same_day then c.lock_rounds + 1 else 1 end;
  update public.crew set failed_pins = 0, locked_until = p_now + interval '15 minutes', lock_rounds = rounds,
    lock_rounds_from = case when same_day then c.lock_rounds_from else p_now end, pin_blocked = rounds >= 3
    where id = p_crew;
  return case when rounds >= 3 then 'blocked' else 'timed' end;
end $$;
revoke all on function public.pin_fail(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pin_fail(uuid, timestamptz) to service_role;

-- A right PIN: clears the count, but only if no lock or block landed since the row was read (a wrong
-- guess in the same burst may have just locked it, PS-M19-7). False means refuse the sign-in.
create or replace function public.pin_ok(p_crew uuid, p_now timestamptz default now())
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  update public.crew set failed_pins = 0, locked_until = null
    where id = p_crew and not pin_blocked and (locked_until is null or locked_until <= p_now);
  return found;
end $$;
revoke all on function public.pin_ok(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.pin_ok(uuid, timestamptz) to service_role;

-- Retention: the daily run also drops rate hits older than a day (docs/PRIVACY.md).
alter function app.apply_retention(timestamptz) rename to apply_retention_m14;
create or replace function app.apply_retention(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb;
  k int;
begin
  n := app.apply_retention_m14(p_now);
  delete from app.rate_hits where at < p_now - interval '1 day';
  get diagnostics k = row_count;
  return n || jsonb_build_object('rate_hits_deleted', k);
end $$;
revoke all on function app.apply_retention(timestamptz) from public, anon, authenticated;
revoke all on function app.apply_retention_m14(timestamptz) from public, anon, authenticated;
