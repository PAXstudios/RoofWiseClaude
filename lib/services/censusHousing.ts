// Housing profile of a point from the U.S. Census — network I/O.
//
// Two calls per area:
//   1. Geocoder (no key): lat/lng → census tract, with its land area.
//      https://geocoding.geo.census.gov/geocoder/geographies/coordinates
//   2. ACS 5-year (needs a FREE key, api.census.gov/data/key_signup.html):
//      median year built (B25035), tenure (B25003), units in structure
//      (B25024), housing units (B25001) for that tract.
//      Verified 2026-09-03: the ACS endpoint now 302s every unkeyed request to
//      /data/missing_key.html — there is no keyless quota any more.
//
// Without a key the finder still runs on storms alone and every rationale
// says "housing stock unknown — national averages assumed" (Drift #5); it
// never invents a build year.

import { env, isCensusConfigured } from '../env';
import { NATIONAL_HOUSING_PRIOR, type HousingProfile } from './knockOpportunities';

const GEOCODER = 'https://geocoding.geo.census.gov/geocoder/geographies/coordinates';
const ACS = 'https://api.census.gov/data/2023/acs/acs5';
const REQUEST_TIMEOUT_MS = 10_000;
const SQ_M_PER_SQ_MI = 2_589_988;

export type CensusTract = {
  geoid: string;
  state: string;
  county: string;
  tract: string;
  name: string;
  landSqMi: number | null;
};

async function fetchJson(url: string): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    // The ACS "missing/invalid key" pages are HTML behind a 302 → 200.
    if (text.trimStart().startsWith('<')) throw new Error('Census API returned HTML (key missing or invalid)');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

/** Census tract containing the point, or null when the geocoder has none (water, outside the US). */
export async function tractForPoint(lat: number, lng: number): Promise<CensusTract | null> {
  const url =
    `${GEOCODER}?x=${lng.toFixed(6)}&y=${lat.toFixed(6)}` +
    `&benchmark=Public_AR_Current&vintage=Current_Current&layers=Census%20Tracts&format=json`;
  const json = await fetchJson(url);
  const t = json?.result?.geographies?.['Census Tracts']?.[0];
  if (!t || typeof t.GEOID !== 'string') return null;
  const land = Number(t.AREALAND);
  return {
    geoid: t.GEOID,
    state: String(t.STATE),
    county: String(t.COUNTY),
    tract: String(t.TRACT),
    name: typeof t.NAME === 'string' ? t.NAME : `Tract ${t.GEOID}`,
    landSqMi: Number.isFinite(land) && land > 0 ? land / SQ_M_PER_SQ_MI : null,
  };
}

/** ACS uses large negative sentinels for "not available". */
function acsNumber(v: unknown): number | null {
  const n = typeof v === 'number' ? v : parseFloat(String(v));
  if (!Number.isFinite(n) || n <= -1) return null;
  return n;
}

export type AcsHousing = {
  medianYearBuilt: number | null;
  ownerOccupied: number | null;
  occupiedUnits: number | null;
  singleFamilyDetached: number | null;
  unitsInStructureTotal: number | null;
  housingUnits: number | null;
};

export async function acsHousingForTract(t: Pick<CensusTract, 'state' | 'county' | 'tract'>): Promise<AcsHousing | null> {
  if (!isCensusConfigured) return null;
  const vars = ['B25035_001E', 'B25003_001E', 'B25003_002E', 'B25024_001E', 'B25024_002E', 'B25001_001E'];
  const url =
    `${ACS}?get=${vars.join(',')}&for=tract:${t.tract}` +
    `&in=state:${t.state}%20county:${t.county}&key=${encodeURIComponent(env.CENSUS_API_KEY)}`;
  const rows = await fetchJson(url);
  if (!Array.isArray(rows) || rows.length < 2) return null;
  const header: string[] = rows[0];
  const row: unknown[] = rows[1];
  const col = (name: string) => acsNumber(row[header.indexOf(name)]);
  const year = col('B25035_001E');
  return {
    medianYearBuilt: year != null && year >= 1800 ? Math.round(year) : null,
    occupiedUnits: col('B25003_001E'),
    ownerOccupied: col('B25003_002E'),
    unitsInStructureTotal: col('B25024_001E'),
    singleFamilyDetached: col('B25024_002E'),
    housingUnits: col('B25001_001E'),
  };
}

function share(part: number | null, whole: number | null): number | null {
  if (part == null || whole == null || whole <= 0) return null;
  return Math.min(1, part / whole);
}

/**
 * The profile the scorer consumes. Falls back to the national prior — with
 * the reason — rather than throwing, so one bad tract never sinks the run.
 */
export async function housingProfileForPoint(lat: number, lng: number): Promise<HousingProfile> {
  if (!isCensusConfigured) {
    return { ...NATIONAL_HOUSING_PRIOR, priorReason: 'Census key not set' };
  }
  let tract: CensusTract | null;
  try {
    tract = await tractForPoint(lat, lng);
  } catch {
    return { ...NATIONAL_HOUSING_PRIOR, priorReason: 'Census geocoder unreachable' };
  }
  if (!tract) return { ...NATIONAL_HOUSING_PRIOR, priorReason: 'no census tract at this point' };
  let acs: AcsHousing | null;
  try {
    acs = await acsHousingForTract(tract);
  } catch (e) {
    return {
      ...NATIONAL_HOUSING_PRIOR,
      priorReason: e instanceof Error && /HTML/.test(e.message) ? 'Census key rejected' : 'Census data unreachable',
      tractName: tract.name,
      geoid: tract.geoid,
    };
  }
  if (!acs) return { ...NATIONAL_HOUSING_PRIOR, priorReason: 'no ACS row for this tract', tractName: tract.name, geoid: tract.geoid };
  return {
    source: 'acs',
    medianYearBuilt: acs.medianYearBuilt,
    ownerOccupiedShare: share(acs.ownerOccupied, acs.occupiedUnits),
    singleFamilyShare: share(acs.singleFamilyDetached, acs.unitsInStructureTotal),
    housingUnits: acs.housingUnits,
    unitsPerSqMi: acs.housingUnits != null && tract.landSqMi ? acs.housingUnits / tract.landSqMi : null,
    tractName: tract.name,
    geoid: tract.geoid,
  };
}
