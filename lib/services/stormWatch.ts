// Foreground Storm Watch: poll NOAA for recent storms in the user's
// service areas, dedup against previously-emitted alerts, and fire a
// local push when something crosses the HAAG threshold.

import { fetchStormHistory, type StormEvent } from '../noaa';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useStormAlertStore } from '../stores/stormAlertStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { sendLocalNotification } from './pushNotifications';
import type { StormAlert } from '../models/types';

const HAIL_THRESHOLD_INCHES = 0.75;
const WIND_THRESHOLD_KNOTS = 50.4; // 58 mph
const LOOKBACK_HOURS = 24;

export type StormWatchResult = {
  scanned: number;
  newAlerts: StormAlert[];
};

export async function checkStormWatch(): Promise<StormWatchResult> {
  const areas = useServiceAreaStore.getState().areas;
  if (areas.length === 0) {
    return { scanned: 0, newAlerts: [] };
  }

  const end = new Date();
  const start = new Date(end.getTime() - LOOKBACK_HOURS * 60 * 60 * 1000);

  const existingAlerts = useStormAlertStore.getState().alerts;
  const existingKeys = new Set(
    existingAlerts.map((a) => `${a.eventKind}|${a.areaLabel}|${dayOf(a.firedAt)}`),
  );
  const newAlerts: StormAlert[] = [];
  let scanned = 0;

  for (const area of areas) {
    if (area.kind === 'zip') continue; // ZIP scoping needs a separate API
    const stateCode = inferStateFromLabel(area.label);
    if (!stateCode) continue;
    let events: StormEvent[] = [];
    try {
      events = await fetchStormHistory({ state: stateCode, start, end, types: ['hail', 'wind'] });
    } catch {
      continue;
    }
    scanned += events.length;
    const qualifying = events.filter(qualifies);
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
      title: kind === 'hail' ? 'Severe Hail Warning' : kind === 'wind' ? 'Severe Wind Warning' : 'Severe Storm Warning',
      body: `${area.label} · ${propertyCount} propert${propertyCount === 1 ? 'y' : 'ies'} in range`,
      data: { kind: 'storm_alert', alertId: alert.id },
    }).catch(() => {});
  }

  return { scanned, newAlerts };
}

function qualifies(e: StormEvent): boolean {
  if (e.magnitude == null) return false;
  if (e.type === 'hail') return e.magnitude >= HAIL_THRESHOLD_INCHES;
  if (e.type === 'wind') return e.magnitude >= WIND_THRESHOLD_KNOTS;
  return false;
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
