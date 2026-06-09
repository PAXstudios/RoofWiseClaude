// Lightweight Google Geocoding client. Used to attach a centroid
// (lat/lng) to a Service Area label so it can render as a circle on
// the Map.
//
// Docs: https://developers.google.com/maps/documentation/geocoding/start

import { env, isGoogleMapsConfigured } from '../env';

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

export class GeocodingNotConfiguredError extends Error {
  constructor() {
    super('Google Geocoding API key not configured.');
    this.name = 'GeocodingNotConfiguredError';
  }
}

export type Geocoded = {
  lat: number;
  lng: number;
  formattedAddress: string;
};

export async function geocodeText(text: string): Promise<Geocoded | null> {
  if (!isGoogleMapsConfigured) throw new GeocodingNotConfiguredError();
  const url = `${ENDPOINT}?address=${encodeURIComponent(text)}&key=${env.GOOGLE_GEOCODING_API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const first = Array.isArray(data?.results) ? data.results[0] : null;
  if (!first) return null;
  const loc = first.geometry?.location;
  if (!loc) return null;
  return {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    formattedAddress: String(first.formatted_address ?? text),
  };
}
