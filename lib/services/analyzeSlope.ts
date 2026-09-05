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
  analyzePhotoTiled,
  describeAnalysisError,
  isRetryableGeminiError,
  type AnalysisResult,
} from './gemini';
import { deriveFunctional } from './functionalDamage';
import { patchPhotoAnalysis, readPhotoAnalysis } from './photoAnalysisState';
import { useInspectionStore } from '../stores/inspectionStore';
import { useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { useToastStore } from '../stores/toastStore';
import { computeProfile } from './learning/userCorrectionProfile';
import { userStylePromptPrefix, effectiveThreshold } from './learning/localLearningEngine';
import { needsExpertReview } from './confidenceTiers';
import { useAiSettingsStore } from '../stores/aiSettingsStore';
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

/**
 * Passes currently running, keyed by slope.
 *
 * Two callers targeting the same slope at once is the NORMAL case, not an edge
 * one: the analyze screen hands its remaining photos to the background queue
 * when the inspector moves on to the job, and the queue picks the slope up
 * while that screen's own pass is still in flight. Both passes run `onlyNew`,
 * both see the same not-yet-analyzed indices, and both attach their markers —
 * doubling the hail count that HAAG §2 decides replacement on.
 *
 * A second call therefore joins the pass already running instead of starting a
 * rival one. It receives that pass's result, which means a `photoIndexes` or
 * `onlyNew: false` request arriving mid-pass is answered by the pass in flight
 * rather than re-running; callers that need a genuine re-analysis (the screen's
 * "Re-analyze all") disable themselves while a pass is running.
 */
const inFlightBySlope = new Map<string, Promise<SlopeAnalysisResult>>();

export function analyzeSlope(
  inspectionId: string,
  slopeId: string,
  opts: AnalyzeSlopeOptions = {},
): Promise<SlopeAnalysisResult> {
  const key = `${inspectionId}:${slopeId}`;
  const running = inFlightBySlope.get(key);
  if (running) return running;
  const pass = runAnalyzeSlope(inspectionId, slopeId, opts).finally(() => {
    inFlightBySlope.delete(key);
  });
  inFlightBySlope.set(key, pass);
  return pass;
}

/** True while a pass is running for this slope — drives "still analyzing" UI. */
export function isSlopeAnalysisRunning(inspectionId: string, slopeId: string): boolean {
  return inFlightBySlope.has(`${inspectionId}:${slopeId}`);
}

async function runAnalyzeSlope(
  inspectionId: string,
  slopeId: string,
  opts: AnalyzeSlopeOptions = {},
): Promise<SlopeAnalysisResult> {
  useInspectionStore.getState().ensurePhotoAttachmentIds(inspectionId, slopeId);
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const savedSlope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!inspection || !savedSlope) {
    throw new Error('Slope not found');
  }
  // Capture immutable request identities: capture may append to the store's
  // slope object while this pass is suspended.
  const slope = { ...savedSlope, photoPaths: [...savedSlope.photoPaths], photoAttachmentIds: [...(savedSlope.photoAttachmentIds ?? [])] };

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
    const prev = readPhotoAnalysis(slope, photoIndex);
    if (prev?.status !== 'analyzing') {
      setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'queued' }, slope.photoAttachmentIds[photoIndex]);
    }
  }

  for (let i = 0; i < todoIndexes.length; i++) {
    const photoIndex = todoIndexes[i];
    const uri = slope.photoPaths[photoIndex];
    const attachmentId = slope.photoAttachmentIds[photoIndex];
    opts.onProgress?.({ done: i, total: todoIndexes.length, current: uri });

    if (opts.signal?.aborted) {
      // Leave the untouched photos exactly as they were — they were never
      // attempted, so "failed" would be a lie and "queued" a promise nobody
      // is keeping. Restore the pre-pass state.
      restoreUnattempted(inspectionId, slopeId, slope, todoIndexes.slice(i));
      break;
    }

    // Indices are only a request-time selection. Removing an earlier photo
    // renumbers the live slope while file/model I/O is pending. A URI may
    // appear twice or be removed and reattached; only the attachment ID lasts.
    const target = livePhoto(inspectionId, slopeId, uri, attachmentId);
    if (!target) continue;
    const attempts = (readPhotoAnalysis(target.slope, target.index)?.attempts ?? 0) + 1;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'analyzing', attempts }, attachmentId);
    const photoMark = `analysis.photo.${inspectionId}.${slopeId}.${photoIndex}`;
    mark(photoMark);

    try {
      const base64 = await readPhotoBase64(uri);
      const beforeRequest = livePhoto(inspectionId, slopeId, uri, attachmentId);
      if (!beforeRequest) {
        clearMark(photoMark);
        continue;
      }
      const photoMeta = beforeRequest.slope.photoMeta?.find((m) => m.photoIndex === beforeRequest.index);
      const captureMode = photoMeta?.captureMode ?? 'square_10x10';
      const analyzeOpts = {
        imageBase64: base64,
        slope: slope.orientation,
        // What the inspector told the camera — test square vs close-up decides
        // what counting means; the declared material sets the geometry.
        captureMode,
        areaTag: photoMeta?.areaTag,
        material: inspection.material,
        userStylePrefix: prefix || undefined,
        signal: opts.signal,
      };
      // Test squares decide the per-square threshold, so they get the tiled
      // pass (full frame + 2×2 at full resolution, PROMPT_LOG #79) unless the
      // roofer turned it off in Settings → AI thresholds. Close-ups and
      // collateral shots are one call — a single shingle is already large.
      const r =
        captureMode === 'square_10x10' && useAiSettingsStore.getState().tiledTestSquares !== false
          ? await analyzePhotoTiled({ ...analyzeOpts, uri })
          : await analyzePhoto(analyzeOpts);
      results.push(r);
      modelUsed = r.modelUsed ?? modelUsed;

      // Never attach a removed/rotated photo's response to its replacement.
      // Resolve again AFTER the await, before any index-based store write.
      const destination = livePhoto(inspectionId, slopeId, uri, attachmentId);
      if (!destination) {
        clearMark(photoMark);
        continue;
      }
      const destinationIndex = destination.index;

      // --- AI threshold control (BACKLOG #6 + #11): per-category confidence
      // gate, applied exactly here — where Gemini markers are mapped onto the
      // slope. `effectiveThreshold()` (learning/localLearningEngine.ts) was
      // computed from this inspector's correction history but never
      // consulted anywhere; `profile` above (built for the prompt prefix) is
      // reused so a category the inspector keeps rejecting is held to a
      // stricter bar. The roofer's own floor (Settings → AI thresholds,
      // aiSettingsStore.ts) is a hard minimum the learned value can only
      // raise, never loosen below. Toggling the store off restores the
      // pre-existing behavior of keeping every marker Gemini returned.
      const aiSettings = useAiSettingsStore.getState();
      const gatedMarkers = aiSettings.enabled
        ? r.markers.filter(
            (m) =>
              m.confidence >=
              Math.max(
                aiSettings.perCategoryFloor[m.category] ?? 0,
                effectiveThreshold(profile, m.category),
              ),
          )
        : r.markers;

      useInspectionStore.getState().replacePhotoMarkers(
        inspection.id,
        slope.id,
        destinationIndex,
        gatedMarkers,
      );
      mergeFindingsForPhoto(inspectionId, slopeId, destinationIndex, r);
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'done',
        attempts,
        modelUsed: r.modelUsed,
        latencyMs: r.latencyMs,
        findingCount: r.markers.length,
        noRoofDetected: r.noRoofDetected,
        // What THIS photo shows, for the per-photo report: the shingle type
        // read here (not the job's declared material), and — when the frame
        // is not a roof — what it is and the collateral damage on it.
        shingleType: r.shingleType,
        subject: r.subject,
        subjectDetail: r.subjectDetail,
        collateralDamage: r.collateralDamage,
        shingleCount: r.shingleCount,
        squareCoverage: r.squareCoverage,
      }, attachmentId);
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
          reviewEvidence: {
            attachmentId,
            markers: gatedMarkers,
            findings: r.findings,
            analysisAt: readPhotoAnalysis(useInspectionStore.getState().getById(inspectionId)!
              .slopes.find((sl) => sl.id === slopeId)!, destinationIndex)!.at,
          },
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
      const failedTarget = livePhoto(inspectionId, slopeId, uri, attachmentId);
      if (!failedTarget) {
        clearMark(photoMark);
        continue;
      }
      const reason = describeAnalysisError(e);
      const status = e instanceof GeminiAnalysisError ? e.status : undefined;
      const retryable = isRetryableFailure(e);
      failures.push({ photoIndex: failedTarget.index, uri, reason, status, retryable });
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'failed',
        attempts,
        error: reason,
        errorStatus: status,
      }, attachmentId);
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
          const restTarget = livePhoto(inspectionId, slopeId, restUri, slope.photoAttachmentIds[idx]);
          if (!restTarget) continue;
          failures.push({ photoIndex: restTarget.index, uri: restUri, reason, status, retryable: true });
          setPhotoAnalysisState(inspectionId, slopeId, restUri, {
            status: 'failed',
            error: `Not attempted — ${reason}`,
            errorStatus: status,
          }, slope.photoAttachmentIds[idx]);
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
  slope: Pick<Slope, 'photoPaths' | 'photoAttachmentIds' | 'photoAnalysis' | 'photoAnalysisByAttachment' | 'analyzedPhotoIndices' | 'damage'>,
  photoIndex: number,
): PhotoAnalysisState | undefined {
  const uri = slope.photoPaths[photoIndex];
  if (uri == null) return undefined;
  const explicit = readPhotoAnalysis(slope, photoIndex);
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
  useInspectionStore.getState().ensurePhotoAttachmentIds(inspectionId, slopeId);
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!slope) return;
  const targets = uris ? slope.photoPaths.flatMap((uri, index) => uris.includes(uri) ? [index] : []) : pickPhotos(slope, true);
  for (const index of targets) {
    const uri = slope.photoPaths[index];
    const prev = readPhotoAnalysis(slope, index);
    if (prev?.status === 'analyzing' || prev?.status === 'done') continue;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'queued' }, slope.photoAttachmentIds?.[index]);
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
  useInspectionStore.getState().ensurePhotoAttachmentIds(inspectionId, slopeId);
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!slope) return;
  const targets = uris ? slope.photoPaths.flatMap((uri, index) => uris.includes(uri) ? [index] : []) : pickPhotos(slope, true);
  for (const index of targets) {
    const uri = slope.photoPaths[index];
    if (readPhotoAnalysis(slope, index)?.status === 'done') continue;
    setPhotoAnalysisState(inspectionId, slopeId, uri, { status: 'failed', error: reason }, slope.photoAttachmentIds?.[index]);
  }
}

/**
 * Canonical attachment-state writer. Stamps `at`, rebuilds the unique-URI
 * compatibility mirror and clears stale errors on retry. A legacy URI-only
 * caller may update only a unique attachment; asynchronous passes carry ID.
 */
export function setPhotoAnalysisState(
  inspectionId: string,
  slopeId: string,
  uri: string,
  patch: Partial<PhotoAnalysisState> & { status: PhotoAnalysisState['status'] },
  attachmentId?: string,
): void {
  const current = useInspectionStore.getState().getById(inspectionId)?.slopes.find((sl) => sl.id === slopeId);
  if (!current?.photoAttachmentIds) useInspectionStore.getState().ensurePhotoAttachmentIds(inspectionId, slopeId);
  useInspectionStore.setState((state) => ({
    inspections: state.inspections.map((ins) => {
      if (ins.id !== inspectionId) return ins;
      return {
        ...ins,
        slopes: ins.slopes.map((sl) => {
          if (sl.id !== slopeId) return sl;
          const index = attachmentId ? sl.photoAttachmentIds?.indexOf(attachmentId) ?? -1
            : sl.photoPaths.filter((path) => path === uri).length === 1 ? sl.photoPaths.indexOf(uri) : -1;
          if (index < 0 || sl.photoPaths[index] !== uri) return sl;
          return patchPhotoAnalysis(sl, index, { ...patch, at: new Date().toISOString() });
        }),
      };
    }),
  }));
}

// -----------------------------------------------------------------------------
// Internals
// -----------------------------------------------------------------------------

/** Resolve the current index only while the original evidence is still filed. */
function livePhoto(inspectionId: string, slopeId: string, uri: string, attachmentId: string | undefined): { slope: Slope; index: number } | undefined {
  const slope = useInspectionStore.getState().inspections
    .find((ins) => ins.id === inspectionId)?.slopes.find((sl) => sl.id === slopeId);
  if (!slope || !attachmentId) return undefined;
  const index = slope.photoAttachmentIds?.indexOf(attachmentId) ?? -1;
  return index < 0 || slope.photoPaths[index] !== uri ? undefined : { slope, index };
}

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
    if (!livePhoto(inspectionId, slopeId, uri, before.photoAttachmentIds?.[idx])) continue;
    const prev = readPhotoAnalysis(before, idx);
    if (prev) {
      setPhotoAnalysisState(inspectionId, slopeId, uri, prev, before.photoAttachmentIds?.[idx]);
    } else {
      setPhotoAnalysisState(inspectionId, slopeId, uri, {
        status: 'failed',
        error: 'Not attempted — analysis was cancelled. Retry when ready.',
      }, before.photoAttachmentIds?.[idx]);
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
          const next = {
            ...sl,
            aiFindings: [
              ...(sl.aiFindings ?? []).filter((f) => f.photoAttachmentId !== sl.photoAttachmentIds?.[photoIndex]),
              ...result.findings.map((f) => ({ ...f, photoPath: sl.photoPaths[photoIndex], photoAttachmentId: sl.photoAttachmentIds?.[photoIndex] })),
            ],
            scaleEstimates,
          };
          // §1 functional damage, DERIVED from the evidence the model reported
          // (mat fracture / exposed substrate on a test-square photo). This is
          // the flag the §4 tree and the damage score read; until now nothing
          // ever set it, so every AI-analyzed slope read "not functional".
          // replacePhotoMarkers ran just before this merge, so `next.damage`
          // already carries this photo's markers.
          return { ...next, functional: deriveFunctional(next).functional };
        }),
      };
    }),
  }));
}
