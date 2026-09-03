// HAAG Decision Engine — pure logic, NO I/O (Drift Warning #8).
//
// AUTHORITY: docs/HAAG_DECISION_ENGINE.md. Every threshold, gate, ordering,
// and output field below comes from that document (sections cited inline).
// Anything here that contradicts it is a bug — do not "simplify".
//
// Layout:
//   1. Spec-contract types (§9, §10)
//   2. RC cost math (§5) — computed ONCE, stored; reports must never recalc
//   3. Per-slope evaluation (§1, §2, §9)
//   4. Repairability gates (§3) + roof-level decision tree (§4, first match wins)
//   5. Top-level engine (§9): runHaagDecisionEngine()
//   6. Legacy compatibility layer: evaluate()
//
// The 0-100 damage score lives in ./damageScore.ts, DERIVED from this
// engine's result (docs/DAMAGE_SCORE.md). It used to live here with invented
// weights running in the opposite direction, which is how a severely
// hail-damaged roof scored low and read as ordinary age wear.

import {
  ROOF_MATERIAL_LABELS,
  legacyBrittlenessToResult,
  type Inspection,
  type InsuranceCarrier,
  type RoofMaterial,
  type RoofRecommendation,
  type Severity,
  type Slope,
  type SlopeVerdict,
} from '../models/types';
// Pure helper only — no I/O crosses this import (Drift #8): the Triple-Check
// verdict is computed from an already-attached event, never fetched here.
import { tripleCheckDateOfLoss } from './stormMatch';
import {
  evaluateMaterialThreshold,
  thresholdFor,
  type ThresholdObservation,
} from './haagThresholds';
// Pure readers only — the measurement itself is fetched by the job flow and
// persisted on the Inspection, so no I/O crosses this import (Drift #8).
import { slopeSquares, totalSquares } from './propertyIntel';
import {
  assessClaimViability,
  carrierSpecificRequirements,
  CLAIM_VIABILITY_LABELS,
  type ClaimViabilityBand,
  type ClaimViabilityResult,
} from './claimViability';
import {
  evaluateSafety,
  type SafetyForecast,
  type SafetyRating,
  type SafetyResult,
} from './safetyEngine';

// -----------------------------------------------------------------------------
// 1. Spec-contract types (§9, §10)
// -----------------------------------------------------------------------------

export type BrittlenessResult = 'PASS' | 'FAIL' | 'BORDERLINE';
export type SlopeBrittleness = BrittlenessResult | 'NOT_TESTED';
export type MatTransfer = 'none' | 'moderate' | 'severe';

export type RoofwiseRecommendation =
  | 'FULL_REPLACEMENT'
  | 'PARTIAL_REPLACEMENT'
  | 'REPAIR'
  | 'NO_STORM_DAMAGE';

export const ROOFWISE_RECOMMENDATION_LABELS: Record<RoofwiseRecommendation, string> = {
  FULL_REPLACEMENT: 'Full Replacement',
  PARTIAL_REPLACEMENT: 'Partial Replacement',
  REPAIR: 'Repair',
  NO_STORM_DAMAGE: 'No Storm Damage',
};

export type SlopeRecommendedAction =
  | 'Full Replacement'
  | 'Partial Replacement'
  | 'Localized Repairs'
  | 'No Storm-Related Work';

export type SlopeInput = {
  /** Slope label ("Front", "North", or an id) — echoed on the evaluation. */
  slope: string;
  hail_hits_per_square?: number;
  wind_creased_count?: number;
  missing_shingles?: number;
  /**
   * AUTHORITATIVE input boolean (§1). The engine NEVER re-derives it from raw
   * counts — it is set at capture/review time, where wear and tear is ruled out.
   */
  functional_damage_present?: boolean;
  /** AUTHORITATIVE input boolean (§1). Cosmetic-only findings do not count. */
  cosmetic_only?: boolean;
  brittleness_result?: BrittlenessResult;
  substrate_exposure?: boolean;
  granule_loss_level?: Severity;
  collateral_damage?: string[];
  area_squares?: number;
  /** Material-specific observations (§2): wind %, broken units, dents, punctures… */
  observation?: ThresholdObservation;
};

export type HaagEngineInput = {
  // §10 Structural
  structural: {
    material_type: RoofMaterial;
    age_of_roof?: number;
    number_of_slopes?: number; // defaults to slopes.length
    is_discontinued?: boolean;
    layers?: number;
    mat_transfer?: MatTransfer;
    brittleness_result?: BrittlenessResult;
    /** §3 appearance gate: repair would alter appearance via granular variation. */
    appearance_match_impossible?: boolean;
    /** §4 REPAIR precondition: shingles active (seal intact, pliable). */
    shingles_active?: boolean;
    pitch?: number | string;
    square_footage?: number;
    slopes: SlopeInput[];
  };
  // §10 Weather
  weather?: {
    /** A verified hail/wind event exists relevant to the reported date of loss. */
    weather_event_exists?: boolean;
    /** Absolute hours between verified event and reported date of loss (±72h rule, §6). */
    event_hours_from_dol?: number;
    /**
     * Exact ±72h determination made upstream (§6 HIGH criterion). When set it
     * wins over `event_hours_from_dol`, which may carry rounding from display
     * paths — the Triple-Check computes this boolean from milliseconds.
     */
    verified_event_within_72h?: boolean;
    /** Months since the weather incident — two-year corroboration rule (§6). */
    months_since_event?: number;
    max_gust_speed?: number;
    hailtrace_verified?: boolean;
  };
  // §10 Insurance
  insurance?: {
    carrier?: InsuranceCarrier;
    policy_type?: 'RCV' | 'ACV';
    deductible_usd?: number;
    home_value_usd?: number;
    prior_claims_within_3_years?: boolean;
    estimate_total?: number;
  };
  // §7 Safety forecast
  forecast?: SafetyForecast;
  // §5 RC cost inputs
  costs?: {
    /**
     * RC/replacement ratio at which repair is "comparable to or exceeds the
     * practical threshold" (§5). Defaults to 1.0 (spec-literal: repair cost
     * meets or exceeds replacement). Callers may pass a lower ratio.
     */
    practical_threshold_ratio?: number;
    slopes: {
      slope: string;
      rc_inputs: RcInputs;
      replacement_cost_slope?: number;
    }[];
  };
};

/** §9 per-slope output contract. */
export type SlopeEvaluation = {
  slope: string;
  hail_hits_per_square: number;
  wind_creased_count: number;
  missing_shingles: number;
  brittleness_result: SlopeBrittleness;
  collateral_damage: string[];
  haag_threshold_triggered: boolean;
  recommended_action: SlopeRecommendedAction;
  /** Cites the specific HAAG rule triggered — the engine shows its work. */
  justification: string;
};

/** §5 RC formula inputs: RC = D × U × R × A. */
export type RcInputs = {
  damaged_units_per_square: number; // D
  unit_repair_cost: number; // U
  repair_difficulty_factor: number; // R
  area_squares: number; // A
};

export type SlopeCost = {
  slope: string;
  /** RC = D × U × R × A — computed once here (§5); reports must never recalc. */
  repair_cost_slope: number;
  inputs: RcInputs;
  replacement_cost_slope?: number;
  repair_exceeds_practical_threshold?: boolean;
  /** Narrative restating the relationship — reports restate, never recalculate. */
  comparison: string;
};

/** §9 top-level output contract (plus the narrative/trace fields §9 requires). */
export type HaagEngineResult = {
  roofwise_recommendation: RoofwiseRecommendation;
  claim_viability: ClaimViabilityBand;
  roofer_safety_rating: SafetyRating;
  policy_notes: string;
  carrier_specific_requirements: string[];
  evidence_required: string[];
  detailed_explanation: string;
  /** §9: slope-by-slope evaluation. */
  slope_evaluations: SlopeEvaluation[];
  /** §9: the list of HAAG thresholds/gates triggered. */
  haag_thresholds_triggered: string[];
  /** §9: uncertainties / recommended follow-up — missing data named explicitly. */
  uncertainties: string[];
  /** §9: insurance-adjuster narrative. */
  adjuster_narrative: string;
  /** §9: homeowner summary. */
  homeowner_summary: string;
  /** The single §3/§4 rule sentence that decided the roof-level recommendation. */
  matched_rule: string;
  /** §4 tree trace, in evaluation order — first match wins. */
  decision_path: string[];
  claim_viability_detail: ClaimViabilityResult;
  safety_detail: SafetyResult;
  /** §5 costs — stored once; report layers must never recalculate these. */
  cost_analysis?: { slopes: SlopeCost[]; roof_repair_total: number };
};

/**
 * REPORT LANGUAGE CONTEXT ONLY — never a threshold. Carriers often informally
 * look for 8–12 impacts per square; the HAAG replacement thresholds are lower
 * (>5 for 3-tab, >8 for laminate/architectural — §2, correction notice).
 * Report layers may cite this to preempt adjuster pushback. It must never
 * enter the decision tree in this file.
 */
export const CARRIER_IMPACT_NORM_NOTE =
  'Note: many carriers informally look for 8–12 impacts per test square. The HAAG ' +
  'functional-damage thresholds applied in this report are more-than-5 hits (3-tab) and ' +
  'more-than-8 hits (laminate/architectural) per 100 sq ft test square.';

// -----------------------------------------------------------------------------
// 2. RC cost math (§5) — RC = D × U × R × A, computed once and stored.
// -----------------------------------------------------------------------------

export function computeRepairCost(
  slope: string,
  inputs: RcInputs,
  replacementCostSlope?: number,
  practicalThresholdRatio: number = 1,
): SlopeCost {
  const rc =
    inputs.damaged_units_per_square *
    inputs.unit_repair_cost *
    inputs.repair_difficulty_factor *
    inputs.area_squares;

  let exceeds: boolean | undefined;
  let comparison: string;
  const rcRounded = Math.round(rc * 100) / 100;
  if (replacementCostSlope != null && replacementCostSlope > 0) {
    exceeds = rc >= replacementCostSlope * practicalThresholdRatio;
    comparison = exceeds
      ? `Repair cost $${rcRounded} (RC = D × U × R × A, HAAG §5) is comparable to or exceeds the ` +
        `practical threshold relative to the $${replacementCostSlope} replacement cost — ` +
        'recommend replacement of this slope.'
      : `Repair cost $${rcRounded} (RC = D × U × R × A, HAAG §5) is below the practical threshold ` +
        `relative to the $${replacementCostSlope} replacement cost — repair remains economically viable.`;
  } else {
    comparison =
      `Repair cost $${rcRounded} computed via RC = D × U × R × A (HAAG §5). ` +
      'Replacement cost for this slope was not provided — comparison unavailable.';
  }

  return {
    slope,
    repair_cost_slope: rc,
    inputs,
    replacement_cost_slope: replacementCostSlope,
    repair_exceeds_practical_threshold: exceeds,
    comparison,
  };
}

// -----------------------------------------------------------------------------
// 3. Per-slope evaluation (§1, §2, §9)
// -----------------------------------------------------------------------------

function slopeObservation(s: SlopeInput): ThresholdObservation {
  return { hailHitsPerSquare: s.hail_hits_per_square, ...(s.observation ?? {}) };
}

/**
 * Hits per test square is a RATE (total hits ÷ squares shot), so it is rarely a
 * whole number. Every string in this file is read by an adjuster — print 6.9,
 * never 6.888888888888889. A report that shows its arithmetic residue invites
 * the exact pushback the citation exists to prevent.
 */
function fmtRate(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * §1: a slope flagged cosmetic-only (and not functional) does not count toward
 * roof-level aggregates — "wear and tear must be ruled out before a finding
 * counts". The flags are authoritative inputs, never re-derived.
 */
function slopeCounts(s: SlopeInput): boolean {
  return !(s.cosmetic_only === true && s.functional_damage_present !== true);
}

function slopeHasObservedDamage(s: SlopeInput): boolean {
  const obs = slopeObservation(s);
  return (
    s.functional_damage_present === true ||
    (s.hail_hits_per_square ?? 0) > 0 ||
    (s.wind_creased_count ?? 0) > 0 ||
    (s.missing_shingles ?? 0) > 0 ||
    s.substrate_exposure === true ||
    (obs.brokenUnits ?? 0) > 0 ||
    (obs.brokenUnitPercent ?? 0) > 0 ||
    (obs.dentedPanelPercent ?? 0) > 0 ||
    obs.seamDisengagement === true ||
    obs.underlaymentExposure === true ||
    obs.membraneDisplacement === true ||
    obs.membranePunctures === true ||
    (obs.punctureDensityPercent ?? 0) > 0 ||
    obs.adhesionFailure === true
  );
}

function evaluateSlopeInput(
  s: SlopeInput,
  material: RoofMaterial,
  roofBrittleness: BrittlenessResult | undefined,
  gateCitation: string | null,
): SlopeEvaluation {
  const hail = s.hail_hits_per_square ?? 0;
  const creased = s.wind_creased_count ?? 0;
  const missing = s.missing_shingles ?? 0;
  const th = evaluateMaterialThreshold(material, slopeObservation(s));
  const observed = slopeHasObservedDamage(s);
  const threshold = thresholdFor(material);
  const hailText = fmtRate(hail);
  const summary = `Observed: ${hailText} hail hits/square, ${creased} creased, ${missing} missing.`;

  let action: SlopeRecommendedAction;
  let justification: string;

  if (s.cosmetic_only === true && s.functional_damage_present !== true) {
    // §1: cosmetic-only is authoritative — findings do not count.
    action = 'No Storm-Related Work';
    justification =
      `Slope flagged cosmetic-only (§1 authoritative input) — cosmetic damage does not reduce ` +
      `water-shedding capability or service life and does not count toward HAAG thresholds. ${summary}`;
    if (th.met) {
      justification +=
        ' Note: recorded counts would otherwise meet the material threshold ' +
        `(${th.triggeredRules.join(' ')}) — verify the cosmetic-only flag before finalizing.`;
    }
  } else if (gateCitation && observed) {
    action = 'Full Replacement';
    justification = `${gateCitation} ${summary}`;
    if (th.met) justification += ` Also: ${th.triggeredRules.join(' ')}`;
  } else if (th.met) {
    action = 'Full Replacement';
    justification = `${th.triggeredRules.join(' ')} ${summary}`;
  } else if (hail >= 8) {
    action = 'Full Replacement';
    justification =
      `${hailText} hail hits per square meets the decision-tree full-replacement trigger ` +
      `(hail_hits_per_square >= 8, HAAG §4). ${summary}`;
  } else if (hail >= 4) {
    action = 'Partial Replacement';
    justification =
      `${hailText} hail hits per square falls in the 4–7 partial-replacement band (HAAG §4), ` +
      `below the material replacement threshold — ${threshold.rule} ${summary}`;
  } else if (creased >= 3 || missing >= 2) {
    action = 'Partial Replacement';
    justification =
      `Wind damage (${creased} creased, ${missing} missing) exceeds the strict REPAIR preconditions ` +
      `(creased ≤ 2, missing ≤ 1, HAAG §4). ${summary}`;
  } else if (observed) {
    action = 'Localized Repairs';
    justification =
      `Damage is below the HAAG material threshold — ${threshold.rule} ` +
      `Within strict REPAIR limits (hail < 4/square, creased ≤ 2, missing ≤ 1, HAAG §4). ${summary}`;
  } else {
    action = 'No Storm-Related Work';
    justification = `No qualifying storm damage observed on this slope. ${summary}`;
  }

  for (const note of th.notes) {
    justification += ` ${note}`;
  }

  return {
    slope: s.slope,
    hail_hits_per_square: hail,
    wind_creased_count: creased,
    missing_shingles: missing,
    brittleness_result: s.brittleness_result ?? roofBrittleness ?? 'NOT_TESTED',
    collateral_damage: s.collateral_damage ?? [],
    haag_threshold_triggered: th.met,
    recommended_action: action,
    justification,
  };
}

// -----------------------------------------------------------------------------
// 4. Repairability gates (§3) + roof-level decision tree (§4)
// -----------------------------------------------------------------------------

type RoofDecision = {
  recommendation: RoofwiseRecommendation;
  matchedRule: string;
  path: string[];
  gateCitation: string | null; // hard gate that forced replacement, if any
  uncertainties: string[];
};

function decideRoof(input: HaagEngineInput): RoofDecision {
  const { structural, weather } = input;
  const slopes = structural.slopes;
  const path: string[] = [];
  const uncertainties: string[] = [];

  // §1: cosmetic-only slopes do not count toward aggregates.
  const countable = slopes.filter(slopeCounts);
  const anyFunctional = countable.some((s) => s.functional_damage_present === true);
  const functionalSlopeCount = countable.filter((s) => s.functional_damage_present === true).length;
  const maxHail = countable.reduce((m, s) => Math.max(m, s.hail_hits_per_square ?? 0), 0);
  const totalCreased = countable.reduce((t, s) => t + (s.wind_creased_count ?? 0), 0);
  const totalMissing = countable.reduce((t, s) => t + (s.missing_shingles ?? 0), 0);
  const windDamagedSlopes = countable.filter(
    (s) => (s.wind_creased_count ?? 0) > 0 || (s.missing_shingles ?? 0) > 0,
  );
  const damagedSlopes = countable.filter(slopeHasObservedDamage);
  const damageExists = damagedSlopes.length > 0;
  const thresholdMetSlopes = countable.filter(
    (s) => evaluateMaterialThreshold(structural.material_type, slopeObservation(s)).met,
  );
  const eventExists = weather?.weather_event_exists;
  const anyWidespreadDiscontinuity = countable.some(
    (s) => s.observation?.widespreadDiscontinuity === true,
  );

  const done = (recommendation: RoofwiseRecommendation, matchedRule: string, gate: string | null = null): RoofDecision => {
    path.push(`→ ${recommendation}: ${matchedRule}`);
    return { recommendation, matchedRule, path, gateCitation: gate, uncertainties };
  };

  // ---- §4 step 1: no functional damage AND no weather event → NO_STORM_DAMAGE
  if (!anyFunctional && eventExists === false) {
    path.push('§4 step 1 matched: no functional damage AND no verified weather event.');
    return done(
      'NO_STORM_DAMAGE',
      'No functional damage present and no verified weather event (HAAG §4, step 1).',
    );
  }
  path.push(
    `§4 step 1 not matched: functional damage ${anyFunctional ? 'present' : 'absent'}, ` +
      `weather event ${eventExists === true ? 'verified' : eventExists === false ? 'absent' : 'unverified'}.`,
  );
  if (eventExists == null) {
    uncertainties.push(
      'Weather event verification missing — §4 step 1 (NO_STORM_DAMAGE) could not be evaluated conclusively.',
    );
  }

  // ---- §3 repairability gates — any one overrides hit counts entirely.
  // Gate order per the §3 table: discontinued, brittleness, layers, appearance.
  // (§4 step 2, functional_damage AND is_discontinued, is subsumed by gate 1.)
  const brittleness =
    structural.brittleness_result ??
    slopes.map((s) => s.brittleness_result).find((b) => b === 'FAIL' || b === 'BORDERLINE');

  if (damageExists) {
    if (structural.is_discontinued === true) {
      path.push('§3 gate matched: discontinued material with damage present.');
      return done(
        'FULL_REPLACEMENT',
        'Repairability gate (HAAG §3 / §4 step 2): material is discontinued and damage exists — ' +
          'replacement required, repairs cannot match.',
        'Repairability gate (HAAG §3): discontinued material — replacement required, repairs cannot match.',
      );
    }
    if (brittleness === 'FAIL' || brittleness === 'BORDERLINE') {
      path.push(`§3 gate matched: brittleness test ${brittleness}.`);
      return done(
        'FULL_REPLACEMENT',
        `Repairability gate (HAAG §3): brittleness test ${brittleness} — repairs not feasible, replacement required.`,
        `Repairability gate (HAAG §3): brittleness test ${brittleness} — repairs not feasible.`,
      );
    }
    if (structural.layers != null && structural.layers >= 2) {
      path.push(`§3 gate matched: ${structural.layers} layers.`);
      return done(
        'FULL_REPLACEMENT',
        `Repairability gate (HAAG §3): ${structural.layers} roofing layers — repairs often not permitted by code, replacement required.`,
        `Repairability gate (HAAG §3): ${structural.layers} layers — repairs often not permitted by code.`,
      );
    }
    path.push('§3 hard gates not matched (discontinued / brittleness FAIL-BORDERLINE / layers ≥ 2).');
    if (structural.is_discontinued == null) {
      uncertainties.push(
        'Discontinued-material status unknown — if discontinued, the §3 gate forces full replacement.',
      );
    }
    if (brittleness == null) {
      uncertainties.push(
        'Brittleness test not performed — a FAIL or BORDERLINE result forces full replacement (§3). Recommend testing before repair work.',
      );
    }
    if (structural.layers == null) {
      uncertainties.push('Layer count unknown — 2 or more layers forces full replacement (§3).');
    }
  }

  // ---- §4 step 3: hail_hits_per_square >= 8 → FULL_REPLACEMENT
  if (maxHail >= 8) {
    path.push(`§4 step 3 matched: ${fmtRate(maxHail)} hail hits per square >= 8.`);
    return done(
      'FULL_REPLACEMENT',
      `${fmtRate(maxHail)} hail hits per test square meets the >= 8 full-replacement trigger (HAAG §4, step 3).`,
    );
  }
  path.push(`§4 step 3 not matched: max hail ${fmtRate(maxHail)}/square < 8.`);

  // ---- §4 step 4: wind_creased_shingles >= 3 AND multi_slope → FULL_REPLACEMENT
  if (totalCreased >= 3 && windDamagedSlopes.length >= 2) {
    path.push(
      `§4 step 4 matched: ${totalCreased} creased shingles across ${windDamagedSlopes.length} slopes.`,
    );
    return done(
      'FULL_REPLACEMENT',
      `${totalCreased} wind-creased shingles across ${windDamagedSlopes.length} slopes meets the ` +
        'creased >= 3 with multi-slope full-replacement trigger (HAAG §4, step 4).',
    );
  }
  path.push(
    `§4 step 4 not matched: ${totalCreased} creased total on ${windDamagedSlopes.length} wind-damaged slope(s).`,
  );

  // ---- §4 additional FULL_REPLACEMENT triggers
  if (functionalSlopeCount > 2) {
    path.push(`§4 additional trigger matched: functional damage on ${functionalSlopeCount} slopes (> 2).`);
    return done(
      'FULL_REPLACEMENT',
      `Functional damage spans ${functionalSlopeCount} slopes (more than 2) — additional full-replacement trigger (HAAG §4).`,
    );
  }
  if (structural.mat_transfer === 'severe') {
    path.push('§4 additional trigger matched: severe mat transfer.');
    return done(
      'FULL_REPLACEMENT',
      'Severe mat transfer — additional full-replacement trigger (HAAG §4).',
    );
  }
  path.push(
    `§4 additional FULL triggers not matched: functional on ${functionalSlopeCount} slope(s), ` +
      `mat transfer ${structural.mat_transfer ?? 'unknown'}.`,
  );
  if (structural.mat_transfer == null) {
    uncertainties.push('Mat-transfer severity unknown — severe mat transfer forces full replacement (§4).');
  }

  // ---- §4 step 5: hail_hits_per_square between 4 and 7 → PARTIAL_REPLACEMENT
  if (maxHail >= 4 && maxHail <= 7) {
    path.push(`§4 step 5 matched: ${fmtRate(maxHail)} hail hits per square in the 4–7 band.`);
    return done(
      'PARTIAL_REPLACEMENT',
      `${fmtRate(maxHail)} hail hits per test square falls in the 4–7 partial-replacement band (HAAG §4, step 5).`,
    );
  }
  path.push(`§4 step 5 not matched: max hail ${fmtRate(maxHail)}/square outside 4–7.`);

  // ---- §4 step 6: isolated single-slope wind damage → PARTIAL_REPLACEMENT
  if (windDamagedSlopes.length === 1) {
    path.push(`§4 step 6 matched: wind damage isolated to slope "${windDamagedSlopes[0].slope}".`);
    return done(
      'PARTIAL_REPLACEMENT',
      `Isolated single-slope wind damage on "${windDamagedSlopes[0].slope}" (HAAG §4, step 6).`,
    );
  }
  path.push(`§4 step 6 not matched: wind damage on ${windDamagedSlopes.length} slopes.`);

  // ---- §4 additional PARTIAL triggers: threshold met on 1–2 slopes; age < 7 with isolated damage
  if (thresholdMetSlopes.length >= 1 && thresholdMetSlopes.length <= 2) {
    path.push(
      `§4 additional partial trigger matched: material threshold met on ${thresholdMetSlopes.length} slope(s).`,
    );
    return done(
      'PARTIAL_REPLACEMENT',
      `Damage meets the HAAG material threshold but is isolated to ${thresholdMetSlopes.length} slope(s) (HAAG §4).`,
    );
  }
  if (
    structural.age_of_roof != null &&
    structural.age_of_roof < 7 &&
    damagedSlopes.length >= 1 &&
    damagedSlopes.length <= 2
  ) {
    path.push(
      `§4 additional partial trigger matched: roof age ${structural.age_of_roof} < 7 years with isolated damage.`,
    );
    return done(
      'PARTIAL_REPLACEMENT',
      `Roof age ${structural.age_of_roof} years (< 7) with damage isolated to ${damagedSlopes.length} slope(s) (HAAG §4).`,
    );
  }

  // ---- §4 REPAIR — requires ALL strict preconditions.
  const failedPreconditions: string[] = [];
  if (!(maxHail < 4)) failedPreconditions.push(`hail < 4 per square (observed ${fmtRate(maxHail)})`);
  if (!(totalCreased <= 2)) failedPreconditions.push(`creased ≤ 2 (observed ${totalCreased})`);
  if (!(totalMissing <= 1)) failedPreconditions.push(`missing ≤ 1 (observed ${totalMissing})`);
  if (!(damagedSlopes.length <= 2) || anyWidespreadDiscontinuity) {
    failedPreconditions.push(
      `damage isolated (observed on ${damagedSlopes.length} slopes` +
        `${anyWidespreadDiscontinuity ? ', widespread discontinuity present' : ''})`,
    );
  }
  if (structural.shingles_active === false) failedPreconditions.push('shingles active (reported inactive)');
  if (countable.some((s) => s.substrate_exposure === true)) {
    failedPreconditions.push('no substrate exposure (substrate exposure observed)');
  }
  if (structural.shingles_active == null && damageExists) {
    uncertainties.push(
      'Shingle activity (seal/pliability) not confirmed — REPAIR requires active shingles (§4). Verify before finalizing a repair scope.',
    );
  }
  if (damageExists && countable.every((s) => s.substrate_exposure == null)) {
    uncertainties.push(
      'Substrate exposure not recorded — REPAIR requires no substrate exposure (§4). Verify before finalizing a repair scope.',
    );
  }

  if (failedPreconditions.length === 0) {
    path.push('§4 REPAIR preconditions all satisfied: hail < 4/square, creased ≤ 2, missing ≤ 1, damage isolated, shingles active, no substrate exposure.');
    return done(
      'REPAIR',
      damageExists
        ? 'All strict REPAIR preconditions satisfied — hail < 4 per square, creased ≤ 2, missing ≤ 1, damage isolated, shingles active, no substrate exposure (HAAG §4).'
        : 'No qualifying storm damage found; no threshold or gate triggered (HAAG §4).',
    );
  }
  path.push(`§4 REPAIR preconditions failed: ${failedPreconditions.join('; ')}.`);
  return done(
    'PARTIAL_REPLACEMENT',
    `REPAIR is not permitted — failed strict preconditions: ${failedPreconditions.join('; ')} (HAAG §4). ` +
      'Partial replacement recommended.',
  );
}

// -----------------------------------------------------------------------------
// 5. Top-level engine (§9)
// -----------------------------------------------------------------------------

export function runHaagDecisionEngine(input: HaagEngineInput): HaagEngineResult {
  const { structural, weather, insurance } = input;
  const material = structural.material_type;

  // Roof-level decision first (gates inform per-slope justifications).
  let decision = decideRoof(input);

  // §3 appearance gate: elevates REPAIR to PARTIAL_REPLACEMENT.
  if (decision.recommendation === 'REPAIR' && structural.appearance_match_impossible === true) {
    decision = {
      ...decision,
      recommendation: 'PARTIAL_REPLACEMENT',
      matchedRule:
        'Repairability gate (HAAG §3): repair would alter appearance via granular variation — partial replacement.',
      path: [
        ...decision.path,
        '§3 appearance gate applied: repair would alter appearance — elevated to PARTIAL_REPLACEMENT.',
      ],
    };
  }

  // Per-slope evaluations (§9).
  const slopeEvaluations = structural.slopes.map((s) =>
    evaluateSlopeInput(s, material, structural.brittleness_result, decision.gateCitation),
  );

  const uncertainties = [...decision.uncertainties];
  for (const s of structural.slopes) {
    if (s.functional_damage_present == null) {
      uncertainties.push(
        `Slope "${s.slope}": functional_damage_present not recorded (§1 authoritative flag) — treated as not confirmed; confidence reduced.`,
      );
    }
  }

  // §2 thresholds and §3 gates triggered — the "show its work" list.
  const thresholdsTriggered: string[] = [];
  for (const s of structural.slopes) {
    const th = evaluateMaterialThreshold(material, slopeObservation(s));
    for (const rule of th.triggeredRules) {
      thresholdsTriggered.push(`Slope "${s.slope}": ${rule}`);
    }
  }
  if (decision.gateCitation) thresholdsTriggered.push(decision.gateCitation);

  // §6 claim viability — a band, never a number.
  const anyThresholdMet = slopeEvaluations.some((e) => e.haag_threshold_triggered);
  const anyFunctional = structural.slopes.some(
    (s) => slopeCounts(s) && s.functional_damage_present === true,
  );
  const damageExists = structural.slopes.some((s) => slopeCounts(s) && slopeHasObservedDamage(s));
  const allCosmetic =
    structural.slopes.length > 0 && structural.slopes.every((s) => !slopeCounts(s));
  const anyCollateral = structural.slopes.some((s) => (s.collateral_damage ?? []).length > 0);

  const viability = assessClaimViability({
    event_exists: weather?.weather_event_exists,
    event_hours_from_dol: weather?.event_hours_from_dol,
    verified_event_within_72h: weather?.verified_event_within_72h,
    haag_thresholds_met: anyThresholdMet,
    borderline_damage: !anyThresholdMet && damageExists,
    functional_damage_confirmed: anyFunctional,
    is_discontinued: structural.is_discontinued,
    policy_type: insurance?.policy_type,
    deductible_usd: insurance?.deductible_usd,
    home_value_usd: insurance?.home_value_usd,
    prior_claims_within_3_years: insurance?.prior_claims_within_3_years,
    carrier: insurance?.carrier,
    wear_and_tear_only: anyFunctional ? false : allCosmetic ? true : undefined,
    collateral_damage_present: anyCollateral || undefined,
    months_since_event: weather?.months_since_event,
  });
  uncertainties.push(...viability.uncertainty_notes);

  // §7 safety — pre-inspection go/no-go from the forecast.
  const safety = evaluateSafety(input.forecast ?? {});
  if (input.forecast == null) {
    uncertainties.push(
      'Forecast data missing — safety rating degraded to USE_CAUTION (§7); verify conditions before climbing.',
    );
  }

  // §5 RC costs — computed ONCE and stored. Reports must never recalculate.
  let cost_analysis: HaagEngineResult['cost_analysis'];
  if (input.costs && input.costs.slopes.length > 0) {
    const ratio = input.costs.practical_threshold_ratio ?? 1;
    const slopeCosts = input.costs.slopes.map((c) =>
      computeRepairCost(c.slope, c.rc_inputs, c.replacement_cost_slope, ratio),
    );
    cost_analysis = {
      slopes: slopeCosts,
      roof_repair_total: slopeCosts.reduce((t, c) => t + c.repair_cost_slope, 0),
    };
  }

  // Policy notes (§6, §9).
  const policyParts: string[] = [];
  if (insurance?.policy_type === 'RCV') {
    policyParts.push('Policy is RCV (replacement cost value) — supports full recovery (§6).');
  } else if (insurance?.policy_type === 'ACV') {
    policyParts.push('Policy is ACV-only — depreciation reduces payout; claim viability degraded (§6).');
  } else {
    policyParts.push('Policy type (RCV vs ACV) not provided.');
  }
  if (insurance?.deductible_usd != null && insurance?.home_value_usd != null && insurance.home_value_usd > 0) {
    const pct = (insurance.deductible_usd / insurance.home_value_usd) * 100;
    policyParts.push(
      `Deductible is ${pct.toFixed(1)}% of home value (${pct <= 2 ? 'within' : 'above'} the 2% §6 ceiling).`,
    );
  } else {
    policyParts.push('Deductible as a percent of home value could not be verified.');
  }
  if (insurance?.prior_claims_within_3_years === true) {
    policyParts.push('Prior claim within the last 3 years — degrades claim viability (§6).');
  }
  if (weather?.months_since_event != null) {
    policyParts.push(
      weather.months_since_event > 24
        ? `Weather incident is ${weather.months_since_event} months old — beyond the two-year corroboration maximum (§6).`
        : `Weather incident is ${weather.months_since_event} months old — within the two-year corroboration window (§6).`,
    );
  }
  if (structural.is_discontinued === true) {
    policyParts.push('Material is discontinued — repairs cannot match; strengthens replacement claim (§3, §6).');
  }

  // Evidence required (§1, §3, §6, §11).
  const evidence: string[] = [
    '10×10 ft test-square photos on each primary slope (front, back, left, right), 2–3 photos per square (HAAG capture methodology, §11).',
  ];
  if ((structural.slopes.some((s) => (s.hail_hits_per_square ?? 0) > 0)) || anyThresholdMet) {
    evidence.push(
      'Chalked close-ups of counted hail hits showing mat fracture or substrate exposure — functional damage, not cosmetic (§1).',
    );
  }
  if (structural.slopes.some((s) => (s.wind_creased_count ?? 0) > 0 || (s.missing_shingles ?? 0) > 0)) {
    evidence.push('Photos of creased, torn, flapped, or missing shingles documenting wind damage (§1).');
  }
  const brittlenessKnown =
    structural.brittleness_result != null || structural.slopes.some((s) => s.brittleness_result != null);
  if (!brittlenessKnown && damageExists) {
    evidence.push('Brittleness test result — FAIL or BORDERLINE forces replacement (§3).');
  }
  if (anyCollateral) {
    evidence.push(
      'Collateral damage photos (soft metals, vents, gutters) — valid corroboration only within two years of the weather incident (§6).',
    );
  }
  evidence.push('Verified weather event report within ±72 hours of the reported date of loss (§6).');

  const carrierReqs = carrierSpecificRequirements(insurance?.carrier);

  // Narratives (§9).
  const recLabel = ROOFWISE_RECOMMENDATION_LABELS[decision.recommendation];
  const adjusterNarrative =
    `Material: ${ROOF_MATERIAL_LABELS[material]}. Roof-level recommendation: ${recLabel}. ${decision.matchedRule} ` +
    (thresholdsTriggered.length > 0
      ? `HAAG thresholds/gates triggered: ${thresholdsTriggered.join(' ')} `
      : 'No HAAG material thresholds were triggered. ') +
    (anyFunctional
      ? 'Functional damage — reduced water-shedding capability or service life — is confirmed (§1). '
      : 'Functional damage is not confirmed (§1). ') +
    `Claim viability: ${CLAIM_VIABILITY_LABELS[viability.band]}.`;

  const homeownerSummary =
    decision.recommendation === 'FULL_REPLACEMENT'
      ? `Our HAAG-protocol inspection found storm damage that qualifies your roof for full replacement. ${decision.matchedRule}`
      : decision.recommendation === 'PARTIAL_REPLACEMENT'
        ? `Our HAAG-protocol inspection found storm damage on part of your roof. ${decision.matchedRule}`
        : decision.recommendation === 'REPAIR'
          ? 'Our HAAG-protocol inspection found limited damage that can be addressed with targeted repairs.'
          : 'Our HAAG-protocol inspection found no storm-related damage requiring work at this time.';

  const detailedExplanation = [
    `Recommendation: ${recLabel}. ${decision.matchedRule}`,
    `Decision path (HAAG §4, first match wins): ${decision.path.join(' | ')}`,
    thresholdsTriggered.length > 0
      ? `Thresholds/gates triggered: ${thresholdsTriggered.join(' ')}`
      : 'No HAAG §2 material thresholds and no §3 repairability gates were triggered.',
    `Claim viability ${viability.band}: ${viability.reasons.join(' ')}`,
    `Safety (${safety.rating}): ${safety.reasons.join(' ')}`,
    uncertainties.length > 0
      ? `Uncertainties / recommended follow-up: ${uncertainties.join(' ')}`
      : 'No outstanding data gaps.',
  ].join('\n');

  return {
    roofwise_recommendation: decision.recommendation,
    claim_viability: viability.band,
    roofer_safety_rating: safety.rating,
    policy_notes: policyParts.join(' '),
    carrier_specific_requirements: carrierReqs,
    evidence_required: evidence,
    detailed_explanation: detailedExplanation,
    slope_evaluations: slopeEvaluations,
    haag_thresholds_triggered: thresholdsTriggered,
    uncertainties,
    adjuster_narrative: adjusterNarrative,
    homeowner_summary: homeownerSummary,
    matched_rule: decision.matchedRule,
    decision_path: decision.path,
    claim_viability_detail: viability,
    safety_detail: safety,
    cost_analysis,
  };
}

// -----------------------------------------------------------------------------
// 6. Legacy compatibility layer
// -----------------------------------------------------------------------------
// Existing callers (app/job/[id].tsx, app/inspections.tsx, haagPdf.ts,
// proposalGenerator.ts) consume this shape. It is now a thin wrapper over
// runHaagDecisionEngine(); the full §9 contract rides along as `haag`.

export type PerSlopeResult = {
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
  /** Full HAAG §9 engine result — new surfaces should read this. */
  haag: HaagEngineResult;
};

function avgConfidence(slope: Slope): number {
  if (slope.damage.length === 0) return 0;
  return slope.damage.reduce((sum, m) => sum + m.confidence, 0) / slope.damage.length;
}

const ACTION_TO_VERDICT: Record<SlopeRecommendedAction, SlopeVerdict> = {
  'Full Replacement': 'full_replace',
  'Partial Replacement': 'partial_replace',
  'Localized Repairs': 'repair',
  'No Storm-Related Work': 'repair',
};

function monthsBetweenIso(fromIso: string, toIso: string): number | undefined {
  const from = Date.parse(fromIso);
  const to = Date.parse(toIso);
  if (Number.isNaN(from) || Number.isNaN(to)) return undefined;
  return Math.max(0, (to - from) / (1000 * 60 * 60 * 24 * 30.44));
}

/**
 * Maps the legacy per-slope counters onto §2 material observations. The app's
 * capture flow records qualifying unit damage under `hailCount` for every
 * material — for tile that marker is a broken tile, for membranes a puncture.
 * Metal dents are deliberately NOT mapped to a trigger: §2 makes cosmetic
 * dents note-only (the pre-rewrite engine wrongly qualified any metal hit).
 *
 * Exported so report surfaces that cite §2 rules (haagPdf Section C) evaluate
 * the SAME observation the engine did — a report must never contradict the
 * stored engine booleans by re-deriving from a thinner observation.
 */
export function legacyObservation(material: RoofMaterial, slope: Slope): ThresholdObservation | undefined {
  // §2 material rules are PER TEST SQUARE (`brokenPerSquareMin`, puncture
  // counts), so they take the same denominator `hail_hits_per_square` does:
  // square-mode hits only, with the untagged legacy count as the fallback.
  // Feeding raw `hailCount` here would let a single-shingle close-up trip a
  // per-square tile/membrane threshold it never met.
  const perSquareHits = slope.squareHitCount ?? slope.hailCount;
  switch (material) {
    case 'clay_tile':
    case 'concrete_tile':
    case 'slate':
    case 'synthetic_slate':
      // Legacy hail markers on tile-family roofs are cracked/broken units.
      return perSquareHits > 0 ? { brokenUnits: perSquareHits } : undefined;
    case 'tpo':
    case 'epdm':
    case 'rolled_roofing':
      // Legacy hail markers on membranes are punctures (the only thing the
      // capture flow counts there); missing sections imply displacement.
      if (perSquareHits > 0 || slope.missingCount > 0) {
        return {
          membranePunctures: perSquareHits > 0 ? true : undefined,
          membraneDisplacement: slope.missingCount > 0 ? true : undefined,
        };
      }
      return undefined;
    case 'metal_standing_seam':
    case 'metal_shingle':
      // Missing/displaced panels imply seam disengagement; dents stay note-only.
      return slope.missingCount > 0 ? { seamDisengagement: true } : undefined;
    default:
      return undefined;
  }
}

/**
 * Builds the §10 engine input from the app's Inspection model.
 *
 * `forecast` (§7) must be fetched by the async caller and passed in — the
 * engine stays I/O-free (Drift #8). Pass `undefined`, never `{}`, when the
 * forecast is unavailable: `evaluateSafety({})` rates USE_CAUTION purely from
 * missing inputs, which would launder "we don't know" into a rating.
 */
/**
 * HAAG §2's threshold is hits per ONE 100 sq ft test square — a RATE, not a total.
 *
 * `squareHitCount` / `hailCount` are slope TOTALS (every hail marker across every
 * photo, recounted by the store's `withRecount`). Feeding a total straight in made
 * the engine read a 9-photo slope carrying 62 hits as "62 hits per test square",
 * which both over-called damage (any slope with more photos than hits-per-photo
 * crossed the threshold) and printed an arithmetically false sentence into the
 * report: "62 hail hits per 100 sq ft test square". The true value there is 62/9 ≈ 6.9.
 *
 * Divide by the number of test squares actually shot. Photos with no recorded
 * capture mode count as squares, matching `withRecount`'s bucketing default, so
 * inspections captured before mode tagging behave as they did. Single-shingle
 * close-ups are excluded from BOTH numerator and denominator (§2: several bruises
 * on one shingle are not several hits in a square).
 */
function hailHitsPerSquare(s: Slope): number {
  const total = s.squareHitCount ?? s.hailCount ?? 0;
  if (total <= 0) return 0;

  const meta = s.photoMeta;
  const squares =
    meta && meta.length > 0
      ? meta.filter((m) => (m.captureMode ?? 'square_10x10') === 'square_10x10').length
      : // No per-photo metadata (pre-tagging inspection): every photo is a square.
        s.photoPaths.length;

  // A slope with hits but no countable square still reports the raw total rather
  // than dividing by zero — over-stating is caught by review, inventing is not.
  if (squares < 1) return total;
  return total / squares;
}

export function engineInputFromInspection(
  inspection: Inspection,
  asOfIso?: string,
  forecast?: SafetyForecast,
): HaagEngineInput {
  // Insurance Claim mode records the field protocol (result + mandatory
  // photos); it wins over the legacy quick-capture chip. The legacy mapping
  // handles the 'borderline' member added for claim mode — BORDERLINE gates
  // repairs exactly like FAIL (§3/§4).
  const brittleness: BrittlenessResult | undefined =
    inspection.brittlenessProtocol?.result ??
    legacyBrittlenessToResult(inspection.brittlenessTest);

  const collateral = Object.entries(inspection.collateralChecklist ?? {})
    .filter(([, checked]) => checked)
    .map(([item]) => item);

  // Triple-Check (§6): pure DOL-vs-event corroboration. The reported date of
  // loss (claim mode) is checked against the attached NOAA event; without a
  // reported DOL the event date itself is the best available anchor.
  const reportedDol = inspection.dateOfLoss ?? inspection.event?.date;
  const tripleCheck =
    reportedDol && inspection.event
      ? tripleCheckDateOfLoss({
          reportedDateOfLoss: reportedDol,
          events: [inspection.event],
        })
      : undefined;
  const eventHoursFromDol =
    tripleCheck?.daysFromDol != null ? Math.abs(tripleCheck.daysFromDol) * 24 : undefined;

  // Roof area, from the aerial measurement or whatever the inspector entered.
  // §5's RC = D x U x R x A is identically zero without A, so an unmeasured
  // roof must leave these UNDEFINED rather than pass 0 — a real zero would
  // report "$0 to repair" as if it were a finding (Drift #5).
  const roofSquares = totalSquares(inspection);

  return {
    structural: {
      material_type: inspection.material,
      age_of_roof: inspection.ageYears,
      number_of_slopes: inspection.slopes.length,
      square_footage: roofSquares != null ? roofSquares * 100 : undefined,
      brittleness_result: brittleness,
      // is_discontinued / layers / mat_transfer are not captured by the legacy
      // model — left undefined so the engine reports them as uncertainty (§9)
      // instead of silently assuming.
      slopes: inspection.slopes.map((s, i) => ({
        slope: s.id,
        // Only hits captured in a 10x10 test square are the per-square
        // denominator. `squareHitCount` is written by analyzeSlope once photos
        // carry a capture mode; `hailCount` (every marker, both modes) is the
        // fallback for inspections captured before mode tagging existed.
        // Never sum the two — a single-shingle close-up is several bruises on
        // ONE shingle, not several hits in a square (HAAG §2).
        hail_hits_per_square: hailHitsPerSquare(s),
        wind_creased_count: s.windLiftCount,
        missing_shingles: s.missingCount,
        // §1 authoritative flag, mapped from the legacy `functional` boolean.
        functional_damage_present: s.functional,
        // The legacy model has no independent cosmetic flag — left undefined
        // (unknown) so raw counts still drive the §4 tree.
        collateral_damage: i === 0 ? collateral : [],
        // Per-slope area (§5's A): hand-entered wins, then the aerial
        // measurement for that elevation, then undefined.
        area_squares: slopeSquares(inspection, s),
        observation: legacyObservation(inspection.material, s),
      })),
    },
    weather: {
      // §4 step 1 needs a real `false` to fire NO_STORM_DAMAGE (and §6 needs it
      // for the no-event LOW band). Absence of an attached event is not proof
      // of no event — only a storm search that ran and genuinely found nothing
      // (`stormSearchOutcome === 'no_match'`) passes `false`; an unattached
      // event with no search (or an unreachable service) stays `undefined`.
      weather_event_exists: inspection.event
        ? true
        : inspection.stormSearchOutcome === 'no_match'
          ? false
          : undefined,
      event_hours_from_dol: eventHoursFromDol,
      // Exact ±72h boolean from the Triple-Check (computed from milliseconds);
      // wins over the display-rounded hours above in the §6 HIGH criterion.
      verified_event_within_72h: tripleCheck?.withinWindow72h,
      months_since_event:
        inspection.event && asOfIso ? monthsBetweenIso(inspection.event.date, asOfIso) : undefined,
      max_gust_speed: inspection.event?.windSpeedMph,
    },
    insurance: {
      carrier: inspection.carrier,
      policy_type: inspection.policyType,
      deductible_usd: inspection.deductible,
      home_value_usd: inspection.homeValue,
      prior_claims_within_3_years: inspection.priorClaimsWithin3Years,
    },
    forecast,
  };
}

/**
 * Legacy entry point — same signature and result shape as before, now backed by
 * the spec-exact engine. `asOfIso` (optional, ISO 8601) enables the two-year
 * corroboration check without the engine reading the clock (Drift #8 purity).
 */
export function evaluate(
  inspection: Inspection,
  asOfIso?: string,
  forecast?: SafetyForecast,
): DecisionEngineResult {
  const haag = runHaagDecisionEngine(engineInputFromInspection(inspection, asOfIso, forecast));
  const evalBySlope = new Map(haag.slope_evaluations.map((e) => [e.slope, e]));

  const perSlope: PerSlopeResult[] = inspection.slopes.map((slope) => {
    const evaluation = evalBySlope.get(slope.id);
    const confidenceAvg = avgConfidence(slope);
    let verdict: SlopeVerdict = evaluation ? ACTION_TO_VERDICT[evaluation.recommended_action] : 'repair';
    let reasoning = evaluation?.justification ?? 'No evaluation available for this slope.';

    // Low-confidence flag — app-level QA overlay, kept from the original engine.
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
        : 'repair'; // REPAIR and NO_STORM_DAMAGE both map to the legacy 'repair'

  let roofVerdictReasoning =
    haag.roofwise_recommendation === 'NO_STORM_DAMAGE'
      ? `No storm-related work recommended. ${haag.matched_rule}`
      : haag.matched_rule;
  if (flaggedForReview) {
    roofVerdictReasoning += ' One or more slopes flagged for inspector verification.';
  }

  return {
    perSlope,
    roofRecommendation,
    roofVerdictReasoning,
    verifyWithInspector: flaggedForReview,
    haag,
  };
}

// Re-exports so report layers can cite bands/ratings without extra imports.
export { CLAIM_VIABILITY_LABELS } from './claimViability';
export type { ClaimViabilityBand } from './claimViability';
export { SAFETY_RATING_LABELS } from './safetyEngine';
export type { SafetyRating, SafetyForecast } from './safetyEngine';
