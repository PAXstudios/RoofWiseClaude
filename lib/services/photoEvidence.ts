// Accepted evidence must outlive the OS camera/manipulator cache. Keep the
// original URI until the copy has been verified; never move/delete the source.
import * as FileSystem from 'expo-file-system/legacy';

export type PhotoRetentionRecovery = {
  uri: string;
  sourceUri: string;
  ownsCopy: true;
  /** False means the native copy itself rejected; partial bytes are not evidence. */
  copyCompleted: boolean;
};

/** A newly owned target could not be cleaned up. Its caller must retain this
 * handle, even when verification failed before the normal return boundary. */
export class PhotoRetentionError extends Error {
  constructor(public recovery: PhotoRetentionRecovery, error: unknown, cleanupError: unknown) {
    super(`The photo copy could not be verified or removed. ${error instanceof Error ? error.message : ''} Cleanup: ${cleanupError instanceof Error ? cleanupError.message : 'unavailable'}`);
    this.name = 'PhotoRetentionError';
  }
}

let serial = 0;
export function evidenceId(): string {
  return `${Date.now()}_${serial++}_${Math.random().toString(36).slice(2)}`;
}

export type PhotoEvidenceReservation = {
  uri: string;
  sourceUri: string;
  temporaryUri?: string;
  ownsCopy: boolean;
};

/** Allocate identity only. The caller must journal it before any file I/O. */
export function reservePhotoEvidence(sourceUri: string): PhotoEvidenceReservation {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('Photo storage is unavailable. Your photo has not been saved.');
  const directory = `${root}photo-evidence/`;
  if (sourceUri.startsWith(directory)) return { uri: sourceUri, sourceUri, ownsCopy: false };
  const extension = sourceUri.split(/[?#]/)[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] ?? 'jpg';
  const uri = `${directory}${evidenceId()}.${extension}`;
  return { uri, sourceUri, temporaryUri: `${uri}.partial`, ownsCopy: true };
}

function checkReservation(reservation: PhotoEvidenceReservation): void {
  const directory = `${FileSystem.documentDirectory ?? ''}photo-evidence/`;
  const name = reservation.uri.slice(directory.length);
  if (!FileSystem.documentDirectory || !reservation.uri.startsWith(directory) || !name || name.includes('/') || name.includes('..') ||
      (reservation.ownsCopy && (reservation.temporaryUri !== `${reservation.uri}.partial` || reservation.sourceUri.startsWith(directory)))) {
    throw new Error('The photo storage reservation is invalid.');
  }
}

const retentionOperations = new Map<string, Promise<string>>();

/** Final-path existence is the completion marker: only a verified temporary
 * copy is renamed there. A restart never trusts nonempty partial-file bytes. */
export function completePhotoReservation(reservation: PhotoEvidenceReservation): Promise<string> {
  const existing = retentionOperations.get(reservation.uri);
  if (existing) return existing;
  const work = (async () => {
    checkReservation(reservation);
    if (!reservation.ownsCopy) return retainPhotoEvidence(reservation.uri);
    const final = await FileSystem.getInfoAsync(reservation.uri);
    if (final.exists) {
      if (final.isDirectory || final.size <= 0) throw new Error('The retained photo cannot be verified.');
      return reservation.uri;
    }
    // Preserve any incomplete bytes if their original no longer exists. They
    // cannot be filed, but remain owned by the journal until explicit discard.
    if (reservation.sourceUri.startsWith('file://')) {
      const source = await FileSystem.getInfoAsync(reservation.sourceUri);
      if (!source.exists) throw new Error('The interrupted copy has no available original. Discard this pending capture and capture or import it again.');
    }
    const temporaryUri = reservation.temporaryUri!;
    await FileSystem.makeDirectoryAsync(`${FileSystem.documentDirectory}photo-evidence/`, { intermediates: true });
    await FileSystem.deleteAsync(temporaryUri, { idempotent: true });
    await FileSystem.copyAsync({ from: reservation.sourceUri, to: temporaryUri });
    const copy = await FileSystem.getInfoAsync(temporaryUri);
    if (!copy.exists || copy.isDirectory || copy.size <= 0) throw new Error('The interrupted photo copy could not be verified.');
    await FileSystem.moveAsync({ from: temporaryUri, to: reservation.uri });
    return reservation.uri;
  })().finally(() => { retentionOperations.delete(reservation.uri); });
  retentionOperations.set(reservation.uri, work);
  return work;
}

/** Called only for an explicit discard. A reused input is never our file. */
export async function discardPhotoReservation(reservation: PhotoEvidenceReservation): Promise<void> {
  checkReservation(reservation);
  if (!reservation.ownsCopy) return;
  await retentionOperations.get(reservation.uri)?.catch(() => {});
  await FileSystem.deleteAsync(reservation.temporaryUri!, { idempotent: true });
  await FileSystem.deleteAsync(reservation.uri, { idempotent: true });
}

export async function retainPhotoEvidence(uri: string): Promise<string> {
  const root = FileSystem.documentDirectory;
  if (!root) throw new Error('Photo storage is unavailable. Your photo has not been saved.');
  const directory = `${root}photo-evidence/`;
  if (uri.startsWith(directory)) {
    const existing = await FileSystem.getInfoAsync(uri);
    if (existing.exists && !existing.isDirectory && existing.size > 0) return uri;
    throw new Error('The saved photo cannot be read.');
  }
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  // Preserve the fallback original's format (which may be HEIC).
  const extension = uri.split(/[?#]/)[0].match(/\.([a-zA-Z0-9]{2,5})$/)?.[1] ?? 'jpg';
  const destination = `${directory}${evidenceId()}.${extension}`;
  let copyCompleted = false;
  try {
    await FileSystem.copyAsync({ from: uri, to: destination });
    copyCompleted = true;
    const copy = await FileSystem.getInfoAsync(destination);
    if (!copy.exists || copy.isDirectory || copy.size <= 0) throw new Error('Photo copy is empty.');
    return destination;
  } catch (error) {
    try {
      await FileSystem.deleteAsync(destination, { idempotent: true });
    } catch (cleanupError) {
      throw new PhotoRetentionError({ uri: destination, sourceUri: uri, ownsCopy: true, copyCompleted }, error, cleanupError);
    }
    throw new Error(`Could not save photo evidence. Free device storage and retry. ${error instanceof Error ? error.message : ''}`);
  }
}

/** Only a caller that knows this photo is unattached may discard it. */
export async function discardPhotoEvidence(uri: string): Promise<void> {
  const root = FileSystem.documentDirectory;
  if (root && uri.startsWith(`${root}photo-evidence/`)) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}
