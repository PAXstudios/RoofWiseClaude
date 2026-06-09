// HAAG functional-damage thresholds per material per test square.
// Spec section "HAAG Inspection Algorithm — Full Specification".

import type { RoofMaterial } from '../models/types';

export type HaagThreshold = {
  // Minimum hail strikes per 10×10' test square to qualify a slope for
  // functional damage (and therefore replacement). 0 = "any positive
  // qualifying hit" (used by metals where the policy criterion is
  // penetration, not count).
  hitsPerTestSquare: number;
  // Plain-English rule, used in claim packet narrative.
  rule: string;
};

export const HAAG_THRESHOLDS: Record<RoofMaterial, HaagThreshold> = {
  three_tab_asphalt: {
    hitsPerTestSquare: 8,
    rule: '8+ hail strikes per 10×10\' test square.',
  },
  architectural_asphalt: {
    hitsPerTestSquare: 10,
    rule: '10+ hail strikes per 10×10\' test square.',
  },
  luxury_asphalt: {
    hitsPerTestSquare: 8,
    rule: '8+ hail strikes per 10×10\' test square (weight-dependent 8–10).',
  },
  wood_shake: {
    hitsPerTestSquare: 1,
    rule: 'Visible fractures with displaced wood.',
  },
  wood_shingle: {
    hitsPerTestSquare: 1,
    rule: 'Split or fractured shingles; granular crushing.',
  },
  metal_standing_seam: {
    hitsPerTestSquare: 0,
    rule: 'Functional damage limited to penetration; cosmetic dents may not qualify under most policies.',
  },
  metal_shingle: {
    hitsPerTestSquare: 0,
    rule: 'Functional damage limited to penetration; cosmetic dents may not qualify under most policies.',
  },
  clay_tile: {
    hitsPerTestSquare: 1,
    rule: 'Any cracked or shattered tile qualifies.',
  },
  concrete_tile: {
    hitsPerTestSquare: 1,
    rule: 'Any cracked or shattered tile qualifies.',
  },
  slate: {
    hitsPerTestSquare: 1,
    rule: 'Any cracked, fractured, or displaced slate qualifies.',
  },
  synthetic_slate: {
    hitsPerTestSquare: 1,
    rule: 'Visible impact fractures qualify.',
  },
  composite: {
    hitsPerTestSquare: 8,
    rule: 'Material-dependent; default to asphalt-equivalent of 8 hits.',
  },
  rolled_roofing: {
    hitsPerTestSquare: 0,
    rule: 'Granule loss, exposed mat, or punctures qualify.',
  },
  tpo: {
    hitsPerTestSquare: 0,
    rule: 'Punctures or exposed scrim qualify.',
  },
  epdm: {
    hitsPerTestSquare: 0,
    rule: 'Punctures or exposed scrim qualify.',
  },
};

export function thresholdFor(material: RoofMaterial): HaagThreshold {
  return HAAG_THRESHOLDS[material];
}
