import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { ActivityEvent, ActivityEventKind } from '../models/types';

let counter = 0;

function newId(): string {
  return `evt_${Date.now()}_${counter++}`;
}

type ActivityStoreState = {
  events: ActivityEvent[];

  log: (input: {
    kind: ActivityEventKind;
    message: string;
    jobId?: string;
    inspectionId?: string;
    leadId?: string;
    proposalId?: string;
    payload?: Record<string, unknown>;
  }) => ActivityEvent;
  clear: () => void;
};

export const useActivityStore = create<ActivityStoreState>()(
  persist(
    (set) => ({
      events: [],

      log: (input) => {
        const evt: ActivityEvent = {
          id: newId(),
          kind: input.kind,
          message: input.message,
          jobId: input.jobId,
          inspectionId: input.inspectionId,
          leadId: input.leadId,
          proposalId: input.proposalId,
          payload: input.payload,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ events: [evt, ...s.events].slice(0, 200) }));
        return evt;
      },

      clear: () => set({ events: [] }),
    }),
    {
      name: 'roofwise.activity.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ events: s.events }),
    },
  ),
);
