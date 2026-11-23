-- Scheduled pushes (8:30 AM and 7 PM Eastern) through pg_cron + pg_net.
-- Before running: enable the pg_cron and pg_net extensions in the Supabase dashboard,
-- then replace PROJECT_REF and CRON_SECRET below (CRON_SECRET must match the
-- Edge Function secret of the same name).
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- pg_cron runs in UTC: 12:30 UTC = 8:30 AM EDT (7:30 AM EST in winter; adjust if needed).
select cron.schedule('crewclock-morning', '30 12 * * 1-6', $$
  select net.http_post('https://PROJECT_REF.supabase.co/functions/v1/digest',
    '{"kind":"morning"}'::jsonb, '{}'::jsonb,
    '{"Authorization":"Bearer CRON_SECRET","Content-Type":"application/json"}'::jsonb)
$$);
select cron.schedule('crewclock-daily', '0 23 * * *', $$
  select net.http_post('https://PROJECT_REF.supabase.co/functions/v1/digest',
    '{"kind":"daily"}'::jsonb, '{}'::jsonb,
    '{"Authorization":"Bearer CRON_SECRET","Content-Type":"application/json"}'::jsonb)
$$);
