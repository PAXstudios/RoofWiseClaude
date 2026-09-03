// Storm browsing that follows the map — the cache behind Storm Tracer.
//
// WHY: both maps used to fetch storm history ONCE, around a fixed centre (the
// saved service area), and never again. Pan to a property sixty miles away
// and the map had nothing to draw there — "the storm data does not populate
// and neither does the overlay". This service turns the viewport into the
// query: the map asks for the area it is looking at, results merge into a
// cache keyed by event id, and an area already fetched is never re-requested.
//
// Pure except for the one `fetchAddressStormHistory` call, which is injected so
// this file is unit-testable without the network (Drift #8 for the logic).

import { haversineMiles } from './stormMatch';
import type { StormEvent } from '../noaa';
import type { StormHistoryResult } from './stormMatch';

/** Radius each viewport-centred request asks for, in miles. */
export const BROWSE_FETCH_RADIUS_MILES = 50;

/**
 * A new request is made only once the viewport centre has moved this far from
 * every centre already fetched. 60% of the radius keeps adjacent circles
 * overlapping, so the edge of one fetch is inside the next before it becomes
 * the middle of the screen.
 */
export const REFETCH_DISTANCE_MILES = BROWSE_FETCH_RADIUS_MILES * 0.6;

export type FetchedArea = {
  lat: number;
  lon: number;
  radiusMiles: number;
  lookbackYears: number;
  fetchedAt: string;
};

export type StormBrowseState = {
  /** Every event seen so far, by id. Merging never drops one already shown. */
  events: Map<string, StormEvent>;
  /** Centres already covered, so a return pan costs nothing. */
  areas: FetchedArea[];
};

export function emptyBrowseState(): StormBrowseState {
  return { events: new Map(), areas: [] };
}

/**
 * Is this centre already inside an area fetched at (at least) this lookback?
 * A longer lookback fetched earlier covers a shorter one; the reverse does not.
 */
export function isCovered(
  state: StormBrowseState,
  lat: number,
  lon: number,
  lookbackYears: number,
): boolean {
  return state.areas.some(
    (a) =>
      a.lookbackYears >= lookbackYears &&
      haversineMiles(lat, lon, a.lat, a.lon) <= a.radiusMiles - REFETCH_DISTANCE_MILES,
  );
}

/** Merge a result into the cache. Returns a NEW state (React-friendly). */
export function mergeResult(
  state: StormBrowseState,
  area: Omit<FetchedArea, 'fetchedAt'>,
  events: readonly StormEvent[],
  now: Date = new Date(),
): StormBrowseState {
  const merged = new Map(state.events);
  for (const e of events) merged.set(e.id, e);
  return {
    events: merged,
    areas: [...state.areas, { ...area, fetchedAt: now.toISOString() }],
  };
}

export type BrowseFetcher = (args: {
  lat: number;
  lng: number;
  state: string;
  lookbackYears: number;
  radiusMiles: number;
}) => Promise<StormHistoryResult>;

export type BrowseOutcome =
  | { kind: 'covered'; state: StormBrowseState }
  | { kind: 'fetched'; state: StormBrowseState; added: number }
  | { kind: 'unavailable'; state: StormBrowseState; reason: string };

/**
 * Ensure the storms around a viewport centre are loaded. Resolves with the
 * (possibly unchanged) state and what happened — a caller shows "unavailable"
 * only when a request actually failed, never for a centre that was simply
 * already covered.
 */
export async function ensureBrowsed(
  state: StormBrowseState,
  args: { lat: number; lon: number; stateCode: string; lookbackYears: number },
  fetcher: BrowseFetcher,
): Promise<BrowseOutcome> {
  if (isCovered(state, args.lat, args.lon, args.lookbackYears)) {
    return { kind: 'covered', state };
  }
  const res = await fetcher({
    lat: args.lat,
    lng: args.lon,
    state: args.stateCode,
    lookbackYears: args.lookbackYears,
    radiusMiles: BROWSE_FETCH_RADIUS_MILES,
  });
  if (res.status !== 'ok') {
    return { kind: 'unavailable', state, reason: res.reason };
  }
  const before = state.events.size;
  const next = mergeResult(
    state,
    { lat: args.lat, lon: args.lon, radiusMiles: BROWSE_FETCH_RADIUS_MILES, lookbackYears: args.lookbackYears },
    res.events,
  );
  return { kind: 'fetched', state: next, added: next.events.size - before };
}

/** The cache as a stable array for the overlay hooks (newest first). */
export function browsedEvents(state: StormBrowseState): StormEvent[] {
  return [...state.events.values()].sort(
    (a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt),
  );
}
