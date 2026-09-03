-- ============================================================================
-- Knocking data — every door, session, plan and do-not-knock entry, per user,
-- in the owner's Supabase project (epghfumtuxrhonbpnbmr).
--
-- WHY (owner, 2026-09-03): "I want to be able to have all of this data and
-- more saved in Supabase … see all of this compiled knocking data, map what
-- every user has done and track what doors were knocked, work that was done,
-- claims, etc."
--
-- WHAT THIS ADDS
--   Tables   profiles, app_admins, knock_sessions, knocks, knock_plans,
--            knock_plan_areas, do_not_knock
--   Helpers  haversine_miles(), knock_is_contact(), knock_is_win(),
--            app_local_day(), is_admin(), touch_synced_at(), handle_new_user()
--   Views    v_knock_doors, v_user_activity, v_daily_activity,
--            v_area_performance, v_claims_pipeline, v_inspection_verdicts
--            (all security_invoker: admins see everyone, users see themselves)
--   RPC      knock_doors_geojson(since) → a GeoJSON FeatureCollection
--   RLS      per-user CRUD on every new table + an ADMIN READ policy on the
--            new tables and, additively, on leads / inspections / photos
--
-- CONTRACT WITH THE APP (lib/services/knockSync.ts)
--   • ids are the client's text ids; `updated_at` is the CLIENT's edit time
--     and is never rewritten server-side (the lesson of migration
--     20260903120000_drop_touch_updated_at.sql). `synced_at` is the
--     server-owned receipt time and IS trigger-maintained — that is the one
--     column a trigger may touch.
--   • rows are soft-deleted (`deleted_at`) so the owner never loses history;
--     the views filter them out.
--   • `knocks.property_record` is a SUBSET of the Zillow record (no photo
--     URLs, no listing agent) — see propertyRecordSubset() in knockSync.ts.
--
-- HOW THE OWNER SEES EVERYONE
--   insert into public.app_admins (user_id) values ('<their auth.users.id>');
--   (Dashboard → Authentication → Users → copy the UID.) docs/KNOCK_DATA.md
--   has the queries.
--
-- APPLY: the integrator runs this against epghfumtuxrhonbpnbmr via the
-- Supabase MCP (apply_migration), after the two 20260903120x00 migrations.
-- Idempotent: every statement is `if not exists` / `drop … if exists` /
-- `create or replace`; safe to run twice. Nothing here alters an existing
-- table's columns or policies — the admin policies on leads / inspections /
-- photos are ADDITIVE and guarded so a project without `photos` still applies.
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 0. Pure helpers (immutable; safe inside views and indexes)
-- ----------------------------------------------------------------------------

-- Great-circle miles. Same constant as lib/services/knockTrip.ts
-- (EARTH_RADIUS_MI = 3958.8) so SQL and the phone agree on a distance.
create or replace function public.haversine_miles(
  lat1 double precision, lng1 double precision,
  lat2 double precision, lng2 double precision
) returns double precision
language sql immutable strict parallel safe as $$
  select 2 * 3958.8 * asin(least(1.0, sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2)
    + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
  )));
$$;

-- Mirrors `isContact` in lib/services/knockOutcomes.ts: someone answered the
-- door. `not_home` / `inspection_scheduled` are the legacy spellings of
-- `no_answer` / `appointment` and are kept so old pins count the same way.
create or replace function public.knock_is_contact(outcome text) returns boolean
language sql immutable strict parallel safe as $$
  select outcome in (
    'interested', 'not_interested', 'follow_up', 'appointment', 'inspection_scheduled',
    'come_back', 'already_has_roofer', 'renter', 'inspected', 'signed'
  );
$$;

-- Mirrors `isWin`: someone said yes to something.
create or replace function public.knock_is_win(outcome text) returns boolean
language sql immutable strict parallel safe as $$
  select outcome in ('interested', 'appointment', 'inspection_scheduled', 'inspected', 'signed');
$$;

-- The calendar day a knock belongs to. Sessions are local-day things and a
-- 7 pm Central knock is already "tomorrow" in UTC, so the daily view needs a
-- zone. The service area in every fixture is North Texas; change the zone
-- here (one line) if the crew moves — every view reads this function.
-- (STABLE, not immutable: `at time zone` reads the tz database.)
create or replace function public.app_local_day(ts timestamptz) returns date
language sql stable strict parallel safe as $$
  select (ts at time zone 'America/Chicago')::date;
$$;

-- ----------------------------------------------------------------------------
-- 1. Who is who — profiles (filled from auth.users) and app_admins
-- ----------------------------------------------------------------------------

-- One row per auth user: the email / name the owner sees on the map.
-- Written by the auth trigger below and, for display_name + company, by the
-- phone (knockSync pushes the inspector profile's name and company).
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  company text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Standard Supabase pattern: a SECURITY DEFINER trigger on auth.users keeps
-- profiles in step with sign-ups (and email changes). `set search_path`
-- pins the function to public so a malicious schema cannot shadow it.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (user_id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name')
  )
  on conflict (user_id) do update
    set email = excluded.email,
        -- never blank a name the phone already pushed
        display_name = coalesce(public.profiles.display_name, excluded.display_name),
        updated_at = now();
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert or update of email, raw_user_meta_data on auth.users
  for each row execute function public.handle_new_user();

-- One-time backfill for users who signed up before this migration.
insert into public.profiles (user_id, email, display_name)
select u.id, u.email, coalesce(u.raw_user_meta_data ->> 'full_name', u.raw_user_meta_data ->> 'name')
from auth.users u
on conflict (user_id) do nothing;

-- Admins: the owner adds themself ONCE from the SQL editor. No client can
-- insert here (no insert policy); a client may only read its own row, which
-- is how the app can ask "am I an admin?".
create table if not exists public.app_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note text
);

-- `is_admin()` is SECURITY DEFINER so it reads app_admins without the
-- caller's RLS in the way, and STABLE so the planner evaluates it once per
-- statement rather than once per row.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 2. The knocking tables
-- ----------------------------------------------------------------------------

-- Server-owned receipt time. This trigger touches `synced_at` ONLY — never
-- `updated_at`, which stays the client's edit time (see the header).
create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin new.synced_at = now(); return new; end $$;

-- A door-knocking route: when it ran, where it was aimed, the walked path,
-- and the numbers the app shows for it (`sessionStats` in knockOutcomes.ts),
-- denormalised so the owner's dashboard needs no join to count a day.
create table if not exists public.knock_sessions (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  route_storm_alert_id text,
  -- KnockRouteTarget {lat, lng, radiusMiles, label, stormAlertId?}
  route_target jsonb,
  -- KnockRouteTarget[] — the planner's day, in visiting order
  route_stops jsonb,
  current_stop_index int,
  miles numeric,
  mileage_trip_id text,
  -- The KnockPlan the stops came from (matched client-side by stop coords).
  plan_id text,
  -- Thinned GPS polyline: [{lat, lng, ts}] ≤ ~500 points
  track jsonb,
  doors int not null default 0,
  contacts int not null default 0,
  interested int not null default 0,
  appointments int not null default 0,
  signed int not null default 0,
  follow_ups int not null default 0,
  leads int not null default 0,
  minutes int not null default 0,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists knock_sessions_user_idx on public.knock_sessions (user_id, updated_at desc);
create index if not exists knock_sessions_started_idx on public.knock_sessions (user_id, started_at desc);
create index if not exists knock_sessions_plan_idx on public.knock_sessions (plan_id) where plan_id is not null;
drop trigger if exists knock_sessions_synced on public.knock_sessions;
create trigger knock_sessions_synced before insert or update on public.knock_sessions
  for each row execute function public.touch_synced_at();

-- One door. `outcome` is a KnockOutcome (lib/models/types.ts); `history` is
-- the door's earlier outcomes [{outcome, at, notes}] oldest first;
-- `property_record` is the Zillow SUBSET (no photo URLs, no agent).
-- contact_name / contact_phone are PII — see docs/KNOCK_DATA.md.
create table if not exists public.knocks (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  session_id text references public.knock_sessions(id) on delete cascade not null,
  lat double precision not null,
  lng double precision not null,
  address text,
  outcome text not null,
  notes text,
  follow_up_at timestamptz,
  created_lead_id text,
  contact_name text,
  contact_phone text,
  damage_noted boolean,
  come_back_when text,
  placed_by text,
  history jsonb,
  property_record jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists knocks_user_idx on public.knocks (user_id, updated_at desc);
create index if not exists knocks_user_created_idx on public.knocks (user_id, created_at desc);
create index if not exists knocks_session_idx on public.knocks (session_id);
create index if not exists knocks_latlng_idx on public.knocks (lat, lng);
create index if not exists knocks_lead_idx on public.knocks (created_lead_id) where created_lead_id is not null;
drop trigger if exists knocks_synced on public.knocks;
create trigger knocks_synced before insert or update on public.knocks
  for each row execute function public.touch_synced_at();

-- A saved Knock Planner run. `result` is the whole KnockFinderResult (areas,
-- trip plan, brief, notes) — large, but the owner asked for all of it.
-- `schedule` (the days put on the calendar), `storm_alert_id` (the Storm
-- Watch alert that queued the plan) and `exclusions` (what the do-not-knock
-- list removed) are written when the plan carries them; `mode` is reserved
-- for the planner's run mode; null otherwise.
create table if not exists public.knock_plans (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  title text not null,
  created_at timestamptz not null,
  -- BasePoint {lat, lng, label}
  base jsonb,
  radius_miles numeric,
  lookback_months int,
  mode text,
  result jsonb not null,
  -- {areaKey: 'planned' | 'knocked' | 'scheduled' | 'skipped' | 'done'}
  area_status jsonb not null default '{}'::jsonb,
  notes text,
  -- KnockDaySchedule[] — the plan's days on the calendar
  schedule jsonb,
  storm_alert_id text,
  -- DoNotKnockExclusions — areas dropped / discounted by the do-not-knock list
  exclusions jsonb,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);
-- Safe on a table created before this column existed.
alter table public.knock_plans add column if not exists exclusions jsonb;
create index if not exists knock_plans_user_idx on public.knock_plans (user_id, updated_at desc);
create index if not exists knock_plans_created_idx on public.knock_plans (user_id, created_at desc);
drop trigger if exists knock_plans_synced on public.knock_plans;
create trigger knock_plans_synced before insert or update on public.knock_plans
  for each row execute function public.touch_synced_at();

-- The plan's ranked areas, flattened from `result.areas` so SQL can compare
-- what the formula expected with what the doors returned (v_area_performance).
create table if not exists public.knock_plan_areas (
  plan_id text references public.knock_plans(id) on delete cascade not null,
  area_key text not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  rank int,
  lat double precision not null,
  lng double precision not null,
  name text,
  zip text,
  distance_miles numeric,
  knock_score int,
  -- P(a given roof carries claim-grade damage) — the calibration target
  per_roof_p numeric,
  -- expected finds over `doors` doors, and the 80 % floor
  doors int,
  expected numeric,
  at_least int,
  hail_max_inches numeric,
  wind_max_mph numeric,
  storm_day date,
  status text,
  updated_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (plan_id, area_key)
);
create index if not exists knock_plan_areas_user_idx on public.knock_plan_areas (user_id, updated_at desc);
create index if not exists knock_plan_areas_latlng_idx on public.knock_plan_areas (lat, lng);
drop trigger if exists knock_plan_areas_synced on public.knock_plan_areas;
create trigger knock_plan_areas_synced before insert or update on public.knock_plan_areas
  for each row execute function public.touch_synced_at();

-- Homes and zones the roofer must never canvass (DoNotKnockEntry).
-- kind: 'home' | 'zone'; source: 'roofer' | 'outcome' | 'hoa_list'.
create table if not exists public.do_not_knock (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  kind text not null,
  label text not null,
  lat double precision,
  lng double precision,
  radius_meters numeric,
  -- [{lat, lng}, …] for a drawn zone
  polygon jsonb,
  address text,
  source text not null,
  note text,
  knock_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null,
  deleted_at timestamptz,
  synced_at timestamptz not null default now()
);
create index if not exists do_not_knock_user_idx on public.do_not_knock (user_id, updated_at desc);
create index if not exists do_not_knock_latlng_idx on public.do_not_knock (lat, lng);
drop trigger if exists do_not_knock_synced on public.do_not_knock;
create trigger do_not_knock_synced before insert or update on public.do_not_knock
  for each row execute function public.touch_synced_at();

-- ----------------------------------------------------------------------------
-- 3. Row-level security
-- ----------------------------------------------------------------------------
alter table public.profiles         enable row level security;
alter table public.app_admins       enable row level security;
alter table public.knock_sessions   enable row level security;
alter table public.knocks           enable row level security;
alter table public.knock_plans      enable row level security;
alter table public.knock_plan_areas enable row level security;
alter table public.do_not_knock     enable row level security;

-- Per-user CRUD on the five data tables (same loop as schema.sql §4), plus an
-- admin read policy on each.
do $$
declare t text;
begin
  foreach t in array array['knock_sessions','knocks','knock_plans','knock_plan_areas','do_not_knock'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own_select', t);
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', t || '_own_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_insert', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', t || '_own_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_update', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_own_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_delete', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', t || '_own_delete', t);
    execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
    execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_select', t);
  end loop;
end $$;

-- profiles: own row read/write (the phone pushes display_name + company);
-- admins read everyone.
drop policy if exists profiles_own_select on public.profiles;
create policy profiles_own_select on public.profiles for select using (auth.uid() = user_id);
drop policy if exists profiles_own_insert on public.profiles;
create policy profiles_own_insert on public.profiles for insert with check (auth.uid() = user_id);
drop policy if exists profiles_own_update on public.profiles;
create policy profiles_own_update on public.profiles for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles for select using (public.is_admin());

-- app_admins: a user may read ONLY their own row ("am I an admin?"). No
-- insert / update / delete policy exists on purpose — only the SQL editor
-- (service role) can appoint an admin.
drop policy if exists app_admins_own_select on public.app_admins;
create policy app_admins_own_select on public.app_admins for select using (auth.uid() = user_id);

-- Admin READ on the work-that-was-done tables — ADDITIVE. The existing
-- `*_own_*` policies are untouched; Postgres ORs select policies together.
-- Guarded so a project that has not applied the Learning Loop tables (photos)
-- still runs this file cleanly.
do $$
declare t text;
begin
  foreach t in array array['leads','inspections','photos'] loop
    if to_regclass('public.' || t) is not null then
      execute format('drop policy if exists %I on public.%I', t || '_admin_select', t);
      execute format('create policy %I on public.%I for select using (public.is_admin())', t || '_admin_select', t);
    end if;
  end loop;
end $$;

-- ----------------------------------------------------------------------------
-- 4. Views — every one is security_invoker so the caller's RLS applies:
--    an admin sees every user, a roofer sees only their own rows.
--    Dropped and recreated (not `or replace`) so a re-run with changed
--    columns never fails on "cannot change name of view column".
-- ----------------------------------------------------------------------------

-- Every door knocked, with who knocked it and which plan it belonged to.
-- This is the map: `select * from v_knock_doors` → CSV → kepler.gl, or use
-- knock_doors_geojson() below.
drop view if exists public.v_knock_doors;
create view public.v_knock_doors with (security_invoker = on) as
select
  k.id                          as knock_id,
  k.user_id,
  p.email,
  p.display_name,
  p.company,
  k.session_id,
  s.started_at                  as session_started_at,
  s.ended_at                    as session_ended_at,
  s.plan_id,
  pl.title                      as plan_title,
  k.lat,
  k.lng,
  k.address,
  k.outcome,
  public.knock_is_contact(k.outcome) as is_contact,
  public.knock_is_win(k.outcome)     as is_win,
  k.notes,
  k.follow_up_at,
  k.created_lead_id,
  k.damage_noted,
  k.come_back_when,
  k.placed_by,
  k.contact_name,
  k.contact_phone,
  k.history,
  jsonb_array_length(coalesce(k.history, '[]'::jsonb)) as prior_visits,
  k.property_record ->> 'year_built'   as year_built,
  k.property_record ->> 'home_status'  as home_status,
  k.created_at                  as knocked_at,
  public.app_local_day(k.created_at) as knocked_on,
  k.updated_at,
  k.synced_at
from public.knocks k
join public.knock_sessions s on s.id = k.session_id
left join public.profiles p on p.user_id = k.user_id
left join public.knock_plans pl on pl.id = s.plan_id
where k.deleted_at is null
  and s.deleted_at is null;

-- Per user, all time: what each person has done.
drop view if exists public.v_user_activity;
create view public.v_user_activity with (security_invoker = on) as
select
  s.user_id,
  p.email,
  p.display_name,
  p.company,
  count(*)                                   as sessions,
  count(*) filter (where s.ended_at is null) as sessions_open,
  sum(s.doors)                               as doors,
  sum(s.contacts)                            as contacts,
  sum(s.interested)                          as interested,
  sum(s.appointments)                        as appointments,
  sum(s.signed)                              as signed,
  sum(s.follow_ups)                          as follow_ups,
  sum(s.leads)                               as leads,
  round(sum(coalesce(s.miles, 0))::numeric, 1) as miles,
  sum(s.minutes)                             as minutes,
  case when sum(s.doors) > 0
       then round(100.0 * sum(s.contacts) / sum(s.doors)) end as contact_rate_pct,
  min(s.started_at)                          as first_active,
  max(coalesce(s.ended_at, s.started_at))    as last_active,
  max(s.synced_at)                           as last_synced
from public.knock_sessions s
left join public.profiles p on p.user_id = s.user_id
where s.deleted_at is null
group by s.user_id, p.email, p.display_name, p.company;

-- Per user per local day (app_local_day): doors and outcomes from the knocks
-- themselves, miles and minutes from the sessions that started that day.
drop view if exists public.v_daily_activity;
create view public.v_daily_activity with (security_invoker = on) as
with doors as (
  select
    k.user_id,
    public.app_local_day(k.created_at) as day,
    count(*)                                                    as doors,
    count(*) filter (where public.knock_is_contact(k.outcome))  as contacts,
    count(*) filter (where k.outcome = 'interested')            as interested,
    count(*) filter (where k.outcome in ('appointment', 'inspection_scheduled')) as appointments,
    count(*) filter (where k.outcome = 'signed')                as signed,
    count(*) filter (where k.follow_up_at is not null)          as follow_ups,
    count(*) filter (where k.created_lead_id is not null)       as leads,
    count(*) filter (where k.damage_noted)                      as damage_confirmed,
    count(distinct k.session_id)                                as sessions
  from public.knocks k
  where k.deleted_at is null
  group by k.user_id, public.app_local_day(k.created_at)
),
routes as (
  select
    s.user_id,
    public.app_local_day(s.started_at) as day,
    round(sum(coalesce(s.miles, 0))::numeric, 1) as miles,
    sum(s.minutes)                               as minutes
  from public.knock_sessions s
  where s.deleted_at is null
  group by s.user_id, public.app_local_day(s.started_at)
)
select
  coalesce(d.user_id, r.user_id) as user_id,
  p.email,
  p.display_name,
  coalesce(d.day, r.day)         as day,
  coalesce(d.sessions, 0)        as sessions,
  coalesce(d.doors, 0)           as doors,
  coalesce(d.contacts, 0)        as contacts,
  coalesce(d.interested, 0)      as interested,
  coalesce(d.appointments, 0)    as appointments,
  coalesce(d.signed, 0)          as signed,
  coalesce(d.follow_ups, 0)      as follow_ups,
  coalesce(d.leads, 0)           as leads,
  coalesce(d.damage_confirmed, 0) as damage_confirmed,
  coalesce(r.miles, 0)           as miles,
  coalesce(r.minutes, 0)         as minutes
from doors d
full outer join routes r on r.user_id = d.user_id and r.day = d.day
left join public.profiles p on p.user_id = coalesce(d.user_id, r.user_id);

-- What each plan area returned versus what the formula expected: knocks by
-- the same user within 3 miles (CELL_MILES in knockOpportunities.ts) of the
-- area centre since the plan was made. `per_roof_p` × doors knocked is the
-- expected number of claim-grade roofs among the doors actually knocked;
-- `damage_confirmed` (inspected + damage seen) is the closest observed
-- measure. This is the calibration input docs/KNOCK_OPPORTUNITIES.md §8
-- asks for, computed server-side.
drop view if exists public.v_area_performance;
create view public.v_area_performance with (security_invoker = on) as
select
  a.plan_id,
  pl.title                                   as plan_title,
  pl.created_at                              as plan_created_at,
  a.user_id,
  p.email,
  p.display_name,
  a.area_key,
  a.rank,
  a.name,
  a.zip,
  a.lat,
  a.lng,
  a.distance_miles,
  a.knock_score,
  a.per_roof_p,
  a.doors                                    as planned_doors,
  a.expected                                 as expected_at_planned_doors,
  a.at_least,
  a.hail_max_inches,
  a.wind_max_mph,
  a.storm_day,
  a.status,
  count(k.id)                                as doors,
  count(k.id) filter (where public.knock_is_contact(k.outcome)) as contacts,
  count(k.id) filter (where k.damage_noted)  as damage_confirmed,
  count(k.id) filter (where k.created_lead_id is not null) as leads,
  count(k.id) filter (where k.outcome in ('appointment', 'inspection_scheduled')) as appointments,
  count(k.id) filter (where k.outcome = 'signed') as signed,
  count(k.id) filter (where public.knock_is_win(k.outcome)) as wins,
  round((a.per_roof_p * count(k.id))::numeric, 2) as expected_at_doors_knocked,
  case when count(k.id) > 0
       then round(100.0 * count(k.id) filter (where k.damage_noted) / count(k.id), 1) end as damage_rate_pct,
  case when count(k.id) > 0
       then round(100.0 * count(k.id) filter (where public.knock_is_contact(k.outcome)) / count(k.id)) end as contact_rate_pct,
  min(k.created_at)                          as first_knock_at,
  max(k.created_at)                          as last_knock_at
from public.knock_plan_areas a
join public.knock_plans pl on pl.id = a.plan_id and pl.deleted_at is null
left join public.profiles p on p.user_id = a.user_id
left join public.knocks k
  on k.user_id = a.user_id
 and k.deleted_at is null
 and k.created_at >= pl.created_at
 and public.haversine_miles(a.lat, a.lng, k.lat, k.lng) <= 3
group by
  a.plan_id, pl.title, pl.created_at, a.user_id, p.email, p.display_name, a.area_key, a.rank,
  a.name, a.zip, a.lat, a.lng, a.distance_miles, a.knock_score, a.per_roof_p, a.doors,
  a.expected, a.at_least, a.hail_max_inches, a.wind_max_mph, a.storm_day, a.status;

-- The claims pipeline: every lead, the job it became (leads.inspection_id,
-- or the inspection payload's leadId for links made before that column),
-- the HAAG verdict frozen on the job, and whether a knock started it.
-- Proposals have no table yet, so proposal_status is derived from the
-- lead stage (estimate_sent/proposal_sent → 'sent'; signed and beyond →
-- 'signed').
drop view if exists public.v_claims_pipeline;
create view public.v_claims_pipeline with (security_invoker = on) as
select
  l.id                                   as lead_id,
  l.user_id,
  p.email,
  p.display_name,
  p.company,
  l.customer_name,
  l.address,
  l.lat,
  l.lng,
  l.stage,
  l.stage_changed_at,
  l.source,
  l.value,
  l.follow_up_at,
  l.last_contact_at,
  l.created_at                           as lead_created_at,
  l.updated_at                           as lead_updated_at,
  (l.source = 'door_knock' or kn.knock_count > 0) as from_knock,
  kn.knock_count,
  kn.first_knock_at,
  kn.last_knock_outcome,
  i.id                                   as inspection_id,
  i.report_id,
  i.status                               as inspection_status,
  i.created_at                           as inspection_created_at,
  i.updated_at                           as inspection_updated_at,
  coalesce(i.payload ->> 'kind', 'general') as inspection_kind,
  i.payload ->> 'carrier'                as carrier,
  i.payload ->> 'claimNumber'            as claim_number,
  i.payload ->> 'policyNumber'           as policy_number,
  i.payload ->> 'causeOfLoss'            as cause_of_loss,
  i.payload ->> 'dateOfLoss'             as date_of_loss,
  i.payload ->> 'material'               as material,
  case when jsonb_typeof(i.payload -> 'ageYears') = 'number'
       then (i.payload ->> 'ageYears')::numeric end as roof_age_years,
  jsonb_array_length(coalesce(i.payload -> 'slopes', '[]'::jsonb)) as slopes,
  i.payload -> 'storedEngineResult' ->> 'roofwise_recommendation' as recommendation,
  i.payload -> 'storedEngineResult' ->> 'claim_viability'         as claim_viability,
  i.payload -> 'storedEngineResult' ->> 'roofer_safety_rating'    as safety_rating,
  i.payload ->> 'storedEngineResultAt'   as verdict_at,
  i.payload ->> 'roofRecommendation'     as roof_recommendation,
  i.payload ->> 'reportFinalizedAt'      as report_finalized_at,
  i.payload ->> 'signedAt'               as signed_at,
  case
    when l.stage in ('signed', 'install_scheduled', 'in_progress', 'completed', 'invoiced', 'paid') then 'signed'
    when l.stage in ('estimate_sent', 'proposal_sent') then 'sent'
  end                                    as proposal_status
from public.leads l
left join public.profiles p on p.user_id = l.user_id
left join lateral (
  select
    count(*)                                            as knock_count,
    min(k.created_at)                                   as first_knock_at,
    (array_agg(k.outcome order by k.created_at desc))[1] as last_knock_outcome
  from public.knocks k
  where k.created_lead_id = l.id and k.deleted_at is null
) kn on true
left join lateral (
  select i.*
  from public.inspections i
  where i.id = l.inspection_id
     or (i.user_id = l.user_id and i.payload ->> 'leadId' = l.id)
  order by i.updated_at desc
  limit 1
) i on true;

-- Every job (inspection) with its frozen verdict, lead or not — the "work
-- that was done" list. Same payload reads as v_claims_pipeline.
drop view if exists public.v_inspection_verdicts;
create view public.v_inspection_verdicts with (security_invoker = on) as
select
  i.id                                   as inspection_id,
  i.user_id,
  p.email,
  p.display_name,
  i.report_id,
  i.customer_name,
  i.address,
  i.status,
  coalesce(i.payload ->> 'kind', 'general') as kind,
  i.payload ->> 'leadId'                 as lead_id,
  i.payload ->> 'carrier'                as carrier,
  i.payload ->> 'claimNumber'            as claim_number,
  i.payload ->> 'dateOfLoss'             as date_of_loss,
  i.payload ->> 'material'               as material,
  jsonb_array_length(coalesce(i.payload -> 'slopes', '[]'::jsonb)) as slopes,
  i.payload -> 'storedEngineResult' ->> 'roofwise_recommendation' as recommendation,
  i.payload -> 'storedEngineResult' ->> 'claim_viability'         as claim_viability,
  i.payload -> 'storedEngineResult' ->> 'roofer_safety_rating'    as safety_rating,
  i.payload ->> 'storedEngineResultAt'   as verdict_at,
  i.payload ->> 'reportFinalizedAt'      as report_finalized_at,
  i.payload ->> 'signedAt'               as signed_at,
  i.created_at,
  i.updated_at
from public.inspections i
left join public.profiles p on p.user_id = i.user_id;

-- ----------------------------------------------------------------------------
-- 5. RPC — the doors as GeoJSON for geojson.io / kepler.gl / QGIS.
--    select public.knock_doors_geojson();                      -- last 90 days
--    select public.knock_doors_geojson('2026-01-01');          -- since a date
--    Runs as the caller (security invoker), so it returns exactly the rows
--    the caller may see through v_knock_doors.
-- ----------------------------------------------------------------------------
create or replace function public.knock_doors_geojson(since timestamptz default now() - interval '90 days')
returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'type', 'FeatureCollection',
    'features', coalesce(jsonb_agg(
      jsonb_build_object(
        'type', 'Feature',
        'geometry', jsonb_build_object('type', 'Point', 'coordinates', jsonb_build_array(d.lng, d.lat)),
        'properties', jsonb_build_object(
          'knock_id',     d.knock_id,
          'user',         coalesce(d.display_name, d.email, d.user_id::text),
          'email',        d.email,
          'company',      d.company,
          'outcome',      d.outcome,
          'is_contact',   d.is_contact,
          'is_win',       d.is_win,
          'address',      d.address,
          'knocked_at',   d.knocked_at,
          'session_id',   d.session_id,
          'plan',         d.plan_title,
          'lead_id',      d.created_lead_id,
          'damage_noted', d.damage_noted,
          'follow_up_at', d.follow_up_at,
          'prior_visits', d.prior_visits
        )
      ) order by d.knocked_at
    ), '[]'::jsonb)
  )
  from public.v_knock_doors d
  where d.knocked_at >= since;
$$;

-- ----------------------------------------------------------------------------
-- 6. Grants. Supabase's default privileges already cover objects the
--    postgres role creates in `public`; these are explicit so the file does
--    not depend on that. RLS (above) is what actually scopes the rows.
-- ----------------------------------------------------------------------------
grant select, insert, update, delete on
  public.profiles, public.knock_sessions, public.knocks, public.knock_plans,
  public.knock_plan_areas, public.do_not_knock
  to authenticated, service_role;
grant select on public.app_admins to authenticated, service_role;
grant select on
  public.v_knock_doors, public.v_user_activity, public.v_daily_activity,
  public.v_area_performance, public.v_claims_pipeline, public.v_inspection_verdicts
  to authenticated, service_role;
grant execute on function
  public.haversine_miles(double precision, double precision, double precision, double precision),
  public.knock_is_contact(text), public.knock_is_win(text), public.app_local_day(timestamptz),
  public.is_admin(), public.knock_doors_geojson(timestamptz)
  to authenticated, service_role;

-- ----------------------------------------------------------------------------
-- 7. Hygiene — pin search_path on every function the linter would flag
--    (Supabase advisor 0011 "function search_path mutable"), including the
--    pre-existing touch_updated_at() from schema.sql.
-- ----------------------------------------------------------------------------
alter function public.touch_synced_at() set search_path = public;
alter function public.knock_doors_geojson(timestamptz) set search_path = public;
alter function public.haversine_miles(double precision, double precision, double precision, double precision) set search_path = public;
alter function public.knock_is_contact(text) set search_path = public;
alter function public.knock_is_win(text) set search_path = public;
alter function public.app_local_day(timestamptz) set search_path = public;
do $$
begin
  if to_regprocedure('public.touch_updated_at()') is not null then
    execute 'alter function public.touch_updated_at() set search_path = public';
  end if;
end $$;

-- Advisor 0028/0029: SECURITY DEFINER functions must not be callable through
-- the REST RPC surface by roles that have no business calling them.
-- handle_new_user() is a trigger function — the trigger runs it as the table
-- owner, so no API role needs EXECUTE. is_admin() is read inside RLS policies
-- as the signed-in user, so `authenticated` keeps EXECUTE (intentional: the
-- app may ask "am I an admin?"); `anon` and PUBLIC lose it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;

-- Done. Verify with:
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and (table_name like 'knock%' or table_name in ('profiles', 'app_admins', 'do_not_knock'));
--   select * from public.v_user_activity;
