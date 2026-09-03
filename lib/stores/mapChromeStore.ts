// Map chrome preferences — the small, per-screen memory behind the shared map
// control system (components/map/controls): whether the control rail is
// tucked away, which drawer detent the roofer left the panel at, and whether
// they prefer satellite imagery. Remembered per screen (Storm Tracer and
// Knock mode want different things — a route is walked on satellite, a storm
// is browsed on roads) and persisted so the map opens the way it was left.
//
// Nothing here is data (Drift #5) — it is layout memory only, and every
// reader falls back to DEFAULTS when a screen has no entry yet.

import { useMemo } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/** The two map screens that share the control system. */
export type MapChromeScreen = 'storm' | 'knock';

/** Bottom-drawer resting positions (components/map/controls/MapDrawer.tsx). */
export type DrawerDetent = 'peek' | 'half' | 'full';

export type MapChromePrefs = {
  /** Control rail collapsed to its chevron. */
  tucked: boolean;
  /** Where the bottom drawer was last left. */
  detent: DrawerDetent;
  /** Aerial imagery instead of the road map. */
  satellite: boolean;
};

export const MAP_CHROME_DEFAULTS: MapChromePrefs = {
  tucked: false,
  detent: 'peek',
  satellite: false,
};

type MapChromeState = {
  screens: Partial<Record<MapChromeScreen, MapChromePrefs>>;
  setTucked: (screen: MapChromeScreen, tucked: boolean) => void;
  setDetent: (screen: MapChromeScreen, detent: DrawerDetent) => void;
  setSatellite: (screen: MapChromeScreen, satellite: boolean) => void;
};

function patch(
  screens: MapChromeState['screens'],
  screen: MapChromeScreen,
  change: Partial<MapChromePrefs>,
): MapChromeState['screens'] {
  return { ...screens, [screen]: { ...MAP_CHROME_DEFAULTS, ...screens[screen], ...change } };
}

export const useMapChromeStore = create<MapChromeState>()(
  persist(
    (set) => ({
      screens: {},
      setTucked: (screen, tucked) => set((s) => ({ screens: patch(s.screens, screen, { tucked }) })),
      setDetent: (screen, detent) => set((s) => ({ screens: patch(s.screens, screen, { detent }) })),
      setSatellite: (screen, satellite) =>
        set((s) => ({ screens: patch(s.screens, screen, { satellite }) })),
    }),
    {
      name: 'roofwise.mapChrome.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ screens: s.screens }),
    },
  ),
);

/**
 * One screen's chrome prefs with its setters pre-bound, defaults applied.
 * `const chrome = useMapChrome('storm'); chrome.tucked; chrome.setTucked(true)`.
 */
export function useMapChrome(screen: MapChromeScreen) {
  const prefs = useMapChromeStore((s) => s.screens[screen]);
  const setTucked = useMapChromeStore((s) => s.setTucked);
  const setDetent = useMapChromeStore((s) => s.setDetent);
  const setSatellite = useMapChromeStore((s) => s.setSatellite);
  return useMemo(
    () => ({
      ...MAP_CHROME_DEFAULTS,
      ...prefs,
      setTucked: (tucked: boolean) => setTucked(screen, tucked),
      setDetent: (detent: DrawerDetent) => setDetent(screen, detent),
      setSatellite: (satellite: boolean) => setSatellite(screen, satellite),
    }),
    [prefs, screen, setTucked, setDetent, setSatellite],
  );
}
