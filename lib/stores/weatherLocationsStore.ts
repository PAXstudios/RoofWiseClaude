import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * A place the roofer wants weather for, beyond wherever the phone is.
 *
 * "Current location" is NOT stored here — it is always the first page of the
 * weather screen and resolves live from the device, so it can never go stale
 * in storage. These are the added addresses that follow it.
 */
export type WeatherLocation = {
  id: string;
  /** Short display name — a street or a city ("Plano, TX", "1562 Marilla St"). */
  label: string;
  /** Full address as the user picked or typed it. */
  address: string;
  lat: number;
  lng: number;
  /** Two-letter state when it could be read off the address; storm queries use it. */
  stateCode?: string;
  createdAt: string;
};

/** Two points closer than this are the same place — a re-add returns the original. */
const DUPLICATE_RADIUS_MILES = 0.05;

let counter = 0;

function newId(): string {
  return `wxloc_${Date.now()}_${counter++}`;
}

type WeatherLocationsState = {
  locations: WeatherLocation[];

  /**
   * Add a location, returning it. Adding a place within ~80 m of one already
   * saved returns the existing entry unchanged instead of a duplicate page.
   */
  add: (input: {
    label: string;
    address: string;
    lat: number;
    lng: number;
    stateCode?: string;
  }) => WeatherLocation;
  remove: (id: string) => void;
  /** Move an entry one step earlier (`-1`) or later (`+1`) in the page order. */
  move: (id: string, direction: -1 | 1) => void;
  clear: () => void;
};

export const useWeatherLocationsStore = create<WeatherLocationsState>()(
  persist(
    (set, get) => ({
      locations: [],

      add: (input) => {
        const existing = get().locations.find(
          (l) => haversineMiles(l.lat, l.lng, input.lat, input.lng) <= DUPLICATE_RADIUS_MILES,
        );
        if (existing) return existing;
        const location: WeatherLocation = {
          id: newId(),
          label: input.label.trim() || input.address.trim(),
          address: input.address.trim(),
          lat: input.lat,
          lng: input.lng,
          stateCode: input.stateCode,
          createdAt: new Date().toISOString(),
        };
        set((s) => ({ locations: [...s.locations, location] }));
        return location;
      },

      remove: (id) => set((s) => ({ locations: s.locations.filter((l) => l.id !== id) })),

      move: (id, direction) =>
        set((s) => {
          const from = s.locations.findIndex((l) => l.id === id);
          const to = from + direction;
          if (from < 0 || to < 0 || to >= s.locations.length) return s;
          const next = [...s.locations];
          const [item] = next.splice(from, 1);
          next.splice(to, 0, item);
          return { locations: next };
        }),

      clear: () => set({ locations: [] }),
    }),
    {
      name: 'roofwise.weatherLocations.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ locations: s.locations }),
    },
  ),
);

function haversineMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
