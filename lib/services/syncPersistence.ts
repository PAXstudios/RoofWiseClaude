import AsyncStorage from '@react-native-async-storage/async-storage';

/** Keep startup mutations in memory until the stored collection has been
 * merged. Persisting an incomplete pre-hydration snapshot could erase records
 * that the initial read has not returned yet. Each store owns its own queue. */
export function createSyncPersistence(initiallyHydrating = true) {
  let hydrating = false;
  let hydrationReady: Promise<void> = Promise.resolve();
  let resolveHydration: (() => void) | undefined;
  let rejectHydration: ((error: unknown) => void) | undefined;
  const beginHydration = (bufferWrites = true) => {
    if (!bufferWrites) return;
    if (hydrating && resolveHydration) return;
    hydrating = true;
    hydrationReady = new Promise<void>((resolve, reject) => { resolveHydration = resolve; rejectHydration = reject; });
    void hydrationReady.catch(() => {});
  };
  if (initiallyHydrating) beginHydration();
  let tail: Promise<{ error?: unknown }> = Promise.resolve({});
  const enqueue = (write: () => Promise<unknown>) => {
    tail = tail.then(async () => {
      try { await write(); return {}; }
      catch (error) { return { error }; }
    });
    return tail;
  };
  const storage = {
    getItem: async (key: string) => { await tail; return AsyncStorage.getItem(key); },
    setItem: (key: string, value: string): Promise<void> => {
      if (hydrating) return Promise.resolve();
      return enqueue(() => AsyncStorage.setItem(key, value)).then(() => {});
    },
    removeItem: (key: string): Promise<void> => enqueue(() => AsyncStorage.removeItem(key)).then(() => {}),
  };
  return {
    storage,
    beginHydration,
    failHydration: (error: unknown) => {
      rejectHydration?.(error);
      resolveHydration = undefined;
      rejectHydration = undefined;
    },
    flush: async () => {
      await hydrationReady;
      const outcome = await tail;
      if (outcome.error) throw new Error('Local sync state could not be saved. Free space and retry.');
    },
    finishHydration: async (key: string, value: string) => {
      hydrating = false;
      let pending = enqueue(() => AsyncStorage.setItem(key, value));
      let outcome = await pending;
      while (!outcome.error && pending !== tail) {
        pending = tail;
        outcome = await pending;
      }
      if (outcome.error) {
        const error = new Error('Local sync state could not be saved. Free space and retry.');
        rejectHydration?.(error);
        resolveHydration = undefined;
        rejectHydration = undefined;
        throw error;
      }
      resolveHydration?.();
      resolveHydration = undefined;
      rejectHydration = undefined;
    },
  };
}
