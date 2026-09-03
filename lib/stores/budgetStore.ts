// Per-job budgets: the projected split, the actual costs the roofer typed in,
// and an optional hand-pinned contract price. Keyed by inspection id.
//
// The maths lives in lib/services/budget.ts; this store only keeps records.
// Nothing here is seeded — a job has no budget until the roofer opens the
// card, and the card reads "no projection / no actuals" until then (Drift #5).

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { BudgetEntry, BudgetProjected, JobBudget } from '../models/types';

let counter = 0;
function newId(): string {
  return `bud_${Date.now()}_${counter++}`;
}

const EMPTY_ACTUALS: readonly BudgetEntry[] = [];

export type NewBudgetEntry = Omit<BudgetEntry, 'id' | 'at'> & { at?: string };

type BudgetStoreState = {
  budgets: Record<string, JobBudget>;

  getByJob: (jobId: string) => JobBudget | undefined;
  /** Add a real cost. Amount is clamped to ≥ 0; a blank label falls back to the kind. */
  addActual: (jobId: string, entry: NewBudgetEntry) => BudgetEntry;
  removeActual: (jobId: string, entryId: string) => void;
  /** Replace the projected split (a snapshot — see `BudgetProjected`). `undefined` clears it. */
  setProjected: (jobId: string, projected: BudgetProjected | undefined) => void;
  /** Pin a contract price by hand. `undefined` goes back to reading the signed proposal. */
  setContractPriceOverride: (jobId: string, price: number | undefined) => void;
  /** Drop the whole record — for a deleted job. */
  removeJob: (jobId: string) => void;
};

function emptyBudget(jobId: string): JobBudget {
  return { jobId, actuals: [], updatedAt: new Date().toISOString() };
}

export const useBudgetStore = create<BudgetStoreState>()(
  persist(
    (set, get) => ({
      budgets: {},

      getByJob: (jobId) => get().budgets[jobId],

      addActual: (jobId, input) => {
        const entry: BudgetEntry = {
          id: newId(),
          kind: input.kind,
          label: input.label.trim() || input.kind,
          amount: Math.max(0, Number.isFinite(input.amount) ? input.amount : 0),
          at: input.at ?? new Date().toISOString(),
          ...(input.note?.trim() ? { note: input.note.trim() } : {}),
        };
        set((s) => {
          const current = s.budgets[jobId] ?? emptyBudget(jobId);
          return {
            budgets: {
              ...s.budgets,
              [jobId]: {
                ...current,
                actuals: [entry, ...current.actuals],
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
        return entry;
      },

      removeActual: (jobId, entryId) =>
        set((s) => {
          const current = s.budgets[jobId];
          if (!current) return s;
          return {
            budgets: {
              ...s.budgets,
              [jobId]: {
                ...current,
                actuals: current.actuals.filter((e) => e.id !== entryId),
                updatedAt: new Date().toISOString(),
              },
            },
          };
        }),

      setProjected: (jobId, projected) =>
        set((s) => {
          const current = s.budgets[jobId] ?? emptyBudget(jobId);
          return {
            budgets: {
              ...s.budgets,
              [jobId]: { ...current, projected, updatedAt: new Date().toISOString() },
            },
          };
        }),

      setContractPriceOverride: (jobId, price) =>
        set((s) => {
          const current = s.budgets[jobId] ?? emptyBudget(jobId);
          const next: JobBudget = { ...current, updatedAt: new Date().toISOString() };
          if (price === undefined || !Number.isFinite(price) || price <= 0) {
            delete next.contractPriceOverride;
          } else {
            next.contractPriceOverride = price;
          }
          return { budgets: { ...s.budgets, [jobId]: next } };
        }),

      removeJob: (jobId) =>
        set((s) => {
          if (!(jobId in s.budgets)) return s;
          const { [jobId]: _dropped, ...rest } = s.budgets;
          return { budgets: rest };
        }),
    }),
    {
      name: 'roofwise.budgets.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ budgets: s.budgets }),
    },
  ),
);

/** Stable selector: the job's actuals, or a shared empty list (never a fresh array per render). */
export function selectActuals(jobId: string) {
  return (s: BudgetStoreState): readonly BudgetEntry[] => s.budgets[jobId]?.actuals ?? EMPTY_ACTUALS;
}
