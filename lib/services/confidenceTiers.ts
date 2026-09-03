// Confidence tiers for report presentation.
//
// Source of truth is docs/SPEC.md § "Decision Engine Rule Set → Confidence
// layer", which defines two thresholds:
//   • avg < 0.50 → attach verifyWithInspector
//   • avg < 0.70 → recommendation stands, but flag AI uncertainty
// plus the reporting floor from lib/services/gemini.ts (MARKER_MIN_CONFIDENCE
// = 45), below which a detection is never emitted at all.
//
// A claim packet has to be honest about what the AI was sure of and what it
// wasn't. Presenting a 47%-confidence detection with the same visual weight
// as a 96% one is how a carrier finds one soft finding and discredits the
// whole report — so uncertainty gets labelled, not hidden or dropped.

export type ConfidenceTier = 'high' | 'moderate' | 'uncertain';

/** Spec's confidence-layer boundaries, expressed on the 0–100 scale. */
export const CONFIDENCE_BOUNDS = {
  /** At or above: unqualified finding. */
  high: 70,
  /** At or above: stands, but carries an uncertainty note. */
  moderate: 50,
  /** Below `moderate` and at/above this: flag for on-site verification. */
  reportingFloor: 45,
  /**
   * Below this a detection auto-queues for human review (docs/
   * PRODUCT_SYNTHESIS.md §1 "AI analysis" — the Dashboard Spec pins the
   * confidence-graded review gate at <80%). A SEPARATE AXIS from the report
   * tiers above: a 75-confidence finding still renders as a "high" tier in
   * the packet while also landing in the review queue. Do not fold this
   * into tierFor.
   */
  reviewThreshold: 80,
} as const;

export function tierFor(confidence: number): ConfidenceTier {
  if (confidence >= CONFIDENCE_BOUNDS.high) return 'high';
  if (confidence >= CONFIDENCE_BOUNDS.moderate) return 'moderate';
  return 'uncertain';
}

/**
 * Confidence-graded review gate: true when a detection should auto-queue
 * for expert/inspector review (confidence below 80). Workflow gate only —
 * report presentation keeps using tierFor, which is unchanged.
 */
export function needsExpertReview(confidence: number): boolean {
  return confidence < CONFIDENCE_BOUNDS.reviewThreshold;
}

export const TIER_LABEL: Record<ConfidenceTier, string> = {
  high: 'High confidence',
  moderate: 'Moderate confidence',
  uncertain: 'Uncertain — verify on site',
};

export const TIER_SHORT: Record<ConfidenceTier, string> = {
  high: 'High',
  moderate: 'Moderate',
  uncertain: 'Uncertain',
};

/** What the tier means for the adjuster reading the packet. */
export const TIER_MEANING: Record<ConfidenceTier, string> = {
  high: 'Multiple definitive indicators visible; reported as observed fact.',
  moderate: 'Clear indicator present with some ambiguity (angle, glare, partial view).',
  uncertain:
    'Below the confidence needed to assert without verification. Included for completeness and flagged for on-site confirmation — not relied upon in the roof-level verdict.',
};

export function averageConfidence(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
