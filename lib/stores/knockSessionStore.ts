import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Knock, KnockOutcome, KnockSession } from '../models/types';

let counter = 0;

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${counter++}`;
}

type KnockSessionState = {
  activeSession: KnockSession | null;
  archive: KnockSession[];

  start: (routeStormAlertId?: string) => KnockSession;
  end: () => KnockSession | null;
  logKnock: (input: {
    lat: number;
    lng: number;
    address?: string;
    outcome: KnockOutcome;
    notes?: string;
    followUpAt?: string;
    createdLeadId?: string;
  }) => Knock | null;
};

export const useKnockSessionStore = create<KnockSessionState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      archive: [],

      start: (routeStormAlertId) => {
        const session: KnockSession = {
          id: newId('ks'),
          startedAt: new Date().toISOString(),
          routeStormAlertId,
          knocks: [],
        };
        set({ activeSession: session });
        return session;
      },

      end: () => {
        const active = get().activeSession;
        if (!active) return null;
        const ended: KnockSession = { ...active, endedAt: new Date().toISOString() };
        set((s) => ({
          activeSession: null,
          archive: [ended, ...s.archive].slice(0, 100),
        }));
        return ended;
      },

      logKnock: (input) => {
        const active = get().activeSession;
        if (!active) return null;
        const knock: Knock = {
          id: newId('kn'),
          sessionId: active.id,
          lat: input.lat,
          lng: input.lng,
          address: input.address,
          outcome: input.outcome,
          notes: input.notes,
          followUpAt: input.followUpAt,
          createdLeadId: input.createdLeadId,
          createdAt: new Date().toISOString(),
        };
        set({
          activeSession: { ...active, knocks: [...active.knocks, knock] },
        });
        return knock;
      },
    }),
    {
      name: 'roofwise.knockSessions.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ activeSession: s.activeSession, archive: s.archive }),
    },
  ),
);
