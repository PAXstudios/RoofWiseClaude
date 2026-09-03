import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ServiceArea } from '../models/types';

let counter = 0;

function newId(): string {
  return `area_${Date.now()}_${counter++}`;
}

type ServiceAreaState = {
  areas: ServiceArea[];
  /**
   * Storm Watch setting: when a DAMAGING alert fires (hail ≥ 1 in / wind ≥ 70
   * mph), queue a Knock Planner run on the storm core and ring the bell when
   * the plan is ready. Default on — the whole point of an alert is the plan.
   */
  autoPlanDamagingStorms: boolean;

  add: (input: { label: string; kind: 'zip' | 'city'; centroidLat?: number; centroidLng?: number }) => ServiceArea;
  setCentroid: (id: string, lat: number, lng: number) => void;
  remove: (id: string) => void;
  clear: () => void;
  setAutoPlanDamagingStorms: (on: boolean) => void;
};

export const useServiceAreaStore = create<ServiceAreaState>()(
  persist(
    (set) => ({
      areas: [],
      autoPlanDamagingStorms: true,
      setAutoPlanDamagingStorms: (on) => set({ autoPlanDamagingStorms: on }),

      add: (input) => {
        const area: ServiceArea = {
          id: newId(),
          label: input.label,
          kind: input.kind,
          centroidLat: input.centroidLat,
          centroidLng: input.centroidLng,
        };
        set((s) => ({ areas: [...s.areas, area] }));
        return area;
      },

      setCentroid: (id, lat, lng) =>
        set((s) => ({
          areas: s.areas.map((a) =>
            a.id === id ? { ...a, centroidLat: lat, centroidLng: lng } : a,
          ),
        })),

      remove: (id) => set((s) => ({ areas: s.areas.filter((a) => a.id !== id) })),
      clear: () => set({ areas: [] }),
    }),
    {
      name: 'roofwise.serviceAreas.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ areas: s.areas, autoPlanDamagingStorms: s.autoPlanDamagingStorms }),
    },
  ),
);
