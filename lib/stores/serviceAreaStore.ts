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

  add: (input: { label: string; kind: 'zip' | 'city'; centroidLat?: number; centroidLng?: number }) => ServiceArea;
  remove: (id: string) => void;
  clear: () => void;
};

export const useServiceAreaStore = create<ServiceAreaState>()(
  persist(
    (set) => ({
      areas: [],

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

      remove: (id) => set((s) => ({ areas: s.areas.filter((a) => a.id !== id) })),
      clear: () => set({ areas: [] }),
    }),
    {
      name: 'roofwise.serviceAreas.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ areas: s.areas }),
    },
  ),
);
