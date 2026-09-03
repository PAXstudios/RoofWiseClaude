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
 * Does a roof sentence say the roof is NEW? The "new" word has to sit within
 * a few words of "roof" — "NEW PRICE! Home has a 15 year old roof" must not
 * read as a new roof — and a sentence that says the roof NEEDS replacing, or
 * is original, never does. Pure.
 */
const NEW_BEFORE_ROOF = /\b(brand[- ]new|new|newer|replaced|re-?roofed|updated|upgraded|recently replaced|newly installed)\b(?:\W+\w+){0,4}?\W+roof(?:ing|s)?\b/i;
const NEW_AFTER_ROOF = /\broof(?:ing|s)?\b(?:\W+\w+){0,5}?\W+(replaced|new|updated|upgraded|installed|re-?done|redone)\b/i;
const NEW_SHINGLES = /\bnew (?:architectural |composition |asphalt )?shingles\b/i;
const NOT_NEW = /\b(needs?|will need|due for|should be|must be|requires?)\b(?:\W+\w+){0,4}?\W+(roof|replac)|\broof (?:is|was) original\b|\boriginal roof\b|\bas[- ]is\b|\broof (?:replacement|repair) (?:needed|required|credit|allowance)\b|\bno new roof\b/i;

export function roofHintReadsNew(text: string | null | undefined): boolean {
  if (!text) return false;
  if (NOT_NEW.test(text)) return false;
  return NEW_BEFORE_ROOF.test(text) || NEW_AFTER_ROOF.test(text) || NEW_SHINGLES.test(text);
}

/**
 * The year the listing whose text we read went up. `listedYear` when the
 * record carries it; otherwise re-derived from the fields older cached
 * records do have — the last "Listed for sale" date, the scrape date minus
 * days on Zillow, or the sale date (a sold listing's text was written just
 * before the sale). Pure.
 */
export function listingYearOf(record: Pick<PropertyRecord, 'listedYear' | 'listedDate' | 'scrapedAt' | 'daysOnZillow' | 'lastSoldDate' | 'homeStatus'> | undefined): number | undefined {
  if (!record) return undefined;
  if (record.listedYear != null && record.listedYear > 1900) return record.listedYear;
  const yearOf = (iso: string | undefined): number | undefined => {
    if (!iso) return undefined;
    const d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(iso) ? `${iso}T12:00:00Z` : iso);
    const y = d.getUTCFullYear();
    return Number.isNaN(d.getTime()) || y < 1900 ? undefined : y;
  };
  const listed = yearOf(record.listedDate);
  if (listed) return listed;
  if (record.daysOnZillow != null && record.scrapedAt) {
    const d = new Date(record.scrapedAt);
    if (!Number.isNaN(d.getTime())) {
      d.setUTCDate(d.getUTCDate() - Math.max(0, Math.round(record.daysOnZillow)));
      return d.getUTCFullYear();
    }
  }
  return yearOf(record.lastSoldDate);
}

export type NewRoofFromListing = {
  year: number;
  ageYears: number;
  evidence: 'listing_new_roof';
  /** The sentence that said so. */
  hint: string;
  /** "Listing (Mar 2024) says "new roof" — roof from 2024. Confirm on the roof." */
  note: string;
};

function listedMonthYear(record: Pick<PropertyRecord, 'listedDate'>, year: number): string {
  if (record.listedDate) {
    const d = new Date(`${record.listedDate}T12:00:00Z`);
    if (!Number.isNaN(d.getTime()) && d.getUTCFullYear() === year) {
      return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' });
    }
  }
  return String(year);
}

/**
 * A listing that says the roof is new but gives no year dates the roof to
 * the year the listing went up. A hint that states its own year is handled
 * by `roofAgePrefill` (a stated year wins); a hint whose only year is the
 * house's build year ("Built in 1998, new roof and HVAC") is treated as
 * having no roof year. Null when the listing says nothing of the kind, or
 * when there is no listing year to pin it to. Pure.
 */
export function newRoofFromListing(record: PropertyRecord | undefined, nowYear: number): NewRoofFromListing | null {
  if (!record || record.status !== 'found') return null;
  const listedYear = listingYearOf(record);
  if (!listedYear || listedYear > nowYear) return null;
  const hint = record.roofHints?.find((h) => {
    if (!roofHintReadsNew(h.text)) return false;
    if (h.year == null) return true;
    return h.year === record.yearBuilt && listedYear > h.year;
  });
  if (!hint) return null;
  const short = hint.text.length > 90 ? `${hint.text.slice(0, 87).trimEnd()}…` : hint.text;
  return {
    year: listedYear,
    ageYears: Math.max(0, nowYear - listedYear),
    evidence: 'listing_new_roof',
    hint: hint.text,
    note: `Listing (${listedMonthYear(record, listedYear)}) says "${short}" — roof from ${listedYear}. Confirm on the roof.`,
  };
}

/**
 * What the record can say about roof age, for PREFILL ONLY. A listing that
 * states a roof year beats a listing that only says "new roof" (dated to the
 * listing year), which beats the build year — an upper bound (the roof is at
 * most as old as the house). Never applied over an inspector's non-zero
 * entry — see `inspectionStore.setPropertyRecord`.
 */
export function roofAgePrefill(record: PropertyRecord | undefined, nowYear: number): RoofAgePrefill | null {
  if (!record || record.status !== 'found') return null;
  const newRoof = newRoofFromListing(record, nowYear);
  const stated = record.roofHints?.find(
    (h) => h.year != null && h.year <= nowYear && !(newRoof && h.year === record.yearBuilt && newRoof.year > h.year),
  );
  if (stated?.year != null) {
    return {
      ageYears: Math.max(0, nowYear - stated.year),
      source: 'listing',
      note: `Listing says "${stated.text}" — roof from ${stated.year}. Confirm on the roof.`,
    };
  }
  if (newRoof) {
    return { ageYears: newRoof.ageYears, source: 'listing_new_roof', note: newRoof.note };
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

export type RoofYearKnown = {
  /** A LOWER bound on the roof's year — the roof is at least this new. */
  year: number;
  source: Exclude<RoofAgeSource, 'inspector'>;
};

/**
 * The best-known roof year for the knock calculus: a stated listing year, a
 * "new roof" listing dated to its year, else the build year (a house built
 * after the storm has a roof newer than the storm). Null when the record
 * says nothing. Pure.
 */
export function roofYearFromRecord(record: PropertyRecord | undefined, nowYear: number): RoofYearKnown | null {
  const prefill = roofAgePrefill(record, nowYear);
  if (!prefill || prefill.source === 'inspector') return null;
  return { year: nowYear - prefill.ageYears, source: prefill.source };
}

/**
 * One line about the roof for a card or the pin sheet: "New roof · 2024
 * (listing Aug 2024)", "Roof from 2021 (listing)", "New build · 2026",
 * "Roof: Composition · built 2002 (≤ 24 yrs)". Undefined when the record
 * has nothing on the roof. Pure.
 */
export function recordRoofLine(record: PropertyRecord | undefined, nowYear: number): string | undefined {
  if (!record || record.status !== 'found') return undefined;
  const parts: string[] = [];
  const newRoof = newRoofFromListing(record, nowYear);
  const stated = record.roofHints?.find((h) => h.year != null && h.year <= nowYear && !(newRoof && h.year === record.yearBuilt && newRoof.year > h.year));
  if (stated?.year != null) parts.push(`Roof from ${stated.year} (listing)`);
  else if (newRoof) parts.push(`New roof · ${newRoof.year} (listing ${listedMonthYear(record, newRoof.year)})`);
  else if (record.yearBuilt != null && nowYear - record.yearBuilt <= 2) parts.push(`New build · ${record.yearBuilt}`);
  if (record.roofFact) parts.push(`Roof: ${record.roofFact}`);
  if (record.yearBuilt != null && !(nowYear - record.yearBuilt <= 2 && !stated && !newRoof)) {
    parts.push(`built ${record.yearBuilt} (roof ≤ ${Math.max(0, nowYear - record.yearBuilt)} yrs)`);
  }
  return parts.length > 0 ? parts.join(' · ') : undefined;
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
    listPrice: num(p.price),
    daysOnZillow: typeof p.days_on_zillow === 'number' ? p.days_on_zillow : undefined,
    rentZestimate: num(p.rent_zestimate),
    listingAgent: (() => {
      const a = p.listing_agent;
      if (!a || typeof a !== 'object') return undefined;
      const o = a as Record<string, unknown>;
      const agent = { name: str(o.name), phone: str(o.phone), email: str(o.email), company: str(o.company) ?? str(p.listing_broker) };
      return agent.name || agent.phone || agent.email ? agent : undefined;
    })(),
    listedDate: (() => {
      const hist = Array.isArray(p.price_history) ? (p.price_history as Record<string, unknown>[]) : [];
      const listed = hist.find((h) => typeof h?.event === 'string' && /listed for sale/i.test(h.event as string));
      return listed ? str(listed.date) : undefined;
    })(),
  };
}

/**
 * `mapApillowProperty` plus the derived `listedYear`, so every record that
 * enters the cache carries the year its listing text dates from. Pure.
 */
export function mapApillowRecord(p: Record<string, unknown>, fetchedAt: string): PropertyRecord {
  const record = mapApillowProperty(p, fetchedAt);
  const listedYear = listingYearOf(record);
  return listedYear ? { ...record, listedYear } : record;
}

/**
 * What the house's market status means at the door. Pure.
 *   FOR_SALE      → the seller needs a roof that passes inspection before closing;
 *                   the listing agent is the fastest decision-maker to reach.
 *   RECENTLY_SOLD → a new owner, a new policy, and often an inherited roof.
 *   FOR_RENT      → the person at the door is a tenant — find the owner.
 */
export type RecordBadge = { label: string; tone: 'info' | 'success' | 'warn' | 'neutral'; hint: string };

export function recordStatusBadge(record: PropertyRecord | undefined): RecordBadge | null {
  if (!record || record.status !== 'found') return null;
  const st = (record.homeStatus ?? '').toUpperCase();
  if (st === 'FOR_SALE' || st === 'PENDING') {
    const days = record.daysOnZillow != null ? ` · ${record.daysOnZillow} days on market` : '';
    return { label: 'For sale', tone: 'info', hint: `Listed${record.listPrice ? ` at $${record.listPrice.toLocaleString()}` : ''}${days}. Roof must pass the buyer's inspection — the listing agent is the decision-maker to call.` };
  }
  if (st === 'RECENTLY_SOLD' || st === 'SOLD') {
    const when = record.lastSoldDate ? ` ${new Date(`${record.lastSoldDate}T12:00:00Z`).toLocaleDateString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })}` : '';
    return { label: `Sold${when}`, tone: 'success', hint: 'New owner, new policy — and an inherited roof. Ask when the seller last replaced it.' };
  }
  if (st === 'FOR_RENT' || (record.rentZestimate != null && record.zestimate == null)) {
    return { label: 'Rental', tone: 'warn', hint: 'The person at the door is likely a tenant. The owner files the claim — ask for a contact.' };
  }
  return null;
}

/**
 * Does the aerial roof measurement fit the house? Pure. A 2-story home's
 * footprint is roughly living area ÷ stories; asphalt roofs run ~1.15–1.6×
 * the footprint with pitch, overhangs and porches. Far outside that band the
 * measurement (or the address) deserves a second look before it prices a
 * proposal. Returns null when there is not enough to compare.
 */
export function roofSizePlausibility(
  record: PropertyRecord | undefined,
  totalSquares: number | undefined,
): { ok: boolean; note: string; expectedLow: number; expectedHigh: number } | null {
  if (!record || record.status !== 'found' || !record.livingAreaSqFt || totalSquares == null) return null;
  const stories = record.stories && record.stories >= 1 ? Math.min(record.stories, 3) : record.livingAreaSqFt > 2600 ? 2 : 1;
  const footprint = record.livingAreaSqFt / stories;
  const low = (footprint * 1.1) / 100;
  const high = (footprint * 1.7) / 100;
  const ok = totalSquares >= low * 0.8 && totalSquares <= high * 1.25;
  const s1 = Math.round(low), s2 = Math.round(high);
  return {
    ok,
    expectedLow: low,
    expectedHigh: high,
    note: ok
      ? `${totalSquares.toFixed(1)} sq fits a ${record.livingAreaSqFt.toLocaleString()} sq ft, ${stories}-story home (expect ~${s1}–${s2} sq).`
      : `${totalSquares.toFixed(1)} sq looks ${totalSquares > high ? 'large' : 'small'} for a ${record.livingAreaSqFt.toLocaleString()} sq ft, ${stories}-story home (expect ~${s1}–${s2} sq) — check the measurement or the address before pricing.`,
  };
}

/** Zestimate as a home-value offer for the claim wizard (deductible-vs-value check). Pure. */
export function homeValueOffer(record: PropertyRecord | undefined): { value: number; note: string } | null {
  if (!record || record.status !== 'found') return null;
  const v = record.zestimate ?? record.listPrice ?? record.taxAssessedValue;
  if (!v) return null;
  const basis = record.zestimate ? 'Zestimate' : record.listPrice ? 'asking price' : 'tax-assessed value';
  return { value: Math.round(v), note: `${basis} from Zillow — the policy's dwelling coverage is the real number.` };
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
      if (hit) return mapApillowRecord(hit.property, fetchedAt);
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

export type NearbyHomesKind = 'sold' | 'sale';

/**
 * Homes recently sold or for sale in a ZIP — the doors behind a knock-finder
 * area. Costs `max` lookups against the monthly quota (free tier: 5 per
 * request, 50 a month), so the UI states the price before the tap and this
 * is never called automatically.
 */
export async function fetchNearbyHomes(input: {
  zip: string;
  kind: NearbyHomesKind;
  max?: number;
}): Promise<{ status: 'ok'; homes: PropertyRecord[] } | { status: 'unavailable' | 'not_configured'; reason: string }> {
  if (!isApillowConfigured) return { status: 'not_configured', reason: 'Property records are not set up on this build.' };
  const zip = Number(input.zip);
  if (!Number.isInteger(zip) || zip < 501) return { status: 'unavailable', reason: 'No ZIP code for this area.' };
  const max = Math.max(1, Math.min(5, input.max ?? 5));
  const fetchedAt = new Date().toISOString();
  let submit: { status: number; json: any };
  try {
    submit = await apillow('/properties', {
      method: 'POST',
      body: JSON.stringify({ zipcodes: [zip], type: input.kind, property_type: 'house', max_items: max }),
    });
  } catch {
    return { status: 'unavailable', reason: 'Property record service unreachable.' };
  }
  if (submit.status === 429) return { status: 'unavailable', reason: 'Property record quota for this month is used up (free tier: 50 lookups).' };
  if (submit.status !== 200 || typeof submit.json?.job_id !== 'string') return { status: 'unavailable', reason: `Property record service answered ${submit.status}.` };
  const jobId: string = submit.json.job_id;
  for (let i = 0; i < POLL_MAX; i += 1) {
    await sleep(POLL_INTERVAL_MS);
    let poll: { status: number; json: any };
    try {
      poll = await apillow(`/results/${encodeURIComponent(jobId)}`);
    } catch {
      continue;
    }
    if (poll.json?.status === 'processing') continue;
    if (poll.json?.status === 'failed') return { status: 'unavailable', reason: 'Property search failed at the service.' };
    const results: any[] = Array.isArray(poll.json?.results) ? poll.json.results : [];
    const homes = results
      .filter((r) => r && r.success === true && r.property && typeof r.property === 'object')
      .map((r) => mapApillowRecord(r.property, fetchedAt));
    return { status: 'ok', homes };
  }
  return { status: 'unavailable', reason: 'Property search is taking too long — try again in a minute.' };
}
