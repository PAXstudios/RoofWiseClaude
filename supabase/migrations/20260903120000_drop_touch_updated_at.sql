-- ============================================================================
-- Drop the `touch_updated_at` BEFORE UPDATE triggers on the two sync tables.
--
-- WHY: lib/services/leadSync.ts and lib/services/inspectionSync.ts resolve
-- conflicts on the CLIENT's updatedAt — the moment the roofer made the edit
-- — and both send that value in `updated_at`. The `inspections_touch` and
-- `leads_touch` triggers (supabase/schema.sql, "updated_at maintenance")
-- overwrote it with now() on every UPDATE, so the column recorded when a row
-- was last SYNCED, not last EDITED. Two devices editing the same lead
-- offline then resolved in favour of whichever came online second:
-- last-syncer-wins wearing a last-write-wins label. With the triggers gone
-- the column keeps the client's timestamp and both sides of the sync compare
-- like with like (the services also now refuse to push a local edit over a
-- remote row stamped later).
--
-- SCOPE: only these two triggers. The `public.touch_updated_at()` function
-- stays — nothing else calls it today, it is harmless, and a future table
-- with server-owned timestamps may want it. Every other trigger, policy and
-- index is untouched.
--
-- APPLY: the integrator runs this against project epghfumtuxrhonbpnbmr
-- (SQL editor, or `supabase db push` with this folder linked). It is NOT
-- applied from the app. NOTE that supabase/schema.sql still CREATES these
-- triggers when re-run in full — re-apply this file after any full
-- schema.sql run, or delete that block from schema.sql at the same time
-- (schema.sql is owned by the integrator; this migration deliberately does
-- not edit it). Idempotent: safe to run twice.
-- ============================================================================

drop trigger if exists inspections_touch on public.inspections;
drop trigger if exists leads_touch on public.leads;

-- Verify (expect 0 rows):
--   select tgname, tgrelid::regclass from pg_trigger
--    where tgname in ('inspections_touch', 'leads_touch');
