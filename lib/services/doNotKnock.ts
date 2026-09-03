// Do-not-knock geometry — pure, no I/O, Node-testable.
//
// A home entry blocks a small circle around its door (25 m by default — a
// suburban lot). A zone blocks a drawn polygon, or a circle when the zone
// was entered as a centre + radius. `blockedBy` answers "may I knock here?"
// for one point; `blockedShare` samples a 3-mile planner cell so the finder
// can down-weight (or drop) an area a no-solicit list covers.

import type { DoNotKnockEntry } from '../models/types';
import { CELL_MILES, planTrip, type BasePoint, type ScoredArea, type TripPlan } from './knockOpportunities';

/** A house-width: pins closer than this to a home entry are that home. */
export const HOME_RADIUS_METERS = 25;

/**
 * An area whose planner cell is at least this much do-not-knock zone is
 * dropped from the ranking outright; below it the Knock Score is discounted
 * by the covered share. Owner decision pending — see the Wave H report.
 */
export const DROP_SHARE = 0.5;

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
    // Strip list numbering ("1. ", "2) ") and bullets — but never a bare
    // house number ("1500 Elm St") or the leading digits of a coordinate
    // pair ("33.1500, -96.8200"): a numeral only counts as numbering when a
    // "." or ")" and whitespace follow it.
    const line = raw.replace(/^\s*(?:[-•*]+\s*|\d{1,3}[.)]\s+)/, '').trim();
    if (line.length < 5 || !/\d/.test(line)) continue;
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out;
}

/**
 * "33.1500, -96.8200" → a coordinate pair, so a roofer can paste a point
 * from Maps (or a gate's GPS) without a geocoder. Null for anything else —
 * a street address never looks like two decimals.
 */
export function parseLatLng(text: string): { lat: number; lng: number } | null {
  const m = text.trim().match(/^(-?\d{1,2}(?:\.\d+)?)\s*[, ]\s*(-?\d{1,3}(?:\.\d+)?)$/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

// ---------------------------------------------------------------------------
// Planner exclusions — pure post-processing of a finder result
// ---------------------------------------------------------------------------

export type DoNotKnockExclusions = {
  /** Areas removed because ≥ DROP_SHARE of the cell is a no-knock zone. */
  dropped: { key: string; name: string; share: number; zone: string }[];
  /** Areas kept with a lowered score (0 < share < DROP_SHARE). */
  discounted: { key: string; name: string; share: number; from: number; to: number; zone: string }[];
};

function areaName(a: ScoredArea): string {
  return a.name ?? a.storm.town ?? 'Area';
}

/** The zone that covers the most of the cell — the one the note names. */
function dominantZone(zones: readonly DoNotKnockEntry[], a: ScoredArea): { zone: DoNotKnockEntry; share: number } | null {
  let best: { zone: DoNotKnockEntry; share: number } | null = null;
  for (const z of zones) {
    const share = blockedShare([z], a.lat, a.lng, CELL_MILES);
    if (share > 0 && (!best || share > best.share)) best = { zone: z, share };
  }
  return best;
}

/**
 * Apply the do-not-knock list to a ranked result: areas mostly inside a
 * zone are dropped (and said so in `notes`), partly-covered areas keep a
 * discounted score with a reason line, the list is re-sorted and the trip
 * re-planned from base. Homes are single doors and never move a score.
 * Pure — the runner calls it on every partial and on the final result.
 */
export function applyDoNotKnockExclusions<
  T extends { areas: ScoredArea[]; base: BasePoint; notes: string[]; plan: TripPlan },
>(result: T, entries: readonly DoNotKnockEntry[]): { result: T; exclusions: DoNotKnockExclusions } {
  const zones = entries.filter((e) => e.kind === 'zone');
  const exclusions: DoNotKnockExclusions = { dropped: [], discounted: [] };
  if (zones.length === 0 || result.areas.length === 0) return { result, exclusions };

  const kept: ScoredArea[] = [];
  const notes = [...result.notes];
  for (const a of result.areas) {
    const share = blockedShare(zones, a.lat, a.lng, CELL_MILES);
    if (share <= 0) {
      kept.push(a);
      continue;
    }
    const name = areaName(a);
    const zone = dominantZone(zones, a)?.zone.label ?? 'a do-not-knock zone';
    if (share >= DROP_SHARE) {
      exclusions.dropped.push({ key: a.key, name, share, zone });
      notes.push(`${name} dropped — inside ${zone} no-solicit zone (${Math.round(share * 100)}% of the area).`);
      continue;
    }
    const to = Math.round(a.knockScore * (1 - share));
    exclusions.discounted.push({ key: a.key, name, share, from: a.knockScore, to, zone });
    kept.push({
      ...a,
      knockScore: to,
      reasons: [
        ...a.reasons,
        `${Math.round(share * 100)} % of this area is a do-not-knock zone (${zone}) — score lowered from ${a.knockScore} to ${to}.`,
      ],
    });
  }

  if (exclusions.dropped.length === 0 && exclusions.discounted.length === 0) return { result, exclusions };

  kept.sort(
    (a, b) => b.knockScore - a.knockScore || b.hitRate.perRoof - a.hitRate.perRoof || a.distanceMiles - b.distanceMiles,
  );
  if (exclusions.discounted.length > 0) {
    const n = exclusions.discounted.length;
    notes.push(`${n} area${n === 1 ? '' : 's'} scored lower for overlapping a do-not-knock zone.`);
  }
  if (kept.length === 0) notes.push('Every ranked area sits inside a do-not-knock zone.');

  return {
    result: { ...result, areas: kept, notes, plan: planTrip(kept, result.base) },
    exclusions,
  };
}
