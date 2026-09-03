import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { PropertyRecord, SavedEstimate } from '../models/types';

let counter = 0;
function newId(): string {
  return `est_${Date.now()}_${counter++}`;
}

/**
 * Fire a pipeline event without a hard top-level import — `automations.ts`
 * imports this store, so a static import back would be circular. Lazy
 * `require` resolves after both modules have finished loading and is a
 * silent no-op if the automation module is absent (a bare-store Node test).
 */
function emitPipeline(e: import('../services/automations').PipelineEvent): void {
  try {
    (require('../services/automations') as typeof import('../services/automations')).emitPipelineEvent(e);
  } catch {
    // best effort — a store write must never fail because of it
  }
}

type State = {
  estimates: SavedEstimate[];
  save: (input: Omit<SavedEstimate, 'id' | 'createdAt'>) => SavedEstimate;
  remove: (id: string) => void;
  getById: (id: string) => SavedEstimate | undefined;
  /** Attach the Zillow record so the saved estimate fronts with the house. */
  setPropertyRecord: (id: string, record: PropertyRecord) => void;
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
        if (est.address && est.totalMid > 0) {
          emitPipeline({ type: 'estimate_saved', estimateId: est.id, address: est.address, total: est.totalMid });
        }
        return est;
      },

      remove: (id) =>
        set((s) => ({ estimates: s.estimates.filter((e) => e.id !== id) })),

      getById: (id) => get().estimates.find((e) => e.id === id),

      setPropertyRecord: (id, record) =>
        set((s) => ({ estimates: s.estimates.map((e) => (e.id === id ? { ...e, propertyRecord: record } : e)) })),
    }),
    {
      name: 'roofwise.estimates.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ estimates: s.estimates }),
    },
  ),
);
