import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase, isSupabaseConfigured } from '../supabase';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';

const NOT_CONFIGURED_MESSAGE =
  'Backend not configured on this machine. In the project folder: copy ' +
  '.env.local.example to .env.local, fill in the Supabase URL + anon key, ' +
  'then restart with `npx expo start --clear`.';

// Central gate — every network-touching auth action calls this first so a
// missing .env.local reads as clear guidance, not "network request failed".
function assertConfigured(set: (partial: Partial<AuthState>) => void) {
  if (isSupabaseConfigured) return;
  set({ loading: false, error: NOT_CONFIGURED_MESSAGE });
  throw new Error(NOT_CONFIGURED_MESSAGE);
}

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;

  initialize: () => Promise<() => void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  /** `fullName` is required at the UI layer; it becomes Supabase user
   *  metadata and seeds the inspector profile that HAAG reports cite. */
  signUpWithEmail: (email: string, password: string, fullName: string) => Promise<void>;
  signInWithAppleIdToken: (idToken: string, nonce?: string) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
};

export const useAuthStore = create<AuthState>((set, get) => ({
  session: null,
  user: null,
  loading: false,
  error: null,
  initialized: false,

  initialize: async () => {
    const { data } = await supabase.auth.getSession();
    set({
      session: data.session,
      user: data.session?.user ?? null,
      initialized: true,
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null });
    });

    return () => sub.subscription.unsubscribe();
  },

  signInWithEmail: async (email, password) => {
    assertConfigured(set);
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;
  },

  signUpWithEmail: async (email, password, fullName) => {
    assertConfigured(set);
    set({ loading: true, error: null });
    const name = fullName.trim();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: name } },
    });
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;

    // Seed the inspector profile so the name appears on HAAG reports and
    // proposals without the user having to re-enter it in Settings.
    if (name) {
      const store = useInspectorProfileStore.getState();
      if (!store.profile.fullName) store.update({ fullName: name });
    }
  },

  signInWithAppleIdToken: async (idToken, nonce) => {
    assertConfigured(set);
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signInWithIdToken({
      provider: 'apple',
      token: idToken,
      nonce,
    });
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;
  },

  sendPasswordReset: async (email) => {
    assertConfigured(set);
    set({ loading: true, error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;
  },

  signOut: async () => {
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signOut();
    set({ loading: false, error: error?.message ?? null, session: null, user: null });
  },

  clearError: () => set({ error: null }),
}));
