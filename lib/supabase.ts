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

export const supabase = createClient(
  isSupabaseConfigured ? env.SUPABASE_URL : PLACEHOLDER_URL,
  isSupabaseConfigured ? env.SUPABASE_ANON_KEY : PLACEHOLDER_KEY,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
);

export { isSupabaseConfigured };
