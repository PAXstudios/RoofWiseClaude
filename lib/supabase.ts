import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { env, isSupabaseConfigured } from './env';

// When `.env.local` is missing we still construct a client so imports don't
// throw at module load — but with a syntactically-valid placeholder that can
// never be reached. Every network-touching call site must gate on
// `isSupabaseConfigured` (auth store does this centrally) so the user sees
// "not configured" guidance instead of "network request failed".
const PLACEHOLDER_URL = 'https://supabase-not-configured.invalid';
const PLACEHOLDER_KEY = 'not-configured';

// The static web export (`expo export --platform web`, output: 'static')
// evaluates this module in Node to prerender routes. AsyncStorage's web
// backend dereferences `window.localStorage` there and crashes the export,
// and there is no session to recover anyway. Use a noop storage with
// persistence off in that environment; the real browser (and React Native,
// where `window` exists) re-evaluates this module at runtime and gets full
// AsyncStorage-backed persistence.
const canPersistSession = typeof window !== 'undefined';
const noopStorage = {
  getItem: async (_key: string): Promise<string | null> => null,
  setItem: async (_key: string, _value: string): Promise<void> => {},
  removeItem: async (_key: string): Promise<void> => {},
};

export const supabase = createClient(
  isSupabaseConfigured ? env.SUPABASE_URL : PLACEHOLDER_URL,
  isSupabaseConfigured ? env.SUPABASE_ANON_KEY : PLACEHOLDER_KEY,
  {
    auth: {
      storage: canPersistSession ? AsyncStorage : noopStorage,
      autoRefreshToken: canPersistSession,
      persistSession: canPersistSession,
      detectSessionInUrl: false,
    },
  },
);

export { isSupabaseConfigured };
