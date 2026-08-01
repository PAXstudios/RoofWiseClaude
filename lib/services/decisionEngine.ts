// Pure HAAG decision engine. No I/O.
// Spec section "Decision Engine Rule Set" (lines ~570).

import {
  ROOF_MATERIAL_LABELS,
  type Inspection,
  type RoofMaterial,
  type RoofRecommendation,
  type Slope,
  type SlopeVerdict,
} from '../models/types';
import { thresholdFor } from './haagThresholds';

type PerSlopeResult = {
  slopeId: string;
  verdict: SlopeVerdict;
  qualifies: boolean;
  reasoning: string;
  confidenceAvg: number;
};

export type DecisionEngineResult = {
  perSlope: PerSlopeResult[];
  roofRecommendation: RoofRecommendation;
  roofVerdictReasoning: string;
  verifyWithInspector: boolean;
};

// Materials for which one qualifying slope drives whole-roof replacement
// (per HAAG matching rules).
const ALL_OR_NOTHING_MATERIALS = new Set<RoofMaterial>([
  'architectural_asphalt',
  'three_tab_asphalt',
  'luxury_asphalt',
  'clay_tile',
  'concrete_tile',
  'slate',
]);

function avgConfidence(slope: Slope): number {
  if (slope.damage.length === 0) return 0;
  const total = slope.damage.reduce((sum, m) => sum + m.confidence, 0);
  return total / slope.damage.length;
}

function evaluateSlope(slope: Slope, material: RoofMaterial, ageYears: number): PerSlopeResult {
  const threshold = thresholdFor(material);
  const hailCount = slope.hailCount;
  const confidenceAvg = avgConfidence(slope);

  const qualifiesByHail = hailCount >= threshold.hitsPerTestSquare && threshold.hitsPerTestSquare > 0;
  const qualifiesByWind = slope.windLiftCount + slope.missingCount > 0 && slope.functional;
  const qualifiesByPenetration =
    threshold.hitsPerTestSquare === 0 &&
    (slope.hailCount > 0 || slope.missingCount > 0);

  const qualifies = qualifiesByHail || qualifiesByWind || qualifiesByPenetration;

  let verdict: SlopeVerdict = 'repair';
  let reasoning: string;

  if (ageYears > 25 && qualifies) {
    verdict = 'verify_with_inspector';
    reasoning =
      `Roof age >25 years. Damage observed (hail ${hailCount}, missing ${slope.missingCount}, lift ${slope.windLiftCount}) ` +
      'but age may be a confounding factor — recommend brittleness test.';
  } else if (qualifies) {
    verdict = 'full_replace';
    reasoning =
      `Slope qualifies for replacement: ${threshold.rule} ` +
      `Observed: ${hailCount} hail, ${slope.windLiftCount} wind-lifted, ${slope.missingCount} missing.`;
  } else if (hailCount > 0 || slope.windLiftCount > 0 || slope.missingCount > 0) {
    verdict = 'repair';
    reasoning =
      `Slope shows damage below the ${ROOF_MATERIAL_LABELS[material]} HAAG threshold (${threshold.rule}). ` +
      `Recommend itemized repair scope.`;
  } else {
    verdict = 'repair';
    reasoning = 'No qualifying damage observed.';
  }

  // Low confidence overrides — flag for human review per spec Phase 8 logic.
  if (confidenceAvg > 0 && confidenceAvg < 50) {
    verdict = 'verify_with_inspector';
    reasoning =
      `${reasoning} Average detection confidence ${Math.round(confidenceAvg)}% — recommend on-site verification.`;
  }

  return {
    slopeId: slope.id,
    verdict,
    qualifies,
    reasoning,
    confidenceAvg,
  };
}

export function evaluate(inspection: Inspection): DecisionEngineResult {
  const perSlope = inspection.slopes.map((s) =>
    evaluateSlope(s, inspection.material, inspection.ageYears),
  );

  const qualifyingSlopes = perSlope.filter((r) => r.qualifies);
  const flaggedForReview = perSlope.some((r) => r.verdict === 'verify_with_inspector');

  let roofRecommendation: RoofRecommendation;
  let roofVerdictReasoning: string;

  if (qualifyingSlopes.length === 0) {
    roofRecommendation = 'repair';
    roofVerdictReasoning =
      'No slope meets the HAAG functional-damage threshold. Itemized repair scope recommended.';
  } else if (
    qualifyingSlopes.length >= 1 &&
    ALL_OR_NOTHING_MATERIALS.has(inspection.material)
  ) {
    roofRecommendation = 'full_replacement';
    roofVerdictReasoning =
      `${qualifyingSlopes.length} slope(s) qualify under HAAG. ` +
      `Material (${ROOF_MATERIAL_LABELS[inspection.material]}) follows all-or-nothing matching — full roof replacement recommended.`;
  } else if (qualifyingSlopes.length >= 2) {
    roofRecommendation = 'full_replacement';
    roofVerdictReasoning =
      `${qualifyingSlopes.length} slopes qualify. Full roof replacement recommended.`;
  } else {
    roofRecommendation = 'partial_replacement';
    const ids = qualifyingSlopes.map((s) => s.slopeId).join(', ');
    roofVerdictReasoning = `Single slope (${ids}) qualifies. Partial replacement recommended.`;
  }

  if (flaggedForReview) {
    roofVerdictReasoning += ' One or more slopes flagged for inspector verification.';
  }

  return {
    perSlope,
    roofRecommendation,
    roofVerdictReasoning,
    verifyWithInspector: flaggedForReview,
  };
}

// Damage Score (0-100) — spec page 1611-1632.
// Loose heuristic: weighted by qualifying hail count + missing/lifted count,
// capped at 100. Used for the dashboard Damage Score chip.
export function damageScore(inspection: Inspection): number {
  let score = 0;
  for (const slope of inspection.slopes) {
    score += slope.hailCount * 1.5;
    score += slope.bruisingCount * 1.0;
    score += slope.windLiftCount * 2.0;
    score += slope.missingCount * 4.0;
    score += slope.wearCount * 0.5;
  }
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type ClaimWorthiness = 'not_claimable' | 'borderline' | 'claimable' | 'urgent';

export function claimWorthiness(
  result: DecisionEngineResult,
  damage: number,
): ClaimWorthiness {
  if (result.roofRecommendation === 'full_replacement' && damage >= 70) return 'urgent';
  if (result.roofRecommendation === 'full_replacement') return 'claimable';
  if (result.roofRecommendation === 'partial_replacement') return 'claimable';
  if (damage >= 30) return 'borderline';
  return 'not_claimable';
}

export const CLAIM_WORTHINESS_LABELS: Record<ClaimWorthiness, string> = {
  not_claimable: 'Not Claimable',
  borderline: 'Borderline',
  claimable: 'Claimable',
  urgent: 'Urgent',
};
