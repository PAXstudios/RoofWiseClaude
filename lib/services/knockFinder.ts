// "Where should I knock?" — the orchestrator. Network I/O; the maths lives
// in knockOpportunities.ts (pure) and the words in opportunityBrief.ts.
//
// One button: pull 24 months of NWS reports within the radius the roofer
// chose, score every 3-mile cell a report landed in (or, in neighbours mode,
// every cell one of the roofer's jobs sits in), enrich the top ten with
// Census housing and a street name, plan the days, ask Gemini to phrase the
// rationale. Every stage degrades honestly — no Census key means the
// national prior with a reason on the card; no Gemini means the rule-based
// rationale labelled as such; no storms means "no storms", never a list.
//
// The JS thread is shared with every tap on the screen. Scoring is one pass
// over the cells (cheap score for all, binomial statements for the top ten)
// and the run yields to the event loop between phases, so Back keeps
// working and the partial results paint while Census and the brief are
// still on their way.

import { fetchStormHistory, type StormEvent } from '../noaa';
import { isGeminiConfigured, isGoogleMapsConfigured, isCensusConfigured } from '../env';
import type { Inspection, Lead, Proposal, PropertyRecord } from '../models/types';
import { LEAD_STAGE_ORDER, leadStageColumn } from '../models/types';
import { reverseGeocode } from './geocoding';
import { housingProfileForPoint } from './censusHousing';
import { writeOpportunityBrief, type OpportunityBrief } from './opportunityBrief';
import { calibrationSummary, type CalibratedRates } from './knockCalibration';
import { roofYearFromRecord } from './propertyRecord';
import { calibrationForRun } from '../stores/knockCalibrationStore';
import { usePropertyRecordStore } from '../stores/propertyRecordStore';
import {
  DEFAULT_SEARCH_RADIUS_MILES,
  LOOKBACK_MONTHS,
  MAX_AREAS,
  applyHousing,
  clampRadiusMiles,
  planTrip,
  rankAreasDetailed,
  type BasePoint,
  type FinderMode,
  type HousingProfile,
  type KnownRoof,
  type OwnActivity,
  type OwnJob,
  type ScoredArea,
  type TripPlan,
} from './knockOpportunities';

export type { FinderMode } from './knockOpportunities';

export type FinderStep = 'storms' | 'scoring' | 'housing' | 'naming' | 'brief';

export const FINDER_STEPS: { id: FinderStep; label: string }[] = [
  { id: 'storms', label: `Pulling ${LOOKBACK_MONTHS} months of NWS storm reports` },
  { id: 'scoring', label: 'Scoring every area a report landed in' },
  { id: 'housing', label: 'Looking up roof age and housing stock (Census)' },
  { id: 'naming', label: 'Naming the streets' },
  { id: 'brief', label: 'Writing the brief' },
];

/** Step labels for a given radius and mode — what the progress list prints. */
export function finderStepLabel(step: FinderStep, radiusMiles: number = DEFAULT_SEARCH_RADIUS_MILES, mode: FinderMode = 'storm'): string {
  switch (step) {
    case 'storms':
      return `Pulling ${LOOKBACK_MONTHS} months of NWS storm reports within ${radiusMiles} mi`;
    case 'scoring':
      return mode === 'neighbours' ? 'Scoring the streets around your jobs' : 'Scoring every area a report landed in';
    default:
      return FINDER_STEPS.find((s) => s.id === step)?.label ?? 'Working';
  }
}

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
  /** Cells that qualified — storm mode: a report landed in them; neighbours mode: a job sits in them. */
  cellCount: number;
  areas: ScoredArea[];
  plan: TripPlan;
  brief: OpportunityBrief | null;
  briefStatus: BriefStatus;
  housingStatus: HousingStatus;
  notes: string[];
  /** Absent on plans made before neighbours mode existed → 'storm'. */
  mode?: FinderMode;
  /** How many of the roofer's doors the base rates were calibrated from (0 = the table). */
  calibratedDoors?: number;
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

/** Hand the JS thread back to the UI for a tick — taps and the partial results get through. */
const yieldToUI = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Thrown between phases when the caller's `shouldStop` says so (the Cancel
 * button on the planner screen). The runner treats it as "stopped at the
 * roofer's request" — no failure entry, no Diagnostics record.
 */
export class KnockRunCancelledError extends Error {
  constructor() {
    super('Knock Planner run cancelled');
    this.name = 'KnockRunCancelledError';
  }
}

/** "Pinned spot · 33.02, −96.70" — the last-resort label for a base with no name. */
export function pinnedLabel(base: { lat: number; lng: number }): string {
  const fmt = (n: number) => `${n < 0 ? '−' : ''}${Math.abs(n).toFixed(2)}`;
  return `Pinned spot · ${fmt(base.lat)}, ${fmt(base.lng)}`;
}

// ---------------------------------------------------------------------------
// The roofer's jobs, as the finder wants them — pure
// ---------------------------------------------------------------------------

const SIGNED_INDEX = LEAD_STAGE_ORDER.indexOf('signed');

/**
 * Is this job signed — a signed proposal, the homeowner's signature on the
 * inspection, or the linked lead at or past Approved / Signed? Pure.
 */
export function isSignedJob(
  ins: Pick<Inspection, 'id' | 'leadId' | 'homeownerSignatureSvg' | 'homeownerSignaturePng'>,
  proposals: readonly Pick<Proposal, 'jobId' | 'status'>[],
  leads: readonly Pick<Lead, 'id' | 'inspectionId' | 'stage'>[],
): boolean {
  if (proposals.some((p) => p.jobId === ins.id && p.status === 'signed')) return true;
  if (ins.homeownerSignatureSvg || ins.homeownerSignaturePng) return true;
  const lead = (ins.leadId ? leads.find((l) => l.id === ins.leadId) : undefined) ?? leads.find((l) => l.inspectionId === ins.id);
  if (!lead) return false;
  const col = leadStageColumn(lead.stage);
  if (col === 'lost') return false;
  const idx = LEAD_STAGE_ORDER.indexOf(col);
  return idx >= 0 && idx >= SIGNED_INDEX;
}

/** Every geocoded job as an `OwnJob`, with `signed` resolved. Pure. */
export function ownJobsFrom(
  inspections: readonly Pick<Inspection, 'id' | 'leadId' | 'homeownerSignatureSvg' | 'homeownerSignaturePng' | 'lat' | 'lng' | 'address' | 'customerName' | 'createdAt'>[],
  proposals: readonly Pick<Proposal, 'jobId' | 'status'>[],
  leads: readonly Pick<Lead, 'id' | 'inspectionId' | 'stage'>[],
): OwnJob[] {
  const out: OwnJob[] = [];
  for (const i of inspections) {
    if (typeof i.lat !== 'number' || typeof i.lng !== 'number') continue;
    const lead = (i.leadId ? leads.find((l) => l.id === i.leadId) : undefined) ?? leads.find((l) => l.inspectionId === i.id);
    out.push({
      lat: i.lat,
      lng: i.lng,
      signed: isSignedJob(i, proposals, leads),
      stage: lead?.stage,
      address: i.address,
      customerName: i.customerName,
      at: i.createdAt,
    });
  }
  return out;
}

/** Cached Zillow records with a known roof year, as the finder's known-roofs input. Pure. */
export function knownRoofsFrom(records: readonly PropertyRecord[], nowYear: number): KnownRoof[] {
  const out: KnownRoof[] = [];
  for (const r of records) {
    if (r.status !== 'found' || typeof r.lat !== 'number' || typeof r.lng !== 'number') continue;
    const y = roofYearFromRecord(r, nowYear);
    if (!y) continue;
    out.push({ lat: r.lat, lng: r.lng, roofYear: y.year });
  }
  return out;
}

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

export type FindKnockOpportunitiesArgs = {
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
  /** Default 'storm'. */
  mode?: FinderMode;
  /** Clamped to [MIN, MAX]; default DEFAULT_SEARCH_RADIUS_MILES. */
  radiusMiles?: number;
  /** Absent → refresh and read the calibration store; null → the table. */
  calibration?: CalibratedRates | null;
  /** Absent → the property-record cache; [] → none. */
  knownRoofs?: readonly KnownRoof[];
  /** Test seam: supply the storm reports instead of pulling them. */
  events?: readonly StormEvent[];
  /**
   * Polled between phases (after the storm pull, the scoring, the housing
   * lookups and the naming, and before the brief). Return true to stop: the
   * run throws `KnockRunCancelledError` instead of finishing. A phase that
   * is mid-flight completes first — cancel lands within one phase.
   */
  shouldStop?: () => boolean;
};

export async function findKnockOpportunities(args: FindKnockOpportunitiesArgs): Promise<FinderOutcome> {
  const now = args.now ?? new Date();
  const mode: FinderMode = args.mode ?? 'storm';
  const radiusMiles = clampRadiusMiles(args.radiusMiles);
  const base: BasePoint = { ...args.base, label: args.base.label?.trim() || pinnedLabel(args.base) };
  const notes: string[] = [];
  const checkStop = () => {
    if (args.shouldStop?.()) throw new KnockRunCancelledError();
  };

  if (mode === 'neighbours' && !(args.own?.jobs.length)) {
    return { status: 'unavailable', reason: 'Neighbours mode needs a job with an address — none on this phone yet.' };
  }

  // 1. Storms — per-point service, server-side radius crop (lib/noaa.ts).
  args.onStep?.('storms');
  const start = new Date(now);
  start.setMonth(start.getMonth() - LOOKBACK_MONTHS);
  let events: readonly StormEvent[];
  if (args.events) {
    events = args.events;
  } else {
    try {
      events = await fetchStormHistory({
        state: '',
        start,
        end: now,
        types: ['hail', 'wind'],
        near: { lat: base.lat, lon: base.lng, radiusMiles },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'Storm history service unreachable';
      if (mode !== 'neighbours') return { status: 'unavailable', reason };
      // Neighbours mode is about the roofer's jobs first; rank them without
      // storm evidence and say so.
      events = [];
      notes.push(`Storm history not available (${reason}) — streets ranked by your jobs alone.`);
    }
  }
  const hailCount = events.filter((e) => e.type === 'hail').length;
  const windCount = events.length - hailCount;
  await yieldToUI();
  checkStop();

  // 2. Score — one pass; the roofer's calibration and the known new roofs
  // come from their stores unless the caller supplied them.
  args.onStep?.('scoring');
  const calibration = args.calibration === undefined ? calibrationForRun(now) : args.calibration;
  const knownRoofs =
    args.knownRoofs ??
    knownRoofsFrom(
      Object.values(usePropertyRecordStore.getState().byAddress).map((e) => e.record),
      now.getFullYear(),
    );
  const ranking = rankAreasDetailed({
    base,
    now,
    events,
    own: args.own,
    limit: MAX_AREAS,
    mode,
    radiusMiles,
    calibration,
    knownRoofs,
  });
  const ranked = ranking.areas;
  const cellCount = ranking.cellCount;
  if (ranked.length === 0) {
    if (mode === 'neighbours') {
      return { status: 'unavailable', reason: `None of your jobs are within ${radiusMiles} mi of ${base.label}.` };
    }
    return { status: 'no_storms', eventCount: events.length };
  }
  notes.push(calibrationSummary(calibration));
  const calibratedDoors = calibration?.totalDoors ?? 0;
  await yieldToUI();
  checkStop();

  const partialOf = (areasNow: ScoredArea[], extra: Partial<KnockFinderResult> = {}): KnockFinderResult => ({
    generatedAt: now.toISOString(),
    base,
    radiusMiles,
    lookbackMonths: LOOKBACK_MONTHS,
    eventCount: events.length,
    hailCount,
    windCount,
    cellCount,
    areas: areasNow,
    plan: planTrip(areasNow, base),
    brief: null,
    briefStatus: 'rules',
    housingStatus: 'no_key',
    notes: ['Still enriching — roof age, street names and the brief are on their way.'],
    mode,
    calibratedDoors,
    ...extra,
  });
  args.onPartial?.(partialOf(ranked.map((a) => ({ ...a, name: a.name ?? a.storm.town }))));

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
  let areas = applyHousing(ranked, housing, now, calibration);
  const housingStatus: HousingStatus =
    acsHits === ENRICH ? 'acs' : acsHits > 0 ? 'partial' : isCensusConfigured ? 'unavailable' : 'no_key';
  if (housingStatus === 'no_key') notes.push('Roof age and ownership were not available (no Census key) — national averages assumed.');
  if (housingStatus === 'unavailable') notes.push('The Census service did not answer — national housing averages assumed.');
  if (housingStatus === 'partial') notes.push(`Census housing data covered ${acsHits} of ${ENRICH} areas; the rest use national averages.`);
  args.onPartial?.(
    partialOf(
      areas.map((a) => ({ ...a, name: a.name ?? a.storm.town })),
      { housingStatus, notes: [...notes, 'Naming the streets and writing the brief…'] },
    ),
  );
  await yieldToUI();
  checkStop();

  // 4. Names — Google reverse geocode when configured, else the reports'
  // town. A neighbours card already carries its job's street and city;
  // the geocoder only fills what is missing.
  args.onStep?.('naming');
  if (isGoogleMapsConfigured) {
    areas = await mapLimit(areas, 5, async (a) => {
      try {
        const g = await reverseGeocode({ lat: a.lat, lng: a.lng });
        if (!g) return { ...a, name: a.name ?? a.storm.town };
        const city = g.city ?? a.storm.town;
        const name = a.name ?? (city ? `${city}${g.stateCode ? `, ${g.stateCode}` : ''}` : g.formattedAddress);
        const street = g.formattedAddress.split(',')[0]?.trim();
        const landmark = a.landmark ?? (street && street !== city ? `near ${street}` : undefined);
        return { ...a, name, landmark, zip: g.postalCode };
      } catch {
        return { ...a, name: a.name ?? a.storm.town };
      }
    });
  } else {
    areas = areas.map((a) => ({ ...a, name: a.name ?? a.storm.town }));
    notes.push('Street names need the Google key — areas are labelled by the reporting town.');
  }

  // 5. Plan.
  const plan = planTrip(areas, base);

  args.onPartial?.(partialOf(areas, { plan, housingStatus, notes: [...notes, 'Writing the brief…'] }));
  await yieldToUI();
  checkStop();

  // 6. Brief.
  args.onStep?.('brief');
  let brief: OpportunityBrief | null = null;
  let briefStatus: BriefStatus = 'rules';
  if (!isGeminiConfigured) {
    briefStatus = 'no_key';
  } else {
    brief = await writeOpportunityBrief({ base, areas, plan, timeoutMs: 20_000 });
    briefStatus = brief ? 'ai' : 'unavailable';
  }

  return {
    status: 'ok',
    result: {
      generatedAt: now.toISOString(),
      base,
      radiusMiles,
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
      mode,
      calibratedDoors,
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
