// Deriving the per-slope FUNCTIONAL flag from what the model actually saw —
// pure, and the only place the rule lives.
//
// The engine treats `functional_damage_present` as an AUTHORITATIVE input
// (§1) and never re-derives it from counts. But nothing ever SET it: every
// slope was created `functional: false` and no analysis path wrote it, so the
// §4 branches that key on functional damage were dead for every AI-analyzed
// job.
//
// WHAT A PHOTO CAN PROVE (owner's challenge, 2026-09-03, researched): HAAG's
// bruise is "an indentation with a fracture in the mat that FEELS SOFT" —
// confirmed by finger pressure, which no photograph can do. What HAAG says
// accompanies a bruise, and what a photo CAN show, is granule loss "sufficient
// to expose the underlying bitumen"; exposed asphalt shortens service life and
// is functional damage in its own right. So the photographable functional
// signs are `exposed_substrate` (black asphalt visible at the impact) and
// `mat_fracture` (an OPEN, visible tear or puncture) — never a softness the
// model cannot feel. The inspector's soft-spot test on the roof is the
// confirmation, and the report says so. A slope is functional when a
// hail/bruise detection on a TEST-SQUARE roof photo carries one of those two
// at a confidence an inspector would sign. Granule loss alone never qualifies;
// a single-shingle close-up documents one shingle, not the slope.

import { FUNCTIONAL_EVIDENCE, type Slope } from '../models/types';

/** Below this the model itself flagged the mark for inspector review. */
export const FUNCTIONAL_MIN_CONFIDENCE = 75;

export type FunctionalDerivation = {
  functional: boolean;
  /** Markers that carried the determination. */
  qualifyingHits: number;
  /** Why not, when not — so the report can say it. */
  reason: string;
};

export function deriveFunctional(
  slope: Pick<Slope, 'damage' | 'photoMeta' | 'photoPaths' | 'photoAnalysis'>,
): FunctionalDerivation {
  const testSquarePhotos = new Set<number>();
  slope.photoPaths.forEach((uri, i) => {
    const meta = slope.photoMeta?.find((m) => m.photoIndex === i);
    const mode = meta?.captureMode ?? 'square_10x10';
    const st = slope.photoAnalysis?.[uri];
    if (mode === 'square_10x10' && !(st?.noRoofDetected === true)) testSquarePhotos.add(i);
  });

  let qualifying = 0;
  let sawEvidenceField = false;
  for (const m of slope.damage) {
    if (m.category !== 'hail_hits' && m.category !== 'bruising') continue;
    if (m.evidence) sawEvidenceField = true;
    if (!m.evidence || !FUNCTIONAL_EVIDENCE.includes(m.evidence)) continue;
    if (m.confidence < FUNCTIONAL_MIN_CONFIDENCE) continue;
    if (m.photoIndex == null || !testSquarePhotos.has(m.photoIndex)) continue;
    qualifying += 1;
  }

  if (qualifying > 0) {
    return {
      functional: true,
      qualifyingHits: qualifying,
      reason: `${qualifying} hail hit${qualifying === 1 ? '' : 's'} on test-square photos show exposed asphalt or an open fracture at ≥${FUNCTIONAL_MIN_CONFIDENCE}% confidence (HAAG §1). Confirm bruises by finger pressure on the roof.`,
    };
  }
  return {
    functional: false,
    qualifyingHits: 0,
    reason: sawEvidenceField
      ? 'No hail hit on a test-square photo shows exposed asphalt or an open fracture — granule loss alone is not functional damage (HAAG §1). A soft spot under finger pressure would be; photos cannot feel it.'
      : 'Hits were analyzed before evidence classification existed — re-analyze to derive functional damage.',
  };
}
