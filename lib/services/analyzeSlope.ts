// Bulk-analyze a slope: re-reads each captured photo from disk, runs
// Gemini on it, and writes the resulting markers/findings back into the
// inspection store with photoIndex tagging.
//
// FAILURE CONTRACT (spec §1, 2026-09-01): a photo that fails analysis lands
// in an explicit `failed` state on `slope.photoAnalysis[uri]` carrying the
// plain-words reason, gets a toast, and stays retryable via
// `retryPhotoAnalysis` / "Analyze N new". Nothing is ever left as a silent,
// permanent "pending". Every transition is written to the store so the
// capture review strip and the Analyze screen can render Queued / Analyzing /
// Done (n) / Failed · Retry from one source of truth.

// SDK 54: string-based readAsStringAsync lives under `/legacy`.
import * as FileSystem from 'expo-file-system/legacy';
import {
  GeminiAnalysisError,
  GeminiNotConfiguredError,
  NO_ROOF_MESSAGE,
  analyzePhoto,
  describeAnalysisError,
  isRetryableGeminiError,
  type AnalysisResult,
} from './gemini';
import { useInspectionStore } from '../stores/inspectionStore';
import { useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { useToastStore } from '../stores/toastStore';
import { computeProfile } from './learning/userCorrectionProfile';
import { userStylePromptPrefix } from './learning/localLearningEngine';
import { needsExpertReview } from './confidenceTiers';
import { snapshotEngineResult } from './storedEngine';
import { getSafetyForecast } from './weather';
import { clearMark, mark, measure, recordAnalysisMs } from './telemetry';
import type { SafetyForecast } from './safetyEngine';
import type { PhotoAnalysisState, Slope } from '../models/types';

export type SlopeAnalysisProgress = {
  done: number;
  total: number;
  current?: string;
};

export type PhotoAnalysisFailure = {
  photoIndex: number;
  uri: string;
  /** Plain-words reason, safe to show the roofer as-is. */
  reason: string;
  /** HTTP status when the failure was an API response. */
  status?: number;
  /** Whether a plain retry could plausibly succeed. */
  retryable: boolean;
};

export type SlopeAnalysisResult = {
  results: AnalysisResult[];
  attached: number;
  failed: number;
  /** One entry per failed photo — the reason the UI must show. */
  failures: PhotoAnalysisFailure[];
  /** Model that answered the last successful photo in this pass. */
  modelUsed?: string;
};

/** Telemetry metric names (lib/services/telemetry.ts). Durations only —
 *  a failed sample is recorded under its own metric so P50/P95 for the
 *  happy path are not polluted by hung sockets. */
export const PHOTO_ANALYSIS_METRIC = {
  /** One photo: file read + Gemini round-trip, success only. */
  photo: 'analysis_photo',
  /** One photo, attempt that ended in failure. */
  photoFailed: 'analysis_photo_failed',
  /** Base64 read of one photo from device storage. */
  fileRead: 'analysis_file_read',
} as const;

/**
 * Inline-data ceiling. Gemini caps the whole request at 20 MB and base64
 * inflates bytes by 4/3, so anything past this cannot be sent — say so
 * instead of letting the API answer with an opaque 400. A 2560px/0.82 JPEG
 * from the capture pipeline is 1–3 MB; only a raw library import can trip
 * this.
 */
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

class PhotoFileError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PhotoFileError';
  }
}

export type AnalyzeSlopeOptions = {
  /** Skip photos already in `analyzedPhotoIndices`. Default true. Ignored
   *  when `photoIndexes` is given. */
  onlyNew?: boolean;
  /** Explicit subset — the per-photo Retry path. */
  photoIndexes?: number[];
  onProgress?: (p: SlopeAnalysisProgress) => void;
  /** Cancel the pass (screen unmounted). Photos not yet attempted keep
   *  their previous state; the in-flight one is marked failed as cancelled. */
  signal?: AbortSignal;
};

export async function analyzeSlope(
  inspectionId: string,
  slopeId: string,
  opts: AnalyzeSlopeOptions = {},
): Promise<SlopeAnalysisResult> {
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!inspection || !slope) {
    throw new Error('Slope not found');
  }

  const todoIndexes = opts.photoIndexes
    ? opts.photoIndexes.filter((i) => i >= 0 && i < slope.photoPaths.length)
    : pickPhotos(slope, opts.onlyNew ?? true);
  if (todoIndexes.length === 0) {
    // No pass ran — nothing to time, nothing new to snapshot.
    return { results: [], attached: 0, failed: 0, failures: [] };
  }

  // Speed instrumentation (PRODUCT_SYNTHESIS §"Workflow & speed contracts":
  // analysis P50 ≤60s / P95 ≤180s). Local only — see lib/services/telemetry.ts.
  const startedAtMs = Date.now();
  const profile = computeProfile(useCorrectionsStore.getState().corrections);
  const prefix = userStylePromptPrefix(profile);
  const results: AnalysisResult[] = [];
  const failures: PhotoAnalysisFailure[] = [];
  let attached = 0;
  let withheldPhotos = 0;
  let noRoofPhotos = 0;
  let modelUsed: string | undefined;

  // Every photo in this pass is visibly "queued" before the first request
  // goes out, so a multi-photo pass never shows photo 6 as untouched while
  // photo 1 is analyzing.
  for (const photoIndex of todoIndexes) {
    const uri = slope.photoPaths[photoIndex];
    const prev = slope.photoAnalysis?.[uri];
    if (prev?.status !== 'analyzing') {
      setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'queued' });
    }
  }

  for (let i = 0; i < todoIndexes.length; i++) {
    const photoIndex = todoIndexes[i];
    const uri = slope.photoPaths[photoIndex];
    opts.onProgress?.({ done: i, total: todoIndexes.length, current: uri });

    if (opts.signal?.aborted) {
      // Leave the untouched photos exactly as they were — they were never
      // attempted, so "failed" would be a lie and "queued" a promise nobody
      // is keeping. Restore the pre-pass state.
      restoreUnattempted(inspectionId, slopeId, slope, todoIndexes.slice(i));
      break;
    }

    const attempts = (slope.photoAnalysis?.[uri]?.attempts ?? 0) + 1;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'analyzing', attempts });
    const photoMark = `analysis.photo.${inspectionId}.${slopeId}.${photoIndex}`;
    mark(photoMark);

    try {
      const base64 = await readPhotoBase64(uri);
      const r = await analyzePhoto({
        imageBase64: base64,
        slope: slope.orientation,
        userStylePrefix: prefix || undefined,
        signal: opts.signal,
      });
      results.push(r);
      modelUsed = r.modelUsed ?? modelUsed;
      useInspectionStore.getState().replacePhotoMarkers(
        inspection.id,
        slope.id,
        photoIndex,
        r.markers,
      );
      mergeFindingsForPhoto(inspectionId, slopeId, photoIndex, r);
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'done',
        attempts,
        modelUsed: r.modelUsed,
        latencyMs: r.latencyMs,
        findingCount: r.markers.length,
        noRoofDetected: r.noRoofDetected,
      });
      measure(photoMark, { metric: PHOTO_ANALYSIS_METRIC.photo, n: 1 });

      // Canonical review gate (PRODUCT_SYNTHESIS §1): ANY detection below the
      // 80-confidence review threshold queues the photo for inspector review.
      const shouldQueue = r.markers.some((m) => needsExpertReview(m.confidence));
      if (shouldQueue) {
        useTrainingQueueStore.getState().enqueue({
          inspectionId,
          slopeId,
          photoPath: uri,
          findings: r.findings,
          markers: r.markers,
        });
      }

      // No-roof photos come back with an empty detectionAudit by design, so
      // the "withheld detections" toast below never fires for them — count
      // them separately and tell the inspector with the friendly message
      // (Drift #5: honest unavailability, never silence).
      if (r.noRoofDetected) {
        noRoofPhotos++;
      } else {
        // #31 follow-up: when the client filter withheld everything the model
        // produced, that photo would otherwise be indistinguishable from a
        // clean roof. Count it so the inspector gets told below.
        const audit = r.detectionAudit;
        if (audit.gridRejected || (audit.rawCount > 0 && audit.keptCount === 0)) {
          withheldPhotos++;
        }
      }

      attached++;
    } catch (e) {
      const reason = describeAnalysisError(e);
      const status = e instanceof GeminiAnalysisError ? e.status : undefined;
      const retryable = isRetryableFailure(e);
      failures.push({ photoIndex, uri, reason, status, retryable });
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'failed',
        attempts,
        error: reason,
        errorStatus: status,
      });
      measure(photoMark, { metric: PHOTO_ANALYSIS_METRIC.photoFailed, n: 1 });
      if (__DEV__) {
        console.warn(`[analyzeSlope] photo ${photoIndex} failed: ${reason}`);
      }

      if (isPassFatal(e)) {
        // Same key / same quota / same dead model for every remaining photo:
        // hammering the API N more times only burns budget and delays the
        // roofer seeing the reason. Mark the rest failed with the SAME reason
        // (they are retryable once the cause is fixed) and stop.
        const rest = todoIndexes.slice(i + 1);
        for (const idx of rest) {
          const restUri = slope.photoPaths[idx];
          failures.push({ photoIndex: idx, uri: restUri, reason, status, retryable: true });
          setPhotoAnalysisState(inspectionId, slopeId, restUri, {
            status: 'failed',
            error: `Not attempted — ${reason}`,
            errorStatus: status,
          });
        }
        break;
      }
    }
  }
  opts.onProgress?.({ done: todoIndexes.length, total: todoIndexes.length });

  // Post-pass bookkeeping. The per-mode hit split is already done: every
  // marker write above went through the store's `withRecount`, which buckets
  // `squareHitCount` / `singleShingleHitCount` in the same pass it recounts
  // `hailCount`. All that is left is to freeze the engine result those inputs
  // produce — best-effort, since a failure here must never lose the
  // detections already written.
  //
  // §7 roofer safety needs a real forecast; the engine is pure, so the fetch
  // happens here. Null (no key, offline, no location permission) is passed
  // through as `undefined` — never `{}`, which would rate USE_CAUTION off
  // missing inputs and launder "we don't know" into a rating.
  if (attached > 0) {
    const forecast = await safetyForecastForInspection(inspectionId);
    storeEngineSnapshot(inspectionId, forecast);
    void recordAnalysisMs(attached, Date.now() - startedAtMs);
  }

  if (noRoofPhotos > 0) {
    useToastStore.getState().show({
      tone: 'warn',
      title: 'No roof detected',
      body:
        `${noRoofPhotos} photo${noRoofPhotos === 1 ? '' : 's'}: ${NO_ROOF_MESSAGE}`,
    });
  }

  if (withheldPhotos > 0) {
    useToastStore.getState().show({
      tone: 'warn',
      title: 'AI withheld unreliable detections',
      body:
        `${withheldPhotos} photo${withheldPhotos === 1 ? '' : 's'} produced detections ` +
        'the AI couldn’t trust, so nothing was marked. Re-shoot in better light ' +
        'or add markers manually in Edit Detection.',
    });
  }

  if (failures.length > 0) {
    // One toast per pass, first reason verbatim — the per-photo state on the
    // slope carries the rest and the Retry affordance.
    const n = failures.length;
    useToastStore.getState().show({
      tone: 'danger',
      title: `Analysis failed — ${n} photo${n === 1 ? '' : 's'}`,
      body: `${failures[0].reason} Retry from the slope's photo list.`,
    });
  }

  return { results, attached, failed: failures.length, failures, modelUsed };
}

/**
 * Re-run ONE photo — the "Failed · Retry" entry point. Ignores
 * `analyzedPhotoIndices` so a photo that once succeeded can be re-analyzed
 * too. Returns the pass result (0 or 1 photo).
 */
export function retryPhotoAnalysis(
  inspectionId: string,
  slopeId: string,
  photoIndex: number,
  opts: Pick<AnalyzeSlopeOptions, 'onProgress' | 'signal'> = {},
): Promise<SlopeAnalysisResult> {
  return analyzeSlope(inspectionId, slopeId, { ...opts, photoIndexes: [photoIndex] });
}

/**
 * Per-photo analysis state for UI. Photos analyzed before `photoAnalysis`
 * existed are reported as `done` (they are in `analyzedPhotoIndices`);
 * a captured photo nobody has queued yet returns undefined — render that as
 * "Not analyzed", not as "Queued".
 */
export function getPhotoAnalysisState(
  slope: Pick<Slope, 'photoPaths' | 'photoAnalysis' | 'analyzedPhotoIndices' | 'damage'>,
  photoIndex: number,
): PhotoAnalysisState | undefined {
  const uri = slope.photoPaths[photoIndex];
  if (uri == null) return undefined;
  const explicit = slope.photoAnalysis?.[uri];
  if (explicit) return explicit;
  if ((slope.analyzedPhotoIndices ?? []).includes(photoIndex)) {
    return {
      status: 'done',
      at: '',
      findingCount: slope.damage.filter((m) => m.photoIndex === photoIndex).length,
    };
  }
  return undefined;
}

/**
 * Mark photos as queued the moment a job is enqueued (capture flow / Analyze
 * screen), so the strip shows "Queued" before the drain loop gets to them.
 * Defaults to every not-yet-analyzed photo on the slope.
 */
export function markPhotosQueued(inspectionId: string, slopeId: string, uris?: string[]): void {
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!slope) return;
  const targets = uris ?? pickPhotos(slope, true).map((i) => slope.photoPaths[i]);
  for (const uri of targets) {
    const prev = slope.photoAnalysis?.[uri];
    if (prev?.status === 'analyzing' || prev?.status === 'done') continue;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'queued' });
  }
}

/**
 * Mark photos failed WITHOUT attempting them — for a job the queue cannot
 * run at all (no API key). The reason must say why in plain words.
 */
export function markPhotosFailed(
  inspectionId: string,
  slopeId: string,
  reason: string,
  uris?: string[],
): void {
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!slope) return;
  const targets = uris ?? pickPhotos(slope, true).map((i) => slope.photoPaths[i]);
  for (const uri of targets) {
    if (slope.photoAnalysis?.[uri]?.status === 'done') continue;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'failed', error: reason });
  }
}

/**
 * Single writer for `slope.photoAnalysis`. Merges over the previous entry,
 * stamps `at`, and drops entries for URIs no longer in `photoPaths` (deleted
 * or rotated photos) so the record stays bounded by the photo count. Clears
 * `error` on any non-failed transition so a stale reason never outlives its
 * retry.
 */
export function setPhotoAnalysisState(
  inspectionId: string,
  slopeId: string,
  uri: string,
  patch: Partial<PhotoAnalysisState> & { status: PhotoAnalysisState['status'] },
): void {
  useInspectionStore.setState((state) => ({
    inspections: state.inspections.map((ins) => {
      if (ins.id !== inspectionId) return ins;
      return {
        ...ins,
        slopes: ins.slopes.map((sl) => {
          if (sl.id !== slopeId) return sl;
          const live = new Set(sl.photoPaths);
          const next: Record<string, PhotoAnalysisState> = {};
          for (const [key, value] of Object.entries(sl.photoAnalysis ?? {})) {
            if (live.has(key)) next[key] = value;
          }
          const prev = next[uri];
          const merged: PhotoAnalysisState = {
            ...prev,
            ...patch,
            at: new Date().toISOString(),
          };
          if (patch.status !== 'failed') {
            delete merged.error;
            delete merged.errorStatus;
          }
          next[uri] = merged;
          return { ...sl, photoAnalysis: next };
        }),
      };
    }),
  }));
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/** Read one photo as base64 with explicit, human-readable failure modes. */
async function readPhotoBase64(uri: string): Promise<string> {
  let info: FileSystem.FileInfo | null = null;
  try {
    // Legacy API always reports `size` for an existing file.
    info = await FileSystem.getInfoAsync(uri);
  } catch {
    // Some URI schemes (content://, ph://) reject getInfoAsync but still
    // read; fall through and let readAsStringAsync be the judge.
  }
  if (info && !info.exists) {
    throw new PhotoFileError(
      'Photo file is missing from this device (deleted, or app storage was cleared). Re-shoot it.',
    );
  }
  if (info && info.exists && info.size > MAX_PHOTO_BYTES) {
    const mb = (info.size / (1024 * 1024)).toFixed(1);
    throw new PhotoFileError(
      `Photo is too large to send (${mb} MB). Re-import it so the app can resize it to 2560px.`,
    );
  }

  const readMark = `analysis.read.${uri}`;
  mark(readMark);
  let base64: string;
  try {
    base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });
  } catch (e) {
    clearMark(readMark);
    const detail = e instanceof Error ? e.message : String(e);
    throw new PhotoFileError(`Could not read the photo from device storage (${detail}).`);
  }
  measure(readMark, { metric: PHOTO_ANALYSIS_METRIC.fileRead });

  if (!base64 || base64.length < 64) {
    throw new PhotoFileError('Photo file is empty or unreadable. Re-shoot it.');
  }
  return base64;
}

/** Whether a plain retry could plausibly succeed for this failure. */
function isRetryableFailure(e: unknown): boolean {
  if (e instanceof PhotoFileError) return false;
  return isRetryableGeminiError(e);
}

/**
 * Failures that will repeat identically for every remaining photo in the
 * pass — stop instead of burning N more calls. Safety blocks, unparseable
 * output, hung sockets and unreadable files are photo-specific; the pass
 * continues past those.
 */
function isPassFatal(e: unknown): boolean {
  if (e instanceof GeminiNotConfiguredError) return true;
  if (e instanceof GeminiAnalysisError) {
    return (
      e.code === 'auth' ||
      e.code === 'model_unavailable' ||
      e.code === 'quota' ||
      e.code === 'network'
    );
  }
  return false;
}

/** Put never-attempted photos back to whatever they were before the pass. */
function restoreUnattempted(
  inspectionId: string,
  slopeId: string,
  before: Slope,
  indexes: number[],
): void {
  for (const idx of indexes) {
    const uri = before.photoPaths[idx];
    const prev = before.photoAnalysis?.[uri];
    if (prev) {
      setPhotoAnalysisState(inspectionId, slopeId, uri, prev);
    } else {
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'failed',
        error: 'Not attempted — analysis was cancelled. Retry when ready.',
      });
    }
  }
}

function pickPhotos(slope: Slope, onlyNew: boolean): number[] {
  if (!onlyNew) return slope.photoPaths.map((_, i) => i);
  // Uses the explicit analyzed-index record, not `damage` markers — a photo
  // analyzed and found clean has no markers, and inferring "analyzed" from
  // marker presence would re-send it to Gemini on every "analyze new only"
  // pass forever.
  const analyzed = new Set(slope.analyzedPhotoIndices ?? []);
  return slope.photoPaths.map((_, i) => i).filter((i) => !analyzed.has(i));
}

/**
 * Best-effort §7 forecast for the inspection's address. Returns `undefined`
 * (not an empty object) whenever the real conditions are unknown.
 */
async function safetyForecastForInspection(inspectionId: string): Promise<SafetyForecast | undefined> {
  try {
    const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
    const coord =
      inspection?.lat != null && inspection?.lng != null
        ? { lat: inspection.lat, lng: inspection.lng }
        : undefined;
    return (await getSafetyForecast(coord)) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Freeze the decision-engine result for this inspection right after the
 * analysis that produced it, so every later report restates a stored
 * determination instead of re-deriving one at render time
 * (lib/services/storedEngine.ts).
 *
 * Reads the store AFTER the markers (and the mode counts the store derives
 * from them) are written, so the snapshot reflects the pass that just
 * completed.
 *
 * Skipped once a report has been finalized: the store rejects the write
 * anyway (see `setStoredEngineResult`), and re-analysis is not the deliberate
 * re-finalize that is allowed to replace a signed determination. The job
 * screen surfaces the resulting drift as "out of date" and re-freezes when
 * the roofer regenerates the report.
 */
function storeEngineSnapshot(inspectionId: string, forecast?: SafetyForecast): void {
  try {
    const store = useInspectionStore.getState();
    const inspection = store.inspections.find((i) => i.id === inspectionId);
    if (!inspection || inspection.reportFinalizedAt) return;
    const { payload, at } = snapshotEngineResult(inspection, undefined, forecast);
    store.setStoredEngineResult(inspection.id, payload, at);
  } catch {
    // A missed snapshot is recoverable: report layers fall back to evaluating
    // the engine at render time. Losing the analysis results is not.
  }
}

function mergeFindingsForPhoto(
  inspectionId: string,
  slopeId: string,
  photoIndex: number,
  result: AnalysisResult,
) {
  useInspectionStore.setState((state) => ({
    inspections: state.inspections.map((ins) => {
      if (ins.id !== inspectionId) return ins;
      return {
        ...ins,
        slopes: ins.slopes.map((sl) => {
          if (sl.id !== slopeId) return sl;
          // Persist the per-photo scale calibration estimate alongside the
          // findings so calibration logging survives (and syncs with) the
          // inspection record.
          const scale = result.shingleScaleEstimate;
          const scaleEstimates = scale
            ? [
                ...(sl.scaleEstimates ?? []).filter((e) => e.photoIndex !== photoIndex),
                {
                  photoIndex,
                  pixelsPerInch: scale.pixelsPerInch,
                  confidence: scale.confidence,
                  reference: scale.reference,
                },
              ]
            : sl.scaleEstimates;
          return {
            ...sl,
            aiFindings: [...(sl.aiFindings ?? []), ...result.findings],
            scaleEstimates,
          };
        }),
      };
    }),
  }));
}
