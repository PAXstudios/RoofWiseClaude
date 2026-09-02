// Google Weather API — hourly (48 h) and daily (10 day) forecasts.
// Docs: https://developers.google.com/maps/documentation/weather
//
// Companion to `weather.ts` (currentConditions). Same key, same honesty rule:
// a field the API did not report stays `undefined`, and a failed call is a
// typed `unavailable` / `not_configured` result rather than a guessed sky
// (Drift #5). Nothing here renders; `app/weather.tsx` and the
// `components/weather/*` modules consume these shapes.
//
// VERIFIED LIVE 2026-09-02 (Dallas, owner's key):
//   forecast/days:lookup   → `days=10&pageSize=10` returns all 10 in one page.
//   forecast/hours:lookup  → pages at 24 forecastHours regardless of pageSize;
//                            `nextPageToken` carries the second 24. Both
//                            endpoints are followed here until the requested
//                            count is met or the token runs out.
//   Field names below are copied from those responses, not from memory.

import { env } from '../env';
import { evaluateSafety, type SafetyForecast, type SafetyRating } from './safetyEngine';

const DAYS_ENDPOINT = 'https://weather.googleapis.com/v1/forecast/days:lookup';
const HOURS_ENDPOINT = 'https://weather.googleapis.com/v1/forecast/hours:lookup';

/** The product asks: 48 hours of hourly, 10 days of daily. */
export const FORECAST_HOURS = 48;
export const FORECAST_DAYS = 10;

/**
 * Per-request bound. A hung forecast call otherwise pins the weather page's
 * "checking" state until the OS gives up. Ten seconds is past a slow cellular
 * round-trip and well short of "is this broken?".
 */
const REQUEST_TIMEOUT_MS = 10_000;

/** Hard stop on `nextPageToken` following so a misbehaving token can't loop. */
const MAX_PAGES = 4;

/**
 * Thunderstorm probability at or above this percent is treated as a
 * thunderstorm watch for HAAG §7 — the same mapping `weather.ts` uses for
 * current conditions, so the hero chip and the hourly window agree.
 */
const THUNDERSTORM_PROBABILITY_PERCENT = 50;

export type ForecastStatus = 'ok' | 'not_configured' | 'unavailable';

export type ForecastResult<T> =
  | { status: 'ok'; items: T[]; timeZone?: string }
  /** No Google Weather key in this build — nothing was requested. */
  | { status: 'not_configured' }
  /** The service did not answer usably. Never filled with a synthetic sky. */
  | { status: 'unavailable'; reason: string };

/** One forecast hour. Every optional field is absent when the API omitted it. */
export type ForecastHour = {
  /** Interval start, ISO 8601 (UTC). */
  time: string;
  /** Local wall-clock hour (0–23) at the forecast location, when reported. */
  localHour?: number;
  /** Local calendar day (YYYY-MM-DD) at the forecast location, when reported. */
  localDate?: string;
  isDaytime: boolean;
  tempF?: number;
  feelsLikeF?: number;
  description: string;
  /** Google condition type, e.g. `CLEAR`, `THUNDERSTORM`. Empty when absent. */
  conditionType: string;
  precipChancePercent?: number;
  /** Liquid-equivalent precipitation for the hour, inches. */
  precipInches?: number;
  windMph?: number;
  gustMph?: number;
  /** Cardinal wind direction, e.g. `SOUTHWEST`. */
  windDirection?: string;
  cloudCoverPercent?: number;
  humidityPercent?: number;
  uvIndex?: number;
  thunderstormProbabilityPercent?: number;
};

/** Daytime / nighttime half of a forecast day. */
export type ForecastDayPart = {
  description: string;
  conditionType: string;
  precipChancePercent?: number;
  precipInches?: number;
  windMph?: number;
  gustMph?: number;
  windDirection?: string;
  cloudCoverPercent?: number;
  humidityPercent?: number;
  uvIndex?: number;
  thunderstormProbabilityPercent?: number;
};

export type ForecastDay = {
  /** Local calendar date at the location, YYYY-MM-DD. */
  date: string;
  /** Interval start, ISO 8601 (UTC). */
  startTime: string;
  highF?: number;
  lowF?: number;
  feelsLikeHighF?: number;
  feelsLikeLowF?: number;
  day?: ForecastDayPart;
  night?: ForecastDayPart;
  /** ISO 8601 (UTC). Format with the result's `timeZone`. */
  sunriseTime?: string;
  sunsetTime?: string;
  moonPhase?: string;
};

export type Coordinate = { lat: number; lng: number };

/* ─────────────────────────── fetchers ────────────────────────────────── */

export async function fetchHourlyForecast(
  coord: Coordinate,
  opts: { hours?: number } = {},
): Promise<ForecastResult<ForecastHour>> {
  const key = env.GOOGLE_WEATHER_API_KEY;
  if (!key) return { status: 'not_configured' };
  const wanted = clampInt(opts.hours ?? FORECAST_HOURS, 1, 240);

  try {
    const pages = await fetchPaged(
      HOURS_ENDPOINT,
      { key, coord, extra: `&hours=${wanted}&pageSize=${wanted}` },
      'forecastHours',
      wanted,
    );
    const items = pages.items.map(parseHour).filter((h): h is ForecastHour => h !== null);
    return { status: 'ok', items: items.slice(0, wanted), timeZone: pages.timeZone };
  } catch (err) {
    return { status: 'unavailable', reason: describe(err) };
  }
}

export async function fetchDailyForecast(
  coord: Coordinate,
  opts: { days?: number } = {},
): Promise<ForecastResult<ForecastDay>> {
  const key = env.GOOGLE_WEATHER_API_KEY;
  if (!key) return { status: 'not_configured' };
  const wanted = clampInt(opts.days ?? FORECAST_DAYS, 1, 10);

  try {
    const pages = await fetchPaged(
      DAYS_ENDPOINT,
      { key, coord, extra: `&days=${wanted}&pageSize=${wanted}` },
      'forecastDays',
      wanted,
    );
    const items = pages.items.map(parseDay).filter((d): d is ForecastDay => d !== null);
    return { status: 'ok', items: items.slice(0, wanted), timeZone: pages.timeZone };
  } catch (err) {
    return { status: 'unavailable', reason: describe(err) };
  }
}

/**
 * GET one endpoint and follow `nextPageToken` until `wanted` raw entries are
 * collected or the service stops handing out tokens. The hours endpoint pages
 * at 24 no matter what `pageSize` says (verified live), so this is not
 * optional for a 48-hour strip.
 */
async function fetchPaged(
  endpoint: string,
  args: { key: string; coord: Coordinate; extra: string },
  listKey: 'forecastHours' | 'forecastDays',
  wanted: number,
): Promise<{ items: unknown[]; timeZone?: string }> {
  const base =
    `${endpoint}?key=${encodeURIComponent(args.key)}` +
    `&location.latitude=${args.coord.lat}&location.longitude=${args.coord.lng}` +
    `&unitsSystem=METRIC${args.extra}`;

  const items: unknown[] = [];
  let timeZone: string | undefined;
  let token: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const url = token ? `${base}&pageToken=${encodeURIComponent(token)}` : base;
    const data = await getJson(url);
    const list = (data as Record<string, unknown> | null)?.[listKey];
    if (Array.isArray(list)) items.push(...list);
    const tz = (data as { timeZone?: { id?: unknown } } | null)?.timeZone?.id;
    if (typeof tz === 'string' && tz.length > 0) timeZone = tz;
    const next = (data as { nextPageToken?: unknown } | null)?.nextPageToken;
    token = typeof next === 'string' && next.length > 0 ? next : undefined;
    if (!token || items.length >= wanted) break;
  }

  if (items.length === 0) throw new Error('Weather service returned no forecast entries');
  return { items, timeZone };
}

async function getJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) {
      const body = (await res.text().catch(() => '')).slice(0, 200);
      throw new Error(`Weather ${res.status}${body ? `: ${body}` : ''}`);
    }
    return await res.json();
  } catch (err) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new Error('The weather service did not respond in time');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/* ─────────────────────────── parsers ─────────────────────────────────── */

function parseHour(raw: unknown): ForecastHour | null {
  const h = raw as Record<string, any> | null;
  const time = str(h?.interval?.startTime);
  if (!time) return null;
  const dt = h?.displayDateTime as Record<string, unknown> | undefined;
  const localHour = int(dt?.hours);
  const localDate = localDateFrom(dt);
  return {
    time,
    localHour,
    localDate,
    isDaytime: h?.isDaytime === true,
    tempF: temperatureF(h?.temperature),
    feelsLikeF: temperatureF(h?.feelsLikeTemperature),
    description: str(h?.weatherCondition?.description?.text) ?? '',
    conditionType: (str(h?.weatherCondition?.type) ?? '').toUpperCase(),
    precipChancePercent: percent(h?.precipitation?.probability?.percent),
    precipInches: qpfInches(h?.precipitation?.qpf),
    windMph: speedMph(h?.wind?.speed),
    gustMph: speedMph(h?.wind?.gust),
    windDirection: str(h?.wind?.direction?.cardinal),
    cloudCoverPercent: percent(h?.cloudCover),
    humidityPercent: percent(h?.relativeHumidity),
    uvIndex: int(h?.uvIndex),
    thunderstormProbabilityPercent: percent(h?.thunderstormProbability),
  };
}

function parseDay(raw: unknown): ForecastDay | null {
  const d = raw as Record<string, any> | null;
  const startTime = str(d?.interval?.startTime);
  const date = localDateFrom(d?.displayDate) ?? (startTime ? startTime.slice(0, 10) : undefined);
  if (!date || !startTime) return null;
  return {
    date,
    startTime,
    highF: temperatureF(d?.maxTemperature),
    lowF: temperatureF(d?.minTemperature),
    feelsLikeHighF: temperatureF(d?.feelsLikeMaxTemperature),
    feelsLikeLowF: temperatureF(d?.feelsLikeMinTemperature),
    day: parseDayPart(d?.daytimeForecast),
    night: parseDayPart(d?.nighttimeForecast),
    sunriseTime: str(d?.sunEvents?.sunriseTime),
    sunsetTime: str(d?.sunEvents?.sunsetTime),
    moonPhase: str(d?.moonEvents?.moonPhase),
  };
}

function parseDayPart(raw: unknown): ForecastDayPart | undefined {
  const p = raw as Record<string, any> | null;
  if (!p || typeof p !== 'object') return undefined;
  return {
    description: str(p.weatherCondition?.description?.text) ?? '',
    conditionType: (str(p.weatherCondition?.type) ?? '').toUpperCase(),
    precipChancePercent: percent(p.precipitation?.probability?.percent),
    precipInches: qpfInches(p.precipitation?.qpf),
    windMph: speedMph(p.wind?.speed),
    gustMph: speedMph(p.wind?.gust),
    windDirection: str(p.wind?.direction?.cardinal),
    cloudCoverPercent: percent(p.cloudCover),
    humidityPercent: percent(p.relativeHumidity),
    uvIndex: int(p.uvIndex),
    thunderstormProbabilityPercent: percent(p.thunderstormProbability),
  };
}

/* ─────────────────────────── HAAG §7 roof-work window ────────────────── */

/**
 * Map one forecast hour onto the safety engine's inputs. Strict: an omitted
 * reading stays `undefined` so §7 lists it as missing instead of rating on a
 * guess. A thunderstorm condition type, or a probability at/above the
 * documented mapping, is a thunderstorm watch; anything else stays unknown.
 */
export function safetyForecastFromHour(hour: ForecastHour): SafetyForecast {
  const thunderNow = hour.conditionType.includes('THUNDER');
  const tp = hour.thunderstormProbabilityPercent;
  return {
    wind_mph: hour.windMph,
    gust_mph: hour.gustMph,
    precip_chance_percent: hour.precipChancePercent,
    precipitation_expected:
      hour.precipInches !== undefined && hour.precipInches > 0 ? true : undefined,
    temp_f: hour.tempF,
    thunderstorm_watch: thunderNow
      ? true
      : tp === undefined
      ? undefined
      : tp >= THUNDERSTORM_PROBABILITY_PERCENT,
  };
}

export type RoofWorkWindow = {
  /** Best rating the window reaches. `SAFE` only when every hour rates SAFE. */
  rating: Extract<SafetyRating, 'SAFE' | 'USE_CAUTION'>;
  /** First hour of the window. */
  start: ForecastHour;
  /** Last hour of the window (inclusive). */
  end: ForecastHour;
  hours: number;
};

/** Shortest run that is worth calling a window — one hour is a gap, not a window. */
const MIN_WINDOW_HOURS = 2;

/**
 * The next contiguous run of DAYTIME hours a roofer could work, from the
 * hourly forecast, rated with HAAG §7. Pure — no I/O.
 *
 * Preference order: the first run of ≥2 consecutive SAFE hours; failing that,
 * the first run of ≥2 consecutive hours rating at least USE_CAUTION. `null`
 * when the next 48 h hold neither — the caller states that plainly rather
 * than picking the least-bad hour. Night hours never count: nobody should be
 * on a roof in the dark on this app's advice.
 */
export function findRoofWorkWindow(hours: readonly ForecastHour[]): RoofWorkWindow | null {
  const rated = hours.map((h) => ({
    hour: h,
    rating: h.isDaytime ? evaluateSafety(safetyForecastFromHour(h)).rating : ('UNSAFE' as const),
  }));

  const safe = firstRun(rated, (r) => r === 'SAFE');
  if (safe) return { rating: 'SAFE', ...safe };
  const caution = firstRun(rated, (r) => r !== 'UNSAFE');
  if (caution) return { rating: 'USE_CAUTION', ...caution };
  return null;
}

function firstRun(
  rated: readonly { hour: ForecastHour; rating: SafetyRating }[],
  ok: (r: SafetyRating) => boolean,
): { start: ForecastHour; end: ForecastHour; hours: number } | null {
  let runStart = -1;
  for (let i = 0; i <= rated.length; i++) {
    const inRun = i < rated.length && ok(rated[i].rating);
    if (inRun && runStart < 0) runStart = i;
    if (!inRun && runStart >= 0) {
      const len = i - runStart;
      if (len >= MIN_WINDOW_HOURS) {
        return { start: rated[runStart].hour, end: rated[i - 1].hour, hours: len };
      }
      runStart = -1;
    }
  }
  return null;
}

/* ─────────────────────────── unit helpers ────────────────────────────── */

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function int(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

function percent(v: unknown): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : undefined;
}

function clampInt(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(n)));
}

/** YYYY-MM-DD from a `{ year, month, day }` display date. */
function localDateFrom(dt: unknown): string | undefined {
  const d = dt as { year?: unknown; month?: unknown; day?: unknown } | undefined;
  const y = int(d?.year);
  const m = int(d?.month);
  const day = int(d?.day);
  if (y === undefined || m === undefined || day === undefined) return undefined;
  return `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** Temperature in °F from a `{ degrees, unit }` pair, honouring the unit. */
function temperatureF(temperature: unknown): number | undefined {
  const t = temperature as { degrees?: unknown; unit?: unknown } | undefined;
  const degrees = Number(t?.degrees);
  if (!Number.isFinite(degrees)) return undefined;
  const unit = String(t?.unit ?? 'CELSIUS').toUpperCase();
  return unit.startsWith('FAHRENHEIT') ? Math.round(degrees) : Math.round((degrees * 9) / 5 + 32);
}

/** Speed in mph from a `{ value, unit }` pair, honouring the unit. */
function speedMph(speed: unknown): number | undefined {
  const s = speed as { value?: unknown; unit?: unknown } | undefined;
  const value = Number(s?.value);
  if (!Number.isFinite(value)) return undefined;
  const unit = String(s?.unit ?? 'KILOMETERS_PER_HOUR').toUpperCase();
  return unit.startsWith('MILES') ? Math.round(value) : Math.round(value * 0.621371);
}

/** Liquid precipitation in inches from a `{ quantity, unit }` pair. */
function qpfInches(qpf: unknown): number | undefined {
  const q = qpf as { quantity?: unknown; unit?: unknown } | undefined;
  const quantity = Number(q?.quantity);
  if (!Number.isFinite(quantity)) return undefined;
  const unit = String(q?.unit ?? 'MILLIMETERS').toUpperCase();
  const inches = unit.startsWith('INCH') ? quantity : quantity / 25.4;
  return Math.round(inches * 100) / 100;
}

function describe(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'The weather service did not respond';
}
