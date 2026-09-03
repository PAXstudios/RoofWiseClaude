// Do-not-knock list — homes and zones the roofer must never canvass.
//
// Fed by hand (the /do-not-knock screen), by the "Do not knock" pin outcome
// (saveKnock), and by pasted HOA / city no-solicit lists. Read by the knock
// planner (zones down-weight or drop an area), Knock mode (a pin on a
// blocked door warns before it saves; the layer draws the zones), and the
// cloud sync. Entries are never silently deleted — `remove` is the roofer's
// explicit act, behind a confirm sheet on the screen.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DoNotKnockEntry, DoNotKnockKind, DoNotKnockSource } from '../models/types';
import { blockedBy, HOME_RADIUS_METERS } from '../services/doNotKnock';

let counter = 0;
function newId(): string {
  return `dnk_${Date.now()}_${counter++}`;
}

export type DoNotKnockInput = {
  kind: DoNotKnockKind;
  label: string;
  lat?: number;
  lng?: number;
  radiusMeters?: number;
  polygon?: { lat: number; lng: number }[];
  address?: string;
  source: DoNotKnockSource;
  note?: string;
  knockId?: string;
};

type DoNotKnockState = {
  entries: DoNotKnockEntry[];
  /** Add one entry. A home within a house-width of an existing home is that home (updated, not duplicated). */
  add: (input: DoNotKnockInput) => DoNotKnockEntry;
  addMany: (inputs: DoNotKnockInput[]) => DoNotKnockEntry[];
  update: (id: string, patch: Partial<Omit<DoNotKnockEntry, 'id' | 'createdAt'>>) => void;
  remove: (id: string) => void;
  /** The entry that blocks this point, or null. */
  blockedAt: (lat: number, lng: number) => DoNotKnockEntry | null;
};

export const useDoNotKnockStore = create<DoNotKnockState>()(
  persist(
    (set, get) => ({
      entries: [],

      add: (input) => {
        const now = new Date().toISOString();
        if (input.kind === 'home' && input.lat != null && input.lng != null) {
          const existing = get().entries.find(
            (e) => e.kind === 'home' && blockedBy([e], input.lat as number, input.lng as number),
          );
          if (existing) {
            const merged: DoNotKnockEntry = {
              ...existing,
              label: input.label || existing.label,
              address: input.address ?? existing.address,
              note: input.note ?? existing.note,
              knockId: input.knockId ?? existing.knockId,
              updatedAt: now,
            };
            set({ entries: get().entries.map((e) => (e.id === existing.id ? merged : e)) });
            return merged;
          }
        }
        const entry: DoNotKnockEntry = {
          id: newId(),
          ...input,
          radiusMeters: input.radiusMeters ?? (input.kind === 'home' ? HOME_RADIUS_METERS : undefined),
          createdAt: now,
          updatedAt: now,
        };
        set({ entries: [entry, ...get().entries] });
        return entry;
      },

      addMany: (inputs) => inputs.map((i) => get().add(i)),

      update: (id, patch) =>
        set({
          entries: get().entries.map((e) =>
            e.id === id ? { ...e, ...patch, updatedAt: new Date().toISOString() } : e,
          ),
        }),

      remove: (id) => set({ entries: get().entries.filter((e) => e.id !== id) }),

      blockedAt: (lat, lng) => blockedBy(get().entries, lat, lng),
    }),
    {
      name: 'roofwise.doNotKnock.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
    },
  ),
);
