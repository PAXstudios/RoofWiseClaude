-- ============================================================================
-- RoofWise — Supabase schema (idempotent; paste the whole file into the
-- project's SQL editor and run once). Project: epghfumtuxrhonbpnbmr
--
-- Sections:
--   1. App sync tables the phone writes today (inspections, leads, corrections)
--   2. Storage bucket for inspection photos (+ policies)
--   3. Learning Loop v2 dataset tables (docs/LEARNING_LOOP.md)
--   4. Row-level security: every inspector sees only their own rows; the
--      dataset export job uses the service role (never shipped in the app).
-- ============================================================================

create extension if not exists pgcrypto;

-- ----------------------------------------------------------------------------
-- 1. App sync tables (contracts from lib/services/*Sync.ts)
-- ----------------------------------------------------------------------------
create table if not exists public.inspections (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  report_id text not null,
  customer_name text not null,
  address text not null,
  status text not null,
  payload jsonb not null,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists inspections_user_idx on public.inspections (user_id, updated_at desc);

create table if not exists public.leads (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  address text not null,
  lat double precision,
  lng double precision,
  stage text not null,
  source text,
  value numeric,
  last_contact_at timestamptz,
  follow_up_at timestamptz,
  last_storm_match jsonb,
  -- Lead ↔ job link (migration 20260903120100_leads_inspection_id.sql).
  inspection_id text,
  stage_changed_at timestamptz,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);
create index if not exists leads_user_idx on public.leads (user_id, updated_at desc);

-- Corrections: the exact row lib/services/correctionsSync.ts serializes today.
create table if not exists public.corrections (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  inspection_id text,
  photo_id text,
  slope_id text,
  correction_type text not null,
  categories_affected text[],
  original_detection jsonb,
  corrected_detection jsonb,
  delta jsonb,
  photo_url text,
  photo_hash text,
  corrected_at timestamptz,
  confidence_stars smallint,
  inspector_trust_weight numeric default 1,
  created_at timestamptz not null default now()
);
create index if not exists corrections_user_idx on public.corrections (user_id, created_at desc);

-- ----------------------------------------------------------------------------
-- 2. Storage: originals (public-read so report PDFs can embed them by URL)
-- ----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
  values ('inspection-photos', 'inspection-photos', true)
  on conflict (id) do nothing;

drop policy if exists "photos_insert_own" on storage.objects;
create policy "photos_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'inspection-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

drop policy if exists "photos_read_public" on storage.objects;
create policy "photos_read_public" on storage.objects for select
  using (bucket_id = 'inspection-photos');

-- Labelled crops for few-shot retrieval / training. Private: only the service
-- role and the owning inspector can read.
insert into storage.buckets (id, name, public)
  values ('dataset-crops', 'dataset-crops', false)
  on conflict (id) do nothing;

drop policy if exists "crops_read_own" on storage.objects;
create policy "crops_read_own" on storage.objects for select
  using (bucket_id = 'dataset-crops' and auth.uid()::text = (storage.foldername(name))[1]);

-- ----------------------------------------------------------------------------
-- 3. Learning Loop v2 — the dataset (docs/LEARNING_LOOP.md §2)
-- ----------------------------------------------------------------------------
create table if not exists public.photos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade not null,
  inspection_id text,
  slope_id text,
  photo_index int,
  storage_path text not null,
  sha256 text not null,
  captured_at timestamptz not null,
  device text,
  app_version text,
  width int,
  height int,
  bytes int,
  lat double precision,
  lng double precision,
  area_tag text,
  capture_mode text,
  material text,
  storm_context jsonb,
  consent_dataset boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, sha256)
);
create index if not exists photos_user_idx on public.photos (user_id, captured_at desc);
create index if not exists photos_consent_idx on public.photos (consent_dataset) where consent_dataset;

create table if not exists public.detections (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid references public.photos(id) on delete cascade not null,
  user_id uuid references auth.users(id) on delete cascade not null,
  model text not null,
  prompt_version text not null,
  ran_at timestamptz not null,
  latency_ms int,
  no_roof_detected boolean,
  shingle_scale jsonb,
  findings jsonb not null,
  raw jsonb
);
create index if not exists detections_photo_idx on public.detections (photo_id, ran_at desc);
create index if not exists detections_model_idx on public.detections (model, prompt_version);

create table if not exists public.labels (
  id uuid primary key default gen_random_uuid(),
  photo_id uuid references public.photos(id) on delete cascade not null,
  detection_id uuid references public.detections(id) on delete set null,
  user_id uuid references auth.users(id) on delete cascade not null,
  action text not null check (action in ('accept','reject','edit_box','edit_category','add','remove','swipe_correct')),
  category text,
  severity text,
  box_2d int[],
  confidence_stars smallint check (confidence_stars between 1 and 5),
  inspector_trust_weight numeric not null default 1,
  source text not null,
  created_at timestamptz not null default now()
);
create index if not exists labels_photo_idx on public.labels (photo_id, created_at desc);
create index if not exists labels_user_idx on public.labels (user_id, created_at desc);

create table if not exists public.prompt_releases (
  version text primary key,
  model text not null,
  system_prompt text not null,
  category_thresholds jsonb,
  few_shot_refs jsonb,
  eval jsonb,
  released_at timestamptz,
  released_by uuid references auth.users(id),
  active boolean not null default false
);
-- Exactly one active release at a time.
create unique index if not exists prompt_releases_one_active
  on public.prompt_releases (active) where active;

-- ----------------------------------------------------------------------------
-- 4. Row-level security
-- ----------------------------------------------------------------------------
alter table public.inspections     enable row level security;
alter table public.leads           enable row level security;
alter table public.corrections     enable row level security;
alter table public.photos          enable row level security;
alter table public.detections      enable row level security;
alter table public.labels          enable row level security;
alter table public.prompt_releases enable row level security;

do $$
declare t text;
begin
  foreach t in array array['inspections','leads','corrections','photos','detections','labels'] loop
    execute format('drop policy if exists %I on public.%I', t || '_own_select', t);
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id)', t || '_own_select', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_insert', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id)', t || '_own_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_update', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id)', t || '_own_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_own_delete', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id)', t || '_own_delete', t);
  end loop;
end $$;

-- Every signed-in inspector may READ the active prompt release; only the
-- service role writes releases.
drop policy if exists "prompt_releases_read_active" on public.prompt_releases;
create policy "prompt_releases_read_active" on public.prompt_releases
  for select using (active = true and auth.role() = 'authenticated');

-- updated_at on the sync tables is CLIENT-owned (migration
-- 20260903120000_drop_touch_updated_at.sql): lib/services/leadSync.ts and
-- inspectionSync.ts send the roofer's edit time and resolve conflicts on it.
-- The old `*_touch` BEFORE UPDATE triggers overwrote it with now() and turned
-- last-write-wins into last-syncer-wins. The function stays for future
-- server-owned tables; the triggers must not come back.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;
drop trigger if exists inspections_touch on public.inspections;
drop trigger if exists leads_touch on public.leads;

-- Done. Verify with:  select table_name from information_schema.tables where table_schema='public';
