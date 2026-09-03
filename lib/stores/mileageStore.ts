import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MileageTrip } from '../models/types';
import { acceptSample, haversineMiles } from '../services/knockTrip';

let counter = 0;
function newId(): string {
  return `trip_${Date.now()}_${counter++}`;
}

export type MileageSample = { lat: number; lng: number; ts: number };

export type ActiveTrip = {
  id: string;
  startedAt: string;
  startLat: number;
  startLng: number;
  startAddress?: string;
  purpose?: string;
  samples: MileageSample[];
  /**
   * Miles accumulated over the accepted samples so far — the live figure the
   * door-knocking stats bar reads every fix without re-summing the track.
   * Absent on a trip persisted before this existed; `liveMiles()` re-sums.
   */
  miles?: number;
};

type MileageStoreState = {
  active: ActiveTrip | null;
  trips: MileageTrip[];

  start: (input: { lat: number; lng: number; address?: string; purpose?: string }) => ActiveTrip;
  /**
   * Append a fix. Filtered the same way the knock track is (≥10 m of
   * movement, horizontal accuracy ≤50 m) so a phone sitting at a door never
   * walks distance into the log. `accuracy` is optional for older callers.
   */
  recordSample: (sample: { lat: number; lng: number; accuracy?: number | null }) => void;
  stop: (input: { lat: number; lng: number; address?: string }) => MileageTrip | null;
  remove: (id: string) => void;
  totalMilesYTD: () => number;
  /** Miles on the active trip right now (0 when none). */
  liveMiles: () => number;
};

/** Raw samples kept on the active trip; a long day is thinned, never dropped. */
const MAX_ACTIVE_SAMPLES = 4000;

export const useMileageStore = create<MileageStoreState>()(
  persist(
    (set, get) => ({
      active: null,
      trips: [],

      start: (input) => {
        const trip: ActiveTrip = {
          id: newId(),
          startedAt: new Date().toISOString(),
          startLat: input.lat,
          startLng: input.lng,
          startAddress: input.address,
          purpose: input.purpose,
          samples: [{ lat: input.lat, lng: input.lng, ts: Date.now() }],
          miles: 0,
        };
        set({ active: trip });
        return trip;
      },

      recordSample: (sample) => {
        const active = get().active;
        if (!active) return;
        const last = active.samples[active.samples.length - 1];
        if (!acceptSample(last, sample)) return;
        const leg = last ? haversineMiles({ lat: last.lat, lng: last.lng }, sample) : 0;
        let samples = [...active.samples, { lat: sample.lat, lng: sample.lng, ts: Date.now() }];
        if (samples.length > MAX_ACTIVE_SAMPLES) {
          // Keep every other point; the accumulated miles already counted them.
          samples = samples.filter((_, i) => i % 2 === 0 || i === samples.length - 1);
        }
        set({
          active: {
            ...active,
            samples,
            miles: (active.miles ?? sumMiles(active.samples)) + leg,
          },
        });
      },

      stop: (input) => {
        const active = get().active;
        if (!active) return null;

        const last = active.samples[active.samples.length - 1];
        // The closing fix counts only when it is real movement — a trip that
        // ends where the last sample sits must not gain a phantom leg.
        const closing = last && acceptSample(last, input) ? haversineMiles({ lat: last.lat, lng: last.lng }, input) : 0;
        const miles = (active.miles ?? sumMiles(active.samples)) + closing;
        const trip: MileageTrip = {
          id: active.id,
          startedAt: active.startedAt,
          endedAt: new Date().toISOString(),
          startLat: active.startLat,
          startLng: active.startLng,
          endLat: input.lat,
          endLng: input.lng,
          startAddress: active.startAddress,
          endAddress: input.address,
          miles,
          purpose: active.purpose,
        };
        set((s) => ({ active: null, trips: [trip, ...s.trips].slice(0, 500) }));
        return trip;
      },

      remove: (id) =>
        set((s) => ({ trips: s.trips.filter((t) => t.id !== id) })),

      totalMilesYTD: () => {
        const year = new Date().getFullYear();
        return get()
          .trips.filter((t) => new Date(t.startedAt).getFullYear() === year)
          .reduce((sum, t) => sum + t.miles, 0);
      },

      liveMiles: () => {
        const active = get().active;
        if (!active) return 0;
        return active.miles ?? sumMiles(active.samples);
      },
    }),
    {
      name: 'roofwise.mileage.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ active: s.active, trips: s.trips }),
    },
  ),
);

function sumMiles(samples: readonly MileageSample[]): number {
  let miles = 0;
  for (let i = 1; i < samples.length; i++) {
    miles += haversineMiles(
      { lat: samples[i - 1].lat, lng: samples[i - 1].lng },
      { lat: samples[i].lat, lng: samples[i].lng },
    );
  }
  return miles;
}
