// NWS active alerts for a point — api.weather.gov (free, no key).
// Docs: https://www.weather.gov/documentation/services-web-api
//
// One call: `GET /alerts/active?point=lat,lon` returns every alert whose
// polygon or zone covers the point (a Flash Flood Warning, a Wind Advisory
// and a Flood Watch came back together for one Houston point when this was
// verified live 2026-09-02). NWS asks for a contact-bearing User-Agent; the
// app already carries one for NOAA/IEM in `env.NOAA_USER_AGENT`.
//
// Drift #5: a failed request is `unavailable`, never an empty list. Only an
// HTTP 200 with a features array may say "no active alerts".

import { env } from '../env';

const ENDPOINT = 'https://api.weather.gov/alerts/active';

/** Bound the round-trip so an unresponsive NWS never pins the page. */
const REQUEST_TIMEOUT_MS = 10_000;

export type NwsSeverity = 'Extreme' | 'Severe' | 'Moderate' | 'Minor' | 'Unknown';

export type NwsAlert = {
  id: string;
  /** e.g. "Severe Thunderstorm Warning", "Wind Advisory". */
  event: string;
  headline: string;
  severity: NwsSeverity;
  urgency?: string;
  certainty?: string;
  /** Counties / zones covered, as NWS words them ("Polk, TX; Trinity, TX"). */
  areaDesc: string;
  /** ISO 8601 with offset, when NWS reported them. */
  onset?: string;
  ends?: string;
  expires?: string;
  description?: string;
  instruction?: string;
  senderName?: string;
};

export type NwsAlertsResult =
  | { status: 'ok'; alerts: NwsAlert[]; updated?: string }
  | { status: 'unavailable'; reason: string };

const SEVERITY_RANK: Record<NwsSeverity, number> = {
  Extreme: 0,
  Severe: 1,
  Moderate: 2,
  Minor: 3,
  Unknown: 4,
};

export async function fetchActiveAlerts(coord: {
  lat: number;
  lng: number;
}): Promise<NwsAlertsResult> {
  if (!Number.isFinite(coord.lat) || !Number.isFinite(coord.lng)) {
    return { status: 'unavailable', reason: 'No location to look up alerts for' };
  }
  // NWS rejects more than four decimals ("Does not match the regex pattern"
  // on anything sloppier) and a point is not a survey mark, so 4 is plenty.
  const point = `${coord.lat.toFixed(4)},${coord.lng.toFixed(4)}`;
  const url = `${ENDPOINT}?point=${encodeURIComponent(point)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': env.NOAA_USER_AGENT,
        Accept: 'application/geo+json',
      },
    });
    if (!res.ok) {
      return { status: 'unavailable', reason: `NWS ${res.status}` };
    }
    const data = (await res.json()) as { features?: unknown; updated?: unknown } | null;
    if (!Array.isArray(data?.features)) {
      return { status: 'unavailable', reason: 'NWS returned an unexpected response' };
    }
    const alerts = data.features
      .map(parseAlert)
      .filter((a): a is NwsAlert => a !== null)
      .sort(
        (a, b) =>
          SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
          (Date.parse(a.onset ?? '') || 0) - (Date.parse(b.onset ?? '') || 0),
      );
    return {
      status: 'ok',
      alerts,
      updated: typeof data.updated === 'string' ? data.updated : undefined,
    };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === 'AbortError'
        ? 'NWS did not respond in time'
        : err instanceof Error && err.message
        ? err.message
        : 'NWS request failed';
    return { status: 'unavailable', reason };
  } finally {
    clearTimeout(timer);
  }
}

function parseAlert(feature: unknown): NwsAlert | null {
  const p = (feature as { properties?: Record<string, unknown> } | null)?.properties;
  if (!p || typeof p !== 'object') return null;
  // Exercises and tests are real records but not real weather.
  const status = str(p.status);
  if (status && status !== 'Actual') return null;
  const event = str(p.event);
  if (!event) return null;
  const id = str(p.id) ?? `${event}-${str(p.onset) ?? ''}-${str(p.areaDesc) ?? ''}`;
  return {
    id,
    event,
    headline: str(p.headline) ?? event,
    severity: severity(p.severity),
    urgency: str(p.urgency),
    certainty: str(p.certainty),
    areaDesc: str(p.areaDesc) ?? '',
    onset: str(p.onset) ?? str(p.effective),
    ends: str(p.ends),
    expires: str(p.expires),
    description: str(p.description),
    instruction: str(p.instruction),
    senderName: str(p.senderName),
  };
}

function severity(v: unknown): NwsSeverity {
  switch (v) {
    case 'Extreme':
    case 'Severe':
    case 'Moderate':
    case 'Minor':
      return v;
    default:
      return 'Unknown';
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v : undefined;
}
