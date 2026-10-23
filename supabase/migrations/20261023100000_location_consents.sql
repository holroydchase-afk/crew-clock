-- M1.2: each worker's location consent, recorded in the app (docs/PRIVACY.md "Consent", C1-C5).
-- Insert-only: withdrawing is a new 'withdraw' record, never an edit. Retention (C6) comes in M1.4.

create table public.location_consents (
  id uuid primary key default gen_random_uuid(),   -- made on the phone, so a resend is not a duplicate
  org_id uuid not null references public.orgs(id),
  crew_id uuid not null references public.crew(id),
  action text not null check (action in ('agree', 'withdraw')),
  text_version text not null check (length(text_version) between 1 and 40),  -- e.g. loc-v1
  phone_at timestamptz not null,                   -- when they tapped
  received_at timestamptz not null default now(),  -- when the server got it
  device_id text check (length(device_id) <= 80),  -- which phone it was tapped on
  witness_crew_id uuid references public.crew(id)  -- the boss or foreman who walked them through it, if any
);
create index on public.location_consents (crew_id, phone_at desc);

alter table public.location_consents enable row level security;

-- C2: a worker reads their own records; the boss reads every record in the company.
create policy consents_read on public.location_consents for select to authenticated
  using (org_id = app.org_id() and (crew_id = app.crew_id() or app.is_boss()));
-- C1: only the worker makes their own record, from their own session. The sync Edge Function
-- (service role) checks the same rule before it inserts.
create policy consents_insert_own on public.location_consents for insert to authenticated
  with check (org_id = app.org_id() and crew_id = app.crew_id() and witness_crew_id is null);

revoke all on public.location_consents from anon, authenticated;
grant select, insert on public.location_consents to authenticated;

-- A foreman or the boss needs to know whether a teammate agreed before clocking them in (PRIVACY L3),
-- without reading the records themselves: the latest action and text version per worker, nothing else.
create or replace function public.crew_consent_status()
returns table (crew_id uuid, action text, text_version text)
language plpgsql stable security definer set search_path = public, app as $$
begin
  if not app.is_lead() then
    raise exception 'Only a foreman or the boss can see the crew''s consent status' using errcode = '42501';
  end if;
  return query
    select distinct on (c.crew_id) c.crew_id, c.action, c.text_version
    from public.location_consents c
    where c.org_id = app.org_id()
    order by c.crew_id, c.phone_at desc, c.received_at desc;
end $$;
revoke all on function public.crew_consent_status() from public, anon;
grant execute on function public.crew_consent_status() to authenticated;
