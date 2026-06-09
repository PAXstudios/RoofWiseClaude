// Google Places API (New) client.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//
// We use the searchText endpoint with X-Goog-FieldMask to keep the response
// small and to stay inside the SKU's "Text Search (Basic)" tier as much as
// possible. Place Details with a single Get is cheaper than the legacy
// "Find Place + Place Details" combo.

import { env, isGooglePlacesConfigured } from '../env';

export class PlacesNotConfiguredError extends Error {
  constructor() {
    super('Google Places API key not configured.');
    this.name = 'PlacesNotConfiguredError';
  }
}

export class PlacesError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'PlacesError';
  }
}

export type PlacePrediction = {
  placeId: string;
  description: string;
  primaryText: string;
  secondaryText: string;
  lat?: number;
  lng?: number;
};

const SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const DETAILS_URL = 'https://places.googleapis.com/v1/places';

const SEARCH_FIELD_MASK = [
  'places.id',
  'places.displayName',
  'places.formattedAddress',
  'places.shortFormattedAddress',
  'places.location',
].join(',');

const DETAILS_FIELD_MASK = [
  'id',
  'displayName',
  'formattedAddress',
  'location',
  'addressComponents',
].join(',');

/** Search by free-text query (address, business, etc.). */
export async function searchPlaces(
  query: string,
  opts: { biasLat?: number; biasLng?: number; biasRadiusMeters?: number } = {},
): Promise<PlacePrediction[]> {
  if (!isGooglePlacesConfigured) throw new PlacesNotConfiguredError();
  if (query.trim().length < 3) return [];

  const body: Record<string, unknown> = {
    textQuery: query.trim(),
    pageSize: 6,
  };
  if (opts.biasLat !== undefined && opts.biasLng !== undefined) {
    body.locationBias = {
      circle: {
        center: { latitude: opts.biasLat, longitude: opts.biasLng },
        radius: opts.biasRadiusMeters ?? 50_000,
      },
    };
  }

  const res = await fetch(SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': SEARCH_FIELD_MASK,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new PlacesError(`Places ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  }

  const data = await res.json();
  const places: any[] = Array.isArray(data?.places) ? data.places : [];
  return places.map((p) => ({
    placeId: String(p.id ?? ''),
    description: String(p.formattedAddress ?? p.displayName?.text ?? ''),
    primaryText: String(p.displayName?.text ?? p.formattedAddress ?? ''),
    secondaryText: String(p.formattedAddress ?? ''),
    lat: typeof p.location?.latitude === 'number' ? p.location.latitude : undefined,
    lng: typeof p.location?.longitude === 'number' ? p.location.longitude : undefined,
  }));
}

export type PlaceDetails = {
  placeId: string;
  formattedAddress: string;
  lat: number;
  lng: number;
};

/** Fetch details for a place ID (lat/lng + formatted address). */
export async function getPlaceDetails(placeId: string): Promise<PlaceDetails> {
  if (!isGooglePlacesConfigured) throw new PlacesNotConfiguredError();
  const url = `${DETAILS_URL}/${encodeURIComponent(placeId)}`;
  const res = await fetch(url, {
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': DETAILS_FIELD_MASK,
    },
  });
  if (!res.ok) {
    throw new PlacesError(`Places details ${res.status}: ${(await res.text()).slice(0, 300)}`, res.status);
  }
  const p = await res.json();
  return {
    placeId: String(p.id ?? placeId),
    formattedAddress: String(p.formattedAddress ?? ''),
    lat: Number(p.location?.latitude ?? 0),
    lng: Number(p.location?.longitude ?? 0),
  };
}
