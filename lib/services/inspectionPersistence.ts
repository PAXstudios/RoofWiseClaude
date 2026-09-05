import { createSyncPersistence } from './syncPersistence';

// The business store enables the hydration barrier before its first mutation.
// Standalone storage callers retain the ordinary ordered-checkpoint contract.
const persistence = createSyncPersistence(false);
export const inspectionStorage = {
  ...persistence.storage,
  beginHydration: persistence.beginHydration,
  finishHydration: persistence.finishHydration,
  failHydration: persistence.failHydration,
};

export async function flushInspectionPersistence(): Promise<void> {
  try { await persistence.flush(); }
  catch { throw new Error('The inspection could not be saved to device storage. Free space and retry.'); }
}
