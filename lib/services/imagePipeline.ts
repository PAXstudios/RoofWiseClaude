// Capture → analyze image profiles.
//
// Detection accuracy is the product, and it is bounded by how many pixels
// Gemini gets to look at. A ~1in hail strike in a ~4ft frame is only ~30px
// wide at 1600px — marginal for judging the things a HAAG call turns on
// (exposed mat, granule displacement at the edges, the compressed-asphalt
// sheen). At 2560px the same strike is ~48px.
//
// JPEG quality matters as much as resolution here: compression artifacts
// smear exactly the fine granule texture that distinguishes real damage
// from shadow, so the analyze profile also compresses less aggressively.
//
// SAFETY (entries #23/#24): the old blanket 1600px cap was load-bearing —
// it stopped Expo Go OOM/SIGABRT crashes on large HEIC library photos. So
// this is a *ladder*, not a raise: try the analyze profile, fall back to
// the old safe profile if the device can't manage it, and fall back to the
// untouched original before ever dropping a photo.
//
// COST: roughly 2x the image input tokens per photo vs 1600px. Output
// tokens (the expensive half) are unchanged.

import { Image } from 'react-native';
import * as ImageManipulator from 'expo-image-manipulator';

export type ImageProfile = {
  /** Max width in px. Images narrower than this are never upscaled. */
  width: number;
  /** JPEG quality 0–1. */
  compress: number;
};

/** What we store and send to Gemini. */
export const ANALYZE_PROFILE: ImageProfile = { width: 2560, compress: 0.82 };

/** Pre-#41 behavior. Used when the analyze profile fails on-device. */
export const SAFE_PROFILE: ImageProfile = { width: 1600, compress: 0.7 };

function getSize(uri: string): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    Image.getSize(
      uri,
      (width, height) => resolve({ width, height }),
      () => resolve(null),
    );
  });
}

/**
 * Normalize a freshly captured or picked photo for storage + analysis.
 * Always re-encodes to JPEG (HEIC from the library needs it), downscales
 * only when the source is larger than the target, and degrades gracefully
 * rather than losing the photo.
 */
export async function prepareCapturedPhoto(uri: string): Promise<string> {
  const size = await getSize(uri);

  for (const profile of [ANALYZE_PROFILE, SAFE_PROFILE]) {
    try {
      // Only resize when the source is actually wider — upscaling adds
      // interpolation artifacts and bytes without adding information.
      const actions =
        size && size.width <= profile.width
          ? []
          : [{ resize: { width: profile.width } }];

      const out = await ImageManipulator.manipulateAsync(uri, actions, {
        compress: profile.compress,
        format: ImageManipulator.SaveFormat.JPEG,
      });
      return out.uri;
    } catch {
      // Fall through to the next, smaller profile.
    }
  }

  // Never silently drop a photo.
  return uri;
}

// -----------------------------------------------------------------------------
// Tiles — because the model does not see 2560 px.
//
// Gemini normalises an image into ~768 px tiles before it looks. A 10x10 ft
// test square framed edge to edge at 2560 px puts a 1 in hail strike at ~21 px
// in the file and ~6 px in what the model actually inspects — below the size
// at which exposed asphalt can be told from a shadow. Cropping the square
// into a 2x2 grid of overlapping tiles and analysing each at full resolution
// gives the model ~4x the pixels per strike. Detections are remapped into
// full-frame coordinates and de-duplicated across the overlap band.
// -----------------------------------------------------------------------------

export { tileGrid, TILE_OVERLAP, type TileSpec } from './tileMerge';

/** Cut one tile out of a photo as a base64 JPEG (no data-URI prefix). */
export async function cropTile(uri: string, tile: import('./tileMerge').TileSpec): Promise<{ base64: string; width: number; height: number }> {
  const out = await ImageManipulator.manipulateAsync(
    uri,
    [{ crop: { originX: tile.originX, originY: tile.originY, width: tile.width, height: tile.height } }],
    { compress: ANALYZE_PROFILE.compress, format: ImageManipulator.SaveFormat.JPEG, base64: true },
  );
  if (!out.base64) throw new Error('Could not read the tile.');
  return { base64: out.base64, width: out.width, height: out.height };
}

/** Source pixel size of a stored photo, or null when unreadable. */
export function photoSize(uri: string): Promise<{ width: number; height: number } | null> {
  return getSize(uri);
}
