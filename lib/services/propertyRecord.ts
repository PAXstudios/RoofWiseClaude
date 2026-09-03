// Property record — the house as the listing world knows it, via APIllow
// (api.apillow.co, Zillow data). Network I/O plus the pure readers every
// surface uses so the job, the cards and the estimate all front the same
// photo and quote the same facts.
//
// WHAT THE SERVICE HAS (verified live 2026-09-03): 39 fields per property —
// `image_urls` (Zillow static photos, listing order), `year_built`,
// `living_area`, `lot_size`, `stories`, `exterior_features`,
// `interior_features`, `description`, `tax_history`, `price_history`,
// `last_sold_*`, `zestimate`, `tax_assessed_value`, coordinates.
// WHAT IT DOES NOT HAVE: permits or public records of roof work. Roof age can
// therefore be BOUNDED by year built and HINTED by listing text ("new roof
// 2021"), never read from a permit — and the inspector's own number always
// wins (`roofAgePrefill` never overwrites a non-zero `ageYears`).
//
// QUOTA: the free tier is 50 lookups a month and 5 results per request, so
// every lookup goes through the per-address cache in
// lib/stores/propertyRecordStore.ts first and `max_items` is always 1.
//
// FAILURE POLICY (Drift #5): every outcome is a record with `status` and a
// plain-English `reason`; nothing here throws at a caller, and a house with
// no record fronts with the roofer's own first photo, never stock imagery.

import { env, isApillowConfigured } from '../env';
import type { CoverPhoto, Inspection, PropertyRecord, RoofAgeSource } from '../models/types';

const BASE = 'https://api.apillow.co/v1';
const POLL_INTERVAL_MS = 3_000;
const POLL_MAX = 15; // ~45 s — the service says 3–10 s typical
const REQUEST_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// Pure readers
// ---------------------------------------------------------------------------

/**
 * Zillow static photo URLs carry a size suffix (`-cc_ft_192.jpg`). The same
 * hash serves 384 / 576 / 768 / 960 / 1152 / 1344 / 1536; 960 is the largest
 * distinct encoding observed (1536 returned identical bytes). Pure.
 */
export type ZillowPhotoSize = 192 | 384 | 576 | 768 | 960 | 1536;

export function zillowPhotoUrl(url: string, size: ZillowPhotoSize): string {
  return url.replace(/-cc_ft_\d+\.jpg(\?.*)?$/i, `-cc_ft_${size}.jpg`);
}

/** The record's lead photo at hero size, or undefined. */
export function recordHeroUrl(record: PropertyRecord | undefined): string | undefined {
  const first = record?.status === 'found' ? record.imageUrls?.[0] : undefined;
  return first ? zillowPhotoUrl(first, 960) : undefined;
}

/** The record's lead photo at card size, or undefined. */
export function recordCardUrl(record: PropertyRecord | undefined): string | undefined {
  const first = record?.status === 'found' ? record.imageUrls?.[0] : undefined;
  return first ? zillowPhotoUrl(first, 576) : undefined;
}

type CoverSource = Pick<Inspection, 'coverPhoto' | 'propertyRecord' | 'slopes'>;

/**
 * The photo that fronts a job, in order: what the inspector chose → the
 * Zillow lead photo → the first captured photo → nothing (the screen draws
 * its gradient placeholder). Pure; every surface reads through this.
 */
export function coverPhotoUri(ins: CoverSource, size: 'hero' | 'card' = 'hero'): string | undefined {
  const chosen = ins.coverPhoto?.uri;
  if (chosen) {
    return ins.coverPhoto?.source === 'zillow' ? zillowPhotoUrl(chosen, size === 'hero' ? 960 : 576) : chosen;
  }
  const fromRecord = size === 'hero' ? recordHeroUrl(ins.propertyRecord) : recordCardUrl(ins.propertyRecord);
  if (fromRecord) return fromRecord;
  return ins.slopes.flatMap((sl) => sl.photoPaths)[0];
}

/** Which source `coverPhotoUri` resolved to — for the "Change photo" sheet. */
export function coverPhotoSource(ins: CoverSource): CoverPhoto['source'] | 'none' {
  if (ins.coverPhoto?.uri) return ins.coverPhoto.source;
  if (recordHeroUrl(ins.propertyRecord)) return 'zillow';
  if (ins.slopes.some((sl) => sl.photoPaths.length > 0)) return 'capture';
  return 'none';
}

const ROOF_SENTENCE = /[^.!\n]*\broof(?:ing|s)?\b[^.!\n]*[.!]?/gi;
const YEAR_IN_TEXT = /\b(19[5-9]\d|20[0-4]\d)\b/;

/**
 * Sentences from listing text that mention the roof, with a stated year when
 * one appears in the sentence. Pure. "New roof installed 2021." → year 2021.
 */
export function roofHintsFromText(text: string | null | undefined): { text: string; year?: number }[] {
  if (!text) return [];
  const out: { text: string; year?: number }[] = [];
  for (const m of text.match(ROOF_SENTENCE) ?? []) {
    const sentence = m.trim();
    if (sentence.length < 6) continue;
    const y = sentence.match(YEAR_IN_TEXT);
    out.push(y ? { text: sentence, year: Number(y[1]) } : { text: sentence });
    if (out.length >= 4) break;
  }
  return out;
}

/** Zillow's "Roof: Composition" fact from the feature lists, when present. Pure. */
export function roofFactFromFeatures(features: unknown[]): string | undefined {
  for (const f of features) {
    const s = typeof f === 'string' ? f : typeof f === 'object' && f ? JSON.stringify(f) : '';
    const m = s.match(/roof(?:\s*(?:type|material))?\s*[:=]\s*"?([A-Za-z][A-Za-z ,/-]{2,40})/i);
    if (m) return m[1].trim().replace(/"$/, '');
  }
  return undefined;
}

export type RoofAgePrefill = {
  ageYears: number;
  source: RoofAgeSource;
  /** What the job screen prints beside the number. */
  note: string;
};

/**
 * What the record can say about roof age, for PREFILL ONLY. A listing that
 * states a roof year beats the build year; the build year is an upper bound
 * (the roof is at most as old as the house). Never applied over an
 * inspector's non-zero entry — see `inspectionStore.setPropertyRecord`.
 */
export function roofAgePrefill(record: PropertyRecord | undefined, nowYear: number): RoofAgePrefill | null {
  if (!record || record.status !== 'found') return null;
  const stated = record.roofHints?.find((h) => h.year != null && h.year <= nowYear);
  if (stated?.year != null) {
    return {
      ageYears: Math.max(0, nowYear - stated.year),
      source: 'listing',
      note: `Listing says "${stated.text}" — roof from ${stated.year}. Confirm on the roof.`,
    };
  }
  if (record.yearBuilt != null && record.yearBuilt > 1800 && record.yearBuilt <= nowYear) {
    return {
      ageYears: nowYear - record.yearBuilt,
      source: 'year_built',
      note: `Built ${record.yearBuilt} (Zillow) — the roof is at most ${nowYear - record.yearBuilt} yrs; the house may have been re-roofed. Confirm on the roof.`,
    };
  }
  return null;
}

/** One line of facts for a card: "Built 2002 · 2,137 sq ft · sold Sep 2026". Pure. */
export function recordFactsLine(record: PropertyRecord | undefined): string | undefined {
  if (!record || record.status !== 'found') return undefined;
  const parts: string[] = [];
  if (record.yearBuilt) parts.push(`Built ${record.yearBuilt}`);
  if (record.livingAreaSqFt) parts.push(`${record.livingAreaSqFt.toLocaleString()} sq ft`);
  if (record.stories) parts.push(`${record.stories} stor${record.stories === 1 ? 'y' : 'ies'}`);
  if (record.roofFact) parts.push(`roof: ${record.roofFact}`);
  if (record.lastSoldDate) {
    const d = new Date(`${record.lastSoldDate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime())) {
      parts.push(`sold ${d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}`);
    }
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
}

/** Normalised cache key for an address: case, punctuation and spacing folded. Pure. */
export function addressKey(address: string): string {
  return address
    .toLowerCase()
    .replace(/,?\s*(usa|united states)\s*$/i, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Mapping the service's record — pure
// ---------------------------------------------------------------------------

function num(v: unknown): number | undefined {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  return Number.isFinite(n) && n !== 0 ? n : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined;
}

export function mapApillowProperty(p: Record<string, unknown>, fetchedAt: string): PropertyRecord {
  const images = Array.isArray(p.image_urls) ? p.image_urls.filter((u): u is string => typeof u === 'string' && /^https?:/.test(u)) : [];
  const exterior = Array.isArray(p.exterior_features) ? p.exterior_features : [];
  const interior = Array.isArray(p.interior_features) ? p.interior_features : [];
  const description = str(p.description);
  const yearBuilt = num(p.year_built);
  return {
    fetchedAt,
    source: 'zillow',
    status: 'found',
    zpid: num(p.zpid),
    url: str(p.url),
    streetAddress: str(p.street_address),
    city: str(p.city),
    state: str(p.state),
    zipcode: str(p.zipcode),
    lat: num(p.latitude),
    lng: num(p.longitude),
    imageUrls: images.length > 0 ? images : undefined,
    yearBuilt: yearBuilt && yearBuilt > 1700 ? Math.round(yearBuilt) : undefined,
    livingAreaSqFt: num(p.living_area),
    lotSizeSqFt: num(p.lot_size),
    stories: num(p.stories),
    propertyType: str(p.property_type),
    homeStatus: str(p.home_status),
    lastSoldDate: str(p.last_sold_date),
    lastSoldPrice: num(p.last_sold_price),
    zestimate: num(p.zestimate),
    taxAssessedValue: num(p.tax_assessed_value),
    roofFact: roofFactFromFeatures([...exterior, ...interior]),
    roofHints: (() => {
      const hints = roofHintsFromText(description);
      return hints.length > 0 ? hints : undefined;
    })(),
    scrapedAt: str(p.scraped_at),
  };
}

// ---------------------------------------------------------------------------
// I/O
// ---------------------------------------------------------------------------

async function apillow(path: string, init: RequestInit & { timeoutMs?: number } = {}): Promise<{ status: number; json: any }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), init.timeoutMs ?? REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'X-API-Key': env.APILLOW_API_KEY, 'Content-Type': 'application/json', Accept: 'application/json', ...(init.headers ?? {}) },
    });
    const text = await res.text();
    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function unavailable(fetchedAt: string, reason: string): PropertyRecord {
  return { fetchedAt, source: 'zillow', status: 'unavailable', reason };
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Look up one address. Resolves with a record in every case (`status` says
 * what happened). Costs one lookup against the monthly quota when it reaches
 * the service — callers go through `propertyRecordStore.lookup()` so a house
 * is never fetched twice in 30 days.
 */
export async function fetchPropertyRecord(input: { address: string; signal?: AbortSignal }): Promise<PropertyRecord> {
  const fetchedAt = new Date().toISOString();
  if (!isApillowConfigured) {
    return { fetchedAt, source: 'zillow', status: 'not_configured', reason: 'Property records are not set up on this build.' };
  }
  const address = input.address.trim();
  if (address.length < 8) {
    return { fetchedAt, source: 'zillow', status: 'not_found', reason: 'No street address to look up.' };
  }

  let submit: { status: number; json: any };
  try {
    submit = await apillow('/properties', {
      method: 'POST',
      body: JSON.stringify({ addresses: [address], max_items: 1 }),
    });
  } catch (e) {
    return unavailable(fetchedAt, e instanceof Error && e.name === 'AbortError' ? 'Property record lookup timed out.' : 'Property record service unreachable.');
  }
  if (submit.status === 401) return unavailable(fetchedAt, 'Property record key was rejected.');
  if (submit.status === 429) return unavailable(fetchedAt, 'Property record quota for this month is used up (free tier: 50 lookups).');
  if (submit.status !== 200 || typeof submit.json?.job_id !== 'string') {
    return unavailable(fetchedAt, `Property record service answered ${submit.status}.`);
  }
  const jobId: string = submit.json.job_id;

  for (let i = 0; i < POLL_MAX; i += 1) {
    if (input.signal?.aborted) return unavailable(fetchedAt, 'Lookup cancelled.');
    await sleep(POLL_INTERVAL_MS);
    let poll: { status: number; json: any };
    try {
      poll = await apillow(`/results/${encodeURIComponent(jobId)}`);
    } catch {
      continue; // one dropped poll is not a failed lookup
    }
    const status = poll.json?.status;
    if (status === 'processing') continue;
    if (status === 'failed') return unavailable(fetchedAt, 'Property record lookup failed at the service.');
    if (status === 'complete') {
      const results: any[] = Array.isArray(poll.json?.results) ? poll.json.results : [];
      const hit = results.find((r) => r && r.success === true && r.property && typeof r.property === 'object');
      if (hit) return mapApillowProperty(hit.property, fetchedAt);
      const errs: any[] = Array.isArray(poll.json?.errors) ? poll.json.errors : [];
      const failed = results.find((r) => r && r.success === false);
      const msg = String(failed?.error ?? errs[0]?.error ?? '');
      if (/404|no listing|no results/i.test(msg) || results.length === 0) {
        return { fetchedAt, source: 'zillow', status: 'not_found', reason: 'Zillow has no record at this address.' };
      }
      return unavailable(fetchedAt, msg || 'Property record lookup returned nothing usable.');
    }
  }
  return unavailable(fetchedAt, 'Property record lookup is taking too long — try again in a minute.');
}

export type ApillowUsage = { plan: string; monthlyLimit: number; used: number; remaining: number };

/** Monthly quota, for Settings. Does not consume a lookup. */
export async function fetchApillowUsage(): Promise<ApillowUsage | null> {
  if (!isApillowConfigured) return null;
  try {
    const { status, json } = await apillow('/usage');
    if (status !== 200 || !json) return null;
    return {
      plan: String(json.plan ?? ''),
      monthlyLimit: Number(json.monthly_limit ?? 0),
      used: Number(json.used_this_month ?? 0),
      remaining: Number(json.remaining ?? 0),
    };
  } catch {
    return null;
  }
}
