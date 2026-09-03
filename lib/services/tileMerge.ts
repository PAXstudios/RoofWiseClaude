// Merge per-tile detections back into one photo — pure.
//
// Each tile's boxes are in that tile's 0–1 frame. They are remapped into the
// full photo's 0–1 frame, then de-duplicated: a strike that straddles the
// overlap band is detected in both neighbouring tiles, and the better-
// confidence copy wins. Findings counts are rebuilt from the surviving
// markers so the summary never claims more hits than the markers show.

import type { DamageCategory, DamageMarker, InspectionFinding, Severity } from '../models/types';

export type TileSpec = {
  /** Tile index, row-major. */
  index: number;
  /** Crop origin/size in SOURCE pixels. */
  originX: number;
  originY: number;
  width: number;
  height: number;
  /** Source dimensions the tile was cut from. */
  sourceW: number;
  sourceH: number;
};

/** Fraction of each tile that overlaps its neighbour, so a strike on the seam is whole in one of them. */
export const TILE_OVERLAP = 0.12;

/** Pure: where the 2x2 tiles sit in a W×H source. */
export function tileGrid(sourceW: number, sourceH: number, grid = 2): TileSpec[] {
  const tiles: TileSpec[] = [];
  const stepX = sourceW / grid;
  const stepY = sourceH / grid;
  const padX = stepX * TILE_OVERLAP;
  const padY = stepY * TILE_OVERLAP;
  let index = 0;
  for (let r = 0; r < grid; r += 1) {
    for (let c = 0; c < grid; c += 1) {
      const x0 = Math.max(0, Math.round(c * stepX - padX));
      const y0 = Math.max(0, Math.round(r * stepY - padY));
      const x1 = Math.min(sourceW, Math.round((c + 1) * stepX + padX));
      const y1 = Math.min(sourceH, Math.round((r + 1) * stepY + padY));
      tiles.push({ index, originX: x0, originY: y0, width: x1 - x0, height: y1 - y0, sourceW, sourceH });
      index += 1;
    }
  }
  return tiles;
}

/** Two boxes overlapping by more than this (IoU) are the same strike. */
export const DEDUPE_IOU = 0.4;

export function remapMarker(m: DamageMarker, tile: TileSpec): DamageMarker {
  const sx = tile.width / tile.sourceW;
  const sy = tile.height / tile.sourceH;
  const ox = tile.originX / tile.sourceW;
  const oy = tile.originY / tile.sourceH;
  const box = m.box
    ? {
        xmin: ox + m.box.xmin * sx,
        ymin: oy + m.box.ymin * sy,
        xmax: ox + m.box.xmax * sx,
        ymax: oy + m.box.ymax * sy,
      }
    : undefined;
  return {
    ...m,
    id: `${m.id}_t${tile.index}`,
    x: ox + m.x * sx,
    y: oy + m.y * sy,
    // Radius is a fraction of the frame width; scale with the tile's width share.
    radius: m.radius * sx,
    box,
  };
}

function iou(a: DamageMarker, b: DamageMarker): number {
  const ab = a.box ?? { xmin: a.x - a.radius, ymin: a.y - a.radius, xmax: a.x + a.radius, ymax: a.y + a.radius };
  const bb = b.box ?? { xmin: b.x - b.radius, ymin: b.y - b.radius, xmax: b.x + b.radius, ymax: b.y + b.radius };
  const ix = Math.max(0, Math.min(ab.xmax, bb.xmax) - Math.max(ab.xmin, bb.xmin));
  const iy = Math.max(0, Math.min(ab.ymax, bb.ymax) - Math.max(ab.ymin, bb.ymin));
  const inter = ix * iy;
  const areaA = (ab.xmax - ab.xmin) * (ab.ymax - ab.ymin);
  const areaB = (bb.xmax - bb.xmin) * (bb.ymax - bb.ymin);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/** Remap every tile's markers into the photo frame and drop cross-tile duplicates. */
export function mergeTileMarkers(perTile: { tile: TileSpec; markers: DamageMarker[] }[]): DamageMarker[] {
  const all = perTile.flatMap(({ tile, markers }) => markers.map((m) => remapMarker(m, tile)));
  // Higher confidence first, so the survivor of a duplicate pair is the better read.
  all.sort((a, b) => b.confidence - a.confidence);
  const kept: DamageMarker[] = [];
  for (const m of all) {
    const dup = kept.some((k) => k.category === m.category && iou(k, m) >= DEDUPE_IOU);
    if (!dup) kept.push(m);
  }
  return kept;
}

const SEVERITY_RANK: Record<Severity, number> = { none: 0, minor: 1, moderate: 2, severe: 3 };

/**
 * Rebuild the 13-row findings table from merged markers, keeping the
 * full-frame pass's per-category note/confidence where it had one. `count`
 * is the number of surviving markers, so the table and the boxes agree.
 */
export function findingsFromMarkers(
  markers: DamageMarker[],
  base: InspectionFinding[],
  categories: readonly DamageCategory[],
): InspectionFinding[] {
  return categories.map((label) => {
    const mine = markers.filter((m) => m.category === label);
    const prior = base.find((f) => f.label === label);
    if (mine.length === 0) {
      return prior
        ? { ...prior, detected: prior.detected && prior.count > 0, count: prior.detected ? prior.count : 0 }
        : { label, detected: false, severity: 'none', confidence: 0, count: 0 };
    }
    const severity = mine.reduce<Severity>(
      (worst, m) => (SEVERITY_RANK[m.severity] > SEVERITY_RANK[worst] ? m.severity : worst),
      'none',
    );
    const confidence = Math.round(mine.reduce((t, m) => t + m.confidence, 0) / mine.length);
    return { label, detected: true, severity, confidence, count: mine.length, note: prior?.note };
  });
}
