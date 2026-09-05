// Door-knocking track maths — pure. No I/O, no stores, no React.
//
// Everything the session screen needs to turn a stream of GPS fixes into
// something honest: distance accumulated over accepted samples, a walked-path
// polyline thinned to a bounded point count, "is there already a knock at this
// house" matching, and elapsed-time formatting. The live tracker
// (components/knock/sessionTracker.ts) and the stores call these; nothing
// here knows where a fix came from.

import type { Knock, KnockTrackPoint } from '../models/types';

export type LatLng = { lat: number; lng: number };

const EARTH_RADIUS_MI = 3958.8;
const METERS_PER_MILE = 1609.344;

/** Great-circle distance in miles. */
export function haversineMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MI * Math.asin(Math.sqrt(h));
}

/** Great-circle distance in meters. */
export function distanceMeters(a: LatLng, b: LatLng): number {
  return haversineMiles(a, b) * METERS_PER_MILE;
}

/**
 * Two knocks are the same door when they sit inside this many meters of each
 * other — a suburban lot is 15–25 m wide, and a phone's fix wanders about
 * 5–10 m at the door, so 15 m catches "I tapped the same house twice" without
 * merging next-door neighbours.
 */
export const SAME_HOUSE_METERS = 15;

/** GPS pins need a recent fix; permission alone does not locate this door. */
export const KNOCK_FIX_MAX_AGE_MS = 30_000;

/** Future/invalid timestamps are not fresh after a device-clock change. */
export function isFreshKnockFix(fix: { ts: number | null } | null | undefined, now = Date.now()): boolean {
  if (!fix || typeof fix.ts !== 'number' || !Number.isFinite(fix.ts) || fix.ts <= 0 || !Number.isFinite(now) || now <= 0) return false;
  const age = now - fix.ts;
  return age >= 0 && age <= KNOCK_FIX_MAX_AGE_MS;
}

/**
 * Movement below this is GPS jitter, not walking: a roofer standing at a door
 * for two minutes must not accrue distance. Matches the mileage store's own
 * floor.
 */
export const MIN_SAMPLE_METERS = 10;

/**
 * A fix whose reported horizontal accuracy is worse than this (meters) is not
 * a position, it is a guess — under a porch roof or between two-story houses
 * the phone can report 60–100 m. Such fixes are dropped from the track rather
 * than being walked into the mileage total.
 */
export const MAX_ACCURACY_METERS = 50;

/**
 * Should this fix be appended to a track ending at `last`? Pure gate used by
 * both the mileage trip and the session polyline so the two never disagree
 * about what counts as movement.
 */
export function acceptSample(
  last: LatLng | undefined,
  next: LatLng & { accuracy?: number | null },
  opts: { minMeters?: number; maxAccuracy?: number } = {},
): boolean {
  if (!Number.isFinite(next.lat) || !Number.isFinite(next.lng)) return false;
  const maxAccuracy = opts.maxAccuracy ?? MAX_ACCURACY_METERS;
  if (typeof next.accuracy === 'number' && Number.isFinite(next.accuracy) && next.accuracy > maxAccuracy) {
    return false;
  }
  if (!last) return true;
  return distanceMeters(last, next) >= (opts.minMeters ?? MIN_SAMPLE_METERS);
}

/** Miles along an ordered list of points. */
export function accumulateMiles(points: readonly LatLng[]): number {
  let miles = 0;
  for (let i = 1; i < points.length; i += 1) miles += haversineMiles(points[i - 1], points[i]);
  return miles;
}

/** Miles over the points at or after `sinceTs` — a trip that predates the session. */
export function milesSince(points: readonly KnockTrackPoint[], sinceTs: number): number {
  return accumulateMiles(points.filter((p) => p.ts >= sinceTs));
}

/**
 * Bound a track to `max` points by keeping every k-th point plus the last —
 * a polyline with 3,000 vertices is a real cost on the native map, and the
 * eye cannot tell 500 from 3,000 at street zoom. Endpoints always survive.
 */
export function thinTrack<T>(points: readonly T[], max = 500): T[] {
  if (max < 2) return points.length > 0 ? [points[points.length - 1]] : [];
  if (points.length <= max) return [...points];
  const step = (points.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max - 1; i += 1) out.push(points[Math.round(i * step)]);
  out.push(points[points.length - 1]);
  return out;
}

/**
 * The knock already logged at (or beside) this spot, if any — the closest one
 * inside `maxMeters`. Pure; the session store decides what to do with it.
 */
export function nearestKnock(
  knocks: readonly Knock[],
  at: LatLng,
  maxMeters = SAME_HOUSE_METERS,
): { knock: Knock; meters: number } | null {
  let best: { knock: Knock; meters: number } | null = null;
  for (const k of knocks) {
    const m = distanceMeters({ lat: k.lat, lng: k.lng }, at);
    if (m <= maxMeters && (!best || m < best.meters)) best = { knock: k, meters: m };
  }
  return best;
}

/** "1h 12m" / "38m" / "0m" — a route timer, not a stopwatch. */
export function formatElapsed(ms: number): string {
  const totalMin = Math.max(0, Math.floor(ms / 60_000));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Miles to one decimal, no trailing junk: 0.04 → "0.0", 3.456 → "3.5". */
export function formatMiles(miles: number): string {
  return (Number.isFinite(miles) ? miles : 0).toFixed(1);
}

/**
 * Frame every point with a little air around it. Returns null for an empty
 * list; a single point gets a tight street-level window.
 */
export function regionForPoints(
  points: readonly LatLng[],
  minDelta = 0.004,
): { latitude: number; longitude: number; latitudeDelta: number; longitudeDelta: number } | null {
  if (points.length === 0) return null;
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of points) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }
  const pad = 1.4;
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLng + maxLng) / 2,
    latitudeDelta: Math.max(minDelta, (maxLat - minLat) * pad),
    longitudeDelta: Math.max(minDelta, (maxLng - minLng) * pad),
  };
}
