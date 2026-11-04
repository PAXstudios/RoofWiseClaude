import { useSyncExternalStore } from 'react';
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type State = {
  completed: boolean;
  complete: () => void;
  reset: () => void;
};

export const useOnboardingStore = create<State>()(
  persist(
    (set) => ({
      completed: false,
      complete: () => set({ completed: true }),
      reset: () => set({ completed: false }),
    }),
    {
      name: 'roofwise.onboarding.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ completed: s.completed }),
    },
  ),
);

// Entry routes share the same hydration signal, including direct Home links.
const subscribeHydration = (notify: () => void) => useOnboardingStore.persist.onFinishHydration(notify);
const serverHydrated = () => false;
export function useOnboardingHydrated() {
  return useSyncExternalStore(subscribeHydration, useOnboardingStore.persist.hasHydrated, serverHydrated);
}
