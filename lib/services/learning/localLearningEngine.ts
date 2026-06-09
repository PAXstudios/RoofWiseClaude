// Per-user threshold calibration + Gemini prompt prefix.
// Pure functions over a UserProfile. No I/O.

import type { DamageCategory } from '../../models/types';
import { DAMAGE_CATEGORIES, DAMAGE_CATEGORY_LABELS } from '../../models/types';
import type { UserProfile } from './userCorrectionProfile';

const BASELINE_CONFIDENCE = 60;       // default Gemini cutoff
const MAX_DRIFT_PERCENT = 20;         // cap ±20% per spec

/**
 * Returns the effective confidence threshold (0-100) for this user/category.
 * If the user has rejected >=30% of AI markers in this category → raise threshold.
 * If the user has added >=20% missed markers → lower threshold.
 */
export function effectiveThreshold(
  profile: UserProfile,
  category: DamageCategory,
): number {
  const stats = profile.perCategory[category];
  if (!stats || stats.total < 10) return BASELINE_CONFIDENCE;

  const rejectRate = stats.overCount / Math.max(1, stats.total);
  const addedRate = stats.underCount / Math.max(1, stats.total);

  let drift = 0;
  if (rejectRate >= 0.3) drift = Math.round(rejectRate * MAX_DRIFT_PERCENT);
  else if (addedRate >= 0.2) drift = -Math.round(addedRate * MAX_DRIFT_PERCENT);

  drift = Math.max(-MAX_DRIFT_PERCENT, Math.min(MAX_DRIFT_PERCENT, drift));
  return Math.max(0, Math.min(100, BASELINE_CONFIDENCE + drift));
}

/**
 * Generate a small Gemini system-prompt prefix when the user has 20+
 * corrections. Returns empty string otherwise.
 */
export function userStylePromptPrefix(profile: UserProfile): string {
  if (profile.totalCorrections < 20) return '';

  const misses: string[] = [];
  const overcounts: string[] = [];
  for (const cat of DAMAGE_CATEGORIES) {
    const s = profile.perCategory[cat];
    if (!s || s.total < 5) continue;
    const rejectRate = s.overCount / Math.max(1, s.total);
    const addedRate = s.underCount / Math.max(1, s.total);
    if (addedRate >= 0.2) misses.push(DAMAGE_CATEGORY_LABELS[cat]);
    if (rejectRate >= 0.3) overcounts.push(DAMAGE_CATEGORY_LABELS[cat]);
  }

  const parts: string[] = [];
  if (misses.length > 0) {
    parts.push(`identify ${misses.slice(0, 3).join(', ')} damage the AI often misses`);
  }
  if (overcounts.length > 0) {
    parts.push(`be conservative on ${overcounts.slice(0, 3).join(', ')}`);
  }
  if (parts.length === 0) return '';

  return `This inspector tends to: ${parts.join('; ')}. Calibrate detection accordingly.`;
}

/**
 * Overall accuracy across all categories (0-100). Hidden until at least
 * 5 corrections are recorded.
 */
export function overallAccuracy(profile: UserProfile): number | null {
  if (profile.totalCorrections < 5) return null;
  let weightedSum = 0;
  let weightTotal = 0;
  for (const cat of DAMAGE_CATEGORIES) {
    const s = profile.perCategory[cat];
    if (!s || s.total === 0) continue;
    weightedSum += s.accuracy * s.total;
    weightTotal += s.total;
  }
  if (weightTotal === 0) return null;
  return Math.round((weightedSum / weightTotal) * 100);
}
