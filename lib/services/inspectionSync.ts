// Two-way inspection sync against Supabase `public.inspections`.
//
// Change detection: instead of stamping updatedAt in each of the inspection
// store's many mutations, we subscribe to the store once and diff object
// identity. Any inspection whose reference changed gets marked dirty in
// inspectionSyncStore (with the CLIENT time it was dirtied); removals get
// marked deleted. Pulled remote changes are applied behind a guard flag so
// they don't re-mark themselves dirty.
//
// Conflict rule: last EDITOR wins, decided on client timestamps. A dirty
// inspection is pushed with `updated_at` = the time it was dirtied here; it
// is NOT pushed over a remote row whose `updated_at` is later — that row was
// edited more recently on another device, so it is taken instead and the
// local edit dropped. The server must keep the `updated_at` it is sent: the
// `inspections_touch` trigger that rewrote it to now() (making this last
// SYNCER wins) is dropped by
// supabase/migrations/20260903120000_drop_touch_updated_at.sql. Device
// clocks are the known limit of the rule.
//
// The full Inspection is stored as a jsonb `payload` column. Photo and
// audio URIs inside the payload are device-local — they sync as data (for
// reporting + a second device's read access); photoSync.ts uploads the
// binaries separately and writes the public URLs into the payload.

import { supabase } from '../supabase';
import { inspectionHydrationState, isApplyingInspectionHydration, normalizeInspection, useInspectionStore, waitForInspectionHydration } from '../stores/inspectionStore';
import { inspectionSyncHydrationState, useInspectionSyncStore, waitForInspectionSyncHydration } from '../stores/inspectionSyncStore';
import { useAuthStore } from '../auth/authStore';
import type { Inspection } from '../models/types';

const TABLE = 'inspections';
const NOT_PROVISIONED = 'Cloud sync not provisioned — run the SQL snippet in About.';

let watcherStarted = false;
let applyingRemote = false;
let prevInspections: Inspection[] | null = null;

export function startInspectionWatcher(): void {
  if (watcherStarted) return;
  watcherStarted = true;
  prevInspections = useInspectionStore.getState().inspections;

  useInspectionStore.subscribe((state) => {
    const next = state.inspections;
    if (next === prevInspections) return;
    if (applyingRemote || isApplyingInspectionHydration()) {
      prevInspections = next;
      return;
    }
    const sync = useInspectionSyncStore.getState();
    const prevById = new Map((prevInspections ?? []).map((i) => [i.id, i]));
    for (const ins of next) {
      const old = prevById.get(ins.id);
      if (!old || old !== ins) sync.markDirty(ins.id);
    }
    const nextIds = new Set(next.map((i) => i.id));
    for (const old of prevInspections ?? []) {
      if (!nextIds.has(old.id) && !sync.deleted.includes(old.id)) sync.markDeleted(old.id);
    }
    prevInspections = next;
  });
}

// Subscribe before the initial hydration microtasks run. Hydration application
// is excluded above, but user edits made while either read is held are tracked.
startInspectionWatcher();

export type InspectionSyncSummary = {
  pushed: number;
  pulled: number;
  deleted: number;
  /** Local edits superseded by a newer remote edit (theirs won). */
  conflicts: number;
  error?: string;
};

let inFlight: Promise<InspectionSyncSummary> | null = null;

/** Re-entrant callers (foreground, Settings, photoSync's follow-up) share one run. */
export function syncInspections(): Promise<InspectionSyncSummary> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<InspectionSyncSummary> {
  try {
    while (true) {
      const business = inspectionHydrationState();
      const metadata = inspectionSyncHydrationState();
      await Promise.all([waitForInspectionHydration(), waitForInspectionSyncHydration()]);
      const nextBusiness = inspectionHydrationState();
      const nextMetadata = inspectionSyncHydrationState();
      if (business.promise === nextBusiness.promise && metadata.promise === nextMetadata.promise
        && nextBusiness.hydrated && nextMetadata.hydrated) break;
    }
  } catch (error) {
    return { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, error: error instanceof Error ? error.message : 'Local inspections unavailable. Retry.' };
  }
  const user = useAuthStore.getState().user;
  if (!user) {
    return { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, error: 'Not signed in' };
  }

  const syncStore = useInspectionSyncStore.getState();
  let pushed = 0;
  let pulled = 0;
  let deleted = 0;
  let conflicts = 0;

  // 1) Push remote deletes for locally-removed inspections
  const pendingDeletes = syncStore.deleted;
  const deleteRevisions = Object.fromEntries(pendingDeletes.map((id) => [id, syncStore.revisions[id] ?? 0]));
  if (pendingDeletes.length > 0) {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('user_id', user.id)
      .in('id', pendingDeletes);
    if (error && !isMissingTable(error.message)) {
      return { pushed: 0, pulled: 0, deleted: 0, conflicts: 0, error: error.message };
    }
    if (!error) {
      useInspectionSyncStore.getState().clearDeleted(deleteRevisions);
      deleted = pendingDeletes.length;
    }
  }

  // 2) Push dirty inspections — unless the same row was edited LATER on
  //    another device, in which case that edit wins and ours is dropped.
  const snapshot = useInspectionSyncStore.getState();
  const dirty = snapshot.dirty;
  const dirtyIds = Object.keys(dirty);
  // Capture payload, edit time and local acknowledgement revision together,
  // before the first network boundary. A later edit belongs to the next run.
  const pending = useInspectionStore.getState().inspections
    .filter((i) => dirtyIds.includes(i.id))
    .map((i) => ({ row: inspectionToRow(i, user.id, dirty[i.id]), revision: snapshot.revisions[i.id] ?? 0 }));
  const unchanged = (id: string, revision: number) => {
    const current = useInspectionSyncStore.getState();
    return (current.revisions[id] ?? 0) === revision
      && !current.tombstones[id] && !current.deleted.includes(id);
  };
  if (dirtyIds.length > 0) {
    const { data: remoteRows, error: peekError } = await supabase
      .from(TABLE)
      .select('id, payload, updated_at')
      .eq('user_id', user.id)
      .in('id', dirtyIds);
    if (peekError) {
      return {
        pushed: 0, pulled: 0, deleted, conflicts: 0,
        error: isMissingTable(peekError.message) ? NOT_PROVISIONED : peekError.message,
      };
    }

    const superseded: Inspection[] = [];
    for (const row of remoteRows ?? []) {
      const id = String(row.id);
      const captured = pending.find((item) => item.row.id === id);
      if (!captured || !unchanged(id, captured.revision)) continue;
      if (ts(row.updated_at) <= ts(dirty[id])) continue;
      const remote = row.payload as Inspection | null;
      if (remote && typeof remote === 'object' && remote.id === id) superseded.push(remote);
    }
    if (superseded.length > 0) {
      applyRemote(superseded, 0);
      useInspectionSyncStore.getState().clearDirty(Object.fromEntries(
        superseded.map((i) => [i.id, snapshot.revisions[i.id] ?? 0]),
      ));
      conflicts = superseded.length;
      pulled += superseded.length;
    }

    const supersededIds = new Set(superseded.map((i) => i.id));
    const toPush = pending.filter(({ row, revision }) => !supersededIds.has(row.id) && unchanged(row.id, revision));
    const rows = toPush.map(({ row }) => row);
    if (rows.length > 0) {
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (error) {
        if (isMissingTable(error.message)) {
          return { pushed: 0, pulled, deleted, conflicts, error: NOT_PROVISIONED };
        }
        return { pushed: 0, pulled, deleted, conflicts, error: error.message };
      }
      useInspectionSyncStore.getState().clearDirty(Object.fromEntries(
        toPush.map(({ row, revision }) => [row.id, revision]),
      ));
      pushed = rows.length;
    }
  }

  // 3) Pull remote rows and merge. A row that is still dirty here has an
  //    unpushed edit (it became dirty after step 2 peeked) and is left for
  //    the next push to reconcile; everything else has nothing local pending,
  //    so the remote row — stamped by whichever device edited it last — is
  //    the truth.
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, payload, updated_at, report_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error.message)) {
      return { pushed, pulled, deleted, conflicts, error: NOT_PROVISIONED };
    }
    return { pushed, pulled, deleted, conflicts, error: error.message };
  }

  if (data && data.length > 0) {
    const current = useInspectionSyncStore.getState();
    const local = useInspectionStore.getState().inspections;
    const localById = new Map(local.map((i) => [i.id, i]));
    const incoming: Inspection[] = [];
    let maxOrdinal = 0;

    for (const row of data) {
      const ordinal = parseOrdinal(String(row.report_id ?? ''));
      if (ordinal > maxOrdinal) maxOrdinal = ordinal;
      if (current.dirty[row.id] || current.tombstones[row.id] || current.deleted.includes(row.id)) continue;
      const remote = row.payload as Inspection | null;
      if (!remote || typeof remote !== 'object' || remote.id !== row.id) continue;
      const existing = localById.get(remote.id);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(remote)) {
        incoming.push(remote);
        pulled++;
      }
    }

    if (incoming.length > 0 || maxOrdinal > 0) applyRemote(incoming, maxOrdinal);
  }

  useInspectionSyncStore.getState().setLastSyncAt(new Date().toISOString());
  return { pushed, pulled, deleted, conflicts };
}

/** Write remote payloads into the store without re-marking them dirty. */
function applyRemote(incoming: Inspection[], maxOrdinal: number): void {
  applyingRemote = true;
  try {
    useInspectionStore.setState((s) => {
      const byId = new Map(s.inspections.map((i) => [i.id, i]));
      for (const ins of incoming) byId.set(ins.id, normalizeInspection(ins as unknown as Record<string, unknown>, byId.get(ins.id)));
      const merged = Array.from(byId.values()).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      );
      return {
        inspections: merged,
        nextOrdinal: Math.max(s.nextOrdinal, maxOrdinal + 1),
      };
    });
  } finally {
    applyingRemote = false;
  }
}

function inspectionToRow(i: Inspection, userId: string, dirtiedAt: string) {
  return {
    id: i.id,
    user_id: userId,
    report_id: i.reportId,
    customer_name: i.customerName,
    address: i.address,
    status: i.status,
    payload: i,
    created_at: i.createdAt,
    // The client's edit time — the server keeps it as-is (see header).
    updated_at: dirtiedAt,
  };
}

function ts(iso: unknown): number {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function parseOrdinal(reportId: string): number {
  const m = reportId.match(/-(\d{4})$/);
  return m ? parseInt(m[1], 10) : 0;
}

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('relation');
}

export const INSPECTIONS_SQL = `-- RoofWise inspections sync — paste into Supabase SQL editor
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

-- updated_at is the CLIENT's edit time and must not be rewritten server-side
-- (conflicts resolve on it). Drop the trigger if an older schema.sql added it.
drop trigger if exists inspections_touch on public.inspections;

alter table public.inspections enable row level security;

create policy "inspections_select_own" on public.inspections for select using (auth.uid() = user_id);
create policy "inspections_insert_own" on public.inspections for insert with check (auth.uid() = user_id);
create policy "inspections_update_own" on public.inspections for update using (auth.uid() = user_id);
create policy "inspections_delete_own" on public.inspections for delete using (auth.uid() = user_id);

create index if not exists inspections_user_id_updated_at_idx on public.inspections (user_id, updated_at desc);
`;
