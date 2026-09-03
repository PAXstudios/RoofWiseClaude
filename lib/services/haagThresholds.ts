// HAAG material-specific replacement thresholds. Pure data + pure functions.
//
// AUTHORITY: docs/HAAG_DECISION_ENGINE.md §2 ("Replacement thresholds — per
// material"). Anything here that contradicts that document is a bug. Do not
// "simplify" these thresholds — they are what carriers argue against.
//
// Correction notice (§2): an earlier implementation used 8 hits for 3-tab and
// 10 for architectural. Both were wrong. The correct values are >5 and >8.
//
// Carrier-norm context: insurers often *ask for* 8–12 impacts per square.
// That is report-language context ONLY (see CARRIER_IMPACT_NORM_NOTE in
// decisionEngine.ts) and must NEVER be used as a threshold in this file.

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
      /** Hail hits per 100 sq ft test square must EXCEED this (spec ">5" / ">8"). */
      hailHitsPerSquareExclusive: number;
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
   * that qualifies under `count >= hitsPerTestSquare` semantics. Derived from
   * the spec's thresholds — spec ">5" ⇒ 6, ">8" ⇒ 9, wood "≥5" ⇒ 5, clay
   * "≥1 broken per square" ⇒ 1. 0 means the material's rule is
   * qualitative / percent-based; use `materialRule` (and
   * `evaluateMaterialThreshold`) instead of a raw count.
   */
  hitsPerTestSquare: number;
  /** Plain-English rule. Reports cite this string verbatim — keep it accurate. */
  rule: string;
  /** Structured, spec-exact rule consumed by the decision engine. */
  materialRule: MaterialRule;
};

const ASPHALT_THREE_TAB_RULE: MaterialRule = {
  kind: 'asphalt',
  family: 'three_tab',
  hailHitsPerSquareExclusive: 5,
  windDamagedShinglePercentExclusive: 5,
  multipleCreasedCoursesTrigger: true,
  widespreadDiscontinuityTrigger: true,
};

const ASPHALT_LAMINATE_RULE: MaterialRule = {
  kind: 'asphalt',
  family: 'laminate',
  hailHitsPerSquareExclusive: 8,
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
    hitsPerTestSquare: 6, // spec: > 5 hits ⇒ 6 is the minimum qualifying count
    rule:
      'HAAG §2 (3-tab asphalt): more than 5 hail hits per 100 sq ft test square, ' +
      'or more than 5% of shingles wind-damaged on the slope, triggers replacement. ' +
      'Multiple creased courses or widespread discontinuity also trigger replacement.',
    materialRule: ASPHALT_THREE_TAB_RULE,
  },
  architectural_asphalt: {
    hitsPerTestSquare: 9, // spec: > 8 hits ⇒ 9 is the minimum qualifying count
    rule:
      'HAAG §2 (laminate/architectural asphalt): more than 8 hail hits per 100 sq ft test square, ' +
      'or more than 5% of shingles wind-damaged on the slope, triggers replacement. ' +
      'Multiple creased courses or widespread discontinuity also trigger replacement.',
    materialRule: ASPHALT_LAMINATE_RULE,
  },
  luxury_asphalt: {
    hitsPerTestSquare: 9,
    rule:
      'HAAG §2 (luxury asphalt, assessed under the laminate/architectural rule): more than 8 hail hits ' +
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
    hitsPerTestSquare: 9,
    rule:
      'HAAG §2 (composite, assessed under the laminate/architectural asphalt rule): more than 8 hail hits ' +
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
      if (obs.hailHitsPerSquare != null && obs.hailHitsPerSquare > rule.hailHitsPerSquareExclusive) {
        triggeredRules.push(
          `${roundRate(obs.hailHitsPerSquare)} hail hits per 100 sq ft test square exceeds the ${label} ` +
            `threshold of more than ${rule.hailHitsPerSquareExclusive} (HAAG §2).`,
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
