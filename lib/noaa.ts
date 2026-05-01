// Live NOAA storm history via the Iowa Environmental Mesonet (IEM) Local Storm
// Reports archive. The IEM is the authoritative public mirror of NWS LSRs and
// provides a free, no-key GeoJSON endpoint with full archive depth.
//
// Endpoint: https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py
// Useful params: fmt=geojson, sts=YYYY-MM-DDThh:mm, ets=YYYY-MM-DDThh:mm,
//                state=XX, type=H (hail), type=W (wind / TSTM WND).
//
// We request by (state, date range, types) and crop client-side to the visible
// bbox so the user can pan around without re-fetching.

import { BBox, inBBox } from './geo';

export type StormType = 'hail' | 'wind';

export type StormEvent = {
  id: string;
  lat: number;
  lon: number;
  type: StormType;
  /** hail size in inches, wind speed in knots */
  magnitude: number | null;
  occurredAt: string; // ISO
  remarks?: string;
  city?: string;
  state?: string;
  source: 'iem-lsr';
};

export type FetchOpts = {
  state: string; // e.g. "TX"
  start: Date;
  end: Date;
  types?: StormType[];
};

const ENDPOINT = 'https://mesonet.agron.iastate.edu/cgi-bin/request/gis/lsr.py';

function fmt(d: Date) {
  // YYYY-MM-DDTHH:MM (UTC)
  return d.toISOString().slice(0, 16);
}

function lsrTypeParams(types: StormType[]) {
  const map: Record<StormType, string> = { hail: 'H', wind: 'W' };
  return types.map((t) => `type=${map[t]}`).join('&');
}

function classify(rawType: string): StormType | null {
  const t = rawType.toUpperCase();
  if (t.includes('HAIL')) return 'hail';
  if (t.includes('WIND') || t.includes('TSTM WND') || t.includes('NON-TSTM WND')) return 'wind';
  return null;
}

function parseMagnitude(v: unknown): number | null {
  if (v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  return Number.isFinite(n) ? n : null;
}

export async function fetchStormHistory({
  state,
  start,
  end,
  types = ['hail', 'wind'],
}: FetchOpts): Promise<StormEvent[]> {
  const params = [
    'fmt=geojson',
    `sts=${fmt(start)}`,
    `ets=${fmt(end)}`,
    `state=${state}`,
    lsrTypeParams(types),
  ].join('&');
  const url = `${ENDPOINT}?${params}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`NOAA/IEM request failed: ${res.status} ${res.statusText}`);
  }
  const data = (await res.json()) as {
    features?: Array<{
      id?: string;
      geometry?: { coordinates?: [number, number] };
      properties?: Record<string, unknown>;
    }>;
  };

  const features = data.features ?? [];
  const events: StormEvent[] = [];
  for (const f of features) {
    const coords = f.geometry?.coordinates;
    if (!coords) continue;
    const [lon, lat] = coords;
    const props = f.properties ?? {};
    const rawType = String(props.type ?? props.typetext ?? '');
    const cls = classify(rawType);
    if (!cls) continue;
    if (!types.includes(cls)) continue;
    events.push({
      id: String(f.id ?? `${lat},${lon},${props.valid}`),
      lat,
      lon,
      type: cls,
      magnitude: parseMagnitude(props.magnitude ?? props.mag),
      occurredAt: String(props.valid ?? props.utc_valid ?? new Date().toISOString()),
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
  // wind in knots -> mph * 0.868976
  const m = e.magnitude ?? 0;
  if (m >= 75) return '#B83239';
  if (m >= 60) return '#E5484D';
  if (m >= 50) return '#F26B1F';
  return '#FFB061';
}

export function magnitudeLabel(e: StormEvent): string {
  if (e.magnitude == null) return e.type === 'hail' ? 'Hail' : 'Wind';
  if (e.type === 'hail') return `${e.magnitude.toFixed(2)}"`;
  return `${Math.round(e.magnitude)} kt`;
}

/** Useful preset date ranges. */
export function rangeYearsAgo(years: number): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();
  start.setFullYear(end.getFullYear() - years);
  return { start, end };
}

export const US_STATES: Array<{ code: string; name: string }> = [
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
