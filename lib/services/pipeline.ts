// The pipeline — leads and jobs folded into ONE list of items.
//
// A lead with `inspectionId` and that inspection are the SAME item (never
// two cards); an inspection without a lead is an item; a lead without an
// inspection is an item. Everything the board and the list draw comes from
// `buildPipeline()`, and every stage the board shows comes from `stageOf()`
// — one derivation, documented in docs/PIPELINE.md, so the Pipeline tab,
// Home's Today module and Reports can never disagree about where a customer
// stands.
//
// Pure except for the two store-writing helpers at the bottom
// (`startInspectionFromLead`, `ensureLeadForInspection`), which are the
// ONLY places a lead becomes a job or a job grows a lead. Node-testable:
// nothing here imports React or a native module.

import type {
  Inspection,
  InspectionStatus,
  Lead,
  LeadSource,
  LeadStage,
  Proposal,
  ProposalStatus,
  PropertyRecord,
  SavedEstimate,
  Task,
} from '../models/types';
import { LEAD_STAGE_LABELS, LEAD_STAGE_ORDER, leadStageColumn, normalizeLeadSource } from '../models/types';
import { addressKey, coverPhotoUri, recordCardUrl, roofAgePrefill } from './propertyRecord';
import { taskCounts } from '../stores/taskStore';
import { useLeadStore } from '../stores/leadStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { useActivityStore } from '../stores/activityStore';

const DAY_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Stage groups — the filter chips and the summary
// -----------------------------------------------------------------------------

export type PipelineGroup =
  | 'leads'
  | 'inspecting'
  | 'estimating'
  | 'sold'
  | 'production'
  | 'done'
  | 'lost';

export const PIPELINE_GROUPS: PipelineGroup[] = [
  'leads',
  'inspecting',
  'estimating',
  'sold',
  'production',
  'done',
  'lost',
];

export const PIPELINE_GROUP_LABELS: Record<PipelineGroup, string> = {
  leads: 'Leads',
  inspecting: 'Inspecting',
  estimating: 'Estimating',
  sold: 'Sold',
  production: 'Production',
  done: 'Done',
  lost: 'Lost',
};

export const PIPELINE_GROUP_STAGES: Record<PipelineGroup, LeadStage[]> = {
  leads: ['new', 'contacted', 'inspection_scheduled'],
  inspecting: ['inspecting', 'inspected'],
  estimating: ['estimate_sent'],
  sold: ['signed'],
  production: ['install_scheduled', 'in_progress'],
  done: ['completed', 'invoiced', 'paid'],
  lost: ['lost'],
};

/** Which group a stage belongs to. Folds the legacy `proposal_sent`. */
export function groupOf(stage: LeadStage): PipelineGroup {
  const col = leadStageColumn(stage);
  for (const g of PIPELINE_GROUPS) if (PIPELINE_GROUP_STAGES[g].includes(col)) return g;
  return 'leads';
}

/** Index in LEAD_STAGE_ORDER; `lost` sorts after everything, unknown before. */
export function stageIndex(stage: LeadStage): number {
  const col = leadStageColumn(stage);
  if (col === 'lost') return LEAD_STAGE_ORDER.length;
  return LEAD_STAGE_ORDER.indexOf(col);
}

/** Every board column in order — the live stages plus Lost trailing. */
export const BOARD_COLUMNS: LeadStage[] = [...LEAD_STAGE_ORDER, 'lost'];

// -----------------------------------------------------------------------------
// The item
// -----------------------------------------------------------------------------

export type AmountSource = 'proposal' | 'estimate' | 'lead_value';

export type PipelineItem = {
  /** The lead id when there is one, else the inspection id. */
  id: string;
  leadId?: string;
  inspectionId?: string;
  stage: LeadStage;
  group: PipelineGroup;
  customerName: string;
  address: string;
  lat?: number;
  lng?: number;
  phone?: string;
  email?: string;
  /** Signed/sent proposal total → saved estimate mid → `lead.value` → undefined. */
  amount?: number;
  amountSource?: AmountSource;
  /** Whole days in the current stage; null when the date is unknown. */
  daysInStage: number | null;
  /** When the current stage was entered (what `daysInStage` measures from). */
  stageSince?: string;
  /** One line: "Follow up Thu", "Analyze 3 photos", "Send the estimate"… */
  nextAction: string;
  tasks: { done: number; total: number };
  photoCount: number;
  /** Photos analyzed / photos taken. */
  analyzed: { done: number; total: number };
  followUpAt?: string;
  scheduledAt?: string;
  installStartAt?: string;
  coverUri?: string;
  storm?: Lead['lastStormMatch'];
  source?: LeadSource;
  /** Most recent touch across the lead, the job, the proposal and the tasks. */
  updatedAt: string;
  createdAt: string;
  lost: boolean;
  reportId?: string;
  proposalStatus?: ProposalStatus;
  reportFinalized: boolean;
  propertyRecord?: PropertyRecord;
};

export type PipelineInput = {
  leads: readonly Lead[];
  inspections: readonly Inspection[];
  proposals: readonly Proposal[];
  estimates: readonly SavedEstimate[];
  tasks: readonly Task[];
  /** Epoch ms; defaults to Date.now(). */
  now?: number;
};

// -----------------------------------------------------------------------------
// Stage derivation
// -----------------------------------------------------------------------------

/** A stage the job/proposal/install record argues for, and when it started arguing. */
export type StageSignal = { stage: LeadStage; at?: string; why: string };

function isoMs(iso: string | undefined): number {
  if (!iso) return NaN;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? NaN : t;
}

/** Photos taken / analyzed across every slope. Older records with no `analyzedPhotoIndices` count as analyzed. */
export function photoProgress(ins: Inspection | undefined): { done: number; total: number } {
  if (!ins) return { done: 0, total: 0 };
  let total = 0;
  let done = 0;
  for (const sl of ins.slopes) {
    total += sl.photoPaths.length;
    if (sl.analyzedPhotoIndices == null) done += sl.photoPaths.length;
    else done += sl.analyzedPhotoIndices.filter((i) => i >= 0 && i < sl.photoPaths.length).length;
  }
  return { done, total };
}

/**
 * What the job, the proposal and the install dates say about the stage —
 * each a forward signal with a timestamp. The table in docs/PIPELINE.md.
 */
export function stageSignals(inspection?: Inspection, proposal?: Proposal): StageSignal[] {
  const out: StageSignal[] = [];
  if (inspection) {
    const at = inspection.statusChangedAt ?? inspection.createdAt;
    switch (inspection.status) {
      case 'scheduled':
        out.push({ stage: 'inspection_scheduled', at, why: 'job scheduled' });
        break;
      case 'in_progress':
        out.push({ stage: 'inspecting', at, why: 'inspection in progress' });
        break;
      case 'complete':
        out.push({ stage: 'inspected', at, why: 'job marked complete' });
        break;
      case 'lead':
        break;
    }
    if (inspection.reportFinalizedAt) {
      out.push({ stage: 'inspected', at: inspection.reportFinalizedAt, why: 'report finalized' });
    }
    const photos = photoProgress(inspection);
    if (photos.total > 0 && photos.done >= photos.total) {
      // No timestamp of its own: the last analysis wrote no date on the
      // inspection, so this signal only ever counts when nothing newer
      // argues otherwise (see `stageOf`).
      out.push({ stage: 'inspected', why: 'every photo analyzed' });
    }
    if (inspection.installStartAt) {
      out.push({
        stage: 'install_scheduled',
        at: inspection.installScheduledAt ?? inspection.installStartAt,
        why: 'install dates set',
      });
    }
  }
  if (proposal) {
    if (proposal.status === 'sent' || proposal.status === 'viewed') {
      out.push({ stage: 'estimate_sent', at: proposal.sentAt, why: 'proposal sent' });
    } else if (proposal.status === 'signed') {
      out.push({ stage: 'signed', at: proposal.signedAt ?? proposal.sentAt, why: 'proposal signed' });
    }
  }
  return out;
}

/**
 * The stage an item is in.
 *
 * The LEAD's stage is the record: automations and the roofer both write it.
 * Signals from the job / proposal / install dates only ever move the answer
 * FORWARD, and only when the signal is newer than the lead's last stage
 * change — so a hand move backwards on the board sticks, and a stage the
 * automation missed (a rule turned off, an older build) still reads right.
 * Without a lead the furthest signal wins; with nothing at all, `new`.
 * A lost lead is lost until someone moves it.
 */
export function stageOf(lead?: Lead, inspection?: Inspection, proposal?: Proposal): LeadStage {
  const signals = stageSignals(inspection, proposal);
  const furthest = (list: StageSignal[]): StageSignal | undefined =>
    list.reduce<StageSignal | undefined>(
      (best, s) => (!best || stageIndex(s.stage) > stageIndex(best.stage) ? s : best),
      undefined,
    );
  if (!lead) return furthest(signals)?.stage ?? 'new';
  const current = leadStageColumn(lead.stage);
  if (current === 'lost') return 'lost';
  const currentIdx = stageIndex(current);
  const leadAt = isoMs(lead.stageChangedAt ?? lead.updatedAt ?? lead.createdAt);
  const ahead = signals.filter((s) => {
    if (stageIndex(s.stage) <= currentIdx) return false;
    const at = isoMs(s.at);
    // An undated signal only counts when the lead's own date is unknown too.
    if (Number.isNaN(at)) return Number.isNaN(leadAt);
    return Number.isNaN(leadAt) || at >= leadAt;
  });
  return furthest(ahead)?.stage ?? current;
}

/** When the item entered `stage`: the lead's stamp, else the winning signal's date, else creation. */
function stageSince(stage: LeadStage, lead?: Lead, inspection?: Inspection, proposal?: Proposal): string | undefined {
  if (lead && leadStageColumn(lead.stage) === stage) {
    return lead.stageChangedAt ?? lead.updatedAt ?? lead.createdAt;
  }
  const match = stageSignals(inspection, proposal)
    .filter((s) => s.stage === stage && s.at)
    .sort((a, b) => isoMs(a.at) - isoMs(b.at))[0];
  if (match?.at) return match.at;
  if (lead) return lead.stageChangedAt ?? lead.updatedAt ?? lead.createdAt;
  return inspection?.statusChangedAt ?? inspection?.createdAt;
}

/** Whole days since `iso`; null when unparseable or in the future. */
export function daysSince(iso: string | undefined, now: number = Date.now()): number | null {
  const t = isoMs(iso);
  if (Number.isNaN(t)) return null;
  const ms = now - t;
  if (ms < 0) return null;
  return Math.floor(ms / DAY_MS);
}

// -----------------------------------------------------------------------------
// Amount
// -----------------------------------------------------------------------------

const PROPOSAL_AMOUNT_STATUSES: ProposalStatus[] = ['signed', 'sent', 'viewed'];

/** Signed/sent proposal → saved estimate (linked, else same address) → lead value. */
export function amountOf(
  lead: Lead | undefined,
  inspection: Inspection | undefined,
  proposal: Proposal | undefined,
  estimates: readonly SavedEstimate[],
): { amount?: number; source?: AmountSource } {
  if (proposal && PROPOSAL_AMOUNT_STATUSES.includes(proposal.status) && proposal.total > 0) {
    return { amount: proposal.total, source: 'proposal' };
  }
  const est = estimateFor(lead, inspection, estimates);
  if (est && est.totalMid > 0) return { amount: est.totalMid, source: 'estimate' };
  if (lead?.value != null && lead.value > 0) return { amount: lead.value, source: 'lead_value' };
  return {};
}

/** The saved estimate behind an item: the job's `originEstimateId`, else the newest at the same address. */
export function estimateFor(
  lead: Lead | undefined,
  inspection: Inspection | undefined,
  estimates: readonly SavedEstimate[],
): SavedEstimate | undefined {
  if (inspection?.originEstimateId) {
    const linked = estimates.find((e) => e.id === inspection.originEstimateId);
    if (linked) return linked;
  }
  const address = inspection?.address ?? lead?.address ?? '';
  const key = address.trim().length >= 8 ? addressKey(address) : '';
  if (!key) return undefined;
  return estimates
    .filter((e) => e.address && addressKey(e.address) === key)
    .sort((a, b) => isoMs(b.createdAt) - isoMs(a.createdAt))[0];
}

// -----------------------------------------------------------------------------
// Next action
// -----------------------------------------------------------------------------

function shortDay(iso: string | undefined): string {
  const t = isoMs(iso);
  if (Number.isNaN(t)) return '';
  const d = new Date(t);
  const today = new Date();
  const sameDay =
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate();
  if (sameDay) return 'today';
  const diff = Math.round((t - today.getTime()) / DAY_MS);
  if (diff === 1) return 'tomorrow';
  if (diff > 1 && diff < 7) return d.toLocaleDateString(undefined, { weekday: 'short' });
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** The one line under the customer's name. Pure. */
export function nextActionFor(input: {
  stage: LeadStage;
  followUpAt?: string;
  scheduledAt?: string;
  installStartAt?: string;
  photos: { done: number; total: number };
  reportFinalized: boolean;
  proposalStatus?: ProposalStatus;
  openTasks: readonly Task[];
  now?: number;
}): string {
  const now = input.now ?? Date.now();
  const overdue = input.openTasks.find((t) => t.dueAt && isoMs(t.dueAt) <= now);
  if (overdue) return `Due: ${overdue.title}`;
  const fu = input.followUpAt && isoMs(input.followUpAt) <= now + 7 * DAY_MS ? shortDay(input.followUpAt) : '';
  switch (leadStageColumn(input.stage)) {
    case 'new':
      return fu ? `Follow up ${fu}` : 'Make contact';
    case 'contacted':
      return fu ? `Follow up ${fu}` : 'Book the inspection';
    case 'inspection_scheduled': {
      const when = input.scheduledAt ?? input.followUpAt;
      return when && isoMs(when) >= now - DAY_MS ? `Inspect ${shortDay(when)}` : 'Start the inspection';
    }
    case 'inspecting': {
      if (input.photos.total === 0) return 'Take photos';
      const left = input.photos.total - input.photos.done;
      if (left > 0) return `Analyze ${left} photo${left === 1 ? '' : 's'}`;
      return input.reportFinalized ? 'Build the estimate' : 'Finalize the report';
    }
    case 'inspected':
      return input.openTasks[0]?.title ?? 'Build the estimate';
    case 'estimate_sent':
      if (input.proposalStatus === 'viewed') return 'Follow up — they opened it';
      return fu ? `Follow up ${fu}` : 'Follow up on the estimate';
    case 'signed':
      return input.openTasks[0]?.title ?? 'Schedule install';
    case 'install_scheduled':
      return input.installStartAt ? `Install ${shortDay(input.installStartAt)}` : 'Set install dates';
    case 'in_progress':
      return 'Finish the install';
    case 'completed':
      return 'Send the invoice';
    case 'invoiced':
      return 'Collect payment';
    case 'paid':
      return 'Ask for a referral';
    case 'lost':
      return 'Lost';
    default:
      return input.openTasks[0]?.title ?? '';
  }
}

// -----------------------------------------------------------------------------
// Build
// -----------------------------------------------------------------------------

function latestIso(...values: (string | undefined)[]): string {
  let best = '';
  let bestMs = -Infinity;
  for (const v of values) {
    const t = isoMs(v);
    if (!Number.isNaN(t) && t > bestMs) {
      bestMs = t;
      best = v!;
    }
  }
  return best;
}

/** The inspections a lead owns: its `inspectionId` first, then any job pointing back at it. */
function inspectionsForLead(lead: Lead, inspections: readonly Inspection[]): Inspection[] {
  const own = inspections.filter((i) => i.id === lead.inspectionId || i.leadId === lead.id);
  return own.sort((a, b) => {
    if (a.id === lead.inspectionId) return -1;
    if (b.id === lead.inspectionId) return 1;
    return isoMs(b.createdAt) - isoMs(a.createdAt);
  });
}

/** Fold every lead and every inspection into one list of items. Pure. */
export function buildPipeline(input: PipelineInput): PipelineItem[] {
  const now = input.now ?? Date.now();
  const proposalByJob = new Map<string, Proposal>();
  for (const p of input.proposals) {
    const prev = proposalByJob.get(p.jobId);
    // The proposal that has gone furthest speaks for the job.
    if (!prev || rankProposal(p) > rankProposal(prev)) proposalByJob.set(p.jobId, p);
  }
  const claimed = new Set<string>();
  const items: PipelineItem[] = [];

  for (const lead of input.leads) {
    const own = inspectionsForLead(lead, input.inspections);
    for (const i of own) claimed.add(i.id);
    const ins = own[0];
    items.push(makeItem(lead, ins, ins ? proposalByJob.get(ins.id) : undefined, input, now));
  }
  for (const ins of input.inspections) {
    if (claimed.has(ins.id)) continue;
    items.push(makeItem(undefined, ins, proposalByJob.get(ins.id), input, now));
  }
  return items;
}

function rankProposal(p: Proposal): number {
  switch (p.status) {
    case 'signed': return 4;
    case 'viewed': return 3;
    case 'sent': return 2;
    case 'draft': return 1;
    default: return 0;
  }
}

function makeItem(
  lead: Lead | undefined,
  ins: Inspection | undefined,
  proposal: Proposal | undefined,
  input: PipelineInput,
  now: number,
): PipelineItem {
  const id = lead?.id ?? ins!.id;
  const stage = stageOf(lead, ins, proposal);
  const since = stageSince(stage, lead, ins, proposal);
  const photos = photoProgress(ins);
  const tasks = input.tasks.filter((t) => t.itemId === id || (ins && t.itemId === ins.id) || (lead && t.itemId === lead.id));
  const openTasks = tasks
    .filter((t) => !t.done)
    .sort((a, b) => a.order - b.order);
  const { amount, source: amountSource } = amountOf(lead, ins, proposal, input.estimates);
  const customerName = pickName(lead, ins);
  const address = pickAddress(lead, ins);
  const lastTask = tasks.reduce<string | undefined>(
    (best, t) => latestIso(best, t.createdAt, t.doneAt) || best,
    undefined,
  );
  const updatedAt =
    latestIso(
      lead?.updatedAt,
      lead?.createdAt,
      lead?.stageChangedAt,
      ins?.statusChangedAt,
      ins?.createdAt,
      ins?.reportFinalizedAt,
      ins?.installScheduledAt,
      proposal?.sentAt,
      proposal?.signedAt,
      lastTask,
    ) || new Date(0).toISOString();
  const createdAt = lead?.createdAt ?? ins?.createdAt ?? updatedAt;

  return {
    id,
    leadId: lead?.id,
    inspectionId: ins?.id,
    stage,
    group: groupOf(stage),
    customerName,
    address,
    lat: ins?.lat ?? lead?.lat,
    lng: ins?.lng ?? lead?.lng,
    phone: ins?.customerPhone?.trim() || lead?.customerPhone?.trim() || undefined,
    email: ins?.customerEmail?.trim() || lead?.customerEmail?.trim() || undefined,
    amount,
    amountSource,
    daysInStage: daysSince(since, now),
    stageSince: since,
    nextAction: nextActionFor({
      stage,
      followUpAt: lead?.followUpAt,
      scheduledAt: ins?.scheduledAt,
      installStartAt: ins?.installStartAt,
      photos,
      reportFinalized: !!ins?.reportFinalizedAt,
      proposalStatus: proposal?.status,
      openTasks,
      now,
    }),
    tasks: taskCounts(tasks, [id, ins?.id, lead?.id]),
    photoCount: photos.total,
    analyzed: photos,
    followUpAt: lead?.followUpAt,
    scheduledAt: ins?.scheduledAt,
    installStartAt: ins?.installStartAt,
    coverUri: ins ? coverPhotoUri(ins, 'card') : recordCardUrl(lead?.propertyRecord),
    storm: lead?.lastStormMatch,
    source: lead ? normalizeLeadSource(lead.source) : undefined,
    updatedAt,
    createdAt,
    lost: stage === 'lost',
    reportId: ins?.reportId,
    proposalStatus: proposal?.status,
    reportFinalized: !!ins?.reportFinalizedAt,
    propertyRecord: ins?.propertyRecord ?? lead?.propertyRecord,
  };
}

const PLACEHOLDER_NAME = /^(quick inspection|walk-in lead|homeowner at )/i;
const PLACEHOLDER_ADDRESS = /^address pending$/i;

/** The job's name unless it is still the capture placeholder; then the lead's. */
function pickName(lead?: Lead, ins?: Inspection): string {
  const fromJob = ins?.customerName?.trim();
  const fromLead = lead?.customerName?.trim();
  if (fromJob && !PLACEHOLDER_NAME.test(fromJob)) return fromJob;
  if (fromLead && !PLACEHOLDER_NAME.test(fromLead)) return fromLead;
  return fromJob || fromLead || 'Unnamed';
}

function pickAddress(lead?: Lead, ins?: Inspection): string {
  const fromJob = ins?.address?.trim();
  const fromLead = lead?.address?.trim();
  if (fromJob && !PLACEHOLDER_ADDRESS.test(fromJob)) return fromJob;
  if (fromLead && !PLACEHOLDER_ADDRESS.test(fromLead)) return fromLead;
  return fromJob || fromLead || '';
}

// -----------------------------------------------------------------------------
// Sums
// -----------------------------------------------------------------------------

export type ColumnSummary = { count: number; total: number };

/** Per-column `{ count, total }` — every board column present, zeros included. */
export function columnSummary(items: readonly PipelineItem[]): Map<LeadStage, ColumnSummary> {
  const map = new Map<LeadStage, ColumnSummary>();
  for (const col of BOARD_COLUMNS) map.set(col, { count: 0, total: 0 });
  for (const it of items) {
    const col = leadStageColumn(it.stage);
    const entry = map.get(col);
    if (!entry) continue;
    entry.count += 1;
    entry.total += it.amount ?? 0;
  }
  return map;
}

export type PipelineSummary = {
  /** Sum of amounts on items that are not lost and not yet paid. */
  pipelineValue: number;
  /** Items that are not lost. */
  activeCount: number;
  counts: Record<PipelineGroup, number>;
  /** Items that entered Sold (or beyond) inside the calendar month of `now`. */
  signedThisMonth: { count: number; total: number };
};

export function summarizePipeline(items: readonly PipelineItem[], now: number = Date.now()): PipelineSummary {
  const counts = Object.fromEntries(PIPELINE_GROUPS.map((g) => [g, 0])) as Record<PipelineGroup, number>;
  const nowDate = new Date(now);
  const monthStart = new Date(nowDate.getFullYear(), nowDate.getMonth(), 1).getTime();
  let pipelineValue = 0;
  let activeCount = 0;
  let signedCount = 0;
  let signedTotal = 0;
  const signedIdx = stageIndex('signed');
  for (const it of items) {
    counts[it.group] += 1;
    if (it.lost) continue;
    activeCount += 1;
    if (it.stage !== 'paid') pipelineValue += it.amount ?? 0;
    if (stageIndex(it.stage) >= signedIdx && it.group !== 'done') {
      const t = isoMs(it.stageSince);
      if (!Number.isNaN(t) && t >= monthStart) {
        signedCount += 1;
        signedTotal += it.amount ?? 0;
      }
    } else if (it.group === 'done') {
      // A finished job that closed this month counts as signed this month too.
      const t = isoMs(it.stageSince);
      if (!Number.isNaN(t) && t >= monthStart) {
        signedCount += 1;
        signedTotal += it.amount ?? 0;
      }
    }
  }
  return { pipelineValue, activeCount, counts, signedThisMonth: { count: signedCount, total: signedTotal } };
}

/** "$46.2K" / "$950" — compact currency for column headers and cards. */
export function formatMoneyShort(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `$${(amount / 1_000).toFixed(1)}K`;
  return `$${Math.round(amount)}`;
}

/**
 * How loud the days-in-stage chip should be. Leads and Estimating go amber
 * past 7 days and red past 21 — silence loses those deals; the other groups
 * have their own clocks and stay quiet.
 */
export type StageAgeTone = 'quiet' | 'amber' | 'red';

export function stageAgeTone(item: Pick<PipelineItem, 'group' | 'daysInStage' | 'lost'>): StageAgeTone {
  if (item.lost || item.daysInStage == null) return 'quiet';
  if (item.group !== 'leads' && item.group !== 'estimating') return 'quiet';
  if (item.daysInStage > 21) return 'red';
  if (item.daysInStage > 7) return 'amber';
  return 'quiet';
}

/** Filter presets the deep links and chips use. `jobs` = Inspecting and everything after it. */
export type PipelineFilter = 'all' | PipelineGroup | 'jobs' | 'storm';

export function matchesFilter(item: PipelineItem, filter: PipelineFilter): boolean {
  switch (filter) {
    case 'all':
      return true;
    case 'jobs':
      return !item.lost && stageIndex(item.stage) >= stageIndex('inspecting');
    case 'storm':
      return !!item.storm;
    default:
      return item.group === filter;
  }
}

export type PipelineSort = 'updated' | 'days' | 'amount';

export const PIPELINE_SORT_LABELS: Record<PipelineSort, string> = {
  updated: 'Recently updated',
  days: 'Days in stage',
  amount: 'Amount',
};

export function sortItems(items: readonly PipelineItem[], sort: PipelineSort): PipelineItem[] {
  const out = [...items];
  switch (sort) {
    case 'days':
      out.sort((a, b) => (b.daysInStage ?? -1) - (a.daysInStage ?? -1));
      break;
    case 'amount':
      out.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1));
      break;
    default:
      out.sort((a, b) => isoMs(b.updatedAt) - isoMs(a.updatedAt));
  }
  return out;
}

/** The lead-or-job ids a task on this item may carry. */
export function taskItemIds(item: Pick<PipelineItem, 'id' | 'leadId' | 'inspectionId'>): string[] {
  return Array.from(new Set([item.id, item.leadId, item.inspectionId].filter((x): x is string => !!x)));
}

export function stageLabel(stage: LeadStage): string {
  return LEAD_STAGE_LABELS[leadStageColumn(stage)];
}

// -----------------------------------------------------------------------------
// Writes — the two places the two records join
// -----------------------------------------------------------------------------

export type StartInspectionOptions = {
  /** `'scheduled'` for a booked appointment (a knock's Booked). Default in_progress. */
  status?: InspectionStatus;
  /** The appointment, when `status` is scheduled. */
  scheduledAt?: string;
  /** Create a second job even when the lead already has one ("Start another inspection"). */
  fresh?: boolean;
};

/**
 * The lead becomes a job. Creates the inspection from the lead's customer,
 * contact, address, coordinates and property record, links both ends
 * (`inspectionStore.create` does the linking and emits `inspection_created`;
 * automation rule 1 moves the stage), and returns the job. Idempotent: a
 * lead that already has a job on this device returns that job unless
 * `fresh` is set. Returns null only when the lead does not exist.
 *
 * Screens: `const ins = startInspectionFromLead(lead.id); if (ins)
 * router.push(`/quick-inspection?jobId=${ins.id}`)`.
 */
export function startInspectionFromLead(
  leadId: string,
  opts: StartInspectionOptions = {},
): Inspection | null {
  const leadStore = useLeadStore.getState();
  const lead = leadStore.leads.find((l) => l.id === leadId);
  if (!lead) return null;
  const inspectionStore = useInspectionStore.getState();
  if (!opts.fresh) {
    const existing = inspectionsForLead(lead, inspectionStore.inspections)[0];
    if (existing) {
      // Both ends linked, whatever path created the job.
      if (lead.inspectionId !== existing.id) leadStore.linkInspection(lead.id, existing.id);
      if (existing.leadId !== lead.id) inspectionStore.setLeadId(existing.id, lead.id);
      return existing;
    }
  }
  const prefill = roofAgePrefill(lead.propertyRecord, new Date().getFullYear());
  const ins = inspectionStore.create({
    customerName: lead.customerName,
    customerPhone: lead.customerPhone,
    customerEmail: lead.customerEmail,
    address: lead.address,
    lat: lead.lat,
    lng: lead.lng,
    // Placeholders the job screen keeps asking about until they are real —
    // never a guess presented as an inspection finding (Drift #5).
    material: 'architectural_asphalt',
    ageYears: prefill?.ageYears ?? 0,
    ageSource: prefill?.source,
    geometry: 'gable',
    condition: 'good',
    leadId: lead.id,
    status: opts.status,
    scheduledAt: opts.scheduledAt,
  });
  if (lead.propertyRecord && lead.propertyRecord.status === 'found') {
    inspectionStore.setPropertyRecord(ins.id, lead.propertyRecord);
  }
  return ins;
}

/**
 * A job that has no lead grows one so it can carry a stage, a follow-up and
 * a source — used when the roofer moves an inspection-only card on the
 * board. Returns the (existing or new) lead. Never called by an automation.
 */
export function ensureLeadForInspection(inspectionId: string, stage?: LeadStage): Lead | null {
  const inspectionStore = useInspectionStore.getState();
  const ins = inspectionStore.inspections.find((i) => i.id === inspectionId);
  if (!ins) return null;
  const leadStore = useLeadStore.getState();
  const existing = leadStore.leads.find((l) => l.id === ins.leadId || l.inspectionId === ins.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  const lead = leadStore.create({
    customerName: ins.customerName,
    customerPhone: ins.customerPhone,
    customerEmail: ins.customerEmail,
    address: ins.address,
    lat: ins.lat,
    lng: ins.lng,
    stage: stage ?? stageOf(undefined, ins, undefined),
    stageChangedAt: now,
    source: 'other',
    inspectionId: ins.id,
    propertyRecord: ins.propertyRecord?.status === 'found' ? ins.propertyRecord : undefined,
  });
  inspectionStore.setLeadId(ins.id, lead.id);
  useActivityStore.getState().log({
    kind: 'lead_converted',
    leadId: lead.id,
    inspectionId: ins.id,
    message: `${ins.reportId} joined the pipeline as ${lead.customerName}`,
  });
  return lead;
}
