import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Proposal, ProposalStatus } from '../models/types';
import { useInspectionStore } from './inspectionStore';

let counter = 0;

function newId(): string {
  return `prop_${Date.now()}_${counter++}`;
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

      setStatus: (id, status, when) => {
        const current = get().proposals.find((p) => p.id === id);
        set((s) => ({
          proposals: s.proposals.map((p) => (p.id === id ? { ...p, status, ...when } : p)),
        }));
        if (!current || current.status === status) return;
        const total = current.total;
        const inspectionId = current.jobId;
        const leadId = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId)?.leadId;
        if (status === 'sent') {
          emitPipeline({ type: 'proposal_sent', proposalId: id, inspectionId, leadId, total });
        } else if (status === 'signed') {
          emitPipeline({ type: 'proposal_signed', proposalId: id, inspectionId, leadId, total });
        }
      },

      remove: (id) => set((s) => ({ proposals: s.proposals.filter((p) => p.id !== id) })),
    }),
    {
      name: 'roofwise.proposals.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ proposals: s.proposals }),
    },
  ),
);
