// Single source of truth for client-side env vars.
//
// At build time Expo loads `.env.local` (gitignored) into `process.env.*`
// for any var prefixed with `EXPO_PUBLIC_`. The fallbacks below let the app
// keep building even when `.env.local` is missing, but every fallback that
// touches a billable API should be considered exposed and rotated before
// production. See the `.env.local.example` template for the canonical list
// of variables and the rotation plan.

const FALLBACK_SUPABASE_URL = 'https://mzsabjegtxmzlfpxmmfm.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16c2FiamVndHhtemxmcHhtbWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDQyNzIsImV4cCI6MjA5NDg4MDI3Mn0.llzXp4wYKeR1DjBTah7YzVQEaQALla3UI5TmvU2QGJc';

function pick(value: string | undefined, fallback = ''): string {
  return value && value.length > 0 ? value : fallback;
}

const googleMapsKey = pick(process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY);

export const env = {
  // Supabase
  SUPABASE_URL: pick(process.env.EXPO_PUBLIC_SUPABASE_URL, FALLBACK_SUPABASE_URL),
  SUPABASE_ANON_KEY: pick(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, FALLBACK_SUPABASE_ANON_KEY),

  // Gemini
  GEMINI_API_KEY: pick(process.env.EXPO_PUBLIC_GEMINI_API_KEY),
  GEMINI_MODEL: pick(process.env.EXPO_PUBLIC_GEMINI_MODEL, 'gemini-2.5-pro'),

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
  CORRECTIONS_ENDPOINT: pick(
    process.env.EXPO_PUBLIC_CORRECTIONS_ENDPOINT,
    'https://roofwise-backend.vercel.app/api/v1/corrections/batch',
  ),
  NOAA_USER_AGENT: pick(
    process.env.EXPO_PUBLIC_NOAA_USER_AGENT,
    'RoofWise iOS / contact@roofwise.app',
  ),

  // Feature flags
  USE_LIVE_AR: pick(process.env.EXPO_PUBLIC_USE_LIVE_AR, 'false') === 'true',
  USE_STRUCTURED_CONFIDENCE:
    pick(process.env.EXPO_PUBLIC_USE_STRUCTURED_CONFIDENCE, 'true') === 'true',
  REQUIRE_AUTH: pick(process.env.EXPO_PUBLIC_REQUIRE_AUTH, 'false') === 'true',
};

export const isGeminiConfigured = env.GEMINI_API_KEY.length > 0;
export const isGoogleMapsConfigured = env.GOOGLE_MAPS_API_KEY.length > 0;
export const isGooglePlacesConfigured = env.GOOGLE_PLACES_API_KEY.length > 0;
export const isGoogleSolarConfigured = env.GOOGLE_SOLAR_API_KEY.length > 0;
