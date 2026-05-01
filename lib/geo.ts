export type LatLng = { lat: number; lon: number };
export type BBox = { minLon: number; minLat: number; maxLon: number; maxLat: number };

export function inBBox(p: LatLng, b: BBox): boolean {
  return (
    p.lon >= b.minLon &&
    p.lon <= b.maxLon &&
    p.lat >= b.minLat &&
    p.lat <= b.maxLat
  );
}

export function bboxFromCenter(center: LatLng, radiusMiles: number): BBox {
  const latDelta = radiusMiles / 69;
  const lonDelta = radiusMiles / (69 * Math.cos((center.lat * Math.PI) / 180));
  return {
    minLat: center.lat - latDelta,
    maxLat: center.lat + latDelta,
    minLon: center.lon - lonDelta,
    maxLon: center.lon + lonDelta,
  };
}

export function distanceMiles(a: LatLng, b: LatLng): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 3958.8;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
