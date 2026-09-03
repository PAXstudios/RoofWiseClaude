// Knocking-data sync — every session, door, plan and do-not-knock entry to
// the owner's Supabase (migration supabase/migrations/20260903140000_knocking_data.sql).
//
// WHY: the owner wants the compiled knocking data on the backend — who
// knocked which doors, what came of it, which plans were run — for every
// user, on a map (docs/KNOCK_DATA.md has the queries).
//
// SHAPE — mirrors leadSync.ts:
//   • single-flight (`syncKnocks` shares one run between callers);
//   • no-op without a signed-in session;
//   • `updated_at` is the CLIENT's edit time and the server keeps it as sent;
//   • a missing table → `status: 'needs_schema'` and `KNOCKING_SQL` is the
//     text to paste (Settings → Backup shows it).
//
// WHAT MOVES
//   push  profiles (name + company so the owner sees WHO), knock_sessions
//         (archive + the active one, with the `sessionStats` numbers
//         denormalised), knocks, knock_plans (+ knock_plan_areas flattened
//         from the result), do_not_knock. Batched ≤ 200 rows. A per-row
//         content hash (knockSyncStore) means an unchanged row is never
//         re-sent — sessions carry a track and plans the whole finder result.
//   pull  rows this device has never seen (restore on a new phone) and rows
//         edited later elsewhere. Device wins on ties. A plan removed here is
//         soft-deleted on the server and never handed back: knockFinderStore
//         is another wave's file, so this module subscribes to it and diffs
//         plan ids to notice a removal (same for do-not-knock entries).
//   soft  deletions are `deleted_at` stamps, never row deletes — the owner
//         keeps history; the views filter them out.
//
// NOT SYNCED (and why): mileage trips (the session carries `miles`; the
// trip's raw samples are device detail), photo URLs inside a knock's Zillow
// record (`propertyRecordSubset` drops them — the record is licensed data,
// the owner asked for the door, not the listing), the listing agent (third-
// party PII). Sessions are never deleted on the server: the archive cap
// (100 on the phone) is a phone limit, not a deletion.
//
// WHEN: lifecycleHooks.ts runs it on the 5-minute foreground cadence and
// `syncKnocksSoon()` (20 s debounce) fires after a route ends, a plan is
// saved / changed / removed, a knock is logged, or an entry is added to the
// do-not-knock list — via the store subscriptions in `startKnockSyncWatcher`.

import { supabase, isSupabaseConfigured } from '../supabase';
import { useAuthStore } from '../auth/authStore';
import { useKnockSessionStore } from '../stores/knockSessionStore';
import { useKnockFinderStore, type AreaStatus, type KnockPlan } from '../stores/knockFinderStore';
import { useDoNotKnockStore } from '../stores/doNotKnockStore';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import { useKnockSyncStore, type KnockSyncStatus, type PushedEntry } from '../stores/knockSyncStore';
import { sessionStats } from './knockOutcomes';
import type {
  DoNotKnockEntry,
  Knock,
  KnockHistoryEntry,
  KnockRouteTarget,
  KnockSession,
  KnockTrackPoint,
  PropertyRecord,
} from '../models/types';

export type { KnockSyncStatus } from '../stores/knockSyncStore';

export type KnockSyncSummary = {
  status: KnockSyncStatus;
  /** Rows upserted this run (sessions + knocks + plans + areas + entries + profile). */
  pushed: number;
  /** Rows applied locally from the server (restores + newer edits). */
  pulled: number;
  /** Rows whose content hash matched the last push — not re-sent. */
  skipped: number;
  /** Soft-deletes propagated (plans, do-not-knock entries, orphaned knocks). */
  deleted: number;
  error?: string;
  /** Why the run did nothing (`skipped`): not signed in, not configured. */
  reason?: string;
};

export type KnockSyncOptions = {
  /** Re-send every row regardless of its hash. */
  force?: boolean;
  /** For the run record — "foreground", "route_end", "plan_saved", "settings". */
  reason?: string;
};

const NOT_PROVISIONED =
  'Knocking-data tables not provisioned — run the SQL in Settings → Backup (or docs/KNOCK_DATA.md).';
const BATCH = 200;
/** The phone keeps this many sessions / plans; a restore respects the same caps. */
const MAX_ARCHIVE = 100;
const MAX_PLANS = 40;
/** Stops are built from plan areas (`toTarget(area)`); this is "the same point". */
const MATCH_DEG = 1e-6;
const SOON_MS = 20_000;

// -----------------------------------------------------------------------------
// Public entry points
// -----------------------------------------------------------------------------

let inFlight: Promise<KnockSyncSummary> | null = null;

/** Re-entrant callers (foreground, Settings, the debounce) share one run. */
export function syncKnocks(opts: KnockSyncOptions = {}): Promise<KnockSyncSummary> {
  if (inFlight) return inFlight;
  inFlight = run(opts).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

let soonTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Sync in ~20 s, coalescing bursts (a route end writes the session, the
 * mileage trip and an activity event in one tap). Call it from the route-end
 * and plan-saved paths; the store watcher below calls it too.
 */
export function syncKnocksSoon(reason = 'soon'): void {
  if (soonTimer) clearTimeout(soonTimer);
  soonTimer = setTimeout(() => {
    soonTimer = null;
    syncKnocks({ reason }).catch(() => {});
  }, SOON_MS);
}

let watcherStarted = false;
/** True while a pull writes into the stores, so the watcher ignores it. */
let applyingRemote = false;

/**
 * Subscribe to the three stores this sync reads (none of them ours to edit):
 * plans and do-not-knock entries that disappear are remembered as deletions;
 * any change schedules a sync. Idempotent; lifecycleHooks calls it once.
 */
export function startKnockSyncWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;

  useKnockFinderStore.subscribe((state, prev) => {
    if (state.plans === prev.plans) return;
    if (!applyingRemote) {
      const removed = removedIds(prev.plans, state.plans);
      if (removed.length > 0) {
        const sync = useKnockSyncStore.getState();
        sync.addDeletedPlans(removed);
        sync.forget(planKeys(sync.pushed, removed));
      }
    }
    syncKnocksSoon('plans_changed');
  });

  useDoNotKnockStore.subscribe((state, prev) => {
    if (state.entries === prev.entries) return;
    if (!applyingRemote) {
      const removed = removedIds(prev.entries, state.entries);
      if (removed.length > 0) {
        const sync = useKnockSyncStore.getState();
        sync.addDeletedDnk(removed);
        sync.forget(removed.map((id) => key('dnk', id)));
      }
    }
    syncKnocksSoon('dnk_changed');
  });

  // A route ending (archive) or a door logged / edited (active knocks) — not
  // every GPS fix, which would re-send the active session all day long.
  useKnockSessionStore.subscribe((state, prev) => {
    if (applyingRemote) return;
    const routeEnded = state.archive !== prev.archive;
    const knocksChanged =
      state.activeSession?.id !== prev.activeSession?.id ||
      state.activeSession?.knocks !== prev.activeSession?.knocks;
    if (routeEnded || knocksChanged) syncKnocksSoon(routeEnded ? 'route_end' : 'knock_logged');
  });
}

/** Ids present in `prev` and gone from `next`. */
export function removedIds<T extends { id: string }>(prev: readonly T[], next: readonly T[]): string[] {
  const keep = new Set(next.map((x) => x.id));
  return prev.filter((x) => !keep.has(x.id)).map((x) => x.id);
}

// -----------------------------------------------------------------------------
// The run
// -----------------------------------------------------------------------------

async function run(opts: KnockSyncOptions): Promise<KnockSyncSummary> {
  const started = new Date().toISOString();
  const user = useAuthStore.getState().user;
  if (!isSupabaseConfigured) return { status: 'skipped', pushed: 0, pulled: 0, skipped: 0, deleted: 0, reason: 'Backend not configured' };
  if (!user) return { status: 'skipped', pushed: 0, pulled: 0, skipped: 0, deleted: 0, reason: 'Not signed in' };

  const summary: KnockSyncSummary = { status: 'ok', pushed: 0, pulled: 0, skipped: 0, deleted: 0 };
  const fail = (message: string): KnockSyncSummary => {
    const missing = isMissingTable(message);
    summary.status = missing ? 'needs_schema' : 'error';
    summary.error = missing ? NOT_PROVISIONED : message;
    // A foreign-key refusal means a parent row this device believes it pushed
    // is gone (tables recreated). Forget every hash so the next run re-sends
    // everything in order — the server upserts, so nothing duplicates.
    if (/foreign key/i.test(message)) useKnockSyncStore.getState().reset();
    useKnockSyncStore.getState().recordRun({
      at: started,
      status: summary.status,
      pushed: summary.pushed,
      pulled: summary.pulled,
      error: summary.error,
    });
    return summary;
  };

  try {
    // 1) What to push — computed once from a snapshot of the stores.
    const snap = takeSnapshot(user.id, user.email ?? undefined, !!opts.force);
    const plan = planPush(snap);
    summary.skipped = plan.skipped;

    // 2) Push, parent tables before children (foreign keys).
    if (plan.profile) {
      const { error } = await supabase.from('profiles').upsert([plan.profile.row], { onConflict: 'user_id' });
      if (error) return fail(error.message);
      useKnockSyncStore.getState().markPushed({ [plan.profile.key]: plan.profile.entry });
      summary.pushed += 1;
    }

    const tables: { table: string; conflict: string; rows: Prepared[] }[] = [
      { table: 'knock_sessions', conflict: 'id', rows: plan.sessions },
      { table: 'knocks', conflict: 'id', rows: plan.knocks },
      { table: 'knock_plans', conflict: 'id', rows: plan.plans },
      { table: 'knock_plan_areas', conflict: 'plan_id,area_key', rows: plan.areas },
      { table: 'do_not_knock', conflict: 'id', rows: plan.dnk },
    ];
    for (const t of tables) {
      for (const batch of chunk(t.rows, BATCH)) {
        const { error } = await supabase
          .from(t.table)
          .upsert(batch.map((p) => p.row), { onConflict: t.conflict });
        if (error) return fail(error.message);
        const entries: Record<string, PushedEntry> = {};
        for (const p of batch) entries[p.key] = p.entry;
        useKnockSyncStore.getState().markPushed(entries);
        summary.pushed += batch.length;
      }
    }

    // 3) Soft-deletes: plans / entries removed here, knocks gone from their session.
    const deletedAt = new Date().toISOString();
    if (snap.deletedPlanIds.length > 0) {
      const { error } = await supabase
        .from('knock_plans')
        .update({ deleted_at: deletedAt })
        .eq('user_id', user.id)
        .in('id', snap.deletedPlanIds);
      if (error) return fail(error.message);
      useKnockSyncStore.getState().clearDeletedPlans(snap.deletedPlanIds);
      summary.deleted += snap.deletedPlanIds.length;
    }
    if (snap.deletedDnkIds.length > 0) {
      const { error } = await supabase
        .from('do_not_knock')
        .update({ deleted_at: deletedAt })
        .eq('user_id', user.id)
        .in('id', snap.deletedDnkIds);
      if (error) return fail(error.message);
      useKnockSyncStore.getState().clearDeletedDnk(snap.deletedDnkIds);
      summary.deleted += snap.deletedDnkIds.length;
    }
    if (plan.orphanKnockIds.length > 0) {
      const { error } = await supabase
        .from('knocks')
        .update({ deleted_at: deletedAt })
        .eq('user_id', user.id)
        .in('id', plan.orphanKnockIds);
      if (error) return fail(error.message);
      useKnockSyncStore.getState().forget(plan.orphanKnockIds.map((id) => key('knock', id)));
      summary.deleted += plan.orphanKnockIds.length;
    }

    // 4) Pull — plans first so restored sessions can be matched to them.
    const pulledPlans = await pullPlans(user.id);
    if (pulledPlans.error) return fail(pulledPlans.error);
    summary.pulled += pulledPlans.applied;

    const pulledDnk = await pullDoNotKnock(user.id);
    if (pulledDnk.error) return fail(pulledDnk.error);
    summary.pulled += pulledDnk.applied;

    const pulledSessions = await pullSessions(user.id);
    if (pulledSessions.error) return fail(pulledSessions.error);
    summary.pulled += pulledSessions.applied;

    useKnockSyncStore.getState().recordRun({
      at: started,
      status: 'ok',
      pushed: summary.pushed,
      pulled: summary.pulled,
      error: null,
    });
    return summary;
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
}

// -----------------------------------------------------------------------------
// Snapshot → push plan (pure; tested in isolation)
// -----------------------------------------------------------------------------

export type SyncSnapshot = {
  userId: string;
  email?: string;
  displayName?: string;
  company?: string;
  /** Active session first (when there is one), then the archive. */
  sessions: KnockSession[];
  plans: KnockPlan[];
  dnk: DoNotKnockEntry[];
  pushed: Record<string, PushedEntry>;
  deletedPlanIds: string[];
  deletedDnkIds: string[];
  /** ISO — the client time stamped on rows that carry no edit time of their own. */
  now: string;
  force: boolean;
};

export type Prepared = { key: string; row: Record<string, unknown>; entry: PushedEntry };

export type PushPlan = {
  profile: Prepared | null;
  sessions: Prepared[];
  knocks: Prepared[];
  plans: Prepared[];
  areas: Prepared[];
  dnk: Prepared[];
  /** Knocks pushed under a session earlier that the session no longer holds. */
  orphanKnockIds: string[];
  skipped: number;
};

function takeSnapshot(userId: string, email: string | undefined, force: boolean): SyncSnapshot {
  const ks = useKnockSessionStore.getState();
  const profile = useInspectorProfileStore.getState().profile;
  const sync = useKnockSyncStore.getState();
  const authName = (useAuthStore.getState().user?.user_metadata as Record<string, unknown> | undefined)?.full_name;
  return {
    userId,
    email,
    displayName: profile.fullName?.trim() || (typeof authName === 'string' ? authName : undefined) || undefined,
    company: profile.company?.name?.trim() || undefined,
    sessions: ks.activeSession ? [ks.activeSession, ...ks.archive] : ks.archive,
    plans: useKnockFinderStore.getState().plans,
    dnk: useDoNotKnockStore.getState().entries,
    pushed: sync.pushed,
    deletedPlanIds: sync.deletedPlanIds,
    deletedDnkIds: sync.deletedDnkIds,
    now: new Date().toISOString(),
    force,
  };
}

/**
 * Turn the snapshot into rows, dropping every row whose content hash matches
 * what was last pushed. `updated_at` is excluded from the hash: it is the
 * natural edit time when the model has one, else the time the change was
 * first seen here (kept stable across runs through the stored entry).
 */
export function planPush(snap: SyncSnapshot): PushPlan {
  const out: PushPlan = { profile: null, sessions: [], knocks: [], plans: [], areas: [], dnk: [], orphanKnockIds: [], skipped: 0 };

  const consider = (k: string, row: Record<string, unknown>, natural: string | undefined, parent?: string): Prepared | null => {
    const { updated_at: _ignored, ...content } = row;
    const hash = hashContent(content);
    const prev = snap.pushed[k];
    if (!snap.force && prev && prev.hash === hash) {
      out.skipped += 1;
      return null;
    }
    const at = natural ?? (prev && prev.hash === hash ? prev.at : snap.now);
    const entry: PushedEntry = parent ? { hash, at, parent } : { hash, at };
    return { key: k, row: { ...row, updated_at: at }, entry };
  };

  // Profile — the owner's "who".
  out.profile = consider(
    key('profile', snap.userId),
    {
      user_id: snap.userId,
      email: snap.email ?? null,
      display_name: snap.displayName ?? null,
      company: snap.company ?? null,
      updated_at: snap.now,
    },
    undefined,
  );

  // Sessions + their knocks.
  const pushedKnocksBySession = knocksByParent(snap.pushed);
  for (const s of snap.sessions) {
    const planId = planIdForSession(s, snap.plans);
    const prepared = consider(key('session', s.id), sessionToRow(s, snap.userId, planId), sessionUpdatedAt(s));
    if (prepared) out.sessions.push(prepared);
    for (const k of s.knocks) {
      const p = consider(key('knock', k.id), knockToRow(k, snap.userId, s.id), k.updatedAt ?? k.createdAt, s.id);
      if (p) out.knocks.push(p);
    }
    const before = pushedKnocksBySession.get(s.id);
    if (before) {
      const nowIds = new Set(s.knocks.map((k) => k.id));
      for (const id of before) if (!nowIds.has(id)) out.orphanKnockIds.push(id);
    }
  }

  // Plans + flattened areas.
  for (const p of snap.plans) {
    const planRow = planToRow(p, snap.userId);
    const prepared = consider(key('plan', p.id), planRow, planUpdatedAt(p));
    if (prepared) out.plans.push(prepared);
    const planAt = prepared ? String(prepared.row.updated_at) : (snap.pushed[key('plan', p.id)]?.at ?? snap.now);
    for (const a of planAreaRows(p, snap.userId)) {
      const ap = consider(key('area', `${p.id}/${String(a.area_key)}`), a, planAt);
      if (ap) out.areas.push(ap);
    }
  }

  // Do-not-knock.
  for (const e of snap.dnk) {
    const p = consider(key('dnk', e.id), dnkToRow(e, snap.userId), e.updatedAt);
    if (p) out.dnk.push(p);
  }

  return out;
}

function knocksByParent(pushed: Record<string, PushedEntry>): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [k, entry] of Object.entries(pushed)) {
    if (!k.startsWith('knock:') || !entry.parent) continue;
    const id = k.slice('knock:'.length);
    const list = map.get(entry.parent);
    if (list) list.push(id);
    else map.set(entry.parent, [id]);
  }
  return map;
}

/** Hash keys of a plan and its areas — what to forget when the plan goes. */
export function planKeys(pushed: Record<string, PushedEntry>, planIds: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of planIds) {
    out.push(key('plan', id));
    const prefix = `area:${id}/`;
    for (const k of Object.keys(pushed)) if (k.startsWith(prefix)) out.push(k);
  }
  return out;
}

// -----------------------------------------------------------------------------
// Model ↔ row mapping (pure)
// -----------------------------------------------------------------------------

/**
 * Which saved plan a session's stops came from. `KnockSession` carries no
 * plan id (PlanView's "Start day N" hands `startRoute` the stops only), so
 * the stops are matched back to the areas of the newest plan made before the
 * session started. Null when the session was aimed by hand.
 */
export function planIdForSession(session: Pick<KnockSession, 'startedAt' | 'routeStops' | 'routeTarget'>, plans: readonly KnockPlan[]): string | null {
  // The day the session store records the plan itself, it wins outright.
  const recorded = (session as { planId?: unknown }).planId;
  if (typeof recorded === 'string' && recorded) return recorded;
  const targets: KnockRouteTarget[] =
    session.routeStops && session.routeStops.length > 0
      ? session.routeStops
      : session.routeTarget
        ? [session.routeTarget]
        : [];
  if (targets.length === 0) return null;
  const startedAt = ts(session.startedAt);
  const candidates = plans
    .filter((p) => ts(p.createdAt) <= startedAt || startedAt === 0)
    .sort((a, b) => ts(b.createdAt) - ts(a.createdAt));
  const covers = (p: KnockPlan, t: KnockRouteTarget) =>
    p.result.areas.some((a) => Math.abs(a.lat - t.lat) <= MATCH_DEG && Math.abs(a.lng - t.lng) <= MATCH_DEG);
  const all = candidates.find((p) => targets.every((t) => covers(p, t)));
  if (all) return all.id;
  const first = candidates.find((p) => covers(p, targets[0]));
  return first ? first.id : null;
}

/** The last moment anything on the session changed — its `updated_at`. */
export function sessionUpdatedAt(s: KnockSession): string {
  let max = ts(s.startedAt);
  if (s.endedAt) max = Math.max(max, ts(s.endedAt));
  for (const k of s.knocks) max = Math.max(max, ts(k.updatedAt ?? k.createdAt));
  const last = s.track && s.track.length > 0 ? s.track[s.track.length - 1] : undefined;
  if (last && Number.isFinite(last.ts)) max = Math.max(max, last.ts);
  return new Date(max || Date.now()).toISOString();
}

export function sessionToRow(s: KnockSession, userId: string, planId: string | null): Record<string, unknown> {
  const stats = sessionStats(s);
  return {
    id: s.id,
    user_id: userId,
    started_at: s.startedAt,
    ended_at: s.endedAt ?? null,
    route_storm_alert_id: s.routeStormAlertId ?? null,
    route_target: s.routeTarget ?? null,
    route_stops: s.routeStops ?? null,
    current_stop_index: s.currentStopIndex ?? null,
    miles: num(s.miles),
    mileage_trip_id: s.mileageTripId ?? null,
    plan_id: planId,
    track: s.track ?? null,
    doors: stats.doors,
    contacts: stats.contacts,
    interested: stats.interested,
    appointments: stats.appointments,
    signed: stats.signed,
    follow_ups: stats.followUps,
    leads: stats.leads,
    minutes: stats.minutes,
    updated_at: sessionUpdatedAt(s),
    deleted_at: null,
  };
}

export function rowToSession(row: Record<string, any>, knocks: Knock[]): KnockSession {
  const session: KnockSession = {
    id: String(row.id),
    startedAt: iso(row.started_at) ?? new Date().toISOString(),
    knocks: knocks.slice().sort((a, b) => ts(a.createdAt) - ts(b.createdAt)),
  };
  const endedAt = iso(row.ended_at);
  if (endedAt) session.endedAt = endedAt;
  if (row.route_storm_alert_id) session.routeStormAlertId = String(row.route_storm_alert_id);
  if (row.route_target && typeof row.route_target === 'object') session.routeTarget = row.route_target as KnockRouteTarget;
  if (Array.isArray(row.route_stops)) session.routeStops = row.route_stops as KnockRouteTarget[];
  if (typeof row.current_stop_index === 'number') session.currentStopIndex = row.current_stop_index;
  const miles = num(row.miles);
  if (miles !== null) session.miles = miles;
  if (row.mileage_trip_id) session.mileageTripId = String(row.mileage_trip_id);
  if (Array.isArray(row.track)) session.track = row.track as KnockTrackPoint[];
  return session;
}

export function knockToRow(k: Knock, userId: string, sessionId: string): Record<string, unknown> {
  return {
    id: k.id,
    user_id: userId,
    session_id: sessionId,
    lat: k.lat,
    lng: k.lng,
    address: k.address ?? null,
    outcome: k.outcome,
    notes: k.notes ?? null,
    follow_up_at: k.followUpAt ?? null,
    created_lead_id: k.createdLeadId ?? null,
    contact_name: k.contactName ?? null,
    contact_phone: k.contactPhone ?? null,
    damage_noted: k.damageNoted ?? null,
    come_back_when: k.comeBackWhen ?? null,
    placed_by: k.placedBy ?? null,
    history: k.history && k.history.length > 0 ? k.history : null,
    property_record: propertyRecordSubset(k.propertyRecord),
    created_at: k.createdAt,
    updated_at: k.updatedAt ?? k.createdAt,
    deleted_at: null,
  };
}

export function rowToKnock(row: Record<string, any>): Knock {
  const k: Knock = {
    id: String(row.id),
    sessionId: String(row.session_id),
    lat: Number(row.lat),
    lng: Number(row.lng),
    outcome: String(row.outcome) as Knock['outcome'],
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
  };
  if (row.address) k.address = String(row.address);
  if (row.notes) k.notes = String(row.notes);
  const followUpAt = iso(row.follow_up_at);
  if (followUpAt) k.followUpAt = followUpAt;
  if (row.created_lead_id) k.createdLeadId = String(row.created_lead_id);
  const updatedAt = iso(row.updated_at);
  if (updatedAt && updatedAt !== k.createdAt) k.updatedAt = updatedAt;
  if (Array.isArray(row.history) && row.history.length > 0) k.history = row.history as KnockHistoryEntry[];
  if (row.contact_name) k.contactName = String(row.contact_name);
  if (row.contact_phone) k.contactPhone = String(row.contact_phone);
  const record = propertyRecordFromSubset(row.property_record);
  if (record) k.propertyRecord = record;
  if (typeof row.damage_noted === 'boolean') k.damageNoted = row.damage_noted;
  if (row.come_back_when) k.comeBackWhen = String(row.come_back_when) as Knock['comeBackWhen'];
  if (row.placed_by === 'gps' || row.placed_by === 'map_tap') k.placedBy = row.placed_by;
  return k;
}

/**
 * The part of a Zillow record that describes the DOOR — never the photo
 * URLs (licensed imagery, and the owner asked for the knock, not the
 * listing) and never the listing agent (a third party's contact details).
 * Keys are snake_case so `v_knock_doors` can read `year_built` directly.
 */
export function propertyRecordSubset(pr: PropertyRecord | undefined): Record<string, unknown> | null {
  if (!pr) return null;
  return compact({
    status: pr.status,
    fetched_at: pr.fetchedAt,
    zpid: pr.zpid,
    street_address: pr.streetAddress,
    city: pr.city,
    state: pr.state,
    zipcode: pr.zipcode,
    year_built: pr.yearBuilt,
    living_area_sq_ft: pr.livingAreaSqFt,
    home_status: pr.homeStatus,
    list_price: pr.listPrice,
    listed_date: pr.listedDate,
    last_sold_date: pr.lastSoldDate,
    last_sold_price: pr.lastSoldPrice,
    zestimate: pr.zestimate,
    roof_fact: pr.roofFact,
    roof_hints: pr.roofHints,
  });
}

/** Rebuild a (photo-less) PropertyRecord from the subset. `coverPhotoUri()` falls back cleanly. */
export function propertyRecordFromSubset(sub: unknown): PropertyRecord | undefined {
  if (!sub || typeof sub !== 'object') return undefined;
  const s = sub as Record<string, unknown>;
  const status = s.status;
  if (status !== 'found' && status !== 'not_found' && status !== 'unavailable' && status !== 'not_configured') return undefined;
  const pr: PropertyRecord = {
    fetchedAt: typeof s.fetched_at === 'string' ? s.fetched_at : new Date(0).toISOString(),
    source: 'zillow',
    status,
  };
  const str = (v: unknown) => (typeof v === 'string' && v ? v : undefined);
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  if (n(s.zpid) !== undefined) pr.zpid = n(s.zpid);
  if (str(s.street_address)) pr.streetAddress = str(s.street_address);
  if (str(s.city)) pr.city = str(s.city);
  if (str(s.state)) pr.state = str(s.state);
  if (str(s.zipcode)) pr.zipcode = str(s.zipcode);
  if (n(s.year_built) !== undefined) pr.yearBuilt = n(s.year_built);
  if (n(s.living_area_sq_ft) !== undefined) pr.livingAreaSqFt = n(s.living_area_sq_ft);
  if (str(s.home_status)) pr.homeStatus = str(s.home_status);
  if (n(s.list_price) !== undefined) pr.listPrice = n(s.list_price);
  if (str(s.listed_date)) pr.listedDate = str(s.listed_date);
  if (str(s.last_sold_date)) pr.lastSoldDate = str(s.last_sold_date);
  if (n(s.last_sold_price) !== undefined) pr.lastSoldPrice = n(s.last_sold_price);
  if (n(s.zestimate) !== undefined) pr.zestimate = n(s.zestimate);
  if (str(s.roof_fact)) pr.roofFact = str(s.roof_fact);
  if (Array.isArray(s.roof_hints)) pr.roofHints = s.roof_hints as PropertyRecord['roofHints'];
  return pr;
}

/**
 * Fields a plan may grow that the store's type does not carry yet: a run
 * `mode` and an `updatedAt` edit time. Read optionally so the sync carries
 * them the day they exist, without a change here.
 */
type PlanExtras = {
  mode?: string;
  updatedAt?: string;
};

function planUpdatedAt(p: KnockPlan): string | undefined {
  const extra = p as KnockPlan & PlanExtras;
  return typeof extra.updatedAt === 'string' ? extra.updatedAt : undefined;
}

export function planToRow(p: KnockPlan, userId: string): Record<string, unknown> {
  const extra = p as KnockPlan & PlanExtras;
  return {
    id: p.id,
    user_id: userId,
    title: p.title,
    created_at: p.createdAt,
    base: p.result.base ?? null,
    radius_miles: num(p.result.radiusMiles),
    lookback_months: num(p.result.lookbackMonths),
    mode: typeof extra.mode === 'string' ? extra.mode : null,
    result: p.result,
    area_status: p.areaStatus ?? {},
    notes: p.notes ?? null,
    schedule: p.schedule && p.schedule.length > 0 ? p.schedule : null,
    storm_alert_id: p.stormAlertId ?? null,
    exclusions: p.exclusions ?? null,
    updated_at: planUpdatedAt(p) ?? p.createdAt,
    deleted_at: null,
  };
}

export function rowToPlan(row: Record<string, any>): KnockPlan {
  const plan: KnockPlan & PlanExtras = {
    id: String(row.id),
    createdAt: iso(row.created_at) ?? new Date().toISOString(),
    title: String(row.title ?? ''),
    result: row.result as KnockPlan['result'],
    areaStatus: (row.area_status && typeof row.area_status === 'object' ? row.area_status : {}) as Record<string, AreaStatus>,
  };
  if (row.notes) plan.notes = String(row.notes);
  if (row.mode) plan.mode = String(row.mode);
  if (Array.isArray(row.schedule) && row.schedule.length > 0) plan.schedule = row.schedule as KnockPlan['schedule'];
  if (row.storm_alert_id) plan.stormAlertId = String(row.storm_alert_id);
  if (row.exclusions && typeof row.exclusions === 'object') plan.exclusions = row.exclusions as KnockPlan['exclusions'];
  const updatedAt = iso(row.updated_at);
  if (updatedAt && updatedAt !== plan.createdAt) plan.updatedAt = updatedAt;
  return plan;
}

export function planAreaRows(p: KnockPlan, userId: string): Record<string, unknown>[] {
  const areas = Array.isArray(p.result?.areas) ? p.result.areas : [];
  return areas.map((a, i) => ({
    plan_id: p.id,
    area_key: a.key,
    user_id: userId,
    rank: i + 1,
    lat: a.lat,
    lng: a.lng,
    name: a.name ?? null,
    zip: a.zip ?? null,
    distance_miles: num(a.distanceMiles),
    knock_score: a.knockScore != null && Number.isFinite(a.knockScore) ? Math.round(a.knockScore) : null,
    per_roof_p: num(a.hitRate?.perRoof),
    doors: num(a.hitRate?.doors),
    expected: num(a.hitRate?.expected),
    at_least: num(a.hitRate?.atLeast),
    hail_max_inches: num(a.storm?.maxHailInches),
    wind_max_mph: num(a.storm?.maxWindMph),
    storm_day: a.storm?.strongest?.day ?? null,
    status: p.areaStatus?.[a.key] ?? 'planned',
    updated_at: p.createdAt,
  }));
}

export function dnkToRow(e: DoNotKnockEntry, userId: string): Record<string, unknown> {
  return {
    id: e.id,
    user_id: userId,
    kind: e.kind,
    label: e.label,
    lat: num(e.lat),
    lng: num(e.lng),
    radius_meters: num(e.radiusMeters),
    polygon: e.polygon && e.polygon.length > 0 ? e.polygon : null,
    address: e.address ?? null,
    source: e.source,
    note: e.note ?? null,
    knock_id: e.knockId ?? null,
    created_at: e.createdAt,
    updated_at: e.updatedAt,
    deleted_at: null,
  };
}

export function rowToDnk(row: Record<string, any>): DoNotKnockEntry {
  const createdAt = iso(row.created_at) ?? new Date().toISOString();
  const e: DoNotKnockEntry = {
    id: String(row.id),
    kind: row.kind === 'zone' ? 'zone' : 'home',
    label: String(row.label ?? ''),
    source: (['roofer', 'outcome', 'hoa_list'].includes(row.source) ? row.source : 'roofer') as DoNotKnockEntry['source'],
    createdAt,
    updatedAt: iso(row.updated_at) ?? createdAt,
  };
  const lat = num(row.lat);
  const lng = num(row.lng);
  if (lat !== null) e.lat = lat;
  if (lng !== null) e.lng = lng;
  const r = num(row.radius_meters);
  if (r !== null) e.radiusMeters = r;
  if (Array.isArray(row.polygon) && row.polygon.length > 0) e.polygon = row.polygon as DoNotKnockEntry['polygon'];
  if (row.address) e.address = String(row.address);
  if (row.note) e.note = String(row.note);
  if (row.knock_id) e.knockId = String(row.knock_id);
  return e;
}

// -----------------------------------------------------------------------------
// Pull — restore what this device lacks; take edits made later elsewhere
// -----------------------------------------------------------------------------

type PullResult = { applied: number; error?: string };

/** What the merge decided for one remote row (pure; tested). */
export type MergeDecision = 'add' | 'replace' | 'remove' | 'keep';

export function decidePlanMerge(args: {
  remote: { id: string; updated_at: unknown; deleted_at: unknown };
  local: KnockPlan | undefined;
  localHash: string | undefined;
  entry: PushedEntry | undefined;
  deletedLocally: boolean;
}): MergeDecision {
  const { remote, local, localHash, entry, deletedLocally } = args;
  const unchangedSincePush = !!entry && !!localHash && entry.hash === localHash;
  if (remote.deleted_at) {
    // Gone on the server. Drop it here only if nothing changed since we
    // pushed it — a local edit is the device winning, and it re-pushes.
    return local && unchangedSincePush ? 'remove' : 'keep';
  }
  if (!local) return deletedLocally ? 'keep' : 'add';
  if (!entry) return 'keep'; // never pushed from here → the local copy is the newer fact
  if (ts(remote.updated_at) > ts(entry.at) && unchangedSincePush) return 'replace';
  return 'keep';
}

async function pullPlans(userId: string): Promise<PullResult> {
  const { data, error } = await supabase
    .from('knock_plans')
    .select('id, updated_at, deleted_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return { applied: 0, error: error.message };

  const finder = useKnockFinderStore.getState();
  const sync = useKnockSyncStore.getState();
  const localById = new Map(finder.plans.map((p) => [p.id, p]));
  // Rows this device marked as pushed that the server no longer has
  // (tables reset) are forgotten so the next run re-sends them.
  const gone = missingOnServer('plan', finder.plans.map((p) => p.id), (data ?? []).map((r) => String(r.id)), sync.pushed);
  if (gone.length > 0) sync.forget(planKeys(sync.pushed, gone));
  const fetchIds: string[] = [];
  const removeIds: string[] = [];
  const settledDeletes: string[] = [];
  for (const r of data ?? []) {
    const id = String(r.id);
    const local = localById.get(id);
    const localHash = local ? hashOfPlan(local, userId) : undefined;
    const d = decidePlanMerge({
      remote: { id, updated_at: r.updated_at, deleted_at: r.deleted_at },
      local,
      localHash,
      entry: sync.pushed[key('plan', id)],
      deletedLocally: sync.deletedPlanIds.includes(id),
    });
    if (d === 'add' || d === 'replace') fetchIds.push(id);
    else if (d === 'remove') removeIds.push(id);
    if (r.deleted_at && sync.deletedPlanIds.includes(id)) settledDeletes.push(id);
  }
  if (settledDeletes.length > 0) sync.clearDeletedPlans(settledDeletes);

  const incoming: KnockPlan[] = [];
  const entries: Record<string, PushedEntry> = {};
  for (const ids of chunk(fetchIds, 20)) {
    const { data: rows, error: e2 } = await supabase.from('knock_plans').select('*').in('id', ids);
    if (e2) return { applied: 0, error: e2.message };
    for (const row of rows ?? []) {
      if (!row.result || typeof row.result !== 'object') continue;
      const plan = rowToPlan(row);
      incoming.push(plan);
      const at = iso(row.updated_at) ?? plan.createdAt;
      entries[key('plan', plan.id)] = { hash: hashOfPlan(plan, userId), at };
      for (const a of planAreaRows(plan, userId)) {
        const { updated_at: _ignored, ...content } = a;
        entries[key('area', `${plan.id}/${String(a.area_key)}`)] = { hash: hashContent(content), at };
      }
    }
  }

  if (incoming.length === 0 && removeIds.length === 0) return { applied: 0 };
  applyRemote(() => {
    useKnockFinderStore.setState((s) => {
      const byId = new Map(s.plans.map((p) => [p.id, p]));
      for (const p of incoming) byId.set(p.id, p);
      for (const id of removeIds) byId.delete(id);
      const plans = Array.from(byId.values())
        .sort((a, b) => ts(b.createdAt) - ts(a.createdAt))
        .slice(0, MAX_PLANS);
      return { plans, lastResult: plans[0]?.result ?? s.lastResult };
    });
  });
  if (Object.keys(entries).length > 0) useKnockSyncStore.getState().markPushed(entries);
  if (removeIds.length > 0) useKnockSyncStore.getState().forget(planKeys(useKnockSyncStore.getState().pushed, removeIds));
  return { applied: incoming.length + removeIds.length };
}

export function decideDnkMerge(args: {
  remote: { id: string; updated_at: unknown; deleted_at: unknown };
  local: DoNotKnockEntry | undefined;
  localHash: string | undefined;
  entry: PushedEntry | undefined;
  deletedLocally: boolean;
}): MergeDecision {
  const { remote, local, localHash, entry, deletedLocally } = args;
  const unchangedSincePush = !!entry && !!localHash && entry.hash === localHash;
  if (remote.deleted_at) return local && unchangedSincePush ? 'remove' : 'keep';
  if (!local) return deletedLocally ? 'keep' : 'add';
  // Entries carry their own edit time: strictly newer wins, ties stay local.
  return ts(remote.updated_at) > ts(local.updatedAt) ? 'replace' : 'keep';
}

async function pullDoNotKnock(userId: string): Promise<PullResult> {
  const { data, error } = await supabase
    .from('do_not_knock')
    .select('*')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1000);
  if (error) return { applied: 0, error: error.message };

  const store = useDoNotKnockStore.getState();
  const sync = useKnockSyncStore.getState();
  const localById = new Map(store.entries.map((e) => [e.id, e]));
  const gone = missingOnServer('dnk', store.entries.map((e) => e.id), (data ?? []).map((r) => String(r.id)), sync.pushed);
  if (gone.length > 0) sync.forget(gone.map((id) => key('dnk', id)));
  const incoming: DoNotKnockEntry[] = [];
  const removeIds: string[] = [];
  const settledDeletes: string[] = [];
  const entries: Record<string, PushedEntry> = {};
  for (const row of data ?? []) {
    const id = String(row.id);
    const local = localById.get(id);
    const localHash = local ? hashOfRow(dnkToRow(local, userId)) : undefined;
    const d = decideDnkMerge({
      remote: { id, updated_at: row.updated_at, deleted_at: row.deleted_at },
      local,
      localHash,
      entry: sync.pushed[key('dnk', id)],
      deletedLocally: sync.deletedDnkIds.includes(id),
    });
    if (row.deleted_at && sync.deletedDnkIds.includes(id)) settledDeletes.push(id);
    if (d === 'add' || d === 'replace') {
      const e = rowToDnk(row);
      incoming.push(e);
      entries[key('dnk', id)] = { hash: hashOfRow(dnkToRow(e, userId)), at: e.updatedAt };
    } else if (d === 'remove') {
      removeIds.push(id);
    }
  }
  if (settledDeletes.length > 0) sync.clearDeletedDnk(settledDeletes);
  if (incoming.length === 0 && removeIds.length === 0) return { applied: 0 };

  applyRemote(() => {
    useDoNotKnockStore.setState((s) => {
      const byId = new Map(s.entries.map((e) => [e.id, e]));
      for (const e of incoming) byId.set(e.id, e);
      for (const id of removeIds) byId.delete(id);
      return { entries: Array.from(byId.values()).sort((a, b) => ts(b.createdAt) - ts(a.createdAt)) };
    });
  });
  if (Object.keys(entries).length > 0) useKnockSyncStore.getState().markPushed(entries);
  if (removeIds.length > 0) useKnockSyncStore.getState().forget(removeIds.map((id) => key('dnk', id)));
  return { applied: incoming.length + removeIds.length };
}

/**
 * Sessions are immutable once ended and ids are per device, so a pull only
 * RESTORES sessions this phone has never seen (a new phone, a reinstall).
 * The active session is never touched. Restored sessions bring their knocks.
 */
async function pullSessions(userId: string): Promise<PullResult> {
  const { data, error } = await supabase
    .from('knock_sessions')
    .select('id, updated_at')
    .eq('user_id', userId)
    .is('deleted_at', null)
    .order('started_at', { ascending: false })
    .limit(500);
  if (error) return { applied: 0, error: error.message };

  const ks = useKnockSessionStore.getState();
  const have = new Set(ks.archive.map((s) => s.id));
  if (ks.activeSession) have.add(ks.activeSession.id);
  const remoteIds = (data ?? []).map((r) => String(r.id));
  // Sessions the server lost (tables reset) go back on the next push, with
  // their knocks — forget the session hash and every knock hash under it.
  const sync = useKnockSyncStore.getState();
  const gone = missingOnServer('session', Array.from(have), remoteIds, sync.pushed);
  if (gone.length > 0) {
    const goneSet = new Set(gone);
    const knockKeys = Object.entries(sync.pushed)
      .filter(([k, e]) => k.startsWith('knock:') && !!e.parent && goneSet.has(e.parent))
      .map(([k]) => k);
    sync.forget([...gone.map((id) => key('session', id)), ...knockKeys]);
  }
  const missing = remoteIds.filter((id) => !have.has(id));
  if (missing.length === 0) return { applied: 0 };

  const restored: KnockSession[] = [];
  const entries: Record<string, PushedEntry> = {};
  const plans = useKnockFinderStore.getState().plans;
  for (const ids of chunk(missing, 50)) {
    const [{ data: rows, error: e1 }, { data: knockRows, error: e2 }] = await Promise.all([
      supabase.from('knock_sessions').select('*').in('id', ids),
      supabase.from('knocks').select('*').in('session_id', ids).is('deleted_at', null),
    ]);
    if (e1) return { applied: 0, error: e1.message };
    if (e2) return { applied: 0, error: e2.message };
    const knocksBySession = new Map<string, Knock[]>();
    for (const kr of knockRows ?? []) {
      const k = rowToKnock(kr);
      const list = knocksBySession.get(k.sessionId);
      if (list) list.push(k);
      else knocksBySession.set(k.sessionId, [k]);
    }
    for (const row of rows ?? []) {
      const session = rowToSession(row, knocksBySession.get(String(row.id)) ?? []);
      restored.push(session);
      const at = iso(row.updated_at) ?? sessionUpdatedAt(session);
      entries[key('session', session.id)] = {
        hash: hashOfRow(sessionToRow(session, userId, planIdForSession(session, plans))),
        at,
      };
      for (const k of session.knocks) {
        entries[key('knock', k.id)] = {
          hash: hashOfRow(knockToRow(k, userId, session.id)),
          at: k.updatedAt ?? k.createdAt,
          parent: session.id,
        };
      }
    }
  }
  if (restored.length === 0) return { applied: 0 };

  applyRemote(() => {
    useKnockSessionStore.setState((s) => {
      const byId = new Map(s.archive.map((x) => [x.id, x]));
      for (const r of restored) if (!byId.has(r.id)) byId.set(r.id, r);
      const archive = Array.from(byId.values())
        .sort((a, b) => ts(b.startedAt) - ts(a.startedAt))
        .slice(0, MAX_ARCHIVE);
      return { archive };
    });
  });
  useKnockSyncStore.getState().markPushed(entries);
  return { applied: restored.length };
}

/**
 * Local ids this device recorded as pushed that are absent from the server's
 * id list — a table that was reset. Their hashes are forgotten so they go
 * back on the next push. (Pure; tested.)
 */
export function missingOnServer(
  kind: 'session' | 'plan' | 'dnk',
  localIds: readonly string[],
  remoteIds: readonly string[],
  pushed: Record<string, PushedEntry>,
): string[] {
  const remote = new Set(remoteIds);
  return localIds.filter((id) => !remote.has(id) && !!pushed[key(kind, id)]);
}

function applyRemote(write: () => void): void {
  applyingRemote = true;
  try {
    write();
  } finally {
    applyingRemote = false;
  }
}

// -----------------------------------------------------------------------------
// Small helpers
// -----------------------------------------------------------------------------

export function key(kind: 'profile' | 'session' | 'knock' | 'plan' | 'area' | 'dnk', id: string): string {
  return `${kind}:${id}`;
}

/** Hash of a row's content with `updated_at` excluded. */
export function hashOfRow(row: Record<string, unknown>): string {
  const { updated_at: _ignored, ...content } = row;
  return hashContent(content);
}

function hashOfPlan(p: KnockPlan, userId: string): string {
  return hashOfRow(planToRow(p, userId));
}

/**
 * Deterministic content hash: sorted-key JSON through two FNV-1a passes.
 * Not cryptographic — it only has to notice that a row changed, and a
 * 64-bit space over a few thousand rows makes an accidental match moot.
 */
export function hashContent(value: unknown): string {
  const text = stableStringify(value);
  return fnv1a(text, 0x811c9dc5).toString(16).padStart(8, '0') + fnv1a(text, 0x01000193).toString(16).padStart(8, '0');
}

function fnv1a(text: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((v) => stableStringify(v === undefined ? null : v)).join(',')}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`;
}

function compact(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) if (v !== undefined && v !== null) out[k] = v;
  return out;
}

function num(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function ts(v: unknown): number {
  const t = typeof v === 'string' ? new Date(v).getTime() : typeof v === 'number' ? v : NaN;
  return Number.isFinite(t) ? t : 0;
}

/** A Postgres timestamp (`…+00:00`) re-serialised the way the app writes them (`…Z`). */
function iso(v: unknown): string | undefined {
  if (typeof v !== 'string' || v === '') return undefined;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : undefined;
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('relation');
}

// -----------------------------------------------------------------------------
// The SQL — a VERBATIM copy of supabase/migrations/20260903140000_knocking_data.sql
// (the scratch test asserts equality). Settings → Backup offers it when the
// tables are missing; the integrator applies the migration file itself.
// -----------------------------------------------------------------------------
export const KNOCKING_SQL = `-- ============================================================================
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
--   • ids are the client's text ids; \`updated_at\` is the CLIENT's edit time
--     and is never rewritten server-side (the lesson of migration
--     20260903120000_drop_touch_updated_at.sql). \`synced_at\` is the
--     server-owned receipt time and IS trigger-maintained — that is the one
--     column a trigger may touch.
--   • rows are soft-deleted (\`deleted_at\`) so the owner never loses history;
--     the views filter them out.
--   • \`knocks.property_record\` is a SUBSET of the Zillow record (no photo
--     URLs, no listing agent) — see propertyRecordSubset() in knockSync.ts.
--
-- HOW THE OWNER SEES EVERYONE
--   insert into public.app_admins (user_id) values ('<their auth.users.id>');
--   (Dashboard → Authentication → Users → copy the UID.) docs/KNOCK_DATA.md
--   has the queries.
--
-- APPLY: the integrator runs this against epghfumtuxrhonbpnbmr via the
-- Supabase MCP (apply_migration), after the two 20260903120x00 migrations.
-- Idempotent: every statement is \`if not exists\` / \`drop … if exists\` /
-- \`create or replace\`; safe to run twice. Nothing here alters an existing
-- table's columns or policies — the admin policies on leads / inspections /
-- photos are ADDITIVE and guarded so a project without \`photos\` still applies.
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

-- Mirrors \`isContact\` in lib/services/knockOutcomes.ts: someone answered the
-- door. \`not_home\` / \`inspection_scheduled\` are the legacy spellings of
-- \`no_answer\` / \`appointment\` and are kept so old pins count the same way.
create or replace function public.knock_is_contact(outcome text) returns boolean
language sql immutable strict parallel safe as $$
  select outcome in (
    'interested', 'not_interested', 'follow_up', 'appointment', 'inspection_scheduled',
    'come_back', 'already_has_roofer', 'renter', 'inspected', 'signed'
  );
$$;

-- Mirrors \`isWin\`: someone said yes to something.
create or replace function public.knock_is_win(outcome text) returns boolean
language sql immutable strict parallel safe as $$
  select outcome in ('interested', 'appointment', 'inspection_scheduled', 'inspected', 'signed');
$$;

-- The calendar day a knock belongs to. Sessions are local-day things and a
-- 7 pm Central knock is already "tomorrow" in UTC, so the daily view needs a
-- zone. The service area in every fixture is North Texas; change the zone
-- here (one line) if the crew moves — every view reads this function.
-- (STABLE, not immutable: \`at time zone\` reads the tz database.)
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
-- profiles in step with sign-ups (and email changes). \`set search_path\`
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

-- \`is_admin()\` is SECURITY DEFINER so it reads app_admins without the
-- caller's RLS in the way, and STABLE so the planner evaluates it once per
-- statement rather than once per row.
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.app_admins a where a.user_id = auth.uid());
$$;

-- ----------------------------------------------------------------------------
-- 2. The knocking tables
-- ----------------------------------------------------------------------------

-- Server-owned receipt time. This trigger touches \`synced_at\` ONLY — never
-- \`updated_at\`, which stays the client's edit time (see the header).
create or replace function public.touch_synced_at() returns trigger
language plpgsql as $$
begin new.synced_at = now(); return new; end $$;

-- A door-knocking route: when it ran, where it was aimed, the walked path,
-- and the numbers the app shows for it (\`sessionStats\` in knockOutcomes.ts),
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

-- One door. \`outcome\` is a KnockOutcome (lib/models/types.ts); \`history\` is
-- the door's earlier outcomes [{outcome, at, notes}] oldest first;
-- \`property_record\` is the Zillow SUBSET (no photo URLs, no agent).
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

-- A saved Knock Planner run. \`result\` is the whole KnockFinderResult (areas,
-- trip plan, brief, notes) — large, but the owner asked for all of it.
-- \`schedule\` (the days put on the calendar), \`storm_alert_id\` (the Storm
-- Watch alert that queued the plan) and \`exclusions\` (what the do-not-knock
-- list removed) are written when the plan carries them; \`mode\` is reserved
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

-- The plan's ranked areas, flattened from \`result.areas\` so SQL can compare
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
  -- expected finds over \`doors\` doors, and the 80 % floor
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
-- \`*_own_*\` policies are untouched; Postgres ORs select policies together.
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
--    Dropped and recreated (not \`or replace\`) so a re-run with changed
--    columns never fails on "cannot change name of view column".
-- ----------------------------------------------------------------------------

-- Every door knocked, with who knocked it and which plan it belonged to.
-- This is the map: \`select * from v_knock_doors\` → CSV → kepler.gl, or use
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
-- area centre since the plan was made. \`per_roof_p\` × doors knocked is the
-- expected number of claim-grade roofs among the doors actually knocked;
-- \`damage_confirmed\` (inspected + damage seen) is the closest observed
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
--    postgres role creates in \`public\`; these are explicit so the file does
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
-- as the signed-in user, so \`authenticated\` keeps EXECUTE (intentional: the
-- app may ask "am I an admin?"); \`anon\` and PUBLIC lose it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.is_admin() from public, anon;

-- Done. Verify with:
--   select table_name from information_schema.tables
--    where table_schema = 'public'
--      and (table_name like 'knock%' or table_name in ('profiles', 'app_admins', 'do_not_knock'));
--   select * from public.v_user_activity;
`;
