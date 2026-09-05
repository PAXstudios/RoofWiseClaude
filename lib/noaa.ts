// Live NOAA storm history via the Iowa Environmental Mesonet (IEM) Local Storm
// Reports archive. The IEM is the authoritative public mirror of NWS LSRs and
// provides free, no-key GeoJSON services with full archive depth.
//
// TWO services, chosen per call (both verified live 2026-09-02):
//
//   Per-point (every map / Hail Tracer / Home / storm-match caller):
//     https://mesonet.agron.iastate.edu/api/1/nws/lsrs_by_point.geojson
//       ?lon=&lat=&radius_miles=&begints=YYYY-MM-DDTHH:MMZ&endts=...
//     ~0.3 MB per year at 50 mi, no feature cap observed (14,221 features at
//     200 mi / 4 yr came back whole).
//
//   Statewide (Storm Watch's 24 h scan):
//     https://mesonet.agron.iastate.edu/geojson/lsr.geojson
//       ?sts=YYYY-MM-DDTHH:MMZ&ets=...&states=XX
//     ~100 KB per day for TX, but SILENTLY CAPS at 10,000 features (TX 4 yr =
//     10,000 of 23,079) — so it is never used for multi-year history.
//
// DO NOT go back to cgi-bin/request/gis/lsr.py?fmt=geojson: that service now
// rejects fmt=geojson (allowed: csv|kml|excel|shp) and tz-naive sts/ets with
// HTTP 422, which is what put "NOAA storm history is unavailable" on every
// surface of the first device run. Its `type=` filter also returns 0 rows.
//
// Response shape (both services): properties.type is a ONE-LETTER code
// ('H' hail, 'G' tstm wind gust, 'D' tstm wind damage, 'N'/'O' non-tstm
// gust/damage, 'W' = LANDSPOUT — not wind), properties.typetext is the word,
// magnitude is inches for hail and MPH for wind (unit: 'MPH'), valid is ISO-Z.

import { BBox, inBBox } from './geo';
import { env } from './env';

export type StormType = 'hail' | 'wind';

export type StormEvent = {
  id: string;
  lat: number;
  lon: number;
  type: StormType;
  /**
   * Hail size in inches; wind speed in MPH. IEM reports gusts in MPH
   * (`unit: 'MPH'`) — the layer used to assume knots and inflated every
   * displayed gust by 15% while admitting sub-severe 50–57 mph gusts.
   */
  magnitude: number | null;
  occurredAt: string; // ISO
  remarks?: string;
  city?: string;
  state?: string;
  source: 'iem-lsr';
};

export type FetchOpts = {
  /** Two-letter state, e.g. "TX". Used by the statewide service only. */
  state: string;
  start: Date;
  end: Date;
  types?: StormType[];
  /**
   * When present the per-point service is used and the server does the
   * radius crop — every map/history caller should pass this. Without it the
   * fetch is statewide (Storm Watch), which is only safe for short windows.
   */
  near?: { lat: number; lon: number; radiusMiles: number };
};

const POINT_ENDPOINT = 'https://mesonet.agron.iastate.edu/api/1/nws/lsrs_by_point.geojson';
const STATE_ENDPOINT = 'https://mesonet.agron.iastate.edu/geojson/lsr.geojson';

/** The statewide service truncates silently at this many features. */
const STATE_FEATURE_CAP = 10_000;

/**
 * App-side request bound. A hung Mesonet request otherwise leaves the Map /
 * Hail Tracer spinner up until the OS gives up (~60 s). Aborting maps to the
 * typed 'unavailable' result in every caller.
 */
const REQUEST_TIMEOUT_MS = 20_000;

function fmt(d: Date) {
  // YYYY-MM-DDTHH:MMZ — IEM requires timezone-aware timestamps (HTTP 422
  // "Input should have timezone info" without the trailing 'Z').
  return d.toISOString().slice(0, 16) + 'Z';
}

/**
 * IEM LSR type codes. Classify on the CODE first: `properties.type` is the
 * one-letter code, so the old `props.type ?? props.typetext` + substring match
 * saw 'H' and dropped every feature ("No validated storm events" with a
 * silently empty map). 'W' is LANDSPOUT/WATERSPOUT at IEM, never wind.
 */
const HAIL_CODES = new Set(['H']);
const WIND_CODES = new Set(['G', 'D', 'N', 'O', 'A']); // tstm gust/dmg, non-tstm gust/dmg, high sustained

function classify(code: string, text: string): StormType | null {
  if (HAIL_CODES.has(code)) return 'hail';
  if (WIND_CODES.has(code)) return 'wind';
  // Text fallback only when the code is absent/unknown.
  const t = text.toUpperCase();
  if (t.includes('HAIL')) return 'hail';
  if (t.includes('WND') || t.includes('WIND')) return 'wind';
  return null;
}

function parseMagnitude(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

/** Wind magnitudes normalised to MPH; IEM sends MPH, knots handled defensively. */
function normaliseWindMph(mag: number | null, unit: unknown): number | null {
  if (mag == null) return null;
  const u = typeof unit === 'string' ? unit.toUpperCase() : '';
  return u.startsWith('KT') ? mag * 1.15078 : mag;
}

export async function fetchStormHistory({
  state,
  start,
  end,
  types = ['hail', 'wind'],
  near,
}: FetchOpts): Promise<StormEvent[]> {
  const url = near
    ? `${POINT_ENDPOINT}?lon=${near.lon.toFixed(4)}&lat=${near.lat.toFixed(4)}` +
      `&radius_miles=${Math.max(1, Math.round(near.radiusMiles))}` +
      `&begints=${fmt(start)}&endts=${fmt(end)}`
    : `${STATE_ENDPOINT}?sts=${fmt(start)}&ets=${fmt(end)}&states=${encodeURIComponent(state)}`;

  // Bounded request (see REQUEST_TIMEOUT_MS). AbortError becomes a thrown
  // Error so stormMatch/stormWatch surface typed 'unavailable' (Drift #5).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: 'application/json, application/vnd.geo+json',
        // IEM asks automated clients to identify themselves; env guarantees a
        // non-empty fallback so this header is never blank.
        'User-Agent': env.NOAA_USER_AGENT,
      },
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error(`NOAA/IEM request timed out after ${REQUEST_TIMEOUT_MS / 1000}s`);
    }
    throw err;
  }
  clearTimeout(timer);

  if (!res.ok) {
    throw new Error(`NOAA/IEM request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    features?: {
      id?: string;
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }[];
  };

  const features = data.features ?? [];
  // Truncation guard (Drift #5): a capped statewide answer is an incomplete
  // map that looks complete. Callers render 'unavailable' instead.
  if (!near && features.length >= STATE_FEATURE_CAP) {
    throw new Error('NOAA/IEM result truncated at the statewide feature cap');
  }

  const events: StormEvent[] = [];
  // IEM can return distinct local-storm reports at the same coordinate and
  // timestamp (and occasionally repeats a feature id). React map overlays,
  // selection sets, and clustering all require a unique event identity, so
  // preserve the provider/base id for the first record and deterministically
  // suffix later occurrences in response order.
  const idOccurrences = new Map<string, number>();
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const [lon, lat] = coords;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const props = f.properties ?? {};
    const code = typeof props.type === 'string' ? props.type.toUpperCase() : '';
    const text = typeof props.typetext === 'string' ? props.typetext : '';
    const cls = classify(code, text);
    if (!cls) continue;
    if (!types.includes(cls)) continue;
    // Per-point: `magnitude` is numeric. Statewide: `magf` is numeric and
    // `magnitude` is a string ('' when absent) — magf first, then magnitude.
    const rawMag = parseMagnitude(props.magf ?? props.magnitude ?? props.mag);
    const magnitude = cls === 'wind' ? normaliseWindMph(rawMag, props.unit) : rawMag;
    // A report with no timestamp is dropped, never stamped "now" (Drift #5):
    // an invented event time would pass the HAAG two-year corroboration
    // window and the Storm Watch 24 h scan on a storm that may be years old.
    const valid = props.valid ?? props.utc_valid;
    if (typeof valid !== 'string' || valid.length === 0) continue;
    const baseId = String(f.id ?? `${lat},${lon},${valid}`);
    const occurrence = (idOccurrences.get(baseId) ?? 0) + 1;
    idOccurrences.set(baseId, occurrence);
    events.push({
      id: occurrence === 1 ? baseId : `${baseId}#${occurrence}`,
      lat,
      lon,
      type: cls,
      magnitude,
      occurredAt: valid,
      remarks: typeof props.remark === 'string' ? props.remark : undefined,
      city: typeof props.city === 'string' ? props.city : undefined,
      state: typeof props.state === 'string' ? props.state : undefined,
      source: 'iem-lsr',
    });
  }
  return events;
}

export function cropToBBox(events: StormEvent[], bbox: BBox): StormEvent[] {
  return events.filter((e) => inBBox({ lat: e.lat, lon: e.lon }, bbox));
}

export function severityColor(e: StormEvent): string {
  if (e.type === 'hail') {
    const m = e.magnitude ?? 0;
    if (m >= 2) return '#B83239'; // softball+
    if (m >= 1.25) return '#E5484D'; // golf+
    if (m >= 0.75) return '#1E66F5';
    return '#7AA2F7';
  }
  // Wind in MPH (IEM unit). Bands are the old knot bands converted:
  // 75/60/50 kt -> 86/69/58 mph; 58 mph is the NWS severe criterion.
  const m = e.magnitude ?? 0;
  if (m >= 86) return '#B83239';
  if (m >= 69) return '#E5484D';
  if (m >= 58) return '#F26B1F';
  return '#FFB061';
}

export function magnitudeLabel(e: StormEvent): string {
  if (e.magnitude == null) return e.type === 'hail' ? 'Hail' : 'Wind';
  if (e.type === 'hail') return `${e.magnitude.toFixed(2)}"`;
  // MPH — the unit IEM sends; labelling this 'kt' understated every gust.
  return `${Math.round(e.magnitude)} mph`;
}

/** Useful preset date ranges. */
export function rangeYearsAgo(years: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  return { start, end };
}

export const US_STATES: { code: string; name: string }[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'CO', name: 'Colorado' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'IA', name: 'Iowa' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WI', name: 'Wisconsin' },
];

export const STATE_CENTERS: Record<string, { lat: number; lon: number; zoom: number }> = {
  TX: { lat: 31.5, lon: -99.3, zoom: 6 },
  OK: { lat: 35.4, lon: -97.9, zoom: 7 },
  KS: { lat: 38.5, lon: -98.4, zoom: 7 },
  CO: { lat: 39.0, lon: -105.5, zoom: 7 },
  MO: { lat: 38.4, lon: -92.5, zoom: 7 },
  IA: { lat: 41.9, lon: -93.5, zoom: 7 },
  IL: { lat: 40.0, lon: -89.2, zoom: 7 },
  GA: { lat: 32.7, lon: -83.5, zoom: 7 },
  FL: { lat: 27.8, lon: -81.7, zoom: 6 },
  NC: { lat: 35.5, lon: -79.4, zoom: 7 },
  TN: { lat: 35.9, lon: -86.4, zoom: 7 },
  OH: { lat: 40.4, lon: -82.8, zoom: 7 },
  IN: { lat: 39.9, lon: -86.3, zoom: 7 },
  AL: { lat: 32.8, lon: -86.8, zoom: 7 },
  AR: { lat: 34.8, lon: -92.4, zoom: 7 },
  NE: { lat: 41.5, lon: -99.8, zoom: 6 },
  SD: { lat: 44.4, lon: -100.2, zoom: 6 },
  ND: { lat: 47.5, lon: -100.5, zoom: 6 },
  MN: { lat: 46.0, lon: -94.3, zoom: 6 },
  WI: { lat: 44.5, lon: -89.5, zoom: 6 },
  MS: { lat: 32.7, lon: -89.7, zoom: 7 },
  LA: { lat: 31.0, lon: -91.9, zoom: 7 },
  KY: { lat: 37.7, lon: -85.3, zoom: 7 },
  VA: { lat: 37.7, lon: -78.6, zoom: 7 },
  PA: { lat: 40.9, lon: -77.7, zoom: 7 },
  SC: { lat: 33.9, lon: -80.9, zoom: 7 },
  AZ: { lat: 34.2, lon: -111.7, zoom: 6 },
  NM: { lat: 34.4, lon: -106.1, zoom: 6 },
};
