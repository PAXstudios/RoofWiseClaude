// Uploads inspection photos to Supabase Storage so the cross-device
// inspection payload has working image URLs (the jsonb sync only carries
// device-local URIs otherwise).
//
// Photos are downscaled to 1600px / 0.7 JPEG before upload. A run drains
// the whole queue under a wall-clock budget (TIME_BUDGET_MS) rather than a
// fixed count — the old cap of 8 per foreground meant a 40-photo job took
// five app-opens to reach a second device, which showed broken file:// URIs
// until then. The resulting public URL is written back into
// Slope.photoUploads — which marks the inspection dirty, so the next
// inspection sync carries the remote URLs to other devices.
//
// A photo whose original is gone from this device is marked `failed` on
// `Slope.photoSync` with the reason, once, instead of being re-tried on
// every run; an upload the bucket keeps refusing is retired the same way
// after MAX_ATTEMPTS. A network drop never counts against a photo — the run
// just stops and the next one picks up where it left off.

import * as FileSystem from 'expo-file-system/legacy';
import * as ImageManipulator from 'expo-image-manipulator';
import { supabase, isSupabaseConfigured } from '../supabase';
import { useInspectionStore } from '../stores/inspectionStore';
import { useAuthStore } from '../auth/authStore';
import { syncInspections } from './inspectionSync';
import type { Inspection, Slope } from '../models/types';

const BUCKET = 'inspection-photos';
/** Wall-clock budget for one drain. ~45 s keeps a foreground run polite. */
const TIME_BUDGET_MS = 45_000;
/** Refusals (not network drops) before a photo is retired as failed. */
const MAX_ATTEMPTS = 6;
const MISSING_ORIGINAL =
  'Original photo is no longer on this device (deleted, or app storage was cleared).';

export type PhotoSyncSummary = {
  uploaded: number;
  /** Still waiting — excludes photos retired as failed. */
  remaining: number;
  /** Retired as failed on this device (missing original, or refused MAX_ATTEMPTS times). */
  failed: number;
  /** The run hit its time budget with work left; the next run continues. */
  outOfTime?: boolean;
  error?: string;
};

type QueueItem = { inspection: Inspection; slope: Slope; index: number; uri: string };

type Outcome =
  | { kind: 'uploaded' }
  /** Marked `failed` — will not be tried again. */
  | { kind: 'retired' }
  /** Refused this time; stays pending, the run moves on to the next photo. */
  | { kind: 'deferred' }
  /** The run cannot continue (no bucket, no network). Nothing is charged to the photo. */
  | { kind: 'stop'; error: string };

let running = false;

function isUploadable(slope: Slope, uri: string): boolean {
  if (slope.photoUploads?.[uri]) return false;
  return slope.photoSync?.[uri]?.status !== 'failed';
}

function pendingQueue(): QueueItem[] {
  const out: QueueItem[] = [];
  for (const inspection of useInspectionStore.getState().inspections) {
    for (const slope of inspection.slopes) {
      slope.photoPaths.forEach((uri, index) => {
        if (isUploadable(slope, uri)) out.push({ inspection, slope, index, uri });
      });
    }
  }
  return out;
}

export function countPendingPhotoUploads(): number {
  return pendingQueue().length;
}

/** Photos this device has given up on — the number Settings should surface. */
export function countFailedPhotoUploads(): number {
  return useInspectionStore.getState().inspections.reduce(
    (sum, ins) =>
      sum +
      ins.slopes.reduce(
        (s2, sl) =>
          s2 + sl.photoPaths.filter((p) => sl.photoSync?.[p]?.status === 'failed').length,
        0,
      ),
    0,
  );
}

export async function syncInspectionPhotos(
  opts: { budgetMs?: number } = {},
): Promise<PhotoSyncSummary> {
  if (running) return summarize(0, 0);
  const user = useAuthStore.getState().user;
  if (!user) return { uploaded: 0, remaining: 0, failed: 0, error: 'Not signed in' };

  const budgetMs = opts.budgetMs ?? TIME_BUDGET_MS;
  const startedAt = Date.now();
  running = true;
  let uploaded = 0;
  let retired = 0;
  try {
    // Snapshot the queue: every store write below replaces the inspection
    // objects, and walking a live reference would revisit or skip entries.
    for (const item of pendingQueue()) {
      if (Date.now() - startedAt > budgetMs) {
        return summarize(uploaded, retired, { outOfTime: true });
      }
      // The photo may have been deleted while this run was in flight.
      if (!stillQueued(item)) continue;

      const outcome = await uploadOne(user.id, item);
      if (outcome.kind === 'uploaded') uploaded++;
      else if (outcome.kind === 'retired') retired++;
      else if (outcome.kind === 'stop') {
        return summarize(uploaded, retired, { error: outcome.error });
      }
    }
    return summarize(uploaded, retired);
  } finally {
    running = false;
  }
}

/**
 * Lifecycle entry point — safe to call on every foreground: it is a no-op
 * unless there is a signed-in user, a configured project and something to
 * upload. Independent of the inspection sync (which used to gate it), and
 * it pushes the inspection payloads itself once URLs exist so a second
 * device gets them this session, not next time.
 */
export async function runPhotoSync(): Promise<PhotoSyncSummary | null> {
  if (!isSupabaseConfigured || !useAuthStore.getState().session) return null;
  if (running || countPendingPhotoUploads() === 0) return null;
  const summary = await syncInspectionPhotos();
  if (summary.uploaded > 0) await syncInspections().catch(() => {});
  return summary;
}

function summarize(
  uploaded: number,
  failed: number,
  extra: Pick<PhotoSyncSummary, 'outOfTime' | 'error'> = {},
): PhotoSyncSummary {
  return { uploaded, remaining: countPendingPhotoUploads(), failed, ...extra };
}

function stillQueued(item: QueueItem): boolean {
  const ins = useInspectionStore.getState().inspections.find((i) => i.id === item.inspection.id);
  const slope = ins?.slopes.find((s) => s.id === item.slope.id);
  return !!slope && slope.photoPaths.includes(item.uri) && isUploadable(slope, item.uri);
}

async function uploadOne(userId: string, item: QueueItem): Promise<Outcome> {
  const { inspection, slope, index, uri } = item;
  const attempts = slope.photoSync?.[uri]?.attempts ?? 0;

  // 1) Is the original still here? file:// answers definitively. Other
  //    schemes (content://, ph://) reject getInfoAsync but still read, so a
  //    throw here is not evidence of anything and falls through.
  let missing = false;
  try {
    const info = await FileSystem.getInfoAsync(uri);
    missing = !info.exists;
  } catch {
    // see above
  }
  if (missing) {
    useInspectionStore.getState().setPhotoSyncState(inspection.id, slope.id, uri, {
      status: 'failed',
      attempts,
      reason: MISSING_ORIGINAL,
      at: new Date().toISOString(),
    });
    return { kind: 'retired' };
  }

  // 2) Downscale.
  let base64: string | undefined;
  try {
    const out = await ImageManipulator.manipulateAsync(uri, [{ resize: { width: 1600 } }], {
      compress: 0.7,
      format: ImageManipulator.SaveFormat.JPEG,
      base64: true,
    });
    base64 = out.base64 ?? undefined;
  } catch (e) {
    return refuse(item, attempts, `Could not read the photo: ${messageOf(e)}`);
  }
  if (!base64) return refuse(item, attempts, 'Could not encode the photo for upload.');

  // 3) Upload.
  const path = `${userId}/${inspection.id}/${slope.id}/${index}_${Date.now()}.jpg`;
  let error: { message: string } | null = null;
  try {
    const res = await supabase.storage
      .from(BUCKET)
      .upload(path, base64ToBytes(base64), { contentType: 'image/jpeg', upsert: false });
    error = res.error;
  } catch (e) {
    error = { message: messageOf(e) };
  }
  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes('bucket') || msg.includes('not found')) {
      return { kind: 'stop', error: 'Storage bucket missing — run the SQL snippet in About.' };
    }
    if (isNetworkError(msg)) return { kind: 'stop', error: error.message };
    return refuse(item, attempts, error.message);
  }

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  if (!data?.publicUrl) return refuse(item, attempts, 'Storage returned no public URL.');
  useInspectionStore.getState().setPhotoUpload(inspection.id, slope.id, uri, data.publicUrl);
  return { kind: 'uploaded' };
}

/** One refusal charged to the photo; retired once it reaches MAX_ATTEMPTS. */
function refuse(item: QueueItem, priorAttempts: number, reason: string): Outcome {
  const attempts = priorAttempts + 1;
  const terminal = attempts >= MAX_ATTEMPTS;
  useInspectionStore.getState().setPhotoSyncState(item.inspection.id, item.slope.id, item.uri, {
    status: terminal ? 'failed' : 'pending',
    attempts,
    reason: terminal ? `Gave up after ${attempts} attempts — ${reason}` : reason,
    at: new Date().toISOString(),
  });
  return { kind: terminal ? 'retired' : 'deferred' };
}

function isNetworkError(lowerMessage: string): boolean {
  return (
    lowerMessage.includes('network') ||
    lowerMessage.includes('fetch') ||
    lowerMessage.includes('timeout') ||
    lowerMessage.includes('timed out') ||
    lowerMessage.includes('socket') ||
    lowerMessage.includes('econn')
  );
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// Minimal base64 → bytes decoder (no atob dependency).
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => {
  const t = new Uint8Array(128);
  for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = clean.length;
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  const byteLen = Math.floor((len * 3) / 4) - padding;
  const bytes = new Uint8Array(byteLen);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = B64_LOOKUP[clean.charCodeAt(i)];
    const b = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const d = B64_LOOKUP[clean.charCodeAt(i + 3)];
    if (p < byteLen) bytes[p++] = (a << 2) | (b >> 4);
    if (p < byteLen) bytes[p++] = ((b & 15) << 4) | (c >> 2);
    if (p < byteLen) bytes[p++] = ((c & 3) << 6) | d;
  }
  return bytes;
}

export const PHOTOS_SQL = `-- RoofWise photo storage — paste into Supabase SQL editor
insert into storage.buckets (id, name, public)
  values ('inspection-photos', 'inspection-photos', true)
  on conflict (id) do nothing;

create policy "photos_insert_own" on storage.objects for insert
  with check (
    bucket_id = 'inspection-photos'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

create policy "photos_read_public" on storage.objects for select
  using (bucket_id = 'inspection-photos');
`;
