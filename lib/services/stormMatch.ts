// Storm validation over NOAA/IEM storm history.
//
// Three jobs live here:
//   1. matchStorm / findMatchingStorm — find the nearest qualifying storm event
//      for an inspection's (lat, lng, date) so `Inspection.event` can cite a
//      NOAA-verified storm in the HAAG report.
//   2. fetchAddressStormHistory — up-to-4-year hail/wind history for an address
//      (map / canvassing / "Time Travel" use).
//   3. tripleCheckDateOfLoss — pure Triple-Check discrepancy verdict between a
//      reported date of loss and already-fetched storm events, for the decision
//      engine and report weather sections.
//
// Drift #5 applies throughout: when the storm-history service is unreachable we
// return a typed `unavailable` result. We never synthesize events.

import { fetchStormHistory, type StormEvent as NoaaStormEvent } from '../noaa';
import type { StormEvent as InspectionStormEvent } from '../models/types';

// -----------------------------------------------------------------------------
// Validation floors
// -----------------------------------------------------------------------------

/**
 * PUBLIC COMMITMENT — do not change without a marketing/legal pass.
 *
 * "Hail >= 0.25 inch" is the published storm-validation floor for the
 * storm-match feature, quoted identically in the Press Release, the Product
 * Statement, and the Launch Communications (docs/PRODUCT_SYNTHESIS.md §1
 * "Storm intelligence"). Every hail event RoofWise treats as validated must
 * meet this floor. Hail reports with no recorded size cannot be shown to meet
 * it, so they never qualify.
 *
 * This is a *validation* floor, not a damage assertion: whether hail of a given
 * size functionally damages a given material is decided by the material-specific
 * HAAG thresholds in docs/HAAG_DECISION_ENGINE.md, never here.
 */
export const HAIL_VALIDATION_FLOOR_INCHES = 0.25;

/**
 * Wind validation floor in knots (58 mph — the NWS severe-thunderstorm wind
 * criterion). The published 0.25" floor covers hail only; wind keeps the NWS
 * severe criterion.
 */
export const WIND_VALIDATION_FLOOR_KNOTS = 50.4;

/** Search radius (miles) for tying a storm report to a specific property. */
export const MATCH_RADIUS_MILES = 5;

/**
 * ± window (days) around the inspection/claim date inside which a storm event
 * counts as "matching the claimed date" — used both for auto-matching and for
 * the Triple-Check `corroborated` verdict. Distinct from the ±72h
 * high-confidence window (HAAG_DECISION_ENGINE.md §6).
 */
export const DOL_MATCH_WINDOW_DAYS = 30;

/**
 * ±72 hours: the HAAG Claim Viability HIGH-band criterion — "verified hail/wind
 * event within ±72 hours of reported date of loss" (HAAG_DECISION_ENGINE.md §6).
 */
export const TRIPLE_CHECK_WINDOW_HOURS = 72;

// -----------------------------------------------------------------------------
// Lookback windows — TWO DIFFERENT THINGS. Do not merge them
// (docs/PRODUCT_SYNTHESIS.md §2 ruling 18):
//
//   - Storm HISTORY browsing (map / canvassing / Time Travel slider) may look
//     back up to 4 years. This is a lead-gen / context feature.
//   - Claim CORROBORATION is capped at 2 years by the HAAG two-year rule
//     (docs/HAAG_DECISION_ENGINE.md §6): damage must corroborate a weather
//     incident no more than two years old, or the correlation is not
//     defensible. That cap belongs to the Claim Viability engine — it is NOT a
//     limit on how far back the user may browse storm history.
// -----------------------------------------------------------------------------

/**
 * Maximum storm-history browsing depth (map/canvassing). The public spec states
 * 3–4 years; 4 is the ceiling (docs/PRODUCT_SYNTHESIS.md §1).
 */
export const HISTORY_LOOKBACK_YEARS_MAX = 4;

/** Default storm-history lookback for address/map queries. */
export const HISTORY_LOOKBACK_YEARS_DEFAULT = 4;

/**
 * HAAG two-year rule (docs/HAAG_DECISION_ENGINE.md §6): the maximum age of a
 * weather incident that can still corroborate a claim. Exported for the Claim
 * Viability logic in the decision engine — NOT a history-browsing limit.
 */
export const CLAIM_CORROBORATION_MAX_YEARS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

// -----------------------------------------------------------------------------
// Qualification predicate (shared with stormWatch.ts)
// -----------------------------------------------------------------------------

/**
 * True when a raw NOAA/IEM event meets the published validation floors.
 * Events with unknown magnitude never qualify — they cannot be shown to meet
 * a floor, and we never guess (Drift #5).
 */
export function qualifiesForValidation(e: NoaaStormEvent): boolean {
  if (e.magnitude == null) return false;
  if (e.type === 'hail') return e.magnitude >= HAIL_VALIDATION_FLOOR_INCHES;
  if (e.type === 'wind') return e.magnitude >= WIND_VALIDATION_FLOOR_KNOTS;
  return false;
}

// -----------------------------------------------------------------------------
// Storm match (auto-fill Inspection.event)
// -----------------------------------------------------------------------------

export type StormMatchResult =
  | { status: 'matched'; event: InspectionStormEvent }
  /** Service reachable; no qualifying event within radius + window. */
  | { status: 'no_match' }
  /** Service unreachable or errored. Never converted into a fake match. */
  | { status: 'unavailable'; reason: string };

export async function matchStorm(args: {
  lat: number;
  lng: number;
  near: Date;
  state: string;
}): Promise<StormMatchResult> {
  const start = new Date(args.near.getTime() - DOL_MATCH_WINDOW_DAYS * DAY_MS);
  const end = new Date(args.near.getTime() + DOL_MATCH_WINDOW_DAYS * DAY_MS);

  let events: NoaaStormEvent[];
  try {
    events = await fetchStormHistory({
      state: args.state,
      start,
      end,
      types: ['hail', 'wind'],
    });
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : 'Storm history service unreachable',
    };
  }

  // Filter to validated magnitudes within radius, nearest first.
  const qualifying = events
    .filter(qualifiesForValidation)
    .map((e) => ({
      event: e,
      distanceMi: haversine(args.lat, args.lng, e.lat, e.lon),
    }))
    .filter((x) => x.distanceMi <= MATCH_RADIUS_MILES)
    .sort((a, b) => a.distanceMi - b.distanceMi);

  const best = qualifying[0];
  if (!best) return { status: 'no_match' };

  const e = best.event;
  return {
    status: 'matched',
    event: {
      date: e.occurredAt,
      kind: e.type,
      hailSizeInches: e.type === 'hail' ? e.magnitude ?? undefined : undefined,
      windSpeedMph: e.type === 'wind' ? Math.round((e.magnitude ?? 0) * 1.15078) : undefined,
      noaaEventId: e.id,
      distanceMiles: best.distanceMi,
      source: 'NOAA',
    },
  };
}

/**
 * Back-compat wrapper over `matchStorm` (existing call sites expect
 * `InspectionStormEvent | null`). `null` collapses both `no_match` and
 * `unavailable`; prefer `matchStorm` where the UI should distinguish
 * "no storm found" from "service not available".
 */
export async function findMatchingStorm(args: {
  lat: number;
  lng: number;
  near: Date;
  state: string;
}): Promise<InspectionStormEvent | null> {
  const result = await matchStorm(args);
  return result.status === 'matched' ? result.event : null;
}

// -----------------------------------------------------------------------------
// Address storm history (map / canvassing — up to 4 years)
// -----------------------------------------------------------------------------

export type StormHistoryResult =
  | {
      status: 'ok';
      /** Validated events within radius, newest first. */
      events: NoaaStormEvent[];
      /** The (clamped) lookback actually queried. */
      lookbackYears: number;
    }
  /** Service unreachable or errored. Never filled with synthesized events. */
  | { status: 'unavailable'; reason: string };

/**
 * Hail/wind history around an address for map browsing and canvassing.
 *
 * `lookbackYears` defaults to `HISTORY_LOOKBACK_YEARS_DEFAULT` (4) and is
 * clamped to `HISTORY_LOOKBACK_YEARS_MAX`. This is the *history-browsing*
 * window — deliberately deeper than the 2-year claim-corroboration maximum
 * (`CLAIM_CORROBORATION_MAX_YEARS`, HAAG_DECISION_ENGINE.md §6), which applies
 * only when tying damage to a storm inside the Claim Viability engine.
 */
export async function fetchAddressStormHistory(args: {
  lat: number;
  lng: number;
  state: string;
  lookbackYears?: number;
  radiusMiles?: number;
  /** End of the window; defaults to now. */
  end?: Date;
}): Promise<StormHistoryResult> {
  const lookbackYears = clampLookbackYears(args.lookbackYears ?? HISTORY_LOOKBACK_YEARS_DEFAULT);
  const radiusMiles = args.radiusMiles ?? MATCH_RADIUS_MILES;
  const end = args.end ?? new Date();
  const start = new Date(end.getTime());
  start.setFullYear(start.getFullYear() - lookbackYears);

  let events: NoaaStormEvent[];
  try {
    events = await fetchStormHistory({
      state: args.state,
      start,
      end,
      types: ['hail', 'wind'],
    });
  } catch (err) {
    return {
      status: 'unavailable',
      reason: err instanceof Error ? err.message : 'Storm history service unreachable',
    };
  }

  const within = events
    .filter(qualifiesForValidation)
    .filter((e) => haversine(args.lat, args.lng, e.lat, e.lon) <= radiusMiles)
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt));

  return { status: 'ok', events: within, lookbackYears };
}

/** Clamp a requested lookback into (0, HISTORY_LOOKBACK_YEARS_MAX]. */
export function clampLookbackYears(years: number): number {
  if (!Number.isFinite(years) || years <= 0) return HISTORY_LOOKBACK_YEARS_DEFAULT;
  return Math.min(years, HISTORY_LOOKBACK_YEARS_MAX);
}

// -----------------------------------------------------------------------------
// Triple-Check discrepancy verdict (pure — no I/O)
// -----------------------------------------------------------------------------

/**
 * Minimal structural event shape so the check works over both
 * `lib/models/types.StormEvent` (which matches it directly) and mapped
 * NOAA events (see `toTripleCheckEvents`).
 */
export type TripleCheckEvent = {
  /** ISO 8601 date/time the storm event occurred. */
  date: string;
  /** Hail size in inches when known. */
  hailSizeInches?: number;
  /** e.g. 'hail' | 'wind' | 'mixed' — used only for wording and hail-floor checks. */
  kind?: string;
};

export type TripleCheckVerdict = {
  /** True when at least one qualifying event falls within ±windowDays of the DOL. */
  corroborated: boolean;
  /** ISO date of the qualifying event nearest to the DOL (absent when none qualify). */
  nearestEventDate?: string;
  /** Signed days from DOL to nearest event (positive = event after the DOL), 1-decimal. */
  daysFromDol?: number;
  /** Nearest qualifying event within ±72h of the DOL (HAAG §6 HIGH-band criterion). */
  withinWindow72h: boolean;
  /** Human-readable summary for the report weather section / review queue. */
  note: string;
};

/** Map raw NOAA/IEM events into Triple-Check inputs. */
export function toTripleCheckEvents(events: readonly NoaaStormEvent[]): TripleCheckEvent[] {
  return events.map((e) => ({
    date: e.occurredAt,
    kind: e.type,
    hailSizeInches: e.type === 'hail' ? e.magnitude ?? undefined : undefined,
  }));
}

/**
 * Triple-Check discrepancy rule (docs/PRODUCT_SYNTHESIS.md §1 "AI analysis"):
 * if the AI finds hail damage but no storm in weather history matches the
 * claimed date of loss, the inspection must be flagged for review.
 *
 * This function is the weather half of that rule: a pure verdict over a
 * reported DOL and *already-fetched* events (fetch stays in `matchStorm` /
 * `fetchAddressStormHistory` / `lib/noaa.ts`). The decision engine combines
 * `!verdict.corroborated` with its own "AI found hail" signal to raise the
 * review flag; reports render `verdict.note` in the weather section.
 *
 * Hail floor: events declared as hail must meet `HAIL_VALIDATION_FLOOR_INCHES`
 * to count as corroboration; hail events with unknown size are excluded (they
 * cannot be shown to meet the published floor). Wind/mixed events with no hail
 * size pass through — wind corroborates a storm date too.
 */
export function tripleCheckDateOfLoss(args: {
  /** Reported date of loss (ISO string or Date). */
  reportedDateOfLoss: string | Date;
  /** Already-fetched storm events near the property. */
  events: readonly TripleCheckEvent[];
  /** ± window (days) for "matches the claimed date". Default DOL_MATCH_WINDOW_DAYS. */
  windowDays?: number;
}): TripleCheckVerdict {
  const windowDays = args.windowDays ?? DOL_MATCH_WINDOW_DAYS;
  const dolMs =
    args.reportedDateOfLoss instanceof Date
      ? args.reportedDateOfLoss.getTime()
      : Date.parse(args.reportedDateOfLoss);

  if (!Number.isFinite(dolMs)) {
    return {
      corroborated: false,
      withinWindow72h: false,
      note: 'Reported date of loss is not a valid date — storm history cannot corroborate it. Flag for review.',
    };
  }

  const eligible = args.events.filter((e) => {
    if (!Number.isFinite(Date.parse(e.date))) return false;
    const isHail = e.kind === 'hail' || (e.kind == null && e.hailSizeInches != null);
    if (isHail) {
      return e.hailSizeInches != null && e.hailSizeInches >= HAIL_VALIDATION_FLOOR_INCHES;
    }
    // Wind / mixed / unspecified events corroborate a storm date as-is; if a
    // hail size is present on a mixed event it must still meet the floor.
    if (e.hailSizeInches != null && e.kind === 'mixed') {
      return e.hailSizeInches >= HAIL_VALIDATION_FLOOR_INCHES;
    }
    return true;
  });

  if (eligible.length === 0) {
    return {
      corroborated: false,
      withinWindow72h: false,
      note:
        args.events.length === 0
          ? 'No storm events on record near this property for the reported date of loss. If the AI found hail damage, flag the inspection for review.'
          : `No storm event meets the published validation floor (hail >= ${HAIL_VALIDATION_FLOOR_INCHES}"). If the AI found hail damage, flag the inspection for review.`,
    };
  }

  let nearest = eligible[0];
  let nearestAbsMs = Math.abs(Date.parse(nearest.date) - dolMs);
  for (const e of eligible) {
    const absMs = Math.abs(Date.parse(e.date) - dolMs);
    if (absMs < nearestAbsMs) {
      nearest = e;
      nearestAbsMs = absMs;
    }
  }

  const signedDays = (Date.parse(nearest.date) - dolMs) / DAY_MS;
  const daysFromDol = Math.round(signedDays * 10) / 10;
  const withinWindow72h = nearestAbsMs <= TRIPLE_CHECK_WINDOW_HOURS * 60 * 60 * 1000;
  const corroborated = nearestAbsMs <= windowDays * DAY_MS;
  const dateLabel = nearest.date.slice(0, 10);
  const absDaysLabel = formatDays(Math.abs(daysFromDol));

  let note: string;
  if (withinWindow72h) {
    note = `Corroborated: storm event on ${dateLabel} is within +/-72h of the reported date of loss (HAAG high-confidence window).`;
  } else if (corroborated) {
    note = `Corroborated: nearest storm event on ${dateLabel} is ${absDaysLabel} from the reported date of loss — inside the +/-${windowDays}-day match window but outside the +/-72h high-confidence window.`;
  } else {
    note = `Discrepancy: nearest storm event on ${dateLabel} is ${absDaysLabel} from the reported date of loss — no storm matches the claimed date within +/-${windowDays} days. Flag for review.`;
  }

  return { corroborated, nearestEventDate: nearest.date, daysFromDol, withinWindow72h, note };
}

function formatDays(days: number): string {
  const rounded = Math.round(days * 10) / 10;
  const label = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return `${label} day${rounded === 1 ? '' : 's'}`;
}

// -----------------------------------------------------------------------------

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
