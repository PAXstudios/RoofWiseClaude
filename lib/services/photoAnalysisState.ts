import type { PhotoAnalysisState, Slope } from '../models/types';

export type PhotoAnalysisSource = Pick<Slope, 'photoPaths' | 'photoAttachmentIds' | 'photoAnalysis' | 'photoAnalysisByAttachment'>;

/** Never give a duplicate attachment another attachment's metadata. */
export function readPhotoAnalysis(slope: PhotoAnalysisSource, index: number): PhotoAnalysisState | undefined {
  const uri = slope.photoPaths[index];
  if (uri === undefined) return undefined;
  const id = slope.photoAttachmentIds?.[index];
  if (slope.photoAnalysisByAttachment) return id ? slope.photoAnalysisByAttachment[id] : undefined;
  return slope.photoPaths.filter((path) => path === uri).length === 1 ? slope.photoAnalysis?.[uri] : undefined;
}

/** URI compatibility is safe only for a uniquely attached file. */
export function projectPhotoAnalysis<T extends PhotoAnalysisSource>(slope: T): T {
  const ids = new Set(slope.photoAttachmentIds ?? []);
  const canonical = Object.fromEntries(Object.entries(slope.photoAnalysisByAttachment ?? {}).filter(([id]) => ids.has(id)));
  const mirror: Record<string, PhotoAnalysisState> = {};
  slope.photoPaths.forEach((uri, index) => {
    const value = canonical[slope.photoAttachmentIds?.[index] ?? ''];
    if (value && slope.photoPaths.filter((path) => path === uri).length === 1) mirror[uri] = value;
  });
  return { ...slope, photoAnalysisByAttachment: canonical, photoAnalysis: mirror };
}

/** Lazy migration after attachment IDs have been assigned. Ambiguous legacy
 * metadata remains retained, but cannot claim either duplicate was analyzed. */
export function migratePhotoAnalysis(slope: Slope): Slope {
  if (slope.photoAnalysisByAttachment) {
    const orphaned = Object.entries(slope.photoAnalysisByAttachment).filter(([id]) => !slope.photoAttachmentIds?.includes(id));
    return projectPhotoAnalysis({ ...slope, historicalPhotoEvidence: [
      ...(slope.historicalPhotoEvidence ?? []),
      ...orphaned.map(([, analysis]) => ({ reason: 'Analysis attachment no longer exists', analysis })),
    ] });
  }
  const canonical: Record<string, PhotoAnalysisState> = {};
  const history = [...(slope.historicalPhotoEvidence ?? [])];
  for (const [uri, analysis] of Object.entries(slope.photoAnalysis ?? {})) {
    const indexes = slope.photoPaths.flatMap((path, index) => path === uri ? [index] : []);
    const id = indexes.length === 1 ? slope.photoAttachmentIds?.[indexes[0]] : undefined;
    if (id) canonical[id] = analysis;
    else history.push({ reason: 'Legacy analysis has no unique surviving attachment', photoPath: uri, analysis });
  }
  return projectPhotoAnalysis({ ...slope, photoAnalysisByAttachment: canonical, historicalPhotoEvidence: history });
}

/** Completion is an explicit state or an explicit legacy index, never the
 * absence of bookkeeping. A replacement has neither and remains unanalysed. */
export function photoWasAnalyzed(slope: PhotoAnalysisSource & Pick<Slope, 'analyzedPhotoIndices'>, index: number): boolean {
  if (!slope.photoPaths[index]) return false;
  const state = readPhotoAnalysis(slope, index);
  return state ? state.status === 'done' : slope.analyzedPhotoIndices?.includes(index) === true;
}

/** Pure update used by analysis and review, with the safe URI mirror rebuilt. */
export function patchPhotoAnalysis(slope: Slope, index: number, patch: Partial<PhotoAnalysisState>): Slope {
  const normalized = migratePhotoAnalysis(slope);
  const id = normalized.photoAttachmentIds?.[index];
  if (!id) return normalized;
  const before = normalized.photoAnalysisByAttachment?.[id];
  const next = { ...before, ...patch } as PhotoAnalysisState;
  if (patch.status === 'queued' || patch.status === 'analyzing') {
    delete next.reviewSource;
    delete next.reviewedAt;
  }
  if (patch.status && patch.status !== 'failed') {
    delete next.error;
    delete next.errorStatus;
  }
  return projectPhotoAnalysis({ ...normalized, photoAnalysisByAttachment: { ...normalized.photoAnalysisByAttachment, [id]: next } });
}
