// Stored decision-engine results — snapshot, validate, resolve.
//
// WHY: report layers used to call `evaluate()` at render time, which meant a
// PDF generated on Tuesday could disagree with the PDF generated on Monday
// from the same inspection (the §6 two-year corroboration rule reads the
// clock, and any edit between renders moved the numbers). A claim packet is
// evidence — the determination it carries must be a stored fact with a
// timestamp, not something re-derived while the page renders.
//
// The engine itself stays pure (Drift #8). This module does no I/O either: it
// takes an Inspection, hands back a JSON-safe payload, and the CALLER writes
// it through `useInspectionStore.setStoredEngineResult(...)`.
//
// Contract:
//   snapshotEngineResult(ins)   → JSON-safe HaagEngineResult (+ snapshot meta)
//   castStoredEngineResult(x)   → HaagEngineResult | null (defensive)
//   resolveEngineResult(ins)    → stored-if-usable, otherwise a fresh snapshot

import type { Inspection, RoofRecommendation, Slope, SlopeVerdict } from '../models/types';
import {
  evaluate,
  type ClaimViabilityBand,
  type DecisionEngineResult,
  type HaagEngineResult,
  type PerSlopeResult,
  type RoofwiseRecommendation,
  type SafetyForecast,
  type SafetyRating,
  type SlopeEvaluation,
  type SlopeRecommendedAction,
} from './decisionEngine';
import { sha256Hex } from './reportIntegrity';

// -----------------------------------------------------------------------------
// Snapshot payload
// -----------------------------------------------------------------------------

/** Namespaced sidecar written alongside the §9 contract fields. */
export type SnapshotMeta = {
  /** ISO timestamp the snapshot was evaluated (same value stored as storedEngineResultAt). */
  at: string;
  /**
   * SHA-256 over the engine-relevant inputs at snapshot time. The inspection
   * record carries no "last analysis change" timestamp, so freshness is
   * decided by comparing this fingerprint against the current inputs —
   * strictly stronger than a timestamp comparison, since ANY change to an
   * engine input invalidates the snapshot, and an unrelated edit does not.
   */
  inputFingerprint: string;
};

/**
 * What actually goes into `Inspection.storedEngineResult`: the §9
 * HaagEngineResult plus a namespaced meta sidecar. The extra key cannot
 * collide with a §9 field, and every read path goes through
 * `castStoredEngineResult`, which ignores it.
 */
export type StoredEngineSnapshot = HaagEngineResult & {
  roofwise_snapshot?: SnapshotMeta;
};

/**
 * A stored snapshot ages out even when nothing on the inspection changed:
 * the §6 claim-viability band reads months-since-event, so a months-old
 * snapshot can state a corroboration posture that is no longer true. Past
 * this age an unfinalized report re-snapshots. A FINALIZED report never
 * re-snapshots — it is meant to keep the numbers it was signed with.
 */
export const MAX_SNAPSHOT_AGE_MS = 30 * 24 * 60 * 60 * 1000;

const RECOMMENDATIONS: RoofwiseRecommendation[] = [
  'FULL_REPLACEMENT',
  'PARTIAL_REPLACEMENT',
  'REPAIR',
  'NO_STORM_DAMAGE',
];
const BANDS: ClaimViabilityBand[] = ['HIGH', 'MEDIUM', 'LOW'];
const SAFETY_RATINGS: SafetyRating[] = ['SAFE', 'USE_CAUTION', 'UNSAFE'];
const ACTIONS: SlopeRecommendedAction[] = [
  'Full Replacement',
  'Partial Replacement',
  'Localized Repairs',
  'No Storm-Related Work',
];

// -----------------------------------------------------------------------------
// Snapshot
// -----------------------------------------------------------------------------

export type EngineSnapshot = {
  /** JSON-safe payload to hand to `setStoredEngineResult`. */
  payload: StoredEngineSnapshot;
  /** ISO timestamp of the evaluation — pass as `atIso` to the store action. */
  at: string;
  /** The full legacy result from the same evaluation, for callers rendering now. */
  decision: DecisionEngineResult;
};

/**
 * Run the engine ONCE and return a JSON-safe payload to persist.
 *
 * `asOfIso` is passed through to `evaluate()` so the §6 two-year corroboration
 * rule participates (the engine never reads the clock itself — Drift #8).
 *
 * `forecast` (§7 roofer safety) is likewise the caller's to fetch — see
 * `getSafetyForecast()` in lib/services/weather.ts. Pass `undefined`, never
 * `{}`, when it is unavailable, so the engine records honest uncertainty
 * instead of a rating derived from missing inputs. Passing it here freezes the
 * safety rating the signed report was generated with.
 */
export function snapshotEngineResult(
  inspection: Inspection,
  asOfIso?: string,
  forecast?: SafetyForecast,
): EngineSnapshot {
  const at = asOfIso ?? new Date().toISOString();
  const decision = evaluate(inspection, at, forecast);
  const snapshot: StoredEngineSnapshot = {
    ...decision.haag,
    roofwise_snapshot: { at, inputFingerprint: engineInputFingerprint(inspection) },
  };
  // Round-trip guarantees the payload is literally JSON-safe (drops undefined
  // members) before it reaches AsyncStorage-backed persistence.
  const payload = JSON.parse(JSON.stringify(snapshot)) as StoredEngineSnapshot;
  return { payload, at, decision };
}

// -----------------------------------------------------------------------------
// Defensive cast
// -----------------------------------------------------------------------------

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isSlopeEvaluation(v: unknown): v is SlopeEvaluation {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  return (
    typeof e.slope === 'string' &&
    typeof e.hail_hits_per_square === 'number' &&
    typeof e.wind_creased_count === 'number' &&
    typeof e.missing_shingles === 'number' &&
    typeof e.brittleness_result === 'string' &&
    isStringArray(e.collateral_damage) &&
    typeof e.haag_threshold_triggered === 'boolean' &&
    ACTIONS.includes(e.recommended_action as SlopeRecommendedAction) &&
    typeof e.justification === 'string'
  );
}

/**
 * Validate an untyped persisted value as a §9 engine result.
 *
 * `Inspection.storedEngineResult` is typed `unknown` on purpose (the model
 * layer must not import services), and persisted records survive app
 * upgrades — so every field a report reads is checked here. Anything that
 * does not match returns null and the caller re-snapshots rather than
 * rendering a half-shaped determination.
 */
export function castStoredEngineResult(value: unknown): HaagEngineResult | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const r = value as Record<string, unknown>;
  if (!RECOMMENDATIONS.includes(r.roofwise_recommendation as RoofwiseRecommendation)) return null;
  if (!BANDS.includes(r.claim_viability as ClaimViabilityBand)) return null;
  if (!SAFETY_RATINGS.includes(r.roofer_safety_rating as SafetyRating)) return null;
  if (typeof r.policy_notes !== 'string') return null;
  if (typeof r.detailed_explanation !== 'string') return null;
  if (typeof r.adjuster_narrative !== 'string') return null;
  if (typeof r.homeowner_summary !== 'string') return null;
  if (typeof r.matched_rule !== 'string') return null;
  if (!isStringArray(r.carrier_specific_requirements)) return null;
  if (!isStringArray(r.evidence_required)) return null;
  if (!isStringArray(r.haag_thresholds_triggered)) return null;
  if (!isStringArray(r.uncertainties)) return null;
  if (!isStringArray(r.decision_path)) return null;
  if (!Array.isArray(r.slope_evaluations) || !r.slope_evaluations.every(isSlopeEvaluation)) {
    return null;
  }
  // The two detail records are part of the §9 contract; a payload without them
  // would make the returned type a lie.
  if (!r.claim_viability_detail || typeof r.claim_viability_detail !== 'object') return null;
  if (!r.safety_detail || typeof r.safety_detail !== 'object') return null;
  return value as HaagEngineResult;
}

/** The snapshot sidecar, when the payload carries one. */
export function storedSnapshotMeta(value: unknown): SnapshotMeta | null {
  if (!value || typeof value !== 'object') return null;
  const meta = (value as Record<string, unknown>).roofwise_snapshot;
  if (!meta || typeof meta !== 'object') return null;
  const m = meta as Record<string, unknown>;
  if (typeof m.at !== 'string' || typeof m.inputFingerprint !== 'string') return null;
  return { at: m.at, inputFingerprint: m.inputFingerprint };
}

// -----------------------------------------------------------------------------
// Freshness
// -----------------------------------------------------------------------------

/**
 * Canonical fingerprint of every field `engineInputFromInspection()` reads,
 * plus the per-slope detection confidence the legacy layer overlays. Field
 * order is fixed here (not object-key order) so the same inputs always hash
 * the same.
 */
export function engineInputFingerprint(ins: Inspection): string {
  const slopes = ins.slopes.map((s) => [
    s.id,
    s.hailCount,
    s.windLiftCount,
    s.missingCount,
    s.bruisingCount,
    s.wearCount,
    s.functional === true,
    s.squareHitCount ?? null,
    s.singleShingleHitCount ?? null,
    s.damage.length,
    // Rounded mean confidence — drives the legacy verify-with-inspector overlay.
    s.damage.length === 0
      ? null
      : Math.round(s.damage.reduce((sum, m) => sum + m.confidence, 0) / s.damage.length),
  ]);
  const canonical = JSON.stringify([
    ins.material,
    ins.ageYears,
    ins.kind ?? 'general',
    ins.brittlenessTest,
    ins.brittlenessProtocol?.result ?? null,
    Object.entries(ins.collateralChecklist ?? {})
      .filter(([, v]) => v)
      .map(([k]) => k)
      .sort(),
    ins.event
      ? [
          ins.event.kind,
          ins.event.date,
          ins.event.hailSizeInches ?? null,
          ins.event.windSpeedMph ?? null,
          ins.event.distanceMiles ?? null,
          ins.event.source,
        ]
      : null,
    ins.stormSearchOutcome ?? null,
    ins.dateOfLoss ?? null,
    ins.carrier ?? null,
    ins.policyType ?? null,
    ins.deductible ?? null,
    ins.homeValue ?? null,
    ins.priorClaimsWithin3Years ?? null,
    slopes,
  ]);
  return sha256Hex(canonical);
}

export type StoredEngineFreshness = {
  /** A validly-shaped stored result exists. */
  present: boolean;
  /** Inputs still match the snapshot. */
  inputsMatch: boolean;
  /** Snapshot is within MAX_SNAPSHOT_AGE_MS. */
  withinMaxAge: boolean;
  /** The report was finalized — the snapshot is frozen and must not be re-derived. */
  frozen: boolean;
  /**
   * The frozen snapshot no longer describes the roof: a report was signed, and
   * the engine inputs changed afterwards (markers edited, photos analyzed).
   * The signed document is still the document of record — but a live surface
   * that restates it is showing a pre-edit determination, so this must be
   * SURFACED rather than silently honored. See `resolveEngineResult`'s
   * `honorFreeze` option.
   */
  staleFrozen: boolean;
  /** Use the stored result as-is. */
  usable: boolean;
};

export function storedEngineFreshness(ins: Inspection, now: number = Date.now()): StoredEngineFreshness {
  const stored = castStoredEngineResult(ins.storedEngineResult);
  const meta = storedSnapshotMeta(ins.storedEngineResult);
  const present = stored !== null;
  const frozen = present && !!ins.reportFinalizedAt;
  const inputsMatch = present && meta !== null && meta.inputFingerprint === engineInputFingerprint(ins);
  const atIso = ins.storedEngineResultAt ?? meta?.at;
  const parsed = atIso ? Date.parse(atIso) : NaN;
  const withinMaxAge = !Number.isNaN(parsed) && now - parsed <= MAX_SNAPSHOT_AGE_MS;
  return {
    present,
    inputsMatch,
    withinMaxAge,
    frozen,
    staleFrozen: frozen && !inputsMatch,
    usable: present && (frozen || (inputsMatch && withinMaxAge)),
  };
}

/** Convenience predicate: is the stored result present and safe to render? */
export function isStoredEngineResultFresh(ins: Inspection, now: number = Date.now()): boolean {
  return storedEngineFreshness(ins, now).usable;
}

// -----------------------------------------------------------------------------
// Legacy view — restatement only
// -----------------------------------------------------------------------------

const ACTION_TO_VERDICT: Record<SlopeRecommendedAction, SlopeVerdict> = {
  'Full Replacement': 'full_replace',
  'Partial Replacement': 'partial_replace',
  'Localized Repairs': 'repair',
  'No Storm-Related Work': 'repair',
};

function avgConfidence(slope: Slope): number {
  if (slope.damage.length === 0) return 0;
  return slope.damage.reduce((sum, m) => sum + m.confidence, 0) / slope.damage.length;
}

/**
 * Rebuild the legacy `DecisionEngineResult` view from a STORED §9 result.
 *
 * This is a restatement, not a re-derivation: every verdict, threshold
 * boolean, and justification comes from the stored payload. It mirrors the
 * legacy mapping in `decisionEngine.evaluate()` (§6 of that file) so a report
 * built from a snapshot reads identically to one built live — including the
 * app-level low-confidence overlay, which depends on current markers rather
 * than on engine output.
 */
export function legacyDecisionFromStored(
  ins: Inspection,
  haag: HaagEngineResult,
): DecisionEngineResult {
  const evalBySlope = new Map(haag.slope_evaluations.map((e) => [e.slope, e]));

  const perSlope: PerSlopeResult[] = ins.slopes.map((slope) => {
    const evaluation = evalBySlope.get(slope.id);
    const confidenceAvg = avgConfidence(slope);
    let verdict: SlopeVerdict = evaluation
      ? ACTION_TO_VERDICT[evaluation.recommended_action]
      : 'repair';
    let reasoning = evaluation?.justification ?? 'No evaluation available for this slope.';
    if (confidenceAvg > 0 && confidenceAvg < 50) {
      verdict = 'verify_with_inspector';
      reasoning += ` Average detection confidence ${Math.round(confidenceAvg)}% — recommend on-site verification.`;
    }
    return {
      slopeId: slope.id,
      verdict,
      qualifies: evaluation?.haag_threshold_triggered ?? false,
      reasoning,
      confidenceAvg,
    };
  });

  const flaggedForReview = perSlope.some((r) => r.verdict === 'verify_with_inspector');

  const roofRecommendation: RoofRecommendation =
    haag.roofwise_recommendation === 'FULL_REPLACEMENT'
      ? 'full_replacement'
      : haag.roofwise_recommendation === 'PARTIAL_REPLACEMENT'
        ? 'partial_replacement'
        : 'repair';

  let roofVerdictReasoning =
    haag.roofwise_recommendation === 'NO_STORM_DAMAGE'
      ? `No storm-related work recommended. ${haag.matched_rule}`
      : haag.matched_rule;
  if (flaggedForReview) {
    roofVerdictReasoning += ' One or more slopes flagged for inspector verification.';
  }

  return { perSlope, roofRecommendation, roofVerdictReasoning, verifyWithInspector: flaggedForReview, haag };
}

// -----------------------------------------------------------------------------
// Resolve
// -----------------------------------------------------------------------------

export type ResolveEngineOptions = {
  /**
   * Whether a finalized report's snapshot wins even when the engine inputs
   * have changed since it was signed. Default `true`, which is right for the
   * DOCUMENTS (a PDF must restate what it was signed with).
   *
   * Live surfaces — the job screen, the inspections list, a proposal being
   * drafted now — pass `false`: they are describing the roof as it stands, and
   * restating a pre-edit determination there is silent staleness, not
   * integrity. They should also show the `staleFrozen` warning so the roofer
   * knows the signed packet is behind and needs regenerating.
   */
  honorFreeze?: boolean;
};

export type EngineResultSource =
  /** Report is finalized — the signed snapshot is used verbatim. */
  | 'frozen'
  /** A stored snapshot matched the current inputs and was used. */
  | 'stored'
  /** No usable snapshot — the engine ran now (nothing was persisted here). */
  | 'recomputed';

export type ResolvedEngineResult = {
  haag: HaagEngineResult;
  decision: DecisionEngineResult;
  /** ISO timestamp the determination was evaluated. */
  at: string;
  source: EngineResultSource;
  /** Set when `snapshotEngineResult` ran — callers may persist it. */
  snapshot?: EngineSnapshot;
};

/**
 * The one read path for report layers: stored engine result when it is
 * present and still speaks for the current inputs, otherwise a fresh
 * snapshot of the same engine.
 *
 * Deliberately does NOT write to the store — report generation stays
 * side-effect free. `snapshot` is returned so a caller that wants to persist
 * the refreshed result can do so explicitly.
 *
 * `opts.honorFreeze: false` makes a STALE frozen snapshot (report signed, then
 * the inputs changed) fall through to a fresh evaluation. Documents keep the
 * default; screens and proposals pass false — see `ResolveEngineOptions`.
 */
export function resolveEngineResult(
  ins: Inspection,
  now: number = Date.now(),
  opts: ResolveEngineOptions = {},
): ResolvedEngineResult {
  const freshness = storedEngineFreshness(ins, now);
  const honorFreeze = opts.honorFreeze ?? true;
  const usable = freshness.usable && !(freshness.staleFrozen && !honorFreeze);
  const stored = usable ? castStoredEngineResult(ins.storedEngineResult) : null;
  if (stored) {
    const meta = storedSnapshotMeta(ins.storedEngineResult);
    return {
      haag: stored,
      decision: legacyDecisionFromStored(ins, stored),
      at: ins.storedEngineResultAt ?? meta?.at ?? new Date(now).toISOString(),
      source: freshness.frozen ? 'frozen' : 'stored',
    };
  }
  const snapshot = snapshotEngineResult(ins, new Date(now).toISOString());
  return {
    haag: snapshot.decision.haag,
    decision: snapshot.decision,
    at: snapshot.at,
    source: 'recomputed',
    snapshot,
  };
}
