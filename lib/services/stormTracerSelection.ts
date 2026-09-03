// Storm Tracer's Select mode → a knock route stop or a saved area — PURE
// (no I/O, no React, no react-native-maps; Node-testable). A picked storm
// pin becomes a `KnockRouteTarget` (a point + a canvass radius, the same
// shape `startRoute({ routeStops })` and `PlanView.toTarget` already use) or
// a `SavedArea` (the same point, kept for later). Both read the SAME label
// so a saved area and a route stop never disagree about what to call the
// spot the roofer picked.
//
// The canvass radius is a parameter here, never a constant of this module's
// own: the caller (app/(tabs)/map.tsx) already imports the one canonical
// value — `KNOCK_ROUTE_RADIUS_MILES` in lib/services/stormWatch.ts — and
// this file stays free of that module's own (React-Native-only) transitive
// imports so it can be unit-tested with nothing but Node.

import type { StormEvent } from '@/lib/noaa';
import { magnitudeLabel } from '@/lib/noaa';
import type { KnockRouteTarget } from '@/lib/models/types';
import type { NewSavedArea } from '@/lib/stores/savedAreaStore';

/** "Round Rock, TX" when the report has a place, else "Hail 1.50" · Jun 14". */
export function stormEventLabel(e: StormEvent): string {
  const town = [e.city, e.state].filter(Boolean).join(', ');
  if (town) return town;
  const kind = e.type === 'hail' ? 'Hail' : 'Wind';
  const when = new Date(e.occurredAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${kind} ${magnitudeLabel(e)} · ${when}`;
}

/** A selected storm report as one stop on a knock route. */
export function stormEventToRouteTarget(e: StormEvent, radiusMiles: number): KnockRouteTarget {
  return { lat: e.lat, lng: e.lon, radiusMiles, label: stormEventLabel(e) };
}

/** A selected storm report as a saved area (minus the id/timestamp the
 *  store mints on write). */
export function stormEventToSavedArea(e: StormEvent, radiusMiles: number): NewSavedArea {
  return {
    lat: e.lat,
    lng: e.lon,
    label: stormEventLabel(e),
    radiusMiles,
    source: 'storm_tracer',
    storm: {
      date: e.occurredAt,
      hailInches: e.type === 'hail' ? e.magnitude ?? undefined : undefined,
      windMph: e.type === 'wind' ? e.magnitude ?? undefined : undefined,
      town: [e.city, e.state].filter(Boolean).join(', ') || undefined,
    },
  };
}

/** A saved area, seeding a route stop with its OWN radius (a saved area may
 *  have been saved under a different canvass radius than today's default). */
export function savedAreaToRouteTarget(a: {
  lat: number;
  lng: number;
  radiusMiles: number;
  label: string;
}): KnockRouteTarget {
  return { lat: a.lat, lng: a.lng, radiusMiles: a.radiusMiles, label: a.label };
}
