import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { createSyncPersistence } from '../services/syncPersistence';

// Tracks which inspections have local changes that haven't been pushed to
// Supabase yet. Populated by the store watcher in inspectionSync.ts so the
// 16 inspection mutations don't each need to stamp sync state.

type State = {
  dirty: Record<string, string>;   // inspectionId → dirtiedAt ISO
  /** Retained after acknowledgement/deletion; timestamps are not ack tokens. */
  revisions: Record<string, number>;
  /** Local suppression survives a stale pull after the remote DELETE succeeds. */
  tombstones: Record<string, number>;
  deleted: string[];               // ids removed locally, pending remote delete
  lastSyncAt: string | null;

  markDirty: (id: string) => void;
  markDeleted: (id: string) => void;
  clearDirty: (revisions: Record<string, number>) => void;
  clearDeleted: (revisions: Record<string, number>) => void;
  setLastSyncAt: (iso: string) => void;
};

type Persisted = Pick<State, 'dirty' | 'revisions' | 'tombstones' | 'deleted' | 'lastSyncAt'>;
const persistence = createSyncPersistence();
const persistedSlice = (s: State): Persisted => ({
  dirty: s.dirty, revisions: s.revisions, tombstones: s.tombstones, deleted: s.deleted, lastSyncAt: s.lastSyncAt,
});

function mergeHydration(persisted: unknown, current: State): State {
  const raw = (persisted ?? {}) as Partial<Persisted>;
  const revisions = { ...raw.revisions };
  const dirty = { ...raw.dirty };
  const deleted = new Set(raw.deleted ?? []);
  for (const id of [...Object.keys(dirty), ...deleted]) revisions[id] ??= 0;
  const tombstones = { ...Object.fromEntries([...deleted].map((id) => [id, 1])), ...raw.tombstones };
  // A live revision is a mutation/acknowledgement authority, including changes
  // made before the first hydration microtask. Never let a stale read reset it.
  for (const [id, revision] of Object.entries(current.revisions)) {
    revisions[id] = (revisions[id] ?? 0) > revision ? revisions[id] + 1 : revision;
    if (current.dirty[id]) dirty[id] = current.dirty[id]; else delete dirty[id];
    if (current.deleted.includes(id)) deleted.add(id); else deleted.delete(id);
    if (current.tombstones[id]) tombstones[id] = Math.max(1, revisions[id]); else delete tombstones[id];
  }
  return { ...current, dirty, revisions, tombstones, deleted: [...deleted], lastSyncAt: current.lastSyncAt ?? raw.lastSyncAt ?? null };
}

export const useInspectionSyncStore = create<State>()(
  persist(
    (set) => ({
      dirty: {},
      revisions: {},
      tombstones: {},
      deleted: [],
      lastSyncAt: null,

      markDirty: (id) =>
        set((s) => {
          const { [id]: _restored, ...tombstones } = s.tombstones;
          return {
            dirty: { ...s.dirty, [id]: new Date().toISOString() },
            revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 },
            deleted: s.deleted.filter((deletedId) => deletedId !== id),
            tombstones,
          };
        }),

      markDeleted: (id) =>
        set((s) => {
          const { [id]: _dropped, ...rest } = s.dirty;
          return {
            dirty: rest,
            revisions: { ...s.revisions, [id]: (s.revisions[id] ?? 0) + 1 },
            tombstones: { ...s.tombstones, [id]: (s.revisions[id] ?? 0) + 1 },
            deleted: s.deleted.includes(id) ? s.deleted : [...s.deleted, id],
          };
        }),

      clearDirty: (revisions) =>
        set((s) => {
          const dirty = { ...s.dirty };
          for (const [id, revision] of Object.entries(revisions)) {
            if ((s.revisions[id] ?? 0) === revision) delete dirty[id];
          }
          return { dirty };
        }),

      clearDeleted: (revisions) =>
        set((s) => ({ deleted: s.deleted.filter((id) => revisions[id] !== (s.revisions[id] ?? 0)) })),

      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),
    }),
    {
      name: 'roofwise.inspectionSync.v1',
      storage: createJSONStorage(() => persistence.storage),
      version: 1,
      skipHydration: true,
      merge: mergeHydration,
      migrate: (persisted) => {
        const raw = (persisted ?? {}) as Partial<State>;
        const deleted = raw.deleted ?? [];
        return {
          ...raw,
          revisions: raw.revisions ?? {},
          tombstones: { ...Object.fromEntries(deleted.map((id) => [id, 1])), ...raw.tombstones },
        };
      },
      partialize: persistedSlice,
    },
  ),
);

const hydrate = useInspectionSyncStore.persist.rehydrate;
let hydrationTail: Promise<void> = Promise.resolve();
useInspectionSyncStore.persist.rehydrate = () => {
  const run = hydrationTail.catch(() => {}).then(async () => {
    persistence.beginHydration();
    try {
      await hydrate();
      if (!useInspectionSyncStore.persist.hasHydrated()) throw new Error('Local inspection sync state could not be loaded. Retry.');
      await persistence.finishHydration('roofwise.inspectionSync.v1', JSON.stringify({ state: persistedSlice(useInspectionSyncStore.getState()), version: 1 }));
    } catch (error) { persistence.failHydration(error); throw error; }
  });
  hydrationTail = run;
  return run;
};

export async function waitForInspectionSyncHydration(): Promise<void> {
  while (true) {
    const observed = hydrationTail;
    try { await observed; }
    catch { await (observed === hydrationTail ? useInspectionSyncStore.persist.rehydrate() : hydrationTail); continue; }
    if (observed === hydrationTail && useInspectionSyncStore.persist.hasHydrated()) return;
  }
}
export function inspectionSyncHydrationState() {
  return { promise: hydrationTail, hydrated: useInspectionSyncStore.persist.hasHydrated() };
}
export async function flushInspectionSyncPersistence(): Promise<void> {
  await persistence.storage.setItem('roofwise.inspectionSync.v1', JSON.stringify({ state: persistedSlice(useInspectionSyncStore.getState()), version: 1 }));
  await persistence.flush();
}
void Promise.resolve(useInspectionSyncStore.persist.rehydrate()).catch(() => {});
