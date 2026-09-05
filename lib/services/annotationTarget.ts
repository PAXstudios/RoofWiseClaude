import type { Inspection } from '../models/types';

export type AnnotationTargetInput = { uri?: string; slopeId?: string; attachmentId?: string; index?: number };

/** Resolve the image and its marker overlay as one attachment. A supplied
 * URI never borrows markers from a stale route index. */
export function resolveAnnotationTarget(inspection: Inspection | undefined, input: AnnotationTargetInput) {
  if (!inspection) return undefined;
  const matches = inspection.slopes.flatMap((slope) => {
    if (input.slopeId && slope.id !== input.slopeId) return [];
    return slope.photoPaths.flatMap((uri, index) => {
      const attachmentId = slope.photoAttachmentIds?.[index];
      const selected = input.attachmentId ? attachmentId === input.attachmentId && (!input.uri || uri === input.uri)
        : input.uri ? uri === input.uri : input.slopeId && index === input.index;
      return selected ? [{ uri, slopeId: slope.id, index, attachmentId,
        markers: slope.damage.filter((marker) => marker.photoIndex === index) }] : [];
    });
  });
  return matches.length === 1 ? matches[0] : undefined;
}
