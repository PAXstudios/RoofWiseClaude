// Bulk-analyze a slope: re-reads each captured photo from disk, runs
// Gemini on it, and writes the resulting markers/findings back into the
// inspection store with photoIndex tagging.

import * as FileSystem from 'expo-file-system';
import {
  analyzePhoto,
  type AnalysisResult,
} from './gemini';
import { useInspectionStore } from '../stores/inspectionStore';
import { useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { useToastStore } from '../stores/toastStore';
import { computeProfile } from './learning/userCorrectionProfile';
import { userStylePromptPrefix } from './learning/localLearningEngine';
import type { Slope } from '../models/types';

const LOW_CONFIDENCE_THRESHOLD = 60;

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
    return { results: [], attached: 0, failed: 0 };
  }

  const profile = computeProfile(useCorrectionsStore.getState().corrections);
  const prefix = userStylePromptPrefix(profile);
  const results: AnalysisResult[] = [];
  let attached = 0;
  let failed = 0;
  let withheldPhotos = 0;

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
      mergeFindingsForPhoto(inspectionId, slopeId, r);

      // Auto-enqueue low-confidence detections for inspector review
      const avgConfidence = avgMarkerConfidence(r.markers);
      const shouldQueue =
        r.markers.length > 0 &&
        (avgConfidence < LOW_CONFIDENCE_THRESHOLD || r.markers.length > 10);
      if (shouldQueue) {
        useTrainingQueueStore.getState().enqueue({
          inspectionId,
          slopeId,
          photoPath: uri,
          findings: r.findings,
          markers: r.markers,
        });
      }

      // #31 follow-up: when the client filter withheld everything the model
      // produced, that photo would otherwise be indistinguishable from a
      // clean roof. Count it so the inspector gets told below.
      const audit = r.detectionAudit;
      if (audit.gridRejected || (audit.rawCount > 0 && audit.keptCount === 0)) {
        withheldPhotos++;
      }

      attached++;
    } catch {
      failed++;
    }
  }
  opts.onProgress?.({ done: todoIndexes.length, total: todoIndexes.length });

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

function avgMarkerConfidence(markers: AnalysisResult['markers']): number {
  if (markers.length === 0) return 100;
  return markers.reduce((sum, m) => sum + m.confidence, 0) / markers.length;
}

function pickPhotos(slope: Slope, onlyNew: boolean): number[] {
  if (!onlyNew) return slope.photoPaths.map((_, i) => i);
  const analyzed = new Set(
    slope.damage
      .map((m) => m.photoIndex)
      .filter((i): i is number => typeof i === 'number'),
  );
  return slope.photoPaths.map((_, i) => i).filter((i) => !analyzed.has(i));
}

function mergeFindingsForPhoto(
  inspectionId: string,
  slopeId: string,
  result: AnalysisResult,
) {
  useInspectionStore.setState((state) => ({
    inspections: state.inspections.map((ins) => {
      if (ins.id !== inspectionId) return ins;
      return {
        ...ins,
        slopes: ins.slopes.map((sl) => {
          if (sl.id !== slopeId) return sl;
          return { ...sl, aiFindings: [...(sl.aiFindings ?? []), ...result.findings] };
        }),
      };
    }),
  }));
}
