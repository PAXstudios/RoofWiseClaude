// "Where should I knock?" — the last result and the Census cache, persisted.
//
// Re-opening the screen shows the last plan with its timestamp instead of
// re-pulling 24 months of reports; housing profiles are cached 30 days per
// cell because the ACS does not move between visits.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { KnockFinderResult } from '../services/knockFinder';
import type { HousingProfile } from '../services/knockOpportunities';

const HOUSING_TTL_MS = 30 * 24 * 60 * 60 * 1000;

type KnockFinderState = {
  lastResult: KnockFinderResult | null;
  housingCache: Record<string, { profile: HousingProfile; fetchedAt: string }>;
  setResult: (r: KnockFinderResult | null) => void;
  cachedHousing: (key: string) => HousingProfile | undefined;
  cacheHousing: (key: string, profile: HousingProfile) => void;
};

export const useKnockFinderStore = create<KnockFinderState>()(
  persist(
    (set, get) => ({
      lastResult: null,
      housingCache: {},

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
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ lastResult: s.lastResult, housingCache: s.housingCache }),
    },
  ),
);
