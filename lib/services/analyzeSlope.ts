// Bulk-analyze a slope: re-reads each captured photo from disk, runs
// Gemini on it, and writes the resulting markers/findings back into the
// inspection store with photoIndex tagging.

// SDK 54: string-based readAsStringAsync lives under `/legacy`.
import * as FileSystem from 'expo-file-system/legacy';
import {
  NO_ROOF_MESSAGE,
  analyzePhoto,
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
import { recordAnalysisMs } from './telemetry';
import type { SafetyForecast } from './safetyEngine';
import type { Slope } from '../models/types';

export type SlopeAnalysisProgress = {
  done: number;
  total: number;
  current?: string;
};

export type SlopeAnalysisResult = {
  results: AnalysisResult[];
  attached: number;
  failed: number;
};

export async function analyzeSlope(
  inspectionId: string,
  slopeId: string,
  opts: {
    onlyNew?: boolean;
    onProgress?: (p: SlopeAnalysisProgress) => void;
  } = {},
): Promise<SlopeAnalysisResult> {
  const inspection = useInspectionStore.getState().inspections.find((i) => i.id === inspectionId);
  const slope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!inspection || !slope) {
    throw new Error('Slope not found');
  }

  const todoIndexes = pickPhotos(slope, opts.onlyNew ?? true);
  if (todoIndexes.length === 0) {
    // No pass ran — nothing to time, nothing new to snapshot.
    return { results: [], attached: 0, failed: 0 };
  }

  // Speed instrumentation (PRODUCT_SYNTHESIS §"Workflow & speed contracts":
  // analysis P50 ≤60s / P95 ≤180s). Local only — see lib/services/telemetry.ts.
  const startedAtMs = Date.now();
  const profile = computeProfile(useCorrectionsStore.getState().corrections);
  const prefix = userStylePromptPrefix(profile);
  const results: AnalysisResult[] = [];
  let attached = 0;
  let failed = 0;
  let withheldPhotos = 0;
  let noRoofPhotos = 0;

  for (let i = 0; i < todoIndexes.length; i++) {
    const photoIndex = todoIndexes[i];
    const uri = slope.photoPaths[photoIndex];
    opts.onProgress?.({ done: i, total: todoIndexes.length, current: uri });

    try {
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: FileSystem.EncodingType.Base64,
      });
      const r = await analyzePhoto({
        imageBase64: base64,
        slope: slope.orientation,
        userStylePrefix: prefix || undefined,
      });
      results.push(r);
      useInspectionStore.getState().replacePhotoMarkers(
        inspection.id,
        slope.id,
        photoIndex,
        r.markers,
      );
      mergeFindingsForPhoto(inspectionId, slopeId, photoIndex, r);

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
    } catch {
      failed++;
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
  const forecast = await safetyForecastForInspection(inspectionId);
  storeEngineSnapshot(inspectionId, forecast);
  void recordAnalysisMs(todoIndexes.length, Date.now() - startedAtMs);

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

  return { results, attached, failed };
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
