// HailTrace-style impacted-area swaths — PURE (no I/O, no React, no
// react-native-maps). Turns discrete NOAA Local Storm Reports (points) into
// honest filled contours of the *area impacted* by hail / wind.
//
// WHY THIS IS HONEST (Drift #5): HailTrace paints proprietary radar. RoofWise
// has only ground truth — spotter/public LSRs ("1.75in hail reported here").
// We do NOT invent radar precision. We draw the buffered-union contour of the
// REAL reports and label it, everywhere, as "impacted area — from storm
// reports". The buffer is a documented, defensible smoothing radius, never a
// claim of measured extent (see INFLUENCE RADIUS below).
//
// METHOD (per spec §1):
//   1. Raster a lat/lng grid over the reports of a peril. A cell is "in" if it
//      lies within the magnitude-scaled influence radius of ANY report of that
//      peril; the cell carries the MAX severity band of the reports covering it.
//   2. For each band level, trace the outer boundary of the union of cells at
//      that band-or-higher (a nested-contour set, so higher bands sit inside
//      lower ones and read as intensity when drawn with alpha) — a
//      marching-squares-style boundary trace over the binary grid.
//   3. Douglas–Peucker simplify each ring, then a HARD total-vertex cap with a
//      `simplified` flag, so the native map never receives thousands of verts.
//
// Deterministic: no Date, no Math.random, fixed iteration order. Everything is
// plain data so it can be unit-tested in node against real IEM reports.

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

export type SwathPeril = 'hail' | 'wind';

/** One NOAA report, normalised for the rasteriser. `magnitude`: inches for
 *  hail, MPH for wind (null when the report carried no size). */
export type SwathInputPoint = {
  lat: number;
  lng: number;
  peril: SwathPeril;
  magnitude: number | null;
};

export type LatLng = { lat: number; lng: number };

export type StormSwath = {
  peril: SwathPeril;
  /** Human band label, e.g. `1.5–2 in` / `70–86 mph`. */
  band: string;
  /** 0-based band index (0 = weakest floor). Lower bands are larger contours. */
  bandIndex: number;
  /** Strongest report (in / mph) contributing to this band-or-higher. */
  magnitudeMax: number;
  /** Outer rings only; each is closed (first === last) with ≥ 4 vertices. */
  rings: LatLng[][];
  /** True when the vertex cap or DP simplification changed the raw cell outline. */
  simplified: boolean;
};

export type ComputeSwathOptions = {
  /** Grid cell size in km (default 1.5). Smaller = more faithful, more verts. */
  cellSizeKm?: number;
  /** Override the influence radius (km) per report. Default: see below. */
  influenceRadiusFor?: (magnitude: number | null, peril: SwathPeril) => number;
  /** Hard cap on total vertices across all returned rings (default 1500). */
  maxVertices?: number;
};

// -----------------------------------------------------------------------------
// Bands — the legend scale. Floors are inclusive lower bounds.
// -----------------------------------------------------------------------------

const HAIL_BAND_FLOORS = [0, 1, 1.5, 2] as const; // inches
export const HAIL_BAND_LABELS = ['< 1 in', '1–1.5 in', '1.5–2 in', '2 in +'] as const;

const WIND_BAND_FLOORS = [58, 70, 86] as const; // mph (58 = NWS severe criterion)
export const WIND_BAND_LABELS = ['58–70 mph', '70–86 mph', '86 mph +'] as const;

function bandFloorsFor(peril: SwathPeril): readonly number[] {
  return peril === 'hail' ? HAIL_BAND_FLOORS : WIND_BAND_FLOORS;
}

function bandLabelsFor(peril: SwathPeril): readonly string[] {
  return peril === 'hail' ? HAIL_BAND_LABELS : WIND_BAND_LABELS;
}

/** Highest band floor at or below the magnitude. Null magnitude → band 0. */
function bandIndexFor(magnitude: number | null, peril: SwathPeril): number {
  const floors = bandFloorsFor(peril);
  if (magnitude == null || !Number.isFinite(magnitude)) return 0;
  let idx = 0;
  for (let i = 0; i < floors.length; i += 1) {
    if (magnitude >= floors[i]) idx = i;
  }
  return idx;
}

// -----------------------------------------------------------------------------
// INFLUENCE RADIUS — the one defensible modelling choice, documented in full.
// -----------------------------------------------------------------------------
//
// An LSR is a SPOT observation at a reporter's location. The physical hail /
// wind core that produced it is wider than that one point, and reporters
// (people, spotters) are sparse, so the raw points wildly understate the
// impacted area. We buffer each report by a modest radius that:
//   • grows with magnitude — a larger hail core is physically broader;
//   • is capped hard, so one outlier report can never paint a whole metro;
//   • is a SMOOTHING radius to bridge gaps between corroborating reports —
//     NOT a claim that hail measurably fell that far from the reporter.
// The UI label ("impacted area — from storm reports") makes this explicit.
//
// Hail: 2 km base + 1.5 km per inch, capped 8 km (a 4 in report → 8 km).
// Wind: 2.5 km base + 40 m per mph over the 58 mph severe floor, capped 8 km.
const HAIL_BASE_KM = 2;
const HAIL_PER_INCH_KM = 1.5;
const WIND_BASE_KM = 2.5;
const WIND_PER_MPH_KM = 0.04;
const WIND_FLOOR_MPH = 58;
const INFLUENCE_CAP_KM = 8;

export function defaultInfluenceRadiusKm(magnitude: number | null, peril: SwathPeril): number {
  return scaledInfluenceRadiusKm(1)(magnitude, peril);
}

/**
 * The same model at a viewing scale.
 *
 * At a 50-mile view the 8 km cap is the reason the impacted area read as
 * confetti on the owner's phone: a 1 in report is a 3.5 km blob — one or two
 * 2.6 km grid cells — so each report drew its own little square instead of
 * the reports merging into the continuous, graded area a HailTrace map shows.
 * Zoomed out, the SMOOTHING radius should grow with the view (bridging the
 * gaps between corroborating reports is the whole point of it) while the
 * relative claim stays the same: it is still "impacted area — from storm
 * reports", never a statement that hail fell that far from the reporter.
 * Zoomed in, the radius comes back down and the detail returns.
 */
export function scaledInfluenceRadiusKm(
  scale: number,
): (magnitude: number | null, peril: SwathPeril) => number {
  const k = Number.isFinite(scale) && scale > 0 ? scale : 1;
  const cap = INFLUENCE_CAP_KM * k;
  return (magnitude, peril) => {
    if (peril === 'hail') {
      const inches = magnitude != null && Number.isFinite(magnitude) ? Math.max(0, magnitude) : 0.5;
      return Math.min(cap, (HAIL_BASE_KM + HAIL_PER_INCH_KM * inches) * k);
    }
    const mph = magnitude != null && Number.isFinite(magnitude) ? Math.max(WIND_FLOOR_MPH, magnitude) : WIND_FLOOR_MPH;
    return Math.min(cap, (WIND_BASE_KM + WIND_PER_MPH_KM * (mph - WIND_FLOOR_MPH)) * k);
  };
}

// -----------------------------------------------------------------------------
// Geo helpers — equirectangular, good to fractions of a percent at metro scale.
// -----------------------------------------------------------------------------

const KM_PER_DEG_LAT = 111.32;
const DEG = Math.PI / 180;

function kmPerDegLon(lat: number): number {
  return KM_PER_DEG_LAT * Math.cos(lat * DEG);
}

function isFiniteNum(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n);
}

function validPoint(p: SwathInputPoint): boolean {
  return (
    isFiniteNum(p.lat) &&
    isFiniteNum(p.lng) &&
    p.lat >= -90 &&
    p.lat <= 90 &&
    p.lng >= -180 &&
    p.lng <= 180 &&
    (p.peril === 'hail' || p.peril === 'wind')
  );
}

/** Cap the grid so a huge bbox can never allocate an enormous raster. */
const MAX_GRID_CELLS = 250_000;

// -----------------------------------------------------------------------------
// Grid raster (per peril)
// -----------------------------------------------------------------------------

type Grid = {
  band: Int8Array; // maxBandIndex per cell, -1 = empty
  nRows: number; // latitude cells
  nCols: number; // longitude cells
  latMin: number;
  lngMin: number;
  cellLatDeg: number;
  cellLonDeg: number;
};

function rasterise(points: SwathInputPoint[], cellSizeKm: number, radiusFor: (m: number | null, p: SwathPeril) => number, peril: SwathPeril): Grid | null {
  const pts = points.filter((p) => p.peril === peril);
  if (pts.length === 0) return null;

  let maxRadiusKm = 0;
  let latMin = Infinity;
  let latMax = -Infinity;
  let lngMin = Infinity;
  let lngMax = -Infinity;
  for (const p of pts) {
    const r = Math.max(0, radiusFor(p.magnitude, peril));
    if (r > maxRadiusKm) maxRadiusKm = r;
    if (p.lat < latMin) latMin = p.lat;
    if (p.lat > latMax) latMax = p.lat;
    if (p.lng < lngMin) lngMin = p.lng;
    if (p.lng > lngMax) lngMax = p.lng;
  }

  const midLat = (latMin + latMax) / 2;
  const kmLon = Math.max(1e-6, kmPerDegLon(midLat));
  const padLatDeg = maxRadiusKm / KM_PER_DEG_LAT;
  const padLonDeg = maxRadiusKm / kmLon;
  latMin -= padLatDeg;
  latMax += padLatDeg;
  lngMin -= padLonDeg;
  lngMax += padLonDeg;

  let cellKm = Math.max(0.25, cellSizeKm);
  let cellLatDeg = cellKm / KM_PER_DEG_LAT;
  let cellLonDeg = cellKm / kmLon;
  let nRows = Math.max(1, Math.ceil((latMax - latMin) / cellLatDeg));
  let nCols = Math.max(1, Math.ceil((lngMax - lngMin) / cellLonDeg));
  // Coarsen deterministically if the raster would be too large.
  while (nRows * nCols > MAX_GRID_CELLS) {
    cellKm *= 1.5;
    cellLatDeg = cellKm / KM_PER_DEG_LAT;
    cellLonDeg = cellKm / kmLon;
    nRows = Math.max(1, Math.ceil((latMax - latMin) / cellLatDeg));
    nCols = Math.max(1, Math.ceil((lngMax - lngMin) / cellLonDeg));
  }

  const band = new Int8Array(nRows * nCols).fill(-1);

  for (const p of pts) {
    const bIdx = bandIndexFor(p.magnitude, peril);
    const rKm = Math.max(cellKm, radiusFor(p.magnitude, peril));
    const rLatDeg = rKm / KM_PER_DEG_LAT;
    const rLonDeg = rKm / kmLon;
    // Cell-index window covering the report's radius.
    const rowLo = Math.max(0, Math.floor((p.lat - rLatDeg - latMin) / cellLatDeg));
    const rowHi = Math.min(nRows - 1, Math.floor((p.lat + rLatDeg - latMin) / cellLatDeg));
    const colLo = Math.max(0, Math.floor((p.lng - rLonDeg - lngMin) / cellLonDeg));
    const colHi = Math.min(nCols - 1, Math.floor((p.lng + rLonDeg - lngMin) / cellLonDeg));
    for (let r = rowLo; r <= rowHi; r += 1) {
      const cellLat = latMin + (r + 0.5) * cellLatDeg;
      const dLatKm = (cellLat - p.lat) * KM_PER_DEG_LAT;
      for (let c = colLo; c <= colHi; c += 1) {
        const cellLng = lngMin + (c + 0.5) * cellLonDeg;
        const dLonKm = (cellLng - p.lng) * kmLon;
        if (dLatKm * dLatKm + dLonKm * dLonKm <= rKm * rKm) {
          const k = r * nCols + c;
          if (band[k] < bIdx) band[k] = bIdx;
        }
      }
    }
  }

  return { band, nRows, nCols, latMin, lngMin, cellLatDeg, cellLonDeg };
}

// -----------------------------------------------------------------------------
// Boundary trace — union of "in" cells → outer rings (marching-squares style).
// -----------------------------------------------------------------------------
//
// Each "in" cell contributes the edges it shares with an "out" cell (or the
// grid edge), directed so the interior is always on the RIGHT of travel. Those
// half-edges stitch head-to-tail into closed loops. In this y-up grid an outer
// boundary comes out clockwise (negative shoelace area); holes come out CW-
// reversed (positive) and are dropped — the spec wants outer rings, and the
// nested band contours mean a lower band's "hole" is just where a higher band
// is drawn on top.

type CornerXY = { i: number; j: number };

function traceOuterRings(inCell: (r: number, c: number) => boolean, nRows: number, nCols: number): CornerXY[][] {
  const cornerCols = nCols + 1;
  const key = (i: number, j: number) => i * cornerCols + j;

  // Directed edges (start → end) with interior on the right.
  const starts = new Map<number, number[]>(); // startKey → indices into edges
  const edges: { s: CornerXY; e: CornerXY }[] = [];
  const addEdge = (si: number, sj: number, ei: number, ej: number) => {
    const idx = edges.length;
    edges.push({ s: { i: si, j: sj }, e: { i: ei, j: ej } });
    const sk = key(si, sj);
    const arr = starts.get(sk);
    if (arr) arr.push(idx);
    else starts.set(sk, [idx]);
  };

  for (let r = 0; r < nRows; r += 1) {
    for (let c = 0; c < nCols; c += 1) {
      if (!inCell(r, c)) continue;
      // Corners (y-up): LL=(r,c) UL=(r+1,c) UR=(r+1,c+1) LR=(r,c+1)
      if (!inCell(r, c - 1)) addEdge(r, c, r + 1, c); // left edge, going up
      if (!inCell(r + 1, c)) addEdge(r + 1, c, r + 1, c + 1); // top edge, going right
      if (!inCell(r, c + 1)) addEdge(r + 1, c + 1, r, c + 1); // right edge, going down
      if (!inCell(r - 1, c)) addEdge(r, c + 1, r, c); // bottom edge, going left
    }
  }

  const consumed = new Array<boolean>(edges.length).fill(false);
  const rings: CornerXY[][] = [];
  const maxSteps = edges.length + 1;

  for (let start = 0; start < edges.length; start += 1) {
    if (consumed[start]) continue;
    const ring: CornerXY[] = [];
    let current = start;
    let steps = 0;
    const loopStartKey = key(edges[start].s.i, edges[start].s.j);
    while (current >= 0 && !consumed[current] && steps < maxSteps) {
      consumed[current] = true;
      ring.push(edges[current].s);
      const endKey = key(edges[current].e.i, edges[current].e.j);
      if (endKey === loopStartKey) break;
      const cand = starts.get(endKey);
      let next = -1;
      if (cand) {
        for (const idx of cand) {
          if (!consumed[idx]) {
            next = idx;
            break;
          }
        }
      }
      current = next;
      steps += 1;
    }
    if (ring.length >= 3) rings.push(ring);
  }

  // Keep outer rings only (CW / negative shoelace in this y-up index space).
  return rings.filter((ring) => signedAreaXY(ring) < 0);
}

function signedAreaXY(ring: CornerXY[]): number {
  let a = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const p = ring[i];
    const q = ring[(i + 1) % ring.length];
    a += p.j * q.i - q.j * p.i;
  }
  return a / 2;
}

// -----------------------------------------------------------------------------
// Douglas–Peucker (closed ring)
// -----------------------------------------------------------------------------

function perpDist(p: LatLng, a: LatLng, b: LatLng): number {
  const dx = b.lng - a.lng;
  const dy = b.lat - a.lat;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) {
    const ex = p.lng - a.lng;
    const ey = p.lat - a.lat;
    return Math.sqrt(ex * ex + ey * ey);
  }
  const t = ((p.lng - a.lng) * dx + (p.lat - a.lat) * dy) / len2;
  const projX = a.lng + t * dx;
  const projY = a.lat + t * dy;
  const ex = p.lng - projX;
  const ey = p.lat - projY;
  return Math.sqrt(ex * ex + ey * ey);
}

function dpPolyline(points: LatLng[], eps: number): LatLng[] {
  if (points.length < 3) return points.slice();
  let maxD = -1;
  let maxI = 0;
  const a = points[0];
  const b = points[points.length - 1];
  for (let i = 1; i < points.length - 1; i += 1) {
    const d = perpDist(points[i], a, b);
    if (d > maxD) {
      maxD = d;
      maxI = i;
    }
  }
  if (maxD > eps) {
    const left = dpPolyline(points.slice(0, maxI + 1), eps);
    const right = dpPolyline(points.slice(maxI), eps);
    return left.slice(0, -1).concat(right);
  }
  return [a, b];
}

/** Simplify a closed ring (input NOT including a repeated closing point). */
function simplifyRing(ring: LatLng[], eps: number): LatLng[] {
  const n = ring.length;
  if (n < 4) return ring.slice();
  // Split the ring at the point farthest from ring[0] so DP has stable
  // endpoints, simplify each half, then rejoin.
  let farI = 0;
  let farD = -1;
  const a0 = ring[0];
  for (let i = 1; i < n; i += 1) {
    const dx = ring[i].lng - a0.lng;
    const dy = ring[i].lat - a0.lat;
    const d = dx * dx + dy * dy;
    if (d > farD) {
      farD = d;
      farI = i;
    }
  }
  const first = ring.slice(0, farI + 1);
  const second = ring.slice(farI).concat([ring[0]]);
  const s1 = dpPolyline(first, eps);
  const s2 = dpPolyline(second, eps);
  // s1 ends at farI, s2 starts at farI and ends back at ring[0].
  const merged = s1.slice(0, -1).concat(s2.slice(0, -1));
  return merged;
}

// -----------------------------------------------------------------------------
// Assembly
// -----------------------------------------------------------------------------

function cornerToLatLng(corner: CornerXY, grid: Grid): LatLng {
  return {
    lat: grid.latMin + corner.i * grid.cellLatDeg,
    lng: grid.lngMin + corner.j * grid.cellLonDeg,
  };
}

function closeRing(ring: LatLng[]): LatLng[] {
  if (ring.length === 0) return ring;
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first.lat !== last.lat || first.lng !== last.lng) {
    return ring.concat([{ lat: first.lat, lng: first.lng }]);
  }
  return ring;
}

function countVertices(swaths: StormSwath[]): number {
  let n = 0;
  for (const s of swaths) for (const ring of s.rings) n += ring.length;
  return n;
}

/**
 * Compute HailTrace-style impacted-area swaths from real storm reports.
 * Returns one entry per (peril, band); lower bands are larger contours and
 * appear first, so a caller drawing them in order stacks higher bands on top.
 */
export function computeStormSwaths(points: SwathInputPoint[], opts: ComputeSwathOptions = {}): StormSwath[] {
  const cellSizeKm = opts.cellSizeKm ?? 1.5;
  const radiusFor = opts.influenceRadiusFor ?? defaultInfluenceRadiusKm;
  const maxVertices = Math.max(60, opts.maxVertices ?? 1500);

  const clean = (points ?? []).filter(validPoint);
  if (clean.length === 0) return [];

  const perils: SwathPeril[] = ['hail', 'wind'];
  // Raw (un-simplified) rings first, so the vertex cap can escalate globally.
  type RawBand = { peril: SwathPeril; bandIndex: number; band: string; magnitudeMax: number; ringsLatLng: LatLng[][]; cellDeg: number };
  const raw: RawBand[] = [];

  for (const peril of perils) {
    const grid = rasterise(clean, cellSizeKm, radiusFor, peril);
    if (!grid) continue;
    const { band, nRows, nCols } = grid;
    const labels = bandLabelsFor(peril);
    const perilPts = clean.filter((p) => p.peril === peril);

    // How many band levels actually appear.
    let maxBand = -1;
    for (let k = 0; k < band.length; k += 1) if (band[k] > maxBand) maxBand = band[k];
    if (maxBand < 0) continue;

    for (let b = 0; b <= maxBand; b += 1) {
      const inCell = (r: number, c: number): boolean => {
        if (r < 0 || c < 0 || r >= nRows || c >= nCols) return false;
        return band[r * nCols + c] >= b;
      };
      const ringsXY = traceOuterRings(inCell, nRows, nCols);
      if (ringsXY.length === 0) continue;
      const ringsLatLng = ringsXY.map((ring) => ring.map((corner) => cornerToLatLng(corner, grid)));
      // Strongest report contributing to this band-or-higher.
      let magMax = 0;
      for (const p of perilPts) {
        if (bandIndexFor(p.magnitude, peril) >= b && p.magnitude != null && p.magnitude > magMax) {
          magMax = p.magnitude;
        }
      }
      raw.push({
        peril,
        bandIndex: b,
        band: labels[b] ?? labels[labels.length - 1],
        magnitudeMax: magMax,
        ringsLatLng,
        cellDeg: Math.min(grid.cellLatDeg, grid.cellLonDeg),
      });
    }
  }

  if (raw.length === 0) return [];

  const rawVertexTotal = raw.reduce((n, rb) => n + rb.ringsLatLng.reduce((m, r) => m + r.length + 1, 0), 0);

  // Simplify with an escalating epsilon until under the vertex cap.
  const build = (epsFactor: number): StormSwath[] => {
    const out: StormSwath[] = [];
    for (const rb of raw) {
      const eps = epsFactor * rb.cellDeg;
      const rings: LatLng[][] = [];
      for (const ring of rb.ringsLatLng) {
        const simplified = simplifyRing(ring, eps);
        const closed = closeRing(simplified);
        if (closed.length >= 4) rings.push(closed);
      }
      if (rings.length === 0) {
        // Never drop a band entirely to simplification — keep its largest ring
        // as the raw cell outline so the impacted area is still shown.
        const largest = rb.ringsLatLng
          .slice()
          .sort((a, b) => b.length - a.length)[0];
        if (largest) rings.push(closeRing(largest));
      }
      out.push({
        peril: rb.peril,
        band: rb.band,
        bandIndex: rb.bandIndex,
        magnitudeMax: rb.magnitudeMax,
        rings,
        simplified: false, // filled in below
      });
    }
    return out;
  };

  let epsFactor = 0.4;
  let swaths = build(epsFactor);
  let capEngaged = false;
  let guard = 0;
  while (countVertices(swaths) > maxVertices && guard < 8) {
    epsFactor *= 1.7;
    swaths = build(epsFactor);
    capEngaged = true;
    guard += 1;
  }
  // Last resort: drop the smallest rings until under the cap.
  if (countVertices(swaths) > maxVertices) {
    const allRings: { swath: StormSwath; ring: LatLng[] }[] = [];
    for (const s of swaths) for (const ring of s.rings) allRings.push({ swath: s, ring });
    allRings.sort((a, b) => a.ring.length - b.ring.length);
    let total = countVertices(swaths);
    for (const entry of allRings) {
      if (total <= maxVertices) break;
      if (entry.swath.rings.length <= 1) continue; // keep at least one ring per band
      const idx = entry.swath.rings.indexOf(entry.ring);
      if (idx >= 0) {
        entry.swath.rings.splice(idx, 1);
        total -= entry.ring.length;
        capEngaged = true;
      }
    }
    swaths = swaths.filter((s) => s.rings.length > 0);
  }

  const finalVertexTotal = countVertices(swaths);
  const wasSimplified = capEngaged || finalVertexTotal < rawVertexTotal;
  for (const s of swaths) s.simplified = wasSimplified;

  return swaths;
}

// -----------------------------------------------------------------------------
// Adapter — StormEvent (lat, lon, type, magnitude) → SwathInputPoint
// -----------------------------------------------------------------------------

export function swathPointsFromEvents(
  events: readonly { lat: number; lon: number; type: SwathPeril; magnitude: number | null }[] | null | undefined,
): SwathInputPoint[] {
  if (!events) return [];
  const out: SwathInputPoint[] = [];
  for (const e of events) {
    out.push({ lat: e.lat, lng: e.lon, peril: e.type, magnitude: e.magnitude });
  }
  return out;
}
