// Foreground Storm Watch: poll NOAA for recent storms in the user's
// service areas, dedup against previously-emitted alerts, and fire a
// local push when something crosses the published validation floor.
//
// Thresholds come from stormMatch.ts so the whole storm-validation layer
// shares one source of truth: hail >= 0.25" (public commitment — see
// HAIL_VALIDATION_FLOOR_INCHES) and wind >= 50.4 kt (NWS severe criterion).

import { fetchStormHistory, type StormEvent } from '../noaa';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useStormAlertStore } from '../stores/stormAlertStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { sendLocalNotification } from './pushNotifications';
import { qualifiesForValidation } from './stormMatch';
import type { StormAlert } from '../models/types';

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

export type StormWatchResult = {
  scanned: number;
  newAlerts: StormAlert[];
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
    return { scanned: 0, newAlerts: [], unavailableAreas: [] };
  }

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const existingAlerts = useStormAlertStore.getState().alerts;
  const existingKeys = new Set(
    existingAlerts.map((a) => `${a.eventKind}|${a.areaLabel}|${dayOf(a.firedAt)}`),
  );
  const newAlerts: StormAlert[] = [];
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
    // Published validation floor: hail >= 0.25", wind >= 50.4 kt (stormMatch.ts).
    const qualifying = events.filter(qualifiesForValidation);
    if (qualifying.length === 0) continue;

    const hailMax = qualifying
      .filter((e) => e.type === 'hail' && typeof e.magnitude === 'number')
      .reduce((m, e) => Math.max(m, e.magnitude ?? 0), 0);
    const windMax = qualifying
      .filter((e) => e.type === 'wind' && typeof e.magnitude === 'number')
      .reduce((m, e) => Math.max(m, (e.magnitude ?? 0) * 1.15078), 0);

    const kind: StormAlert['eventKind'] =
      hailMax > 0 && windMax > 0 ? 'mixed' : hailMax > 0 ? 'hail' : 'wind';

    const propertyCount = countPropertiesInArea(area.label);
    const dedupKey = `${kind}|${area.label}|${dayOf(new Date().toISOString())}`;
    if (existingKeys.has(dedupKey)) continue;

    const alert = useStormAlertStore.getState().inject({
      eventKind: kind,
      areaLabel: area.label,
      propertyCount,
      hailSizeInches: hailMax || undefined,
      windSpeedMph: windMax ? Math.round(windMax) : undefined,
    });
    newAlerts.push(alert);

    sendLocalNotification({
      title: alertTitle(kind, hailMax),
      body: `${area.label} · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} in range`,
      data: { kind: 'storm_alert', alertId: alert.id },
    }).catch(() => {});
  }

  return { scanned, newAlerts, unavailableAreas };
}

function alertTitle(kind: StormAlert['eventKind'], hailMax: number): string {
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
