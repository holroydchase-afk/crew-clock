-- M1.12 Harden (HRD-14, HRD-11).
-- HRD-14: the database refuses values no phone or boss screen can make. The sync Edge Function
-- drops bad coordinates and caps a future phone time before insert, so a real clock-in never hits
-- these checks; they are the last line, not the first.
-- There is deliberately no "phone_at <= now()" check: a phone clock running fast would turn into a
-- server error and a stuck outbox. Sync caps future times instead.
-- PS-M112-3: the checks are validated, so they hold for old rows too (a NOT VALID check let an old
-- out-of-range row block its next update, such as the boss erasing that worker's data). Rows already
-- stored are cleaned first, the same way sync treats new ones, so the deploy can't fail on them:
-- an impossible location is dropped (with the hash, signature and next punch's pointer that cover
-- it, like app.apply_retention), a time outside 2020..2100 is pulled to the nearest edge, and an
-- over-long name or address is cut.

update public.crew set name = left(name, 60) where char_length(name) > 60;
update public.jobs set name = left(name, 60) where char_length(name) > 60;
update public.jobs set address = left(address, 200) where char_length(address) > 200;
update public.jobs set lat = null, lng = null
  where abs(lat) > 90 or abs(lng) > 180;

do $$ begin
  perform app.unlink_hashes(array(select hash from public.punches
    where (abs(lat) > 90 or abs(lng) > 180 or accuracy_m < 0) and hash is not null));
end $$;
update public.punches set lat = null, lng = null, accuracy_m = null, address = null,
    hash = null, signature = null, prev_hash = null
  where abs(lat) > 90 or abs(lng) > 180 or accuracy_m < 0;
update public.punches set phone_at = '2020-01-01 00:00Z' where phone_at < '2020-01-01 00:00Z';
update public.punches set phone_at = '2099-12-31 23:59:59Z' where phone_at >= '2100-01-01 00:00Z';

alter table public.crew
  add constraint crew_name_len check (char_length(name) <= 60);

alter table public.jobs
  add constraint jobs_name_len check (char_length(name) <= 60),
  add constraint jobs_address_len check (char_length(address) <= 200),
  add constraint jobs_lat_range check (lat between -90 and 90),
  add constraint jobs_lng_range check (lng between -180 and 180);

alter table public.punches
  add constraint punches_lat_range check (lat between -90 and 90),
  add constraint punches_lng_range check (lng between -180 and 180),
  add constraint punches_accuracy_nonneg check (accuracy_m >= 0),
  add constraint punches_phone_at_range
    check (phone_at >= '2020-01-01 00:00Z' and phone_at < '2100-01-01 00:00Z');

-- HRD-11: a worker and their foreman can both clock out the same shift while offline. A second
-- clock-out within 12 hours of the one that closed the shift, with no clock-in between, is noted on
-- that shift as a duplicate instead of becoming its own "No clock-in" row. Hours come from the first.
-- Same pairing as js/report.js pairShifts().
create or replace function public.shifts(p_from timestamptz, p_to timestamptz, p_org uuid default app.org_id())
returns table (crew_id uuid, crew_name text, job_id uuid, job_name text, clock_in timestamptz,
               clock_out timestamptz, hours numeric, status text, note text)
language plpgsql volatile security invoker as $$
declare
  p record;
  open_rows jsonb := '{}'::jsonb;
  closed_rows jsonb := '{}'::jsonb;   -- crew id -> k of the shift their last clock-out closed
  sev jsonb := '{"onsite":0,"near":1,"weak":2,"nogps":3,"offsite":4}';
  r record;
  last_out timestamptz;
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
      closed_rows := closed_rows - p.crew_id::text;
      insert into _shifts (crew_id, job_id, clock_in, status) values (p.crew_id, p.job_id, p.phone_at, p.status)
        returning k into r;
      open_rows := open_rows || jsonb_build_object(p.crew_id::text, r.k);
    elsif open_rows ? p.crew_id::text then
      update _shifts s set clock_out = p.phone_at,
        status = case when (sev ->> p.status)::int > (sev ->> s.status)::int then p.status else s.status end
        where s.k = (open_rows ->> p.crew_id::text)::int;
      closed_rows := closed_rows || jsonb_build_object(p.crew_id::text, open_rows -> p.crew_id::text);
      open_rows := open_rows - p.crew_id::text;
    else
      last_out := null;
      if closed_rows ? p.crew_id::text then
        select s.clock_out into last_out from _shifts s where s.k = (closed_rows ->> p.crew_id::text)::int;
      end if;
      if last_out is not null and p.phone_at - last_out <= interval '12 hours' then
        update _shifts s set note = 'Duplicate clock-out' where s.k = (closed_rows ->> p.crew_id::text)::int;
      else
        insert into _shifts (crew_id, job_id, clock_out, status, note)
          values (p.crew_id, p.job_id, p.phone_at, p.status, 'No clock-in');
      end if;
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
