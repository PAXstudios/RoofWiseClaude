import type { Inspection } from '../models/types';

/** Report routes carry the selected attachment, never an index to reinterpret. */
export function resolvePhotoReportTarget(inspection: Inspection | undefined, slopeId: string, attachmentId?: string, photoPath?: string) {
  if (!inspection || !attachmentId || !photoPath) return undefined;
  const slope = inspection.slopes.find((candidate) => candidate.id === slopeId);
  const indexes = slope?.photoAttachmentIds?.flatMap((id, index) => id === attachmentId ? [index] : []) ?? [];
  if (!slope || indexes.length !== 1 || slope.photoPaths[indexes[0]] !== photoPath) return undefined;
  return { slope, index: indexes[0], uri: photoPath, attachmentId };
}
