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
import { DEFAULT_SEARCH_RADIUS_MILES, clampRadiusMiles, type HousingProfile, type TripDay } from '../services/knockOpportunities';
import type { DoNotKnockExclusions } from '../services/doNotKnock';
import type { RunHistoryEntry } from '../services/knockRunEstimate';

const HOUSING_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_PLANS = 40;
/** Runs remembered for the time estimate. */
const MAX_RUN_HISTORY = 10;

/** What the roofer did about an area of a plan — set from the plan page. */
export type AreaStatus = 'planned' | 'knocked' | 'scheduled' | 'skipped' | 'done';

export const AREA_STATUS_LABELS: Record<AreaStatus, string> = {
  planned: 'Planned',
  knocked: 'Knocked',
  scheduled: 'Scheduled',
  skipped: 'Skipped',
  done: 'Done',
};

/** A trip day put on the calendar — the Plan tab lists these as knock days. */
export type KnockDaySchedule = {
  /** `TripDay.day` inside the plan's trip. */
  day: number;
  /** YYYY-MM-DD, local. */
  date: string;
  /** HH:mm, local — the hour the first drive starts. */
  startTime: string;
  /** expo-notifications id of the day-of reminder, when one was scheduled. */
  reminderId?: string;
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
  /** The Storm Watch alert that queued this plan, when one did (one plan per alert). */
  stormAlertId?: string;
  /** Days the roofer put on the calendar (see `scheduleDay`). */
  schedule?: KnockDaySchedule[];
  /** What the do-not-knock list removed or discounted when this plan was saved. */
  exclusions?: DoNotKnockExclusions;
};

export type ActiveRun = {
  id: string;
  startedAt: string;
  baseLabel: string;
  step: FinderStep;
  /** The latest partial result (ranked areas first, enrichment later). */
  partial: KnockFinderResult | null;
  /** Set when a Storm Watch alert queued the run — the alert screen shows "Planning…". */
  stormAlertId?: string;
  /** Search radius this run uses. Absent on runs begun before the dial existed. */
  radiusMiles?: number;
  /** ISO — when `step` began; the time estimate subtracts it. */
  stepStartedAt?: string;
  /** Seconds each finished step took — filled as the run moves on. */
  stepSeconds?: Partial<Record<FinderStep, number>>;
};

/** One scheduled knock day with the plan and the trip day it belongs to. */
export type ScheduledKnockDay = { plan: KnockPlan; day: TripDay; schedule: KnockDaySchedule };

let counter = 0;
const newId = () => `plan_${Date.now()}_${counter++}`;

type KnockFinderState = {
  plans: KnockPlan[];
  activeRun: ActiveRun | null;
  /** Kept for older screens; always the newest plan's result. */
  lastResult: KnockFinderResult | null;
  housingCache: Record<string, { profile: HousingProfile; fetchedAt: string }>;
  /** The roofer's last search radius (the dial). */
  radiusMiles: number;
  /** The last MAX_RUN_HISTORY runs — what the time estimate learns from. */
  runHistory: RunHistoryEntry[];

  beginRun: (run: Omit<ActiveRun, 'partial'> & { partial?: KnockFinderResult | null }) => void;
  updateRun: (patch: Partial<Pick<ActiveRun, 'step' | 'partial' | 'stepStartedAt' | 'stepSeconds' | 'baseLabel'>>) => void;
  /** Move the run to `step`, timing the one that just finished. */
  advanceRunStep: (step: FinderStep, now?: Date) => void;
  endRun: () => void;
  setRadiusMiles: (radiusMiles: number) => void;
  recordRun: (entry: RunHistoryEntry) => void;
  savePlan: (
    result: KnockFinderResult,
    title: string,
    extra?: { stormAlertId?: string; exclusions?: DoNotKnockExclusions },
  ) => KnockPlan;
  /** The plan a Storm Watch alert produced, if any (one plan per alert). */
  planForAlert: (alertId: string) => KnockPlan | undefined;
  /** Put a trip day on the calendar (replaces an earlier schedule for that day). */
  scheduleDay: (planId: string, day: number, date: string, startTime: string, reminderId?: string) => void;
  unscheduleDay: (planId: string, day: number) => void;
  /** Record (or clear) the day-of reminder id after it is scheduled. */
  setDayReminder: (planId: string, day: number, reminderId: string | undefined) => void;
  /** Every scheduled day across plans, soonest first. Prefer `scheduledDaysFrom` inside components. */
  scheduledDays: () => ScheduledKnockDay[];
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
      radiusMiles: DEFAULT_SEARCH_RADIUS_MILES,
      runHistory: [],

      beginRun: (run) => set({ activeRun: { ...run, partial: run.partial ?? null, stepStartedAt: run.stepStartedAt ?? run.startedAt, stepSeconds: run.stepSeconds ?? {} } }),
      updateRun: (patch) => set((s) => (s.activeRun ? { activeRun: { ...s.activeRun, ...patch } } : s)),
      advanceRunStep: (step, now = new Date()) =>
        set((s) => {
          const run = s.activeRun;
          if (!run) return s;
          if (run.step === step) return s;
          const startedMs = new Date(run.stepStartedAt ?? run.startedAt).getTime();
          const took = Number.isNaN(startedMs) ? undefined : Math.max(0, (now.getTime() - startedMs) / 1000);
          return {
            activeRun: {
              ...run,
              step,
              stepStartedAt: now.toISOString(),
              stepSeconds: took == null ? run.stepSeconds : { ...(run.stepSeconds ?? {}), [run.step]: Math.round(took * 10) / 10 },
            },
          };
        }),
      endRun: () => set({ activeRun: null }),
      setRadiusMiles: (radiusMiles) => set({ radiusMiles: clampRadiusMiles(radiusMiles) }),
      recordRun: (entry) => set((s) => ({ runHistory: [entry, ...s.runHistory].slice(0, MAX_RUN_HISTORY) })),

      savePlan: (result, title, extra) => {
        const plan: KnockPlan = {
          id: newId(),
          createdAt: result.generatedAt,
          title,
          result,
          areaStatus: {},
          ...(extra?.stormAlertId ? { stormAlertId: extra.stormAlertId } : null),
          ...(extra?.exclusions ? { exclusions: extra.exclusions } : null),
        };
        set((s) => ({ plans: [plan, ...s.plans].slice(0, MAX_PLANS), lastResult: result }));
        return plan;
      },

      planForAlert: (alertId) => get().plans.find((p) => p.stormAlertId === alertId),

      scheduleDay: (planId, day, date, startTime, reminderId) =>
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === planId
              ? {
                  ...p,
                  schedule: [
                    ...(p.schedule ?? []).filter((d) => d.day !== day),
                    { day, date, startTime, ...(reminderId ? { reminderId } : null) },
                  ],
                }
              : p,
          ),
        })),

      unscheduleDay: (planId, day) =>
        set((s) => ({
          plans: s.plans.map((p) => {
            if (p.id !== planId) return p;
            const rest = (p.schedule ?? []).filter((d) => d.day !== day);
            return { ...p, schedule: rest.length > 0 ? rest : undefined };
          }),
        })),

      setDayReminder: (planId, day, reminderId) =>
        set((s) => ({
          plans: s.plans.map((p) =>
            p.id === planId
              ? { ...p, schedule: (p.schedule ?? []).map((d) => (d.day === day ? { ...d, reminderId } : d)) }
              : p,
          ),
        })),

      scheduledDays: () => scheduledDaysFrom(get().plans),

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
      partialize: (s) => ({ plans: s.plans, lastResult: s.lastResult, housingCache: s.housingCache, radiusMiles: s.radiusMiles, runHistory: s.runHistory }),
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

/**
 * Every scheduled day across the given plans, soonest first (date, then
 * start time, then the older plan). Pure — use it under `useMemo` on the
 * `plans` slice so a component never re-renders on a fresh array identity.
 */
export function scheduledDaysFrom(plans: readonly KnockPlan[]): ScheduledKnockDay[] {
  const out: ScheduledKnockDay[] = [];
  for (const plan of plans) {
    for (const schedule of plan.schedule ?? []) {
      const day = plan.result.plan.days.find((d) => d.day === schedule.day);
      if (!day) continue;
      out.push({ plan, day, schedule });
    }
  }
  out.sort(
    (a, b) =>
      `${a.schedule.date}T${a.schedule.startTime}`.localeCompare(`${b.schedule.date}T${b.schedule.startTime}`) ||
      a.plan.createdAt.localeCompare(b.plan.createdAt) ||
      a.day.day - b.day.day,
  );
  return out;
}

/** "Plano, TX · Jun 14, 2026" — neighbours mode: "Neighbours · Jun 14, 2026". */
export function planTitleFor(result: Pick<KnockFinderResult, 'generatedAt' | 'base' | 'mode'>): string {
  const d = new Date(result.generatedAt);
  const day = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  if (result.mode === 'neighbours') return `Neighbours · ${day}`;
  return `${result.base.label} · ${day}`;
}
