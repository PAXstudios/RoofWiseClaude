import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Tracks which inspections have local changes that haven't been pushed to
// Supabase yet. Populated by the store watcher in inspectionSync.ts so the
// 16 inspection mutations don't each need to stamp sync state.

type State = {
  dirty: Record<string, string>;   // inspectionId → dirtiedAt ISO
  deleted: string[];               // ids removed locally, pending remote delete
  lastSyncAt: string | null;

  markDirty: (id: string) => void;
  markDeleted: (id: string) => void;
  clearDirty: (ids: string[]) => void;
  clearDeleted: (ids: string[]) => void;
  setLastSyncAt: (iso: string) => void;
};

export const useInspectionSyncStore = create<State>()(
  persist(
    (set) => ({
      dirty: {},
      deleted: [],
      lastSyncAt: null,

      markDirty: (id) =>
        set((s) => ({
          dirty: { ...s.dirty, [id]: new Date().toISOString() },
        })),

      markDeleted: (id) =>
        set((s) => {
          const { [id]: _dropped, ...rest } = s.dirty;
          return {
            dirty: rest,
            deleted: s.deleted.includes(id) ? s.deleted : [...s.deleted, id],
          };
        }),

      clearDirty: (ids) =>
        set((s) => {
          const dirty = { ...s.dirty };
          for (const id of ids) delete dirty[id];
          return { dirty };
        }),

      clearDeleted: (ids) =>
        set((s) => ({ deleted: s.deleted.filter((id) => !ids.includes(id)) })),

      setLastSyncAt: (iso) => set({ lastSyncAt: iso }),
    }),
    {
      name: 'roofwise.inspectionSync.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        dirty: s.dirty,
        deleted: s.deleted,
        lastSyncAt: s.lastSyncAt,
      }),
    },
  ),
);
