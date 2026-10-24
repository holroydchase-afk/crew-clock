-- M1.4: retention and deletion rules from docs/PRIVACY.md ("Retention" R1-R2, "Deletion").
-- app.apply_retention() does every server-side row of the retention table; pg_cron runs it daily
-- once the crew app is live (M2.4). Consent records are never edited or deleted here: CLAUDE.md's
-- hard rule wins over PRIVACY C6 until Chase decides otherwise.

-- ---------- what the rules need to know ----------

-- When a phone was let go, so its keys can go 90 days later.
alter table public.devices add column revoked_at timestamptz;
-- When a key package was used, so it can go 30 days later.
alter table public.mls_key_packages add column claimed_at timestamptz;

create or replace function app.stamp_revoked() returns trigger
language plpgsql as $$
begin
  if new.revoked and not old.revoked and new.revoked_at is null then new.revoked_at := now(); end if;
  return new;
end $$;
create trigger devices_stamp_revoked before update of revoked on public.devices
  for each row execute function app.stamp_revoked();

create or replace function app.stamp_claimed() returns trigger
language plpgsql as $$
begin
  if new.claimed and not old.claimed and new.claimed_at is null then new.claimed_at := now(); end if;
  return new;
end $$;
create trigger key_packages_stamp_claimed before update of claimed on public.mls_key_packages
  for each row execute function app.stamp_claimed();

-- Old rows must be deletable: a void outlives the punch it voided by a moment, and a punch
-- outlives the phone that sent it. The signature was checked when the punch arrived (sig_ok).
alter table public.punches drop constraint punches_voids_id_fkey,
  add constraint punches_voids_id_fkey foreign key (voids_id) references public.punches(id) on delete set null;
alter table public.punches drop constraint punches_device_id_fkey,
  add constraint punches_device_id_fkey foreign key (device_id) references public.devices(id) on delete set null;

-- B2 picture keys waiting for the Edge Function that holds the B2 key to delete them (R2, M2.3).
-- Only the service role reads it; phones never see it. Rows go 30 days after the object is gone.
create table app.photo_purge (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  photo_key text not null,
  queued_at timestamptz not null default now(),
  done_at timestamptz
);
alter table app.photo_purge enable row level security;
revoke all on app.photo_purge from public, anon, authenticated;
revoke all on sequence app.photo_purge_id_seq from public, anon, authenticated;

-- ---------- R1: the daily run ----------

create or replace function app.apply_retention(p_now timestamptz default now()) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := '{}'::jsonb;
  k int;
begin
  -- Pictures at 60 days (first, so pictures on punches about to be deleted are queued too)
  insert into app.photo_purge (org_id, photo_key, queued_at)
    select org_id, photo_key, p_now from public.punches
    where phone_at < p_now - interval '60 days' and photo_key is not null;
  get diagnostics k = row_count;
  update public.punches set photo_key = null
    where phone_at < p_now - interval '60 days' and photo_key is not null;
  n := n || jsonb_build_object('photos_queued', k);

  -- Hours at 3 years
  delete from public.punches where phone_at < p_now - interval '3 years';
  get diagnostics k = row_count;
  n := n || jsonb_build_object('punches_deleted', k);

  -- Raw GPS at 90 days; status and distance stay so the hours still make sense
  update public.punches set lat = null, lng = null, accuracy_m = null, address = null
    where phone_at < p_now - interval '90 days'
      and (lat is not null or lng is not null or accuracy_m is not null or address is not null);
  get diagnostics k = row_count;
  n := n || jsonb_build_object('gps_cleared', k);

  delete from app.photo_purge where done_at < p_now - interval '30 days';
  get diagnostics k = row_count;
  n := n || jsonb_build_object('purge_rows_deleted', k);

  delete from public.mls_messages where created_at < p_now - interval '30 days';
  get diagnostics k = row_count;
  n := n || jsonb_build_object('messages_deleted', k);

  delete from public.mls_key_packages where claimed and claimed_at < p_now - interval '30 days';
  get diagnostics k = row_count;
  n := n || jsonb_build_object('key_packages_deleted', k);

  delete from public.devices where revoked and revoked_at < p_now - interval '90 days';
  get diagnostics k = row_count;
  n := n || jsonb_build_object('devices_deleted', k);

  -- A worker who left and whose last punch is past 3 years keeps no name or PIN. The row stays,
  -- because their consent records (kept for good) point at it.
  update public.crew c set name = 'Former crew member', pin_hash = null
    where not c.active and (c.name <> 'Former crew member' or c.pin_hash is not null)
      and not exists (select 1 from public.punches p where p.crew_id = c.id or p.by_crew_id = c.id);
  get diagnostics k = row_count;
  n := n || jsonb_build_object('crew_anonymized', k);

  return n;
end $$;
-- Postgres lets everyone run a new function; this one only runs as the owner (pg_cron).
revoke all on function app.apply_retention(timestamptz) from public, anon, authenticated;

-- ---------- a worker leaves: the boss turns them off in the Crew tab ----------

create or replace function app.offboard_crew() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.devices set revoked = true, revoked_at = coalesce(revoked_at, now())
    where crew_id = new.id and not revoked;
  delete from public.push_subscriptions where crew_id = new.id;
  delete from public.chat_members where crew_id = new.id;
  delete from public.mls_key_packages where crew_id = new.id and not claimed;
  return new;
end $$;
revoke all on function app.offboard_crew() from public, anon, authenticated;

create trigger crew_offboard after update of active on public.crew
for each row when (old.active and not new.active)
execute function app.offboard_crew();

-- ---------- a worker asks for their data to be deleted ----------
-- The boss's one action. Hours (time, type, job) stay until the 3-year payroll minimum; consent
-- records stay for good.
create or replace function public.erase_crew_data(p_crew uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  n jsonb := '{}'::jsonb;
  k int;
begin
  if not app.is_boss() or not exists (select 1 from public.crew where id = p_crew and org_id = app.org_id()) then
    raise exception 'Only the boss of this company can erase a worker''s data' using errcode = '42501';
  end if;
  insert into app.photo_purge (org_id, photo_key)
    select org_id, photo_key from public.punches where crew_id = p_crew and photo_key is not null;
  get diagnostics k = row_count;
  n := n || jsonb_build_object('photos_queued', k);
  update public.punches set lat = null, lng = null, accuracy_m = null, address = null, photo_key = null
    where crew_id = p_crew;
  get diagnostics k = row_count;
  n := n || jsonb_build_object('punches_cleared', k);
  delete from public.mls_messages where sender_crew_id = p_crew;
  get diagnostics k = row_count;
  n := n || jsonb_build_object('messages_deleted', k);
  delete from public.mls_key_packages where crew_id = p_crew;
  delete from public.push_subscriptions where crew_id = p_crew;
  delete from public.devices where crew_id = p_crew;
  get diagnostics k = row_count;
  n := n || jsonb_build_object('devices_deleted', k);
  return n;
end $$;
revoke all on function public.erase_crew_data(uuid) from public, anon;
grant execute on function public.erase_crew_data(uuid) to authenticated;
