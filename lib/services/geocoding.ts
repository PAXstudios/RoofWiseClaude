// Lightweight Google Geocoding client.
//
//   geocodeText      "Plano, TX"  → centroid, so a Service Area renders as a
//                                    circle on the Map (and the estimator can
//                                    measure a hand-typed address).
//   reverseGeocode   lat/lng      → street address, for "Use my location".
//
// Docs: https://developers.google.com/maps/documentation/geocoding/start
//
// Failure policy: the Geocoding API is a LEGACY web service — a refused key
// comes back as HTTP 200 with `status: "REQUEST_DENIED"` and an
// `error_message`, so `res.ok` alone proves nothing. Every non-success is a
// typed `GoogleApiError` (lib/services/googleApi.ts); ZERO_RESULTS is the
// one honest `null`. Callers that only wanted a best-effort centroid keep
// swallowing the throw; the address fields show `describeGoogleApiError`.

import { env, isGoogleMapsConfigured } from '../env';
import {
  GoogleApiError,
  classifyGoogleFailure,
  clearGoogleDenial,
  fetchGoogle,
  legacyStatusIsFailure,
  recentGoogleDenial,
  rememberGoogleDenial,
} from './googleApi';

const ENDPOINT = 'https://maps.googleapis.com/maps/api/geocode/json';

export class GeocodingNotConfiguredError extends GoogleApiError {
  constructor() {
    super('geocoding', 'not_configured', 'Google Geocoding API key not configured.');
    this.name = 'GeocodingNotConfiguredError';
  }
}

/** Any geocoding failure Google (or the network) reported; `kind` says which. */
export class GeocodingError extends GoogleApiError {
  constructor(from: GoogleApiError) {
    super('geocoding', from.kind, from.message, from.httpStatus, from.googleReason);
    this.name = 'GeocodingError';
  }
}

export type Geocoded = {
  lat: number;
  lng: number;
  formattedAddress: string;
  /** Locality ("Plano"), when Google reported one. */
  city?: string;
  /** Two-letter state code ("TX"), when Google reported one. */
  stateCode?: string;
  postalCode?: string;
};

function raise(err: unknown): never {
  const e = err instanceof GoogleApiError ? new GeocodingError(err) : err;
  if (e instanceof GeocodingError) rememberGoogleDenial(e);
  throw e;
}

async function geocodeRequest(query: string): Promise<Geocoded | null> {
  if (!isGoogleMapsConfigured) throw new GeocodingNotConfiguredError();
  const denied = recentGoogleDenial('geocoding');
  if (denied) throw new GeocodingError(denied);

  const url = `${ENDPOINT}?${query}&key=${env.GOOGLE_GEOCODING_API_KEY}`;
  const { res, text } = await fetchGoogle('geocoding', url);
  if (!res.ok) throw classifyGoogleFailure('geocoding', res.status, text);

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    throw new GoogleApiError('geocoding', 'http', 'Google returned an unreadable response.', res.status);
  }
  if (legacyStatusIsFailure(data?.status)) {
    throw classifyGoogleFailure('geocoding', res.status, text);
  }
  clearGoogleDenial('geocoding');

  const first = Array.isArray(data?.results) ? data.results[0] : null;
  if (!first) return null;
  const loc = first.geometry?.location;
  if (!loc) return null;

  const components: any[] = Array.isArray(first.address_components) ? first.address_components : [];
  const find = (type: string) => components.find((c) => Array.isArray(c?.types) && c.types.includes(type));
  const city = find('locality')?.long_name ?? find('postal_town')?.long_name ?? find('sublocality')?.long_name;
  const stateCode = find('administrative_area_level_1')?.short_name;
  const postalCode = find('postal_code')?.long_name;

  return {
    lat: Number(loc.lat),
    lng: Number(loc.lng),
    formattedAddress: String(first.formatted_address ?? ''),
    city: typeof city === 'string' ? city : undefined,
    stateCode: typeof stateCode === 'string' ? stateCode : undefined,
    postalCode: typeof postalCode === 'string' ? postalCode : undefined,
  };
}

/** Free text → coordinates. `null` only when Google genuinely found nothing. */
export async function geocodeText(text: string): Promise<Geocoded | null> {
  try {
    const out = await geocodeRequest(`address=${encodeURIComponent(text)}`);
    if (out && !out.formattedAddress) out.formattedAddress = text;
    return out;
  } catch (e) {
    raise(e);
  }
}

/** Coordinates → nearest street address. `null` only when Google found nothing there. */
export async function reverseGeocode(coord: { lat: number; lng: number }): Promise<Geocoded | null> {
  try {
    return await geocodeRequest(
      `latlng=${encodeURIComponent(`${coord.lat},${coord.lng}`)}` +
        `&result_type=street_address%7Cpremise%7Csubpremise%7Croute%7Clocality`,
    );
  } catch (e) {
    raise(e);
  }
}

/**
 * Smallest request the Geocoding API accepts. Resolves on success (even
 * ZERO_RESULTS proves the key is allowed); throws the typed error otherwise.
 * Used by the Settings "Google APIs" check.
 */
export async function probeGeocoding(): Promise<void> {
  try {
    await geocodeRequest(`address=${encodeURIComponent('Dallas, TX')}`);
  } catch (e) {
    raise(e);
  }
}
