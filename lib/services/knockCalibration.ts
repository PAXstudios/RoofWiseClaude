// Calibration for "Where should I knock?" — the feedback loop docs §8 waited
// for. Pure: no I/O, no clock reads, no store imports.
//
// The finder's per-roof probability starts from a TABLE of base rates by the
// worst hail in a cell (§4.1). Those rates are documented assumptions. Every
// door the roofer actually knocks inside a planned area is evidence about
// them: doors → contacts → damage seen → leads → signed. This module turns
// that evidence into a Beta-binomial posterior per hail class so the table
// holds until the roofer has real data, then bends toward what their market
// actually yields — never below 0.01, never above 0.75.
//
// The maths, in words (docs/KNOCK_OPPORTUNITIES.md §8):
//   posterior = (table × 20 + finds) / (20 + doors)      per class, ≥ 20 doors
//   market    = (finds + 20·p̄) / (expected + 20·p̄)       overall, clamped 0.4–2.0
//   rate      = table × market                            for classes < 20 doors
// where `doors` are weighted by the modifier the formula applied to that
// street (roof age, direct hit, roofs already replaced) — a slow street after
// an old storm must not drag the base rate for a fresh one.

import type { Knock } from '../models/types';
import type { StormEvidence } from './knockOpportunities';
import { haversineMilesBetween } from './stormWhere';
import { isWin, outcomeMeta } from './knockOutcomes';

// ---------------------------------------------------------------------------
// Hail classes — the §4.1 buckets
// ---------------------------------------------------------------------------

export type HailClass =
  | 'hail_200'
  | 'hail_150'
  | 'hail_125'
  | 'hail_100'
  | 'hail_075'
  | 'hail_small'
  | 'hail_nosize'
  | 'wind_86'
  | 'wind_70'
  | 'wind_58'
  | 'wind_other';

export const HAIL_CLASSES: readonly HailClass[] = [
  'hail_200',
  'hail_150',
  'hail_125',
  'hail_100',
  'hail_075',
  'hail_small',
  'hail_nosize',
  'wind_86',
  'wind_70',
  'wind_58',
  'wind_other',
];

export const HAIL_CLASS_LABELS: Record<HailClass, string> = {
  hail_200: '2.00"+ hail',
  hail_150: '1.50–1.99" hail',
  hail_125: '1.25–1.49" hail',
  hail_100: '1.00–1.24" hail',
  hail_075: '0.75–0.99" hail',
  hail_small: '< 0.75" hail',
  hail_nosize: 'hail, size not reported',
  wind_86: 'wind 86+ mph',
  wind_70: 'wind 70–85 mph',
  wind_58: 'wind 58–69 mph',
  wind_other: 'wind, sub-severe or no gust',
};

/**
 * The §4.1 table: share of asphalt roofs under that hail that carry
 * claim-grade damage (8+ functional hits per test square). Documented model
 * assumptions — this module is what corrects them.
 */
export const DEFAULT_BASE_RATES: Readonly<Record<HailClass, number>> = {
  hail_200: 0.65,
  hail_150: 0.5,
  hail_125: 0.35,
  hail_100: 0.22,
  hail_075: 0.1,
  hail_small: 0.03,
  hail_nosize: 0.1,
  wind_86: 0.16,
  wind_70: 0.1,
  wind_58: 0.06,
  wind_other: 0.06,
};

/** No report of any kind in or next to the cell (neighbours mode only). */
export const NO_EVIDENCE_BASE_RATE = 0.01;

/** The class a cell's worst evidence falls in; null when there is none. */
export function hailClassOf(
  s: Pick<StormEvidence, 'maxHailInches' | 'maxWindMph' | 'hailReports' | 'windReports'>,
): HailClass | null {
  const h = s.maxHailInches;
  if (h != null) {
    if (h >= 2.0) return 'hail_200';
    if (h >= 1.5) return 'hail_150';
    if (h >= 1.25) return 'hail_125';
    if (h >= 1.0) return 'hail_100';
    if (h >= 0.75) return 'hail_075';
    return 'hail_small';
  }
  if (s.hailReports > 0) return 'hail_nosize';
  const w = s.maxWindMph;
  if (w != null) {
    if (w >= 86) return 'wind_86';
    if (w >= 70) return 'wind_70';
    if (w >= 58) return 'wind_58';
    return 'wind_other';
  }
  return s.windReports > 0 ? 'wind_other' : null;
}

// ---------------------------------------------------------------------------
// What counts — a door, a contact, a find
// ---------------------------------------------------------------------------

export type KnockLike = Pick<Knock, 'lat' | 'lng' | 'outcome' | 'createdAt' | 'damageNoted' | 'createdLeadId'>;

/**
 * A "find" is a roof with claim-grade evidence behind it. `damageNoted` is
 * the direct signal (the roofer looked): true is a find, false is the
 * strongest "no" there is. Without a look, an outcome that means someone
 * said yes to a conversation about damage (interested, booked, inspected,
 * signed — `isWin`) counts; no answer, vacant, renter, not interested do not.
 */
export function isFind(k: Pick<Knock, 'outcome' | 'damageNoted'>): boolean {
  if (k.damageNoted === true) return true;
  if (k.damageNoted === false) return false;
  return isWin(k.outcome);
}

export type PerformanceCounts = {
  doors: number;
  contacts: number;
  /** `damageNoted === true` — the roofer looked and saw it. */
  damageConfirmed: number;
  /** Claim-grade evidence (`isFind`) — what the posterior counts. */
  finds: number;
  leads: number;
  appointments: number;
  signed: number;
};

export function countPerformance(knocks: readonly Pick<Knock, 'outcome' | 'damageNoted' | 'createdLeadId'>[]): PerformanceCounts {
  const c: PerformanceCounts = { doors: 0, contacts: 0, damageConfirmed: 0, finds: 0, leads: 0, appointments: 0, signed: 0 };
  for (const k of knocks) {
    const m = outcomeMeta(k.outcome);
    if (m.countsAsDoor) c.doors += 1;
    if (m.isContact) c.contacts += 1;
    if (k.damageNoted === true) c.damageConfirmed += 1;
    if (isFind(k)) c.finds += 1;
    if (k.createdLeadId) c.leads += 1;
    if (m.id === 'appointment') c.appointments += 1;
    if (m.id === 'signed') c.signed += 1;
  }
  return c;
}

/** One line for a card: "38 doors · 12 answered · 3 leads · 1 signed". */
export function performanceLine(c: PerformanceCounts): string {
  const parts = [`${c.doors} door${c.doors === 1 ? '' : 's'}`, `${c.contacts} answered`];
  if (c.damageConfirmed > 0) parts.push(`${c.damageConfirmed} damage seen`);
  parts.push(`${c.leads} lead${c.leads === 1 ? '' : 's'}`);
  if (c.appointments > 0) parts.push(`${c.appointments} booked`);
  if (c.signed > 0) parts.push(`${c.signed} signed`);
  return parts.join(' · ');
}

// ---------------------------------------------------------------------------
// Area performance — real knocks inside a planned area's ring
// ---------------------------------------------------------------------------

/** = CELL_MILES in knockOpportunities.ts: the canvass ring around an area's centre. */
export const DEFAULT_RING_MILES = 3;

export type AreaPerformance = PerformanceCounts & {
  areaKey: string;
  planId: string;
  hailClass: HailClass | null;
  /** The per-roof p the plan promised for this area (the calibrated base × modifiers). */
  expectedPerDoor: number;
  /**
   * What the formula multiplied the base rate by on this street — roof age,
   * direct hit, roofs already replaced, known new roofs. Weighs the doors in
   * the posterior so an old storm's slow street cannot drag a fresh storm's
   * base rate. 1 when the plan predates this field.
   */
  modifier: number;
  /** ISO — when this record was computed. */
  at: string;
};

/** The subset of a saved plan the calibration reads. Structural, so tests need no store. */
export type PerformancePlan = {
  id: string;
  createdAt: string;
  areas: readonly {
    key: string;
    lat: number;
    lng: number;
    hailClass: HailClass | null;
    expectedPerDoor: number;
    modifier: number;
  }[];
};

/** Knocks made after `since` within `radiusMiles` of a point. Pure. */
export function knocksInRing<K extends KnockLike>(
  knocks: readonly K[],
  center: { lat: number; lng: number },
  since: string,
  radiusMiles = DEFAULT_RING_MILES,
): K[] {
  const sinceMs = new Date(since).getTime();
  return knocks.filter(
    (k) => new Date(k.createdAt).getTime() >= sinceMs && haversineMilesBetween(center.lat, center.lng, k.lat, k.lng) <= radiusMiles,
  );
}

/** Live counts for one area of a plan — what the plan page prints. Pure. */
export function areaPerformance(
  knocks: readonly KnockLike[],
  area: { lat: number; lng: number },
  since: string,
  radiusMiles = DEFAULT_RING_MILES,
): PerformanceCounts {
  return countPerformance(knocksInRing(knocks, area, since, radiusMiles));
}

/**
 * Attribute every knock to at most ONE (plan, area): the newest plan made
 * before the knock that has an area within the ring, and the nearest such
 * area in it. Plans for the same base repeat the same cells run after run;
 * without this a Wednesday knock would count once for Monday's plan and
 * again for Tuesday's, and the posterior would see doors that were never
 * knocked. Pure.
 */
export function attributeKnocks(
  plans: readonly PerformancePlan[],
  knocks: readonly KnockLike[],
  radiusMiles = DEFAULT_RING_MILES,
): Map<string, Map<string, KnockLike[]>> {
  const byCreated = [...plans].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
  const out = new Map<string, Map<string, KnockLike[]>>();
  for (const k of knocks) {
    const kMs = new Date(k.createdAt).getTime();
    if (Number.isNaN(kMs)) continue;
    for (const p of byCreated) {
      if (new Date(p.createdAt).getTime() > kMs) continue;
      let best: { key: string; miles: number } | null = null;
      for (const a of p.areas) {
        const m = haversineMilesBetween(a.lat, a.lng, k.lat, k.lng);
        if (m <= radiusMiles && (!best || m < best.miles)) best = { key: a.key, miles: m };
      }
      if (!best) continue;
      let areas = out.get(p.id);
      if (!areas) {
        areas = new Map();
        out.set(p.id, areas);
      }
      areas.set(best.key, [...(areas.get(best.key) ?? []), k]);
      break;
    }
  }
  return out;
}

/**
 * One record per (plan, area) that has at least one door, from every plan
 * and every knock. Replaces, never accumulates — the records are a cache of
 * a computation over live data, so deleting a plan drops its records. Pure.
 */
export function buildPerformanceRecords(
  plans: readonly PerformancePlan[],
  knocks: readonly KnockLike[],
  at: string,
  radiusMiles = DEFAULT_RING_MILES,
): AreaPerformance[] {
  const attributed = attributeKnocks(plans, knocks, radiusMiles);
  const out: AreaPerformance[] = [];
  for (const p of plans) {
    const areas = attributed.get(p.id);
    if (!areas) continue;
    for (const a of p.areas) {
      const ks = areas.get(a.key);
      if (!ks || ks.length === 0) continue;
      const counts = countPerformance(ks);
      if (counts.doors === 0) continue;
      out.push({
        ...counts,
        areaKey: a.key,
        planId: p.id,
        hailClass: a.hailClass,
        expectedPerDoor: a.expectedPerDoor,
        modifier: a.modifier,
        at,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// The posterior
// ---------------------------------------------------------------------------

/** Doors' worth of belief in the table. 20: one half-stop of real data before the table bends. */
export const PRIOR_STRENGTH_DOORS = 20;
/** A class needs this many real doors before its own posterior is used. */
export const MIN_CLASS_DOORS = 20;
export const RATE_FLOOR = 0.01;
export const RATE_CEILING = 0.75;
export const MARKET_RATIO_FLOOR = 0.4;
export const MARKET_RATIO_CEILING = 2.0;

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/**
 * Beta-binomial posterior mean: the table rate holds `strength` doors' worth
 * of weight; every real door moves it toward finds ÷ doors. Clamped to the
 * formula's [0.01, 0.75] band. Pure.
 */
export function posteriorRate(prior: number, doors: number, finds: number, strength = PRIOR_STRENGTH_DOORS): number {
  if (doors <= 0) return clamp(prior, RATE_FLOOR, RATE_CEILING);
  return clamp((prior * strength + finds) / (strength + doors), RATE_FLOOR, RATE_CEILING);
}

/**
 * Found ÷ expected across every knocked area, shrunk toward 1 with the same
 * 20-door prior (p̄ = expected per door) and clamped 0.4–2.0. "Your market
 * runs 0.8× the table." 1 when there is nothing to compare. Pure.
 */
export function marketRatio(doors: number, finds: number, expected: number, strength = PRIOR_STRENGTH_DOORS): number {
  if (doors <= 0 || expected <= 0) return 1;
  const meanP = expected / doors;
  const ratio = (finds + strength * meanP) / (expected + strength * meanP);
  return clamp(ratio, MARKET_RATIO_FLOOR, MARKET_RATIO_CEILING);
}

export type CalibrationMethod = 'posterior' | 'market' | 'table';

export type ClassCalibration = {
  hailClass: HailClass;
  label: string;
  tableRate: number;
  rate: number;
  doors: number;
  finds: number;
  /** doors ÷ (doors + 20): 0 with no data, 0.5 at 20 doors, 0.9 at 180. */
  confidence: number;
  method: CalibrationMethod;
  /** Human line: `2.00"+ hail: 0.65 → 0.58 from 123 doors (71 finds)`. */
  text: string;
};

export type CalibratedRates = {
  rates: Record<HailClass, number>;
  /** Raw doors per class. */
  samples: Record<HailClass, number>;
  finds: Record<HailClass, number>;
  confidence: Record<HailClass, number>;
  methods: Record<HailClass, CalibrationMethod>;
  lines: ClassCalibration[];
  /** Found ÷ expected overall (0.4–2.0); 1 with no data. */
  marketRatio: number;
  totalDoors: number;
  totalFinds: number;
  /** Σ doors × the p each plan promised. */
  totalExpected: number;
  plans: number;
  areas: number;
};

const fmtRate = (p: number) => p.toFixed(2);

/**
 * Refit the base-rate table from area performance. Pure.
 *
 * Per class with ≥ 20 (modifier-weighted) doors: the posterior. Per class
 * with fewer: the table scaled by the overall market ratio. Untouched
 * classes: the table. The result is what `roofHitProbability` uses in place
 * of `DEFAULT_BASE_RATES` and what the planner's "Your calibration" card
 * prints.
 */
export function calibrateBaseRates(history: readonly AreaPerformance[], prior: Readonly<Record<HailClass, number>> = DEFAULT_BASE_RATES): CalibratedRates {
  const rawDoors = {} as Record<HailClass, number>;
  const weightedDoors = {} as Record<HailClass, number>;
  const findsBy = {} as Record<HailClass, number>;
  for (const c of HAIL_CLASSES) {
    rawDoors[c] = 0;
    weightedDoors[c] = 0;
    findsBy[c] = 0;
  }
  let totalDoors = 0;
  let totalFinds = 0;
  let totalExpected = 0;
  const planIds = new Set<string>();
  let areas = 0;
  for (const r of history) {
    if (r.doors <= 0) continue;
    areas += 1;
    planIds.add(r.planId);
    totalDoors += r.doors;
    totalFinds += r.finds;
    totalExpected += r.doors * r.expectedPerDoor;
    if (!r.hailClass) continue;
    const mod = clamp(Number.isFinite(r.modifier) && r.modifier > 0 ? r.modifier : 1, 0.05, 2);
    rawDoors[r.hailClass] += r.doors;
    weightedDoors[r.hailClass] += r.doors * mod;
    findsBy[r.hailClass] += r.finds;
  }
  const market = marketRatio(totalDoors, totalFinds, totalExpected);

  const rates = {} as Record<HailClass, number>;
  const confidence = {} as Record<HailClass, number>;
  const methods = {} as Record<HailClass, CalibrationMethod>;
  const lines: ClassCalibration[] = [];
  for (const c of HAIL_CLASSES) {
    const table = prior[c];
    const doors = rawDoors[c];
    const finds = findsBy[c];
    let rate: number;
    let method: CalibrationMethod;
    let text: string;
    if (weightedDoors[c] >= MIN_CLASS_DOORS) {
      rate = posteriorRate(table, weightedDoors[c], finds);
      method = 'posterior';
      text = `${HAIL_CLASS_LABELS[c]}: ${fmtRate(table)} → ${fmtRate(rate)} from ${doors} doors (${finds} find${finds === 1 ? '' : 's'})`;
    } else if (totalDoors > 0 && market !== 1) {
      rate = clamp(table * market, RATE_FLOOR, RATE_CEILING);
      method = 'market';
      text = `${HAIL_CLASS_LABELS[c]}: ${fmtRate(table)} → ${fmtRate(rate)} — your market runs ${market.toFixed(1)}× the table (${doors} door${doors === 1 ? '' : 's'} in this class)`;
    } else {
      rate = clamp(table, RATE_FLOOR, RATE_CEILING);
      method = 'table';
      text = `${HAIL_CLASS_LABELS[c]}: ${fmtRate(table)} (table — ${doors > 0 ? `${doors} door${doors === 1 ? '' : 's'}, not enough yet` : 'no doors yet'})`;
    }
    rates[c] = rate;
    confidence[c] = doors / (doors + PRIOR_STRENGTH_DOORS);
    methods[c] = method;
    lines.push({ hailClass: c, label: HAIL_CLASS_LABELS[c], tableRate: table, rate, doors, finds, confidence: confidence[c], method, text });
  }

  return {
    rates,
    samples: rawDoors,
    finds: findsBy,
    confidence,
    methods,
    lines,
    marketRatio: market,
    totalDoors,
    totalFinds,
    totalExpected,
    plans: planIds.size,
    areas,
  };
}

// ---------------------------------------------------------------------------
// Reading the calibration for one cell
// ---------------------------------------------------------------------------

export type AreaCalibration = {
  hailClass: HailClass | null;
  tableRate: number;
  usedRate: number;
  doors: number;
  method: CalibrationMethod;
  /** "Your data: 0.58 (123 doors) vs table 0.65" — for the card and the rationale. */
  note: string;
};

/** The base rate the formula should use for a cell — the table, or the calibrated rate when there is one. Pure. */
export function calibratedBaseRate(
  storm: Pick<StormEvidence, 'maxHailInches' | 'maxWindMph' | 'hailReports' | 'windReports'>,
  calibration: CalibratedRates | null | undefined,
): AreaCalibration {
  const hailClass = hailClassOf(storm);
  if (!hailClass) {
    return { hailClass: null, tableRate: NO_EVIDENCE_BASE_RATE, usedRate: NO_EVIDENCE_BASE_RATE, doors: 0, method: 'table', note: 'No storm report on file here — the floor rate applies.' };
  }
  const tableRate = DEFAULT_BASE_RATES[hailClass];
  if (!calibration) {
    return { hailClass, tableRate, usedRate: tableRate, doors: 0, method: 'table', note: `Table rate ${fmtRate(tableRate)} for ${HAIL_CLASS_LABELS[hailClass]}.` };
  }
  const usedRate = calibration.rates[hailClass] ?? tableRate;
  const doors = calibration.samples[hailClass] ?? 0;
  const method = calibration.methods[hailClass] ?? 'table';
  const note =
    method === 'posterior'
      ? `Your data: ${fmtRate(usedRate)} per roof (${doors} doors under ${HAIL_CLASS_LABELS[hailClass]}) vs table ${fmtRate(tableRate)}.`
      : method === 'market'
        ? `Your market runs ${calibration.marketRatio.toFixed(1)}× the table — ${fmtRate(usedRate)} vs ${fmtRate(tableRate)} (${doors} door${doors === 1 ? '' : 's'} in this class so far).`
        : `Table rate ${fmtRate(tableRate)} for ${HAIL_CLASS_LABELS[hailClass]} — no doors of yours under it yet.`;
  return { hailClass, tableRate, usedRate, doors, method, note };
}

/** The summary line for a plan's notes. Pure. */
export function calibrationSummary(calibration: CalibratedRates | null | undefined): string {
  if (!calibration || calibration.totalDoors === 0) {
    return 'Base rates are the table — calibration starts after your first plan is knocked.';
  }
  return `Base rates calibrated from ${calibration.totalDoors} doors on ${calibration.plans} plan${calibration.plans === 1 ? '' : 's'} (${calibration.totalFinds} finds; your market runs ${calibration.marketRatio.toFixed(1)}× the table).`;
}
