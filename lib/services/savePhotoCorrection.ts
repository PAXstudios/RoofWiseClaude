import type { Correction, DamageMarker } from '../models/types';
import { useInspectionStore } from '../stores/inspectionStore';
import { inspectorTrustWeight, useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { flushInspectionPersistence } from './inspectionPersistence';
import { flushReviewPersistence } from './reviewPersistence';
import { resolveReviewEvidence } from './reviewEvidence';
import { correctedPhotoEvidence, evidenceKey, markerEvidenceKey, resolveCorrectionPhoto, validateCorrectionSession, type CorrectionSession } from './correctionEvidence';

const active = new Map<string, Promise<Correction>>();
function ready() {
  if (![useInspectionStore, useCorrectionsStore, useTrainingQueueStore].every((s) => s.persist.hasHydrated())) {
    throw new Error('Review is still loading. Reopen the photo shortly.');
  }
}
export const reviewCorrectionId = (itemId: string) => `review_correct_${itemId}`;

export function beginPhotoCorrection(input: { inspectionId: string; slopeId: string; photoIndex: number; attachmentId?: string; photoPath?: string; queueItemId?: string }): CorrectionSession {
  ready();
  const store = useInspectionStore.getState();
  const inspection = store.getById(input.inspectionId);
  if (inspection?.reportFinalizedAt) throw new Error('Reopen the finalized report before changing its evidence.');
  const item = input.queueItemId ? useTrainingQueueStore.getState().items.find((i) => i.id === input.queueItemId) : undefined;
  if (input.queueItemId && (!item || item.status !== 'pending' || item.inspectionId !== input.inspectionId || inspection?.reviewRejections?.[item.id])) {
    throw new Error('This review is no longer pending. Return to the review queue.');
  }
  const reviewed = item ? resolveReviewEvidence(inspection, item) : undefined;
  const slopeId = reviewed?.slope.id ?? input.slopeId;
  const originalSlope = inspection?.slopes.find((s) => s.id === slopeId);
  if (!originalSlope) throw new Error('The original photo attachment is no longer available.');
  if (!originalSlope.photoAttachmentIds || originalSlope.photoAttachmentIds.length !== originalSlope.photoPaths.length) {
    // Check legacy ownership before normalization can retire ambiguous evidence.
    const temporary = originalSlope.photoPaths.map((_, index) => `legacy_check_${index}`);
    const index = reviewed?.photoIndex ?? input.photoIndex;
    resolveCorrectionPhoto({ ...inspection!, slopes: [{ ...originalSlope, photoAttachmentIds: temporary }] },
      slopeId, temporary[index], originalSlope.photoPaths[index]);
    store.ensurePhotoAttachmentIds(input.inspectionId, slopeId);
  }
  const current = useInspectionStore.getState().getById(input.inspectionId);
  const slope = current?.slopes.find((s) => s.id === slopeId);
  const attachmentId = input.attachmentId ?? slope?.photoAttachmentIds?.[reviewed?.photoIndex ?? input.photoIndex];
  const photoIndex = slope?.photoAttachmentIds?.indexOf(attachmentId ?? '') ?? -1;
  const photoPath = slope?.photoPaths[photoIndex];
  if (!attachmentId || !photoPath || (input.photoPath && input.photoPath !== photoPath) ||
      (item?.reviewEvidence?.attachmentId && item.reviewEvidence.attachmentId !== attachmentId)) {
    throw new Error('The original photo attachment is no longer available.');
  }
  const target = resolveCorrectionPhoto(current, slopeId, attachmentId, photoPath);
  return JSON.parse(JSON.stringify({
    id: input.queueItemId ? reviewCorrectionId(input.queueItemId) : `photo_correct_${Date.now()}_${Math.random().toString(36).slice(2)}`,
    inspectionId: input.inspectionId, slopeId, photoPath, attachmentId, queueItemId: input.queueItemId,
    markers: target.markers, findings: target.findings, analysisKey: evidenceKey(target.analysis), originalAnalysis: item?.originalAnalysis,
  }));
}

/** Exact queue identity is required; another edit on the job cannot complete this card. */
export function completedReviewCorrection(itemId: string): Correction | undefined {
  const item = useTrainingQueueStore.getState().items.find((i) => i.id === itemId);
  return item?.status === 'reviewed' ? useCorrectionsStore.getState().corrections.find((c) =>
    c.id === reviewCorrectionId(itemId) && c.delta.queueItemId === itemId && c.inspectionId === item.inspectionId && c.photoUrl === item.photoPath) : undefined;
}

export function savePhotoCorrection(session: CorrectionSession, markers: DamageMarker[]): Promise<Correction> {
  const pending = active.get(session.id);
  if (pending) return pending;
  const run = save(session, markers).finally(() => active.delete(session.id));
  active.set(session.id, run);
  return run;
}

async function project(correction: Correction): Promise<Correction> {
  // Retry an unsuccessful inspection checkpoint before projecting its audit.
  useInspectionStore.setState({ inspections: useInspectionStore.getState().inspections });
  await flushInspectionPersistence();
  useCorrectionsStore.getState().recordReviewRejection(correction);
  await flushReviewPersistence('roofwise.corrections.v1');
  const itemId = correction.delta.queueItemId;
  if (typeof itemId === 'string' && useTrainingQueueStore.getState().items.some((i) => i.id === itemId)) {
    useTrainingQueueStore.getState().setStatus(itemId, 'reviewed');
    try { await flushReviewPersistence('roofwise.trainingQueue.v1'); }
    catch (error) { useTrainingQueueStore.getState().setStatus(itemId, 'pending'); throw error; }
  }
  return correction;
}

/** Restart recovery projects committed audits only; it never reapplies marker edits. */
export async function recoverPhotoCorrections(): Promise<void> {
  ready();
  // Presence in Zustand is not a storage acknowledgement. A failed general
  // edit has no pending queue card to advertise that its projection needs retry.
  let correctionsDurable = await flushReviewPersistence('roofwise.corrections.v1').then(() => true, () => false);
  for (const inspection of useInspectionStore.getState().inspections) {
    for (const correction of Object.values(inspection.photoCorrections ?? {})) {
      const saved = useCorrectionsStore.getState().corrections.some((c) => c.id === correction.id);
      const item = useTrainingQueueStore.getState().items.find((i) => i.id === correction.delta.queueItemId);
      if (!saved || !correctionsDurable || (item && item.status !== 'reviewed')) {
        await project(correction);
        correctionsDurable = true;
      }
    }
  }
}

/** Hydration may finish after the first foreground event. Replay then as well. */
export function startPhotoCorrectionRecovery(): () => void {
  const resume = () => { void recoverPhotoCorrections().catch(() => {}); };
  const stops = [useInspectionStore, useCorrectionsStore, useTrainingQueueStore]
    .map((store) => store.persist.onFinishHydration(resume));
  resume();
  return () => stops.forEach((stop) => stop());
}

async function save(session: CorrectionSession, markers: DamageMarker[]): Promise<Correction> {
  ready();
  const inspection = useInspectionStore.getState().getById(session.inspectionId);
  const saved = inspection?.photoCorrections?.[session.id];
  if (saved) return project(saved);
  if (session.queueItemId) {
    const item = useTrainingQueueStore.getState().items.find((i) => i.id === session.queueItemId);
    if (!item || item.status !== 'pending' || inspection?.reviewRejections?.[item.id]) throw new Error('This item has already been reviewed.');
    resolveReviewEvidence(inspection, item);
  }
  const target = validateCorrectionSession(inspection, session);
  if (markerEvidenceKey(markers) === markerEvidenceKey(session.markers)) throw new Error('Make a correction before saving.');
  const ids = new Set(markers.map((m) => m.id));
  if (ids.size !== markers.length || markers.some((m) => target.slope.damage.some((other) => !target.markers.includes(other) && other.id === m.id))) {
    throw new Error('Marker identity is ambiguous. Reopen the photo before editing.');
  }
  const { findings, categories } = correctedPhotoEvidence(session, markers);
  const added = markers.filter((m) => !session.markers.some((o) => o.id === m.id)).map((m) => m.id);
  const removed = session.markers.filter((m) => !ids.has(m.id)).map((m) => m.id);
  const modified = markers.filter((m) => {
    const original = session.markers.find((before) => before.id === m.id);
    return original && markerEvidenceKey([original]) !== markerEvidenceKey([m]);
  }).map((m) => m.id);
  const correction: Correction = {
    id: session.id, inspectionId: session.inspectionId, slopeId: session.slopeId,
    photoId: session.attachmentId, photoUrl: session.photoPath,
    correctionType: session.queueItemId ? 'swipe_correct' : removed.length && !added.length ? 'remove_marker' : added.length && !removed.length ? 'add_marker' : 'edit',
    categoriesAffected: categories, originalDetection: session.originalAnalysis ?? { markers: session.markers, findings: session.findings },
    correctedDetection: { markers: markers.map((m) => ({ ...m, photoIndex: target.photoIndex })), findings },
    delta: { queueItemId: session.queueItemId, attachmentId: session.attachmentId, photoIndexAtReview: target.photoIndex,
      appliedMarkers: session.markers, appliedFindings: session.findings, analysisKey: session.analysisKey,
      originalPhotoAnalysis: target.analysis, added, removed, modified },
    correctedAt: new Date().toISOString(), inspectorTrustWeight: inspectorTrustWeight(), syncStatus: 'pending',
  };
  useInspectionStore.getState().correctReviewedPhoto(session, correction);
  return project(correction);
}
