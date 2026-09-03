// Framing geometry for the roof overhead view — pure, so it is unit-tested
// without React Native in the loop. The component imports these.

export type LatLngBoundsLike = { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };

export type RegionLike = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/** Union of the plane rectangles, for framing when no building box came back. */
export function unionBounds(planes: { bounds?: LatLngBoundsLike }[]): LatLngBoundsLike | undefined {
  let sw: { lat: number; lng: number } | undefined;
  let ne: { lat: number; lng: number } | undefined;
  for (const p of planes) {
    if (!p.bounds) continue;
    sw = sw
      ? { lat: Math.min(sw.lat, p.bounds.sw.lat), lng: Math.min(sw.lng, p.bounds.sw.lng) }
      : { ...p.bounds.sw };
    ne = ne
      ? { lat: Math.max(ne.lat, p.bounds.ne.lat), lng: Math.max(ne.lng, p.bounds.ne.lng) }
      : { ...p.bounds.ne };
  }
  return sw && ne ? { sw, ne } : undefined;
}

/**
 * Region that frames the bounds with a margin — the house fills the view. The
 * floor keeps a tiny footprint (a shed) from producing a sub-metre viewport
 * the map cannot render.
 */
export function regionForBounds(b: LatLngBoundsLike, marginFactor = 1.6): RegionLike {
  const latDelta = Math.max(0.0006, (b.ne.lat - b.sw.lat) * marginFactor);
  const lngDelta = Math.max(0.0006, (b.ne.lng - b.sw.lng) * marginFactor);
  return {
    latitude: (b.ne.lat + b.sw.lat) / 2,
    longitude: (b.ne.lng + b.sw.lng) / 2,
    latitudeDelta: latDelta,
    longitudeDelta: lngDelta,
  };
}
