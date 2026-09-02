// Storm-overlay selection — PURE (no I/O, no React, no react-native-maps).
//
// Why this exists: the Map tab used to hand the native map one MapCircle AND
// one Marker per storm event — ~900 overlays for Dallas / 50 mi / 3 yr on
// Apple Maps under the New Architecture. Everything native receives now goes
// through this module first:
//
//   sanitizeStormEvents  — the ONE coordinate/radius guard. An event whose
//                          lat/lon is not a finite in-range number is dropped
//                          and counted, never passed to native.
//   zoomBandForRegion    — far / mid / near from the visible span.
//   selectStormOverlay   — what to draw for the band:
//       far  → grid-clustered glyphs (count + strongest magnitude)
//       mid  → individual markers only, hard-capped
//       near → markers + circles for events INSIDE the visible region, capped
//                          at MAX_STORM_CIRCLES / MAX_STORM_MARKERS, with the
//                          honest total so the UI can say "showing N of M".
//
// Everything returns plain data so it can be unit-tested in node against
// real IEM events. Colours are expressed as a `tone` — the component maps a
// tone to theme tokens (Drift #11), this file never touches hex.

import type { StormEvent } from '../noaa';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

/** Structural twin of react-native-maps' Region — keeps this module dependency-free. */
export type RegionLike = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type ZoomBand = 'far' | 'mid' | 'near';

/** Semantic storm tone. The component maps these to `colors.storm*` tokens. */
export type StormTone = 'hail' | 'wind' | 'severe';

export type StormClusterCell = {
  /** Stable across re-selections for the same grid + region band. */
  id: string;
  lat: number;
  lon: number;
  count: number;
  hailCount: number;
  windCount: number;
  /** Largest hail size (in) in the cell, when any hail has a size. */
  maxHailInches: number | null;
  /** Strongest wind gust (mph) in the cell, when any wind has a speed. */
  maxWindMph: number | null;
  tone: StormTone;
  /** Ids of the member events — for a tap-to-list later; not drawn. */
  eventIds: string[];
};

export type StormOverlaySelection = {
  band: ZoomBand;
  /** Far band only. */
  clusters: StormClusterCell[];
  /** Mid + near bands. */
  markers: StormEvent[];
  /** Near band only. */
  circles: StormEvent[];
  /** Real totals for the honest count line. */
  totalEvents: number;
  /** Events inside the visible region (near band) or all events (far/mid). */
  inRegion: number;
  /** True when a cap trimmed markers or circles below what was eligible. */
  capped: boolean;
};

export type SanitizedStormEvents = {
  events: StormEvent[];
  /** How many were dropped for an invalid coordinate / missing id. */
  dropped: number;
  /**
   * How many kept a distinct id suffix because they collided with an earlier
   * event's id. Real IEM data does this (~40 of 893 for Dallas / 50 mi / 3 yr:
   * `lib/noaa.ts` falls back to `lat,lon,minute` as the id, and two reports
   * at the same spot in the same minute collide). Duplicate keys break React
   * reconciliation of native marker children, so they are re-keyed — never
   * dropped, they are distinct reports.
   */
  rekeyed: number;
};

// -----------------------------------------------------------------------------
// Caps and thresholds
// -----------------------------------------------------------------------------

/** Hard caps on what native ever receives at once. */
export const MAX_STORM_CIRCLES = 150;
export const MAX_STORM_MARKERS = 400;
/** Far-band cluster grid — ≤ 8 × 8 glyphs on screen, never more. */
export const CLUSTER_GRID = 8;

/**
 * Band thresholds on `longitudeDelta` (degrees of longitude across the
 * screen). ~1° ≈ 55–60 mi at Texas latitudes.
 *   far  : the 50-mi browse radius fits on screen (≥ 1.4°) — glyphs.
 *   mid  : a metro area (0.3°–1.4°) — pins only.
 *   near : neighbourhoods (< 0.3°) — pins + hit circles inside the view.
 */
export const FAR_LON_DELTA = 1.4;
export const NEAR_LON_DELTA = 0.3;

/** Severe bands — same lines the storm palette legend draws. */
export const SEVERE_HAIL_INCHES = 1.5;
export const SEVERE_WIND_MPH = 75;

/** Hit-circle radius (m): 800 m base + 800 m per inch of hail, capped at 4 km. */
const CIRCLE_BASE_M = 800;
const CIRCLE_PER_INCH_M = 800;
const CIRCLE_MAX_M = 4000;
/** Wind reports get a fixed footprint — a gust has no "size". */
const WIND_CIRCLE_M = 1200;

// -----------------------------------------------------------------------------
// The one guard
// -----------------------------------------------------------------------------

export function isValidLatLon(lat: unknown, lon: unknown): lat is number {
  return (
    typeof lat === 'number' &&
    typeof lon === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    lat >= -90 &&
    lat <= 90 &&
    lon >= -180 &&
    lon <= 180
  );
}

export function isValidRadius(radius: unknown): radius is number {
  return typeof radius === 'number' && Number.isFinite(radius) && radius > 0;
}

/** Drop anything native could choke on. Never throws; never mutates input. */
export function sanitizeStormEvents(events: readonly StormEvent[] | null | undefined): SanitizedStormEvents {
  if (!events || events.length === 0) return { events: [], dropped: 0 };
  const out: StormEvent[] = [];
  let dropped = 0;
  const seen = new Set<string>();
  for (const e of events) {
    if (!e || typeof e.id !== 'string' || e.id.length === 0) {
      dropped += 1;
      continue;
    }
    if (!isValidLatLon(e.lat, e.lon)) {
      dropped += 1;
      continue;
    }
    // Duplicate ids would collide as React keys AND as native annotation ids.
    if (seen.has(e.id)) {
      dropped += 1;
      continue;
    }
    seen.add(e.id);
    out.push(e);
  }
  return { events: out, dropped };
}

/** Circle radius in metres for an event. Always finite and > 0. */
export function stormCircleRadiusMeters(e: StormEvent): number {
  if (e.type === 'hail') {
    const inches = typeof e.magnitude === 'number' && Number.isFinite(e.magnitude) ? e.magnitude : 0.5;
    const r = CIRCLE_BASE_M + CIRCLE_PER_INCH_M * Math.max(0, inches);
    return Math.min(CIRCLE_MAX_M, Math.max(CIRCLE_BASE_M, r));
  }
  return WIND_CIRCLE_M;
}

/** Tone for a single event — severe hail / severe wind / hail / wind. */
export function stormTone(e: StormEvent): StormTone {
  const m = typeof e.magnitude === 'number' && Number.isFinite(e.magnitude) ? e.magnitude : null;
  if (e.type === 'hail') return m != null && m >= SEVERE_HAIL_INCHES ? 'severe' : 'hail';
  return m != null && m >= SEVERE_WIND_MPH ? 'severe' : 'wind';
}

// -----------------------------------------------------------------------------
// Region helpers
// -----------------------------------------------------------------------------

export function isValidRegion(r: RegionLike | null | undefined): r is RegionLike {
  return (
    !!r &&
    isValidLatLon(r.latitude, r.longitude) &&
    Number.isFinite(r.latitudeDelta) &&
    Number.isFinite(r.longitudeDelta) &&
    r.latitudeDelta > 0 &&
    r.longitudeDelta > 0
  );
}

export function zoomBandForRegion(region: RegionLike | null | undefined): ZoomBand {
  if (!isValidRegion(region)) return 'far';
  const span = Math.max(region.longitudeDelta, region.latitudeDelta);
  if (span >= FAR_LON_DELTA) return 'far';
  if (span < NEAR_LON_DELTA) return 'near';
  return 'mid';
}

/**
 * True when the event sits inside the region, padded by `padFraction` of the
 * span on each side so a pin at the edge doesn't pop in and out while panning.
 */
export function eventInRegion(e: StormEvent, region: RegionLike, padFraction = 0.15): boolean {
  const halfLat = region.latitudeDelta * (0.5 + padFraction);
  const halfLon = region.longitudeDelta * (0.5 + padFraction);
  return (
    e.lat >= region.latitude - halfLat &&
    e.lat <= region.latitude + halfLat &&
    e.lon >= region.longitude - halfLon &&
    e.lon <= region.longitude + halfLon
  );
}

// -----------------------------------------------------------------------------
// Clustering (far band)
// -----------------------------------------------------------------------------

/**
 * Grid-cluster events over the region into at most `grid × grid` cells. Cells
 * are keyed by grid index so ids are stable across identical regions. Events
 * outside the (padded) region are ignored — off-screen clusters cost native
 * overlays for nothing.
 */
export function clusterStormEvents(
  events: readonly StormEvent[],
  region: RegionLike,
  grid: number = CLUSTER_GRID,
): StormClusterCell[] {
  if (!isValidRegion(region) || events.length === 0) return [];
  const g = Math.max(2, Math.min(16, Math.floor(grid)));
  const pad = 0.15;
  const minLat = region.latitude - region.latitudeDelta * (0.5 + pad);
  const minLon = region.longitude - region.longitudeDelta * (0.5 + pad);
  const cellLat = (region.latitudeDelta * (1 + 2 * pad)) / g;
  const cellLon = (region.longitudeDelta * (1 + 2 * pad)) / g;

  type Acc = {
    latSum: number;
    lonSum: number;
    count: number;
    hail: number;
    wind: number;
    maxHail: number | null;
    maxWind: number | null;
    ids: string[];
    row: number;
    col: number;
  };
  const cells = new Map<string, Acc>();

  for (const e of events) {
    if (!eventInRegion(e, region, pad)) continue;
    const row = Math.floor((e.lat - minLat) / cellLat);
    const col = Math.floor((e.lon - minLon) / cellLon);
    if (row < 0 || col < 0 || row >= g || col >= g) continue;
    const key = `${row}:${col}`;
    let acc = cells.get(key);
    if (!acc) {
      acc = {
        latSum: 0,
        lonSum: 0,
        count: 0,
        hail: 0,
        wind: 0,
        maxHail: null,
        maxWind: null,
        ids: [],
        row,
        col,
      };
      cells.set(key, acc);
    }
    acc.latSum += e.lat;
    acc.lonSum += e.lon;
    acc.count += 1;
    acc.ids.push(e.id);
    const m = typeof e.magnitude === 'number' && Number.isFinite(e.magnitude) ? e.magnitude : null;
    if (e.type === 'hail') {
      acc.hail += 1;
      if (m != null && (acc.maxHail == null || m > acc.maxHail)) acc.maxHail = m;
    } else {
      acc.wind += 1;
      if (m != null && (acc.maxWind == null || m > acc.maxWind)) acc.maxWind = m;
    }
  }

  const out: StormClusterCell[] = [];
  for (const acc of cells.values()) {
    const lat = acc.latSum / acc.count;
    const lon = acc.lonSum / acc.count;
    // A cluster centroid is always inside its members' bounds, but guard the
    // arithmetic anyway — native never sees a NaN.
    if (!isValidLatLon(lat, lon)) continue;
    const severe =
      (acc.maxHail != null && acc.maxHail >= SEVERE_HAIL_INCHES) ||
      (acc.maxWind != null && acc.maxWind >= SEVERE_WIND_MPH);
    out.push({
      id: `cluster:${g}:${acc.row}:${acc.col}`,
      lat,
      lon,
      count: acc.count,
      hailCount: acc.hail,
      windCount: acc.wind,
      maxHailInches: acc.maxHail,
      maxWindMph: acc.maxWind,
      tone: severe ? 'severe' : acc.hail >= acc.wind ? 'hail' : 'wind',
      eventIds: acc.ids,
    });
  }
  // Largest first so, if a caller ever truncates, the busiest cells survive.
  out.sort((a, b) => b.count - a.count);
  return out;
}

/** Short glyph label: "12" / "1.75″" style secondary line is the caller's. */
export function clusterMagnitudeLabel(cell: StormClusterCell): string | null {
  if (cell.maxHailInches != null) return `${cell.maxHailInches.toFixed(2)}"`;
  if (cell.maxWindMph != null) return `${Math.round(cell.maxWindMph)} mph`;
  return null;
}

// -----------------------------------------------------------------------------
// Selection
// -----------------------------------------------------------------------------

/** Strongest-first, newest breaking ties: what survives a cap. */
function bySeverityThenRecency(a: StormEvent, b: StormEvent): number {
  const ta = stormTone(a) === 'severe' ? 1 : 0;
  const tb = stormTone(b) === 'severe' ? 1 : 0;
  if (ta !== tb) return tb - ta;
  return Date.parse(b.occurredAt) - Date.parse(a.occurredAt);
}

/**
 * Decide what the overlay draws for the current viewport. Input events are
 * assumed sanitized (call `sanitizeStormEvents` first — the overlay does).
 * Deterministic and allocation-light; safe to run on every debounced region
 * change.
 */
export function selectStormOverlay(
  events: readonly StormEvent[],
  region: RegionLike | null | undefined,
  caps: { circles?: number; markers?: number } = {},
): StormOverlaySelection {
  const maxCircles = Math.max(0, caps.circles ?? MAX_STORM_CIRCLES);
  const maxMarkers = Math.max(0, caps.markers ?? MAX_STORM_MARKERS);
  const total = events.length;
  const band = zoomBandForRegion(region);

  if (total === 0) {
    return { band, clusters: [], markers: [], circles: [], totalEvents: 0, inRegion: 0, capped: false };
  }

  if (band === 'far' || !isValidRegion(region)) {
    const clusters = isValidRegion(region) ? clusterStormEvents(events, region) : [];
    const inRegion = clusters.reduce((n, c) => n + c.count, 0);
    return { band: 'far', clusters, markers: [], circles: [], totalEvents: total, inRegion, capped: false };
  }

  const visible = events.filter((e) => eventInRegion(e, region));
  const ranked = visible.length > maxMarkers ? [...visible].sort(bySeverityThenRecency) : visible;
  const markers = ranked.slice(0, maxMarkers);

  if (band === 'mid') {
    return {
      band,
      clusters: [],
      markers,
      circles: [],
      totalEvents: total,
      inRegion: visible.length,
      capped: markers.length < visible.length,
    };
  }

  // near: circles ride the same ranked list so the strongest hits get a footprint.
  const circleSource = ranked === visible ? [...visible].sort(bySeverityThenRecency) : ranked;
  const circles = circleSource.slice(0, maxCircles);
  return {
    band,
    clusters: [],
    markers,
    circles,
    totalEvents: total,
    inRegion: visible.length,
    capped: markers.length < visible.length || circles.length < visible.length,
  };
}

/**
 * Honest count line for the stat bar. Never claims to draw more than it drew;
 * "unavailable" (NOAA/IEM unreachable) and "none found" (service answered)
 * stay different facts (Drift #5).
 */
export function stormOverlayCountLine(
  sel: Pick<StormOverlaySelection, 'band' | 'totalEvents' | 'inRegion' | 'markers' | 'circles' | 'clusters'>,
  window: string,
  state: { loading: boolean; unavailable: boolean; overlaysOff: boolean },
): string {
  if (state.unavailable) return `Storm pins withheld — NOAA history unavailable · ${window}`;
  if (state.loading && sel.totalEvents === 0) return `Checking NOAA storm reports · ${window}`;
  if (sel.totalEvents === 0) return `No validated storm events · ${window}`;
  const total = `${sel.totalEvents} storm event${sel.totalEvents === 1 ? '' : 's'}`;
  if (state.overlaysOff) return `${total} · overlays off · ${window}`;
  if (sel.band === 'far') {
    return `${total} in ${sel.clusters.length} cluster${sel.clusters.length === 1 ? '' : 's'} · ${window}`;
  }
  const shown = sel.markers.length;
  if (shown < sel.inRegion) return `Showing ${shown} of ${sel.inRegion} in view · ${total} · ${window}`;
  if (sel.inRegion < sel.totalEvents) return `${sel.inRegion} in view · ${total} · ${window}`;
  return `${total} · ${window}`;
}
