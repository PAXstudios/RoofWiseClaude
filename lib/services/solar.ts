// Google Solar API — buildingInsights:findClosest.
// Docs: https://developers.google.com/maps/documentation/solar/building-insights
//
// We use the Solar API for ROOF GEOMETRY (area, pitch, azimuth per slope),
// NOT solar production. The roofSegmentStats array gives us per-slope
// area + pitch + azimuth in metric units; we convert to squares (100 sq ft)
// and named orientations.
//
// Owner directive: on screen this is "roof measurement" — the word "Solar"
// is the instrument, never the feature. Only the file name and the Google
// API name in the enable-it copy keep the word.
//
// Failure policy: every non-success is a typed `GoogleApiError` (see
// lib/services/googleApi.ts). The live case on the owner's key today is
// HTTP 403 PERMISSION_DENIED "…blocked" from the key's API restrictions;
// `describeGoogleApiError` turns it into "Roof measurement isn't enabled for
// this app's Google key yet (Solar API)".

import { env, isGoogleSolarConfigured } from '../env';
import type { SlopeOrientation } from '../models/types';
import { yawToOrientation } from '../models/types';
import {
  GoogleApiError,
  classifyGoogleFailure,
  clearGoogleDenial,
  fetchGoogle,
  recentGoogleDenial,
  rememberGoogleDenial,
} from './googleApi';

export class SolarNotConfiguredError extends GoogleApiError {
  constructor() {
    super('solar', 'not_configured', 'Google Solar API key not configured.');
    this.name = 'SolarNotConfiguredError';
  }
}

/** Google answered (so the key is fine) but has no building at this point. */
export class SolarNotFoundError extends Error {
  constructor() {
    super('No aerial measurement available for this address.');
    this.name = 'SolarNotFoundError';
  }
}

/**
 * Any measurement failure Google (or the network) reported. `kind` says
 * which; `not_authorized` is the key-restriction case.
 */
export class SolarServiceError extends GoogleApiError {
  /** Kept for existing callers that read `.status`. */
  readonly status?: number;
  constructor(from: GoogleApiError) {
    super('solar', from.kind, from.message, from.httpStatus, from.googleReason);
    this.name = 'SolarServiceError';
    this.status = from.httpStatus ?? undefined;
  }
}

/** A lat/lng rectangle, as the imagery reports it. */
export type LatLngBounds = {
  sw: { lat: number; lng: number };
  ne: { lat: number; lng: number };
};

export type SlopeMeasurement = {
  orientation: SlopeOrientation;
  pitchDegrees: number;
  pitchRatio: string;            // "5/12"
  squares: number;               // 1 sq = 100 sq ft = 9.290304 m²
  azimuthDegrees: number;
  /** Where this face sits — drawn over satellite imagery as the roof overlay. */
  bounds?: LatLngBounds;
  center?: { lat: number; lng: number };
};

export type RoofMeasurement = {
  totalSquares: number;
  slopes: SlopeMeasurement[];
  imageryDate: string;            // YYYY-MM-DD
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  center: { lat: number; lng: number };
  /** The whole building's footprint rectangle — frames the overhead view. */
  bounds?: LatLngBounds;
};

const M2_PER_SQUARE = 9.290304;
const ENDPOINT = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';

function raise(err: unknown): never {
  const e = err instanceof GoogleApiError ? new SolarServiceError(err) : err;
  if (e instanceof SolarServiceError) rememberGoogleDenial(e);
  throw e;
}

/**
 * Raw request. Resolves with the parsed body; throws `SolarNotFoundError` on
 * 404 (key OK, no building) or the typed service error otherwise.
 */
async function findClosest(
  coord: { lat: number; lng: number },
  requiredQuality: 'HIGH' | 'MEDIUM' | 'LOW',
): Promise<any> {
  const denied = recentGoogleDenial('solar');
  if (denied) throw new SolarServiceError(denied);

  const url =
    `${ENDPOINT}?location.latitude=${coord.lat}&location.longitude=${coord.lng}` +
    `&requiredQuality=${requiredQuality}&key=${env.GOOGLE_SOLAR_API_KEY}`;

  const { res, text } = await fetchGoogle('solar', url);
  if (res.status === 404) {
    clearGoogleDenial('solar');
    throw new SolarNotFoundError();
  }
  if (!res.ok) throw classifyGoogleFailure('solar', res.status, text);
  clearGoogleDenial('solar');
  try {
    return JSON.parse(text);
  } catch {
    throw new GoogleApiError('solar', 'http', 'Google returned an unreadable response.', res.status);
  }
}

export async function measureRoof(
  coord: { lat: number; lng: number },
): Promise<RoofMeasurement> {
  if (!isGoogleSolarConfigured) throw new SolarNotConfiguredError();

  let data: any;
  try {
    data = await findClosest(coord, 'HIGH');
  } catch (e) {
    raise(e);
  }

  const segments: any[] = data?.solarPotential?.roofSegmentStats ?? [];
  const wholeRoofM2 = Number(data?.solarPotential?.wholeRoofStats?.areaMeters2 ?? 0);
  const imagery = data?.imageryDate ?? {};
  const imageryQuality = String(data?.imageryQuality ?? 'UNKNOWN');

  const slopes: SlopeMeasurement[] = segments.map((seg) => {
    const areaM2 = Number(seg?.stats?.areaMeters2 ?? 0);
    const pitchDeg = Number(seg?.pitchDegrees ?? 0);
    const azimuth = Number(seg?.azimuthDegrees ?? 0);
    return {
      orientation: pitchDeg < 5 ? 'Flat' : yawToOrientation(azimuth),
      pitchDegrees: pitchDeg,
      pitchRatio: pitchDegreesToRatio(pitchDeg),
      squares: areaM2 / M2_PER_SQUARE,
      azimuthDegrees: azimuth,
      bounds: parseBounds(seg?.boundingBox),
      center: parseLatLng(seg?.center),
    };
  });

  return {
    totalSquares: wholeRoofM2 / M2_PER_SQUARE,
    slopes,
    imageryDate: formatImageryDate(imagery),
    imageryQuality: normalizeQuality(imageryQuality),
    center: {
      lat: Number(data?.center?.latitude ?? coord.lat),
      lng: Number(data?.center?.longitude ?? coord.lng),
    },
    bounds: parseBounds(data?.boundingBox),
  };
}

function parseLatLng(raw: any): { lat: number; lng: number } | undefined {
  const lat = Number(raw?.latitude);
  const lng = Number(raw?.longitude);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : undefined;
}

function parseBounds(raw: any): LatLngBounds | undefined {
  const sw = parseLatLng(raw?.sw);
  const ne = parseLatLng(raw?.ne);
  return sw && ne ? { sw, ne } : undefined;
}

/**
 * Smallest request the Solar API accepts — one findClosest at a fixed point,
 * lowest quality bar. A 404 (no building) still proves the key is allowed,
 * so it resolves; only key/network failures throw. Used by the Settings
 * "Google APIs" check.
 */
export async function probeSolar(): Promise<void> {
  if (!isGoogleSolarConfigured) throw new SolarNotConfiguredError();
  try {
    // Downtown Dallas — the launch market; any point works, the answer
    // we care about is "did Google let this key ask".
    await findClosest({ lat: 32.7767, lng: -96.797 }, 'LOW');
  } catch (e) {
    if (e instanceof SolarNotFoundError) return;
    raise(e);
  }
}

function pitchDegreesToRatio(d: number): string {
  if (d < 1) return 'Flat';
  const rise = Math.round(Math.tan((d * Math.PI) / 180) * 12);
  return `${rise}/12`;
}

function formatImageryDate(d: any): string {
  if (!d || !d.year) return 'Unknown';
  const m = String(d.month ?? 1).padStart(2, '0');
  const day = String(d.day ?? 1).padStart(2, '0');
  return `${d.year}-${m}-${day}`;
}

function normalizeQuality(q: string): RoofMeasurement['imageryQuality'] {
  const v = q.toUpperCase();
  if (v === 'HIGH' || v === 'MEDIUM' || v === 'LOW') return v;
  return 'UNKNOWN';
}

/** True when the imagery is older than `years` years. */
export function imageryIsStale(date: string, years = 2): boolean {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return false;
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - years);
  return d.getTime() < cutoff.getTime();
}
