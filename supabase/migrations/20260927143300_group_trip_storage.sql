-- Group Trip Decider storage. Accessed only by the app's server with the service-role key.
-- RLS is on with no policies, and anon/authenticated have no grants, so the public
-- (publishable/anon) key can't read or write anything.

create table public.trip_preferences (
  name text primary key check (name in ('Riya', 'Siddharth', 'Karan', 'Aisha', 'Preethi')),
  data jsonb not null,
  -- version string = the record's updatedAt; a confirmation counts only while it matches
  version text not null,
  updated_at timestamptz not null default now()
);

create table public.trip_confirmations (
  name text primary key references public.trip_preferences (name) on delete cascade,
  option_id text not null,
  version text not null,
  confirmed_at timestamptz not null default now()
);

alter table public.trip_preferences enable row level security;
alter table public.trip_confirmations enable row level security;
revoke all on public.trip_preferences, public.trip_confirmations from anon, authenticated;

-- Upsert one person's preferences and clear their confirmation, atomically.
create function public.save_trip_preference(p_name text, p_data jsonb, p_version text)
returns void
language sql
security invoker
set search_path = ''
as $$
  insert into public.trip_preferences (name, data, version, updated_at)
  values (p_name, p_data, p_version, now())
  on conflict (name) do update
    set data = excluded.data, version = excluded.version, updated_at = now();
  delete from public.trip_confirmations where name = p_name;
$$;

-- Set a confirmation only if it was made against the person's current preferences version.
-- Returns false when the preferences changed in the meantime (the confirmation is dropped).
create function public.set_trip_confirmation(p_name text, p_option_id text, p_version text)
returns boolean
language plpgsql
security invoker
set search_path = ''
as $$
begin
  insert into public.trip_confirmations (name, option_id, version, confirmed_at)
  select p_name, p_option_id, p_version, now()
  where exists (
    select 1 from public.trip_preferences where name = p_name and version = p_version
  )
  on conflict (name) do update
    set option_id = excluded.option_id, version = excluded.version, confirmed_at = now();
  return found;
end;
$$;

revoke execute on function public.save_trip_preference(text, jsonb, text) from public, anon, authenticated;
revoke execute on function public.set_trip_confirmation(text, text, text) from public, anon, authenticated;
grant execute on function public.save_trip_preference(text, jsonb, text) to service_role;
grant execute on function public.set_trip_confirmation(text, text, text) to service_role;
grant all on public.trip_preferences, public.trip_confirmations to service_role;
