// Capture-session helpers — pure logic shared by the camera flow and any
// downstream consumer that has to reason about per-photo capture metadata.
//
// No I/O, no React, no store imports. Everything here is a total function so
// the camera screen, the analysis layer, and the report layer can agree on
// what a photo's area tag / capture mode means without duplicating rules.

import {
  AREA_TAGS,
  type AreaTag,
  type CaptureMode,
  type PhotoMeta,
  type SlopeOrientation,
} from '@/lib/models/types';

/**
 * Photos land in `square_10x10` unless the inspector says otherwise: the
 * 10x10 test square is the HAAG denominator, so it is the safe default and
 * "Single Shingle" is the deliberate opt-out.
 */
export const DEFAULT_CAPTURE_MODE: CaptureMode = 'square_10x10';

export type CaptureModeOption = {
  mode: CaptureMode;
  /** Toggle label — spelled out, because this choice changes the math. */
  label: string;
  /** One-line consequence, shown under the toggle. */
  hint: string;
  /** Ionicons glyph for the HUD chip + toggle. */
  icon: 'grid-outline' | 'layers-outline';
};

export const CAPTURE_MODE_OPTIONS: readonly CaptureModeOption[] = [
  {
    mode: 'square_10x10',
    label: 'Test Square (10x10)',
    hint: 'Hits count toward the per-square HAAG threshold.',
    icon: 'grid-outline',
  },
  {
    mode: 'single_shingle',
    label: 'Single Shingle',
    hint: 'Close-up detail. Counted separately, never per-square.',
    icon: 'layers-outline',
  },
] as const;

export function captureModeOption(mode: CaptureMode): CaptureModeOption {
  return CAPTURE_MODE_OPTIONS.find((o) => o.mode === mode) ?? CAPTURE_MODE_OPTIONS[0];
}

// -----------------------------------------------------------------------------
// Slope orientation → default area tag
// -----------------------------------------------------------------------------

/**
 * Slopes are stored by compass orientation; the 19 capture subjects name the
 * four roof planes as Front / Rear / Left / Right. Bridging them needs a
 * convention, so we fix one and let the inspector override it in a tap:
 *
 *   Front = south-facing (the street-facing default), Rear = north,
 *   Right = east, Left = west. Diagonals resolve clockwise to the next
 *   cardinal (NE → Right, SE → Front, SW → Left, NW → Rear).
 *
 * This is a *pre-selection*, never a recorded fact — nothing downstream reads
 * it unless the photo was actually captured with it showing in the HUD.
 */
const SLOPE_AREA_TAG: Record<SlopeOrientation, AreaTag> = {
  N: 'Rear Slope',
  NE: 'Right Slope',
  E: 'Right Slope',
  SE: 'Front Slope',
  S: 'Front Slope',
  SW: 'Left Slope',
  W: 'Left Slope',
  NW: 'Rear Slope',
  // A flat deck or an undetermined heading has no front/rear/left/right
  // meaning, so we refuse to guess one and let the inspector pick.
  Flat: 'Other',
  Unknown: 'Other',
};

export function defaultAreaTagForSlope(slope: SlopeOrientation): AreaTag {
  return SLOPE_AREA_TAG[slope] ?? 'Other';
}

// -----------------------------------------------------------------------------
// Labels
// -----------------------------------------------------------------------------

/**
 * Short forms for thumbnail overlays, where a full tag will not fit. The
 * overlay is a rendered chip — the label is never burned into the pixels.
 */
const AREA_TAG_SHORT: Record<AreaTag, string> = {
  'Front Slope': 'FRONT',
  'Rear Slope': 'REAR',
  'Left Slope': 'LEFT',
  'Right Slope': 'RIGHT',
  'Ridge / Hip': 'RIDGE',
  Valley: 'VALLEY',
  'Flashing / Penetrations': 'FLASH',
  'Gutters / Downspouts': 'GUTTER',
  'Fascia / Soffit': 'FASCIA',
  Siding: 'SIDING',
  Windows: 'WINDOW',
  'Window Screens': 'SCREEN',
  'Garage Door': 'GARAGE',
  'Fence / Gate': 'FENCE',
  'HVAC Condenser': 'HVAC',
  'Roof Vents / Soft Metals': 'VENTS',
  Chimney: 'CHIM',
  Skylight: 'SKY',
  Other: 'OTHER',
};

/** Tolerates free-form / legacy tags rather than assuming AREA_TAGS membership. */
export function shortAreaTag(tag: string | undefined): string {
  if (!tag) return '—';
  const known = AREA_TAG_SHORT[tag as AreaTag];
  if (known) return known;
  return tag.split(/[\s/]+/)[0].slice(0, 6).toUpperCase();
}

export function isKnownAreaTag(tag: string | undefined): tag is AreaTag {
  return !!tag && (AREA_TAGS as readonly string[]).includes(tag);
}

// -----------------------------------------------------------------------------
// Per-mode hit bucketing (the downstream seam)
// -----------------------------------------------------------------------------

export type ModeHitCounts = {
  squareHitCount: number;
  singleShingleHitCount: number;
};

/**
 * Split per-photo hit counts into the two mode buckets.
 *
 * This exists so single-shingle close-ups can never contaminate the HAAG
 * per-square threshold: a shingle shot with four bruises on it is four hits
 * on ONE shingle, not four hits in a 10x10 square. Callers pass their own
 * per-photo tallies (marker counts, confirmed-finding counts — whatever the
 * caller's unit of "hit" is) keyed by index into `Slope.photoPaths`.
 *
 * Photos with no recorded mode (captured before mode tagging existed) fall
 * into the square bucket, which is what the app assumed at the time.
 */
export function bucketHitCountsByMode(
  photoMeta: readonly PhotoMeta[] | undefined,
  hitsByPhotoIndex: Readonly<Record<number, number>>,
): ModeHitCounts {
  const modeFor = new Map<number, CaptureMode>();
  for (const m of photoMeta ?? []) {
    if (m.captureMode) modeFor.set(m.photoIndex, m.captureMode);
  }

  let squareHitCount = 0;
  let singleShingleHitCount = 0;
  for (const [key, hits] of Object.entries(hitsByPhotoIndex)) {
    const index = Number(key);
    if (!Number.isFinite(index) || !Number.isFinite(hits)) continue;
    if (modeFor.get(index) === 'single_shingle') singleShingleHitCount += hits;
    else squareHitCount += hits;
  }

  return { squareHitCount, singleShingleHitCount };
}
