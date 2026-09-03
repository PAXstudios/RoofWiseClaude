// Which US state should storm queries target?
//
// The Map and Hail Tracer both used to hardcode 'TX'. That silently shows a
// contractor in Oklahoma the wrong state's storm history — the failure is
// invisible (real data, wrong place) which makes it worse than an error.
//
// Resolution order, first hit wins:
//   1. An explicit two-letter state in a saved Service Area label
//      ("Plano, TX", "75024 · TX", "Oklahoma City, OK")
//   2. The state of the most recent inspection's address
//   3. 'TX' — the launch market, and the only honest default when the user
//      has told us nothing.

import { STATE_CENTERS } from '../noaa';
import { useServiceAreaStore } from '../stores/serviceAreaStore';
import { useInspectionStore } from '../stores/inspectionStore';

export const DEFAULT_STATE = 'TX';

const KNOWN = new Set(Object.keys(STATE_CENTERS));

/** Pull a supported 2-letter state code out of free-text, if present. */
export function stateFromText(text: string | undefined | null): string | null {
  if (!text) return null;
  // Match standalone uppercase pairs so "Saint" or "Ok" don't false-positive.
  const matches = text.toUpperCase().match(/\b[A-Z]{2}\b/g);
  if (!matches) return null;
  for (const m of matches) if (KNOWN.has(m)) return m;
  return null;
}

/**
 * Best-known service state. Reads stores imperatively so it can be called
 * from effects and services alike; components that need reactivity should
 * select from the stores directly.
 */
export function resolveServiceState(): string {
  for (const area of useServiceAreaStore.getState().areas) {
    const s = stateFromText(area.label);
    if (s) return s;
  }

  const inspections = useInspectionStore.getState().inspections;
  const recent = [...inspections].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
  );
  for (const ins of recent) {
    const s = stateFromText(ins.address);
    if (s) return s;
  }

  return DEFAULT_STATE;
}

/** Map center for the resolved state, falling back to the default. */
export function resolveServiceCenter() {
  const state = resolveServiceState();
  return { state, ...(STATE_CENTERS[state] ?? STATE_CENTERS[DEFAULT_STATE]) };
}
