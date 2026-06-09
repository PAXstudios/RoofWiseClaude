import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AnalysisJob = {
  id: string;
  inspectionId: string;
  slopeId: string;
  slopeLabel: string;        // for the progress chip + completion notification
  enqueuedAt: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  attempts: number;
};

let counter = 0;
function newId(): string {
  return `aq_${Date.now()}_${counter++}`;
}

type State = {
  jobs: AnalysisJob[];

  enqueue: (input: { inspectionId: string; slopeId: string; slopeLabel: string }) => AnalysisJob | null;
  nextQueued: () => AnalysisJob | undefined;
  setStatus: (id: string, status: AnalysisJob['status']) => void;
  bumpAttempts: (id: string) => void;
  clearFinished: () => void;
  pendingCount: () => number;
};

export const useAnalysisQueueStore = create<State>()(
  persist(
    (set, get) => ({
      jobs: [],

      enqueue: (input) => {
        // Dedup: one queued/running job per slope at a time.
        const existing = get().jobs.find(
          (j) =>
            j.slopeId === input.slopeId &&
            (j.status === 'queued' || j.status === 'running'),
        );
        if (existing) return null;
        const job: AnalysisJob = {
          id: newId(),
          inspectionId: input.inspectionId,
          slopeId: input.slopeId,
          slopeLabel: input.slopeLabel,
          enqueuedAt: new Date().toISOString(),
          status: 'queued',
          attempts: 0,
        };
        set((s) => ({ jobs: [...s.jobs, job].slice(-100) }));
        return job;
      },

      nextQueued: () => get().jobs.find((j) => j.status === 'queued'),

      setStatus: (id, status) =>
        set((s) => ({
          jobs: s.jobs.map((j) => (j.id === id ? { ...j, status } : j)),
        })),

      bumpAttempts: (id) =>
        set((s) => ({
          jobs: s.jobs.map((j) =>
            j.id === id ? { ...j, attempts: j.attempts + 1 } : j,
          ),
        })),

      clearFinished: () =>
        set((s) => ({
          jobs: s.jobs.filter((j) => j.status === 'queued' || j.status === 'running'),
        })),

      pendingCount: () =>
        get().jobs.filter((j) => j.status === 'queued' || j.status === 'running').length,
    }),
    {
      name: 'roofwise.analysisQueue.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ jobs: s.jobs }),
      // Jobs stuck in "running" from a killed app become queued again on boot.
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        useAnalysisQueueStore.setState((s) => ({
          jobs: s.jobs.map((j) =>
            j.status === 'running' ? { ...j, status: 'queued' } : j,
          ),
        }));
      },
    },
  ),
);
