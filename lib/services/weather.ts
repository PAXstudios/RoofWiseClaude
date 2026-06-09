// Google Weather API client (currentConditions endpoint).
// Docs: https://developers.google.com/maps/documentation/weather

import { env } from '../env';

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
  isDaytime: boolean;
};

const ENDPOINT = 'https://weather.googleapis.com/v1/currentConditions:lookup';

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

  return {
    temperatureF: cToF(tempC),
    feelsLikeF: cToF(feelsC),
    description,
    iconCode,
    humidity,
    windMph: kphToMph(windKph),
    isDaytime,
  };
}

function cToF(c: number): number {
  return Math.round((c * 9) / 5 + 32);
}

function kphToMph(k: number): number {
  return Math.round(k * 0.621371);
}
