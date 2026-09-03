// Last-known user coords for biasing Places autocomplete.
// We grab a single low-accuracy fix the first time anything asks; subsequent
// requests resolve immediately from the cached value.

import * as Location from 'expo-location';

let cached: { lat: number; lng: number } | null = null;
let inFlight: Promise<{ lat: number; lng: number } | null> | null = null;

export async function getBiasCoordinate(): Promise<{ lat: number; lng: number } | null> {
  if (cached) return cached;
  if (inFlight) return inFlight;

  inFlight = (async () => {
    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted') {
        return null;
      }
      const pos = await Location.getLastKnownPositionAsync({});
      if (pos) {
        cached = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        return cached;
      }
      const current = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      cached = { lat: current.coords.latitude, lng: current.coords.longitude };
      return cached;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
