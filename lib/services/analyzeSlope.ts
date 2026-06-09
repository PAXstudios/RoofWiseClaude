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
import { computeProfile } from './learning/userCorrectionProfile';
import { userStylePromptPrefix } from './learning/localLearningEngine';
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
    return { results: [], attached: 0, failed: 0 };
  }

  const profile = computeProfile(useCorrectionsStore.getState().corrections);
  const prefix = userStylePromptPrefix(profile);
  const results: AnalysisResult[] = [];
  let attached = 0;
  let failed = 0;

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
      attached++;
    } catch {
      failed++;
    }
  }
  opts.onProgress?.({ done: todoIndexes.length, total: todoIndexes.length });
  return { results, attached, failed };
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
