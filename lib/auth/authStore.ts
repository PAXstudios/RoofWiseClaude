import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../supabase';

type AuthState = {
  session: Session | null;
  user: User | null;
  loading: boolean;
  error: string | null;
  initialized: boolean;

  initialize: () => Promise<() => void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  signUpWithEmail: (email: string, password: string) => Promise<void>;
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
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;
  },

  signUpWithEmail: async (email, password) => {
    set({ loading: true, error: null });
    const { error } = await supabase.auth.signUp({ email, password });
    set({ loading: false, error: error?.message ?? null });
    if (error) throw error;
  },

  signInWithAppleIdToken: async (idToken, nonce) => {
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
