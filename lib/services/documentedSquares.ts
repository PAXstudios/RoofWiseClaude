// Squares and shingles documented FROM THE PHOTOS — pure.
//
// Owner: "Each photo should count the number of shingles as well. And it
// should be able to calculate, from the photos, the squares."
//
// This is a different number from the aerial measurement and must never be
// confused with it: the aerial figure is how big the ROOF is; this is how
// much of it the inspector actually PHOTOGRAPHED at test-square standard. A
// packet with 29 aerial squares and 2.4 documented squares is telling the
// adjuster something true about its own evidence.

import { readPhotoAnalysis } from './photoAnalysisState';
import type { Slope } from '../models/types';

export type DocumentedCoverage = {
  /** Σ per-photo fraction-of-a-square over 10×10 roof photos. */
  squares: number;
  /** Photos that contributed (roof, test-square mode, analyzed, coverage known). */
  photos: number;
  /** Photos with a chalk square actually visible. */
  chalked: number;
  /** Mean coverage confidence over contributing photos, 0–100. */
  confidence: number;
};

/**
 * Only 10×10 roof photos count. A single-shingle close-up documents one
 * shingle, not a square; a non-roof photo documents nothing on the roof.
 */
export function documentedCoverage(slope: Pick<Slope, 'photoPaths' | 'photoMeta' | 'photoAnalysis' | 'photoAttachmentIds' | 'photoAnalysisByAttachment'>): DocumentedCoverage {
  let squares = 0;
  let photos = 0;
  let chalked = 0;
  let confSum = 0;
  slope.photoPaths.forEach((uri, i) => {
    const meta = slope.photoMeta?.find((m) => m.photoIndex === i);
    if ((meta?.captureMode ?? 'square_10x10') !== 'square_10x10') return;
    const st = readPhotoAnalysis(slope, i);
    if (!st || st.status !== 'done' || st.noRoofDetected) return;
    const cov = st.squareCoverage;
    if (!cov) return;
    squares += cov.fraction;
    photos += 1;
    if (cov.visible) chalked += 1;
    confSum += cov.confidence;
  });
  return {
    squares,
    photos,
    chalked,
    confidence: photos > 0 ? Math.round(confSum / photos) : 0,
  };
}

/** Whole shingles counted across the slope's roof photos (sum; frames may overlap). */
export function shingleCountForSlope(slope: Pick<Slope, 'photoPaths' | 'photoAnalysis' | 'photoAttachmentIds' | 'photoAnalysisByAttachment'>): number | undefined {
  let total = 0;
  let any = false;
  for (let index = 0; index < slope.photoPaths.length; index++) {
    const st = readPhotoAnalysis(slope, index);
    if (st?.status === 'done' && !st.noRoofDetected && typeof st.shingleCount === 'number') {
      total += st.shingleCount;
      any = true;
    }
  }
  return any ? total : undefined;
}

/** One line for a card: "2.4 squares documented across 5 test-square photos (3 chalked)". */
export function documentedSummary(c: DocumentedCoverage): string {
  if (c.photos === 0) return 'No test-square coverage recorded yet.';
  return (
    `${c.squares.toFixed(1)} square${c.squares === 1 ? '' : 's'} documented across ${c.photos} ` +
    `test-square photo${c.photos === 1 ? '' : 's'}` +
    (c.chalked > 0 ? ` (${c.chalked} chalked)` : ' (no chalk lines seen — estimated from scale)') +
    ` · ${c.confidence}% confidence`
  );
}
