// Best-effort upload of pending Corrections to Supabase `public.corrections`
// (row contract: supabase/schema.sql §1). Called from the lifecycle hook on
// app foreground + on a 5-minute timer, from Home pull-to-refresh, and from
// the Settings "Sync now" row.
//
// A correction is the training signal the learning loop runs on, so a
// record must never be lost to a flaky network — and the app must never
// hammer a dead backend forever either. A failed batch stays `pending`
// behind an exponential backoff (5 min → 6 h) and is only marked `failed`
// after MAX_SYNC_ATTEMPTS (see correctionsStore). Waiting on sign-in or on
// a project that is not configured costs a record nothing: those are not
// its fault, so no attempt is counted.
//
// History: this used to POST to EXPO_PUBLIC_CORRECTIONS_ENDPOINT — a Vercel
// placeholder that never existed — while the table it should have written
// sat empty, and one refusal was terminal. The endpoint and its env var are
// gone; there is exactly one write path now.

import { supabase, isSupabaseConfigured } from '../supabase';
import { useAuthStore } from '../auth/authStore';
import { useCorrectionsStore } from '../stores/correctionsStore';
import type { Correction } from '../models/types';

const TABLE = 'corrections';
const BATCH_SIZE = 50;

export type SyncResult = {
  attempted: number;
  accepted: number;
  /** Always 0 since the move to upsert — kept so existing callers compile. */
  duplicates: number;
  /** Refused this run. They stay pending (backoff) until the attempt cap. */
  failed: number;
  /** Why nothing could be sent — not signed in, not configured, refused. */
  error?: string;
};

export type SyncCorrectionsOptions = {
  /**
   * A manual "Sync now": ignore every backoff window and re-arm records
   * that already hit the attempt cap.
   */
  force?: boolean;
};

let running = false;

const NOTHING: SyncResult = { attempted: 0, accepted: 0, duplicates: 0, failed: 0 };

export async function syncCorrections(opts: SyncCorrectionsOptions = {}): Promise<SyncResult> {
  if (running) return NOTHING;
  const store = useCorrectionsStore.getState();
  if (opts.force) store.requeueFailed();
  // A crash mid-upload leaves records stuck in `syncing`; nothing else is
  // uploading while this guard holds, so they are simply pending again.
  store.requeueStale();

  const pending = store.pending({ ignoreBackoff: opts.force }).slice(0, BATCH_SIZE);
  if (pending.length === 0) return NOTHING;

  if (!isSupabaseConfigured) {
    return { ...NOTHING, attempted: pending.length, error: 'Cloud sync not configured' };
  }
  const user = useAuthStore.getState().user;
  if (!user) {
    return { ...NOTHING, attempted: pending.length, error: 'Not signed in' };
  }

  const ids = pending.map((c) => c.id);
  running = true;
  store.markSyncing(ids);
  try {
    const { error } = await supabase
      .from(TABLE)
      .upsert(pending.map((c) => toRow(c, user.id)), { onConflict: 'id' });

    if (error) {
      const reason = isMissingTable(error.message)
        ? 'Cloud sync not provisioned — run supabase/schema.sql in the project.'
        : error.message;
      useCorrectionsStore.getState().markFailed(ids, reason);
      return {
        attempted: pending.length,
        accepted: 0,
        duplicates: 0,
        failed: pending.length,
        error: reason,
      };
    }

    useCorrectionsStore.getState().markSynced(ids);
    return { attempted: pending.length, accepted: pending.length, duplicates: 0, failed: 0 };
  } catch (e) {
    const reason = e instanceof Error ? e.message : 'Network request failed';
    useCorrectionsStore.getState().markFailed(ids, reason);
    return {
      attempted: pending.length,
      accepted: 0,
      duplicates: 0,
      failed: pending.length,
      error: reason,
    };
  } finally {
    running = false;
  }
}

/** Exactly the columns `public.corrections` declares; `created_at` defaults server-side. */
function toRow(c: Correction, userId: string) {
  return {
    id: c.id,
    user_id: userId,
    inspection_id: c.inspectionId,
    photo_id: c.photoId,
    slope_id: c.slopeId ?? null,
    correction_type: c.correctionType,
    categories_affected: c.categoriesAffected,
    original_detection: c.originalDetection,
    corrected_detection: c.correctedDetection,
    delta: c.delta,
    photo_url: c.photoUrl ?? null,
    photo_hash: c.photoHash ?? null,
    corrected_at: c.correctedAt,
    confidence_stars: c.confidenceStars ?? null,
    inspector_trust_weight: c.inspectorTrustWeight ?? 1,
  };
}

function isMissingTable(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes('does not exist') || m.includes('schema cache') || m.includes('relation');
}
