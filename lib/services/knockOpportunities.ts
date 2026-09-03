// "Where should I knock?" — the scoring engine. Pure: no I/O, no clock reads.
//
// The roofer should not have to think about where to go. This module turns
// 24 months of NWS local storm reports within 100 mi, the Census housing
// profile of each area, and the roofer's own footprint into a ranked list
// of ~3-mile areas with (a) a Knock Score, (b) a per-roof probability of
// claim-grade damage, (c) "knock N doors, expect to find at least M" with a
// stated confidence, and (d) a day-by-day trip plan.
//
// The formula, its constants and their sources are documented in
// docs/KNOCK_OPPORTUNITIES.md. Every number this module emits is derived
// from live inputs; when an input is missing (no Census key, a report with
// no size) the output says so instead of guessing (Drift #5).

import type { StormEvent } from '../noaa';
import { bearingBetween, haversineMilesBetween, type Bearing } from './stormWhere';

// ---------------------------------------------------------------------------
// Constants (see docs/KNOCK_OPPORTUNITIES.md §2 for provenance)
// ---------------------------------------------------------------------------

/** How far from base the finder looks. Owner: "within a 100 mile radius". */
export const SEARCH_RADIUS_MILES = 100;
/** Owner: "if there was a hail storm there in the past 2 years". */
export const LOOKBACK_MONTHS = 24;
/** Scoring cell edge — matches the 3-mi canvass radius a knock route uses. */
export const CELL_MILES = 3;
/** A stop is this many doors: ~90 minutes at a field pace of ~25 doors/hour. */
export const DOORS_PER_STOP = 40;
/** The count the roofer should plan around per stop (docs §4). */
export const TARGET_FINDS = 5;
/** Confidence for "at least M" statements. */
export const CONFIDENCE = 0.8;
/** Areas the finder ranks and enriches; everything beyond is noise. */
export const MAX_AREAS = 10;

const DOORS_PER_HOUR = 25;
const DRIVE_MPH = 35;
const DAY_MINUTES = 8 * 60;
const MAX_PLAN_DAYS = 3;
const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

/** Neighbour-cell share of a report's weight: hail falls in swaths, not points. */
const ADJACENT_SPREAD = 0.4;
/** Saturation constant for the storm score: exposure 1.5 → 63, 3 → 86. */
const STORM_SATURATION = 1.5;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BasePoint = { lat: number; lng: number; label: string };

export type OwnActivity = {
  /** The roofer's knocks (any outcome) — recent ones lower the score. */
  knocks: { lat: number; lng: number; at: string }[];
  /** The roofer's jobs — a yard sign and a referral base. */
  jobs: { lat: number; lng: number }[];
};

export type HousingSource = 'acs' | 'national_prior';

export type HousingProfile = {
  source: HousingSource;
  /** Why the prior was used, when it was. */
  priorReason?: string;
  medianYearBuilt: number | null;
  ownerOccupiedShare: number | null;
  singleFamilyShare: number | null;
  housingUnits: number | null;
  unitsPerSqMi: number | null;
  tractName?: string;
  geoid?: string;
};

export type StormDaySummary = {
  /** YYYY-MM-DD (UTC — reports are compared by day, not shown as a time). */
  day: string;
  reports: number;
  maxHailInches: number | null;
  maxWindMph: number | null;
  /** 1 = a report landed in this cell; ADJACENT_SPREAD = neighbour only. */
  spread: number;
  town?: string;
};

export type StormEvidence = {
  hailReports: number;
  windReports: number;
  maxHailInches: number | null;
  maxWindMph: number | null;
  /** The day that contributes most — what the rationale leads with. */
  strongest: StormDaySummary | null;
  monthsSinceStrongest: number | null;
  days: StormDaySummary[];
  /** True when at least one report fell inside the cell itself. */
  direct: boolean;
  exposure: number;
  /** 0–100 */
  stormScore: number;
  /** Most-named town across the cell's reports, when reports named one. */
  town?: string;
};

export type ScoreFactors = {
  storm: number;
  housing: number;
  access: number;
  canvassed: number;
  ownJobs: number;
};

export type HitRate = {
  /** Probability a given roof in this area carries claim-grade damage. */
  perRoof: number;
  doors: number;
  expected: number;
  /** Largest M with P(finds ≥ M) ≥ CONFIDENCE over `doors` roofs. */
  atLeast: number;
  confidence: number;
  target: number;
  /** P(finds ≥ target) over `doors` roofs. */
  pAtLeastTarget: number;
  /** Smallest door count with P(finds ≥ target) ≥ CONFIDENCE, null if > 600. */
  doorsForTarget: number | null;
};

export type ScoredArea = {
  key: string;
  lat: number;
  lng: number;
  /** "Frisco, TX" — filled by the finder (reverse geocode, else the reports' town). */
  name?: string;
  /** "near 1200 Legacy Dr" — a street the roofer can drive to. */
  landmark?: string;
  distanceMiles: number;
  bearing: Bearing;
  driveMinutes: number;
  storm: StormEvidence;
  housing: HousingProfile;
  /** 0–100 roof susceptibility from the housing profile. */
  susceptibility: number;
  factors: ScoreFactors;
  /** 0–100 */
  knockScore: number;
  hitRate: HitRate;
  ownJobs: number;
  recentKnocks: number;
  /** Rule-based rationale — what the AI brief is asked to phrase, never invent. */
  reasons: string[];
};

export type TripStop = {
  area: ScoredArea;
  /** From the previous stop (or base for the first). */
  driveMiles: number;
  driveMinutes: number;
  /** Minutes after the day's start when the roofer arrives. */
  startMinute: number;
  doors: number;
  workMinutes: number;
  expected: number;
  atLeast: number;
};

export type TripDay = {
  day: number;
  stops: TripStop[];
  totalMiles: number;
  totalMinutes: number;
  expected: number;
  atLeast: number;
};

export type TripPlan = {
  days: TripDay[];
  totalMiles: number;
  totalMinutes: number;
  totalDoors: number;
  expected: number;
  /** Sum of per-stop 80% floors — conservative by construction. */
  atLeast: number;
  /** Areas that did not fit in MAX_PLAN_DAYS. */
  unplanned: ScoredArea[];
};

// ---------------------------------------------------------------------------
// Weights (docs §2)
// ---------------------------------------------------------------------------

/** Hail severity weight. NWS severe is 1"; IBHS: 1" marks aged asphalt. */
export function hailWeight(inches: number | null): number {
  if (inches == null) return 0.3; // "hail" with no size reported
  if (inches >= 2.0) return 1.0;
  if (inches >= 1.5) return 0.9;
  if (inches >= 1.0) return 0.75;
  if (inches >= 0.75) return 0.45;
  return 0.15;
}

/** Wind severity weight. 58 mph = NWS severe; 70+ lifts tabs; 86+ strips. */
export function windWeight(mph: number | null): number {
  if (mph == null) return 0.25; // a damage report with no gust measured
  if (mph >= 86) return 0.65;
  if (mph >= 70) return 0.45;
  if (mph >= 58) return 0.25;
  return 0.08;
}

/** Filing windows close: most policies 1 yr, Texas suits 2 yrs (docs §2.3). */
export function recencyWeight(months: number): number {
  if (months < 0) return 0;
  if (months <= 12) return 1.0;
  if (months <= 18) return 0.75;
  if (months <= LOOKBACK_MONTHS) return 0.45;
  return 0;
}

/** Roof-age factor from the tract's median year built (docs §2.4). */
export function roofAgeFactor(medianYearBuilt: number | null, nowYear: number): number {
  if (medianYearBuilt == null) return 0.85;
  const age = nowYear - medianYearBuilt;
  if (age <= 8) return 0.4;
  if (age <= 18) return 0.8;
  if (age <= 36) return 1.0;
  if (age <= 56) return 0.9;
  return 0.75;
}

export function ownerOccupiedFactor(share: number | null): number {
  return 0.4 + 0.6 * (share ?? 0.65);
}

export function singleFamilyFactor(share: number | null): number {
  return 0.3 + 0.7 * (share ?? 0.62);
}

/** Within 25 mi costs nothing; a 100-mi drive is a committed day. */
export function accessFactor(distanceMiles: number): number {
  if (distanceMiles <= 25) return 1.0;
  const t = Math.min(1, (distanceMiles - 25) / (SEARCH_RADIUS_MILES - 25));
  return 1.0 - 0.4 * t;
}

/** Diminishing returns on ground already covered in the last 60 days. */
export function canvassedFactor(recentKnocks: number): number {
  if (recentKnocks <= 0) return 1.0;
  return Math.max(0.7, 1.0 - 0.0075 * recentKnocks);
}

export function ownJobsFactor(jobs: number): number {
  return jobs > 0 ? 1.05 : 1.0;
}

/** 0–100 from summed exposure — saturating so one huge storm cannot dwarf the field. */
export function stormScoreFromExposure(exposure: number): number {
  return Math.round(100 * (1 - Math.exp(-exposure / STORM_SATURATION)));
}

/** National ACS 5-year priors used when tract data is unavailable (docs §2.4). */
export const NATIONAL_HOUSING_PRIOR: HousingProfile = {
  source: 'national_prior',
  medianYearBuilt: 1980,
  ownerOccupiedShare: 0.65,
  singleFamilyShare: 0.62,
  housingUnits: null,
  unitsPerSqMi: null,
};

export function susceptibilityScore(h: HousingProfile, nowYear: number): number {
  return Math.round(
    100 *
      roofAgeFactor(h.medianYearBuilt, nowYear) *
      ownerOccupiedFactor(h.ownerOccupiedShare) *
      singleFamilyFactor(h.singleFamilyShare),
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

const MILES_PER_DEG_LAT = 69.0;

export type CellRef = { row: number; col: number; key: string };

export function cellSize(baseLat: number): { dLat: number; dLng: number } {
  const dLat = CELL_MILES / MILES_PER_DEG_LAT;
  const dLng = CELL_MILES / (MILES_PER_DEG_LAT * Math.max(0.2, Math.cos((baseLat * Math.PI) / 180)));
  return { dLat, dLng };
}

export function cellFor(lat: number, lng: number, baseLat: number): CellRef {
  const { dLat, dLng } = cellSize(baseLat);
  const row = Math.floor(lat / dLat);
  const col = Math.floor(lng / dLng);
  return { row, col, key: `${row}:${col}` };
}

export function cellCenter(ref: Pick<CellRef, 'row' | 'col'>, baseLat: number): { lat: number; lng: number } {
  const { dLat, dLng } = cellSize(baseLat);
  return { lat: (ref.row + 0.5) * dLat, lng: (ref.col + 0.5) * dLng };
}

function utcDayKey(iso: string): string | null {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return null;
  return t.toISOString().slice(0, 10);
}

type DayAcc = {
  day: string;
  reports: number;
  maxHail: number | null;
  maxWind: number | null;
  spread: number;
  weight: number; // best single-report weight that day
  towns: Map<string, number>;
  latestMs: number;
};

type CellAcc = {
  ref: CellRef;
  days: Map<string, DayAcc>;
  hail: number;
  wind: number;
  direct: boolean;
  towns: Map<string, number>;
};

function titleCase(s: string): string {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * IEM's `city` is the LSR location string — "2 S SAINT PAUL", "1 SW GRAPEVINE"
 * — an offset from a town, not the town. The report's coordinates already
 * place it; the roofer needs the town.
 */
export function cleanTown(raw: string): string {
  return titleCase(raw.trim().replace(/^\d+(\.\d+)?\s+[NSEW]{1,3}\s+/i, ''));
}

function topTown(towns: Map<string, number>): string | undefined {
  let best: string | undefined;
  let n = 0;
  for (const [t, c] of towns) {
    if (c > n) {
      best = t;
      n = c;
    }
  }
  return best;
}

/**
 * Pure: bucket every report into its cell (weight 1) and the 8 neighbours
 * (ADJACENT_SPREAD) and reduce each cell to its StormEvidence.
 */
export function stormEvidenceByCell(
  events: readonly StormEvent[],
  base: { lat: number; lng: number },
  now: Date,
): Map<string, { ref: CellRef; evidence: StormEvidence }> {
  const cells = new Map<string, CellAcc>();
  const nowMs = now.getTime();

  const touch = (ref: CellRef) => {
    let c = cells.get(ref.key);
    if (!c) {
      c = { ref, days: new Map(), hail: 0, wind: 0, direct: false, towns: new Map() };
      cells.set(ref.key, c);
    }
    return c;
  };

  for (const e of events) {
    const day = utcDayKey(e.occurredAt);
    if (!day) continue;
    const ageMonths = (nowMs - new Date(e.occurredAt).getTime()) / MONTH_MS;
    if (ageMonths < 0 || ageMonths > LOOKBACK_MONTHS) continue;
    const w = e.type === 'hail' ? hailWeight(e.magnitude) : windWeight(e.magnitude);
    const home = cellFor(e.lat, e.lon, base.lat);
    for (let dr = -1; dr <= 1; dr += 1) {
      for (let dc = -1; dc <= 1; dc += 1) {
        const isHome = dr === 0 && dc === 0;
        const ref: CellRef = { row: home.row + dr, col: home.col + dc, key: `${home.row + dr}:${home.col + dc}` };
        const c = touch(ref);
        const spread = isHome ? 1 : ADJACENT_SPREAD;
        let d = c.days.get(day);
        if (!d) {
          d = { day, reports: 0, maxHail: null, maxWind: null, spread: 0, weight: 0, towns: new Map(), latestMs: 0 };
          c.days.set(day, d);
        }
        d.reports += 1;
        d.spread = Math.max(d.spread, spread);
        d.weight = Math.max(d.weight, w * spread);
        d.latestMs = Math.max(d.latestMs, new Date(e.occurredAt).getTime());
        if (e.type === 'hail' && e.magnitude != null) d.maxHail = Math.max(d.maxHail ?? 0, e.magnitude);
        if (e.type === 'wind' && e.magnitude != null) d.maxWind = Math.max(d.maxWind ?? 0, e.magnitude);
        if (e.city) {
          const t = cleanTown(e.city);
          d.towns.set(t, (d.towns.get(t) ?? 0) + (isHome ? 2 : 1));
          c.towns.set(t, (c.towns.get(t) ?? 0) + (isHome ? 2 : 1));
        }
        if (isHome) {
          c.direct = true;
          if (e.type === 'hail') c.hail += 1;
          else c.wind += 1;
        }
      }
    }
  }

  const out = new Map<string, { ref: CellRef; evidence: StormEvidence }>();
  for (const c of cells.values()) {
    let exposure = 0;
    let maxHail: number | null = null;
    let maxWind: number | null = null;
    let strongest: { day: StormDaySummary; contribution: number } | null = null;
    const days: StormDaySummary[] = [];
    for (const d of c.days.values()) {
      const months = (nowMs - d.latestMs) / MONTH_MS;
      // Several reports on one day are one storm: the best report carries it,
      // extra reports add a little confidence and cap at +90%.
      const contribution = d.weight * (1 + 0.15 * Math.min(d.reports - 1, 6)) * recencyWeight(months);
      exposure += contribution;
      if (d.maxHail != null) maxHail = Math.max(maxHail ?? 0, d.maxHail);
      if (d.maxWind != null) maxWind = Math.max(maxWind ?? 0, d.maxWind);
      const summary: StormDaySummary = {
        day: d.day,
        reports: d.reports,
        maxHailInches: d.maxHail,
        maxWindMph: d.maxWind,
        spread: d.spread,
        town: topTown(d.towns),
      };
      days.push(summary);
      if (!strongest || contribution > strongest.contribution) strongest = { day: summary, contribution };
    }
    days.sort((a, b) => (a.day < b.day ? 1 : -1));
    const strongestMs = strongest ? new Date(`${strongest.day.day}T12:00:00Z`).getTime() : null;
    out.set(c.ref.key, {
      ref: c.ref,
      evidence: {
        hailReports: c.hail,
        windReports: c.wind,
        maxHailInches: maxHail,
        maxWindMph: maxWind,
        strongest: strongest?.day ?? null,
        monthsSinceStrongest: strongestMs == null ? null : Math.max(0, (nowMs - strongestMs) / MONTH_MS),
        days,
        direct: c.direct,
        exposure,
        stormScore: stormScoreFromExposure(exposure),
        town: topTown(c.towns),
      },
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Hit rate — binomial statements (docs §4)
// ---------------------------------------------------------------------------

/** Base per-roof probability of claim-grade damage by the area's worst hail. */
export function baseHitProbability(s: Pick<StormEvidence, 'maxHailInches' | 'maxWindMph' | 'hailReports' | 'windReports'>): number {
  const h = s.maxHailInches;
  if (h != null) {
    if (h >= 2.0) return 0.65;
    if (h >= 1.5) return 0.5;
    if (h >= 1.25) return 0.35;
    if (h >= 1.0) return 0.22;
    if (h >= 0.75) return 0.1;
    return 0.03;
  }
  if (s.hailReports > 0) return 0.1; // hail reported, size unknown
  const w = s.maxWindMph;
  if (w != null) {
    if (w >= 86) return 0.16;
    if (w >= 70) return 0.1;
    return 0.06;
  }
  return s.windReports > 0 ? 0.06 : 0.01;
}

/** Roofs already replaced since the storm: the market moves (docs §4.2). */
export function remainingFactor(monthsSinceStrongest: number | null): number {
  if (monthsSinceStrongest == null) return 0.75;
  return Math.max(0.5, 1 - 0.5 * (monthsSinceStrongest / LOOKBACK_MONTHS));
}

export function roofHitProbability(storm: StormEvidence, housing: HousingProfile, nowYear: number): number {
  const p =
    baseHitProbability(storm) *
    roofAgeFactor(housing.medianYearBuilt, nowYear) *
    (storm.direct ? 1 : 0.6) *
    remainingFactor(storm.monthsSinceStrongest);
  return Math.min(0.75, Math.max(0.01, p));
}

function logChoose(n: number, k: number): number {
  let r = 0;
  for (let i = 1; i <= k; i += 1) r += Math.log(n - k + i) - Math.log(i);
  return r;
}

/** P(X ≥ k) for X ~ Binomial(n, p). */
export function binomialAtLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  let tail = 0;
  for (let i = k; i <= n; i += 1) {
    tail += Math.exp(logChoose(n, i) + i * Math.log(p) + (n - i) * Math.log(1 - p));
  }
  return Math.min(1, tail);
}

/** Largest m with P(X ≥ m) ≥ conf. */
export function atLeastWithConfidence(n: number, p: number, conf = CONFIDENCE): number {
  let m = 0;
  for (let k = 1; k <= n; k += 1) {
    if (binomialAtLeast(n, p, k) >= conf) m = k;
    else break;
  }
  return m;
}

/** Smallest n (≤ 600) with P(X ≥ k) ≥ conf; null when it would take more. */
export function doorsToFind(k: number, p: number, conf = CONFIDENCE): number | null {
  for (let n = k; n <= 600; n += 1) {
    if (binomialAtLeast(n, p, k) >= conf) return n;
  }
  return null;
}

export function hitRateFor(perRoof: number, doors = DOORS_PER_STOP): HitRate {
  return {
    perRoof,
    doors,
    expected: Math.round(perRoof * doors * 10) / 10,
    atLeast: atLeastWithConfidence(doors, perRoof),
    confidence: CONFIDENCE,
    target: TARGET_FINDS,
    pAtLeastTarget: binomialAtLeast(doors, perRoof, TARGET_FINDS),
    doorsForTarget: doorsToFind(TARGET_FINDS, perRoof),
  };
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/** The per-roof probability's ceiling (roofHitProbability clamps here). */
const P_MAX = 0.75;

/**
 * Knock Score (docs §2.6). Leads with the per-roof probability — in hail
 * alley every cell has been hit several times and the saturating storm
 * score reads 85–95 everywhere; what separates a great street from a fair
 * one is the worst hail and how long ago (p), then how broad the exposure
 * was, then the housing. Access, ground already covered and own jobs
 * multiply. Weighted geometric mean: no storm → no lead.
 */
export function knockScoreFrom(f: ScoreFactors, perRoof: number): number {
  const score =
    100 *
    Math.pow(Math.min(1, perRoof / P_MAX), 0.45) *
    Math.pow(f.storm, 0.25) *
    Math.pow(f.housing, 0.3) *
    f.access *
    f.canvassed *
    f.ownJobs;
  return Math.max(0, Math.min(100, Math.round(score)));
}

export type RankInput = {
  base: BasePoint;
  now: Date;
  events: readonly StormEvent[];
  own?: OwnActivity;
  /** Housing profile per cell key; missing keys use the national prior. */
  housing?: ReadonlyMap<string, HousingProfile>;
  limit?: number;
};

function monthsAgo(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / MONTH_MS;
}

function fmtDay(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

function ago(months: number): string {
  if (months < 1) return 'this month';
  const m = Math.round(months);
  if (m < 12) return `${m} month${m === 1 ? '' : 's'} ago`;
  const y = Math.floor(m / 12);
  const rem = m % 12;
  return rem === 0 ? `${y} year${y === 1 ? '' : 's'} ago` : `${y} yr ${rem} mo ago`;
}

function pct(x: number | null): string {
  return x == null ? '—' : `${Math.round(x * 100)}%`;
}

/** The rule-based rationale: exactly the facts the score used, in words. */
export function ruleRationale(a: Omit<ScoredArea, 'reasons'>, now: Date): string[] {
  const r: string[] = [];
  const s = a.storm;
  if (s.strongest) {
    const d = s.strongest;
    const what =
      d.maxHailInches != null
        ? `${d.maxHailInches.toFixed(2)}" hail`
        : d.maxWindMph != null
          ? `${Math.round(d.maxWindMph)} mph wind`
          : s.hailReports > 0
            ? 'hail (size not reported)'
            : 'damaging wind';
    const where = d.spread >= 1 ? 'in this area' : 'in the next area over';
    r.push(
      `${what} on ${fmtDay(d.day)} (${ago(s.monthsSinceStrongest ?? 0)}) — ${d.reports} NWS report${d.reports === 1 ? '' : 's'} ${where}.`,
    );
  }
  const other = s.days.filter((d) => d !== s.strongest && (d.maxHailInches ?? 0) >= 0.75).slice(0, 2);
  for (const d of other) {
    r.push(`Also ${d.maxHailInches!.toFixed(2)}" hail on ${fmtDay(d.day)} (${ago(monthsAgo(`${d.day}T12:00:00Z`, now))}).`);
  }
  if (s.monthsSinceStrongest != null && s.monthsSinceStrongest > 12) {
    r.push('Over a year since the big storm — expect some roofs already replaced and 1-year filing windows closing.');
  }
  const h = a.housing;
  if (h.source === 'acs') {
    if (h.medianYearBuilt != null) {
      const age = now.getFullYear() - h.medianYearBuilt;
      r.push(
        `Homes built around ${h.medianYearBuilt} (median) — roofs about ${age} yrs old${
          age >= 19 && age <= 36 ? ', the window carriers replace most' : age <= 8 ? ' — mostly new roofs' : ''
        }.`,
      );
    }
    r.push(
      `${pct(h.ownerOccupiedShare)} owner-occupied · ${pct(h.singleFamilyShare)} single-family${
        h.unitsPerSqMi != null ? ` · ~${Math.round(h.unitsPerSqMi)} homes/sq mi` : ''
      }${h.tractName ? ` (${h.tractName})` : ''}.`,
    );
  } else {
    r.push(`Housing stock unknown for this area${h.priorReason ? ` (${h.priorReason})` : ''} — national averages assumed.`);
  }
  r.push(`${Math.round(a.distanceMiles)} mi ${a.bearing} of base — about ${Math.round(a.driveMinutes)} min drive.`);
  if (a.recentKnocks > 0) r.push(`You knocked ${a.recentKnocks} door${a.recentKnocks === 1 ? '' : 's'} here in the last 60 days.`);
  if (a.ownJobs > 0) r.push(`${a.ownJobs} of your job${a.ownJobs === 1 ? ' is' : 's are'} here — a yard sign and a referral base.`);
  const hr = a.hitRate;
  r.push(
    `Knock ${hr.doors} doors: expect ~${Math.round(hr.expected)} claim-grade roofs, at least ${hr.atLeast} (${Math.round(
      hr.confidence * 100,
    )}% confidence); ${Math.round(hr.pAtLeastTarget * 100)}% chance of ${hr.target}+.`,
  );
  return r;
}

export function rankAreas(input: RankInput): ScoredArea[] {
  const { base, now, events } = input;
  const nowYear = now.getFullYear();
  const cells = stormEvidenceByCell(events, base, now);
  const sixtyDaysAgo = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  const own = input.own ?? { knocks: [], jobs: [] };

  const scored: ScoredArea[] = [];
  for (const { ref, evidence } of cells.values()) {
    if (evidence.exposure <= 0) continue;
    // Only cells a report actually landed in are ranked. Neighbour spread
    // still lifts a hit cell that sits inside a wider swath, but a halo of
    // eight report-less cells around every storm would crowd the list with
    // nine cards all named after the same town — and the 3-mi canvass
    // radius already reaches into them from the hit cell.
    if (!evidence.direct) continue;
    const center = cellCenter(ref, base.lat);
    const distanceMiles = haversineMilesBetween(base.lat, base.lng, center.lat, center.lng);
    if (distanceMiles > SEARCH_RADIUS_MILES) continue;

    const housing = input.housing?.get(ref.key) ?? NATIONAL_HOUSING_PRIOR;
    const susceptibility = susceptibilityScore(housing, nowYear);
    const recentKnocks = own.knocks.filter(
      (k) => new Date(k.at).getTime() >= sixtyDaysAgo && cellFor(k.lat, k.lng, base.lat).key === ref.key,
    ).length;
    const ownJobs = own.jobs.filter((j) => cellFor(j.lat, j.lng, base.lat).key === ref.key).length;

    const factors: ScoreFactors = {
      storm: evidence.stormScore / 100,
      housing: susceptibility / 100,
      access: accessFactor(distanceMiles),
      canvassed: canvassedFactor(recentKnocks),
      ownJobs: ownJobsFactor(ownJobs),
    };
    const perRoof = roofHitProbability(evidence, housing, nowYear);
    const knockScore = knockScoreFrom(factors, perRoof);
    const partial: Omit<ScoredArea, 'reasons'> = {
      key: ref.key,
      lat: center.lat,
      lng: center.lng,
      distanceMiles,
      bearing: bearingBetween(base.lat, base.lng, center.lat, center.lng),
      driveMinutes: (distanceMiles / DRIVE_MPH) * 60 + 5,
      storm: evidence,
      housing,
      susceptibility,
      factors,
      knockScore,
      hitRate: hitRateFor(perRoof),
      ownJobs,
      recentKnocks,
    };
    scored.push({ ...partial, reasons: ruleRationale(partial, now) });
  }

  // Ties (one storm across several cells) go to the nearer cell.
  scored.sort(
    (a, b) => b.knockScore - a.knockScore || b.hitRate.perRoof - a.hitRate.perRoof || a.distanceMiles - b.distanceMiles,
  );
  return scored.slice(0, input.limit ?? MAX_AREAS);
}

/** Re-score already-ranked areas with housing profiles that arrived later. */
export function applyHousing(
  areas: readonly ScoredArea[],
  housing: ReadonlyMap<string, HousingProfile>,
  now: Date,
): ScoredArea[] {
  const nowYear = now.getFullYear();
  return areas
    .map((a) => {
      const h = housing.get(a.key);
      if (!h) return a;
      const susceptibility = susceptibilityScore(h, nowYear);
      const factors = { ...a.factors, housing: susceptibility / 100 };
      const perRoof = roofHitProbability(a.storm, h, nowYear);
      const knockScore = knockScoreFrom(factors, perRoof);
      const partial: Omit<ScoredArea, 'reasons'> = {
        ...a,
        housing: h,
        susceptibility,
        factors,
        knockScore,
        hitRate: hitRateFor(perRoof),
      };
      return { ...partial, reasons: ruleRationale(partial, now) };
    })
    .sort(
      (a, b) => b.knockScore - a.knockScore || b.hitRate.perRoof - a.hitRate.perRoof || a.distanceMiles - b.distanceMiles,
    );
}

// ---------------------------------------------------------------------------
// Trip plan (docs §5)
// ---------------------------------------------------------------------------

export function planTrip(areas: readonly ScoredArea[], base: BasePoint, opts: { doorsPerStop?: number } = {}): TripPlan {
  const doors = opts.doorsPerStop ?? DOORS_PER_STOP;
  const workMinutes = (doors / DOORS_PER_HOUR) * 60;
  const remaining = [...areas];
  const days: TripDay[] = [];
  let cursor = { lat: base.lat, lng: base.lng };

  while (remaining.length > 0 && days.length < MAX_PLAN_DAYS) {
    const day: TripDay = { day: days.length + 1, stops: [], totalMiles: 0, totalMinutes: 0, expected: 0, atLeast: 0 };
    cursor = { lat: base.lat, lng: base.lng };
    // Greedy nearest-next: good enough for ≤10 stops, and predictable.
    while (remaining.length > 0) {
      let bestIdx = 0;
      let bestMiles = Infinity;
      remaining.forEach((a, i) => {
        const m = haversineMilesBetween(cursor.lat, cursor.lng, a.lat, a.lng);
        if (m < bestMiles) {
          bestMiles = m;
          bestIdx = i;
        }
      });
      const driveMinutes = (bestMiles / DRIVE_MPH) * 60 + 5;
      const homeMiles = haversineMilesBetween(remaining[bestIdx].lat, remaining[bestIdx].lng, base.lat, base.lng);
      const homeMinutes = (homeMiles / DRIVE_MPH) * 60;
      // The day must still get the roofer home.
      if (day.stops.length > 0 && day.totalMinutes + driveMinutes + workMinutes + homeMinutes > DAY_MINUTES) break;
      const area = remaining.splice(bestIdx, 1)[0];
      const hr = doors === area.hitRate.doors ? area.hitRate : hitRateFor(area.hitRate.perRoof, doors);
      const stop: TripStop = {
        area,
        driveMiles: bestMiles,
        driveMinutes,
        startMinute: day.totalMinutes + driveMinutes,
        doors,
        workMinutes,
        expected: hr.expected,
        atLeast: hr.atLeast,
      };
      day.stops.push(stop);
      day.totalMiles += bestMiles;
      day.totalMinutes += driveMinutes + workMinutes;
      day.expected += hr.expected;
      day.atLeast += hr.atLeast;
      cursor = { lat: area.lat, lng: area.lng };
    }
    if (day.stops.length === 0) break;
    days.push(day);
  }

  return {
    days,
    totalMiles: days.reduce((t, d) => t + d.totalMiles, 0),
    totalMinutes: days.reduce((t, d) => t + d.totalMinutes, 0),
    totalDoors: days.reduce((t, d) => t + d.stops.length * doors, 0),
    expected: Math.round(days.reduce((t, d) => t + d.expected, 0) * 10) / 10,
    atLeast: days.reduce((t, d) => t + d.atLeast, 0),
    unplanned: remaining,
  };
}

/** "8:00 AM" for a minute offset from an 8 AM start. */
export function clockFromStart(minute: number, startHour = 8): string {
  const total = startHour * 60 + Math.round(minute);
  const h24 = Math.floor(total / 60) % 24;
  const m = total % 60;
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, '0')} ${h24 < 12 ? 'AM' : 'PM'}`;
}

export function fmtMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return rem === 0 ? `${h} h` : `${h} h ${rem} min`;
}
