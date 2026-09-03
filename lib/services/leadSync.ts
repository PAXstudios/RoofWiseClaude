// Best-effort 2-way sync of leads with the Supabase `public.leads` table.
//
// Conflict rule: last EDITOR wins, decided on the client's `updatedAt` —
// the moment the roofer actually made the change — on BOTH sides:
//   push: a pending local lead is not sent over a remote row edited later
//         on another device; that row is taken instead.
//   pull: a remote row replaces the local lead only when its `updated_at`
//         is newer.
// The server must therefore keep the `updated_at` the client sends. The
// `leads_touch` trigger that used to rewrite it to now() on every UPDATE —
// which made this last SYNCER wins, however carefully the client compared —
// is dropped by supabase/migrations/20260903120000_drop_touch_updated_at.sql.
// Device clocks are the known limit of the rule; every offline-first LWW
// sync shares it.
//
// Gracefully degrades when the table doesn't exist (e.g. the user hasn't
// run the SQL migration yet).

import { supabase } from '../supabase';
import { useLeadStore } from '../stores/leadStore';
import { useAuthStore } from '../auth/authStore';
import type { Lead } from '../models/types';

export type LeadSyncSummary = {
  pushed: number;
  pulled: number;
  /** Local edits superseded by a newer remote edit (theirs won). */
  conflicts: number;
  error?: string;
};

const TABLE = 'leads';
const NOT_PROVISIONED = 'Cloud sync not provisioned — run the SQL snippet in About.';

/**
 * `inspection_id` arrives with migration 20260903120100_leads_inspection_id.
 * Until it is applied the upsert is retried without that column, so every
 * other field still syncs (the lead↔job link stays device-local meanwhile).
 */
let inspectionIdColumnMissing = false;

let inFlight: Promise<LeadSyncSummary> | null = null;

/** Re-entrant callers (foreground + pull-to-refresh) share one run. */
export function syncLeads(): Promise<LeadSyncSummary> {
  if (inFlight) return inFlight;
  inFlight = run().finally(() => {
    inFlight = null;
  });
  return inFlight;
}

async function run(): Promise<LeadSyncSummary> {
  const user = useAuthStore.getState().user;
  if (!user) {
    return { pushed: 0, pulled: 0, conflicts: 0, error: 'Not signed in' };
  }

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  // 1) Push local pending changes — but never over a newer remote edit.
  const pending = useLeadStore.getState().pending();
  if (pending.length > 0) {
    const { data: remoteRows, error: peekError } = await supabase
      .from(TABLE)
      .select('*')
      .eq('user_id', user.id)
      .in('id', pending.map((l) => l.id));
    if (peekError) {
      return {
        pushed: 0,
        pulled: 0,
        conflicts: 0,
        error: isMissingTable(peekError.message) ? NOT_PROVISIONED : peekError.message,
      };
    }
    const remoteById = new Map((remoteRows ?? []).map((r) => [String(r.id), r]));
    const toPush: Lead[] = [];
    for (const local of pending) {
      const remote = remoteById.get(local.id);
      if (remote && ts(remote.updated_at) > ts(local.updatedAt ?? local.createdAt)) {
        // Edited later on another device: that edit stands, ours is superseded.
        useLeadStore.getState().upsert({ ...rowToLead(remote), syncStatus: 'synced' });
        conflicts++;
        pulled++;
      } else {
        toPush.push(local);
      }
    }

    if (toPush.length > 0) {
      const { error } = await upsertRows(toPush.map((l) => leadToRow(l, user.id)));
      if (error) {
        if (isMissingTable(error.message)) {
          return { pushed: 0, pulled, conflicts, error: NOT_PROVISIONED };
        }
        return { pushed: 0, pulled, conflicts, error: error.message };
      }
      useLeadStore.getState().markSynced(toPush.map((l) => l.id));
      pushed = toPush.length;
    }
  }

  // 2) Pull remote rows (last 500) and merge by the client-stamped updated_at
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) {
    if (isMissingTable(error.message)) {
      return { pushed, pulled, conflicts, error: NOT_PROVISIONED };
    }
    return { pushed, pulled, conflicts, error: error.message };
  }

  if (data) {
    const upsert = useLeadStore.getState().upsert;
    const localById = new Map(useLeadStore.getState().leads.map((l) => [l.id, l]));
    for (const row of data) {
      const remote = rowToLead(row);
      const local = localById.get(remote.id);
      if (!local) {
        upsert(remote);
        pulled++;
      } else {
        const localTs = ts(local.updatedAt ?? local.createdAt);
        const remoteTs = ts(remote.updatedAt ?? remote.createdAt);
        if (remoteTs > localTs) {
          upsert({ ...remote, syncStatus: 'synced' });
          pulled++;
        } else if (remoteTs < localTs && local.syncStatus !== 'synced') {
          // Edited here since step 1 ran; the next push carries it.
          conflicts++;
        }
      }
    }
  }

  return { pushed, pulled, conflicts };
}

type LeadRow = ReturnType<typeof leadToRow>;

async function upsertRows(rows: LeadRow[]) {
  const strip = ({ inspection_id: _dropped, ...rest }: LeadRow) => rest;
  const res = await supabase
    .from(TABLE)
    .upsert(inspectionIdColumnMissing ? rows.map(strip) : rows, { onConflict: 'id' });
  if (res.error && !inspectionIdColumnMissing && /inspection_id/i.test(res.error.message)) {
    inspectionIdColumnMissing = true;
    return supabase.from(TABLE).upsert(rows.map(strip), { onConflict: 'id' });
  }
  return res;
}

function ts(iso: unknown): number {
  const t = typeof iso === 'string' ? new Date(iso).getTime() : NaN;
  return Number.isFinite(t) ? t : 0;
}

function leadToRow(l: Lead, userId: string) {
  return {
    id: l.id,
    user_id: userId,
    customer_name: l.customerName,
    customer_phone: l.customerPhone,
    customer_email: l.customerEmail,
    address: l.address,
    lat: l.lat,
    lng: l.lng,
    stage: l.stage,
    source: l.source,
    value: l.value,
    last_contact_at: l.lastContactAt,
    follow_up_at: l.followUpAt,
    last_storm_match: l.lastStormMatch,
    stage_changed_at: l.stageChangedAt,
    inspection_id: l.inspectionId ?? null,
    created_at: l.createdAt,
    // The client's edit time — the server keeps it as-is (see header).
    updated_at: l.updatedAt ?? l.createdAt,
  };
}

function rowToLead(row: Record<string, any>): Lead {
  return {
    id: String(row.id),
    customerName: String(row.customer_name ?? ''),
    customerPhone: row.customer_phone ?? undefined,
    customerEmail: row.customer_email ?? undefined,
    address: String(row.address ?? ''),
    lat: row.lat ?? undefined,
    lng: row.lng ?? undefined,
    stage: String(row.stage ?? 'new') as Lead['stage'],
    source: row.source ?? undefined,
    value: row.value ?? undefined,
    lastContactAt: row.last_contact_at ?? undefined,
    followUpAt: row.follow_up_at ?? undefined,
    lastStormMatch: (row.last_storm_match ?? undefined) as Lead['lastStormMatch'],
    stageChangedAt: row.stage_changed_at ?? undefined,
    inspectionId: row.inspection_id ?? undefined,
    createdAt: String(row.created_at ?? new Date().toISOString()),
    updatedAt: row.updated_at ?? undefined,
    syncStatus: 'synced',
  };
}

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('relation');
}

export const LEADS_SQL = `-- RoofWise leads sync — paste into Supabase SQL editor
create table if not exists public.leads (
  id text primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  customer_name text not null,
  customer_phone text,
  customer_email text,
  address text not null,
  lat double precision,
  lng double precision,
  stage text not null,
  source text,
  value numeric,
  last_contact_at timestamptz,
  follow_up_at timestamptz,
  last_storm_match jsonb,
  stage_changed_at timestamptz,
  inspection_id text,
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

-- Safe to re-run on an existing install (columns added after the first release).
alter table public.leads add column if not exists last_storm_match jsonb;
alter table public.leads add column if not exists stage_changed_at timestamptz;
alter table public.leads add column if not exists inspection_id text;

-- updated_at is the CLIENT's edit time and must not be rewritten server-side
-- (conflicts resolve on it). Drop the trigger if an older schema.sql added it.
drop trigger if exists leads_touch on public.leads;

alter table public.leads enable row level security;

create policy "leads_select_own" on public.leads for select using (auth.uid() = user_id);
create policy "leads_insert_own" on public.leads for insert with check (auth.uid() = user_id);
create policy "leads_update_own" on public.leads for update using (auth.uid() = user_id);
create policy "leads_delete_own" on public.leads for delete using (auth.uid() = user_id);

create index if not exists leads_user_id_updated_at_idx on public.leads (user_id, updated_at desc);
`;
