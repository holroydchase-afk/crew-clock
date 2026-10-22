-- Crew Clock v2 schema for Supabase Postgres.
-- Every table is scoped to an org (a contracting company) and protected by
-- row-level security keyed on claims in the session token that the
-- pin-login Edge Function issues: org_id, crew_id, crew_role, device_id.

create extension if not exists pgcrypto;

create schema if not exists app;

-- ---------- claims helpers ----------

create or replace function app.claims() returns jsonb
language sql stable as $$
  select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;

create or replace function app.org_id() returns uuid
language sql stable as $$ select nullif(app.claims() ->> 'org_id', '')::uuid $$;

create or replace function app.crew_id() returns uuid
language sql stable as $$ select nullif(app.claims() ->> 'crew_id', '')::uuid $$;

create or replace function app.crew_role() returns text
language sql stable as $$ select coalesce(app.claims() ->> 'crew_role', 'crew') $$;

create or replace function app.is_lead() returns boolean
language sql stable as $$ select app.crew_role() in ('foreman', 'boss') $$;

create or replace function app.is_boss() returns boolean
language sql stable as $$ select app.crew_role() = 'boss' $$;

-- ---------- tables ----------

create table public.orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  code text not null unique,          -- short code crews type once, e.g. TEAYS
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

create table public.crew (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  role text not null default 'crew' check (role in ('crew', 'foreman', 'boss')),
  pin_hash text,                       -- pbkdf2$iterations$salt$hash, set by Edge Functions only
  failed_pins integer not null default 0,
  locked_until timestamptz,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.crew (org_id);

create table public.devices (
  id uuid primary key,                 -- made on the phone
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  public_key jsonb not null,           -- P-256 public JWK; the private key never leaves the phone
  last_seq integer not null default 0,
  last_hash text not null default 'genesis',
  user_agent text,
  revoked boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.devices (crew_id);

create table public.jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  address text not null default '',
  lat double precision,
  lng double precision,
  radius_ft integer not null default 300 check (radius_ft between 50 and 5000),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.jobs (org_id) where active;

create table public.punches (
  id uuid primary key,                 -- made on the phone, so a resend is a no-op
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crew(id),
  by_crew_id uuid not null references public.crew(id),
  device_id uuid references public.devices(id),
  job_id uuid references public.jobs(id),
  type text not null check (type in ('in', 'out', 'void')),
  voids_id uuid references public.punches(id),
  phone_at timestamptz not null,
  received_at timestamptz not null default now(),
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  distance_ft integer,
  status text,                         -- onsite | near | offsite | weak | nogps | voided
  photo_key text,                      -- object key in the Backblaze B2 bucket
  photo_sha256 text,
  address text,
  seq integer,                         -- per-device counter
  prev_hash text,
  hash text,
  signature text,
  sig_ok boolean not null default false,
  risk jsonb not null default '[]'::jsonb
);
create index on public.punches (org_id, phone_at desc);
create index on public.punches (crew_id, phone_at desc);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

-- ---------- messenger (MLS delivery service: the server only ever sees ciphertext) ----------

create table public.mls_key_packages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  device_id uuid not null,
  key_package text not null,           -- base64 MLS KeyPackage (public)
  claimed boolean not null default false,
  created_at timestamptz not null default now()
);
create index on public.mls_key_packages (crew_id) where not claimed;

create table public.chat_groups (
  id uuid primary key,                 -- also the MLS group id
  org_id uuid not null references public.orgs(id) on delete cascade,
  name text not null,
  created_by uuid not null references public.crew(id),
  created_at timestamptz not null default now()
);

create table public.chat_members (
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  crew_id uuid not null references public.crew(id) on delete cascade,
  primary key (group_id, crew_id)
);

create table public.mls_messages (
  id bigserial primary key,
  org_id uuid not null references public.orgs(id) on delete cascade,
  group_id uuid not null references public.chat_groups(id) on delete cascade,
  sender_crew_id uuid not null references public.crew(id),
  recipient_crew_id uuid references public.crew(id),   -- set only for Welcome messages
  kind text not null check (kind in ('welcome', 'commit', 'application')),
  epoch bigint not null default 0,
  ciphertext text not null,            -- base64 MLSMessage
  created_at timestamptz not null default now()
);
create index on public.mls_messages (group_id, id);

-- ---------- geofence: same rule as js/geo.js ----------

create or replace function app.distance_m(lat1 double precision, lng1 double precision,
                                          lat2 double precision, lng2 double precision)
returns double precision language sql immutable as $$
  select 2 * 6371000 * asin(least(1, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2))))
$$;

create or replace function app.fence_status(dist_m double precision, accuracy_m double precision,
                                            radius_m double precision)
returns text language sql immutable as $$
  select case
    when dist_m is null or accuracy_m is null then 'nogps'
    when accuracy_m > 152 then 'weak'
    when dist_m - accuracy_m <= radius_m then 'onsite'
    when dist_m - accuracy_m <= radius_m * 3 then 'near'
    else 'offsite'
  end
$$;

-- The server, not the phone, decides distance and status.
create or replace function app.score_punch() returns trigger
language plpgsql as $$
declare
  j public.jobs;
  d double precision;
begin
  if new.type = 'void' then
    new.status := 'voided';
    update public.punches set status = 'voided' where id = new.voids_id and org_id = new.org_id;
    return new;
  end if;
  select * into j from public.jobs where id = new.job_id and org_id = new.org_id;
  if new.lat is null or j.id is null or j.lat is null then
    new.status := 'nogps';
    new.distance_ft := null;
  else
    d := app.distance_m(new.lat, new.lng, j.lat, j.lng);
    new.distance_ft := round(d * 3.28084);
    new.status := app.fence_status(d, new.accuracy_m, j.radius_ft / 3.28084);
  end if;
  return new;
end $$;

create trigger punches_score before insert on public.punches
  for each row execute function app.score_punch();

-- ---------- shifts: same pairing as js/report.js ----------

create or replace function public.shifts(p_from timestamptz, p_to timestamptz, p_org uuid default app.org_id())
returns table (crew_id uuid, crew_name text, job_id uuid, job_name text, clock_in timestamptz,
               clock_out timestamptz, hours numeric, status text, note text)
language plpgsql volatile security invoker as $$
declare
  p record;
  open_rows jsonb := '{}'::jsonb;
  sev jsonb := '{"onsite":0,"near":1,"weak":2,"nogps":3,"offsite":4}';
  r record;
begin
  create temp table if not exists _shifts (
    crew_id uuid, job_id uuid, clock_in timestamptz, clock_out timestamptz, status text, note text, k serial
  ) on commit drop;
  truncate _shifts;
  for p in
    select x.* from public.punches x
    where x.org_id = p_org and x.phone_at >= p_from and x.phone_at < p_to and x.type in ('in', 'out')
      and coalesce(x.status, '') <> 'voided'
    order by x.phone_at
  loop
    if p.type = 'in' then
      if open_rows ? p.crew_id::text then
        update _shifts set note = 'No clock-out' where k = (open_rows ->> p.crew_id::text)::int;
      end if;
      insert into _shifts (crew_id, job_id, clock_in, status) values (p.crew_id, p.job_id, p.phone_at, p.status)
        returning k into r;
      open_rows := open_rows || jsonb_build_object(p.crew_id::text, r.k);
    elsif open_rows ? p.crew_id::text then
      update _shifts s set clock_out = p.phone_at,
        status = case when (sev ->> p.status)::int > (sev ->> s.status)::int then p.status else s.status end
        where s.k = (open_rows ->> p.crew_id::text)::int;
      open_rows := open_rows - p.crew_id::text;
    else
      insert into _shifts (crew_id, job_id, clock_out, status, note)
        values (p.crew_id, p.job_id, p.phone_at, p.status, 'No clock-in');
    end if;
  end loop;
  return query
    select s.crew_id, c.name, s.job_id, j.name, s.clock_in, s.clock_out,
      case when s.clock_in is not null and s.clock_out is not null
        then round(extract(epoch from (s.clock_out - s.clock_in)) / 3600.0, 2) end,
      s.status,
      coalesce(s.note, case when s.clock_out is null then 'Still on the clock' end)
    from _shifts s
    join public.crew c on c.id = s.crew_id
    left join public.jobs j on j.id = s.job_id
    order by c.name, s.clock_in nulls first;
end $$;

-- ---------- row-level security ----------

alter table public.orgs enable row level security;
alter table public.crew enable row level security;
alter table public.devices enable row level security;
alter table public.jobs enable row level security;
alter table public.punches enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.mls_key_packages enable row level security;
alter table public.chat_groups enable row level security;
alter table public.chat_members enable row level security;
alter table public.mls_messages enable row level security;

create policy org_read on public.orgs for select to authenticated using (id = app.org_id());

create policy crew_read on public.crew for select to authenticated using (org_id = app.org_id());
create policy crew_boss_write on public.crew for update to authenticated
  using (org_id = app.org_id() and app.is_boss()) with check (org_id = app.org_id());
-- PIN hashes are never readable by phones, even the boss's.
revoke select on public.crew from authenticated, anon;
grant select (id, org_id, name, role, active, created_at) on public.crew to authenticated;
revoke update on public.crew from authenticated, anon;
grant update (name, role, active) on public.crew to authenticated;

create policy devices_own on public.devices for select to authenticated using (crew_id = app.crew_id());

create policy jobs_read on public.jobs for select to authenticated using (org_id = app.org_id());
create policy jobs_boss_insert on public.jobs for insert to authenticated
  with check (org_id = app.org_id() and app.is_boss());
create policy jobs_boss_update on public.jobs for update to authenticated
  using (org_id = app.org_id() and app.is_boss()) with check (org_id = app.org_id());

-- Punches are written only by the sync Edge Function (it checks signatures), never directly.
create policy punches_read on public.punches for select to authenticated
  using (org_id = app.org_id() and (crew_id = app.crew_id() or app.is_lead()));

create policy push_own on public.push_subscriptions for all to authenticated
  using (crew_id = app.crew_id()) with check (crew_id = app.crew_id() and org_id = app.org_id());

create policy kp_read on public.mls_key_packages for select to authenticated using (org_id = app.org_id());
create policy kp_claim on public.mls_key_packages for update to authenticated
  using (org_id = app.org_id()) with check (org_id = app.org_id());
create policy kp_insert on public.mls_key_packages for insert to authenticated
  with check (crew_id = app.crew_id() and org_id = app.org_id());

create or replace function app.in_group(g uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_members m where m.group_id = g and m.crew_id = app.crew_id())
$$;

create policy groups_read on public.chat_groups for select to authenticated
  using (org_id = app.org_id() and app.in_group(id));
create policy groups_insert on public.chat_groups for insert to authenticated
  with check (org_id = app.org_id() and created_by = app.crew_id());
create policy members_read on public.chat_members for select to authenticated using (app.in_group(group_id));
-- Security definer so the group's creator can add the first members before being one.
create or replace function app.can_add_member(g uuid, who uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.chat_groups x where x.id = g and x.org_id = app.org_id()
                 and (x.created_by = app.crew_id() or app.in_group(g)))
     and exists (select 1 from public.crew c where c.id = who and c.org_id = app.org_id())
$$;
create policy members_insert on public.chat_members for insert to authenticated
  with check (app.can_add_member(group_id, crew_id));

create policy msgs_read on public.mls_messages for select to authenticated
  using (org_id = app.org_id() and app.in_group(group_id)
         and (kind <> 'welcome' or recipient_crew_id = app.crew_id()));
-- A Welcome is addressed to someone not yet in the group, so the sender's membership is what counts.
create policy msgs_insert on public.mls_messages for insert to authenticated
  with check (org_id = app.org_id() and sender_crew_id = app.crew_id() and app.in_group(group_id));
-- Welcomes must be readable by the new member before their own membership row is visible to them.
create policy msgs_welcome_read on public.mls_messages for select to authenticated
  using (org_id = app.org_id() and kind = 'welcome' and recipient_crew_id = app.crew_id());

grant usage on schema app to authenticated, anon;
grant execute on all functions in schema app to authenticated;
grant select, insert, update on public.jobs, public.push_subscriptions, public.mls_key_packages,
  public.chat_groups, public.chat_members, public.mls_messages to authenticated;
grant delete on public.push_subscriptions to authenticated;
grant update (claimed) on public.mls_key_packages to authenticated;
grant select on public.orgs, public.devices, public.punches to authenticated;
grant usage, select on sequence public.mls_messages_id_seq to authenticated;
grant execute on function public.shifts(timestamptz, timestamptz, uuid) to authenticated;

-- Live team map and chat delivery.
do $$ begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.punches, public.mls_messages;
  end if;
end $$;
