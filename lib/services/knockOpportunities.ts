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
import {
  DEFAULT_BASE_RATES,
  NO_EVIDENCE_BASE_RATE,
  calibratedBaseRate,
  hailClassOf,
  type AreaCalibration,
  type CalibratedRates,
} from './knockCalibration';

// ---------------------------------------------------------------------------
// Constants (see docs/KNOCK_OPPORTUNITIES.md §2 for provenance)
// ---------------------------------------------------------------------------

/**
 * How far from base the finder looks — the roofer picks it (owner: "toggle
 * the mileage from 0–50 miles"). One cell is the floor; 50 is a full day out
 * and back. The default is a morning's drive.
 */
export const DEFAULT_SEARCH_RADIUS_MILES = 25;
export const MIN_SEARCH_RADIUS_MILES = 3;
export const MAX_SEARCH_RADIUS_MILES = 50;
/** Legacy alias of the default — older call sites read it as "the radius". */
export const SEARCH_RADIUS_MILES = DEFAULT_SEARCH_RADIUS_MILES;

/** The radius the finder will actually use for a requested value. */
export function clampRadiusMiles(radiusMiles: number | null | undefined): number {
  if (radiusMiles == null || !Number.isFinite(radiusMiles)) return DEFAULT_SEARCH_RADIUS_MILES;
  return Math.min(MAX_SEARCH_RADIUS_MILES, Math.max(MIN_SEARCH_RADIUS_MILES, Math.round(radiusMiles)));
}
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
/**
 * Neighbours mode: a cell with one of the roofer's jobs and no storm on file
 * still scores — the storm factor floors here so the weighted geometric mean
 * does not zero a referral street. 0.1 keeps it under every real storm cell.
 */
export const NEIGHBOUR_STORM_FLOOR = 0.1;
/** Known new roofs (docs §4.5): fewer than this many records in a cell says nothing. */
export const MIN_KNOWN_ROOFS = 3;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BasePoint = { lat: number; lng: number; label: string };

/**
 * 'storm'      — rank every cell a storm report landed in (the default).
 * 'neighbours' — rank the cells the roofer's own jobs sit in: lead with the
 *                yard sign, and score with the same storm evidence when there
 *                is any (a signed job in a hail cell is the best street in
 *                the county).
 */
export type FinderMode = 'storm' | 'neighbours';

export type OwnJob = {
  lat: number;
  lng: number;
  /** Pipeline stage of the linked lead, when there is one. */
  stage?: string;
  /** A signed proposal, a homeowner signature, or a lead at/after Approved / Signed. */
  signed?: boolean;
  address?: string;
  customerName?: string;
  /** ISO — when the job was created; the card says "(Jun)". */
  at?: string;
};

export type OwnActivity = {
  /** The roofer's knocks (any outcome) — recent ones lower the score. */
  knocks: { lat: number; lng: number; at: string }[];
  /** The roofer's jobs — a yard sign and a referral base. */
  jobs: OwnJob[];
};

/**
 * A house whose roof year the app knows from a cached Zillow record — a stated
 * "new roof 2021", a listing that says "new roof" (dated to the listing), or
 * a build year after the storm. `roofYear` is a LOWER bound on the roof's
 * year: the roof is at least that new.
 */
export type KnownRoof = { lat: number; lng: number; roofYear: number };

export type NewRoofSummary = {
  /** Cached records with a known roof year inside the cell. */
  known: number;
  /** Of those, roofs at least as new as the strongest storm. */
  newSinceStorm: number;
  /** newSinceStorm ÷ known, 0 when fewer than MIN_KNOWN_ROOFS. */
  share: number;
  /** 1 − 0.8 × share; 1 when the sample is too thin to say. */
  factor: number;
};

/** The job a neighbours-mode card leads with. */
export type AnchorJob = {
  address?: string;
  /** "1420 Oak St" — the first line of the address. */
  street?: string;
  customerName?: string;
  at?: string;
  signed: boolean;
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
  /** ZIP of the cell centre (reverse geocode) — the key for "homes recently sold here". */
  zip?: string;
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
  /**
   * Which base rate the per-roof p started from — the table or the roofer's
   * own calibrated rate — so the card can say "Your data: 0.58 (123 doors)
   * vs table 0.65". Absent on plans made before calibration existed.
   */
  calibration?: AreaCalibration;
  /** Known new roofs in the cell from cached Zillow records (docs §4.5). Absent when none are cached. */
  newRoofs?: NewRoofSummary;
  /** Neighbours mode: how many of the roofer's jobs here are signed. */
  ownSignedJobs?: number;
  /** Neighbours mode: the job the card leads with (signed first, then newest). */
  anchorJob?: AnchorJob;
  /** Absent on plans made before neighbours mode existed → 'storm'. */
  mode?: FinderMode;
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

/**
 * Drive cost inside the radius the roofer chose: the nearest quarter of it
 * costs nothing; the edge costs 40 %. Scales with the radius so "nearer is
 * better" holds whether the dial says 10 mi or 50 (docs §2.5).
 */
export function accessFactor(distanceMiles: number, radiusMiles: number = DEFAULT_SEARCH_RADIUS_MILES): number {
  const r = Math.max(MIN_SEARCH_RADIUS_MILES, radiusMiles);
  const free = r / 4;
  if (distanceMiles <= free) return 1.0;
  const t = Math.min(1, (distanceMiles - free) / (r - free));
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

/**
 * Neighbours mode leads with the referral: a signed job in the cell is a
 * yard sign and a homeowner who will vouch (×1.6); any job is a truck the
 * street has seen (×1.25). Replaces `ownJobsFactor` in that mode (docs §2.7).
 */
export function referralFactor(signedJobs: number, anyJobs: number): number {
  if (signedJobs > 0) return 1.6;
  if (anyJobs > 0) return 1.25;
  return 1.0;
}

/**
 * Known new roofs (docs §4.5): a roof at least as new as the strongest storm
 * is not a claim candidate. With a share s of the cell's known roofs new
 * since the storm, p is scaled by 1 − 0.8·s — never to zero, because the
 * sample is a handful of listings, not the street.
 */
export function newRoofFactor(newRoofShare: number): number {
  const s = Math.min(1, Math.max(0, newRoofShare));
  return 1 - 0.8 * s;
}

/** Year of a YYYY-MM-DD storm day, or null. */
export function stormYearOf(storm: Pick<StormEvidence, 'strongest'>): number | null {
  const d = storm.strongest?.day;
  if (!d) return null;
  const y = Number(d.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

/** New-roof share of a cell from the cached records inside it. Pure. */
export function newRoofSummary(roofs: readonly KnownRoof[], stormYear: number | null): NewRoofSummary {
  const known = roofs.length;
  if (known < MIN_KNOWN_ROOFS || stormYear == null) return { known, newSinceStorm: 0, share: 0, factor: 1 };
  const newSinceStorm = roofs.filter((r) => r.roofYear >= stormYear).length;
  const share = newSinceStorm / known;
  return { known, newSinceStorm, share, factor: newRoofFactor(share) };
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

/**
 * Base per-roof probability of claim-grade damage by the area's worst hail —
 * the §4.1 table (`DEFAULT_BASE_RATES`, bucketed by `hailClassOf` so the
 * calibration and the formula can never disagree on a class).
 */
export function baseHitProbability(s: Pick<StormEvidence, 'maxHailInches' | 'maxWindMph' | 'hailReports' | 'windReports'>): number {
  const c = hailClassOf(s);
  return c ? DEFAULT_BASE_RATES[c] : NO_EVIDENCE_BASE_RATE;
}

/** Roofs already replaced since the storm: the market moves (docs §4.2). */
export function remainingFactor(monthsSinceStrongest: number | null): number {
  if (monthsSinceStrongest == null) return 0.75;
  return Math.max(0.5, 1 - 0.5 * (monthsSinceStrongest / LOOKBACK_MONTHS));
}

/**
 * The street's modifier on the base rate: roof age, whether a report landed
 * in the cell, roofs already replaced, and known new roofs. Exposed so the
 * calibration can weigh doors by it (docs §8).
 */
export function hitModifier(storm: StormEvidence, housing: HousingProfile, nowYear: number, newRoofShare = 0): number {
  return roofAgeFactor(housing.medianYearBuilt, nowYear) * (storm.direct ? 1 : 0.6) * remainingFactor(storm.monthsSinceStrongest) * newRoofFactor(newRoofShare);
}

/**
 * Per-roof probability (docs §4.1). With a calibration the base rate is the
 * roofer's own posterior for the cell's hail class instead of the table;
 * `newRoofShare` is the cell's share of cached records with a roof at least
 * as new as the storm (0 when unknown).
 */
export function roofHitProbability(
  storm: StormEvidence,
  housing: HousingProfile,
  nowYear: number,
  calibration?: CalibratedRates | null,
  newRoofShare = 0,
): number {
  const base = calibration ? calibratedBaseRate(storm, calibration).usedRate : baseHitProbability(storm);
  const p = base * hitModifier(storm, housing, nowYear, newRoofShare);
  return Math.min(0.75, Math.max(0.01, p));
}

/**
 * P(X ≥ k) for X ~ Binomial(n, p). One running log-binomial term walked from
 * the short side of k — the lower tail Σ_{i<k} when k is small (the usual
 * "at least 5" question costs five terms whatever n is), the upper tail
 * otherwise. The earlier version rebuilt log C(n, i) from scratch for every
 * term (O(n²) per call); with `doorsToFind` walking n to 600 for every one of
 * ~1,000 cells that was the seconds-long freeze in the Knock Planner.
 */
export function binomialAtLeast(n: number, p: number, k: number): number {
  if (k <= 0) return 1;
  if (k > n) return 0;
  if (p <= 0) return 0;
  if (p >= 1) return 1;
  const logP = Math.log(p);
  const logQ = Math.log(1 - p);
  if (k <= n / 2) {
    // 1 − P(X < k): start at P(X = 0) = q^n and step up in log space.
    let logTerm = n * logQ;
    let lower = 0;
    for (let i = 0; i < k; i += 1) {
      lower += Math.exp(logTerm);
      logTerm += Math.log(n - i) - Math.log(i + 1) + logP - logQ;
    }
    return Math.max(0, Math.min(1, 1 - lower));
  }
  // Upper tail: start at P(X = k) and step up.
  let logTerm = k * logP + (n - k) * logQ;
  for (let i = 1; i <= k; i += 1) logTerm += Math.log(n - k + i) - Math.log(i);
  let tail = 0;
  for (let i = k; i <= n; i += 1) {
    tail += Math.exp(logTerm);
    logTerm += Math.log(n - i) - Math.log(i + 1) + logP - logQ;
  }
  return Math.max(0, Math.min(1, tail));
}

/** Largest m with P(X ≥ m) ≥ conf — binary search on the decreasing tail. */
export function atLeastWithConfidence(n: number, p: number, conf = CONFIDENCE): number {
  let lo = 0; // P(X ≥ 0) = 1 ≥ conf always
  let hi = n + 1; // P(X ≥ n + 1) = 0 < conf
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (binomialAtLeast(n, p, mid) >= conf) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** The search cap for "doors for 5" — beyond this the answer is "not on this street". */
export const DOORS_SEARCH_CAP = 600;

const doorsMemo = new Map<string, number | null>();

/**
 * Smallest n (≤ DOORS_SEARCH_CAP) with P(X ≥ k) ≥ conf; null when it would
 * take more. P(X ≥ k) rises with n, so this is an exponential probe then a
 * binary search (~12 evaluations of a k-term sum). Memoised by p to three
 * decimals — a planner run only ever sees a few hundred distinct values.
 */
export function doorsToFind(k: number, p: number, conf = CONFIDENCE): number | null {
  const key = `${k}:${p.toFixed(3)}:${conf}`;
  const hit = doorsMemo.get(key);
  if (hit !== undefined) return hit;
  let out: number | null;
  if (binomialAtLeast(DOORS_SEARCH_CAP, p, k) < conf) {
    out = null;
  } else {
    let lo = k - 1; // fails (P(X ≥ k) over k−1 doors is 0)
    let hi = k;
    while (hi < DOORS_SEARCH_CAP && binomialAtLeast(hi, p, k) < conf) {
      lo = hi;
      hi = Math.min(DOORS_SEARCH_CAP, hi * 2);
    }
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (binomialAtLeast(mid, p, k) >= conf) hi = mid;
      else lo = mid;
    }
    out = hi;
  }
  if (doorsMemo.size > 5000) doorsMemo.clear();
  doorsMemo.set(key, out);
  return out;
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
  /** Default 'storm'. */
  mode?: FinderMode;
  /** The roofer's calibrated base rates (docs §8); null/absent → the table. */
  calibration?: CalibratedRates | null;
  /** Cached Zillow records with a known roof year — the known-new-roofs factor (docs §4.5). */
  knownRoofs?: readonly KnownRoof[];
  /** Search radius from base; clamped to [MIN, MAX], default DEFAULT_SEARCH_RADIUS_MILES. */
  radiusMiles?: number;
};

/** A cell with no report in it or next to it — neighbours mode only. */
export const EMPTY_EVIDENCE: StormEvidence = {
  hailReports: 0,
  windReports: 0,
  maxHailInches: null,
  maxWindMph: null,
  strongest: null,
  monthsSinceStrongest: null,
  days: [],
  direct: false,
  exposure: 0,
  stormScore: 0,
};

/** "1420 Oak St, Plano, TX 75024, USA" → "1420 Oak St". */
export function streetOf(address: string | undefined): string | undefined {
  const s = address?.split(',')[0]?.trim();
  return s && s.length > 0 ? s : undefined;
}

/** "1420 Oak St, Plano, TX 75024, USA" → "Plano". */
export function cityOf(address: string | undefined): string | undefined {
  const parts = (address ?? '').split(',').map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return undefined;
  const c = parts[1];
  return /^[A-Z]{2}\b/.test(c) ? undefined : c;
}

function monthName(iso: string | undefined): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-US', { month: 'short' });
}

/** The job a neighbours card leads with: signed first, then the newest. Pure. */
export function anchorJobOf(jobs: readonly OwnJob[]): AnchorJob | undefined {
  if (jobs.length === 0) return undefined;
  const sorted = [...jobs].sort((a, b) => Number(!!b.signed) - Number(!!a.signed) || (b.at ?? '').localeCompare(a.at ?? ''));
  const j = sorted[0];
  return { address: j.address, street: streetOf(j.address), customerName: j.customerName, at: j.at, signed: !!j.signed };
}

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
  if (a.mode === 'neighbours') {
    const j = a.anchorJob;
    const signed = a.ownSignedJobs ?? 0;
    if (j) {
      const when = monthName(j.at);
      const where = j.street ? ` at ${j.street}` : '';
      r.push(
        j.signed
          ? `Your signed job${where}${when ? ` (${when})` : ''} — lead with the yard sign and the neighbour who can vouch for you.`
          : `Your job${where}${when ? ` (${when})` : ''} — a street that has seen your truck.`,
      );
    }
    if (a.ownJobs > 1) {
      r.push(`${a.ownJobs} of your jobs are here${signed > 0 ? ` (${signed} signed)` : ''}.`);
    }
    if (!s.strongest) {
      r.push(`No NWS hail or wind report on file here in the last ${LOOKBACK_MONTHS} months — a referral street, not a claim street. Look for soft-metal dents before promising a claim.`);
    }
  }
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
  if (a.mode !== 'neighbours' && a.ownJobs > 0) {
    r.push(`${a.ownJobs} of your job${a.ownJobs === 1 ? ' is' : 's are'} here — a yard sign and a referral base.`);
  }
  const nr = a.newRoofs;
  if (nr && nr.known >= MIN_KNOWN_ROOFS && nr.newSinceStorm > 0) {
    r.push(
      `${nr.newSinceStorm} of ${nr.known} homes on file here (Zillow) have a roof at least as new as the storm — fewer claim candidates, ${Math.round(
        (1 - nr.factor) * 100,
      )}% off the per-roof odds.`,
    );
  }
  if (a.calibration && a.calibration.method !== 'table') r.push(a.calibration.note);
  const hr = a.hitRate;
  r.push(
    `Knock ${hr.doors} doors: expect ~${Math.round(hr.expected)} claim-grade roofs, at least ${hr.atLeast} (${Math.round(
      hr.confidence * 100,
    )}% confidence); ${Math.round(hr.pAtLeastTarget * 100)}% chance of ${hr.target}+.`,
  );
  return r;
}

const byScore = (a: { knockScore: number; perRoof: number; distanceMiles: number }, b: typeof a) =>
  b.knockScore - a.knockScore || b.perRoof - a.perRoof || a.distanceMiles - b.distanceMiles;

export type RankOutput = {
  areas: ScoredArea[];
  /** Cells that qualified for ranking — storm mode: a report landed in them; neighbours: a job sits in them. */
  cellCount: number;
  radiusMiles: number;
  mode: FinderMode;
};

/**
 * Score every qualifying cell, cheaply, and finish only the top `limit`.
 *
 * The cheap part (a handful of multiplications per cell) runs for every
 * cell; the binomial statements and the rationale — the expensive part —
 * are computed for the cells that will be shown. The first build did the
 * expensive part for all ~1,000 cells, twice, and froze the JS thread for
 * the length of the run.
 */
export function rankAreasDetailed(input: RankInput): RankOutput {
  const { base, now, events } = input;
  const mode: FinderMode = input.mode ?? 'storm';
  const radiusMiles = clampRadiusMiles(input.radiusMiles);
  const nowYear = now.getFullYear();
  const cells = stormEvidenceByCell(events, base, now);
  const sixtyDaysAgo = now.getTime() - 60 * 24 * 60 * 60 * 1000;
  const own = input.own ?? { knocks: [], jobs: [] };
  const calibration = input.calibration ?? null;

  // Bucket the roofer's footprint and the known roofs once, by cell key.
  const knocksByCell = new Map<string, number>();
  for (const k of own.knocks) {
    if (new Date(k.at).getTime() < sixtyDaysAgo) continue;
    const key = cellFor(k.lat, k.lng, base.lat).key;
    knocksByCell.set(key, (knocksByCell.get(key) ?? 0) + 1);
  }
  const jobsByCell = new Map<string, OwnJob[]>();
  for (const j of own.jobs) {
    const key = cellFor(j.lat, j.lng, base.lat).key;
    jobsByCell.set(key, [...(jobsByCell.get(key) ?? []), j]);
  }
  const roofsByCell = new Map<string, KnownRoof[]>();
  for (const r of input.knownRoofs ?? []) {
    const key = cellFor(r.lat, r.lng, base.lat).key;
    roofsByCell.set(key, [...(roofsByCell.get(key) ?? []), r]);
  }

  // The population: storm mode ranks the cells a report landed in; neighbours
  // mode ranks the cells the roofer's jobs sit in, with whatever evidence
  // those cells have.
  type Candidate = { ref: CellRef; evidence: StormEvidence };
  const candidates: Candidate[] = [];
  if (mode === 'neighbours') {
    for (const key of jobsByCell.keys()) {
      const [row, col] = key.split(':').map(Number);
      candidates.push({ ref: { row, col, key }, evidence: cells.get(key)?.evidence ?? EMPTY_EVIDENCE });
    }
  } else {
    for (const c of cells.values()) {
      if (c.evidence.exposure <= 0) continue;
      // Only cells a report actually landed in are ranked. Neighbour spread
      // still lifts a hit cell that sits inside a wider swath, but a halo of
      // eight report-less cells around every storm would crowd the list with
      // nine cards all named after the same town — and the 3-mi canvass
      // radius already reaches into them from the hit cell.
      if (!c.evidence.direct) continue;
      candidates.push(c);
    }
  }

  type Cheap = {
    ref: CellRef;
    evidence: StormEvidence;
    center: { lat: number; lng: number };
    distanceMiles: number;
    housing: HousingProfile;
    susceptibility: number;
    recentKnocks: number;
    jobs: OwnJob[];
    newRoofs: NewRoofSummary | undefined;
    factors: ScoreFactors;
    perRoof: number;
    knockScore: number;
  };
  const cheap: Cheap[] = [];
  for (const { ref, evidence } of candidates) {
    const center = cellCenter(ref, base.lat);
    const distanceMiles = haversineMilesBetween(base.lat, base.lng, center.lat, center.lng);
    if (distanceMiles > radiusMiles) continue;
    const housing = input.housing?.get(ref.key) ?? NATIONAL_HOUSING_PRIOR;
    const susceptibility = susceptibilityScore(housing, nowYear);
    const recentKnocks = knocksByCell.get(ref.key) ?? 0;
    const jobs = jobsByCell.get(ref.key) ?? [];
    const signed = jobs.filter((j) => j.signed).length;
    const roofs = roofsByCell.get(ref.key);
    const newRoofs = roofs && roofs.length > 0 ? newRoofSummary(roofs, stormYearOf(evidence)) : undefined;
    const factors: ScoreFactors = {
      storm: mode === 'neighbours' ? Math.max(NEIGHBOUR_STORM_FLOOR, evidence.stormScore / 100) : evidence.stormScore / 100,
      housing: susceptibility / 100,
      access: accessFactor(distanceMiles, radiusMiles),
      canvassed: canvassedFactor(recentKnocks),
      ownJobs: mode === 'neighbours' ? referralFactor(signed, jobs.length) : ownJobsFactor(jobs.length),
    };
    const perRoof = roofHitProbability(evidence, housing, nowYear, calibration, newRoofs?.share ?? 0);
    cheap.push({
      ref,
      evidence,
      center,
      distanceMiles,
      housing,
      susceptibility,
      recentKnocks,
      jobs,
      newRoofs,
      factors,
      perRoof,
      knockScore: knockScoreFrom(factors, perRoof),
    });
  }

  // Ties (one storm across several cells) go to the nearer cell.
  cheap.sort(byScore);
  const top = cheap.slice(0, input.limit ?? MAX_AREAS);

  const areas: ScoredArea[] = top.map((c) => {
    const signedJobs = c.jobs.filter((j) => j.signed).length;
    const anchor = mode === 'neighbours' ? anchorJobOf(c.jobs) : undefined;
    const partial: Omit<ScoredArea, 'reasons'> = {
      key: c.ref.key,
      lat: c.center.lat,
      lng: c.center.lng,
      distanceMiles: c.distanceMiles,
      bearing: bearingBetween(base.lat, base.lng, c.center.lat, c.center.lng),
      driveMinutes: (c.distanceMiles / DRIVE_MPH) * 60 + 5,
      storm: c.evidence,
      housing: c.housing,
      susceptibility: c.susceptibility,
      factors: c.factors,
      knockScore: c.knockScore,
      hitRate: hitRateFor(c.perRoof),
      ownJobs: c.jobs.length,
      recentKnocks: c.recentKnocks,
      calibration: calibratedBaseRate(c.evidence, calibration),
      ...(c.newRoofs ? { newRoofs: c.newRoofs } : {}),
      ...(mode === 'neighbours'
        ? {
            mode,
            ownSignedJobs: signedJobs,
            ...(anchor ? { anchorJob: anchor } : {}),
            ...(anchor?.street ? { landmark: anchor.street } : {}),
            ...(cityOf(anchor?.address) ? { name: cityOf(anchor?.address) } : {}),
          }
        : {}),
    };
    return { ...partial, reasons: ruleRationale(partial, now) };
  });

  return { areas, cellCount: cheap.length, radiusMiles, mode };
}

export function rankAreas(input: RankInput): ScoredArea[] {
  return rankAreasDetailed(input).areas;
}

/** Re-score already-ranked areas with housing profiles that arrived later. */
export function applyHousing(
  areas: readonly ScoredArea[],
  housing: ReadonlyMap<string, HousingProfile>,
  now: Date,
  calibration?: CalibratedRates | null,
): ScoredArea[] {
  const nowYear = now.getFullYear();
  return areas
    .map((a) => {
      const h = housing.get(a.key);
      if (!h) return a;
      const susceptibility = susceptibilityScore(h, nowYear);
      const factors = { ...a.factors, housing: susceptibility / 100 };
      const perRoof = roofHitProbability(a.storm, h, nowYear, calibration, a.newRoofs?.share ?? 0);
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
    .sort((a, b) => byScore({ ...a, perRoof: a.hitRate.perRoof }, { ...b, perRoof: b.hitRate.perRoof }));
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
