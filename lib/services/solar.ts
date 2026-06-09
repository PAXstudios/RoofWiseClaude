// Google Solar API — buildingInsights:findClosest.
// Docs: https://developers.google.com/maps/documentation/solar/building-insights
//
// We use the Solar API for ROOF GEOMETRY (area, pitch, azimuth per slope),
// NOT solar production. The roofSegmentStats array gives us per-slope
// area + pitch + azimuth in metric units; we convert to squares (100 sq ft)
// and named orientations.

import { env, isGoogleSolarConfigured } from '../env';
import type { SlopeOrientation } from '../models/types';
import { yawToOrientation } from '../models/types';

export class SolarNotConfiguredError extends Error {
  constructor() {
    super('Google Solar API key not configured.');
    this.name = 'SolarNotConfiguredError';
  }
}

export class SolarNotFoundError extends Error {
  constructor() {
    super('No aerial measurement available for this address.');
    this.name = 'SolarNotFoundError';
  }
}

export class SolarServiceError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'SolarServiceError';
  }
}

export type SlopeMeasurement = {
  orientation: SlopeOrientation;
  pitchDegrees: number;
  pitchRatio: string;            // "5/12"
  squares: number;               // 1 sq = 100 sq ft = 9.290304 m²
  azimuthDegrees: number;
};

export type RoofMeasurement = {
  totalSquares: number;
  slopes: SlopeMeasurement[];
  imageryDate: string;            // YYYY-MM-DD
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW' | 'UNKNOWN';
  center: { lat: number; lng: number };
};

const M2_PER_SQUARE = 9.290304;
const ENDPOINT = 'https://solar.googleapis.com/v1/buildingInsights:findClosest';

export async function measureRoof(
  coord: { lat: number; lng: number },
): Promise<RoofMeasurement> {
  if (!isGoogleSolarConfigured) throw new SolarNotConfiguredError();

  const url =
    `${ENDPOINT}?location.latitude=${coord.lat}&location.longitude=${coord.lng}` +
    `&requiredQuality=HIGH&key=${env.GOOGLE_SOLAR_API_KEY}`;

  const res = await fetch(url);
  if (res.status === 404) throw new SolarNotFoundError();
  if (!res.ok) {
    const body = (await res.text()).slice(0, 300);
    throw new SolarServiceError(`Solar ${res.status}: ${body}`, res.status);
  }

  const data = await res.json();
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
  };
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
