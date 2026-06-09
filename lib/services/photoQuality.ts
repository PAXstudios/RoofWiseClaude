// Lightweight photo quality pre-check before sending to Gemini.
//
// We can't run a real blur detector cross-platform without a vision lib,
// so this is a coarse heuristic: image dimensions + on-disk file size.
// Returns a `flags` array the UI surfaces as warnings before analysis.

import * as FileSystem from 'expo-file-system';
import { Image } from 'react-native';

const MIN_PIXELS_LONG_EDGE = 720;       // smaller = likely too low res
const MAX_PIXELS_LONG_EDGE = 6000;      // unusually huge = probably fine but slow to upload
const MIN_BYTES = 50 * 1024;            // <50KB likely a thumb
const MIN_ASPECT_RATIO = 0.4;           // weird crops

export type PhotoQuality = {
  ok: boolean;
  flags: string[];
};

export async function scorePhoto(uri: string): Promise<PhotoQuality> {
  const flags: string[] = [];

  // Dimensions
  let width = 0;
  let height = 0;
  try {
    const dims = await new Promise<{ width: number; height: number }>(
      (resolve, reject) => {
        Image.getSize(
          uri,
          (w, h) => resolve({ width: w, height: h }),
          (e) => reject(e),
        );
      },
    );
    width = dims.width;
    height = dims.height;
  } catch {
    flags.push('Could not read photo dimensions');
  }

  const longEdge = Math.max(width, height);
  const shortEdge = Math.min(width, height);
  if (longEdge && longEdge < MIN_PIXELS_LONG_EDGE) {
    flags.push(`Low resolution (${longEdge}px long edge)`);
  }
  if (longEdge && longEdge > MAX_PIXELS_LONG_EDGE) {
    flags.push('Very large image — upload may be slow');
  }
  if (shortEdge && longEdge && shortEdge / longEdge < MIN_ASPECT_RATIO) {
    flags.push('Unusual aspect ratio');
  }

  // File size
  try {
    const info = await FileSystem.getInfoAsync(uri, { size: true });
    if (info.exists && typeof info.size === 'number' && info.size < MIN_BYTES) {
      flags.push(`Very small file (${Math.round(info.size / 1024)} KB)`);
    }
  } catch {
    // Non-fatal
  }

  return { ok: flags.length === 0, flags };
}

export async function scorePhotos(uris: string[]): Promise<PhotoQuality> {
  const results = await Promise.all(uris.map((u) => scorePhoto(u)));
  const flags = new Set<string>();
  for (const r of results) for (const f of r.flags) flags.add(f);
  return { ok: flags.size === 0, flags: Array.from(flags) };
}
