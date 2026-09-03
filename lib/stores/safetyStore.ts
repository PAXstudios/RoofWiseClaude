import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type State = {
  /** When false, Quick Inspection skips the pre-flight safety checklist. */
  preFlightEnabled: boolean;
  /** When the last "I'm safe to climb" was confirmed, used to throttle re-shows. */
  lastConfirmedAt: string | null;

  setPreFlightEnabled: (v: boolean) => void;
  confirmSafe: () => void;
  resetConfirmation: () => void;
};

export const useSafetyStore = create<State>()(
  persist(
    (set) => ({
      preFlightEnabled: true,
      lastConfirmedAt: null,
      setPreFlightEnabled: (v) => set({ preFlightEnabled: v }),
      confirmSafe: () => set({ lastConfirmedAt: new Date().toISOString() }),
      resetConfirmation: () => set({ lastConfirmedAt: null }),
    }),
    {
      name: 'roofwise.safety.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        preFlightEnabled: s.preFlightEnabled,
        lastConfirmedAt: s.lastConfirmedAt,
      }),
    },
  ),
);
