// "Where should I knock?" — the orchestrator. Network I/O; the maths lives
// in knockOpportunities.ts (pure) and the words in opportunityBrief.ts.
//
// One button: pull 24 months of NWS reports within 100 mi of base, score
// every 3-mile cell a report landed in, enrich the top ten with Census
// housing and a street name, plan the days, ask Gemini to phrase the
// rationale. Every stage degrades honestly — no Census key means the
// national prior with a reason on the card; no Gemini means the rule-based
// rationale labelled as such; no storms means "no storms", never a list.

import { fetchStormHistory } from '../noaa';
import { isGeminiConfigured, isGoogleMapsConfigured, isCensusConfigured } from '../env';
import { reverseGeocode } from './geocoding';
import { housingProfileForPoint } from './censusHousing';
import { writeOpportunityBrief, type OpportunityBrief } from './opportunityBrief';
import {
  LOOKBACK_MONTHS,
  MAX_AREAS,
  SEARCH_RADIUS_MILES,
  applyHousing,
  planTrip,
  rankAreas,
  type BasePoint,
  type HousingProfile,
  type OwnActivity,
  type ScoredArea,
  type TripPlan,
} from './knockOpportunities';

export type FinderStep = 'storms' | 'scoring' | 'housing' | 'naming' | 'brief';

export const FINDER_STEPS: { id: FinderStep; label: string }[] = [
  { id: 'storms', label: `Pulling ${LOOKBACK_MONTHS} months of NWS storm reports within ${SEARCH_RADIUS_MILES} mi` },
  { id: 'scoring', label: 'Scoring every area a report landed in' },
  { id: 'housing', label: 'Looking up roof age and housing stock (Census)' },
  { id: 'naming', label: 'Naming the streets' },
  { id: 'brief', label: 'Writing the brief' },
];

export type HousingStatus = 'acs' | 'partial' | 'no_key' | 'unavailable';
export type BriefStatus = 'ai' | 'rules' | 'no_key' | 'unavailable';

export type KnockFinderResult = {
  generatedAt: string;
  base: BasePoint;
  radiusMiles: number;
  lookbackMonths: number;
  eventCount: number;
  hailCount: number;
  windCount: number;
  /** Cells with at least one landed report — the population that was ranked. */
  cellCount: number;
  areas: ScoredArea[];
  plan: TripPlan;
  brief: OpportunityBrief | null;
  briefStatus: BriefStatus;
  housingStatus: HousingStatus;
  notes: string[];
};

export type FinderOutcome =
  | { status: 'ok'; result: KnockFinderResult }
  | { status: 'no_storms'; eventCount: number }
  | { status: 'unavailable'; reason: string };

export type HousingCache = {
  get: (key: string) => HousingProfile | undefined;
  set: (key: string, profile: HousingProfile) => void;
};

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next;
      next += 1;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function findKnockOpportunities(args: {
  base: BasePoint;
  own?: OwnActivity;
  housingCache?: HousingCache;
  onStep?: (step: FinderStep) => void;
  /**
   * Called as soon as the areas are ranked (a few seconds in) and again after
   * each enrichment lands, with a complete result each time — so the screen
   * shows the plan while Census, street names and the brief are still on
   * their way. The final resolved value is the same object shape.
   */
  onPartial?: (partial: KnockFinderResult) => void;
  now?: Date;
}): Promise<FinderOutcome> {
  const now = args.now ?? new Date();
  const notes: string[] = [];

  // 1. Storms — per-point service, server-side radius crop (lib/noaa.ts).
  args.onStep?.('storms');
  const start = new Date(now);
  start.setMonth(start.getMonth() - LOOKBACK_MONTHS);
  let events;
  try {
    events = await fetchStormHistory({
      state: '',
      start,
      end: now,
      types: ['hail', 'wind'],
      near: { lat: args.base.lat, lon: args.base.lng, radiusMiles: SEARCH_RADIUS_MILES },
    });
  } catch (err) {
    return { status: 'unavailable', reason: err instanceof Error ? err.message : 'Storm history service unreachable' };
  }
  const hailCount = events.filter((e) => e.type === 'hail').length;
  const windCount = events.length - hailCount;

  // 2. Score.
  args.onStep?.('scoring');
  const ranked = rankAreas({ base: args.base, now, events, own: args.own, limit: MAX_AREAS });
  const cellCount = rankAreas({ base: args.base, now, events, own: args.own, limit: 10_000 }).length;
  if (ranked.length === 0) return { status: 'no_storms', eventCount: events.length };

  const partialOf = (areasNow: ScoredArea[], extra: Partial<KnockFinderResult> = {}): KnockFinderResult => ({
    generatedAt: now.toISOString(),
    base: args.base,
    radiusMiles: SEARCH_RADIUS_MILES,
    lookbackMonths: LOOKBACK_MONTHS,
    eventCount: events.length,
    hailCount,
    windCount,
    cellCount,
    areas: areasNow,
    plan: planTrip(areasNow, args.base),
    brief: null,
    briefStatus: 'rules',
    housingStatus: 'no_key',
    notes: ['Still enriching — roof age, street names and the brief are on their way.'],
    ...extra,
  });
  args.onPartial?.(partialOf(ranked.map((a) => ({ ...a, name: a.storm.town }))));

  // 3. Housing — cache first; the Census does not change week to week.
  args.onStep?.('housing');
  const housing = new Map<string, HousingProfile>();
  let acsHits = 0;
  // Only the areas a roofer will actually read get a Census round-trip (two
  // calls each, and the geocoder is slow); the rest keep the prior.
  const ENRICH = Math.min(ranked.length, 6);
  await mapLimit(ranked.slice(0, ENRICH), 5, async (a) => {
    const cached = args.housingCache?.get(a.key);
    const profile = cached ?? (await housingProfileForPoint(a.lat, a.lng));
    if (!cached && profile.source === 'acs') args.housingCache?.set(a.key, profile);
    housing.set(a.key, profile);
    if (profile.source === 'acs') acsHits += 1;
  });
  let areas = applyHousing(ranked, housing, now);
  const housingStatus: HousingStatus =
    acsHits === ENRICH ? 'acs' : acsHits > 0 ? 'partial' : isCensusConfigured ? 'unavailable' : 'no_key';
  if (housingStatus === 'no_key') notes.push('Roof age and ownership were not available (no Census key) — national averages assumed.');
  if (housingStatus === 'unavailable') notes.push('The Census service did not answer — national housing averages assumed.');
  if (housingStatus === 'partial') notes.push(`Census housing data covered ${acsHits} of ${ENRICH} areas; the rest use national averages.`);
  args.onPartial?.(partialOf(areas.map((a) => ({ ...a, name: a.name ?? a.storm.town })), { housingStatus, notes: [...notes, 'Naming the streets and writing the brief…'] }));

  // 4. Names — Google reverse geocode when configured, else the reports' town.
  args.onStep?.('naming');
  if (isGoogleMapsConfigured) {
    areas = await mapLimit(areas, 5, async (a) => {
      try {
        const g = await reverseGeocode({ lat: a.lat, lng: a.lng });
        if (!g) return { ...a, name: a.storm.town };
        const city = g.city ?? a.storm.town;
        const name = city ? `${city}${g.stateCode ? `, ${g.stateCode}` : ''}` : g.formattedAddress;
        const street = g.formattedAddress.split(',')[0]?.trim();
        const landmark = street && street !== city ? `near ${street}` : undefined;
        return { ...a, name, landmark, zip: g.postalCode };
      } catch {
        return { ...a, name: a.storm.town };
      }
    });
  } else {
    areas = areas.map((a) => ({ ...a, name: a.storm.town }));
    notes.push('Street names need the Google key — areas are labelled by the reporting town.');
  }

  // 5. Plan.
  const plan = planTrip(areas, args.base);

  args.onPartial?.(partialOf(areas, { plan, housingStatus, notes: [...notes, 'Writing the brief…'] }));

  // 6. Brief.
  args.onStep?.('brief');
  let brief: OpportunityBrief | null = null;
  let briefStatus: BriefStatus = 'rules';
  if (!isGeminiConfigured) {
    briefStatus = 'no_key';
  } else {
    brief = await writeOpportunityBrief({ base: args.base, areas, plan, timeoutMs: 20_000 });
    briefStatus = brief ? 'ai' : 'unavailable';
  }

  return {
    status: 'ok',
    result: {
      generatedAt: now.toISOString(),
      base: args.base,
      radiusMiles: SEARCH_RADIUS_MILES,
      lookbackMonths: LOOKBACK_MONTHS,
      eventCount: events.length,
      hailCount,
      windCount,
      cellCount,
      areas,
      plan,
      brief,
      briefStatus,
      housingStatus,
      notes,
    },
  };
}

/** Google Maps driving directions through every stop of a day, in order. */
export function directionsUrl(base: BasePoint, stops: { lat: number; lng: number }[]): string {
  if (stops.length === 0) return '';
  const last = stops[stops.length - 1];
  const way = stops
    .slice(0, -1)
    .map((s) => `${s.lat.toFixed(5)},${s.lng.toFixed(5)}`)
    .join('|');
  return (
    `https://www.google.com/maps/dir/?api=1&origin=${base.lat.toFixed(5)},${base.lng.toFixed(5)}` +
    `&destination=${last.lat.toFixed(5)},${last.lng.toFixed(5)}` +
    (way ? `&waypoints=${encodeURIComponent(way)}` : '') +
    '&travelmode=driving'
  );
}
