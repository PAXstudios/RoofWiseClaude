// Saved storm areas — pins the roofer picked off the Storm Tracer (select
// mode, one or many) and kept for later: "save that pin/location and then
// begin my door-knocking route with those saved areas as part of my door
// knocking" (owner). Pure per-viewer memory (Drift #5: never seeded, the
// list starts empty and only ever holds what a roofer saved), persisted so
// it survives a restart and feeds the map's own "Saved" layer plus a
// "Start route from N saved areas" action.
//
// Geometry is the same house-scale proximity check the do-not-knock list
// uses (lib/services/doNotKnock.ts) — two saved pins within ~150 m are the
// same spot on the ground, not two areas to canvass twice.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { distanceMeters } from '@/lib/services/doNotKnock';

export type SavedAreaSource = 'storm_tracer' | 'manual';

export type SavedArea = {
  id: string;
  lat: number;
  lng: number;
  /** What to call it — the storm's town, or a hand-picked label. */
  label: string;
  /** Canvass radius to draw and route with, in miles. */
  radiusMiles: number;
  savedAt: string; // ISO
  source: SavedAreaSource;
  note?: string;
  /** Present when this came off a real storm report (Storm Tracer select). */
  storm?: {
    date?: string; // ISO — the report's occurredAt
    hailInches?: number;
    windMph?: number;
    town?: string;
  };
};

/** Everything the caller supplies; the store mints the id and timestamp. */
export type NewSavedArea = Omit<SavedArea, 'id' | 'savedAt'>;

/**
 * Two saves this close on the ground are one area. Matches the do-not-knock
 * house radius's order of magnitude, wide enough that a re-tap of roughly
 * the same storm pin (GPS jitter, a slightly different report in the same
 * cluster) still dedupes.
 */
export const SAVED_AREA_DEDUPE_METERS = 150;

let counter = 0;
function newId(): string {
  return `sa_${Date.now()}_${counter++}`;
}

function isNear(a: { lat: number; lng: number }, b: { lat: number; lng: number }): boolean {
  return distanceMeters(a.lat, a.lng, b.lat, b.lng) <= SAVED_AREA_DEDUPE_METERS;
}

type SavedAreaState = {
  areas: SavedArea[];
  /** Adds one area unless something within ~150 m is already saved (returns
   *  null then — the caller should treat that as "already have this one"). */
  add: (input: NewSavedArea) => SavedArea | null;
  /** Adds many, deduping against the existing list AND against each other in
   *  the same batch (a multi-select of neighbouring pins collapses to one
   *  area, not one per pin). Returns only the areas actually added. */
  addMany: (inputs: NewSavedArea[]) => SavedArea[];
  remove: (id: string) => void;
  clear: () => void;
  /** Is something already saved within the dedupe radius of this point? */
  has: (lat: number, lng: number) => boolean;
};

export const useSavedAreaStore = create<SavedAreaState>()(
  persist(
    (set, get) => ({
      areas: [],

      add: (input) => {
        const existing = get().areas;
        if (existing.some((a) => isNear(a, input))) return null;
        const area: SavedArea = { ...input, id: newId(), savedAt: new Date().toISOString() };
        set({ areas: [area, ...existing] });
        return area;
      },

      addMany: (inputs) => {
        const added: SavedArea[] = [];
        set((s) => {
          let areas = s.areas;
          for (const input of inputs) {
            if (areas.some((a) => isNear(a, input))) continue;
            const area: SavedArea = { ...input, id: newId(), savedAt: new Date().toISOString() };
            areas = [area, ...areas];
            added.push(area);
          }
          return { areas };
        });
        return added;
      },

      remove: (id) => set((s) => ({ areas: s.areas.filter((a) => a.id !== id) })),

      clear: () => set({ areas: [] }),

      has: (lat, lng) => get().areas.some((a) => isNear(a, { lat, lng })),
    }),
    {
      name: 'roofwise.savedAreas.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ areas: s.areas }),
    },
  ),
);

/** Every saved area, newest first — the map's "Saved" layer reads this. */
export function useSavedAreas(): SavedArea[] {
  return useSavedAreaStore((s) => s.areas);
}
