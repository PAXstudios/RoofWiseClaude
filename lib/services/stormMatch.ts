// Find the nearest qualifying storm event for an inspection's
// (lat, lng, date). Used to auto-fill `Inspection.event` so the
// HAAG report can cite a NOAA-verified storm.

import { fetchStormHistory, type StormEvent } from '../noaa';
import type { StormEvent as InspectionStormEvent } from '../models/types';

const HAIL_MIN_INCHES = 0.75;
const WIND_MIN_KNOTS = 50.4;  // 58 mph
const RADIUS_MILES = 5;
const WINDOW_DAYS = 30;

export async function findMatchingStorm(args: {
  lat: number;
  lng: number;
  near: Date;
  state: string;
}): Promise<InspectionStormEvent | null> {
  const start = new Date(args.near.getTime() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const end = new Date(args.near.getTime() + WINDOW_DAYS * 24 * 60 * 60 * 1000);

  let events: StormEvent[] = [];
  try {
    events = await fetchStormHistory({
      state: args.state,
      start,
      end,
      types: ['hail', 'wind'],
    });
  } catch {
    return null;
  }

  // Filter to qualifying magnitudes within radius
  const qualifying = events
    .filter(qualifies)
    .map((e) => ({
      event: e,
      distanceMi: haversine(args.lat, args.lng, e.lat, e.lon),
    }))
    .filter((x) => x.distanceMi <= RADIUS_MILES)
    .sort((a, b) => a.distanceMi - b.distanceMi);

  const best = qualifying[0];
  if (!best) return null;

  const e = best.event;
  return {
    date: e.occurredAt,
    kind: e.type,
    hailSizeInches: e.type === 'hail' ? e.magnitude ?? undefined : undefined,
    windSpeedMph: e.type === 'wind' ? Math.round((e.magnitude ?? 0) * 1.15078) : undefined,
    noaaEventId: e.id,
    distanceMiles: best.distanceMi,
    source: 'NOAA',
  };
}

function qualifies(e: StormEvent): boolean {
  if (e.magnitude == null) return false;
  if (e.type === 'hail') return e.magnitude >= HAIL_MIN_INCHES;
  if (e.type === 'wind') return e.magnitude >= WIND_MIN_KNOTS;
  return false;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
