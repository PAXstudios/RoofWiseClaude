// Google Map Tiles API session cache.
//
// Expo Go on iOS cannot load Google's native map SDK, so components/map/Map.tsx
// falls back to Apple Maps there and lib/services/mapTiles.ts paints Google's
// own road/satellite imagery over it through the Map Tiles API. A tile session
// is a short token Google issues per map type; it lasts about two weeks and
// every tile request must carry it. Persisted so a relaunch reuses the session
// instead of spending a createSession call, and so Diagnostics can show the
// last real reason imagery was unavailable (Drift #5: say what happened, never
// synthesize a map).
//
// Nothing in here fabricates a session: `sessions` only ever holds what Google
// returned, and `lastError` only ever holds what Google (or the network) said.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type TileMapType = 'roadmap' | 'satellite';

export type TileSession = {
  /** Opaque session token from createSession — goes on every tile URL. */
  session: string;
  /** Epoch ms when Google says the session stops working. */
  expiresAt: number;
  /** Epoch ms when we obtained it (Diagnostics + refresh scheduling). */
  createdAt: number;
  tileWidth: number;
  tileHeight: number;
  /** e.g. "png" / "jpeg" — informational. */
  imageFormat: string;
};

export type TileError = {
  at: number;
  mapType: TileMapType;
  /** Plain-words reason, already shaped for a Settings/Diagnostics row. */
  reason: string;
  /** HTTP status when the failure came from Google; null for network/timeout. */
  httpStatus: number | null;
  /** Google's machine reason (e.g. API_KEY_SERVICE_BLOCKED), when present. */
  googleReason: string | null;
};

type State = {
  sessions: Partial<Record<TileMapType, TileSession>>;
  lastError: TileError | null;
  /** Epoch ms of the most recent createSession attempt (success or not). */
  lastAttemptAt: number | null;
  /** Epoch ms of the most recent successful createSession. */
  lastSuccessAt: number | null;

  setSession: (mapType: TileMapType, session: TileSession) => void;
  clearSession: (mapType: TileMapType) => void;
  setLastError: (error: TileError) => void;
  clearLastError: () => void;
  noteAttempt: (at: number) => void;
};

export const useMapTilesStore = create<State>()(
  persist(
    (set) => ({
      sessions: {},
      lastError: null,
      lastAttemptAt: null,
      lastSuccessAt: null,

      setSession: (mapType, session) =>
        set((s) => ({
          sessions: { ...s.sessions, [mapType]: session },
          lastError: null,
          lastSuccessAt: session.createdAt,
        })),
      clearSession: (mapType) =>
        set((s) => {
          const next = { ...s.sessions };
          delete next[mapType];
          return { sessions: next };
        }),
      setLastError: (error) => set({ lastError: error }),
      clearLastError: () => set({ lastError: null }),
      noteAttempt: (at) => set({ lastAttemptAt: at }),
    }),
    {
      name: 'roofwise.mapTiles.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        sessions: s.sessions,
        lastError: s.lastError,
        lastSuccessAt: s.lastSuccessAt,
      }),
    },
  ),
);

/** True when a stored session is still inside Google's expiry window. */
export function isTileSessionValid(
  session: TileSession | undefined | null,
  now: number = Date.now(),
): session is TileSession {
  return Boolean(session && session.session.length > 0 && session.expiresAt > now);
}
