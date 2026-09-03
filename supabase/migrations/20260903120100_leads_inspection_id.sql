-- ============================================================================
-- Lead ↔ job link for the money chain (docs/APP_PLAN.md §2).
--
-- `Lead.inspectionId` (client) ↔ `public.leads.inspection_id` (this column).
-- The reverse pointer, `Inspection.leadId`, rides the inspections jsonb
-- payload and needs no column. Until this is applied, leadSync.ts detects
-- the missing column on the first upsert and re-sends without it, so every
-- other lead field still syncs and the link stays device-local meanwhile.
--
-- APPLY: the integrator runs this against project epghfumtuxrhonbpnbmr,
-- after 20260903120000_drop_touch_updated_at.sql. Idempotent.
-- ============================================================================

alter table public.leads add column if not exists inspection_id text;
create index if not exists leads_inspection_idx
  on public.leads (inspection_id) where inspection_id is not null;
