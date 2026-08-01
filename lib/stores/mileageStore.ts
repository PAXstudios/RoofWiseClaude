import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { MileageTrip } from '../models/types';

let counter = 0;
function newId(): string {
  return `trip_${Date.now()}_${counter++}`;
}

type ActiveTrip = {
  id: string;
  startedAt: string;
  startLat: number;
  startLng: number;
  startAddress?: string;
  purpose?: string;
  samples: { lat: number; lng: number; ts: number }[];
};

type MileageStoreState = {
  active: ActiveTrip | null;
  trips: MileageTrip[];

  start: (input: { lat: number; lng: number; address?: string; purpose?: string }) => ActiveTrip;
  recordSample: (sample: { lat: number; lng: number }) => void;
  stop: (input: { lat: number; lng: number; address?: string }) => MileageTrip | null;
  remove: (id: string) => void;
  totalMilesYTD: () => number;
};

const EARTH_RADIUS_MI = 3958.8;

function haversineMiles(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

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
        };
        set({ active: trip });
        return trip;
      },

      recordSample: (sample) => {
        const active = get().active;
        if (!active) return;
        const last = active.samples[active.samples.length - 1];
        // Filter noisy points: require ≥10m movement
        if (last && haversineMiles({ lat: last.lat, lng: last.lng }, sample) < 0.0062) return;
        set({
          active: {
            ...active,
            samples: [...active.samples, { ...sample, ts: Date.now() }],
          },
        });
      },

      stop: (input) => {
        const active = get().active;
        if (!active) return null;

        const samples = [...active.samples, { ...input, ts: Date.now() }];
        let miles = 0;
        for (let i = 1; i < samples.length; i++) {
          miles += haversineMiles(
            { lat: samples[i - 1].lat, lng: samples[i - 1].lng },
            { lat: samples[i].lat, lng: samples[i].lng },
          );
        }
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
    }),
    {
      name: 'roofwise.mileage.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ active: s.active, trips: s.trips }),
    },
  ),
);
