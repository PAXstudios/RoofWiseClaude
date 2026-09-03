// Knock Planner — saved plans (one per run, findable by date), the run in
// progress, per-area status, and the Census cache. Persisted.
//
// A plan is a page the roofer comes back to: "the June 14 plan". Every run
// saves one; the list on the planner screen is newest first. The run itself
// is owned by lib/services/knockPlanRunner.ts and reports into `activeRun`
// so any screen (or the Home bell) can show progress after the planner
// screen is left. Housing profiles are cached 30 days per cell because the
// ACS does not move between visits.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { FinderStep, KnockFinderResult } from '../services/knockFinder';
import type { HousingProfile } from '../services/knockOpportunities';

const HOUSING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PLANS = 40;

/** What the roofer did about an area of a plan — set from the plan page. */
export type AreaStatus = 'planned' | 'knocked' | 'scheduled' | 'skipped' | 'done';

export const AREA_STATUS_LABELS: Record<AreaStatus, string> = {
  planned: 'Planned',
  knocked: 'Knocked',
  scheduled: 'Scheduled',
  skipped: 'Skipped',
  done: 'Done',
};

export type KnockPlan = {
  id: string;
  createdAt: string;
  /** Roofer-visible name: "Plano, TX · Jun 14" — editable later. */
  title: string;
  result: KnockFinderResult;
  areaStatus: Record<string, AreaStatus>;
  /** Free notes the roofer adds on the plan page. */
  notes?: string;
};

export type ActiveRun = {
  id: string;
  startedAt: string;
  baseLabel: string;
  step: FinderStep;
  /** The latest partial result (ranked areas first, enrichment later). */
  partial: KnockFinderResult | null;
};

let counter = 0;
const newId = () => `plan_${Date.now()}_${counter++}`;

type KnockFinderState = {
  plans: KnockPlan[];
  activeRun: ActiveRun | null;
  /** Kept for older screens; always the newest plan's result. */
  lastResult: KnockFinderResult | null;
  housingCache: Record<string, { profile: HousingProfile; fetchedAt: string }>;

  beginRun: (run: Omit<ActiveRun, 'partial'> & { partial?: KnockFinderResult | null }) => void;
  updateRun: (patch: Partial<Pick<ActiveRun, 'step' | 'partial'>>) => void;
  endRun: () => void;
  savePlan: (result: KnockFinderResult, title: string) => KnockPlan;
  setAreaStatus: (planId: string, areaKey: string, status: AreaStatus) => void;
  setPlanNotes: (planId: string, notes: string) => void;
  renamePlan: (planId: string, title: string) => void;
  removePlan: (planId: string) => void;
  getPlan: (planId: string) => KnockPlan | undefined;
  /** Legacy setter (pre-#93 callers). */
  setResult: (r: KnockFinderResult | null) => void;
  cachedHousing: (key: string) => HousingProfile | undefined;
  cacheHousing: (key: string, profile: HousingProfile) => void;
};

export const useKnockFinderStore = create<KnockFinderState>()(
  persist(
    (set, get) => ({
      plans: [],
      activeRun: null,
      lastResult: null,
      housingCache: {},

      beginRun: (run) => set({ activeRun: { ...run, partial: run.partial ?? null } }),
      updateRun: (patch) => set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, ...patch } } : s)),
      endRun: () => set({ activeRun: null }),

      savePlan: (result, title) => {
        const plan: KnockPlan = { id: newId(), createdAt: result.generatedAt, title, result, areaStatus: {} };
        set((s) => ({ plans: [plan, ...s.plans].slice(0, MAX_PLANS), lastResult: result }));
        return plan;
      },

      setAreaStatus: (planId, areaKey, status) =>
        set((s) => ({
          plans: s.plans.map((p) => (p.id === planId ? { ...p, areaStatus: { ...p.areaStatus, [areaKey]: status } } : p)),
        })),

      setPlanNotes: (planId, notes) => set((s) => ({ plans: s.plans.map((p) => (p.id === planId ? { ...p, notes } : p)) })),
      renamePlan: (planId, title) => set((s) => ({ plans: s.plans.map((p) => (p.id === planId ? { ...p, title } : p)) })),
      removePlan: (planId) => set((s) => ({ plans: s.plans.filter((p) => p.id !== planId) })),
      getPlan: (planId) => get().plans.find((p) => p.id === planId),

      setResult: (r) => set({ lastResult: r }),

      cachedHousing: (key) => {
        const hit = get().housingCache[key];
        if (!hit) return undefined;
        if (Date.now() - new Date(hit.fetchedAt).getTime() > HOUSING_TTL_MS) return undefined;
        return hit.profile;
      },

      cacheHousing: (key, profile) =>
        set((s) => ({
          housingCache: { ...s.housingCache, [key]: { profile, fetchedAt: new Date().toISOString() } },
        })),
    }),
    {
      name: 'roofwise.knockFinder.v1',
      version: 2,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ plans: s.plans, lastResult: s.lastResult, housingCache: s.housingCache }),
      // v1 stored only `lastResult`; turn it into the first saved plan so
      // nothing the roofer generated before this existed is lost.
      migrate: (persisted, version) => {
        const p = (persisted ?? {}) as Partial<KnockFinderState>;
        if (version < 2 && p.lastResult && !(p.plans && p.plans.length)) {
          const r = p.lastResult;
          const d = new Date(r.generatedAt);
          const title = `${r.base.label} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
          return { ...p, plans: [{ id: newId(), createdAt: r.generatedAt, title, result: r, areaStatus: {} }] } as KnockFinderState;
        }
        return p as KnockFinderState;
      },
    },
  ),
);

/** "Plano, TX · Jun 14, 2026" */
export function planTitleFor(result: KnockFinderResult): string {
  const d = new Date(result.generatedAt);
  return `${result.base.label} · ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
}
