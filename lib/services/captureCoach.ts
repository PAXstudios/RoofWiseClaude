// Guided capture — the step list a complete HAAG packet needs, and how far a
// job has got through it. Pure: the screen renders it, the photos ARE the
// progress (nothing is ticked by hand, nothing is ticked by a photo that was
// never taken).
//
// Owner: "some kind of on screen guidance … that walks through the picture
// taking process for each slope of the roof and other items that need to be
// taken a picture of such as water spouts, window siding, the metal that
// comes with a sky window …"
//
// The order is the order an inspector walks: the four cardinal slopes (HAAG:
// at least one test square per roof direction), then the collateral surfaces
// that corroborate hail size and direction, then — on a claim — the
// brittleness test photos the field protocol requires.

import type {
  AreaTag,
  CaptureMode,
  CollateralZone,
  Inspection,
  SlopeOrientation,
} from '../models/types';
import { COLLATERAL_ZONE_LABELS } from '../models/types';

export type CoachStepKind = 'slope' | 'collateral' | 'brittleness';

export type CoachStep = {
  id: string;
  kind: CoachStepKind;
  title: string;
  /** One line of what to shoot and why. Read on a roof, so it is short. */
  hint: string;
  /** What selecting the step sets on the camera. */
  slope?: SlopeOrientation;
  areaTag: AreaTag;
  captureMode: CaptureMode;
  /** Any of these tags satisfies the step (a chimney cap is a soft metal). */
  acceptTags: readonly AreaTag[];
  /** Shots needed before the step reads as done. */
  minShots: number;
  /** The claim-evidence zone this step fills, when it is a collateral step. */
  zone?: CollateralZone;
};

export type CoachProgress = {
  step: CoachStep;
  shots: number;
  done: boolean;
};

/** Area tags that count toward each collateral zone. */
export const ZONE_TAGS: Record<CollateralZone, readonly AreaTag[]> = {
  gutters_downspouts: ['Gutters / Downspouts', 'Fascia / Soffit'],
  hvac_condenser_fins: ['HVAC Condenser'],
  siding_window_screens: ['Siding', 'Window Screens', 'Windows', 'Garage Door', 'Fence / Gate'],
  soft_metal_roof_vents: ['Roof Vents / Soft Metals', 'Skylight', 'Chimney', 'Flashing / Penetrations'],
};

/** Reverse lookup: which zone a photo's tag corroborates, if any. */
export function zoneForAreaTag(tag: string | undefined): CollateralZone | undefined {
  if (!tag) return undefined;
  for (const zone of Object.keys(ZONE_TAGS) as CollateralZone[]) {
    if ((ZONE_TAGS[zone] as readonly string[]).includes(tag)) return zone;
  }
  return undefined;
}

const SLOPE_STEPS: { slope: SlopeOrientation; areaTag: AreaTag; title: string }[] = [
  { slope: 'S', areaTag: 'Front Slope', title: 'Front slope (south)' },
  { slope: 'E', areaTag: 'Right Slope', title: 'Right slope (east)' },
  { slope: 'N', areaTag: 'Rear Slope', title: 'Rear slope (north)' },
  { slope: 'W', areaTag: 'Left Slope', title: 'Left slope (west)' },
];

const COLLATERAL_STEPS: { zone: CollateralZone; areaTag: AreaTag; hint: string }[] = [
  {
    zone: 'gutters_downspouts',
    areaTag: 'Gutters / Downspouts',
    hint: 'Dents in the gutter lip and downspouts — size and direction of the hail.',
  },
  {
    zone: 'siding_window_screens',
    areaTag: 'Siding',
    hint: 'Impact marks on siding, torn or dented window screens.',
  },
  {
    zone: 'hvac_condenser_fins',
    areaTag: 'HVAC Condenser',
    hint: 'Crushed or flattened fins on the condenser coil — a hail calendar.',
  },
  {
    zone: 'soft_metal_roof_vents',
    areaTag: 'Roof Vents / Soft Metals',
    hint: 'Dings on turtle vents, turbines, skylight and chimney flashing caps.',
  },
];

/**
 * The steps for this job. Slopes first, one test square each; then the four
 * collateral zones; then the brittleness test on an insurance claim.
 */
export function coachSteps(inspection: Pick<Inspection, 'kind'>): CoachStep[] {
  const steps: CoachStep[] = SLOPE_STEPS.map((s) => ({
    id: `slope:${s.slope}`,
    kind: 'slope',
    title: s.title,
    hint: 'Chalk a 10×10 test square and shoot it straight on. One per direction is the HAAG minimum.',
    slope: s.slope,
    areaTag: s.areaTag,
    captureMode: 'square_10x10',
    acceptTags: [s.areaTag],
    minShots: 1,
  }));
  for (const c of COLLATERAL_STEPS) {
    steps.push({
      id: `zone:${c.zone}`,
      kind: 'collateral',
      title: COLLATERAL_ZONE_LABELS[c.zone],
      hint: c.hint,
      areaTag: c.areaTag,
      captureMode: 'single_shingle',
      acceptTags: ZONE_TAGS[c.zone],
      minShots: 1,
      zone: c.zone,
    });
  }
  if (inspection.kind === 'insurance_claim') {
    steps.push({
      id: 'brittleness',
      kind: 'brittleness',
      title: 'Brittleness test',
      hint: 'Lift a shingle corner in an undamaged area and photograph the test as you run it. Required evidence on a claim.',
      areaTag: 'Other',
      captureMode: 'single_shingle',
      acceptTags: ['Other'],
      minShots: 1,
    });
  }
  return steps;
}

/**
 * How far the job has got, from its photos. A slope step counts photos on
 * that slope with a matching tag; a collateral step counts photos anywhere
 * with a tag in its zone; the brittleness step reads the protocol's photos.
 */
export function coachProgress(
  inspection: Pick<Inspection, 'kind' | 'slopes' | 'brittlenessProtocol'>,
  steps: CoachStep[] = coachSteps(inspection),
): CoachProgress[] {
  return steps.map((step) => {
    let shots = 0;
    if (step.kind === 'brittleness') {
      shots = inspection.brittlenessProtocol?.photoIds.length ?? 0;
    } else {
      for (const slope of inspection.slopes) {
        if (step.kind === 'slope' && slope.orientation !== step.slope) continue;
        for (const m of slope.photoMeta ?? []) {
          if (m.areaTag && (step.acceptTags as readonly string[]).includes(m.areaTag)) shots += 1;
        }
      }
    }
    return { step, shots, done: shots >= step.minShots };
  });
}

/** The first step still short of its shots, else null when the walk is complete. */
export function nextIncompleteStep(progress: CoachProgress[]): CoachProgress | null {
  return progress.find((p) => !p.done) ?? null;
}
