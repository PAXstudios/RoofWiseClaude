// Storm days — the date scrubber's model. Pure.
//
// Owner: "show me only the storms from June 14" — isolate one event's
// footprint instead of three years stacked. Reports are grouped by LOCAL
// calendar day (a storm that crosses midnight UTC is still one evening to a
// roofer), each day carries its counts and strongest magnitudes, and the map
// filters to the chosen day.

import type { StormEvent } from '../noaa';

export type StormDay = {
  /** YYYY-MM-DD in the device's local time. */
  day: string;
  /** Local midnight, ms. */
  startMs: number;
  count: number;
  hailCount: number;
  windCount: number;
  maxHailInches: number | null;
  maxWindMph: number | null;
  /** Rough centre of that day's reports (mean), for "jump to the event". */
  centerLat: number;
  centerLon: number;
};

export function localDayKey(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  const y = t.getFullYear();
  const m = String(t.getMonth() + 1).padStart(2, '0');
  const d = String(t.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** Group events into local days, newest first. */
export function stormDays(events: readonly StormEvent[]): StormDay[] {
  const by = new Map<string, StormDay & { latSum: number; lonSum: number }>();
  for (const e of events) {
    const key = localDayKey(e.occurredAt);
    if (!key) continue;
    const cur =
      by.get(key) ??
      {
        day: key,
        startMs: new Date(`${key}T00:00:00`).getTime(),
        count: 0,
        hailCount: 0,
        windCount: 0,
        maxHailInches: null,
        maxWindMph: null,
        centerLat: 0,
        centerLon: 0,
        latSum: 0,
        lonSum: 0,
      };
    cur.count += 1;
    cur.latSum += e.lat;
    cur.lonSum += e.lon;
    if (e.type === 'hail') {
      cur.hailCount += 1;
      if (typeof e.magnitude === 'number') cur.maxHailInches = Math.max(cur.maxHailInches ?? 0, e.magnitude);
    } else {
      cur.windCount += 1;
      if (typeof e.magnitude === 'number') cur.maxWindMph = Math.max(cur.maxWindMph ?? 0, e.magnitude);
    }
    by.set(key, cur);
  }
  return [...by.values()]
    .map(({ latSum, lonSum, ...d }) => ({ ...d, centerLat: latSum / d.count, centerLon: lonSum / d.count }))
    .sort((a, b) => b.startMs - a.startMs);
}

/** Only the events from one local day. */
export function eventsOnDay(events: readonly StormEvent[], day: string): StormEvent[] {
  return events.filter((e) => localDayKey(e.occurredAt) === day);
}

/** "Jun 14 · 41 reports · 2.50" hail" — the chip label. */
export function stormDayLabel(d: StormDay): string {
  const date = new Date(d.startMs);
  const md = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  const parts: string[] = [`${d.count} report${d.count === 1 ? '' : 's'}`];
  if (d.maxHailInches != null) parts.push(`${d.maxHailInches.toFixed(2)}" hail`);
  if (d.maxWindMph != null) parts.push(`${Math.round(d.maxWindMph)} mph`);
  return `${md} · ${parts.join(' · ')}`;
}
