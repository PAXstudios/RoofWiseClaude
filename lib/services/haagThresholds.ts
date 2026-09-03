// HAAG material-specific replacement thresholds. Pure data + pure functions.
//
// AUTHORITY: docs/HAAG_DECISION_ENGINE.md §2 ("Replacement thresholds — per
// material"). Anything here that contradicts that document is a bug. Do not
// "simplify" these thresholds — they are what carriers argue against.
//
// PROVENANCE OF THE ASPHALT HIT COUNT (owner decision, 2026-09-03 — see
// docs/THRESHOLD_PROVENANCE.md, with sources): HAAG publishes NO hit-count
// threshold. Its test square exists to count damaged units for the
// D x U x R x A extrapolation, and its damage test is qualitative (punctures,
// tears, mat fractures). The number a slope is judged against is a CARRIER
// convention — 8 is the figure most commonly cited, 7-10 the working range —
// and the owner chose to align the app to it: 8 or more functional hits per
// 100 sq ft test square qualifies the slope, for every asphalt family.
//
// History: the code once used 8 (3-tab) / 10 (laminate); a later "correction"
// moved them to >5 / >8, which was stricter than any carrier and told roofers
// they had a case at counts adjusters reject. Do not lower these again without
// a sourced reason.

import type { RoofMaterial } from '../models/types';

/**
 * Hits-per-square is a computed RATE (total hits / test squares), so it is
 * rarely a whole number. Reports and rule citations are read by adjusters —
 * print 6.9, never 6.888888888888889.
 */
function roundRate(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

// -----------------------------------------------------------------------------
// Structured, spec-exact material rules (§2)
// -----------------------------------------------------------------------------

export type AsphaltFamily = 'three_tab' | 'laminate';

export type MaterialRule =
  | {
      kind: 'asphalt';
      family: AsphaltFamily;
      /**
       * Hail hits per 100 sq ft test square at or above this qualify the slope
       * (carrier convention: "8 hits"). Inclusive — the rate is compared with >=.
       */
      hailHitsPerSquareMin: number;
      /** Wind-damaged shingles on the slope must EXCEED this percent (spec ">5%"). */
      windDamagedShinglePercentExclusive: number;
      /** §2 additional asphalt trigger: multiple creased courses → replacement. */
      multipleCreasedCoursesTrigger: true;
      /** §2 additional asphalt trigger: widespread discontinuity → replacement. */
      widespreadDiscontinuityTrigger: true;
    }
  | {
      kind: 'wood';
      /** ≥ 5 hits per square. */
      hitsPerSquareMin: number;
      /** or ≥ 3 broken shakes. */
      brokenShakesMin: number;
    }
  | {
      kind: 'metal';
      /** > 25% of panels dented. */
      dentedPanelPercentExclusive: number;
      seamDisengagementQualifies: true;
      /** §2: cosmetic dents are note-only — never a replacement trigger. */
      cosmeticDentsNoteOnly: true;
    }
  | {
      kind: 'tile';
      /** > 10% broken tiles. */
      brokenTilePercentExclusive: number;
      underlaymentExposureQualifies: true;
      /** Clay only: ≥ 1 broken tile per square qualifies on its own. */
      brokenPerSquareMin?: number;
    }
  | {
      kind: 'membrane';
      /** > 12% puncture density per square. */
      punctureDensityPercentExclusive: number;
      displacementQualifies: true;
      puncturesQualify: true;
      adhesionFailureQualifies: true;
    };

export type HaagThreshold = {
  /**
   * Legacy-compatible field: the minimum hail-hit count per 10×10' test square
   * that qualifies under `count >= hitsPerTestSquare` semantics. Asphalt (all
   * families) 8, wood 5, clay "≥1 broken per square" ⇒ 1. 0 means the
   * material's rule is qualitative / percent-based; use `materialRule` (and
   * `evaluateMaterialThreshold`) instead of a raw count.
   */
  hitsPerTestSquare: number;
  /** Plain-English rule. Reports cite this string verbatim — keep it accurate. */
  rule: string;
  /** Structured, spec-exact rule consumed by the decision engine. */
  materialRule: MaterialRule;
};

// Both asphalt families carry the same hit count: the carrier norm does not
// distinguish 3-tab from laminate. The family is kept for report language —
// an adjuster reads "3-tab" and "architectural" as different roofs.
const ASPHALT_THREE_TAB_RULE: MaterialRule = {
  kind: 'asphalt',
  family: 'three_tab',
  hailHitsPerSquareMin: 8,
  windDamagedShinglePercentExclusive: 5,
  multipleCreasedCoursesTrigger: true,
  widespreadDiscontinuityTrigger: true,
};

const ASPHALT_LAMINATE_RULE: MaterialRule = {
  kind: 'asphalt',
  family: 'laminate',
  hailHitsPerSquareMin: 8,
  windDamagedShinglePercentExclusive: 5,
  multipleCreasedCoursesTrigger: true,
  widespreadDiscontinuityTrigger: true,
};

const WOOD_RULE: MaterialRule = {
  kind: 'wood',
  hitsPerSquareMin: 5,
  brokenShakesMin: 3,
};

const METAL_RULE: MaterialRule = {
  kind: 'metal',
  dentedPanelPercentExclusive: 25,
  seamDisengagementQualifies: true,
  cosmeticDentsNoteOnly: true,
};

const TILE_RULE: MaterialRule = {
  kind: 'tile',
  brokenTilePercentExclusive: 10,
  underlaymentExposureQualifies: true,
};

const CLAY_TILE_RULE: MaterialRule = {
  kind: 'tile',
  brokenTilePercentExclusive: 10,
  underlaymentExposureQualifies: true,
  brokenPerSquareMin: 1,
};

const MEMBRANE_RULE: MaterialRule = {
  kind: 'membrane',
  punctureDensityPercentExclusive: 12,
  displacementQualifies: true,
  puncturesQualify: true,
  adhesionFailureQualifies: true,
};

export const HAAG_THRESHOLDS: Record<RoofMaterial, HaagThreshold> = {
  three_tab_asphalt: {
    hitsPerTestSquare: 8, // carrier norm: 8 or more functional hits qualifies
    rule:
      'HAAG §2 (3-tab asphalt): 8 or more functional hail hits per 100 sq ft test square, ' +
      'or more than 5% of shingles wind-damaged on the slope, triggers replacement. ' +
      'Multiple creased courses or widespread discontinuity also trigger replacement.',
    materialRule: ASPHALT_THREE_TAB_RULE,
  },
  architectural_asphalt: {
    hitsPerTestSquare: 8, // carrier norm: 8 or more functional hits qualifies
    rule:
      'HAAG §2 (laminate/architectural asphalt): 8 or more functional hail hits per 100 sq ft test square, ' +
      'or more than 5% of shingles wind-damaged on the slope, triggers replacement. ' +
      'Multiple creased courses or widespread discontinuity also trigger replacement.',
    materialRule: ASPHALT_LAMINATE_RULE,
  },
  luxury_asphalt: {
    hitsPerTestSquare: 8,
    rule:
      'HAAG §2 (luxury asphalt, assessed under the laminate/architectural rule): 8 or more functional hail hits ' +
      'per 100 sq ft test square, or more than 5% of shingles wind-damaged on the slope, triggers replacement. ' +
      'Multiple creased courses or widespread discontinuity also trigger replacement.',
    materialRule: ASPHALT_LAMINATE_RULE,
  },
  wood_shake: {
    hitsPerTestSquare: 5, // spec: ≥ 5 hits per square
    rule:
      'HAAG §2 (wood shake): 5 or more hail hits per square, or 3 or more broken shakes, triggers replacement.',
    materialRule: WOOD_RULE,
  },
  wood_shingle: {
    hitsPerTestSquare: 5,
    rule:
      'HAAG §2 (wood shingle): 5 or more hail hits per square, or 3 or more broken shakes, triggers replacement.',
    materialRule: WOOD_RULE,
  },
  metal_standing_seam: {
    hitsPerTestSquare: 0, // qualitative: percent dented / seam disengagement
    rule:
      'HAAG §2 (metal panel): more than 25% of panels dented, or seam disengagement, triggers replacement. ' +
      'Cosmetic dents are note-only.',
    materialRule: METAL_RULE,
  },
  metal_shingle: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (metal panel): more than 25% of panels dented, or seam disengagement, triggers replacement. ' +
      'Cosmetic dents are note-only.',
    materialRule: METAL_RULE,
  },
  clay_tile: {
    hitsPerTestSquare: 1, // spec: clay — ≥ 1 broken tile per square qualifies
    rule:
      'HAAG §2 (clay tile): more than 10% broken tiles, underlayment exposure, ' +
      'or 1 or more broken tiles per square, triggers replacement.',
    materialRule: CLAY_TILE_RULE,
  },
  concrete_tile: {
    hitsPerTestSquare: 0, // percent-based
    rule:
      'HAAG §2 (concrete tile): more than 10% broken tiles, or underlayment exposure, triggers replacement.',
    materialRule: TILE_RULE,
  },
  slate: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (slate, assessed under the tile brittle-unit rule): more than 10% broken units, ' +
      'or underlayment exposure, triggers replacement.',
    materialRule: TILE_RULE,
  },
  synthetic_slate: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (synthetic slate, assessed under the tile brittle-unit rule): more than 10% broken units, ' +
      'or underlayment exposure, triggers replacement.',
    materialRule: TILE_RULE,
  },
  composite: {
    hitsPerTestSquare: 8,
    rule:
      'HAAG §2 (composite, assessed under the laminate/architectural asphalt rule): 8 or more functional hail hits ' +
      'per 100 sq ft test square, or more than 5% of shingles wind-damaged on the slope, triggers replacement.',
    materialRule: ASPHALT_LAMINATE_RULE,
  },
  rolled_roofing: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (rolled roofing, assessed under the commercial flat membrane rule): membrane displacement ' +
      'or punctures, more than 12% puncture density per square, or adhesion failure, triggers replacement.',
    materialRule: MEMBRANE_RULE,
  },
  tpo: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (commercial flat TPO): membrane displacement or punctures, more than 12% puncture density ' +
      'per square, or adhesion failure, triggers replacement.',
    materialRule: MEMBRANE_RULE,
  },
  epdm: {
    hitsPerTestSquare: 0,
    rule:
      'HAAG §2 (commercial flat EPDM): membrane displacement or punctures, more than 12% puncture density ' +
      'per square, or adhesion failure, triggers replacement.',
    materialRule: MEMBRANE_RULE,
  },
};

export function thresholdFor(material: RoofMaterial): HaagThreshold {
  return HAAG_THRESHOLDS[material];
}

// -----------------------------------------------------------------------------
// Threshold evaluation (§2) — pure. Missing observations never trigger a rule;
// the decision engine reports missing data separately as uncertainty (§9).
// -----------------------------------------------------------------------------

export type ThresholdObservation = {
  /** Hail hits in the worst 10×10' test square on the slope. */
  hailHitsPerSquare?: number;
  /** Percent (0–100) of shingles on the slope that are wind-damaged. Asphalt. */
  windDamagedShinglePercent?: number;
  /** Number of creased shingle courses. "Multiple" (≥2) triggers replacement. Asphalt. */
  creasedCourses?: number;
  /** Widespread discontinuity across the slope. Asphalt. */
  widespreadDiscontinuity?: boolean;
  /** Broken shakes (wood) or broken tiles in the worst square (tile). */
  brokenUnits?: number;
  /** Percent (0–100) of tiles/units broken on the slope. Tile/slate. */
  brokenUnitPercent?: number;
  /** Percent (0–100) of metal panels dented. */
  dentedPanelPercent?: number;
  /** Metal seam disengagement observed. */
  seamDisengagement?: boolean;
  /** Underlayment exposed (tile). */
  underlaymentExposure?: boolean;
  /** Membrane displacement observed (TPO/EPDM). */
  membraneDisplacement?: boolean;
  /** Membrane punctures observed (TPO/EPDM). */
  membranePunctures?: boolean;
  /** Percent (0–100) puncture density per square (TPO/EPDM). */
  punctureDensityPercent?: number;
  /** Membrane adhesion failure (TPO/EPDM). */
  adhesionFailure?: boolean;
};

export type ThresholdEvaluation = {
  /** True when at least one §2 replacement rule for the material fired. */
  met: boolean;
  /** Human-readable citations of exactly which rules fired ("show its work"). */
  triggeredRules: string[];
  /** Non-triggering observations worth documenting (e.g. cosmetic metal dents). */
  notes: string[];
};

export function evaluateMaterialThreshold(
  material: RoofMaterial,
  obs: ThresholdObservation = {},
): ThresholdEvaluation {
  const rule = HAAG_THRESHOLDS[material].materialRule;
  const triggeredRules: string[] = [];
  const notes: string[] = [];

  switch (rule.kind) {
    case 'asphalt': {
      const label = rule.family === 'three_tab' ? '3-tab asphalt' : 'laminate/architectural asphalt';
      if (obs.hailHitsPerSquare != null && obs.hailHitsPerSquare >= rule.hailHitsPerSquareMin) {
        triggeredRules.push(
          `${roundRate(obs.hailHitsPerSquare)} hail hits per 100 sq ft test square meets the ${label} ` +
            `threshold of ${rule.hailHitsPerSquareMin} or more (HAAG §2).`,
        );
      }
      if (
        obs.windDamagedShinglePercent != null &&
        obs.windDamagedShinglePercent > rule.windDamagedShinglePercentExclusive
      ) {
        triggeredRules.push(
          `${obs.windDamagedShinglePercent}% of shingles wind-damaged on the slope exceeds the ` +
            `more-than-${rule.windDamagedShinglePercentExclusive}% asphalt wind threshold (HAAG §2).`,
        );
      }
      if (obs.creasedCourses != null && obs.creasedCourses >= 2) {
        triggeredRules.push(
          `Multiple creased courses (${obs.creasedCourses}) — asphalt replacement trigger (HAAG §2).`,
        );
      }
      if (obs.widespreadDiscontinuity === true) {
        triggeredRules.push('Widespread discontinuity — asphalt replacement trigger (HAAG §2).');
      }
      break;
    }
    case 'wood': {
      if (obs.hailHitsPerSquare != null && obs.hailHitsPerSquare >= rule.hitsPerSquareMin) {
        triggeredRules.push(
          `${obs.hailHitsPerSquare} hits per square meets the wood threshold of ` +
            `${rule.hitsPerSquareMin} or more (HAAG §2).`,
        );
      }
      if (obs.brokenUnits != null && obs.brokenUnits >= rule.brokenShakesMin) {
        triggeredRules.push(
          `${obs.brokenUnits} broken shakes meets the wood threshold of ` +
            `${rule.brokenShakesMin} or more (HAAG §2).`,
        );
      }
      break;
    }
    case 'metal': {
      if (obs.dentedPanelPercent != null && obs.dentedPanelPercent > rule.dentedPanelPercentExclusive) {
        triggeredRules.push(
          `${obs.dentedPanelPercent}% of panels dented exceeds the metal threshold of more than ` +
            `${rule.dentedPanelPercentExclusive}% (HAAG §2).`,
        );
      }
      if (obs.seamDisengagement === true) {
        triggeredRules.push('Seam disengagement — metal replacement trigger (HAAG §2).');
      }
      if (
        obs.dentedPanelPercent != null &&
        obs.dentedPanelPercent > 0 &&
        obs.dentedPanelPercent <= rule.dentedPanelPercentExclusive &&
        obs.seamDisengagement !== true
      ) {
        notes.push(
          `Panel dents on ${obs.dentedPanelPercent}% of panels documented — cosmetic dents are ` +
            'note-only under HAAG §2 and do not trigger replacement.',
        );
      }
      break;
    }
    case 'tile': {
      if (obs.brokenUnitPercent != null && obs.brokenUnitPercent > rule.brokenTilePercentExclusive) {
        triggeredRules.push(
          `${obs.brokenUnitPercent}% broken tiles exceeds the tile threshold of more than ` +
            `${rule.brokenTilePercentExclusive}% (HAAG §2).`,
        );
      }
      if (obs.underlaymentExposure === true) {
        triggeredRules.push('Underlayment exposure — tile replacement trigger (HAAG §2).');
      }
      if (
        rule.brokenPerSquareMin != null &&
        obs.brokenUnits != null &&
        obs.brokenUnits >= rule.brokenPerSquareMin
      ) {
        triggeredRules.push(
          `${obs.brokenUnits} broken tile(s) per square meets the clay threshold of ` +
            `${rule.brokenPerSquareMin} or more broken per square (HAAG §2).`,
        );
      }
      break;
    }
    case 'membrane': {
      if (obs.membraneDisplacement === true) {
        triggeredRules.push('Membrane displacement — flat-roof replacement trigger (HAAG §2).');
      }
      if (obs.membranePunctures === true) {
        triggeredRules.push('Membrane punctures — flat-roof replacement trigger (HAAG §2).');
      }
      if (
        obs.punctureDensityPercent != null &&
        obs.punctureDensityPercent > rule.punctureDensityPercentExclusive
      ) {
        triggeredRules.push(
          `${obs.punctureDensityPercent}% puncture density per square exceeds the membrane threshold ` +
            `of more than ${rule.punctureDensityPercentExclusive}% (HAAG §2).`,
        );
      }
      if (obs.adhesionFailure === true) {
        triggeredRules.push('Adhesion failure — flat-roof replacement trigger (HAAG §2).');
      }
      break;
    }
  }

  return { met: triggeredRules.length > 0, triggeredRules, notes };
}

// -----------------------------------------------------------------------------
// Carrier bars — "state every count against both bars" (owner, 2026-09-03)
// -----------------------------------------------------------------------------
//
// The app's trigger is the carrier STANDARD (8 or more functional hits per
// 100 sq ft test square). Some carriers ask for 10, and several want the
// count on at least two slopes. A roofer should know how hard the conversation
// will be BEFORE filing, so every per-square count is stated against both the
// standard bar and the strict bar — never just "meets threshold".

/** The strict end of the carrier range, for report language only. */
export const CARRIER_STRICT_HITS_PER_SQUARE = 10;

export type CarrierBarsRead = {
  /** ≥ the material's own rule (8 for asphalt). */
  meetsStandard: boolean;
  /** ≥ the strict 10-per-square some carriers require. */
  meetsStrict: boolean;
  /** One sentence for a card or a report row. */
  line: string;
};

/**
 * One line that says where a per-square count sits against BOTH bars.
 * Only meaningful for hit-counted materials (asphalt, wood); percent-based
 * rules (metal, tile, membrane) return their §2 sentence instead.
 */
export function carrierBarsRead(material: RoofMaterial, hitsPerSquare: number): CarrierBarsRead {
  const t = HAAG_THRESHOLDS[material];
  const std = t.hitsPerTestSquare;
  if (std <= 0) {
    return { meetsStandard: false, meetsStrict: false, line: t.rule };
  }
  const meetsStandard = hitsPerSquare >= std;
  const meetsStrict = hitsPerSquare >= CARRIER_STRICT_HITS_PER_SQUARE;
  const n = roundRate(hitsPerSquare);
  let line: string;
  if (meetsStrict) {
    line = `${n} hits per square — meets the ${std}-hit standard most carriers use AND the ${CARRIER_STRICT_HITS_PER_SQUARE} some require.`;
  } else if (meetsStandard) {
    const short = CARRIER_STRICT_HITS_PER_SQUARE - hitsPerSquare;
    line = `${n} hits per square — meets the ${std}-hit standard most carriers use; ${roundRate(short)} short of the ${CARRIER_STRICT_HITS_PER_SQUARE} some require.`;
  } else {
    const short = std - hitsPerSquare;
    line = `${n} hits per square — ${roundRate(short)} short of the ${std}-hit standard most carriers use (some require ${CARRIER_STRICT_HITS_PER_SQUARE}).`;
  }
  return { meetsStandard, meetsStrict, line };
}
