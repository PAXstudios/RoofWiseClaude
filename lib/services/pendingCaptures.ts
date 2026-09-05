import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CaptureMode, SlopeOrientation } from '../models/types';
import { discardPhotoEvidence, evidenceId, reservePhotoEvidence, completePhotoReservation, discardPhotoReservation, type PhotoRetentionRecovery, type PhotoEvidenceReservation } from './photoEvidence';

export type CaptureContext = {
  slope: SlopeOrientation;
  areaTag: string;
  captureMode: CaptureMode;
  areaTagPinned: boolean;
  slopeMode: 'auto' | 'pinned';
  compassSlope: SlopeOrientation | null;
};

export type PendingCapture = {
  uri: string;
  context: CaptureContext;
  targetId: string;
  originTargetId: string | null;
  createdHere: boolean;
  imported?: boolean;
  /** Cleanup failed before retention returned; verify before any attachment. */
  retentionRecovery?: PhotoRetentionRecovery;
  retentionReservation?: PhotoEvidenceReservation;
  evidenceOwned?: boolean;
  discardRequested?: boolean;
};

const KEY = 'roofwise.pending-captures.v1';
const listeners = new Set<() => void>();
// Exceptional, unaccepted stages whose file cannot safely be rolled back.
// Keep an explicit retry handle until storage works; never silently orphan it.
const stagingRetries = new Map<string, PendingCapture>();
let tail: Promise<unknown> = Promise.resolve();

export class CaptureStagingError extends Error {
  constructor(public photo: PendingCapture, cause: unknown) {
    super(`This photo has not been filed. It is retained for recovery. ${cause instanceof Error ? cause.message : ''}`);
    this.name = 'CaptureStagingError';
  }
}

function notifyListeners(): void {
  // Observers must not turn a committed journal write into an apparent I/O
  // failure: rollback would otherwise delete a now-referenced photo.
  for (const notify of listeners) {
    try { notify(); } catch { /* the durable transaction already succeeded */ }
  }
}

// Serialize read/modify/write across imports and overlapping route lifetimes.
function exclusive<T>(work: () => Promise<T>): Promise<T> {
  const result = tail.catch(() => {}).then(work);
  tail = result;
  return result;
}

async function read(): Promise<PendingCapture[]> {
  const raw = await AsyncStorage.getItem(KEY);
  if (!raw) return [];
  const value = JSON.parse(raw);
  // Never replace an unreadable/newer journal with an empty array.
  if (value.version !== 1 || !Array.isArray(value.entries) || value.entries.some(
    (entry: PendingCapture) => !entry || typeof entry.uri !== 'string' ||
      typeof entry.targetId !== 'string' || !entry.context || typeof entry.context.slope !== 'string',
  )) throw new Error('Interrupted photos could not be loaded. Please retry before taking more photos.');
  return value.entries;
}

export function readPendingCaptures(): Promise<PendingCapture[]> {
  return exclusive(async () => [...new Map([
    ...stagingRetries.entries(),
    ...(await read()).map((entry) => [entry.uri, entry] as const),
  ]).values()]);
}

export function writePendingCapture(photo: PendingCapture): Promise<void> {
  return exclusive(async () => {
    const entries = await read();
    if (entries.some((entry) => entry.uri === photo.uri && entry.discardRequested) && !photo.discardRequested) {
      throw new Error('This pending photo is being discarded. Finish discarding it before taking another photo.');
    }
    await AsyncStorage.setItem(KEY, JSON.stringify({ version: 1, entries: [
      ...entries.filter((entry) => entry.uri !== photo.uri), photo,
    ] }));
    stagingRetries.delete(photo.uri);
    notifyListeners();
  });
}

export function removePendingCapture(uri: string): Promise<void> {
  return exclusive(async () => {
    const entries = await read();
    await AsyncStorage.setItem(KEY, JSON.stringify({ version: 1, entries: entries.filter((entry) => entry.uri !== uri) }));
    stagingRetries.delete(uri);
    notifyListeners();
  });
}

export function subscribePendingCaptures(notify: () => void): () => void {
  listeners.add(notify);
  return () => { listeners.delete(notify); };
}

type CaptureDestination = Pick<PendingCapture, 'targetId' | 'originTargetId' | 'createdHere'>;

export async function resumePendingCapture(photo: PendingCapture): Promise<PendingCapture> {
  if (photo.discardRequested) throw new Error('This pending photo is being discarded.');
  if (!photo.retentionReservation) return photo;
  await completePhotoReservation(photo.retentionReservation);
  const ready = { ...photo, retentionReservation: undefined };
  await writePendingCapture(ready);
  return ready;
}

/** Discard intent is durable before deletion, so restart can finish cleanup. */
export async function discardPendingCapture(photo: PendingCapture): Promise<void> {
  await writePendingCapture({ ...photo, discardRequested: true });
  if (photo.retentionReservation) await discardPhotoReservation(photo.retentionReservation);
  else if (photo.evidenceOwned !== false) await discardPhotoEvidence(photo.uri);
  await removePendingCapture(photo.uri);
}

export async function stageCapture(uri: string, context: CaptureContext, targetId: string | null, imported = false, reservation?: CaptureDestination): Promise<PendingCapture> {
  const retentionReservation = reservePhotoEvidence(uri);
  const photo: PendingCapture = {
    uri: retentionReservation.uri, context, imported, retentionReservation,
    evidenceOwned: retentionReservation.ownsCopy,
    targetId: reservation?.targetId ?? targetId ?? `ins_capture_${evidenceId()}`,
    originTargetId: reservation ? reservation.originTargetId : targetId,
    createdHere: reservation ? reservation.createdHere : targetId === null,
  };
  try {
    // This is the first side effect: no owned file can predate its journal.
    await writePendingCapture(photo);
  } catch (error) {
    let committed = false;
    try {
      committed = (await exclusive(read)).some((entry) => entry.uri === photo.uri &&
        entry.retentionReservation?.sourceUri === uri);
    } catch { /* No proven reservation: do not create a file. */ }
    if (!committed) {
      // Reused input remains explicitly recoverable without deleting it.
      if (!retentionReservation.ownsCopy) {
        stagingRetries.set(photo.uri, photo);
        notifyListeners();
        throw new CaptureStagingError(photo, error);
      }
      throw new Error('Could not reserve photo storage. No new copy was created; the original is unchanged. Please retry.');
    }
  }
  try {
    return await resumePendingCapture(photo);
  } catch (error) {
    // The reservation already owns the final AND partial paths on disk.
    // Persisted recovery never depends on receiving this in-memory error.
    stagingRetries.set(photo.uri, photo);
    notifyListeners();
    throw new CaptureStagingError(photo, error);
  }
}
