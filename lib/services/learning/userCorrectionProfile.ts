// Rolling per-user correction stats over the last 100 corrections.
// Used by LocalLearningEngine to compute effective thresholds + the
// Gemini user-style prompt prefix.

import type { Correction, DamageCategory } from '../../models/types';
import { DAMAGE_CATEGORIES } from '../../models/types';

export type CategoryStats = {
  accuracy: number;       // 0-1: fraction of AI markers the user kept
  underCount: number;     // markers user added that AI missed
  overCount: number;      // markers user removed (false positives)
  total: number;          // total events for this category in the window
};

export type UserProfile = {
  perCategory: Record<DamageCategory, CategoryStats>;
  totalCorrections: number;
  windowSize: number;
  computedAt: string;
};

const ROLLING_WINDOW = 100;

function emptyStats(): CategoryStats {
  return { accuracy: 1, underCount: 0, overCount: 0, total: 0 };
}

function emptyProfile(): UserProfile {
  const perCategory = {} as Record<DamageCategory, CategoryStats>;
  for (const c of DAMAGE_CATEGORIES) perCategory[c] = emptyStats();
  return {
    perCategory,
    totalCorrections: 0,
    windowSize: ROLLING_WINDOW,
    computedAt: new Date().toISOString(),
  };
}

export function computeProfile(corrections: Correction[]): UserProfile {
  if (corrections.length === 0) return emptyProfile();

  // Most-recent N
  const slice = corrections.slice(0, ROLLING_WINDOW);
  const profile = emptyProfile();
  profile.totalCorrections = corrections.length;

  // Counters per category
  const kept: Record<string, number> = {};
  const rejected: Record<string, number> = {};
  const added: Record<string, number> = {};
  const removed: Record<string, number> = {};
  const total: Record<string, number> = {};

  for (const c of slice) {
    const originalMarkers = c.originalDetection.markers ?? [];
    const correctedMarkers = c.correctedDetection.markers ?? [];

    // Maps by marker id (after Edit we keep the original id when modifying).
    const origIds = new Set(originalMarkers.map((m) => m.id));
    const corrIds = new Set(correctedMarkers.map((m) => m.id));

    // Categories the user kept (in both sets)
    for (const m of originalMarkers) {
      total[m.category] = (total[m.category] ?? 0) + 1;
      if (corrIds.has(m.id)) {
        kept[m.category] = (kept[m.category] ?? 0) + 1;
      } else {
        rejected[m.category] = (rejected[m.category] ?? 0) + 1;
      }
    }

    // Markers in corrected but not original — user added them
    for (const m of correctedMarkers) {
      if (!origIds.has(m.id)) {
        added[m.category] = (added[m.category] ?? 0) + 1;
        total[m.category] = (total[m.category] ?? 0) + 1;
      }
    }

    // Markers in original but not corrected — user removed them
    for (const m of originalMarkers) {
      if (!corrIds.has(m.id)) {
        removed[m.category] = (removed[m.category] ?? 0) + 1;
      }
    }
  }

  for (const cat of DAMAGE_CATEGORIES) {
    const t = total[cat] ?? 0;
    const k = kept[cat] ?? 0;
    profile.perCategory[cat] = {
      accuracy: t === 0 ? 1 : k / t,
      underCount: added[cat] ?? 0,
      overCount: removed[cat] ?? 0,
      total: t,
    };
  }

  profile.computedAt = new Date().toISOString();
  return profile;
}
