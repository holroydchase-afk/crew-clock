-- M1.12 Harden (HRD-14, HRD-11).
-- HRD-14: the database refuses values no phone or boss screen can make. The sync Edge Function
-- drops bad coordinates and caps a future phone time before insert, so a real clock-in never hits
-- these checks; they are the last line, not the first. NOT VALID: new and changed rows are checked,
-- rows already stored are left as they are (a deploy never fails on old data).
-- There is deliberately no "phone_at <= now()" check: a phone clock running fast would turn into a
-- server error and a stuck outbox. Sync caps future times instead.

alter table public.crew
  add constraint crew_name_len check (char_length(name) <= 60) not valid;

alter table public.jobs
  add constraint jobs_name_len check (char_length(name) <= 60) not valid,
  add constraint jobs_address_len check (char_length(address) <= 200) not valid,
  add constraint jobs_lat_range check (lat between -90 and 90) not valid,
  add constraint jobs_lng_range check (lng between -180 and 180) not valid;

alter table public.punches
  add constraint punches_lat_range check (lat between -90 and 90) not valid,
  add constraint punches_lng_range check (lng between -180 and 180) not valid,
  add constraint punches_accuracy_nonneg check (accuracy_m >= 0) not valid,
  add constraint punches_phone_at_range
    check (phone_at >= '2020-01-01 00:00Z' and phone_at < '2100-01-01 00:00Z') not valid;

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
