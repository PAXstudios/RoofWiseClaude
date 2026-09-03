// Where a storm hit, in words a roofer can drive on — pure.
//
// "Frisco, 12 mi NW of Plano, TX": the strongest report's town when the report
// named one, plus distance and compass bearing from the service-area centroid
// when the area has one. Never a distance without a centroid to measure from.

import type { StormEvent } from '../noaa';

export type Bearing = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SW' | 'W' | 'NW';

const EARTH_RADIUS_MILES = 3958.8;

export function haversineMilesBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_MILES * Math.asin(Math.sqrt(a));
}

/** Initial great-circle bearing from point 1 to point 2, as an 8-wind compass point. */
export function bearingBetween(lat1: number, lng1: number, lat2: number, lng2: number): Bearing {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
  const dirs: Bearing[] = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return dirs[Math.round(deg / 45) % 8];
}

export type WhereDescription = { label: string; distanceMiles?: number; bearing?: Bearing };

export function describeWhere(
  core: Pick<StormEvent, 'lat' | 'lon' | 'city'> | null,
  area: { label: string; centroidLat?: number; centroidLng?: number },
): WhereDescription | null {
  if (!core) return null;
  const town = core.city
    ? core.city.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())
    : null;
  const { centroidLat: lat, centroidLng: lng } = area;
  if (typeof lat === 'number' && typeof lng === 'number' && Number.isFinite(lat) && Number.isFinite(lng)) {
    const distanceMiles = haversineMilesBetween(lat, lng, core.lat, core.lon);
    const bearing = bearingBetween(lat, lng, core.lat, core.lon);
    return {
      label: `${town ?? 'the storm core'}, ${distanceMiles.toFixed(0)} mi ${bearing} of ${area.label}`,
      distanceMiles,
      bearing,
    };
  }
  return { label: town ?? area.label };
}
