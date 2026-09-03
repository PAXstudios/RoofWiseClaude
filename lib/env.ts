// Single source of truth for client-side env vars.
//
// At build time Expo loads `.env.local` (gitignored) into `process.env.*`
// for any var prefixed with `EXPO_PUBLIC_`. There are NO credential
// fallbacks here — a missing `.env.local` must produce a friendly
// "not configured" state, never a request against a stale project.
// (A dead-project fallback used to live here and produced the infamous
// "network request failed" at login on any machine without env keys.)
// See `.env.local.example` for the canonical variable list.

function pick(value: string | undefined, fallback = ''): string {
  // Trimmed: a whitespace-only `EXPO_PUBLIC_*` line in .env.local must fall
  // through to the fallback, not ship an empty header value.
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : fallback;
}

/**
 * User-Agent sent to the Iowa Environmental Mesonet (NOAA LSR mirror).
 * IEM asks automated clients to identify themselves with a contact address
 * and may throttle or reject anonymous/empty agents. This fallback guarantees
 * a missing `EXPO_PUBLIC_NOAA_USER_AGENT` never sends an agent Mesonet
 * rejects — do not reduce it to the bare app name.
 */
const NOAA_USER_AGENT_FALLBACK = 'RoofWise/1.0 (iOS; contact@roofwise.app)';

const googleMapsKey = pick(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

export const env = {
  // Supabase
  SUPABASE_URL: pick(process.env.EXPO_PUBLIC_SUPABASE_URL),
  SUPABASE_ANON_KEY: pick(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY),

  // Gemini — newest Flash by default (owner directive 2026-09-01). The value
  // is only the FIRST model tried: lib/services/gemini.ts falls through a
  // deprecation chain when Google retires a model id (HTTP 404 / "no longer
  // available"), so a stale override here degrades to the next Flash instead
  // of breaking every analysis. `gemini-2.5-pro` is retired for new keys.
  GEMINI_API_KEY: pick(process.env.EXPO_PUBLIC_GEMINI_API_KEY),
  GEMINI_MODEL: pick(process.env.EXPO_PUBLIC_GEMINI_MODEL, 'gemini-3.8-flash'),

  // Google Maps Platform — base key + per-platform/per-service overrides
  GOOGLE_MAPS_API_KEY: googleMapsKey,
  GOOGLE_MAPS_IOS_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_MAPS_IOS_KEY, googleMapsKey),
  GOOGLE_MAPS_ANDROID_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_MAPS_ANDROID_KEY, googleMapsKey),
  GOOGLE_MAPS_WEB_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY, googleMapsKey),

  GOOGLE_PLACES_API_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY, googleMapsKey),
  GOOGLE_SOLAR_API_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_SOLAR_API_KEY, googleMapsKey),
  GOOGLE_GEOCODING_API_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_GEOCODING_API_KEY, googleMapsKey),
  GOOGLE_WEATHER_API_KEY: pick(process.env.EXPO_PUBLIC_GOOGLE_WEATHER_API_KEY, googleMapsKey),

  // App
  // (Corrections used to POST to EXPO_PUBLIC_CORRECTIONS_ENDPOINT, a Vercel
  // placeholder that never existed. They now upsert into Supabase
  // `public.corrections` through lib/services/correctionsSync.ts; the var
  // is gone on purpose — do not reintroduce a second write path.)
  NOAA_USER_AGENT: pick(process.env.EXPO_PUBLIC_NOAA_USER_AGENT, NOAA_USER_AGENT_FALLBACK),

  // Feature flags
  USE_LIVE_AR: pick(process.env.EXPO_PUBLIC_USE_LIVE_AR, 'false') === 'true',
  USE_STRUCTURED_CONFIDENCE:
    pick(process.env.EXPO_PUBLIC_USE_STRUCTURED_CONFIDENCE, 'true') === 'true',
  REQUIRE_AUTH: pick(process.env.EXPO_PUBLIC_REQUIRE_AUTH, 'false') === 'true',
};

export const isSupabaseConfigured =
  env.SUPABASE_URL.length > 0 && env.SUPABASE_ANON_KEY.length > 0;
export const isGeminiConfigured = env.GEMINI_API_KEY.length > 0;
export const isGoogleMapsConfigured = env.GOOGLE_MAPS_API_KEY.length > 0;
export const isGooglePlacesConfigured = env.GOOGLE_PLACES_API_KEY.length > 0;
export const isGoogleSolarConfigured = env.GOOGLE_SOLAR_API_KEY.length > 0;
export const isWeatherConfigured = env.GOOGLE_WEATHER_API_KEY.length > 0;
