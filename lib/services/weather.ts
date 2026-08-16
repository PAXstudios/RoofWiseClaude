// Google Weather API client (currentConditions endpoint).
// Docs: https://developers.google.com/maps/documentation/weather
//
// One provider, one call: the same `currentConditions:lookup` response feeds
// both the dashboard weather tile and the HAAG §7 safety engine
// (`lib/services/safetyEngine.ts`). Nothing here classifies conditions — it
// only maps the payload onto `SafetyForecast`. Fields the API did not report
// stay `undefined` so the engine can list them as missing inputs; we never
// substitute a plausible number (Drift #5).

import * as Location from 'expo-location';
import { env } from '../env';
import type { SafetyForecast } from './safetyEngine';

export class WeatherNotConfiguredError extends Error {
  constructor() {
    super('Google Weather API key not configured.');
    this.name = 'WeatherNotConfiguredError';
  }
}

export class WeatherServiceError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'WeatherServiceError';
  }
}

export type CurrentWeather = {
  temperatureF: number;
  feelsLikeF: number;
  description: string;
  iconCode?: string;
  humidity?: number;
  windMph?: number;
  /** Gusts in mph — absent when the response carried no gust reading. */
  gustMph?: number;
  /** Chance of precipitation 0–100 — absent when not reported. */
  precipChancePercent?: number;
  /** Thunderstorm probability 0–100 — absent when not reported. */
  thunderstormProbabilityPercent?: number;
  isDaytime: boolean;
  /**
   * HAAG §7 safety-engine inputs derived from this same response. Pass
   * straight to `evaluateSafety()` — see `getSafetyForecast()`.
   */
  safety: SafetyForecast;
};

const ENDPOINT = 'https://weather.googleapis.com/v1/currentConditions:lookup';

/**
 * Thunderstorm probability at or above this percent is treated as an active
 * thunderstorm risk for §7. The Weather API reports a probability, not an NWS
 * watch, so this is the mapping between the two — documented rather than
 * buried, and deliberately conservative (a roofer is on a steep slope).
 */
const THUNDERSTORM_PROBABILITY_PERCENT = 50;

export async function fetchCurrentWeather(coord: {
  lat: number;
  lng: number;
}): Promise<CurrentWeather> {
  if (!env.GOOGLE_WEATHER_API_KEY) throw new WeatherNotConfiguredError();

  const url =
    `${ENDPOINT}?key=${env.GOOGLE_WEATHER_API_KEY}` +
    `&location.latitude=${coord.lat}&location.longitude=${coord.lng}`;

  const res = await fetch(url);
  if (!res.ok) {
    throw new WeatherServiceError(
      `Weather ${res.status}: ${(await res.text()).slice(0, 300)}`,
      res.status,
    );
  }
  const data = await res.json();

  // Google Weather API response shape (currentConditions:lookup).
  const tempC = Number(data?.temperature?.degrees ?? 0);
  const feelsC = Number(data?.feelsLikeTemperature?.degrees ?? tempC);
  const humidity = data?.relativeHumidity != null ? Number(data.relativeHumidity) : undefined;
  const windKph = Number(data?.wind?.speed?.value ?? 0);
  const description = String(data?.weatherCondition?.description?.text ?? 'Current conditions');
  const iconCode = data?.weatherCondition?.iconBaseUri
    ? String(data.weatherCondition.iconBaseUri)
    : undefined;
  const isDaytime = data?.isDaytime ?? true;

  // Safety inputs are read strictly: a field the API omitted stays undefined
  // (the display fields above keep their long-standing lenient defaults).
  const tempF = temperatureF(data?.temperature);
  const windMph = speedMph(data?.wind?.speed);
  const gustMph = speedMph(data?.wind?.gust);
  const precipChancePercent = percent(data?.precipitation?.probability?.percent);
  const qpf = Number(data?.precipitation?.qpf?.quantity);
  const thunderstormProbabilityPercent = percent(data?.thunderstormProbability);
  const conditionType = String(data?.weatherCondition?.type ?? '').toUpperCase();
  const thunderstormNow = conditionType.includes('THUNDERSTORM');

  const safety: SafetyForecast = {
    wind_mph: windMph,
    gust_mph: gustMph,
    precip_chance_percent: precipChancePercent,
    // Measurable precipitation on the ground right now is precipitation
    // expected; a zero/absent reading is not proof of a dry window, so it
    // stays undefined rather than a confident `false`.
    precipitation_expected: Number.isFinite(qpf) && qpf > 0 ? true : undefined,
    temp_f: tempF,
    thunderstorm_watch: thunderstormWatch(thunderstormProbabilityPercent, thunderstormNow),
  };

  return {
    temperatureF: cToF(tempC),
    feelsLikeF: cToF(feelsC),
    description,
    iconCode,
    humidity,
    windMph: kphToMph(windKph),
    gustMph,
    precipChancePercent,
    thunderstormProbabilityPercent,
    isDaytime,
    safety,
  };
}

/**
 * HAAG §7 forecast inputs for the safety engine, or `null` when they are not
 * available (no API key, service unreachable, no location permission, or a
 * response with nothing usable in it). Callers pass the result straight into
 * `HaagEngineInput.forecast` / `evaluateSafety()`; `null` means "don't claim a
 * safety rating", never a synthesized calm day.
 *
 * Omit `coord` to use the device's last known position — location permission is
 * only *read*, never requested from here, so a background engine call cannot
 * pop a permission dialog.
 */
export async function getSafetyForecast(coord?: {
  lat: number;
  lng: number;
}): Promise<SafetyForecast | null> {
  try {
    const at = coord ?? (await deviceCoord());
    if (!at) return null;
    const weather = await fetchCurrentWeather(at);
    return hasSafetySignal(weather.safety) ? weather.safety : null;
  } catch {
    return null;
  }
}

/**
 * True when the forecast carries enough real readings to be worth rating.
 * An all-empty forecast would rate USE_CAUTION purely because everything is
 * missing — a placeholder wearing a rating's clothes, so surfaces skip it.
 */
export function hasSafetySignal(forecast: SafetyForecast | null | undefined): boolean {
  if (!forecast) return false;
  const hasWind = forecast.wind_mph != null || forecast.gust_mph != null;
  return hasWind && forecast.temp_f != null;
}

async function deviceCoord(): Promise<{ lat: number; lng: number } | null> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.status !== 'granted') return null;
  const pos = await Location.getLastKnownPositionAsync();
  const fix = pos ?? (await Location.getCurrentPositionAsync({}));
  if (!fix) return null;
  return { lat: fix.coords.latitude, lng: fix.coords.longitude };
}

function thunderstormWatch(
  probabilityPercent: number | undefined,
  thunderstormNow: boolean,
): boolean | undefined {
  if (thunderstormNow) return true;
  if (probabilityPercent == null) return undefined;
  return probabilityPercent >= THUNDERSTORM_PROBABILITY_PERCENT;
}

/** Speed in mph from a `{ value, unit }` pair, honouring the reported unit. */
function speedMph(speed: unknown): number | undefined {
  const s = speed as { value?: unknown; unit?: unknown } | undefined;
  const value = Number(s?.value);
  if (!Number.isFinite(value)) return undefined;
  const unit = String(s?.unit ?? 'KILOMETERS_PER_HOUR').toUpperCase();
  return unit.startsWith('MILES') ? Math.round(value) : kphToMph(value);
}

/** Temperature in °F from a `{ degrees, unit }` pair. */
function temperatureF(temperature: unknown): number | undefined {
  const t = temperature as { degrees?: unknown; unit?: unknown } | undefined;
  const degrees = Number(t?.degrees);
  if (!Number.isFinite(degrees)) return undefined;
  const unit = String(t?.unit ?? 'CELSIUS').toUpperCase();
  return unit.startsWith('FAHRENHEIT') ? Math.round(degrees) : cToF(degrees);
}

function percent(value: unknown): number | undefined {
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function kphToMph(k: number): number {
  return Math.round(k * 0.621371);
}
