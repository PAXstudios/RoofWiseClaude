import AsyncStorage from '@react-native-async-storage/async-storage';

let tail: Promise<void> = Promise.resolve();
const failedKeys = new Set<string>();

/** Queue/correction writes must finish before review reports success. */
export const reviewStorage = {
  getItem: (key: string) => AsyncStorage.getItem(key),
  removeItem: (key: string) => AsyncStorage.removeItem(key),
  setItem(key: string, value: string): Promise<void> {
    tail = tail.then(async () => {
      try {
        await AsyncStorage.setItem(key, value);
        failedKeys.delete(key);
      } catch {
        failedKeys.add(key);
      }
    });
    return tail;
  },
};

export async function flushReviewPersistence(key?: string): Promise<void> {
  await tail;
  if (key ? failedKeys.has(key) : failedKeys.size) {
    throw new Error('Review could not be saved to this device. Free space and retry.');
  }
}
