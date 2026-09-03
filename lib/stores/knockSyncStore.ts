// Bookkeeping for the knocking-data sync (lib/services/knockSync.ts).
//
// What it remembers, and why:
//   pushed          per-row content hash + the client time the content was last
//                   seen to change. A row whose hash matches is not re-sent —
//                   sessions carry a ≤500-point track and plans carry the whole
//                   KnockFinderResult, so "unchanged → skip" is what keeps the
//                   5-minute cadence cheap. `parent` (a knock's session id) lets
//                   the sync notice a knock that vanished from its session.
//   deletedPlanIds  plans removed on this device that the server must soft-
//   deletedDnkIds   delete (and must never hand back on the next pull). The
//                   stores that own plans / do-not-knock entries are not ours
//                   to edit, so knockSync.ts subscribes to them and diffs ids.
//   lastRun*        what Settings → Backup shows.
//
// Nothing here is the data itself — that stays in knockSessionStore,
// knockFinderStore and doNotKnockStore. Wiping this store only costs one
// full re-push (the server upserts, so nothing duplicates).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PushedEntry = {
  /** Content hash of the row as last sent (updated_at excluded). */
  hash: string;
  /** Client time the content was last seen to change — the row's `updated_at`. */
  at: string;
  /** Owning row (a knock's session id) so orphans can be soft-deleted. */
  parent?: string;
};

export type KnockSyncStatus = 'ok' | 'needs_schema' | 'error' | 'skipped';

export type KnockSyncRun = {
  at: string;
  status: KnockSyncStatus;
  pushed: number;
  pulled: number;
  error: string | null;
};

type State = {
  pushed: Record<string, PushedEntry>;
  deletedPlanIds: string[];
  deletedDnkIds: string[];
  lastRun: KnockSyncRun | null;
  /** Rows pushed over the store's lifetime — the "rows synced" figure. */
  totalPushed: number;

  markPushed: (entries: Record<string, PushedEntry>) => void;
  forget: (keys: string[]) => void;
  addDeletedPlans: (ids: string[]) => void;
  clearDeletedPlans: (ids: string[]) => void;
  addDeletedDnk: (ids: string[]) => void;
  clearDeletedDnk: (ids: string[]) => void;
  recordRun: (run: KnockSyncRun) => void;
  /** Forget every hash so the next sync re-sends everything (Settings → "Re-send all"). */
  reset: () => void;
};

function union(list: string[], ids: string[]): string[] {
  const set = new Set(list);
  for (const id of ids) set.add(id);
  return Array.from(set);
}

export const useKnockSyncStore = create<State>()(
  persist(
    (set) => ({
      pushed: {},
      deletedPlanIds: [],
      deletedDnkIds: [],
      lastRun: null,
      totalPushed: 0,

      markPushed: (entries) =>
        set((s) => ({
          pushed: { ...s.pushed, ...entries },
          totalPushed: s.totalPushed + Object.keys(entries).length,
        })),

      forget: (keys) =>
        set((s) => {
          if (keys.length === 0) return s;
          const pushed = { ...s.pushed };
          for (const k of keys) delete pushed[k];
          return { pushed };
        }),

      addDeletedPlans: (ids) => set((s) => ({ deletedPlanIds: union(s.deletedPlanIds, ids) })),
      clearDeletedPlans: (ids) =>
        set((s) => ({ deletedPlanIds: s.deletedPlanIds.filter((id) => !ids.includes(id)) })),
      addDeletedDnk: (ids) => set((s) => ({ deletedDnkIds: union(s.deletedDnkIds, ids) })),
      clearDeletedDnk: (ids) =>
        set((s) => ({ deletedDnkIds: s.deletedDnkIds.filter((id) => !ids.includes(id)) })),

      recordRun: (run) => set({ lastRun: run }),

      reset: () => set({ pushed: {}, lastRun: null, totalPushed: 0 }),
    }),
    {
      name: 'roofwise.knockSync.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        pushed: s.pushed,
        deletedPlanIds: s.deletedPlanIds,
        deletedDnkIds: s.deletedDnkIds,
        lastRun: s.lastRun,
        totalPushed: s.totalPushed,
      }),
    },
  ),
);
