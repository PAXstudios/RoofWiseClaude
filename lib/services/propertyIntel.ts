// Property intelligence — what the app finds out about a roof on its own,
// before anyone climbs a ladder.
//
// WHY THIS EXISTS: the app already knew how to measure a roof from aerial
// imagery (`solar.ts`, used for GEOMETRY, not solar production), but only the
// standalone estimator ever called it. Every inspection therefore carried
// `areaSquares: 0` on every slope, which silently zeroed the things that
// depend on area:
//   • HAAG §5 repair cost, RC = D × U × R × A — computes to 0 when A is 0
//   • the cost estimator and the proposal (both read `detectedAreaSquares`)
//   • the report's statement of how big the roof actually is
// This service runs the research once per job and hands the answer to all of
// them, so the parts of the app stop guessing independently.
//
// FAILURE POLICY (Drift #5): a measurement that did not happen is STORED as a
// failure with its plain-English reason. Nothing here ever returns a square
// footage it did not measure, and no caller has to interpret an exception to
// find out that the number is missing — `status` says so.

import type {
  Inspection,
  PropertyIntel,
  PropertyIntelSlope,
  Slope,
  SlopeOrientation,
} from '../models/types';
import { pitchDegreesToRatio, yawToOrientation } from '../models/types';
import { describeGoogleApiError } from './googleApi';
import { geocodeText } from './geocoding';
import { SolarNotFoundError, measureRoof } from './solar';

// -----------------------------------------------------------------------------
// Research (the one function with I/O)
// -----------------------------------------------------------------------------

export type ResearchInput = {
  address: string;
  lat?: number;
  lng?: number;
};

/**
 * Measure the property. Resolves with a `PropertyIntel` in every case — a
 * failure is a record with `status` and `reason`, never a thrown error, so a
 * caller can persist the outcome without a try/catch and the UI can say what
 * went wrong instead of showing an empty space.
 *
 * Geocodes the address when the caller has no coordinates (a job created by
 * typing an address rather than picking a Places suggestion).
 */
export async function researchProperty(input: ResearchInput): Promise<PropertyIntel> {
  const measuredAt = new Date().toISOString();
  const base = { measuredAt, source: 'aerial' as const };

  let coord: { lat: number; lng: number } | null =
    input.lat != null && input.lng != null ? { lat: input.lat, lng: input.lng } : null;

  if (!coord) {
    const address = input.address.trim();
    if (!address) {
      return { ...base, status: 'no_location', reason: 'No address on this job to measure from.' };
    }
    try {
      const hit = await geocodeText(address);
      if (!hit) {
        return {
          ...base,
          status: 'no_location',
          reason: `Google could not find "${address}" on the map, so there is nothing to measure.`,
        };
      }
      coord = { lat: hit.lat, lng: hit.lng };
    } catch (e) {
      return {
        ...base,
        status: 'unavailable',
        reason: describeGoogleApiError(e) ?? 'Could not look up this address right now.',
      };
    }
  }

  try {
    const m = await measureRoof(coord);
    return {
      ...base,
      status: 'measured',
      totalSquares: m.totalSquares,
      slopes: m.slopes.map(
        (s): PropertyIntelSlope => ({
          orientation: s.orientation,
          pitchDegrees: s.pitchDegrees,
          pitchRatio: s.pitchRatio,
          squares: s.squares,
          azimuthDegrees: s.azimuthDegrees,
        }),
      ),
      imageryDate: m.imageryDate,
      imageryQuality: m.imageryQuality,
      center: m.center,
    };
  } catch (e) {
    if (e instanceof SolarNotFoundError) {
      return {
        ...base,
        status: 'no_building',
        reason:
          'No aerial roof measurement exists for this address — enter the squares by hand on the slopes.',
      };
    }
    return {
      ...base,
      status: 'unavailable',
      reason: describeGoogleApiError(e) ?? 'Roof measurement did not work. Try again in a moment.',
    };
  }
}

// -----------------------------------------------------------------------------
// Readers — pure. Every surface reads area through these, so "how big is this
// roof" has exactly one answer across the app.
// -----------------------------------------------------------------------------

/** True when the record carries a real measurement. */
export function isMeasured(
  intel: PropertyIntel | undefined,
): intel is PropertyIntel & { totalSquares: number; slopes: PropertyIntelSlope[] } {
  return intel?.status === 'measured' && intel.totalSquares != null && intel.slopes != null;
}

/**
 * One physical roof plane — what a roofer means by "the south slope".
 *
 * NOT the same thing as an imagery facet. The aerial data segments by pitch
 * AND azimuth, so a single plane routinely arrives as several facets: on a real
 * Plano house the south slope came back as 37.9deg at azimuth 203.25 and 14.7deg
 * at azimuth 201.03. Those two are two degrees apart, but they straddle the
 * S/SW octant boundary at 202.5deg, so a naive per-facet mapping filed half the
 * slope under SW and reported the south slope as 2.9 squares instead of 6.9.
 *
 * Planes are therefore clustered by azimuth proximity before anything is
 * assigned a compass direction.
 */
export type RoofPlane = {
  orientation: SlopeOrientation;
  squares: number;
  /** Area-weighted, so the dominant facet sets the pitch. */
  pitchDegrees: number;
  pitchRatio: string;
  azimuthDegrees: number;
  /** How many imagery facets merged into this plane. */
  faceCount: number;
};

/**
 * Facets within this many degrees of each other are the same plane. Wide
 * enough to survive the octant boundaries that split real slopes, narrow
 * enough that a hip end (typically 90deg away) stays its own plane.
 */
const PLANE_MERGE_TOLERANCE_DEG = 30;

/** Below this pitch the imagery reports a facet as flat (matches solar.ts). */
const FLAT_PITCH_DEG = 5;

const circularDelta = (a: number, b: number): number => {
  const d = Math.abs(((a - b) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
};

/**
 * Merge the imagery facets into physical roof planes.
 *
 * Flat facets are clustered separately from pitched ones and never merged
 * together: the imagery reports a near-zero-pitch remainder (on the test house,
 * a 0.15deg facet carrying 60% of the area) that is the building footprint, not
 * a slope. Folding that into a pitched plane would inflate a slope's area by
 * several times.
 */
export function roofPlanes(intel: PropertyIntel | undefined): RoofPlane[] {
  if (!isMeasured(intel)) return [];

  const clusters: { facets: PropertyIntelSlope[]; flat: boolean }[] = [];
  // Largest first, so each cluster's seed is its dominant facet rather than
  // whichever one the API happened to list first.
  for (const facet of [...intel.slopes].sort((a, b) => b.squares - a.squares)) {
    const flat = facet.pitchDegrees < FLAT_PITCH_DEG;
    const home = clusters.find(
      (c) =>
        c.flat === flat &&
        (flat ||
          circularDelta(weightedAzimuth(c.facets), facet.azimuthDegrees) <=
            PLANE_MERGE_TOLERANCE_DEG),
    );
    if (home) home.facets.push(facet);
    else clusters.push({ facets: [facet], flat });
  }

  return clusters
    .map(({ facets, flat }): RoofPlane => {
      const squares = facets.reduce((t, f) => t + f.squares, 0);
      const azimuth = weightedAzimuth(facets);
      const pitch =
        squares > 0
          ? facets.reduce((t, f) => t + f.pitchDegrees * f.squares, 0) / squares
          : facets[0].pitchDegrees;
      return {
        orientation: flat ? 'Flat' : yawToOrientation(azimuth),
        squares,
        pitchDegrees: pitch,
        pitchRatio: pitchDegreesToRatio(pitch),
        azimuthDegrees: azimuth,
        faceCount: facets.length,
      };
    })
    .sort((a, b) => b.squares - a.squares);
}

/** Area-weighted circular mean — 350deg and 10deg average to 0, not to 180. */
function weightedAzimuth(facets: PropertyIntelSlope[]): number {
  let x = 0;
  let y = 0;
  for (const f of facets) {
    const w = f.squares > 0 ? f.squares : 1;
    const rad = (f.azimuthDegrees * Math.PI) / 180;
    x += Math.cos(rad) * w;
    y += Math.sin(rad) * w;
  }
  if (x === 0 && y === 0) return facets[0]?.azimuthDegrees ?? 0;
  return (((Math.atan2(y, x) * 180) / Math.PI) + 360) % 360;
}

/**
 * Aerial squares facing one compass direction, summed across every plane that
 * points that way (a main slope plus a dormer or a porch over it).
 *
 * `Unknown` never matches — an unoriented capture must not silently inherit
 * some other elevation's area.
 */
export function squaresFacing(
  intel: PropertyIntel | undefined,
  orientation: SlopeOrientation,
): number | undefined {
  if (!isMeasured(intel) || orientation === 'Unknown') return undefined;
  const matching = roofPlanes(intel).filter((p) => p.orientation === orientation);
  if (matching.length === 0) return undefined;
  return matching.reduce((t, p) => t + p.squares, 0);
}

/** Pitch of the largest plane facing one direction, for seeding a slope. */
export function pitchFacing(
  intel: PropertyIntel | undefined,
  orientation: SlopeOrientation,
): number | undefined {
  if (!isMeasured(intel) || orientation === 'Unknown') return undefined;
  // roofPlanes is sorted largest-first, so the first match is the main plane.
  return roofPlanes(intel).find((p) => p.orientation === orientation)?.pitchDegrees;
}

/**
 * The area a slope should be costed at, in squares.
 *
 * Order of trust: what the inspector entered by hand wins (they were on the
 * roof), then the aerial measurement, then nothing. Returning `undefined`
 * rather than 0 is the point — a caller can then say "not measured" instead of
 * quoting a $0 repair.
 */
export function slopeSquares(
  inspection: Pick<Inspection, 'propertyIntel'>,
  slope: Pick<Slope, 'orientation' | 'areaSquares' | 'detectedAreaSquares'>,
): number | undefined {
  if (slope.areaSquares > 0) return slope.areaSquares;
  if (slope.detectedAreaSquares != null && slope.detectedAreaSquares > 0) {
    return slope.detectedAreaSquares;
  }
  return squaresFacing(inspection.propertyIntel, slope.orientation);
}

/**
 * Total roof squares for the inspection.
 *
 * Prefers the whole-roof aerial figure over summing the documented slopes:
 * an inspector who photographed two of four elevations has documented two
 * slopes, not a two-slope roof, and costing the smaller number would
 * under-scope the claim.
 */
export function totalSquares(inspection: Pick<Inspection, 'propertyIntel' | 'slopes'>): number | undefined {
  const intel = inspection.propertyIntel;
  if (isMeasured(intel) && intel.totalSquares > 0) return intel.totalSquares;
  const summed = inspection.slopes.reduce(
    (t, s) => t + (s.areaSquares > 0 ? s.areaSquares : (s.detectedAreaSquares ?? 0)),
    0,
  );
  return summed > 0 ? summed : undefined;
}

/**
 * One line a report or a card can print verbatim, stating what is known and —
 * when nothing is — why. Reports must be able to say how the roof was measured;
 * "28.4 squares" with no provenance is the kind of number an adjuster strikes.
 */
export function measurementSummary(intel: PropertyIntel | undefined): string {
  if (!intel) return 'Roof not measured yet.';
  if (!isMeasured(intel)) return intel.reason ?? 'Roof measurement unavailable.';
  const faces = intel.slopes.length;
  const quality =
    intel.imageryQuality && intel.imageryQuality !== 'UNKNOWN'
      ? `${intel.imageryQuality.toLowerCase()}-quality `
      : '';
  return (
    `${intel.totalSquares.toFixed(1)} squares across ${faces} roof face${faces === 1 ? '' : 's'}, ` +
    `measured from ${quality}aerial imagery captured ${intel.imageryDate ?? 'on an unstated date'}.`
  );
}

/**
 * True when the imagery predates the storm being claimed — the measurement is
 * still valid (a roof does not change size), but a carrier will note that the
 * picture is older than the loss, so the report should say it first.
 */
export function imageryPredatesLoss(
  intel: PropertyIntel | undefined,
  dateOfLoss: string | undefined,
): boolean {
  if (!isMeasured(intel) || !intel.imageryDate || !dateOfLoss) return false;
  const img = Date.parse(intel.imageryDate);
  const dol = Date.parse(dateOfLoss);
  if (Number.isNaN(img) || Number.isNaN(dol)) return false;
  return img < dol;
}
