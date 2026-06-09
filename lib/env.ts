// Single source of truth for client-side env vars. Anything missing falls back
// to the public Supabase project defaults so the app keeps building even
// before `.env.local` is wired up.
//
// Real secrets should never be committed. Put them in `.env.local` (gitignored).

const FALLBACK_SUPABASE_URL = 'https://mzsabjegtxmzlfpxmmfm.supabase.co';
const FALLBACK_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16c2FiamVndHhtemxmcHhtbWZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzkzMDQyNzIsImV4cCI6MjA5NDg4MDI3Mn0.llzXp4wYKeR1DjBTah7YzVQEaQALla3UI5TmvU2QGJc';

function pick(value: string | undefined, fallback: string): string {
  return value && value.length > 0 ? value : fallback;
}

export const env = {
  SUPABASE_URL: pick(process.env.EXPO_PUBLIC_SUPABASE_URL, FALLBACK_SUPABASE_URL),
  SUPABASE_ANON_KEY: pick(process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY, FALLBACK_SUPABASE_ANON_KEY),
  GEMINI_API_KEY: pick(process.env.EXPO_PUBLIC_GEMINI_API_KEY, ''),
};

export const isGeminiConfigured = env.GEMINI_API_KEY.length > 0;
