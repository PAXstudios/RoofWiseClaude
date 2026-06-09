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

  create: (input: Omit<Lead, 'id' | 'createdAt' | 'updatedAt' | 'syncStatus'>) => Lead;
  upsert: (lead: Lead) => Lead;
  setStage: (id: string, stage: LeadStage) => void;
  setFollowUp: (id: string, followUpAt: string | undefined) => void;
  markSynced: (ids: string[]) => void;
  remove: (id: string) => void;
  countByStage: () => Record<LeadStage, number>;
  pending: () => Lead[];
};

export const useLeadStore = create<LeadStoreState>()(
  persist(
    (set, get) => ({
      leads: [],

      create: (input) => {
        const now = new Date().toISOString();
        const lead: Lead = {
          ...input,
          id: newId(),
          createdAt: now,
          updatedAt: now,
          syncStatus: 'pending',
        };
        set((s) => ({ leads: [lead, ...s.leads] }));
        return lead;
      },

      upsert: (lead) => {
        set((s) => ({
          leads: s.leads.some((l) => l.id === lead.id)
            ? s.leads.map((l) => (l.id === lead.id ? lead : l))
            : [lead, ...s.leads],
        }));
        return lead;
      },

      setStage: (id, stage) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? { ...l, stage, updatedAt: new Date().toISOString(), syncStatus: 'pending' }
              : l,
          ),
        })),

      setFollowUp: (id, followUpAt) =>
        set((s) => ({
          leads: s.leads.map((l) =>
            l.id === id
              ? {
                  ...l,
                  followUpAt,
                  updatedAt: new Date().toISOString(),
                  syncStatus: 'pending',
                }
              : l,
          ),
        })),

      markSynced: (ids) =>
        set((s) => ({
          leads: s.leads.map((l) => (ids.includes(l.id) ? { ...l, syncStatus: 'synced' } : l)),
        })),

      remove: (id) =>
        set((s) => ({ leads: s.leads.filter((l) => l.id !== id) })),

      countByStage: () => {
        const out: Record<string, number> = {};
        for (const l of get().leads) out[l.stage] = (out[l.stage] ?? 0) + 1;
        return out as Record<LeadStage, number>;
      },

      pending: () => get().leads.filter((l) => l.syncStatus !== 'synced'),
    }),
    {
      name: 'roofwise.leads.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ leads: s.leads }),
    },
  ),
);
