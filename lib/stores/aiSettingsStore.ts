// Per-category minimum-confidence gate the roofer can dial in Settings → AI
// thresholds (app/(tabs)/settings.tsx replaces the old dead "Coming soon"
// row with this). Default per category is the confidence-graded review gate
// already in force app-wide (CONFIDENCE_BOUNDS.reviewThreshold, 80) — turning
// this control on for the first time changes nothing until the roofer moves
// a slider.
//
// This is a DIFFERENT store from captureSettingsStore (owned by another
// agent this wave) and from the auto-learned per-category threshold in
// lib/services/learning/localLearningEngine.ts. The one call site that reads
// this store — lib/services/analyzeSlope.ts — takes the STRICTER of this
// floor and the auto-learned `effectiveThreshold()`, so the roofer's own
// floor is a hard minimum the correction-history signal can only tighten,
// never loosen out from under them.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DAMAGE_CATEGORIES, type DamageCategory } from '../models/types';
import { CONFIDENCE_BOUNDS } from '../services/confidenceTiers';

function defaultFloors(): Record<DamageCategory, number> {
  const out = {} as Record<DamageCategory, number>;
  for (const c of DAMAGE_CATEGORIES) out[c] = CONFIDENCE_BOUNDS.reviewThreshold;
  return out;
}

type AiSettingsState = {
  /** Master switch. Off = every Gemini marker is kept regardless of
   *  confidence (the pre-this-feature behavior) — an honest escape hatch,
   *  never a fake "always on" control. */
  enabled: boolean;
  perCategoryFloor: Record<DamageCategory, number>;
  /** Test-square photos get a full-frame pass PLUS a 2×2 tiled pass at full
   *  resolution (lib/services/gemini.ts analyzePhotoTiled — a 1" strike is
   *  ~6 px in what the model sees of a whole 10×10 frame). Five calls per
   *  square photo instead of one; off keeps the single pass. Default on. */
  tiledTestSquares: boolean;
  setEnabled: (on: boolean) => void;
  setTiledTestSquares: (on: boolean) => void;
  setFloor: (category: DamageCategory, value: number) => void;
  resetFloors: () => void;
};

export const useAiSettingsStore = create<AiSettingsState>()(
  persist(
    (set) => ({
      enabled: true,
      perCategoryFloor: defaultFloors(),
      tiledTestSquares: true,

      setEnabled: (on) => set({ enabled: on }),
      setTiledTestSquares: (on) => set({ tiledTestSquares: on }),

      setFloor: (category, value) =>
        set((s) => ({
          perCategoryFloor: {
            ...s.perCategoryFloor,
            [category]: Math.max(0, Math.min(100, Math.round(value))),
          },
        })),

      resetFloors: () => set({ perCategoryFloor: defaultFloors() }),
    }),
    {
      name: 'roofwise.aiSettings.v1',
      version: 1,
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ enabled: s.enabled, perCategoryFloor: s.perCategoryFloor, tiledTestSquares: s.tiledTestSquares }),
      // A category added to DAMAGE_CATEGORIES after a roofer already saved
      // this store must still get a default floor rather than `undefined`
      // (BACKLOG #5) — merge fills gaps instead of replacing wholesale.
      merge: (persisted, current) => {
        const p = persisted as Partial<AiSettingsState> | undefined;
        return {
          ...current,
          enabled: p?.enabled ?? current.enabled,
          tiledTestSquares: p?.tiledTestSquares ?? current.tiledTestSquares,
          perCategoryFloor: { ...current.perCategoryFloor, ...p?.perCategoryFloor },
        };
      },
    },
  ),
);
