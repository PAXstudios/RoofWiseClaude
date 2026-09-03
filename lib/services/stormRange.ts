// Storm Tracer's time-range and magnitude controls — pure helpers shared by
// the map and anything that deep-links into it. Lifted out of the retired
// standalone Hail Tracer screen when the two maps became one.

import type { StormEvent } from '../noaa';

export type Range = '7d' | '30d' | '6m' | '24m' | '36m' | '48m';

export const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
  '6m': 'Past 6 months',
  '24m': 'Past 24 months',
  '36m': 'Past 36 months',
  '48m': 'Past 4 years',
};

export const RANGE_ORDER: Range[] = ['7d', '30d', '6m', '24m', '36m', '48m'];

/** Default range: 36 months for hail and wind (owner's ask); 4 yr is the cap. */
export const DEFAULT_RANGE: Range = '36m';

/**
 * Whole-year lookback that contains each range. The history service expresses
 * its window in years and clamps at 4, so sub-year ranges fetch the smallest
 * whole year that covers them and get cropped client-side — flipping between
 * the short ranges then costs no further requests.
 */
export const RANGE_LOOKBACK_YEARS: Record<Range, number> = {
  '7d': 1,
  '30d': 1,
  '6m': 1,
  '24m': 2,
  '36m': 3,
  '48m': 4,
};

/** Start of the selected range — the client-side crop over the fetched window. */
export function rangeStart(r: Range, end: Date = new Date()): Date {
  const start = new Date(end.getTime());
  if (r === '7d') start.setDate(end.getDate() - 7);
  else if (r === '30d') start.setDate(end.getDate() - 30);
  else if (r === '6m') start.setMonth(end.getMonth() - 6);
  else if (r === '24m') start.setMonth(end.getMonth() - 24);
  else if (r === '36m') start.setMonth(end.getMonth() - 36);
  else start.setFullYear(end.getFullYear() - 4);
  return start;
}

export type Peril = 'hail' | 'wind' | 'both';

export type Magnitude = 'all' | 'hail_1' | 'hail_15' | 'wind_58';

export const MAGNITUDE_OPTIONS: { id: Magnitude; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'hail_1', label: '≥1" hail' },
  { id: 'hail_15', label: '≥1.5" hail' },
  { id: 'wind_58', label: '≥58 mph wind' },
];

export function filterByMagnitude(events: readonly StormEvent[], m: Magnitude): StormEvent[] {
  if (m === 'all') return [...events];
  if (m === 'hail_1') return events.filter((e) => e.type === 'hail' && (e.magnitude ?? 0) >= 1);
  if (m === 'hail_15') return events.filter((e) => e.type === 'hail' && (e.magnitude ?? 0) >= 1.5);
  // Magnitude is MPH straight from IEM; a knots conversion here once let 51 mph pass as 58.
  return events.filter((e) => e.type === 'wind' && (e.magnitude ?? 0) >= 58);
}

/** Range crop + peril + magnitude, in one place so every surface agrees. */
export function applyStormControls(
  events: readonly StormEvent[],
  controls: { range: Range; peril: Peril; magnitude: Magnitude },
  now: Date = new Date(),
): StormEvent[] {
  const startMs = rangeStart(controls.range, now).getTime();
  const inRange = events.filter((e) => {
    const at = Date.parse(e.occurredAt);
    return Number.isFinite(at) && at >= startMs;
  });
  const byPeril = controls.peril === 'both' ? inRange : inRange.filter((e) => e.type === controls.peril);
  return filterByMagnitude(byPeril, controls.magnitude);
}
