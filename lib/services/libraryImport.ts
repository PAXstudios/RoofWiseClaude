// Multi-select library import — the shared importer behind Quick Inspection's
// library button (and, reused, capture-from-job / new-job).
//
// WHY A SERVICE, NOT AN INLINE LOOP
// ---------------------------------
// Historically (PROMPT_LOG #24/#25) multi-select was banned: expo-image-picker
// on SDK 51 fired its JS completion once PER FAILED ASSET and never debounced,
// so two unreadable assets (iCloud originals, simulator HEIC placeholders)
// rejected the same promise twice and aborted the process — SIGABRT, no JS
// error. The workaround was a loop over the single-asset picker.
//
// SDK 54 / expo-image-picker 17 present the modern PHPicker, whose JS bridge
// settles once. We verified against node_modules:
//   - ImagePicker.types.d.ts declares allowsMultipleSelection, selectionLimit,
//     orderedSelection (iOS 15+), mediaTypes: MediaType[], quality.
//   - ios/ImagePickerModule.swift#launchMultiSelectPicker maps selectionLimit,
//     orderedSelection (.ordered) and preferredAssetRepresentationMode straight
//     onto PHPickerConfiguration.
//   - ios/MediaHandler.swift#handleMultipleMedia loads assets via `asyncMap`,
//     which THROWS on the first asset it cannot read — so a single bad HEIC
//     still rejects the whole promise. That is why the single-asset loop stays
//     as the fallback, and why `multiSelectImport` exists as a one-tap kill
//     switch (captureSettingsStore) if a device still misbehaves.
//
// So this module is defence-in-depth, not blind trust:
//   1. Try real multi-select behind a settle-once guard (a boolean, so even a
//      doubly-fired native completion cannot double-resolve/reject the way #24
//      described).
//   2. If that throws, returns nothing, or the setting is off, fall back to the
//      proven single-asset loop and log the fallback to Diagnostics.
//   3. Every asset rides the SAME `prepareCapturedPhoto` pipeline as the camera,
//      and a per-asset read failure is reported without aborting the batch.
//
// This module does the picking + normalization + progress + failure bookkeeping.
// Attaching to the store and enqueuing analysis is the CALLER's job, handed one
// prepared URI at a time through `onPhoto` — so Quick Inspection keeps its
// screen-local review strip / pump, and a job screen can attach + enqueue into
// the background analysis queue, from the exact same importer.

import * as ImagePicker from 'expo-image-picker';
import { prepareCapturedPhoto } from './imagePipeline';
import { recordError } from './diagnostics';

/** Default ceiling on one multi-select run. iOS lets 0 mean "system max"; we
 *  keep a real number so the batch (each asset = one Gemini call downstream)
 *  can never balloon past a defensible size on a single tap. */
export const IMPORT_SELECTION_LIMIT = 30;

/** Fallback single-asset loop ceiling — a loop needs a stop even if the user
 *  never taps Cancel. Matches the prior inline behavior. */
export const IMPORT_LOOP_LIMIT = 24;

export type LibraryImportPhase = 'multi' | 'single';

export type LibraryImportProgress = {
  /** Assets successfully prepared + handed to `onPhoto` so far. */
  done: number;
  /** Total assets to process. Known up front for multi-select; for the
   *  single-asset loop it tracks `done` (the user reveals the count one pick
   *  at a time), so render it as "Imported N…" not "N of total". */
  total: number;
  phase: LibraryImportPhase;
};

export type LibraryImportFailure = {
  /** Index within the picked selection (multi) or loop iteration (single). */
  index: number;
  /** The source asset uri, when we got that far. */
  uri?: string;
  /** Plain-words reason, safe to show as-is. */
  reason: string;
};

export type LibraryImportResult = {
  /** How many assets were normalized and handed to `onPhoto`. */
  imported: number;
  /** Per-asset failures (unreadable HEIC, iCloud not-downloaded, prepare
   *  threw). The batch is never aborted by one of these. */
  failures: LibraryImportFailure[];
  /** True when the multi-select path was unavailable (threw / empty / setting
   *  off) and the single-asset loop ran instead. */
  usedFallback: boolean;
  /** Photos-library permission outcome. `denied` → the caller shows its own
   *  permission alert; nothing was picked. */
  permission: 'granted' | 'denied';
  /** Whether the OS will still show a permission prompt (drives the alert copy). */
  permissionCanAskAgain: boolean;
  /** Multi-select hit `selectionLimit`, or the loop hit `IMPORT_LOOP_LIMIT`. */
  reachedLimit: boolean;
};

export type ImportFromLibraryArgs = {
  /**
   * Called once per successfully normalized photo, in pick order. Attach it to
   * the store (with the caller's slope / areaTag / captureMode) and enqueue it
   * for analysis here. Throwing (or rejecting) marks THIS asset failed and the
   * batch continues — so a store write that fails on one photo does not lose
   * the rest.
   */
  onPhoto: (uri: string, ctx: { index: number; imported: true }) => void | Promise<void>;
  /** Progress for the "Importing 7 of 30…" line. */
  onProgress?: (p: LibraryImportProgress) => void;
  /**
   * Attempt real multi-select. Pass `captureSettings.multiSelectImport`. When
   * false, the importer goes straight to the single-asset loop — the one-tap
   * escape hatch for a device that shows the old crash.
   */
  multiSelect: boolean;
  /** Max assets in one multi-select run. Default {@link IMPORT_SELECTION_LIMIT}. */
  selectionLimit?: number;
};

/**
 * Launch the picker inside a settle-once guard so a doubly-fired completion
 * cannot resolve/reject twice (the #24 SIGABRT shape). Awaiting the promise is
 * already single-settle at the JS layer; this makes the guarantee explicit and
 * survives a future bridge that calls back more than once.
 */
function pickOnce(
  options: ImagePicker.ImagePickerOptions,
): Promise<ImagePicker.ImagePickerResult> {
  let settled = false;
  return new Promise((resolve, reject) => {
    ImagePicker.launchImageLibraryAsync(options).then(
      (result) => {
        if (settled) return;
        settled = true;
        resolve(result);
      },
      (error) => {
        if (settled) return;
        settled = true;
        reject(error);
      },
    );
  });
}

/**
 * `Compatible` (not `Current`) makes iOS transcode HEIC / iCloud originals to a
 * readable JPEG before handing them over. `Current` returns raw HEIC bytes,
 * which fail with "Cannot load representation of type public.heic" — especially
 * on the simulator and for not-yet-downloaded iCloud photos. Applied to BOTH
 * the multi-select config and the single-asset loop (verified reachable in
 * ios/ImagePickerModule.swift for both paths).
 */
const REPRESENTATION_MODE =
  ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible;

/** iOS Simulator / iCloud unreadable-asset signature, for friendlier copy. */
export function isUnreadableAssetError(message: string): boolean {
  return /load representation|failed to read|cannot load|unreadable|empty/i.test(message);
}

function reasonFor(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (isUnreadableAssetError(msg)) {
    return "iOS couldn't load this image's data — common with Simulator HEIC placeholders and iCloud photos that haven't finished downloading.";
  }
  return msg || 'Unknown error';
}

/**
 * Import existing photos from the library. Handles permission, the multi-select
 * attempt with a settle-once guard, the single-asset fallback loop, per-asset
 * normalization via `prepareCapturedPhoto`, progress, and per-asset failures.
 *
 * Returns an aggregate result; the caller drives UI (progress line, alerts) and
 * the store attach/enqueue via `onPhoto`.
 */
export async function importFromLibrary(
  args: ImportFromLibraryArgs,
): Promise<LibraryImportResult> {
  const { onPhoto, onProgress } = args;
  const selectionLimit = args.selectionLimit ?? IMPORT_SELECTION_LIMIT;

  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!perm.granted) {
    return {
      imported: 0,
      failures: [],
      usedFallback: false,
      permission: 'denied',
      permissionCanAskAgain: perm.canAskAgain,
      reachedLimit: false,
    };
  }

  const failures: LibraryImportFailure[] = [];
  let imported = 0;

  /** Prepare one asset and hand it to the caller; records its own failure. */
  const processAsset = async (uri: string, index: number): Promise<void> => {
    try {
      const small = await prepareCapturedPhoto(uri);
      await onPhoto(small, { index, imported: true });
      imported += 1;
    } catch (e) {
      failures.push({ index, uri, reason: reasonFor(e) });
    }
  };

  // ── 1 · Multi-select attempt ───────────────────────────────────────────
  if (args.multiSelect) {
    let assets: ImagePicker.ImagePickerAsset[] | null = null;
    try {
      const result = await pickOnce({
        mediaTypes: ['images'],
        allowsMultipleSelection: true,
        selectionLimit,
        // Badge assets in selection order and return them in that order, so
        // "Importing 7 of 30…" tracks what the roofer tapped.
        orderedSelection: true,
        quality: 1,
        preferredAssetRepresentationMode: REPRESENTATION_MODE,
      });
      if (!result.canceled) assets = result.assets;
    } catch (e) {
      // The whole-batch reject case (a single unreadable asset throws in
      // handleMultipleMedia). Fall through to the loop instead of failing.
      recordError(
        new Error(
          `[libraryImport] multi-select threw; falling back to single-asset loop: ${
            e instanceof Error ? e.message : String(e)
          }`,
        ),
        { kind: 'js_error' },
      );
      return runLoop(true);
    }

    if (assets === null) {
      // User cancelled the multi-select sheet — treat as "nothing to import",
      // not a fallback (they explicitly closed it).
      return {
        imported: 0,
        failures,
        usedFallback: false,
        permission: 'granted',
        permissionCanAskAgain: perm.canAskAgain,
        reachedLimit: false,
      };
    }
    if (assets.length === 0) {
      // Presented but empty (rare) — try the loop so the button still works.
      recordError(
        new Error('[libraryImport] multi-select returned no assets; using single-asset loop.'),
        { kind: 'js_error' },
      );
      return runLoop(true);
    }

    const total = assets.length;
    onProgress?.({ done: 0, total, phase: 'multi' });
    for (let i = 0; i < assets.length; i++) {
      await processAsset(assets[i].uri, i);
      onProgress?.({ done: imported, total, phase: 'multi' });
    }
    return {
      imported,
      failures,
      usedFallback: false,
      permission: 'granted',
      permissionCanAskAgain: perm.canAskAgain,
      reachedLimit: total >= selectionLimit,
    };
  }

  // Setting is off → straight to the proven loop (not a "fallback" from a
  // failure, but the deliberate safe path).
  return runLoop(false);

  // ── 2 · Single-asset fallback loop ─────────────────────────────────────
  // Re-present the single-select picker until the user taps Cancel or the loop
  // limit is hit. Each present settles exactly once (pickOnce). This is the
  // path that never tripped the #24 crash.
  async function runLoop(fromFallback: boolean): Promise<LibraryImportResult> {
    let reachedLimit = false;
    for (let i = 0; i < IMPORT_LOOP_LIMIT; i++) {
      let asset: ImagePicker.ImagePickerAsset | undefined;
      try {
        const result = await pickOnce({
          mediaTypes: ['images'],
          allowsMultipleSelection: false,
          quality: 1,
          preferredAssetRepresentationMode: REPRESENTATION_MODE,
        });
        if (result.canceled || result.assets.length === 0) break; // "done adding"
        asset = result.assets[0];
      } catch (e) {
        // One bad asset ends the run rather than looping the same failure.
        failures.push({ index: i, reason: reasonFor(e) });
        break;
      }
      await processAsset(asset.uri, i);
      onProgress?.({ done: imported, total: imported, phase: 'single' });
      if (i === IMPORT_LOOP_LIMIT - 1) reachedLimit = true;
    }
    return {
      imported,
      failures,
      usedFallback: fromFallback,
      permission: 'granted',
      permissionCanAskAgain: perm.canAskAgain,
      reachedLimit,
    };
  }
}
