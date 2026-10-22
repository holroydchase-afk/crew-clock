-- Session tokens now come from Supabase Auth, signed with the project's asymmetric
-- signing key (ES256), instead of being minted by pin-login with the shared JWT secret.
--
-- Each crew member has a Supabase Auth user with the same id as their crew row,
-- created by pin-login the first time they sign in. Supabase calls the hook below
-- every time it issues or refreshes a token, so the org_id, crew_id and crew_role
-- claims that row-level security reads always come from the crew table.
-- Turn it on in Authentication > Hooks > Customize Access Token (see docs/SETUP.md).

create or replace function public.crew_access_token_hook(event jsonb) returns jsonb
language plpgsql stable as $$
declare
  me record;
begin
  select id, org_id, role, active into me from public.crew where id = (event ->> 'user_id')::uuid;
  if me.id is null or not me.active then
    -- No token at all for someone who isn't (or is no longer) on a crew.
    return jsonb_build_object('error', jsonb_build_object('http_code', 403, 'message', 'Not on a crew'));
  end if;
  return jsonb_build_object('claims', (event -> 'claims')
    || jsonb_build_object('org_id', me.org_id, 'crew_id', me.id, 'crew_role', me.role));
end $$;

grant usage on schema public to supabase_auth_admin;
grant execute on function public.crew_access_token_hook(jsonb) to supabase_auth_admin;
revoke execute on function public.crew_access_token_hook(jsonb) from authenticated, anon, public;
grant select (id, org_id, role, active) on public.crew to supabase_auth_admin;
create policy crew_token_hook on public.crew for select to supabase_auth_admin using (true);

-- A new PIN, or being let go, signs that person out on every phone: their refresh
-- tokens are deleted, so the next refresh fails and the app asks for the PIN.
create or replace function app.end_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where user_id = new.id;
  return new;
end $$;

create trigger crew_end_sessions after update of pin_hash, active on public.crew
for each row when (new.pin_hash is distinct from old.pin_hash or (old.active and not new.active))
execute function app.end_sessions();
