// Best-effort 2-way sync of leads with the Supabase `public.leads` table.
// Last-write-wins by updated_at. Gracefully degrades when the table
// doesn't exist (e.g. user hasn't run the SQL migration yet).

import { supabase } from '../supabase';
import { useLeadStore } from '../stores/leadStore';
import { useAuthStore } from '../auth/authStore';
import type { Lead } from '../models/types';

export type LeadSyncSummary = {
  pushed: number;
  pulled: number;
  conflicts: number;
  error?: string;
};

const TABLE = 'leads';

export async function syncLeads(): Promise<LeadSyncSummary> {
  const user = useAuthStore.getState().user;
  if (!user) {
    return { pushed: 0, pulled: 0, conflicts: 0, error: 'Not signed in' };
  }

  let pushed = 0;
  let pulled = 0;
  let conflicts = 0;

  // 1) Push local pending changes
  const pending = useLeadStore.getState().pending();
  if (pending.length > 0) {
    const payload = pending.map((l) => leadToRow(l, user.id));
    const { error } = await supabase.from(TABLE).upsert(payload, { onConflict: 'id' });
    if (error) {
      if (isMissingTable(error.message)) {
        return {
          pushed: 0,
          pulled: 0,
          conflicts: 0,
          error: 'Cloud sync not provisioned — run the SQL snippet in About.',
        };
      }
      return { pushed: 0, pulled: 0, conflicts: 0, error: error.message };
    }
    useLeadStore.getState().markSynced(pending.map((l) => l.id));
    pushed = pending.length;
  }

  // 2) Pull remote rows (last 500) and merge by updated_at
  const { data, error } = await supabase
    .from(TABLE)
    .select('*')
    .eq('user_id', user.id)
    .order('updated_at', { ascending: false })
    .limit(500);
  if (error) {
    if (isMissingTable(error.message)) {
      return { pushed, pulled: 0, conflicts: 0, error: 'Cloud sync not provisioned — run the SQL snippet in About.' };
    }
    return { pushed, pulled: 0, conflicts: 0, error: error.message };
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
        const localTs = new Date(local.updatedAt ?? local.createdAt).getTime();
        const remoteTs = new Date(remote.updatedAt ?? remote.createdAt).getTime();
        if (remoteTs > localTs) {
          upsert({ ...remote, syncStatus: 'synced' });
          pulled++;
        } else if (remoteTs < localTs && local.syncStatus !== 'synced') {
          conflicts++;
        }
      }
    }
  }

  return { pushed, pulled, conflicts };
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
    created_at: l.createdAt,
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
  created_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.leads enable row level security;

create policy "leads_select_own" on public.leads for select using (auth.uid() = user_id);
create policy "leads_insert_own" on public.leads for insert with check (auth.uid() = user_id);
create policy "leads_update_own" on public.leads for update using (auth.uid() = user_id);
create policy "leads_delete_own" on public.leads for delete using (auth.uid() = user_id);

create index if not exists leads_user_id_updated_at_idx on public.leads (user_id, updated_at desc);
`;
