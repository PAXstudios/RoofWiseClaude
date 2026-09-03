// Foreground Storm Watch: poll NOAA for recent storms in the user's
// service areas, dedup against previously-emitted alerts, and fire a
// local push when something crosses the published validation floor.
//
// Thresholds come from stormMatch.ts so the whole storm-validation layer
// shares one source of truth: hail >= 0.25" (public commitment — see
// HAIL_VALIDATION_FLOOR_INCHES) and wind >= 58 mph (NWS severe criterion).
//
// This file also owns storm-matched lead clustering — the pitch deck's
// "3 leads within 2mi of Apr 18 hail core" (docs/SPEC.md §"Geographic
// clustering", docs/PRODUCT_SYNTHESIS.md §1 "Storm intelligence & leads").
// `matchLeadsToStorm()` is pure: it runs over leads and a storm event that
// were already fetched and performs no I/O of its own.

import { fetchStormHistory, type StormEvent, type StormType } from '../noaa';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useStormAlertStore } from '../stores/stormAlertStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { useLeadStore } from '../stores/leadStore';
import { sendLocalNotification } from './pushNotifications';
import { qualifiesForValidation, MATCH_RADIUS_MILES } from './stormMatch';
import { describeWhere } from './stormWhere';
import type { Lead, StormAlert } from '../models/types';

// Real-time alert scan window. Unrelated to the 4-year storm-history lookback
// (map/canvassing, stormMatch.HISTORY_LOOKBACK_YEARS_MAX) and to the 2-year
// claim-corroboration cap (HAAG_DECISION_ENGINE.md §6) — this only bounds
// "what just happened" polling.
const LOOKBACK_HOURS = 24;

// Notification-copy threshold only — NOT a validation threshold. Hail at or
// above 0.75" reads as "severe" in the alert title; smaller validated hail
// (>= 0.25" floor) still alerts, with softer wording. Damage capability per
// material is decided by docs/HAAG_DECISION_ENGINE.md, never here.
const SEVERE_HAIL_INCHES = 0.75;

/**
 * Radius (miles) around a storm core inside which a lead counts as
 * storm-matched. Same 5 mi as `stormMatch.MATCH_RADIUS_MILES` — a lead and an
 * inspection are the same kind of point on the map, so they share the radius.
 */
export const LEAD_CLUSTER_RADIUS_MILES = MATCH_RADIUS_MILES;

/**
 * Market radius (miles) around a saved Service Area centroid. NOAA/IEM storm
 * history is fetched per *state*, so without this a "Plano, TX" alert could be
 * driven by hail 300 miles away — real data in the wrong place. Applied only
 * when the area has a geocoded centroid; areas still waiting on geocoding keep
 * the state-wide behaviour rather than going silent.
 *
 * UI/scoping radius, not a validation threshold. Deliberately wider than
 * `LEAD_CLUSTER_RADIUS_MILES`: an alert means "a storm hit your market", a
 * cluster means "these specific addresses sit under the core".
 */
// Owner directive 2026-09-03: "When there is a storm within a 50 mile radius
// notify the roofer." Was 25. A roofer drives an hour for a hail street.
export const AREA_ALERT_RADIUS_MILES = 50;

/**
 * "Damaging" floors for the alert title. Hail: the NWS severe criterion, 1 in.
 * Wind: 70 mph — above the 58 mph validation floor, the gust speed at which
 * shingle loss and lifted tabs become common across a neighbourhood rather
 * than on one exposed roof. Below these an alert still fires (validated
 * storm), but reads as a watch, not a damaging event.
 */
export const DAMAGING_HAIL_INCHES = 1.0;
export const DAMAGING_WIND_MPH = 70;

/** How far around a storm core a knock route canvasses by default. */
export const KNOCK_ROUTE_RADIUS_MILES = 3;

/**
 * Map / canvassing browse radius (miles) around the resolved service center.
 * Purely how much of a state-wide storm-history fetch the map draws — it is
 * neither a validation floor nor a HAAG threshold.
 */
export const STORM_HISTORY_BROWSE_RADIUS_MILES = 50;

// -----------------------------------------------------------------------------
// Storm-matched lead clustering (pure)
// -----------------------------------------------------------------------------

/**
 * Minimal structural shape of a storm's core. `lib/noaa.StormEvent` satisfies
 * it directly, so callers can pass a fetched event straight through.
 */
export type StormCore = {
  lat: number;
  lon: number;
  /** ISO 8601 timestamp of the event. */
  occurredAt: string;
  type?: StormType;
  /** Hail size in inches, wind speed in MPH (the unit IEM reports). */
  magnitude?: number | null;
};

export type StormLeadMatch = {
  lead: Lead;
  /** Great-circle miles from the lead's address to the storm core. */
  distanceMiles: number;
  /** Ready-to-persist payload for `Lead.lastStormMatch`. */
  stamp: NonNullable<Lead['lastStormMatch']>;
};

export type StormLeadCluster = {
  /** Alert this cluster was computed for, when it came from a storm alert. */
  alertId?: string;
  eventKind: StormAlert['eventKind'];
  /** ISO 8601 date of the storm core the leads matched. */
  eventDate: string;
  /** Radius the match ran at. */
  radiusMiles: number;
  count: number;
  /** Distance to the closest matched lead, miles. */
  nearestDistanceMiles: number;
  /**
   * Smallest whole-tenth of a mile that still contains every matched lead —
   * the "within X mi" number, always a true statement.
   */
  withinMiles: number;
  leadIds: string[];
  /** e.g. "3 leads within 1.4 mi of the Apr 18 hail core". */
  headline: string;
};

/**
 * Leads within `radiusMiles` of a storm core, nearest first.
 *
 * Pure over already-fetched data — no network, no store reads. Leads without
 * coordinates are skipped rather than guessed at (Drift #5). Each match carries
 * a `stamp` payload for `Lead.lastStormMatch`; pass `options.matchedAt` to tie a
 * whole batch to one moment (Storm Watch uses the alert's `firedAt` so a cluster
 * can be re-derived from persisted leads later).
 */
export function matchLeadsToStorm(
  leads: readonly Lead[],
  stormEvent: StormCore,
  radiusMiles: number = LEAD_CLUSTER_RADIUS_MILES,
  options?: { matchedAt?: string },
): StormLeadMatch[] {
  if (!Number.isFinite(stormEvent?.lat) || !Number.isFinite(stormEvent?.lon)) return [];

  const radius =
    Number.isFinite(radiusMiles) && radiusMiles > 0 ? radiusMiles : LEAD_CLUSTER_RADIUS_MILES;
  const matchedAt = options?.matchedAt ?? new Date().toISOString();
  const hailInches =
    stormEvent.type === 'hail' && typeof stormEvent.magnitude === 'number'
      ? stormEvent.magnitude
      : undefined;

  const matches: StormLeadMatch[] = [];
  for (const lead of leads) {
    const { lat, lng } = lead;
    if (typeof lat !== 'number' || typeof lng !== 'number') continue;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const distanceMiles = haversine(lat, lng, stormEvent.lat, stormEvent.lon);
    if (!(distanceMiles <= radius)) continue;

    matches.push({
      lead,
      distanceMiles,
      stamp: {
        eventDate: stormEvent.occurredAt,
        distanceMiles: round(distanceMiles, 2),
        hailInches,
        matchedAt,
      },
    });
  }

  matches.sort((a, b) => a.distanceMiles - b.distanceMiles);
  return matches;
}

/**
 * Roll matches up into the headline surfaces render. Returns `null` for zero
 * matches so callers omit the line entirely — never a "0 leads" placeholder
 * (Drift #5).
 */
export function summarizeStormLeadCluster(
  matches: readonly StormLeadMatch[],
  meta: { eventKind: StormAlert['eventKind']; radiusMiles?: number; alertId?: string },
): StormLeadCluster | null {
  if (matches.length === 0) return null;

  const nearest = matches[0];
  const farthest = matches[matches.length - 1];
  // Round the outer edge *up* so "within X mi" stays literally true.
  const withinMiles = Math.max(0.1, Math.ceil(farthest.distanceMiles * 10) / 10);

  return {
    alertId: meta.alertId,
    eventKind: meta.eventKind,
    eventDate: nearest.stamp.eventDate,
    radiusMiles: meta.radiusMiles ?? LEAD_CLUSTER_RADIUS_MILES,
    count: matches.length,
    nearestDistanceMiles: round(nearest.distanceMiles, 1),
    withinMiles,
    leadIds: matches.map((m) => m.lead.id),
    headline: clusterHeadline(matches.length, withinMiles, nearest.stamp.eventDate, meta.eventKind),
  };
}

/**
 * Re-derive an alert's lead cluster from persisted leads.
 *
 * Storm Watch stamps every matched lead with `lastStormMatch.matchedAt` set to
 * the alert's `firedAt`, so the association survives a restart without
 * denormalizing anything onto `StormAlert`. Returns `null` when this alert
 * matched no leads (or the app has no leads yet) — the caller omits the line.
 */
export function leadsInStormCluster(
  leads: readonly Lead[],
  alert: Pick<StormAlert, 'id' | 'firedAt' | 'eventKind'>,
): StormLeadCluster | null {
  const matched = leads
    .filter((l) => l.lastStormMatch?.matchedAt === alert.firedAt)
    .map<StormLeadMatch>((lead) => ({
      lead,
      distanceMiles: lead.lastStormMatch!.distanceMiles,
      stamp: lead.lastStormMatch!,
    }))
    .sort((a, b) => a.distanceMiles - b.distanceMiles);

  return summarizeStormLeadCluster(matched, {
    alertId: alert.id,
    eventKind: alert.eventKind,
    radiusMiles: LEAD_CLUSTER_RADIUS_MILES,
  });
}

/**
 * The storm "core" of a set of qualifying events: the strongest hail report,
 * or the strongest wind report when no hail qualified. Ties break toward the
 * most recent. Returns `null` for an empty set — we never invent a core.
 */
export function pickStormCore(events: readonly StormEvent[]): StormEvent | null {
  const ranked = (type: StormType) =>
    events.filter((e) => e.type === type && typeof e.magnitude === 'number');

  const pool = ranked('hail').length > 0 ? ranked('hail') : ranked('wind');
  if (pool.length === 0) return null;

  return pool.reduce((best, e) => {
    const bm = best.magnitude ?? 0;
    const em = e.magnitude ?? 0;
    if (em > bm) return e;
    if (em < bm) return best;
    return Date.parse(e.occurredAt) > Date.parse(best.occurredAt) ? e : best;
  });
}

// -----------------------------------------------------------------------------
// Storm Watch scan
// -----------------------------------------------------------------------------

export type StormWatchResult = {
  scanned: number;
  newAlerts: StormAlert[];
  /**
   * Lead clusters for the alerts just raised, one entry per alert that matched
   * at least one lead. Alerts with no matched leads produce no entry.
   */
  clusters: StormLeadCluster[];
  /**
   * Area labels whose storm-history fetch failed (service unreachable).
   * Surfaced so the UI can say "Not available" — we never synthesize events
   * or silently pretend the scan came back clean (Drift #5).
   */
  unavailableAreas: string[];
};

export async function checkStormWatch(): Promise<StormWatchResult> {
  const areas = useServiceAreaStore.getState().areas;
  if (areas.length === 0) {
    return { scanned: 0, newAlerts: [], clusters: [], unavailableAreas: [] };
  }

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const existingAlerts = useStormAlertStore.getState().alerts;
  const existingKeys = new Set(
    existingAlerts.map((a) => `${a.eventKind}|${a.areaLabel}|${dayOf(a.firedAt)}`),
  );
  const newAlerts: StormAlert[] = [];
  const clusters: StormLeadCluster[] = [];
  const unavailableAreas: string[] = [];
  let scanned = 0;

  for (const area of areas) {
    if (area.kind === 'zip') continue; // ZIP scoping needs a separate API
    const stateCode = inferStateFromLabel(area.label);
    if (!stateCode) continue;
    let events: StormEvent[] = [];
    try {
      events = await fetchStormHistory({ state: stateCode, start, end, types: ['hail', 'wind'] });
    } catch {
      // Typed unavailability — never a fabricated "all clear" or fake events.
      unavailableAreas.push(area.label);
      continue;
    }
    scanned += events.length;
    // Published validation floor: hail >= 0.25", wind >= 58 mph (stormMatch.ts).
    // Then scoped to the area's market when we know where the area actually is.
    const qualifying = scopeToArea(events.filter(qualifiesForValidation), area);
    if (qualifying.length === 0) continue;

    const hailMax = qualifying
      .filter((e) => e.type === 'hail' && typeof e.magnitude === 'number')
      .reduce((m, e) => Math.max(m, e.magnitude ?? 0), 0);
    // Magnitude is already MPH from IEM — the old `* 1.15078` (kt->mph)
    // over-reported every alert's gust speed by 15%.
    const windMax = qualifying
      .filter((e) => e.type === 'wind' && typeof e.magnitude === 'number')
      .reduce((m, e) => Math.max(m, e.magnitude ?? 0), 0);

    const kind: StormAlert['eventKind'] =
      hailMax > 0 && windMax > 0 ? 'mixed' : hailMax > 0 ? 'hail' : 'wind';

    const propertyCount = countPropertiesInArea(area.label);
    const dedupKey = `${kind}|${area.label}|${dayOf(new Date().toISOString())}`;
    if (existingKeys.has(dedupKey)) continue;

    // WHERE: the strongest report is the core. Distance + bearing from the
    // area's centroid give the roofer "14 mi NE" before they open the map.
    const core = pickStormCore(qualifying);
    const where = describeWhere(core, area);
    const severity: StormAlert['severity'] =
      hailMax >= DAMAGING_HAIL_INCHES || windMax >= DAMAGING_WIND_MPH ? 'damaging' : 'watch';

    const alert = useStormAlertStore.getState().inject({
      eventKind: kind,
      areaLabel: area.label,
      propertyCount,
      hailSizeInches: hailMax || undefined,
      windSpeedMph: windMax ? Math.round(windMax) : undefined,
      coreLat: core?.lat,
      coreLng: core?.lon,
      coreCity: core?.city || undefined,
      distanceMiles: where?.distanceMiles,
      bearing: where?.bearing,
      reportCount: qualifying.length,
      severity,
    });
    newAlerts.push(alert);
    useNotificationStore.getState().push({ kind: 'storm_alert', key: `alert_${alert.id}`, title: alertTitle(kind, hailMax, windMax), body: `${magnitudeLine(hailMax, windMax)}${where ? ` near ${where.label}` : ''} · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} in range`, href: `/storm-alert/${alert.id}` });

    // --- Storm-matched lead clustering. Stamping every match with the alert's
    // firedAt is what lets `leadsInStormCluster()` rebuild this cluster from
    // persisted leads on the next app launch.
    const cluster = core
      ? stampLeadCluster(core, {
          alertId: alert.id,
          eventKind: kind,
          matchedAt: alert.firedAt,
        })
      : null;
    if (cluster) clusters.push(cluster);

    sendLocalNotification({
      title: alertTitle(kind, hailMax, windMax),
      // Where first, then what it means for the book: "2.00\" hail near
      // Frisco, 14 mi NE of Plano, TX · 3 properties in range · 2 leads in
      // the core". Guidance the roofer can act on from the lock screen.
      body:
        `${magnitudeLine(hailMax, windMax)}${where ? ` near ${where.label}` : ''}` +
        ` · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} in range` +
        (cluster ? ` · ${cluster.headline}` : '') +
        ' · Tap to add the area to your knock route.',
      data: { kind: 'storm_alert', alertId: alert.id },
    }).catch(() => {});
  }

  return { scanned, newAlerts, clusters, unavailableAreas };
}

/**
 * Match the lead book against a storm core, persist each match onto its lead,
 * and return the cluster summary (`null` when nothing matched).
 */
function stampLeadCluster(
  core: StormCore,
  meta: { alertId: string; eventKind: StormAlert['eventKind']; matchedAt: string },
): StormLeadCluster | null {
  const { leads, setStormMatch } = useLeadStore.getState();
  const matches = matchLeadsToStorm(leads, core, LEAD_CLUSTER_RADIUS_MILES, {
    matchedAt: meta.matchedAt,
  });
  for (const m of matches) setStormMatch(m.lead.id, m.stamp);

  return summarizeStormLeadCluster(matches, {
    alertId: meta.alertId,
    eventKind: meta.eventKind,
    radiusMiles: LEAD_CLUSTER_RADIUS_MILES,
  });
}

/**
 * Crop a state-wide fetch to the area's market when the area has a geocoded
 * centroid. Without a centroid we cannot place the area, so the events pass
 * through unchanged rather than being dropped.
 */
function scopeToArea(events: StormEvent[], area: { centroidLat?: number; centroidLng?: number }) {
  const { centroidLat: lat, centroidLng: lng } = area;
  if (typeof lat !== 'number' || typeof lng !== 'number') return events;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return events;
  return events.filter((e) => haversine(lat, lng, e.lat, e.lon) <= AREA_ALERT_RADIUS_MILES);
}

function magnitudeLine(hailMax: number, windMax: number): string {
  const parts: string[] = [];
  if (hailMax > 0) parts.push(`${hailMax.toFixed(2)}" hail`);
  if (windMax > 0) parts.push(`${Math.round(windMax)} mph wind`);
  return parts.join(' + ') || 'Storm reported';
}

function alertTitle(kind: StormAlert['eventKind'], hailMax: number, windMax = 0): string {
  // Any qualifying wind is severe by definition (the floor IS the NWS severe
  // criterion), so wind/mixed titles stay "Severe". Hail earns "Severe" only
  // at SEVERE_HAIL_INCHES and above; validated smaller hail gets a plain alert.
  if (kind === 'wind') return 'Severe Wind Warning';
  if (kind === 'mixed') return 'Severe Storm Warning';
  return hailMax >= SEVERE_HAIL_INCHES ? 'Severe Hail Warning' : 'Hail Alert';
}

function dayOf(iso: string): string {
  return iso.slice(0, 10);
}

function inferStateFromLabel(label: string): string | null {
  const m = label.match(/,\s*([A-Z]{2})\s*$/);
  return m ? m[1] : null;
}

function countPropertiesInArea(label: string): number {
  const state = inferStateFromLabel(label);
  const city = label.replace(/,\s*[A-Z]{2}\s*$/, '').trim().toLowerCase();
  return useInspectionStore
    .getState()
    .inspections.filter((ins) => {
      const addr = ins.address.toLowerCase();
      if (state && !addr.includes(state.toLowerCase())) return false;
      if (city && !addr.includes(city)) return false;
      return true;
    }).length;
}

// -----------------------------------------------------------------------------

const MONTHS_SHORT = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];

/** "Apr 18" — formatted by hand; Intl is not guaranteed on every RN runtime. */
function monthDayLabel(iso: string): string | null {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}`;
}

function clusterHeadline(
  count: number,
  withinMiles: number,
  eventDate: string,
  kind: StormAlert['eventKind'],
): string {
  const word = kind === 'hail' ? 'hail' : kind === 'wind' ? 'wind' : 'storm';
  const day = monthDayLabel(eventDate);
  const core = day ? `the ${day} ${word} core` : `the ${word} core`;
  return `${count} lead${count === 1 ? '' : 's'} within ${formatMiles(withinMiles)} mi of ${core}`;
}

function formatMiles(mi: number): string {
  return Number.isInteger(mi) ? String(mi) : mi.toFixed(1);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
