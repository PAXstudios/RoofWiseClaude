import AsyncStorage from '@react-native-async-storage/async-storage';

type Outcome = { error?: unknown };
let tail: Promise<Outcome> = Promise.resolve({});

/** Each checkpoint observes its own write, even if a later write succeeds.
 * Middleware writes remain handled promises; callers explicitly await flush. */
export const annotationStorage = {
  getItem: async (key: string) => { await tail; return AsyncStorage.getItem(key); },
  setItem: (key: string, value: string): Promise<void> => {
    tail = tail.then(async () => {
      try { await AsyncStorage.setItem(key, value); return {}; }
      catch (error) { return { error }; }
    });
    return tail.then(() => {});
  },
  removeItem: (key: string): Promise<void> => {
    tail = tail.then(async () => {
      try { await AsyncStorage.removeItem(key); return {}; }
      catch (error) { return { error }; }
    });
    return tail.then(() => {});
  },
};

export async function flushAnnotationPersistence(): Promise<void> {
  const outcome = await tail;
  if (outcome.error) throw new Error('The drawing could not be saved to device storage. Free space and retry.');
}
