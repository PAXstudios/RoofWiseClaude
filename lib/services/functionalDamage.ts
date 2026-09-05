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
//
// WHAT THE INSPECTOR CAN PROVE: the soft-spot test itself. A marker with
// `softSpot: true` was pressed by a human on the roof and gave — that IS the
// HAAG bruise, so it qualifies on a test-square photo regardless of the
// model's evidence class or confidence. Only the marker editor writes it.
//
// This runs on every marker mutation (`inspectionStore.withRecount`) and after
// every analysis pass (`analyzeSlope`), so deleting the model's only
// mat-fracture hit clears the flag and confirming a soft spot sets it.

import { readPhotoAnalysis } from './photoAnalysisState';
import { FUNCTIONAL_EVIDENCE, type DamageMarker, type Slope } from '../models/types';

/** Below this the model itself flagged the mark for inspector review. */
export const FUNCTIONAL_MIN_CONFIDENCE = 75;

/** Marker ids minted by the marker editor (`app/edit-detection.tsx`). */
const INSPECTOR_MARKER_PREFIX = 'mk_user_';

/**
 * True for a marker the inspector placed by hand rather than the model. The
 * id prefix is the editor's; the note is what older hand-added markers carry.
 */
export function isInspectorMarker(m: Pick<DamageMarker, 'id' | 'note'>): boolean {
  return m.id.startsWith(INSPECTOR_MARKER_PREFIX) || m.note === 'Added by inspector';
}

export type FunctionalDerivation = {
  functional: boolean;
  /** Markers that carried the determination. */
  qualifyingHits: number;
  /** Of those, how many were inspector-confirmed soft spots. */
  softSpotHits: number;
  /** Why not, when not — so the report can say it. */
  reason: string;
};

export function deriveFunctional(
  slope: Pick<Slope, 'damage' | 'photoMeta' | 'photoPaths' | 'photoAnalysis' | 'photoAttachmentIds' | 'photoAnalysisByAttachment'>,
): FunctionalDerivation {
  const testSquarePhotos = new Set<number>();
  slope.photoPaths.forEach((uri, i) => {
    const meta = slope.photoMeta?.find((m) => m.photoIndex === i);
    const mode = meta?.captureMode ?? 'square_10x10';
    const st = readPhotoAnalysis(slope, i);
    if (mode === 'square_10x10' && !(st?.noRoofDetected === true)) testSquarePhotos.add(i);
  });

  let hailMarkers = 0;
  let qualifying = 0;
  let softSpots = 0;
  let sawEvidenceField = false;
  let sawInspectorMarker = false;
  let sawModelMarker = false;
  for (const m of slope.damage) {
    if (m.category !== 'hail_hits' && m.category !== 'bruising') continue;
    hailMarkers += 1;
    if (isInspectorMarker(m)) sawInspectorMarker = true;
    else sawModelMarker = true;
    if (m.evidence) sawEvidenceField = true;
    const onTestSquare = m.photoIndex != null && testSquarePhotos.has(m.photoIndex);
    if (!onTestSquare) continue;
    // The inspector's finger outranks the model's eye: a confirmed soft spot
    // is the bruise itself, whatever the evidence class or confidence says.
    if (m.softSpot === true) {
      qualifying += 1;
      softSpots += 1;
      continue;
    }
    if (!m.evidence || !FUNCTIONAL_EVIDENCE.includes(m.evidence)) continue;
    if (m.confidence < FUNCTIONAL_MIN_CONFIDENCE) continue;
    qualifying += 1;
  }

  if (qualifying > 0) {
    const photographed = qualifying - softSpots;
    const parts: string[] = [];
    if (photographed > 0) {
      parts.push(
        `${photographed} hail hit${photographed === 1 ? '' : 's'} on test-square photos show exposed asphalt or an open fracture at ≥${FUNCTIONAL_MIN_CONFIDENCE}% confidence`,
      );
    }
    if (softSpots > 0) {
      parts.push(
        `the inspector confirmed a soft spot under finger pressure on ${softSpots} hit${softSpots === 1 ? '' : 's'}`,
      );
    }
    const tail =
      softSpots > 0
        ? ' (HAAG §1 — the soft-spot test is the bruise confirmation).'
        : ' (HAAG §1). Confirm bruises by finger pressure on the roof.';
    return {
      functional: true,
      qualifyingHits: qualifying,
      softSpotHits: softSpots,
      reason: `${parts.join('; ')}${tail}`,
    };
  }

  // Not functional — say WHY, and distinguish the four ways to get here so
  // the fix is obvious: no hits at all; hits with evidence that did not
  // qualify; hits the inspector drew that were never classified; hits the
  // model drew before evidence classification existed.
  let reason: string;
  if (hailMarkers === 0) {
    reason = 'No hail or bruise hits recorded on this slope.';
  } else if (sawEvidenceField) {
    reason =
      'No hail hit on a test-square photo shows exposed asphalt or an open fracture — granule loss alone is not functional damage (HAAG §1). A soft spot under finger pressure would be; open the photo, tap the hit, and confirm it.';
  } else if (sawInspectorMarker && !sawModelMarker) {
    reason =
      'Hits were added by hand without an evidence class. Open the photo, tap each hit, and record what you saw (exposed asphalt, open fracture) or confirm a soft spot.';
  } else if (sawInspectorMarker) {
    reason =
      'Hits carry no evidence class — the model analyzed before evidence classification existed and the hand-added ones were never classified. Re-analyze, then tap each hand-added hit to record what you saw or confirm a soft spot.';
  } else {
    reason =
      'Hits were analyzed before evidence classification existed — re-analyze to derive functional damage.';
  }
  return { functional: false, qualifyingHits: 0, softSpotHits: 0, reason };
}
