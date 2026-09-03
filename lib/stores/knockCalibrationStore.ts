// Knock calibration — the roofer's own results per planned area, and the
// base-rate table refit from them (docs/KNOCK_OPPORTUNITIES.md §8).
// Persisted.
//
// `records` is a cache of a computation over live data: every saved plan
// (knockFinderStore) × every knock (knockSessionStore, archive + active),
// each knock attributed to exactly one plan-area. It is rebuilt wholesale
// by `recordPerformance` / `refreshFromStores` — never accumulated — so a
// deleted plan drops out and a re-designated pin is counted once. The
// `snapshot` is what the finder reads at ranking time.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KnockSession } from '../models/types';
import {
  DEFAULT_RING_MILES,
  buildPerformanceRecords,
  calibrateBaseRates,
  hailClassOf,
  type AreaPerformance,
  type CalibratedRates,
  type PerformancePlan,
} from '../services/knockCalibration';
import { useKnockFinderStore, type KnockPlan } from './knockFinderStore';
import { useKnockSessionStore } from './knockSessionStore';

export type CalibrationSnapshot = {
  rates: CalibratedRates;
  /** ISO — when it was computed. */
  at: string;
};

type KnockCalibrationState = {
  records: AreaPerformance[];
  snapshot: CalibrationSnapshot | null;
  /**
   * ISO — when the roofer last hit Reset. Knocks before it no longer feed the
   * posterior, so "reset" means "start the count over from now", not "clear
   * a cache that rebuilds from the same doors on the next plan".
   */
  resetAt?: string;
  /**
   * Rebuild every record from the given plans and sessions (archive + active)
   * and recompute the snapshot. Pass the whole plan list: attribution across
   * plans is what keeps a knock from counting twice.
   */
  recordPerformance: (plans: readonly KnockPlan[], sessions: readonly KnockSession[], now?: Date) => CalibratedRates;
  /** `recordPerformance` from the live finder and session stores. */
  refreshFromStores: (now?: Date) => CalibratedRates;
  recompute: (now?: Date) => CalibratedRates;
  /** Back to the table; only knocks from `now` on count from here. */
  reset: (now?: Date) => void;
};

/** The parts of a saved plan the calibration reads. */
export function performancePlanOf(plan: KnockPlan): PerformancePlan {
  return {
    id: plan.id,
    createdAt: plan.createdAt,
    areas: plan.result.areas.map((a) => {
      const table = a.calibration?.tableRate;
      const used = a.calibration?.usedRate ?? table;
      return {
        key: a.key,
        lat: a.lat,
        lng: a.lng,
        hailClass: a.calibration?.hailClass ?? hailClassOf(a.storm),
        expectedPerDoor: a.hitRate.perRoof,
        // What the formula multiplied the base by on this street; 1 when the
        // plan predates the calibration field.
        modifier: used && used > 0 ? a.hitRate.perRoof / used : 1,
      };
    }),
  };
}

export const useKnockCalibrationStore = create<KnockCalibrationState>()(
  persist(
    (set, get) => ({
      records: [],
      snapshot: null,

      recordPerformance: (plans, sessions, now = new Date()) => {
        const resetMs = get().resetAt ? new Date(get().resetAt as string).getTime() : Number.NEGATIVE_INFINITY;
        const knocks = sessions.flatMap((s) => s.knocks).filter((k) => new Date(k.createdAt).getTime() >= resetMs);
        const at = now.toISOString();
        const records = buildPerformanceRecords(plans.map(performancePlanOf), knocks, at, DEFAULT_RING_MILES);
        const rates = calibrateBaseRates(records);
        set({ records, snapshot: { rates, at } });
        return rates;
      },

      refreshFromStores: (now = new Date()) => {
        const plans = useKnockFinderStore.getState().plans;
        const { activeSession, archive } = useKnockSessionStore.getState();
        return get().recordPerformance(plans, [...(activeSession ? [activeSession] : []), ...archive], now);
      },

      recompute: (now = new Date()) => {
        const rates = calibrateBaseRates(get().records);
        set({ snapshot: { rates, at: now.toISOString() } });
        return rates;
      },

      reset: (now = new Date()) => set({ records: [], snapshot: null, resetAt: now.toISOString() }),
    }),
    {
      name: 'roofwise.knockCalibration.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ records: s.records, snapshot: s.snapshot, resetAt: s.resetAt }),
    },
  ),
);

/** The calibrated rates, or null before the first knocked plan. */
export function useCalibration(): CalibratedRates | null {
  return useKnockCalibrationStore((s) => (s.snapshot && s.snapshot.rates.totalDoors > 0 ? s.snapshot.rates : null));
}

/** Non-hook read for the finder: refresh from the live stores, then the rates (null when there is no data yet). */
export function calibrationForRun(now = new Date()): CalibratedRates | null {
  const rates = useKnockCalibrationStore.getState().refreshFromStores(now);
  return rates.totalDoors > 0 ? rates : null;
}
