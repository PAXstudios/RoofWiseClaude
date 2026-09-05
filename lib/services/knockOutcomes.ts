// Door-knock outcomes — the one table that says what each designation means,
// how it looks on the map, and what it does to the pipeline. Pure: no I/O, no
// React, no store imports. The screen, the pin sheet, the Map tab's knock
// filter and Reports all read this so a "Signed" pin is the same colour and
// the same word everywhere.
//
// Colours are theme TOKEN NAMES (keys of `colors` in theme/tokens.ts), never
// hex (Drift #11) — the UI resolves `colors[meta.tone]`. Keeping the name
// here rather than the value keeps this module free of the react-native
// import that tokens.ts carries, so it runs under plain Node for tests.

import type { Knock, KnockOutcome, KnockSession, LeadStage } from '../models/types';
import type { Theme } from '../../theme/tokens';
import { accumulateMiles } from './knockTrip';

/** A colour token name — resolved by the UI as `colors[tone]`. */
export type OutcomeTone = Extract<
  keyof Theme['colors'],
  | 'success'
  | 'warn'
  | 'danger'
  | 'info'
  | 'brand'
  | 'accent'
  | 'textSubtle'
  | 'slate'
  | 'text'
  | 'tileGreenInk'
  | 'tileBlueInk'
  | 'tilePurpleInk'
  | 'tileOrangeInk'
>;

/** Legend groups — the filter strip over the map. */
export type OutcomeGroup = 'answered' | 'no_answer' | 'follow_up' | 'do_not_knock';

export const OUTCOME_GROUP_LABELS: Record<OutcomeGroup, string> = {
  answered: 'Answered',
  no_answer: 'No answer',
  follow_up: 'Follow-ups',
  do_not_knock: 'Do not knock',
};

export type KnockOutcomeMeta = {
  id: KnockOutcome;
  /** Full label: "Already has a roofer". */
  label: string;
  /** Chip label, short enough for a 2-per-row grid: "Has roofer". */
  short: string;
  /** Ionicons glyph name. Typed as string so this stays React-free. */
  icon: string;
  tone: OutcomeTone;
  /** One line on what to do next, shown under the chip once picked. */
  next: string;
  group: OutcomeGroup;
  /** Someone answered the door. */
  isContact: boolean;
  /** Counts toward "doors knocked". (Every outcome does today; kept explicit.) */
  countsAsDoor: boolean;
  /** Saving creates or updates a pipeline lead. */
  createsLead: boolean;
  /** Stage a NEW lead starts at (an existing lead only ever moves forward). */
  leadStage?: LeadStage;
  /** The sheet offers a follow-up date and the lead carries it. */
  setsFollowUp: boolean;
  /** Preselected cadence in days when `setsFollowUp`. */
  defaultFollowUpDays?: number;
  /** The sheet offers name + phone fields. */
  asksContact: boolean;
  /** Label over the contact fields: "Homeowner" / "Owner (from the tenant)". */
  contactLabel?: string;
  /** The sheet asks "damage seen?" (inspected). */
  asksDamage?: boolean;
  /** The sheet asks for a time of day (come back). */
  asksWhen?: boolean;
  /**
   * Legacy id folded into this one for display. The legacy member is kept in
   * the union for old data and is never offered as a chip.
   */
  legacyIds?: KnockOutcome[];
};

// Chip order = thumb order: the outcomes that happen most sit first.
export const KNOCK_OUTCOMES: KnockOutcomeMeta[] = [
  {
    id: 'no_answer',
    label: 'No answer',
    short: 'No answer',
    icon: 'ellipse-outline',
    tone: 'textSubtle',
    next: 'Leave a door hanger. The pin stays grey so you can come back.',
    group: 'no_answer',
    isContact: false,
    countsAsDoor: true,
    createsLead: false,
    setsFollowUp: false,
    asksContact: false,
    legacyIds: ['not_home'],
  },
  {
    id: 'interested',
    label: 'Interested',
    short: 'Interested',
    icon: 'thumbs-up-outline',
    tone: 'success',
    next: 'Get a name and number — a lead is created and a follow-up set.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'contacted',
    setsFollowUp: true,
    defaultFollowUpDays: 1,
    asksContact: true,
    contactLabel: 'Homeowner',
  },
  {
    id: 'not_interested',
    label: 'Not interested',
    short: 'Not interested',
    icon: 'thumbs-down-outline',
    tone: 'danger',
    next: 'Thank them and move on. No lead.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: false,
    setsFollowUp: false,
    asksContact: false,
  },
  {
    id: 'follow_up',
    label: 'Follow up',
    short: 'Follow up',
    icon: 'alarm-outline',
    tone: 'warn',
    next: 'Pick when. It lands on Plan as a follow-up.',
    group: 'follow_up',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'contacted',
    setsFollowUp: true,
    defaultFollowUpDays: 3,
    asksContact: true,
    contactLabel: 'Homeowner',
  },
  {
    id: 'appointment',
    label: 'Inspection booked',
    short: 'Booked',
    icon: 'calendar-outline',
    tone: 'brand',
    next: 'Choose the appointment date and time. Existing scheduled inspections are updated; work already started stays unchanged.',
    group: 'follow_up',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'inspection_scheduled',
    setsFollowUp: true,
    defaultFollowUpDays: 1,
    asksContact: true,
    contactLabel: 'Homeowner',
    legacyIds: ['inspection_scheduled'],
  },
  {
    id: 'come_back',
    label: 'Come back later',
    short: 'Come back',
    icon: 'time-outline',
    tone: 'accent',
    next: 'When did they say? You get a reminder for that day.',
    group: 'follow_up',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'contacted',
    setsFollowUp: true,
    defaultFollowUpDays: 1,
    asksContact: true,
    contactLabel: 'Homeowner',
    asksWhen: true,
  },
  {
    id: 'already_has_roofer',
    label: 'Already has a roofer',
    short: 'Has roofer',
    icon: 'construct-outline',
    tone: 'tileOrangeInk',
    next: 'Note who, if they said. No lead.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: false,
    setsFollowUp: false,
    asksContact: false,
  },
  {
    id: 'renter',
    label: 'Renter — owner elsewhere',
    short: 'Renter',
    icon: 'key-outline',
    tone: 'tilePurpleInk',
    next: 'Ask for the owner’s name and number — the owner files the claim.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'new',
    setsFollowUp: true,
    defaultFollowUpDays: 3,
    asksContact: true,
    contactLabel: 'Owner (as the tenant gave it)',
  },
  {
    id: 'vacant',
    label: 'Vacant',
    short: 'Vacant',
    icon: 'home-outline',
    tone: 'slate',
    next: 'Nobody lives here. Look up the house to find the owner.',
    group: 'no_answer',
    isContact: false,
    countsAsDoor: true,
    createsLead: false,
    setsFollowUp: false,
    asksContact: false,
  },
  {
    id: 'inspected',
    label: 'Roof inspected',
    short: 'Inspected',
    icon: 'search-outline',
    tone: 'tileBlueInk',
    next: 'Damage seen or not — the lead moves to Inspection Complete.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'inspected',
    setsFollowUp: true,
    defaultFollowUpDays: 1,
    asksContact: true,
    contactLabel: 'Homeowner',
    asksDamage: true,
  },
  {
    id: 'signed',
    label: 'Signed',
    short: 'Signed',
    icon: 'create-outline',
    tone: 'tileGreenInk',
    next: 'Signed at the door. The lead moves to Approved / Signed.',
    group: 'answered',
    isContact: true,
    countsAsDoor: true,
    createsLead: true,
    leadStage: 'signed',
    setsFollowUp: false,
    asksContact: true,
    contactLabel: 'Homeowner',
  },
  {
    id: 'do_not_knock',
    label: 'Do not knock',
    short: 'Do not knock',
    icon: 'ban-outline',
    tone: 'text',
    next: 'This door stays off every future route.',
    group: 'do_not_knock',
    isContact: false,
    countsAsDoor: true,
    createsLead: false,
    setsFollowUp: false,
    asksContact: false,
  },
];

const BY_ID: Record<string, KnockOutcomeMeta> = {};
for (const m of KNOCK_OUTCOMES) {
  BY_ID[m.id] = m;
  for (const legacy of m.legacyIds ?? []) BY_ID[legacy] = m;
}

/**
 * Meta for any outcome, legacy ids included (`not_home` → the No answer row,
 * `inspection_scheduled` → Inspection booked). Never undefined: an unknown
 * string (a future member this build does not know) reads as No answer so a
 * pin always draws.
 */
export function outcomeMeta(outcome: KnockOutcome | string): KnockOutcomeMeta {
  return BY_ID[outcome] ?? BY_ID.no_answer;
}

/** The canonical id for a possibly-legacy outcome. */
export function canonicalOutcome(outcome: KnockOutcome): KnockOutcome {
  return outcomeMeta(outcome).id;
}

export function isContact(outcome: KnockOutcome): boolean {
  return outcomeMeta(outcome).isContact;
}

/** One line on what to do next, for the toast and the sheet. */
export function nextActionFor(outcome: KnockOutcome): string {
  return outcomeMeta(outcome).next;
}

/** "no_answer" → "No answer" for callouts and activity messages. */
export function outcomeLabel(outcome: KnockOutcome): string {
  return outcomeMeta(outcome).label;
}

export function outcomeGroup(outcome: KnockOutcome): OutcomeGroup {
  return outcomeMeta(outcome).group;
}

/** Legend filter: 'all' or one group. */
export type OutcomeFilter = 'all' | OutcomeGroup;

export const OUTCOME_FILTERS: { id: OutcomeFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'answered', label: OUTCOME_GROUP_LABELS.answered },
  { id: 'no_answer', label: OUTCOME_GROUP_LABELS.no_answer },
  { id: 'follow_up', label: OUTCOME_GROUP_LABELS.follow_up },
  { id: 'do_not_knock', label: OUTCOME_GROUP_LABELS.do_not_knock },
];

export function matchesFilter(outcome: KnockOutcome, filter: OutcomeFilter): boolean {
  return filter === 'all' || outcomeGroup(outcome) === filter;
}

/** Outcomes that mean "someone said yes to something" — the pipeline wins. */
export function isWin(outcome: KnockOutcome): boolean {
  const id = canonicalOutcome(outcome);
  return id === 'interested' || id === 'appointment' || id === 'inspected' || id === 'signed';
}

export type SessionStats = {
  doors: number;
  contacts: number;
  interested: number;
  appointments: number;
  signed: number;
  followUps: number;
  /** Doors that created or updated a lead. */
  leads: number;
  miles: number;
  minutes: number;
  /** 0–100, contacts ÷ doors. 0 when no doors. */
  contactRate: number;
};

/**
 * Session numbers, computed one way for the stats bar, the end-of-route
 * summary, the activity message and Reports. `miles` prefers the session's
 * recorded figure and falls back to the (thinned) track; `now` is only read
 * for a session still running.
 */
export function sessionStats(
  session: Pick<KnockSession, 'knocks' | 'startedAt' | 'endedAt' | 'miles' | 'track'>,
  now: number = Date.now(),
): SessionStats {
  let doors = 0, contacts = 0, interested = 0, appointments = 0, signed = 0, followUps = 0, leads = 0;
  for (const k of session.knocks) {
    const m = outcomeMeta(k.outcome);
    if (m.countsAsDoor) doors += 1;
    if (m.isContact) contacts += 1;
    if (m.id === 'interested') interested += 1;
    if (m.id === 'appointment') appointments += 1;
    if (m.id === 'signed') signed += 1;
    if (k.followUpAt) followUps += 1;
    if (k.createdLeadId) leads += 1;
  }
  const end = session.endedAt ? new Date(session.endedAt).getTime() : now;
  const minutes = Math.max(0, Math.floor((end - new Date(session.startedAt).getTime()) / 60_000));
  const miles = session.miles ?? (session.track ? accumulateMiles(session.track) : 0);
  return {
    doors,
    contacts,
    interested,
    appointments,
    signed,
    followUps,
    leads,
    miles,
    minutes,
    contactRate: doors === 0 ? 0 : Math.round((contacts / doors) * 100),
  };
}

/** Knocks whose outcome is the most recent visit — helper for "last N days". */
export function knocksSince(sessions: readonly KnockSession[], sinceMs: number): Knock[] {
  const out: Knock[] = [];
  for (const s of sessions) {
    for (const k of s.knocks) {
      if (new Date(k.updatedAt ?? k.createdAt).getTime() >= sinceMs) out.push(k);
    }
  }
  return out;
}

/** Follow-up cadence chips offered in the pin sheet. Days from now. */
export const FOLLOW_UP_DAYS: { label: string; days: number }[] = [
  { label: 'Today', days: 0 },
  { label: 'Tomorrow', days: 1 },
  { label: '3 days', days: 3 },
  { label: '1 week', days: 7 },
  { label: '2 weeks', days: 14 },
];

/**
 * ISO timestamp `days` from `now` at LOCAL 9:00 — a follow-up is a morning
 * task, and a bare midnight renders as "yesterday" in every US timezone once
 * it crosses UTC. `days` 0 = today (still 9:00; the Plan shows it as due now
 * when the hour has passed).
 */
export function followUpAtFromDays(days: number, now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days, 9, 0, 0, 0);
  return d.toISOString();
}

export const COME_BACK_WHEN: { id: 'morning' | 'afternoon' | 'evening' | 'weekend'; label: string }[] = [
  { id: 'morning', label: 'Morning' },
  { id: 'afternoon', label: 'Afternoon' },
  { id: 'evening', label: 'Evening' },
  { id: 'weekend', label: 'Weekend' },
];

/**
 * The follow-up date for a "come back" — the next slot the homeowner named.
 * Morning/afternoon/evening → tomorrow at that hour; weekend → the coming
 * Saturday at 10:00. Local time, like every other follow-up.
 */
export function comeBackFollowUpAt(
  when: 'morning' | 'afternoon' | 'evening' | 'weekend',
  now: Date = new Date(),
): string {
  const hour = when === 'morning' ? 9 : when === 'afternoon' ? 14 : when === 'evening' ? 18 : 10;
  let dayOffset = 1;
  if (when === 'weekend') {
    const dow = now.getDay(); // 0 Sun … 6 Sat — a Saturday knock aims at next Saturday
    dayOffset = dow === 6 ? 7 : 6 - dow;
  }
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + dayOffset, hour, 0, 0, 0).toISOString();
}
