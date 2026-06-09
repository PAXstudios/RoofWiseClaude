import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { SavedEstimate } from '../models/types';

let counter = 0;
function newId(): string {
  return `est_${Date.now()}_${counter++}`;
}

type State = {
  estimates: SavedEstimate[];
  save: (input: Omit<SavedEstimate, 'id' | 'createdAt'>) => SavedEstimate;
  remove: (id: string) => void;
  getById: (id: string) => SavedEstimate | undefined;
};

export const useEstimateStore = create<State>()(
  persist(
    (set, get) => ({
      estimates: [],

      save: (input) => {
        const est: SavedEstimate = {
          ...input,
          id: newId(),
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ estimates: [est, ...s.estimates].slice(0, 100) }));
        return est;
      },

      remove: (id) =>
        set((s) => ({ estimates: s.estimates.filter((e) => e.id !== id) })),

      getById: (id) => get().estimates.find((e) => e.id === id),
    }),
    {
      name: 'roofwise.estimates.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ estimates: s.estimates }),
    },
  ),
);
