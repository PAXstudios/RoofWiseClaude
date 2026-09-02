// Google Places API (New) client.
// Docs: https://developers.google.com/maps/documentation/places/web-service/text-search
//
// We use the searchText endpoint with X-Goog-FieldMask to keep the response
// small and to stay inside the SKU's "Text Search (Basic)" tier as much as
// possible. Place Details with a single Get is cheaper than the legacy
// "Find Place + Place Details" combo.
//
// Failure policy: every non-success is a typed `GoogleApiError` (see
// lib/services/googleApi.ts) so the address field can say WHY — "Address
// search isn't enabled for this app's Google key yet (Places API (New))" —
// instead of an empty dropdown. The live case on the owner's key today is a
// REQUEST_DENIED / PERMISSION_DENIED from the key's API restrictions.

import { env, isGooglePlacesConfigured } from '../env';
import {
  GoogleApiError,
  classifyGoogleFailure,
  fetchGoogle,
  legacyStatusIsFailure,
  recentGoogleDenial,
  rememberGoogleDenial,
  clearGoogleDenial,
} from './googleApi';

export class PlacesNotConfiguredError extends GoogleApiError {
  constructor() {
    super('places', 'not_configured', 'Google Places API key not configured.');
    this.name = 'PlacesNotConfiguredError';
  }
}

/**
 * Any Places failure Google (or the network) reported. `kind` says which:
 * `not_authorized` is the key-restriction case, `network` / `timeout` are
 * connectivity, everything else is `http`.
 */
export class PlacesError extends GoogleApiError {
  /** Kept for existing callers that read `.status`. */
  readonly status?: number;
  constructor(from: GoogleApiError) {
    super('places', from.kind, from.message, from.httpStatus, from.googleReason);
    this.name = 'PlacesError';
    this.status = from.httpStatus ?? undefined;
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

function raise(err: unknown): never {
  const e = err instanceof GoogleApiError ? new PlacesError(err) : err;
  if (e instanceof PlacesError) rememberGoogleDenial(e);
  throw e;
}

/** Throw the remembered denial (10-min memo) rather than re-asking Google per keystroke. */
function throwIfRecentlyDenied(): void {
  const denied = recentGoogleDenial('places');
  if (denied) throw new PlacesError(denied);
}

async function postSearch(body: Record<string, unknown>, fieldMask: string) {
  const { res, text } = await fetchGoogle('places', SEARCH_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': fieldMask,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw classifyGoogleFailure('places', res.status, text);
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GoogleApiError('places', 'http', 'Google returned an unreadable response.', res.status);
  }
  // Defensive: the legacy envelope should never come back from the New API,
  // but a proxy or a misrouted key can still hand us `status: REQUEST_DENIED`.
  if (data && legacyStatusIsFailure(data.status)) {
    throw classifyGoogleFailure('places', res.status, text);
  }
  clearGoogleDenial('places');
  return data;
}

/** Search by free-text query (address, business, etc.). */
export async function searchPlaces(
  query: string,
  opts: { biasLat?: number; biasLng?: number; biasRadiusMeters?: number } = {},
): Promise<PlacePrediction[]> {
  if (!isGooglePlacesConfigured) throw new PlacesNotConfiguredError();
  if (query.trim().length < 3) return [];
  throwIfRecentlyDenied();

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

  let data: any;
  try {
    data = await postSearch(body, SEARCH_FIELD_MASK);
  } catch (e) {
    raise(e);
  }

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
  throwIfRecentlyDenied();
  const url = `${DETAILS_URL}/${encodeURIComponent(placeId)}`;
  let p: any;
  try {
    const { res, text } = await fetchGoogle('places', url, {
      headers: {
        'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
        'X-Goog-FieldMask': DETAILS_FIELD_MASK,
      },
    });
    if (!res.ok) throw classifyGoogleFailure('places', res.status, text);
    p = JSON.parse(text);
    clearGoogleDenial('places');
  } catch (e) {
    raise(e);
  }
  return {
    placeId: String(p.id ?? placeId),
    formattedAddress: String(p.formattedAddress ?? ''),
    lat: Number(p.location?.latitude ?? 0),
    lng: Number(p.location?.longitude ?? 0),
  };
}

/**
 * Smallest request the Places API (New) accepts — one result, id only. Used
 * by the Settings "Google APIs" check. Resolves on success, throws the typed
 * error otherwise (a 200 with zero places still proves the key is allowed).
 */
export async function probePlaces(): Promise<void> {
  if (!isGooglePlacesConfigured) throw new PlacesNotConfiguredError();
  try {
    await postSearch({ textQuery: 'Dallas, TX', pageSize: 1 }, 'places.id');
  } catch (e) {
    raise(e);
  }
}
