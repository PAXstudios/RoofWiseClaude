import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Proposal, ProposalStatus } from '../models/types';

let counter = 0;

function newId(): string {
  return `prop_${Date.now()}_${counter++}`;
}

type ProposalStoreState = {
  proposals: Proposal[];

  upsert: (proposal: Proposal) => Proposal;
  create: (input: Omit<Proposal, 'id'>) => Proposal;
  getByJob: (jobId: string) => Proposal | undefined;
  setStatus: (id: string, status: ProposalStatus, when?: Partial<Pick<Proposal, 'sentAt' | 'viewedAt' | 'signedAt'>>) => void;
  remove: (id: string) => void;
};

export const useProposalStore = create<ProposalStoreState>()(
  persist(
    (set, get) => ({
      proposals: [],

      upsert: (proposal) => {
        set((s) => ({
          proposals: s.proposals.some((p) => p.id === proposal.id)
            ? s.proposals.map((p) => (p.id === proposal.id ? proposal : p))
            : [proposal, ...s.proposals],
        }));
        return proposal;
      },

      create: (input) => {
        const p: Proposal = { ...input, id: newId() };
        set((s) => ({ proposals: [p, ...s.proposals] }));
        return p;
      },

      getByJob: (jobId) => get().proposals.find((p) => p.jobId === jobId),

      setStatus: (id, status, when) =>
        set((s) => ({
          proposals: s.proposals.map((p) => (p.id === id ? { ...p, status, ...when } : p)),
        })),

      remove: (id) => set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) })),
    }),
    {
      name: 'roofwise.proposals.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ proposals: s.proposals }),
    },
  ),
);
