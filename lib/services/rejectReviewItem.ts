import type { Correction } from '../models/types';
import { useInspectionStore } from '../stores/inspectionStore';
import { inspectorTrustWeight, useCorrectionsStore } from '../stores/correctionsStore';
import { useTrainingQueueStore } from '../stores/trainingQueueStore';
import { flushInspectionPersistence } from './inspectionPersistence';
import { flushReviewPersistence } from './reviewPersistence';
import { resolveReviewEvidence } from './reviewEvidence';

const active = new Map<string, Promise<void>>();

/** Evidence + audit are one inspection write; replay finishes the two projections. */
export function rejectReviewItem(itemId: string): Promise<void> {
  const pending = active.get(itemId);
  if (pending) return pending;
  const run = applyRejection(itemId).finally(() => active.delete(itemId));
  active.set(itemId, run);
  return run;
}

async function applyRejection(itemId: string): Promise<void> {
  if (!useInspectionStore.persist.hasHydrated() || !useTrainingQueueStore.persist.hasHydrated() ||
      !useCorrectionsStore.persist.hasHydrated()) throw new Error('Review is still loading. Try again shortly.');
  const item = useTrainingQueueStore.getState().items.find((i) => i.id === itemId);
  if (!item) throw new Error('This review item is no longer available.');
  const inspection = useInspectionStore.getState().getById(item.inspectionId);
  if (Object.values(inspection?.photoCorrections ?? {}).some((c) => c.delta.queueItemId === itemId)) {
    throw new Error('This photo was already corrected. Tap Correct to finish saving that decision.');
  }
  let correction = inspection?.reviewRejections?.[itemId];
  if (!correction) {
    if (item.status !== 'pending') throw new Error('This item has already been reviewed.');
    const target = resolveReviewEvidence(inspection, item);
    const audit: Correction = {
      id: `review_reject_${item.id}`,
      inspectionId: item.inspectionId,
      slopeId: target.slope.id,
      photoId: item.photoPath,
      photoUrl: item.photoPath,
      correctionType: 'swipe_reject',
      categoriesAffected: Array.from(new Set([
        ...item.originalAnalysis.markers.map((m) => m.category),
        ...item.originalAnalysis.findings.filter((f) => f.detected).map((f) => f.label),
      ])),
      originalDetection: item.originalAnalysis,
      correctedDetection: { findings: [], markers: [] },
      delta: { verdict: 'reject', queueItemId: item.id, photoPath: item.photoPath,
        photoIndexAtReview: target.photoIndex, appliedMarkers: target.liveMarkers,
        attachmentId: item.reviewEvidence?.attachmentId,
        appliedFindings: target.findings, analysisAt: item.reviewEvidence?.analysisAt },
      correctedAt: new Date().toISOString(),
      inspectorTrustWeight: inspectorTrustWeight(),
      syncStatus: 'pending',
    };
    useInspectionStore.getState().rejectReviewedPhoto(item, audit);
    correction = audit;
  } else {
    // Retry a failed checkpoint even if the in-memory evidence already changed.
    useInspectionStore.setState({ inspections: useInspectionStore.getState().inspections });
  }
  await flushInspectionPersistence();
  useCorrectionsStore.getState().recordReviewRejection(correction);
  await flushReviewPersistence('roofwise.corrections.v1');
  useTrainingQueueStore.getState().setStatus(item.id, 'reviewed');
  try {
    await flushReviewPersistence('roofwise.trainingQueue.v1');
  } catch (error) {
    // Keep the card retryable; its committed inspection audit makes replay safe.
    useTrainingQueueStore.getState().setStatus(item.id, 'pending');
    throw error;
  }
}
