// Claim Viability engine — qualitative HIGH / MEDIUM / LOW band. Pure logic,
// NO I/O (Drift Warning #8).
//
// AUTHORITY: docs/HAAG_DECISION_ENGINE.md §6 (Claim Viability) and §8
// (carrier-specific behavior).
//
// This is a BAND, never a 0–100 number (§6: "qualitative, not a 0–100 score").
// It replaces the deprecated numeric damageScore()/claimWorthiness() pair in
// decisionEngine.ts.
//
// Missing inputs degrade the band honestly and are listed in
// `uncertainty_notes` — never silently assumed (§9).

import type { InsuranceCarrier } from '../models/types';

export type ClaimViabilityBand = 'HIGH' | 'MEDIUM' | 'LOW';

export const CLAIM_VIABILITY_LABELS: Record<ClaimViabilityBand, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

/** §6: collateral damage corroboration expires two years after the weather incident. */
export const CORROBORATION_MAX_MONTHS = 24;

/** §6: HIGH requires deductible ≤ 2% of home value. */
export const DEDUCTIBLE_MAX_PERCENT_OF_HOME_VALUE = 2;

/** §6: verified event must fall within ±72 hours of the reported date of loss. */
export const DOL_WINDOW_HOURS = 72;

// -----------------------------------------------------------------------------
// Carrier behavior (§8)
// -----------------------------------------------------------------------------

export type CarrierPosture = 'strict' | 'strict_dol' | 'permissive';

export type CarrierBehavior = {
  posture: CarrierPosture;
  /** Verbatim §8 behavior note. */
  note: string;
  /** Documentation requirements derived from the §8 behavior. */
  requirements: string[];
};

export const CARRIER_BEHAVIOR: Partial<Record<InsuranceCarrier, CarrierBehavior>> = {
  state_farm: {
    posture: 'strict',
    note: 'Denies borderline hail; requires extreme documentation.',
    requirements: [
      'State Farm: provide extreme documentation — chalked test-square photos, per-hit close-ups, and above-threshold counts stated explicitly. Borderline hail is routinely denied.',
    ],
  },
  allstate: {
    posture: 'strict',
    note: 'Requires functional-bruise confirmation.',
    requirements: [
      'Allstate: confirm functional bruising — close-up photos showing mat fracture at representative hits.',
    ],
  },
  usaa: {
    posture: 'strict',
    note: 'Heavy emphasis on wind uplift.',
    requirements: [
      'USAA: document wind uplift evidence (creased, lifted, torn, or missing shingles) in detail.',
    ],
  },
  texas_farm_bureau: {
    posture: 'permissive',
    note: 'More permissive on hail claims.',
    requirements: ['Farm Bureau: more permissive on hail claims — standard HAAG documentation.'],
  },
  oklahoma_farm_bureau: {
    posture: 'permissive',
    note: 'More permissive on hail claims.',
    requirements: ['Farm Bureau: more permissive on hail claims — standard HAAG documentation.'],
  },
  kansas_farm_bureau: {
    posture: 'permissive',
    note: 'More permissive on hail claims.',
    requirements: ['Farm Bureau: more permissive on hail claims — standard HAAG documentation.'],
  },
  erie: {
    posture: 'strict_dol',
    note: 'Strict on date-of-loss matching.',
    requirements: [
      'Erie: match the date of loss exactly to a verified weather event — Erie is strict on date-of-loss matching.',
    ],
  },
};

/** Documentation requirements for the §9 `carrier_specific_requirements` output. */
export function carrierSpecificRequirements(carrier?: InsuranceCarrier): string[] {
  if (!carrier) return [];
  return CARRIER_BEHAVIOR[carrier]?.requirements ?? [];
}

// -----------------------------------------------------------------------------
// Claim viability assessment (§6)
// -----------------------------------------------------------------------------

export type ClaimViabilityInput = {
  /** A verified hail/wind event exists relevant to the reported date of loss. */
  event_exists?: boolean;
  /** Absolute hours between the verified event and the reported date of loss. */
  event_hours_from_dol?: number;
  /** Shortcut when the ±72h determination was made upstream. */
  verified_event_within_72h?: boolean;
  /** HAAG §2 replacement thresholds met (from the decision engine). */
  haag_thresholds_met?: boolean;
  /** Damage counts are borderline (near but under threshold). */
  borderline_damage?: boolean;
  /** Functional damage confirmed (§1 authoritative boolean, roof level). */
  functional_damage_confirmed?: boolean;
  /** Roofing material is discontinued. */
  is_discontinued?: boolean;
  policy_type?: 'RCV' | 'ACV';
  deductible_usd?: number;
  home_value_usd?: number;
  prior_claims_within_3_years?: boolean;
  carrier?: InsuranceCarrier;
  /** Findings are wear-and-tear only (no storm-caused damage). */
  wear_and_tear_only?: boolean;
  /** Collateral damage observed (soft metals, vents, gutters, etc.). */
  collateral_damage_present?: boolean;
  /** Months elapsed since the weather incident — two-year corroboration rule. */
  months_since_event?: number;
};

export type ClaimViabilityResult = {
  band: ClaimViabilityBand;
  /** Which §6/§8 conditions produced the band ("show its work"). */
  reasons: string[];
  /** Missing inputs and how each affects confidence — never silently assumed (§9). */
  uncertainty_notes: string[];
};

export function assessClaimViability(input: ClaimViabilityInput): ClaimViabilityResult {
  const reasons: string[] = [];
  const uncertainty: string[] = [];

  // ---- Derivations -----------------------------------------------------------
  const within72h: boolean | undefined =
    input.verified_event_within_72h ??
    (input.event_hours_from_dol != null ? input.event_hours_from_dol <= DOL_WINDOW_HOURS : undefined);

  const eventExists: boolean | undefined =
    input.event_exists ?? (input.event_hours_from_dol != null || within72h === true ? true : undefined);

  const deductiblePercent: number | undefined =
    input.deductible_usd != null && input.home_value_usd != null && input.home_value_usd > 0
      ? (input.deductible_usd / input.home_value_usd) * 100
      : undefined;

  const carrierBehavior = input.carrier ? CARRIER_BEHAVIOR[input.carrier] : undefined;

  // ---- Uncertainty notes for missing inputs (§9: never silently assume) ------
  if (eventExists == null) {
    uncertainty.push(
      'Weather event verification missing — cannot confirm a hail/wind event near the date of loss. Band capped below HIGH.',
    );
  } else if (eventExists && within72h == null) {
    uncertainty.push(
      'Hours between the verified event and the reported date of loss unknown — the ±72h window (§6) cannot be confirmed. Band capped below HIGH.',
    );
  }
  if (input.haag_thresholds_met == null) {
    uncertainty.push('HAAG threshold status missing — HIGH requires thresholds met (§6).');
  }
  if (input.functional_damage_confirmed == null) {
    uncertainty.push('Functional damage confirmation missing — HIGH requires it confirmed (§6).');
  }
  if (input.is_discontinued == null) {
    uncertainty.push('Discontinued-material status unknown — HIGH requires discontinued material (§6).');
  }
  if (input.policy_type == null) {
    uncertainty.push(
      'Policy type (RCV vs ACV) not provided — HIGH requires RCV; an ACV-only policy would push the band to LOW (§6).',
    );
  }
  if (deductiblePercent == null) {
    uncertainty.push(
      'Deductible and/or home value missing — cannot verify deductible ≤ 2% of home value (§6). A high deductible would push the band to LOW.',
    );
  }
  if (input.prior_claims_within_3_years == null) {
    uncertainty.push('Prior-claim history (last 3 years) unknown — a prior claim would push the band to LOW (§6).');
  }
  if (input.carrier == null) {
    uncertainty.push('Carrier not provided — carrier approval behavior (§8) not factored.');
  }
  if (input.months_since_event == null) {
    if (input.collateral_damage_present === true) {
      uncertainty.push(
        'Time since the weather incident unknown — the two-year collateral-corroboration maximum (§6) cannot be verified.',
      );
    }
  }

  // ---- LOW conditions (§6) — any confirmed condition forces LOW ---------------
  const lowReasons: string[] = [];
  if (eventExists === false) {
    lowReasons.push('Date of loss matches no verified weather event (§6 LOW).');
  }
  if (input.wear_and_tear_only === true) {
    lowReasons.push('Findings are wear-and-tear only (§6 LOW).');
  }
  if (input.prior_claims_within_3_years === true) {
    lowReasons.push('Prior claim within the last 3 years (§6 LOW).');
  }
  if (input.policy_type === 'ACV') {
    lowReasons.push('ACV-only policy (§6 LOW).');
  }
  if (deductiblePercent != null && deductiblePercent > DEDUCTIBLE_MAX_PERCENT_OF_HOME_VALUE) {
    lowReasons.push(
      `High deductible — ${deductiblePercent.toFixed(1)}% of home value exceeds the 2% ceiling (§6 LOW).`,
    );
  }
  if (input.months_since_event != null && input.months_since_event > CORROBORATION_MAX_MONTHS) {
    lowReasons.push(
      `Weather incident is ${input.months_since_event} months old — beyond the two-year corroboration maximum, ` +
        'the correlation is not defensible (§6).',
    );
  }
  if (carrierBehavior?.posture === 'strict_dol' && eventExists === true && within72h === false) {
    lowReasons.push(
      'Verified event falls outside the ±72h date-of-loss window and the carrier (Erie) is strict on ' +
        'date-of-loss matching (§6 + §8).',
    );
  }
  if (lowReasons.length > 0) {
    return { band: 'LOW', reasons: lowReasons, uncertainty_notes: uncertainty };
  }

  // ---- HIGH requires ALL six §6 criteria confirmed ---------------------------
  const highCriteria: [label: string, confirmed: boolean | undefined][] = [
    ['Verified hail/wind event within ±72 hours of the reported date of loss', within72h],
    ['Meets HAAG replacement thresholds', input.haag_thresholds_met],
    ['Functional damage confirmed', input.functional_damage_confirmed],
    ['Material is discontinued', input.is_discontinued],
    ['Policy is RCV (replacement cost value)', input.policy_type === 'RCV' ? true : input.policy_type == null ? undefined : false],
    [
      'Deductible ≤ 2% of home value',
      deductiblePercent == null ? undefined : deductiblePercent <= DEDUCTIBLE_MAX_PERCENT_OF_HOME_VALUE,
    ],
  ];
  const allHighConfirmed = highCriteria.every(([, confirmed]) => confirmed === true);

  if (allHighConfirmed) {
    reasons.push(...highCriteria.map(([label]) => `${label} (§6 HIGH criterion met).`));
    if (carrierBehavior && carrierBehavior.posture !== 'permissive') {
      reasons.push(
        `Carrier note (§8): ${carrierBehavior.note} All six HIGH criteria are met — follow the carrier-specific documentation requirements.`,
      );
    }
    return { band: 'HIGH', reasons, uncertainty_notes: uncertainty };
  }

  // ---- MEDIUM (§6) — the honest middle ---------------------------------------
  if (eventExists === true && within72h === false) {
    reasons.push('Weather event exists but falls just outside the ±72h date-of-loss window (§6 MEDIUM).');
  }
  if (input.borderline_damage === true) {
    reasons.push('Borderline damage counts (§6 MEDIUM).');
  }
  if (carrierBehavior?.posture === 'strict') {
    reasons.push(`Carrier known for strict approvals — ${carrierBehavior.note} (§6 MEDIUM / §8).`);
  }
  if (carrierBehavior?.posture === 'permissive') {
    reasons.push(`Carrier behavior (§8): ${carrierBehavior.note}`);
  }
  for (const [label, confirmed] of highCriteria) {
    if (confirmed === false) {
      reasons.push(`HIGH criterion not met: ${label} (§6).`);
    } else if (confirmed == null) {
      reasons.push(`HIGH criterion unverified: ${label} (§6) — see uncertainty notes.`);
    }
  }
  if (reasons.length === 0) {
    reasons.push('No LOW conditions confirmed, but not all HIGH criteria are confirmed (§6).');
  }

  return { band: 'MEDIUM', reasons, uncertainty_notes: uncertainty };
}
