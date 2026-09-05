// Today's agenda, computed once for Home and Plan.
//
// Pure functions over the stores' arrays — no hooks, no I/O — so the two
// screens can never disagree about what is due today. Every item is a
// genuinely persisted timestamp: an inspection actually logged today, a lead
// follow-up actually due, the door-knocking route actually in progress.
// Nothing here is invented (Drift #5); "scheduled" means real data, never a
// filled slot.

import type { Inspection, KnockSession, Lead, Task } from '@/lib/models/types';
import { tasksDueBy } from '@/lib/stores/taskStore';

/** One stop on the day's rail. */
export type ScheduleItem =
  | { key: string; time: number; kind: 'inspection'; ins: Inspection }
  | { key: string; time: number; kind: 'followup'; lead: Lead; overdue: boolean }
  | { key: string; time: number; kind: 'route'; session: KnockSession };

/** Local-midnight bounds for the day containing `now`. */
export function dayBounds(now: Date = new Date()): { start: number; end: number } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
  return { start, end };
}

/**
 * Follow-ups due by the end of today (overdue ones included), earliest first.
 * Signed and lost leads are out: the deal is decided, the reminder is stale.
 */
export function followUpsDue(leads: readonly Lead[], now: Date = new Date(), inspections: readonly Inspection[] = []): Lead[] {
  const endOfDay = dayBounds(now).end - 1;
  return leads
    .filter(
      (l) =>
        l.followUpAt &&
        l.stage !== 'signed' &&
        l.stage !== 'lost' &&
        !isAppointmentReminder(l, inspections) &&
        new Date(l.followUpAt).getTime() <= endOfDay,
    )
    .sort((a, b) => new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime());
}

/** Matching linked appointment reminders are represented by the inspection. */
function isAppointmentReminder(lead: Lead, inspections: readonly Inspection[]): boolean {
  return inspections.some((ins) => (lead.inspectionId === ins.id || ins.leadId === lead.id) &&
    !!ins.scheduledAt && Date.parse(ins.scheduledAt) === Date.parse(lead.followUpAt ?? ''));
}

/** Booked visits use their appointment; other work retains its logged date. */
export function inspectionAgendaAt(ins: Inspection): string | undefined {
  return ins.status === 'scheduled' ? ins.scheduledAt : ins.createdAt;
}

/** Inspections scheduled/logged inside `[startMs, endMs)`. */
export function inspectionsInWindow(
  inspections: readonly Inspection[],
  startMs: number,
  endMs: number,
): Inspection[] {
  return inspections.filter((ins) => {
    const t = Date.parse(inspectionAgendaAt(ins) ?? '');
    return t >= startMs && t < endMs;
  });
}

/** Inspections logged today. */
export function inspectionsToday(
  inspections: readonly Inspection[],
  now: Date = new Date(),
): Inspection[] {
  const { start, end } = dayBounds(now);
  return inspectionsInWindow(inspections, start, end);
}

/**
 * Open tasks due by the end of today, overdue included, soonest first —
 * `automation`- and roofer-created alike (docs/PIPELINE.md §5). Thin wrapper
 * over `taskStore.tasksDueBy` so Home and Plan read the exact same list a
 * pipeline card's "x/y" count is built from.
 */
export function tasksDueToday(tasks: readonly Task[], now: Date = new Date()): Task[] {
  return tasksDueBy(tasks, now);
}

/** Inspections logged from today through the next seven days. */
export function inspectionsThisWeek(
  inspections: readonly Inspection[],
  now: Date = new Date(),
): Inspection[] {
  const { start } = dayBounds(now);
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7).getTime();
  return inspectionsInWindow(inspections, start, end);
}

/** The rail, time-ordered. */
export function scheduleItemsFor(input: {
  inspections: readonly Inspection[];
  followUps: readonly Lead[];
  activeRoute: KnockSession | null;
  now?: Date;
}): ScheduleItem[] {
  const now = input.now ?? new Date();
  const { start } = dayBounds(now);
  const items: ScheduleItem[] = [];

  for (const ins of input.inspections) {
    items.push({
      key: `ins_${ins.id}`,
      time: Date.parse(inspectionAgendaAt(ins) ?? ''),
      kind: 'inspection',
      ins,
    });
  }
  for (const lead of input.followUps) {
    if (isAppointmentReminder(lead, input.inspections)) continue;
    const t = new Date(lead.followUpAt!).getTime();
    items.push({ key: `fu_${lead.id}`, time: t, kind: 'followup', lead, overdue: t < start });
  }
  if (input.activeRoute) {
    items.push({
      key: `route_${input.activeRoute.id}`,
      time: new Date(input.activeRoute.startedAt).getTime(),
      kind: 'route',
      session: input.activeRoute,
    });
  }

  return items.sort((a, b) => a.time - b.time);
}

/**
 * The one item that is genuinely live: the route in progress if there is
 * one, otherwise the earliest stop still ahead of the clock. All-past and no
 * active route → null; that's honest, not a bug (never fake a "live" state).
 */
export function liveKeyFor(items: readonly ScheduleItem[], nowMs: number = Date.now()): string | null {
  const route = items.find((i) => i.kind === 'route');
  if (route) return route.key;
  const next = items
    .filter((i) => i.kind !== 'route' && i.time >= nowMs)
    .sort((a, b) => a.time - b.time)[0];
  return next?.key ?? null;
}
