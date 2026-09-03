// Do-not-knock geometry — pure, no I/O, Node-testable.
//
// A home entry blocks a small circle around its door (25 m by default — a
// suburban lot). A zone blocks a drawn polygon, or a circle when the zone
// was entered as a centre + radius. `blockedBy` answers "may I knock here?"
// for one point; `blockedShare` samples a 3-mile planner cell so the finder
// can down-weight (or drop) an area a no-solicit list covers.

import type { DoNotKnockEntry } from '../models/types';

/** A house-width: pins closer than this to a home entry are that home. */
export const HOME_RADIUS_METERS = 25;

const EARTH_M = 6371000;

export function distanceMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_M * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Ray-casting point-in-polygon on lat/lng (fine at neighbourhood scale). */
export function pointInPolygon(lat: number, lng: number, poly: readonly { lat: number; lng: number }[]): boolean {
  if (poly.length < 3) return false;
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const yi = poly[i].lat;
    const xi = poly[i].lng;
    const yj = poly[j].lat;
    const xj = poly[j].lng;
    const crosses = yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi || 1e-12) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** Does this entry cover the point? */
export function entryCovers(e: DoNotKnockEntry, lat: number, lng: number): boolean {
  if (e.polygon && e.polygon.length >= 3) return pointInPolygon(lat, lng, e.polygon);
  if (e.lat == null || e.lng == null) return false;
  const r = e.radiusMeters ?? (e.kind === 'home' ? HOME_RADIUS_METERS : 0);
  if (r <= 0) return false;
  return distanceMeters(e.lat, e.lng, lat, lng) <= r;
}

/** The first entry that blocks the point, or null. Homes are checked before zones. */
export function blockedBy(
  entries: readonly DoNotKnockEntry[],
  lat: number,
  lng: number,
): DoNotKnockEntry | null {
  let zone: DoNotKnockEntry | null = null;
  for (const e of entries) {
    if (!entryCovers(e, lat, lng)) continue;
    if (e.kind === 'home') return e;
    zone = zone ?? e;
  }
  return zone;
}

/**
 * The share (0–1) of a circular cell that do-not-knock ZONES cover, by
 * sampling a grid of points inside the cell. Homes are single doors and
 * do not move an area's score; zones do. Cheap: 37 samples per cell.
 */
export function blockedShare(
  entries: readonly DoNotKnockEntry[],
  centerLat: number,
  centerLng: number,
  radiusMiles: number,
): number {
  const zones = entries.filter((e) => e.kind === 'zone');
  if (zones.length === 0) return 0;
  const rM = radiusMiles * 1609.344;
  const dLat = rM / 111320;
  const dLng = rM / (111320 * Math.cos((centerLat * Math.PI) / 180) || 1);
  let hit = 0;
  let total = 0;
  const rings = [0, 0.5, 1];
  const perRing = [1, 12, 24];
  rings.forEach((f, ri) => {
    const n = perRing[ri];
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k) / n;
      const lat = centerLat + f * dLat * Math.sin(ang);
      const lng = centerLng + f * dLng * Math.cos(ang);
      total += 1;
      if (zones.some((z) => entryCovers(z, lat, lng))) hit += 1;
    }
  });
  return total === 0 ? 0 : hit / total;
}

/**
 * Parse a pasted no-solicit list — one address per line (an HOA email, a
 * city PDF copied out). Returns the cleaned lines; geocoding is the caller's
 * job (each line becomes a `home` entry once it has coordinates).
 */
export function parseAddressList(text: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.split(/\r?\n|;/)) {
    const line = raw.replace(/^\s*[-•*\d.)]+\s*/, '').trim();
    if (line.length < 5 || !/\d/.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}
