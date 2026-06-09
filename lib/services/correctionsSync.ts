// Best-effort POST of pending Corrections to the corrections backend.
// Called from the corrections sync hook on app foreground + on a 5-minute
// timer + on connectivity restore.

import { env } from '../env';
import { useCorrectionsStore } from '../stores/correctionsStore';
import type { Correction } from '../models/types';

const BATCH_SIZE = 50;

export type SyncResult = {
  attempted: number;
  accepted: number;
  duplicates: number;
  failed: number;
};

export async function syncCorrections(): Promise<SyncResult> {
  const state = useCorrectionsStore.getState();
  const pending = state.pending().slice(0, BATCH_SIZE);

  if (pending.length === 0) {
    return { attempted: 0, accepted: 0, duplicates: 0, failed: 0 };
  }
  if (!env.CORRECTIONS_ENDPOINT) {
    return { attempted: pending.length, accepted: 0, duplicates: 0, failed: pending.length };
  }

  const ids = pending.map((c) => c.id);
  state.markSyncing(ids);

  try {
    const res = await fetch(env.CORRECTIONS_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        corrections: pending.map(serialize),
      }),
    });

    if (!res.ok) {
      state.markFailed(ids);
      return { attempted: pending.length, accepted: 0, duplicates: 0, failed: pending.length };
    }

    const data = await res.json().catch(() => ({}));
    const acceptedIds: string[] = Array.isArray(data?.acceptedIds) ? data.acceptedIds : ids;
    const duplicateIds: string[] = Array.isArray(data?.duplicateIds) ? data.duplicateIds : [];

    state.markSynced([...acceptedIds, ...duplicateIds]);

    return {
      attempted: pending.length,
      accepted: acceptedIds.length,
      duplicates: duplicateIds.length,
      failed: pending.length - acceptedIds.length - duplicateIds.length,
    };
  } catch {
    state.markFailed(ids);
    return { attempted: pending.length, accepted: 0, duplicates: 0, failed: pending.length };
  }
}

function serialize(c: Correction) {
  return {
    id: c.id,
    inspection_id: c.inspectionId,
    photo_id: c.photoId,
    slope_id: c.slopeId,
    correction_type: c.correctionType,
    categories_affected: c.categoriesAffected,
    original_detection: c.originalDetection,
    corrected_detection: c.correctedDetection,
    delta: c.delta,
    photo_url: c.photoUrl,
    photo_hash: c.photoHash,
    corrected_at: c.correctedAt,
  };
}
