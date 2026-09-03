// The Lead → Job → Proposal chain, read from the UI side.
//
// Pure helpers only — no store writes, no I/O. Screens call these to find the
// lead behind a job (and vice versa) and to decide which pipeline stage a
// business event should move the lead to. Keeping the rule here, in one place,
// is what stops "proposal signed" meaning one stage on the proposal screen and
// another on the homeowner link.

import type { Inspection, Lead, LeadStage } from '@/lib/models/types';
import { LEAD_STAGE_ORDER, leadStageColumn } from '@/lib/models/types';
import { isValidDate } from '@/lib/format/date';

// `Inspection.leadId` / `Lead.inspectionId` are the Wave A cross-references
// (written by the New Job wizard on convert). Both are optional: jobs started
// standalone and leads that were never converted carry neither, and the
// finders below simply return undefined for them.

/** The lead this job was converted from, when the link was recorded. */
export function linkedLeadId(ins: Inspection): string | undefined {
  return ins.leadId;
}

/** The job this lead was converted into, when the link was recorded. */
export function linkedInspectionId(lead: Lead): string | undefined {
  return lead.inspectionId;
}

/**
 * Resolve a job's lead from either side of the link. Explicit ids only —
 * never a name/address guess, which would attach the wrong customer's
 * follow-ups to a job (Drift #5: nothing inferred is presented as fact).
 */
export function findLinkedLead(ins: Inspection, leads: readonly Lead[]): Lead | undefined {
  const byId = linkedLeadId(ins);
  if (byId) {
    const hit = leads.find((l) => l.id === byId);
    if (hit) return hit;
  }
  return leads.find((l) => linkedInspectionId(l) === ins.id);
}

/** Symmetric to `findLinkedLead`. */
export function findLinkedInspection(
  lead: Lead,
  inspections: readonly Inspection[],
): Inspection | undefined {
  const byId = linkedInspectionId(lead);
  if (byId) {
    const hit = inspections.find((i) => i.id === byId);
    if (hit) return hit;
  }
  return inspections.find((i) => linkedLeadId(i) === lead.id);
}

// -----------------------------------------------------------------------------
// Stage automation — the events that move a lead without a "Move to…" tap
// -----------------------------------------------------------------------------

export type ChainEvent =
  | 'inspection_complete'
  | 'proposal_sent'
  | 'proposal_signed'
  | 'won'
  | 'install_scheduled';

/** Board column each event lands the lead in. */
export const STAGE_FOR_CHAIN_EVENT: Record<ChainEvent, LeadStage> = {
  inspection_complete: 'inspected',
  proposal_sent: 'estimate_sent',
  proposal_signed: 'signed',
  won: 'signed',
  install_scheduled: 'install_scheduled',
};

/**
 * Forward-only advance. Returns the stage to write, or `null` when the lead
 * is already at or past it, or is lost. A signed proposal must never drag a
 * lead that is already `in_progress` back to `signed`, and a lost lead stays
 * lost until someone deliberately moves it.
 */
export function nextStageFor(lead: Lead, event: ChainEvent): LeadStage | null {
  const target = STAGE_FOR_CHAIN_EVENT[event];
  const current = leadStageColumn(lead.stage);
  if (current === 'lost') return null;
  const currentIndex = LEAD_STAGE_ORDER.indexOf(current);
  const targetIndex = LEAD_STAGE_ORDER.indexOf(target);
  if (targetIndex < 0 || currentIndex >= targetIndex) return null;
  return target;
}

// -----------------------------------------------------------------------------
// Stage age — "going cold"
// -----------------------------------------------------------------------------

/**
 * Whole days the lead has sat in its current stage.
 *
 * Precedence: `stageChangedAt` (the exact answer, written by `setStage`) →
 * `updatedAt` → `createdAt`. The fallbacks exist only for leads that predate
 * the `stageChangedAt` field; they over-report freshness, because any write
 * (a follow-up, a storm match) bumps `updatedAt`. Returns null when the
 * stored date is unparseable rather than guessing.
 */
export function daysInStage(lead: Lead, now: number = Date.now()): number | null {
  const raw = lead.stageChangedAt ?? lead.updatedAt ?? lead.createdAt;
  if (!isValidDate(raw)) return null;
  const ms = now - new Date(raw).getTime();
  if (ms < 0) return null;
  return Math.floor(ms / 86400000);
}

/** After this many days in a pre-sale stage with no follow-up set, a lead is cooling. */
export const COLD_AFTER_DAYS = 7;

/** Stages where silence loses the deal. Post-sale stages have their own clock. */
const PRE_SALE_STAGES: ReadonlySet<LeadStage> = new Set<LeadStage>([
  'new',
  'contacted',
  'inspection_scheduled',
  'inspected',
  'estimate_sent',
]);

/**
 * Leads that are going cold: pre-sale, no follow-up on the calendar, and
 * sitting in their stage for `after` days or more. Stalest first.
 *
 * A lead WITH a follow-up is excluded on purpose — a due one already shows
 * under "Follow-ups due", and a future one is being worked. Listing it here
 * too would double-count the same to-do.
 */
export function goingColdLeads(
  leads: readonly Lead[],
  now: number = Date.now(),
  after: number = COLD_AFTER_DAYS,
): Lead[] {
  return leads
    .filter((l) => PRE_SALE_STAGES.has(leadStageColumn(l.stage)) && !l.followUpAt)
    .map((l) => ({ lead: l, days: daysInStage(l, now) }))
    .filter((x): x is { lead: Lead; days: number } => x.days !== null && x.days >= after)
    .sort((a, b) => b.days - a.days)
    .map((x) => x.lead);
}
