// Automations — "when X happens, do Y" for the pipeline (docs/PIPELINE.md).
//
// Three parts, one file:
//   1. The EVENT BUS. Stores call `emitPipelineEvent(e)` when something real
//      happens (a lead is created, a proposal is signed, a storm matches an
//      address). Events are queued and drained in order; a rule's own
//      writes can emit more events, which drain after it — never inside it.
//   2. The RULES. Each is a plain-English line, an id, a default, and a pure
//      `evaluate(event, ctx) → actions[]`. Nothing in a rule touches a store.
//   3. The ENGINE. Reads the stores into a context, evaluates the enabled
//      rules, applies their actions, writes a run-log line. The only I/O the
//      engine cannot do itself (a scheduled push) goes through an adapter the
//      hooks module installs.
//
// LOOP GUARD. (a) A stage the engine sets is forward-only and a no-op when
// unchanged, and the lead store emits nothing for a no-op — so a rule can
// never re-trigger itself through its own stage change. (b) Within one
// cascade (one external emit and everything it causes) each rule runs at
// most once per item per event type. (c) A cascade longer than
// MAX_CASCADE events is cut and logged. Rules that set stages do not listen
// to `stage_changed`; the one rule that does (10) only prepares a message.
//
// NEVER SENDS. Rule 10 prepares a customer message and leaves it as a
// suggestion for a screen to offer; the engine never calls `Linking`.

import type {
  ActivityEventKind,
  Inspection,
  Lead,
  LeadStage,
  Proposal,
  Task,
} from '../models/types';
import { LEAD_STAGE_LABELS, leadStageColumn } from '../models/types';
import { addressKey } from './propertyRecord';
import { isAppointmentTimestamp } from './appointmentTime';
import {
  MESSAGE_TEMPLATE_STAGE,
  useAutomationStore,
  type MessageChannel,
  type MessageTemplateKey,
} from '../stores/automationStore';
import { useLeadStore } from '../stores/leadStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { useProposalStore } from '../stores/proposalStore';
import { useEstimateStore } from '../stores/estimateStore';
import { useTaskStore } from '../stores/taskStore';
import { useActivityStore } from '../stores/activityStore';
import { useNotificationStore, type AppNotificationKind } from '../stores/notificationStore';
import { buildPipeline, inspectionsForLead, stageIndex, startInspectionFromLead } from './pipeline';

const DAY_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Events
// -----------------------------------------------------------------------------

export type StageChangedBy = 'roofer' | 'automation' | 'system';

export type PipelineEvent =
  | { type: 'lead_created'; leadId: string }
  | { type: 'stage_changed'; leadId: string; from: LeadStage; to: LeadStage; by: StageChangedBy }
  | { type: 'inspection_created'; inspectionId: string; leadId?: string }
  | { type: 'inspection_status'; inspectionId: string; leadId?: string; status: Inspection['status'] }
  | {
      type: 'analysis_done';
      inspectionId: string;
      leadId?: string;
      slopeId: string;
      /** Every photo on every slope of the job is analyzed. */
      allAnalyzed: boolean;
    }
  | { type: 'report_finalized'; inspectionId: string; leadId?: string }
  | { type: 'estimate_saved'; estimateId: string; address: string; inspectionId?: string; leadId?: string; total: number }
  | { type: 'proposal_sent'; proposalId: string; inspectionId: string; leadId?: string; total: number }
  | { type: 'proposal_signed'; proposalId: string; inspectionId: string; leadId?: string; total: number }
  | { type: 'install_scheduled'; inspectionId: string; leadId?: string; startAt: string; endAt?: string }
  | { type: 'knock_outcome'; knockId: string; outcome: string; leadId?: string; followUpAt?: string; leadCreated: boolean }
  | { type: 'storm_matched_lead'; leadId: string; match: NonNullable<Lead['lastStormMatch']> }
  | { type: 'follow_up_due'; leadId: string; followUpAt: string }
  | { type: 'idle_7d'; itemId: string; leadId?: string; inspectionId?: string; days: number };

export type PipelineEventType = PipelineEvent['type'];

type Listener = (e: PipelineEvent) => void;
const listeners = new Set<Listener>();

/** Subscribe. Returns the unsubscribe. */
export function onPipelineEvent(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Events a cascade may run before it is cut. Generous: a real cascade is 2–4. */
export const MAX_CASCADE = 24;

const queue: PipelineEvent[] = [];
let draining = false;
/** Per-cascade dedupe: `${ruleId}:${itemKey}:${eventType}`. */
let cascadeSeen = new Set<string>();

/**
 * Emit an event. Synchronous: by the time this returns, every rule the
 * event (and its consequences) triggered has run — a caller may re-read the
 * stores immediately. Re-entrant emits queue behind the one in flight.
 */
export function emitPipelineEvent(e: PipelineEvent): void {
  queue.push(e);
  if (draining) return;
  draining = true;
  cascadeSeen = new Set();
  let n = 0;
  try {
    while (queue.length > 0) {
      const ev = queue.shift()!;
      n += 1;
      if (n > MAX_CASCADE) {
        if (__DEV__) console.warn(`[automations] cascade cut after ${MAX_CASCADE} events at ${ev.type}`);
        queue.length = 0;
        break;
      }
      for (const l of Array.from(listeners)) {
        try {
          l(ev);
        } catch (err) {
          if (__DEV__) console.warn('[automations] listener failed', err);
        }
      }
    }
  } finally {
    draining = false;
    cascadeSeen = new Set();
  }
}

declare const __DEV__: boolean | undefined;

// -----------------------------------------------------------------------------
// Actions
// -----------------------------------------------------------------------------

export type ReminderRequest = {
  /** Fire at this instant (the adapter may snap to a sensible hour). */
  date: string;
  title: string;
  body: string;
  leadId?: string;
  inspectionId?: string;
};

export type AutomationAction =
  | { kind: 'set_stage'; leadId?: string; inspectionId?: string; stage: LeadStage }
  | { kind: 'add_task'; itemId: string; title: string; dueAt?: string }
  | { kind: 'notify'; key: string; title: string; body?: string; href?: string; notificationKind: AppNotificationKind }
  | { kind: 'schedule_reminder'; reminder: ReminderRequest }
  | { kind: 'set_follow_up'; leadId: string; followUpAt: string; onlyIfNone: boolean }
  | { kind: 'log_activity'; message: string; leadId?: string; inspectionId?: string; activityKind?: ActivityEventKind }
  | {
      kind: 'offer_message';
      itemId: string;
      leadId?: string;
      inspectionId?: string;
      customerName: string;
      template: MessageTemplateKey;
      stage: LeadStage;
      channel: MessageChannel;
      to: string;
      body: string;
    }
  | { kind: 'create_job'; leadId: string; status: 'scheduled'; scheduledAt: string }
  | { kind: 'reschedule_job'; leadId: string; inspectionId: string; scheduledAt: string };

// -----------------------------------------------------------------------------
// Context — what a rule may look at
// -----------------------------------------------------------------------------

export type AutomationContext = {
  now: number;
  leadById: (id: string | undefined) => Lead | undefined;
  inspectionById: (id: string | undefined) => Inspection | undefined;
  /** The lead behind a job, by explicit link only. */
  leadForInspection: (id: string | undefined) => Lead | undefined;
  /** The job behind a lead, by explicit link only. */
  inspectionForLead: (id: string | undefined) => Inspection | undefined;
  proposalForJob: (jobId: string | undefined) => Proposal | undefined;
  tasksFor: (itemIds: readonly (string | undefined)[]) => Task[];
  /** Leads/jobs at a normalised street address — how a saved estimate finds its item. */
  itemAtAddress: (address: string) => { lead?: Lead; inspection?: Inspection } | undefined;
  templateFor: (key: MessageTemplateKey) => string;
  companyName?: string;
};

/** The current stores, as a context. Cheap; built once per event. */
export function buildContext(now: number = Date.now()): AutomationContext {
  const leads = useLeadStore.getState().leads;
  const inspections = useInspectionStore.getState().inspections;
  const proposals = useProposalStore.getState().proposals;
  const tasks = useTaskStore.getState().tasks;
  const templates = useAutomationStore.getState();
  return {
    now,
    leadById: (id) => (id ? leads.find((l) => l.id === id) : undefined),
    inspectionById: (id) => (id ? inspections.find((i) => i.id === id) : undefined),
    leadForInspection: (id) => {
      if (!id) return undefined;
      const ins = inspections.find((i) => i.id === id);
      return leads.find((l) => l.id === ins?.leadId || l.inspectionId === id);
    },
    inspectionForLead: (id) => {
      if (!id) return undefined;
      const lead = leads.find((l) => l.id === id);
      return lead ? inspectionsForLead(lead, inspections)[0] : undefined;
    },
    proposalForJob: (jobId) =>
      jobId
        ? proposals
            .filter((p) => p.jobId === jobId)
            .sort((a, b) => rank(b) - rank(a))[0]
        : undefined,
    tasksFor: (ids) => {
      const set = new Set(ids.filter((x): x is string => !!x));
      return tasks.filter((t) => set.has(t.itemId));
    },
    itemAtAddress: (address) => {
      const key = address.trim().length >= 8 ? addressKey(address) : '';
      if (!key) return undefined;
      const ins = inspections.find((i) => addressKey(i.address) === key);
      const lead = leads.find((l) => addressKey(l.address) === key) ?? (ins ? leads.find((l) => l.id === ins.leadId) : undefined);
      return ins || lead ? { lead, inspection: ins } : undefined;
    },
    templateFor: (key) => templates.templateFor(key),
    companyName: readCompanyName(),
  };
}

function rank(p: Proposal): number {
  return p.status === 'signed' ? 4 : p.status === 'viewed' ? 3 : p.status === 'sent' ? 2 : p.status === 'draft' ? 1 : 0;
}

/** Best-effort company name from the inspector profile, without a hard dependency on its shape. */
function readCompanyName(): string | undefined {
  try {
    // Lazy so the profile store (and whatever it imports) never loads in a
    // Node test that only exercises the engine.
    const mod = require('../stores/inspectorProfileStore') as {
      useInspectorProfileStore?: { getState: () => { profile?: Record<string, unknown> } };
    };
    const profile = mod.useInspectorProfileStore?.getState().profile;
    const company = profile?.company as unknown;
    if (typeof company === 'string' && company.trim()) return company.trim();
    if (company && typeof company === 'object') {
      const name = (company as Record<string, unknown>).name;
      if (typeof name === 'string' && name.trim()) return name.trim();
    }
    const fullName = profile?.fullName;
    return typeof fullName === 'string' && fullName.trim() ? fullName.trim() : undefined;
  } catch {
    return undefined;
  }
}

// -----------------------------------------------------------------------------
// Rules
// -----------------------------------------------------------------------------

export type AutomationRuleId =
  | 'inspection_starts_job'
  | 'report_done_inspected'
  | 'estimate_sent_follow_up'
  | 'signed_next_steps'
  | 'install_scheduled_reminder'
  | 'idle_nudge'
  | 'storm_task'
  | 'knock_booked_job'
  | 'follow_up_bell'
  | 'stage_message';

export type AutomationRule = {
  id: AutomationRuleId;
  /** The plain-English "When …, …" line shown in Settings. */
  title: string;
  /** What it touches, one short line. */
  detail: string;
  events: PipelineEventType[];
  defaultOn: boolean;
  /** Pure. */
  evaluate: (e: PipelineEvent, ctx: AutomationContext) => AutomationAction[];
};

const IDLE_DAYS = 7;
const FOLLOW_UP_AFTER_ESTIMATE_DAYS = 3;

function firstName(name: string): string {
  const n = name.trim().split(/\s+/)[0] ?? '';
  return n || 'there';
}

function at9(iso: string, dayOffset = 0): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate() + dayOffset, 9, 0, 0, 0);
  return out.toISOString();
}

function daysFromNow(now: number, days: number, hour = 9): string {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days, hour, 0, 0, 0).toISOString();
}

function itemHref(lead?: Lead, ins?: Inspection): string | undefined {
  if (ins) return `/job/${ins.id}`;
  if (lead) return `/lead/${lead.id}`;
  return undefined;
}

function nameOf(lead?: Lead, ins?: Inspection): string {
  return (ins?.customerName?.trim() || lead?.customerName?.trim() || 'the customer');
}

function money(n: number | undefined): string {
  if (!n || n <= 0) return '';
  return n >= 1000 ? ` ($${(n / 1000).toFixed(1)}K)` : ` ($${Math.round(n)})`;
}

function fillTemplate(
  text: string,
  vars: { name: string; address: string; company?: string; date?: string; amount?: number },
): string {
  const date = vars.date
    ? new Date(vars.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
    : 'the scheduled day';
  return text
    .replace(/\{name\}/g, firstName(vars.name))
    .replace(/\{address\}/g, vars.address || 'your property')
    .replace(/\{company\}/g, vars.company ?? 'your roofer')
    .replace(/\{date\}/g, date)
    .replace(/\{amount\}/g, money(vars.amount))
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The lead + job a job-side event is about. */
function pair(ctx: AutomationContext, inspectionId?: string, leadId?: string) {
  const ins = ctx.inspectionById(inspectionId);
  const lead = ctx.leadById(leadId ?? ins?.leadId) ?? ctx.leadForInspection(inspectionId);
  return { ins, lead };
}

function itemIdOf(lead?: Lead, ins?: Inspection): string | undefined {
  return lead?.id ?? ins?.id;
}

export const AUTOMATION_RULES: AutomationRule[] = [
  {
    id: 'inspection_starts_job',
    title: 'When an inspection starts, the lead becomes a job — Inspection in progress',
    detail: 'A booked appointment lands in Inspection scheduled instead.',
    events: ['inspection_created', 'inspection_status'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'inspection_created' && e.type !== 'inspection_status') return [];
      const { ins, lead } = pair(ctx, e.inspectionId, e.leadId);
      if (!ins || !lead) return [];
      const status = e.type === 'inspection_status' ? e.status : ins.status;
      const stage: LeadStage | null =
        status === 'scheduled' ? 'inspection_scheduled' : status === 'in_progress' ? 'inspecting' : null;
      if (!stage) return [];
      return [{ kind: 'set_stage', leadId: lead.id, inspectionId: ins.id, stage }];
    },
  },
  {
    id: 'report_done_inspected',
    title: 'When the report is finalized (or every slope is analyzed), move to Inspection complete and add the task "Build the estimate"',
    detail: 'Task lands on the job; the stage moves forward only.',
    events: ['report_finalized', 'analysis_done'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'report_finalized' && e.type !== 'analysis_done') return [];
      if (e.type === 'analysis_done' && !e.allAnalyzed) return [];
      const { ins, lead } = pair(ctx, e.inspectionId, e.leadId);
      if (!ins) return [];
      const itemId = itemIdOf(lead, ins)!;
      const actions: AutomationAction[] = [];
      if (lead) actions.push({ kind: 'set_stage', leadId: lead.id, inspectionId: ins.id, stage: 'inspected' });
      actions.push({ kind: 'add_task', itemId, title: 'Build the estimate' });
      return actions;
    },
  },
  {
    id: 'estimate_sent_follow_up',
    title: 'When an estimate or proposal is sent, move to Estimate sent and set a 3-day follow-up',
    detail: 'A saved estimate matches its job by address; the follow-up is only set when none is pending.',
    events: ['proposal_sent', 'estimate_saved'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      let lead: Lead | undefined;
      let ins: Inspection | undefined;
      if (e.type === 'proposal_sent') {
        ({ ins, lead } = pair(ctx, e.inspectionId, e.leadId));
      } else if (e.type === 'estimate_saved') {
        if (e.inspectionId || e.leadId) {
          ({ ins, lead } = pair(ctx, e.inspectionId, e.leadId));
        } else {
          const hit = ctx.itemAtAddress(e.address);
          if (!hit) return [];
          lead = hit.lead;
          ins = hit.inspection;
        }
      } else {
        return [];
      }
      if (!lead) return [];
      const followUpAt = daysFromNow(ctx.now, FOLLOW_UP_AFTER_ESTIMATE_DAYS);
      const name = nameOf(lead, ins);
      return [
        { kind: 'set_stage', leadId: lead.id, inspectionId: ins?.id, stage: 'estimate_sent' },
        { kind: 'set_follow_up', leadId: lead.id, followUpAt, onlyIfNone: true },
        {
          kind: 'schedule_reminder',
          reminder: {
            date: followUpAt,
            title: `Follow up on the estimate — ${name}`,
            body: ins?.address || lead.address,
            leadId: lead.id,
            inspectionId: ins?.id,
          },
        },
      ];
    },
  },
  {
    id: 'signed_next_steps',
    title: 'When a proposal is signed, move to Signed, add "Order materials" and "Schedule install", and ring the bell',
    detail: 'Two tasks on the job; one notification with the amount.',
    events: ['proposal_signed'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'proposal_signed') return [];
      const { ins, lead } = pair(ctx, e.inspectionId, e.leadId);
      if (!ins && !lead) return [];
      const itemId = itemIdOf(lead, ins)!;
      const name = nameOf(lead, ins);
      const actions: AutomationAction[] = [];
      if (lead) actions.push({ kind: 'set_stage', leadId: lead.id, inspectionId: ins?.id, stage: 'signed' });
      actions.push({ kind: 'add_task', itemId, title: 'Order materials' });
      actions.push({ kind: 'add_task', itemId, title: 'Schedule install' });
      actions.push({
        kind: 'notify',
        key: `signed_${e.proposalId}`,
        notificationKind: 'info',
        title: `Signed — ${name}${money(e.total)}`,
        body: 'Order materials and schedule the install.',
        href: itemHref(lead, ins),
      });
      return actions;
    },
  },
  {
    id: 'install_scheduled_reminder',
    title: 'When install dates are set, move to Scheduled for install and remind me the day before',
    detail: 'A local reminder at 9 AM the day before the start date.',
    events: ['install_scheduled'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'install_scheduled') return [];
      const { ins, lead } = pair(ctx, e.inspectionId, e.leadId);
      if (!ins && !lead) return [];
      const name = nameOf(lead, ins);
      const actions: AutomationAction[] = [];
      if (lead) actions.push({ kind: 'set_stage', leadId: lead.id, inspectionId: ins?.id, stage: 'install_scheduled' });
      const dayBefore = at9(e.startAt, -1);
      if (Date.parse(dayBefore) > ctx.now) {
        actions.push({
          kind: 'schedule_reminder',
          reminder: {
            date: dayBefore,
            title: `Install tomorrow — ${name}`,
            body: ins?.address || lead?.address || '',
            leadId: lead?.id,
            inspectionId: ins?.id,
          },
        });
      }
      return actions;
    },
  },
  {
    id: 'idle_nudge',
    title: 'When a job sits 7 days with no activity, nudge me',
    detail: 'One bell entry per quiet week; lost, paid and completed jobs are left alone.',
    events: ['idle_7d'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'idle_7d') return [];
      const lead = ctx.leadById(e.leadId);
      const ins = ctx.inspectionById(e.inspectionId);
      if (!lead && !ins) return [];
      return [
        {
          kind: 'notify',
          key: `idle_${e.itemId}`,
          notificationKind: 'info',
          title: `${nameOf(lead, ins)} has been quiet ${e.days} days`,
          body: 'Nothing has moved on this job. Make a call or move it along.',
          href: itemHref(lead, ins),
        },
      ];
    },
  },
  {
    id: 'storm_task',
    title: "When a storm hits a lead's address, add the task \"Call about the storm\"",
    detail: 'Due tomorrow morning; one open task per lead at a time.',
    events: ['storm_matched_lead'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'storm_matched_lead') return [];
      const lead = ctx.leadById(e.leadId);
      if (!lead || leadStageColumn(lead.stage) === 'lost') return [];
      return [{ kind: 'add_task', itemId: lead.id, title: 'Call about the storm', dueAt: daysFromNow(ctx.now, 1) }];
    },
  },
  {
    id: 'knock_booked_job',
    title: 'When a knock is Booked, create the job at Inspection scheduled',
    detail: 'The date and time become the job’s schedule. Rebooking updates only an inspection that has not started.',
    events: ['knock_outcome'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'knock_outcome' || (e.outcome !== 'appointment' && e.outcome !== 'inspection_scheduled') || !e.leadId) return [];
      const lead = ctx.leadById(e.leadId);
      if (!lead || !isAppointmentTimestamp(e.followUpAt)) return [];
      const existing = ctx.inspectionForLead(lead.id);
      if (existing) {
        if (existing.status !== 'scheduled' || existing.reportFinalizedAt || existing.scheduledAt === e.followUpAt) return [];
        return [{ kind: 'reschedule_job', leadId: lead.id, inspectionId: existing.id, scheduledAt: e.followUpAt }];
      }
      return [{ kind: 'create_job', leadId: lead.id, status: 'scheduled', scheduledAt: e.followUpAt }];
    },
  },
  {
    id: 'follow_up_bell',
    title: 'When a follow-up comes due, ring the bell',
    detail: 'The in-app bell, alongside the phone reminder set when the follow-up was booked.',
    events: ['follow_up_due'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'follow_up_due') return [];
      const lead = ctx.leadById(e.leadId);
      if (!lead) return [];
      const ins = ctx.inspectionForLead(lead.id);
      return [
        {
          kind: 'notify',
          key: `followup_${lead.id}`,
          notificationKind: 'follow_up',
          title: `Follow up today — ${nameOf(lead, ins)}`,
          body: ins?.address || lead.address,
          href: `/lead/${lead.id}`,
        },
      ];
    },
  },
  {
    id: 'stage_message',
    title: 'When a stage changes, offer the customer message',
    detail: 'Opens in Messages or Mail for you to tap Send. Nothing is ever sent on its own.',
    events: ['stage_changed'],
    defaultOn: true,
    evaluate: (e, ctx) => {
      if (e.type !== 'stage_changed') return [];
      const template = (Object.keys(MESSAGE_TEMPLATE_STAGE) as MessageTemplateKey[]).find(
        (k) => MESSAGE_TEMPLATE_STAGE[k] === leadStageColumn(e.to),
      );
      if (!template) return [];
      const lead = ctx.leadById(e.leadId);
      if (!lead) return [];
      const ins = ctx.inspectionForLead(lead.id);
      const phone = (ins?.customerPhone ?? lead.customerPhone ?? '').trim();
      const email = (ins?.customerEmail ?? lead.customerEmail ?? '').trim();
      const channel: MessageChannel | null = phone ? 'sms' : email ? 'email' : null;
      if (!channel) return [];
      const proposal = ctx.proposalForJob(ins?.id);
      const date =
        template === 'on_the_way'
          ? ins?.scheduledAt ?? lead.followUpAt
          : template === 'install_scheduled'
            ? ins?.installStartAt
            : undefined;
      const body = fillTemplate(ctx.templateFor(template), {
        name: nameOf(lead, ins),
        address: ins?.address || lead.address,
        company: ctx.companyName,
        date,
        amount: proposal?.total,
      });
      return [
        {
          kind: 'offer_message',
          itemId: lead.id,
          leadId: lead.id,
          inspectionId: ins?.id,
          customerName: nameOf(lead, ins),
          template,
          stage: leadStageColumn(e.to),
          channel,
          to: channel === 'sms' ? phone : email,
          body,
        },
      ];
    },
  },
];

export function ruleById(id: AutomationRuleId): AutomationRule {
  return AUTOMATION_RULES.find((r) => r.id === id)!;
}

export function isRuleEnabled(id: AutomationRuleId): boolean {
  return useAutomationStore.getState().isEnabled(id, ruleById(id).defaultOn);
}

/** Pure: what one rule would do for one event. */
export function evaluateRule(rule: AutomationRule, e: PipelineEvent, ctx: AutomationContext): AutomationAction[] {
  if (!rule.events.includes(e.type)) return [];
  return rule.evaluate(e, ctx);
}

// -----------------------------------------------------------------------------
// Adapters — the I/O the engine cannot do itself
// -----------------------------------------------------------------------------

export type AutomationAdapters = {
  /** Schedule a local push. Resolves the notification id, or null when refused. */
  scheduleReminder?: (r: ReminderRequest) => Promise<string | null>;
};

let adapters: AutomationAdapters = {};

export function installAutomationAdapters(next: AutomationAdapters): void {
  adapters = { ...adapters, ...next };
}

// -----------------------------------------------------------------------------
// Engine
// -----------------------------------------------------------------------------

/** The item an event is about, for the per-cascade dedupe key. */
function itemKeyOf(e: PipelineEvent): string {
  switch (e.type) {
    case 'lead_created':
    case 'stage_changed':
    case 'storm_matched_lead':
    case 'follow_up_due':
      return e.leadId;
    case 'inspection_created':
    case 'inspection_status':
    case 'analysis_done':
    case 'report_finalized':
    case 'proposal_sent':
    case 'proposal_signed':
    case 'install_scheduled':
      return e.leadId ?? e.inspectionId;
    case 'estimate_saved':
      return e.leadId ?? e.inspectionId ?? e.estimateId;
    case 'knock_outcome':
      return e.leadId ?? e.knockId;
    case 'idle_7d':
      return e.itemId;
  }
}

type Applied = { summary: string[]; leadId?: string; inspectionId?: string };

function applyAction(a: AutomationAction, ctx: AutomationContext, out: Applied): void {
  switch (a.kind) {
    case 'set_stage': {
      if (!a.leadId) return; // an inspection-only item derives its stage on the board
      const leadStore = useLeadStore.getState();
      const lead = leadStore.leads.find((l) => l.id === a.leadId);
      if (!lead) return;
      const current = leadStageColumn(lead.stage);
      if (current === 'lost') return;
      if (stageIndex(a.stage) <= stageIndex(current)) return; // forward-only
      leadStore.setStage(lead.id, a.stage, 'automation');
      useActivityStore.getState().log({
        kind: 'automation_ran',
        leadId: lead.id,
        inspectionId: a.inspectionId,
        message: `Automation: moved ${lead.customerName} to ${LEAD_STAGE_LABELS[a.stage]}`,
      });
      out.summary.push(`moved to ${LEAD_STAGE_LABELS[a.stage]}`);
      out.leadId = lead.id;
      out.inspectionId = out.inspectionId ?? a.inspectionId;
      return;
    }
    case 'add_task': {
      const before = useTaskStore.getState().tasks.length;
      const task = useTaskStore.getState().add({
        itemId: a.itemId,
        title: a.title,
        dueAt: a.dueAt,
        createdBy: 'automation',
      });
      if (useTaskStore.getState().tasks.length > before) {
        useActivityStore.getState().log({
          kind: 'task_added',
          leadId: ctx.leadById(a.itemId)?.id,
          inspectionId: ctx.inspectionById(a.itemId)?.id,
          message: `Automation: added task "${task.title}"`,
        });
        out.summary.push(`added "${task.title}"`);
      }
      return;
    }
    case 'notify': {
      useNotificationStore.getState().push({
        kind: a.notificationKind,
        key: a.key,
        title: a.title,
        body: a.body,
        href: a.href,
      });
      out.summary.push('rang the bell');
      return;
    }
    case 'schedule_reminder': {
      const fn = adapters.scheduleReminder;
      if (!fn) {
        out.summary.push('reminder not scheduled (no scheduler mounted)');
        return;
      }
      fn(a.reminder).catch(() => {});
      out.summary.push(`reminder ${new Date(a.reminder.date).toLocaleDateString()}`);
      return;
    }
    case 'set_follow_up': {
      const leadStore = useLeadStore.getState();
      const lead = leadStore.leads.find((l) => l.id === a.leadId);
      if (!lead) return;
      if (a.onlyIfNone && lead.followUpAt && Date.parse(lead.followUpAt) > ctx.now) return;
      leadStore.setFollowUp(lead.id, a.followUpAt);
      out.summary.push(`follow-up ${new Date(a.followUpAt).toLocaleDateString()}`);
      out.leadId = lead.id;
      return;
    }
    case 'log_activity': {
      useActivityStore.getState().log({
        kind: a.activityKind ?? 'automation_ran',
        leadId: a.leadId,
        inspectionId: a.inspectionId,
        message: a.message,
      });
      return;
    }
    case 'offer_message': {
      useAutomationStore.getState().addSuggestion({
        itemId: a.itemId,
        leadId: a.leadId,
        inspectionId: a.inspectionId,
        customerName: a.customerName,
        template: a.template,
        stage: a.stage,
        channel: a.channel,
        to: a.to,
        body: a.body,
      });
      out.summary.push(`offered the ${a.channel === 'sms' ? 'text' : 'email'}`);
      out.leadId = a.leadId;
      return;
    }
    case 'reschedule_job': {
      const store = useInspectionStore.getState();
      const current = store.inspections.find((ins) => ins.id === a.inspectionId);
      if (!current || current.status !== 'scheduled' || current.reportFinalizedAt || !isAppointmentTimestamp(a.scheduledAt)) return;
      store.setScheduledAt(current.id, a.scheduledAt);
      out.summary.push(`rescheduled ${current.reportId}`);
      out.leadId = a.leadId;
      return;
    }
    case 'create_job': {
      if (!isAppointmentTimestamp(a.scheduledAt)) return;
      const ins = startInspectionFromLead(a.leadId, { status: a.status, scheduledAt: a.scheduledAt });
      if (!ins) return;
      useActivityStore.getState().log({
        kind: 'automation_ran',
        leadId: a.leadId,
        inspectionId: ins.id,
        message: `Automation: created ${ins.reportId} at Inspection Scheduled from the booked knock`,
      });
      out.summary.push(`created ${ins.reportId}`);
      out.leadId = a.leadId;
      out.inspectionId = ins.id;
      return;
    }
  }
}

/** Evaluate every enabled rule for one event and apply what they return. */
export function runAutomations(e: PipelineEvent, now: number = Date.now()): void {
  const store = useAutomationStore.getState();
  const relevant = AUTOMATION_RULES.filter((r) => r.events.includes(e.type));
  if (relevant.length === 0) return;
  const ctx = buildContext(now);
  const itemKey = itemKeyOf(e);
  for (const rule of relevant) {
    if (!store.isEnabled(rule.id, rule.defaultOn)) continue;
    const seenKey = `${rule.id}:${itemKey}:${e.type}`;
    if (cascadeSeen.has(seenKey)) continue;
    cascadeSeen.add(seenKey);
    let actions: AutomationAction[];
    try {
      actions = rule.evaluate(e, ctx);
    } catch (err) {
      if (__DEV__) console.warn(`[automations] rule ${rule.id} threw`, err);
      continue;
    }
    if (actions.length === 0) continue;
    const applied: Applied = { summary: [] };
    for (const a of actions) applyAction(a, ctx, applied);
    if (applied.summary.length === 0) continue;
    useAutomationStore.getState().recordRun({
      ruleId: rule.id,
      eventType: e.type,
      summary: applied.summary.join(' · '),
      leadId: applied.leadId,
      inspectionId: applied.inspectionId,
    });
  }
}

let installed = false;

/** Wire the engine to the bus. Idempotent; runs on first import. */
export function installAutomationEngine(): void {
  if (installed) return;
  installed = true;
  onPipelineEvent((e) => runAutomations(e));
}

installAutomationEngine();

// -----------------------------------------------------------------------------
// Ticks — the clock-driven events (follow-up due, quiet for a week)
// -----------------------------------------------------------------------------

/**
 * Emit `follow_up_due` for every lead whose follow-up has come due since it
 * last rang, and `idle_7d` for every open item with no touch in a week
 * (once per quiet week). Called by `useAutomationTicks()` on foreground and
 * hourly. Pure over the stores it reads; only emits.
 */
export function runAutomationTicks(now: Date = new Date()): { followUps: number; idle: number } {
  const nowMs = now.getTime();
  const auto = useAutomationStore.getState();
  let followUps = 0;
  let idle = 0;

  for (const lead of useLeadStore.getState().leads) {
    if (!lead.followUpAt) continue;
    const col = leadStageColumn(lead.stage);
    if (col === 'lost' || col === 'paid') continue;
    const due = Date.parse(lead.followUpAt);
    if (Number.isNaN(due) || due > nowMs) continue;
    if (auto.ticks.followUp[lead.id] === lead.followUpAt) continue;
    auto.markFollowUpTicked(lead.id, lead.followUpAt);
    followUps += 1;
    emitPipelineEvent({ type: 'follow_up_due', leadId: lead.id, followUpAt: lead.followUpAt });
  }

  const items = buildPipeline({
    leads: useLeadStore.getState().leads,
    inspections: useInspectionStore.getState().inspections,
    proposals: useProposalStore.getState().proposals,
    estimates: useEstimateStore.getState().estimates,
    tasks: useTaskStore.getState().tasks,
    now: nowMs,
  });
  for (const it of items) {
    if (it.lost || it.group === 'done') continue;
    const last = Date.parse(it.updatedAt);
    if (Number.isNaN(last)) continue;
    const days = Math.floor((nowMs - last) / DAY_MS);
    if (days < IDLE_DAYS) continue;
    const ticked = Date.parse(useAutomationStore.getState().ticks.idle[it.id] ?? '');
    if (!Number.isNaN(ticked) && nowMs - ticked < IDLE_DAYS * DAY_MS) continue;
    useAutomationStore.getState().markIdleTicked(it.id, now.toISOString());
    idle += 1;
    emitPipelineEvent({ type: 'idle_7d', itemId: it.id, leadId: it.leadId, inspectionId: it.inspectionId, days });
  }
  return { followUps, idle };
}
