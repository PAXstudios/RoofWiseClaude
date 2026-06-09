import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Lead, LeadStage } from '../models/types';

let counter = 0;

function newId(): string {
  return `lead_${Date.now()}_${counter++}`;
}

type LeadStoreState = {
  leads: Lead[];

  create: (input: Omit<Lead, 'id' | 'createdAt'>) => Lead;
  setStage: (id: string, stage: LeadStage) => void;
  remove: (id: string) => void;
  countByStage: () => Record<LeadStage, number>;
};

export const useLeadStore = create<LeadStoreState>()(
  persist(
    (set, get) => ({
      leads: [],

      create: (input) => {
        const lead: Lead = {
          ...input,
          id: newId(),
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ leads: [lead, ...s.leads] }));
        return lead;
      },

      setStage: (id, stage) =>
        set((s) => ({
          leads: s.leads.map((l) => (l.id === id ? { ...l, stage } : l)),
        })),

      remove: (id) =>
        set((s) => ({ leads: s.leads.filter((l) => l.id !== id) })),

      countByStage: () => {
        const out: Record<string, number> = {};
        for (const l of get().leads) out[l.stage] = (out[l.stage] ?? 0) + 1;
        return out as Record<LeadStage, number>;
      },
    }),
    {
      name: 'roofwise.leads.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ leads: s.leads }),
    },
  ),
);
