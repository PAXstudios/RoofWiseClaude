// RoofWise Damage Score (RDS) — pure, deterministic, no I/O (Drift #8).
//
// AUTHORITY: docs/DAMAGE_SCORE.md (methodology) on top of
// docs/HAAG_DECISION_ENGINE.md (every threshold, gate and tree branch).
// Anything here that contradicts either document is a bug.
//
// 0–100, where 100 is a sound roof needing no storm work and 0 is the worst.
// The direction is deliberate and matches the USACE ERDC-CERL condition-index
// convention (PCI/BCI/RCI), where 100 means "free from observable distress" —
// so the number reads correctly to anyone who has seen a facility condition
// report, and HAAG's own "loss of remaining service life" framing of hail
// damage is exactly what it measures.
//
// THE ONE INVARIANT: the score is DERIVED from the decision-engine result, it
// is never a second opinion. The band comes from `roofwise_recommendation`, so
// the score cannot disagree with the verdict. This replaces the deprecated
// `damageScore()` in decisionEngine.ts, whose invented weights ran in the
// OPPOSITE direction — a severely hail-damaged roof scored LOW and read as
// "wear consistent with age".
//
// Every point deducted cites the HAAG rule that caused it: a carrier rejects a
// black-box number.

import type { RoofMaterial } from '../models/types';
import {
  engineInputFromInspection,
  runHaagDecisionEngine,
  type HaagEngineInput,
  type HaagEngineResult,
  type SlopeInput,
} from './decisionEngine';
import type { Inspection } from '../models/types';
import type { SafetyForecast } from './safetyEngine';
import {
  evaluateMaterialThreshold,
  thresholdFor,
  type MaterialRule,
  type ThresholdObservation,
} from './haagThresholds';

// -----------------------------------------------------------------------------
// Contract
// -----------------------------------------------------------------------------

export type DamageBand = 'sound' | 'serviceable' | 'compromised' | 'failed';

export const DAMAGE_BAND_LABELS: Record<DamageBand, string> = {
  sound: 'Sound',
  serviceable: 'Serviceable — repair',
  compromised: 'Compromised — partial replacement',
  failed: 'Failed — full replacement indicated',
};

/** Short plain-language meaning, for the line under the number. */
export const DAMAGE_BAND_CAPTIONS: Record<DamageBand, string> = {
  sound: 'No storm-related work indicated by the documented evidence.',
  serviceable: 'Damage is below the material replacement threshold — localized repairs.',
  compromised: 'Damage exceeds what repairs can address on the affected slopes.',
  failed: 'A HAAG threshold or repairability gate makes replacement the indicated scope.',
};

export const DAMAGE_BAND_RANGES: Record<DamageBand, readonly [number, number]> = {
  sound: [86, 100],
  serviceable: [61, 85],
  compromised: [31, 60],
  failed: [0, 30],
};

export type ScoreConfidence = 'high' | 'moderate' | 'low';

export type DamageDeduction = {
  /** Points removed from 100. Always ≥ 1 when listed; sums exactly to 100 − score. */
  points: number;
  /** The HAAG section that caused the deduction — "§2", "§3", "§4"… */
  rule: string;
  /** Plain-English reason, quoting the observation and the threshold it met. */
  reason: string;
};

export type DamageScoreResult =
  | {
      assessed: false;
      /** Why there is no score — shown verbatim in the "Not assessed" state. */
      reason: string;
      missing: string[];
    }
  | {
      assessed: true;
      /** 0–100. 100 = sound. Never rendered without `bandLabel`. */
      score: number;
      band: DamageBand;
      bandLabel: string;
      bandCaption: string;
      bandRange: readonly [number, number];
      /** Points removed from 100, each citing its HAAG rule. Sums to 100 − score. */
      deductions: DamageDeduction[];
      /** Qualifies the number — never changes it. */
      confidence: ScoreConfidence;
      /** The evidence gaps behind `confidence`, named explicitly (§9). */
      missing: string[];
      /** Labelled context that is deliberately NOT scored (roof age, cosmetic-only slopes). */
      notes: string[];
    };

/**
 * Capture evidence the §10 engine input does not carry. Optional: omit it and
 * the score still computes, with confidence reported from what the engine input
 * alone can prove. `evidenceFromInspection()` builds it from the app model.
 */
export type ScoreEvidence = {
  /** Photos captured in a 10×10 test square, per slope id (HAAG: ≥1 per direction). */
  testSquaresBySlope?: Record<string, number>;
  /** Total photos per slope id — distinguishes "nothing found" from "nothing looked at". */
  photosBySlope?: Record<string, number>;
};

// -----------------------------------------------------------------------------
// Severity components (docs/DAMAGE_SCORE.md step 2)
// -----------------------------------------------------------------------------

const WEIGHTS = { s1: 0.35, s2: 0.25, s3: 0.2, s4: 0.15, s5: 0.05 } as const;

/** All four §3 repairability gates — the denominator of S3. */
const GATE_COUNT = 4;

/** Threshold met but its magnitude never quantified: severe, not worst-case. */
const UNQUANTIFIED_EXCEEDANCE = 0.75;

const clamp01 = (n: number) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Ratio-of-threshold → 0..1 severity. At the threshold exactly (1.0×) the
 * component is 0.5; at twice the threshold and beyond it saturates at 1.0.
 * Below the threshold it scales linearly to 0. A roof does not get twice as
 * bad every time the count doubles — a 20× hit count is still one replacement.
 */
function exceedanceCurve(ratio: number): number {
  if (!Number.isFinite(ratio) || ratio <= 0) return 0;
  if (ratio <= 1) return clamp01(ratio) * 0.5;
  return clamp01(0.5 + (ratio - 1) * 0.5);
}

function observationOf(s: SlopeInput): ThresholdObservation {
  return { hailHitsPerSquare: s.hail_hits_per_square, ...(s.observation ?? {}) };
}

/**
 * §1 is authoritative: a slope flagged cosmetic-only (and not functional)
 * contributes NOTHING to severity. Cosmetic damage does not reduce
 * water-shedding capability or service life, so it must not move the number.
 */
function counts(s: SlopeInput): boolean {
  return !(s.cosmetic_only === true && s.functional_damage_present !== true);
}

function hasDocumentedDamage(s: SlopeInput): boolean {
  const obs = observationOf(s);
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

type S1Slope = {
  value: number;
  /** Populated only when a quantitative ratio was available — used for the citation. */
  citation?: string;
  /** The measurement that would have quantified this slope, when none was recorded. */
  unquantified?: string;
};

/**
 * S1 — how far past its own material's §2 threshold the worst slope is.
 *
 * The denominator is ALWAYS the material rule from haagThresholds.ts. Never
 * hardcode one here — a copied constant is how the thresholds drifted the last
 * time, and the number has changed once already (docs/THRESHOLD_PROVENANCE.md).
 */
function s1ForSlope(material: RoofMaterial, s: SlopeInput): S1Slope {
  const rule: MaterialRule = thresholdFor(material).materialRule;
  const obs = observationOf(s);
  const candidates: { ratio: number; citation: string }[] = [];
  const unquantified: string[] = [];

  switch (rule.kind) {
    case 'asphalt': {
      const label = rule.family === 'three_tab' ? '3-tab' : 'laminate/architectural';
      const limit = rule.hailHitsPerSquareMin;
      if (obs.hailHitsPerSquare != null && obs.hailHitsPerSquare > 0) {
        candidates.push({
          ratio: obs.hailHitsPerSquare / limit,
          citation:
            `${fmt(obs.hailHitsPerSquare)} hail hits per 100 sq ft test square against the ` +
            `${label} threshold of ${limit} or more (${fmt(obs.hailHitsPerSquare / limit)}×)`,
        });
      }
      break;
    }
    case 'wood': {
      if (obs.hailHitsPerSquare != null && obs.hailHitsPerSquare > 0) {
        candidates.push({
          ratio: obs.hailHitsPerSquare / rule.hitsPerSquareMin,
          citation:
            `${fmt(obs.hailHitsPerSquare)} hits per square against the wood threshold of ` +
            `${rule.hitsPerSquareMin} or more`,
        });
      }
      if (obs.brokenUnits != null && obs.brokenUnits > 0) {
        candidates.push({
          ratio: obs.brokenUnits / rule.brokenShakesMin,
          citation:
            `${obs.brokenUnits} broken shakes against the wood threshold of ` +
            `${rule.brokenShakesMin} or more`,
        });
      }
      break;
    }
    case 'metal': {
      if (obs.dentedPanelPercent != null && obs.dentedPanelPercent > 0) {
        candidates.push({
          ratio: obs.dentedPanelPercent / rule.dentedPanelPercentExclusive,
          citation:
            `${fmt(obs.dentedPanelPercent)}% of panels dented against the metal threshold of ` +
            `more than ${rule.dentedPanelPercentExclusive}%`,
        });
      } else if (obs.seamDisengagement === true) {
        unquantified.push('percent of metal panels dented');
      }
      break;
    }
    case 'tile': {
      if (obs.brokenUnitPercent != null && obs.brokenUnitPercent > 0) {
        candidates.push({
          ratio: obs.brokenUnitPercent / rule.brokenTilePercentExclusive,
          citation:
            `${fmt(obs.brokenUnitPercent)}% broken tiles against the tile threshold of more than ` +
            `${rule.brokenTilePercentExclusive}%`,
        });
      }
      if (rule.brokenPerSquareMin != null && obs.brokenUnits != null && obs.brokenUnits > 0) {
        candidates.push({
          ratio: obs.brokenUnits / rule.brokenPerSquareMin,
          citation:
            `${obs.brokenUnits} broken tile(s) per square against the clay threshold of ` +
            `${rule.brokenPerSquareMin} or more per square`,
        });
      } else if (obs.brokenUnits != null && obs.brokenUnits > 0) {
        unquantified.push('percent of broken tiles on the slope');
      }
      break;
    }
    case 'membrane': {
      if (obs.punctureDensityPercent != null && obs.punctureDensityPercent > 0) {
        candidates.push({
          ratio: obs.punctureDensityPercent / rule.punctureDensityPercentExclusive,
          citation:
            `${fmt(obs.punctureDensityPercent)}% puncture density per square against the membrane ` +
            `threshold of more than ${rule.punctureDensityPercentExclusive}%`,
        });
      } else if (obs.membranePunctures === true || obs.membraneDisplacement === true) {
        unquantified.push('puncture density per square');
      }
      break;
    }
  }

  if (candidates.length > 0) {
    const worst = candidates.reduce((a, b) => (b.ratio > a.ratio ? b : a));
    return { value: exceedanceCurve(worst.ratio), citation: worst.citation };
  }

  // The §2 rule fired on a qualitative observation (a puncture recorded as a
  // boolean, seam disengagement, underlayment exposure). Severe, but its
  // magnitude is unknown — placing it below 1.0 keeps an unquantified finding
  // from scoring as the worst case, and the gap is named in `missing`.
  const met = evaluateMaterialThreshold(material, obs).met;
  if (met) {
    return {
      value: UNQUANTIFIED_EXCEEDANCE,
      citation: 'material replacement threshold met on a qualitative observation',
      unquantified: unquantified[0],
    };
  }
  return { value: 0, unquantified: unquantified[0] };
}

/** Prints a rate the way an adjuster reads it: 6.9, never 6.888888888888889. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// -----------------------------------------------------------------------------
// The score
// -----------------------------------------------------------------------------

/**
 * Band from the §4 recommendation (docs/DAMAGE_SCORE.md step 1) — this is what
 * makes score↔verdict disagreement structurally impossible.
 *
 * One documented refinement: `NO_STORM_DAMAGE` needs a storm search that ran
 * and found nothing, so a pristine roof whose search never ran exits the §4
 * tree as `REPAIR` with nothing to repair. That case is Sound, not 61–85.
 */
function bandFor(result: HaagEngineResult): DamageBand {
  switch (result.roofwise_recommendation) {
    case 'FULL_REPLACEMENT':
      return 'failed';
    case 'PARTIAL_REPLACEMENT':
      return 'compromised';
    case 'NO_STORM_DAMAGE':
      return 'sound';
    case 'REPAIR': {
      const nothingToRepair =
        result.slope_evaluations.length > 0 &&
        result.slope_evaluations.every((e) => e.recommended_action === 'No Storm-Related Work');
      return nothingToRepair ? 'sound' : 'serviceable';
    }
  }
}

/**
 * Distributes the rounded total across the deduction items so the list sums
 * EXACTLY to 100 − score. Largest remainder: the item losing the most to
 * rounding gets the leftover point, so the arithmetic on screen is checkable.
 */
function allocatePoints(raw: { rule: string; reason: string; value: number }[], total: number): DamageDeduction[] {
  const positive = raw.filter((r) => r.value > 0);
  const sum = positive.reduce((t, r) => t + r.value, 0);
  if (positive.length === 0 || sum <= 0 || total <= 0) return [];

  const scaled = positive.map((r) => ({ ...r, exact: (r.value / sum) * total }));
  const floors = scaled.map((r) => ({ ...r, points: Math.floor(r.exact) }));
  let remainder = total - floors.reduce((t, r) => t + r.points, 0);
  const byRemainder = [...floors].sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)));
  for (let i = 0; remainder > 0 && i < byRemainder.length; i += 1, remainder -= 1) {
    byRemainder[i].points += 1;
  }
  // Order by weight of the finding, not by the allocation loop, so the report
  // reads worst-first.
  return floors
    .filter((r) => r.points > 0)
    .sort((a, b) => b.points - a.points)
    .map((r) => ({ points: r.points, rule: r.rule, reason: r.reason }));
}

/**
 * The RoofWise Damage Score. Pure and deterministic: identical input always
 * yields identical output.
 *
 * @param input  the §10 engine input the recommendation was computed from
 * @param result the engine result — the band is taken from its recommendation
 * @param evidence optional capture evidence for the confidence rating
 */
export function computeDamageScore(
  input: HaagEngineInput,
  result: HaagEngineResult,
  evidence: ScoreEvidence = {},
): DamageScoreResult {
  const { structural } = input;
  const material = structural.material_type;
  const slopes = structural.slopes;

  const missing: string[] = [];
  const notes: string[] = [];

  // ---- Not assessed: nothing documented is a STATE, never a score of 100.
  if (slopes.length === 0 || result.slope_evaluations.length === 0) {
    return {
      assessed: false,
      reason: 'No slopes documented yet — capture and analyze photos to get a damage score.',
      missing: ['No slope has been documented.'],
    };
  }
  const photoCounts = evidence.photosBySlope;
  if (photoCounts && slopes.every((s) => (photoCounts[s.slope] ?? 0) === 0)) {
    return {
      assessed: false,
      reason: 'No photos captured yet — a score with no evidence behind it would be invented.',
      missing: ['No photos captured on any slope.'],
    };
  }

  const countable = slopes.filter(counts);
  const cosmeticOnly = slopes.filter((s) => !counts(s));
  if (cosmeticOnly.length > 0) {
    notes.push(
      `${cosmeticOnly.length} slope(s) flagged cosmetic-only (§1) — cosmetic findings do not reduce ` +
        'water-shedding capability or service life and are excluded from the score.',
    );
  }

  // ---- S1: threshold exceedance on the worst slope (§2).
  let s1 = 0;
  let s1Citation: string | undefined;
  for (const s of countable) {
    const r = s1ForSlope(material, s);
    if (r.value > s1) {
      s1 = r.value;
      s1Citation = r.citation;
    }
    if (r.unquantified && hasDocumentedDamage(s)) {
      const gap = `Damage documented on "${s.slope}" but the ${r.unquantified} was never recorded — ` +
        'the §2 magnitude could not be quantified.';
      if (!missing.includes(gap)) missing.push(gap);
    }
  }

  // ---- S2: breadth (§4 escalates to FULL when functional damage spans > 2 slopes).
  const thresholdMet = countable.filter(
    (s) => evaluateMaterialThreshold(material, observationOf(s)).met,
  ).length;
  const functionalSlopes = countable.filter((s) => s.functional_damage_present === true).length;
  const qualifyingSlopes = Math.max(thresholdMet, functionalSlopes);
  const s2 = slopes.length > 0 ? clamp01(qualifyingSlopes / slopes.length) : 0;

  // ---- S3: §3 repairability gates — each one removes the repair path entirely.
  const brittleness =
    structural.brittleness_result ??
    slopes.map((s) => s.brittleness_result).find((b) => b === 'FAIL' || b === 'BORDERLINE');
  const gates: string[] = [];
  if (structural.is_discontinued === true) gates.push('material is discontinued — repairs cannot match');
  if (brittleness === 'FAIL' || brittleness === 'BORDERLINE') {
    gates.push(`brittleness test ${brittleness} — repairs not feasible`);
  }
  if (structural.layers != null && structural.layers >= 2) {
    gates.push(`${structural.layers} roofing layers — repairs often not permitted by code`);
  }
  if (structural.appearance_match_impossible === true) {
    gates.push('appearance cannot be matched — granular variation would remain visible');
  }
  const s3 = clamp01(gates.length / GATE_COUNT);

  // ---- S4: §1 hard functional markers.
  const markers: { present: boolean; label: string }[] = [
    {
      present: countable.some((s) => s.functional_damage_present === true),
      label: 'functional damage confirmed',
    },
    {
      present: countable.some((s) => s.substrate_exposure === true),
      label: 'substrate exposure',
    },
    { present: structural.mat_transfer === 'severe', label: 'severe mat transfer' },
    {
      present: countable.some((s) => (s.missing_shingles ?? 0) > 0),
      label: 'missing shingles',
    },
    {
      present: countable.some((s) => {
        const o = observationOf(s);
        return o.membranePunctures === true || o.underlaymentExposure === true || o.seamDisengagement === true;
      }),
      label: 'material breach (puncture, underlayment exposure or seam disengagement)',
    },
  ];
  const present = markers.filter((m) => m.present);
  const s4 = clamp01(present.length / markers.length);

  // ---- S5: wind and the other perils the material rule does not carry.
  let s5 = 0;
  let s5Citation = '';
  for (const s of countable) {
    const o = observationOf(s);
    const creased = s.wind_creased_count ?? 0;
    const missingShingles = s.missing_shingles ?? 0;
    const windPct = o.windDamagedShinglePercent ?? 0;
    const parts: { v: number; text: string }[] = [
      { v: windPct / 5, text: `${fmt(windPct)}% of shingles wind-damaged (§2 threshold: more than 5%)` },
      { v: creased / 3, text: `${creased} creased course(s)` },
      { v: missingShingles / 1, text: `${missingShingles} missing shingle(s)` },
    ].filter((p) => p.v > 0);
    for (const p of parts) {
      const v = clamp01(p.v);
      if (v > s5) {
        s5 = v;
        s5Citation = `${p.text} on "${s.slope}"`;
      }
    }
  }

  // ---- Position within the band.
  const band = bandFor(result);
  const [bandBottom, bandTop] = DAMAGE_BAND_RANGES[band];
  const severity = clamp01(
    WEIGHTS.s1 * s1 + WEIGHTS.s2 * s2 + WEIGHTS.s3 * s3 + WEIGHTS.s4 * s4 + WEIGHTS.s5 * s5,
  );
  const span = bandTop - bandBottom;
  const score = Math.max(bandBottom, Math.min(bandTop, Math.round(bandTop - severity * span)));

  // ---- Deductions: they cite HAAG rules and sum exactly to 100 − score.
  const withinBand: { rule: string; reason: string; value: number }[] = [
    {
      rule: '§2',
      reason: s1Citation
        ? `Worst slope measured at ${s1Citation}.`
        : 'No slope exceeded its material replacement threshold.',
      value: WEIGHTS.s1 * s1,
    },
    {
      rule: '§4',
      reason: `Qualifying damage on ${qualifyingSlopes} of ${slopes.length} documented slope(s).`,
      value: WEIGHTS.s2 * s2,
    },
    {
      rule: '§3',
      reason:
        gates.length > 0
          ? `Repairability gate(s) triggered: ${gates.join('; ')}.`
          : 'No repairability gate triggered.',
      value: WEIGHTS.s3 * s3,
    },
    {
      rule: '§1',
      reason:
        present.length > 0
          ? `Functional markers present: ${present.map((m) => m.label).join(', ')}.`
          : 'No §1 hard functional marker recorded.',
      value: WEIGHTS.s4 * s4,
    },
    {
      rule: '§2',
      reason: s5Citation ? `Wind and other perils: ${s5Citation}.` : 'No wind damage recorded.',
      value: WEIGHTS.s5 * s5,
    },
  ];

  const bandDrop = 100 - bandTop;
  const withinDrop = 100 - score - bandDrop;
  const deductions: DamageDeduction[] = [];
  if (bandDrop > 0) {
    deductions.push({ points: bandDrop, rule: '§4', reason: result.matched_rule });
  }
  deductions.push(...allocatePoints(withinBand, Math.max(0, withinDrop)));

  // ---- Confidence: qualifies the number, never changes it (docs step 3).
  const damagedSlopes = countable.filter(hasDocumentedDamage);
  const squares = evidence.testSquaresBySlope;
  const allElevations = slopes.length >= 4;
  // A test square is HAAG's unit of measurement, so "proven" means recorded on
  // every slope that carries damage — or, on a roof with no damage found, on
  // every slope, since that is what makes "we found nothing" evidence rather
  // than an absence of looking. Unknown evidence is never counted as proof.
  const squaresNeededOn = damagedSlopes.length > 0 ? damagedSlopes : countable;
  const squaresRecorded =
    squares != null &&
    squaresNeededOn.length > 0 &&
    squaresNeededOn.every((s) => (squares[s.slope] ?? 0) > 0);
  const brittlenessRecorded = brittleness != null;
  const eventVerified =
    input.weather?.verified_event_within_72h === true || input.weather?.weather_event_exists === true;

  if (!allElevations) {
    missing.push(
      `${slopes.length} slope(s) documented — HAAG calls for at least one test square per roof direction ` +
        '(4 elevations).',
    );
  }
  if (!squaresRecorded) {
    missing.push(
      damagedSlopes.length > 0
        ? 'No 10×10 test square recorded on every damaged slope — the per-square rate is the §2 threshold unit.'
        : 'No 10×10 test square recorded — without one, "no damage found" is not documented to HAAG.',
    );
  }
  if (!brittlenessRecorded) {
    missing.push('Brittleness test not recorded — a FAIL or BORDERLINE result forces full replacement (§3).');
  }
  if (!eventVerified) {
    missing.push('No verified weather event attached — storm corroboration is a §6 viability criterion.');
  }

  const satisfied =
    (allElevations ? 1 : 0) +
    (squaresRecorded ? 1 : 0) +
    (brittlenessRecorded ? 1 : 0) +
    (eventVerified ? 1 : 0);
  const confidence: ScoreConfidence = satisfied >= 4 ? 'high' : satisfied >= 2 ? 'moderate' : 'low';

  // ---- Age is CONTEXT, never a silent deduction (docs: "Age").
  // A 25-year-old undamaged roof scoring 40 on age alone would imply a claim
  // where HAAG requires wear and tear to be ruled out (§1). Age enters only
  // through the §3 gates above; here it is labelled, not scored.
  if (structural.age_of_roof != null) {
    const age = structural.age_of_roof;
    notes.push(
      age >= 15
        ? `Roof age ${age} yrs — brittleness and shingle matching commonly fail at this age. ` +
          'Test before scoping a repair (§3). Age itself does not reduce this score.'
        : `Roof age ${age} yrs. Age is not deducted from this score — it enters only through the ` +
          '§3 repairability gates.',
    );
  }

  return {
    assessed: true,
    score,
    band,
    bandLabel: DAMAGE_BAND_LABELS[band],
    bandCaption: DAMAGE_BAND_CAPTIONS[band],
    bandRange: DAMAGE_BAND_RANGES[band],
    deductions,
    confidence,
    missing,
    notes,
  };
}

// -----------------------------------------------------------------------------
// App-model entry point
// -----------------------------------------------------------------------------

/** Capture evidence from the app's Inspection model, for the confidence rating. */
export function evidenceFromInspection(inspection: Inspection): ScoreEvidence {
  const testSquaresBySlope: Record<string, number> = {};
  const photosBySlope: Record<string, number> = {};
  for (const slope of inspection.slopes) {
    photosBySlope[slope.id] = slope.photoPaths.length;
    const meta = slope.photoMeta;
    testSquaresBySlope[slope.id] =
      meta && meta.length > 0
        ? meta.filter((m) => (m.captureMode ?? 'square_10x10') === 'square_10x10').length
        : // Pre-tagging inspection: every photo counted as a square, matching
          // the same fallback the engine's per-square denominator uses.
          slope.photoPaths.length;
  }
  return { testSquaresBySlope, photosBySlope };
}

/**
 * The score for an Inspection whose engine result is ALREADY resolved — a
 * stored or frozen claim packet, say.
 *
 * This is the entry point UI surfaces should reach for. A finalized packet
 * freezes its engine result so the verdict cannot drift; deriving the score
 * from a fresh engine run instead would let the number and the verdict on the
 * same page disagree, which is the exact failure this whole design exists to
 * make impossible.
 */
export function damageScoreFromEngine(
  inspection: Inspection,
  result: HaagEngineResult,
  asOfIso?: string,
): DamageScoreResult {
  return computeDamageScore(
    engineInputFromInspection(inspection, asOfIso),
    result,
    evidenceFromInspection(inspection),
  );
}

/**
 * The score for an app Inspection — runs the engine once and derives from it.
 * Use `damageScoreFromEngine` instead wherever a resolved result is already in
 * hand; `computeDamageScore` is the pure core underneath both.
 */
export function damageScoreForInspection(
  inspection: Inspection,
  asOfIso?: string,
  forecast?: SafetyForecast,
): DamageScoreResult {
  const input = engineInputFromInspection(inspection, asOfIso, forecast);
  const result = runHaagDecisionEngine(input);
  return computeDamageScore(input, result, evidenceFromInspection(inspection));
}
