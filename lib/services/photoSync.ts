// Uploads inspection photos to Supabase Storage so the cross-device
// inspection payload has working image URLs (the jsonb sync only carries
// device-local URIs otherwise).
//
// Photos are downscaled to 1600px / 0.7 JPEG before upload. Uploads are
// capped per run so a foreground drain never hogs the session. The
// resulting public URL is written back into Slope.photoUploads — which
// marks the inspection dirty, so the next inspection sync carries the
// remote URLs to other devices.

import * as ImageManipulator from 'expo-image-manipulator';
import { supabase } from '../supabase';
import { useInspectionStore } from '../stores/inspectionStore';
import { useAuthStore } from '../auth/authStore';

const BUCKET = 'inspection-photos';
const MAX_UPLOADS_PER_RUN = 8;

export type PhotoSyncSummary = {
  uploaded: number;
  remaining: number;
  error?: string;
};

let running = false;

export function countPendingPhotoUploads(): number {
  return useInspectionStore.getState().inspections.reduce(
    (sum, ins) =>
      sum +
      ins.slopes.reduce(
        (s2, sl) =>
          s2 + sl.photoPaths.filter((p) => !(sl.photoUploads?.[p])).length,
        0,
      ),
    0,
  );
}

export async function syncInspectionPhotos(): Promise<PhotoSyncSummary> {
  if (running) return { uploaded: 0, remaining: countPendingPhotoUploads() };
  const user = useAuthStore.getState().user;
  if (!user) return { uploaded: 0, remaining: 0, error: 'Not signed in' };

  running = true;
  let uploaded = 0;
  try {
    const inspections = useInspectionStore.getState().inspections;
    outer: for (const ins of inspections) {
      for (const slope of ins.slopes) {
        for (let i = 0; i < slope.photoPaths.length; i++) {
          if (uploaded >= MAX_UPLOADS_PER_RUN) break outer;
          const localUri = slope.photoPaths[i];
          if (slope.photoUploads?.[localUri]) continue;

          let base64: string;
          try {
            const out = await ImageManipulator.manipulateAsync(
              localUri,
              [{ resize: { width: 1600 } }],
              {
                compress: 0.7,
                format: ImageManipulator.SaveFormat.JPEG,
                base64: true,
              },
            );
            if (!out.base64) continue;
            base64 = out.base64;
          } catch {
            continue; // file missing on disk — skip permanently this run
          }

          const path = `${user.id}/${ins.id}/${slope.id}/${i}_${Date.now()}.jpg`;
          const { error } = await supabase.storage
            .from(BUCKET)
            .upload(path, base64ToBytes(base64), {
              contentType: 'image/jpeg',
              upsert: false,
            });
          if (error) {
            const msg = error.message.toLowerCase();
            if (msg.includes('bucket') || msg.includes('not found')) {
              return {
                uploaded,
                remaining: countPendingPhotoUploads(),
                error: 'Storage bucket missing — run the SQL snippet in About.',
              };
            }
            return { uploaded, remaining: countPendingPhotoUploads(), error: error.message };
          }

          const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
          if (data?.publicUrl) {
            useInspectionStore
              .getState()
              .setPhotoUpload(ins.id, slope.id, localUri, data.publicUrl);
            uploaded++;
          }
        }
      }
    }
    return { uploaded, remaining: countPendingPhotoUploads() };
  } finally {
    running = false;
  }
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
