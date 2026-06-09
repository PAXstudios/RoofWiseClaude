// Two-way inspection sync against Supabase `public.inspections`.
//
// Change detection: instead of stamping updatedAt in each of the inspection
// store's many mutations, we subscribe to the store once and diff object
// identity. Any inspection whose reference changed gets marked dirty in
// inspectionSyncStore; removals get marked deleted. Pulled remote changes
// are applied behind a guard flag so they don't re-mark themselves dirty.
//
// The full Inspection is stored as a jsonb `payload` column. Photo and
// audio URIs inside the payload are device-local — they sync as data (for
// reporting + a second device's read access) but the binaries themselves
// don't transfer. That's the documented v1 behavior.

import { supabase } from '../supabase';
import { useInspectionStore } from '../stores/inspectionStore';
import { useInspectionSyncStore } from '../stores/inspectionSyncStore';
import { useAuthStore } from '../auth/authStore';
import type { Inspection } from '../models/types';

const TABLE = 'inspections';

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
    if (applyingRemote) {
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
      if (!nextIds.has(old.id)) sync.markDeleted(old.id);
    }
    prevInspections = next;
  });
}

export type InspectionSyncSummary = {
  pushed: number;
  pulled: number;
  deleted: number;
  error?: string;
};

export async function syncInspections(): Promise<InspectionSyncSummary> {
  const user = useAuthStore.getState().user;
  if (!user) {
    return { pushed: 0, pulled: 0, deleted: 0, error: 'Not signed in' };
  }

  const syncStore = useInspectionSyncStore.getState();
  let pushed = 0;
  let pulled = 0;
  let deleted = 0;

  // 1) Push remote deletes for locally-removed inspections
  const pendingDeletes = syncStore.deleted;
  if (pendingDeletes.length > 0) {
    const { error } = await supabase
      .from(TABLE)
      .delete()
      .eq('user_id', user.id)
      .in('id', pendingDeletes);
    if (error && !isMissingTable(error.message)) {
      return { pushed: 0, pulled: 0, deleted: 0, error: error.message };
    }
    if (!error) {
      useInspectionSyncStore.getState().clearDeleted(pendingDeletes);
      deleted = pendingDeletes.length;
    }
  }

  // 2) Push dirty inspections
  const dirty = useInspectionSyncStore.getState().dirty;
  const dirtyIds = Object.keys(dirty);
  if (dirtyIds.length > 0) {
    const all = useInspectionStore.getState().inspections;
    const rows = all
      .filter((i) => dirtyIds.includes(i.id))
      .map((i) => inspectionToRow(i, user.id, dirty[i.id]));
    if (rows.length > 0) {
      const { error } = await supabase.from(TABLE).upsert(rows, { onConflict: 'id' });
      if (error) {
        if (isMissingTable(error.message)) {
          return {
            pushed: 0, pulled: 0, deleted,
            error: 'Cloud sync not provisioned — run the SQL snippet in About.',
          };
        }
        return { pushed: 0, pulled: 0, deleted, error: error.message };
      }
      useInspectionSyncStore.getState().clearDirty(rows.map((r) => r.id));
      pushed = rows.length;
    }
  }

  // 3) Pull remote rows and merge (remote wins unless locally dirty)
  const { data, error } = await supabase
    .from(TABLE)
    .select('id, payload, updated_at, report_id')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(200);
  if (error) {
    if (isMissingTable(error.message)) {
      return { pushed, pulled: 0, deleted, error: 'Cloud sync not provisioned — run the SQL snippet in About.' };
    }
    return { pushed, pulled: 0, deleted, error: error.message };
  }

  if (data && data.length > 0) {
    const stillDirty = useInspectionSyncStore.getState().dirty;
    const local = useInspectionStore.getState().inspections;
    const localById = new Map(local.map((i) => [i.id, i]));
    const incoming: Inspection[] = [];
    let maxOrdinal = 0;

    for (const row of data) {
      const ordinal = parseOrdinal(String(row.report_id ?? ''));
      if (ordinal > maxOrdinal) maxOrdinal = ordinal;
      if (stillDirty[row.id]) continue; // local changes win; next push reconciles
      const remote = row.payload as Inspection | null;
      if (!remote || typeof remote !== 'object' || !remote.id) continue;
      const existing = localById.get(remote.id);
      if (!existing || JSON.stringify(existing) !== JSON.stringify(remote)) {
        incoming.push(remote);
        pulled++;
      }
    }

    if (incoming.length > 0 || maxOrdinal > 0) {
      applyingRemote = true;
      try {
        useInspectionStore.setState((s) => {
          const byId = new Map(s.inspections.map((i) => [i.id, i]));
          for (const ins of incoming) byId.set(ins.id, ins);
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
  }

  useInspectionSyncStore.getState().setLastSyncAt(new Date().toISOString());
  return { pushed, pulled, deleted };
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
    updated_at: dirtiedAt,
  };
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

alter table public.inspections enable row level security;

create policy "inspections_select_own" on public.inspections for select using (auth.uid() = user_id);
create policy "inspections_insert_own" on public.inspections for insert with check (auth.uid() = user_id);
create policy "inspections_update_own" on public.inspections for update using (auth.uid() = user_id);
create policy "inspections_delete_own" on public.inspections for delete using (auth.uid() = user_id);

create index if not exists inspections_user_id_updated_at_idx on public.inspections (user_id, updated_at desc);
`;
