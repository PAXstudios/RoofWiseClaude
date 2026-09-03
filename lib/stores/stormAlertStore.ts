import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { StormAlert, StormKind } from '../models/types';

let counter = 0;

function newId(): string {
  return `alert_${Date.now()}_${counter++}`;
}

type StormAlertStoreState = {
  alerts: StormAlert[];

  inject: (
    input: Omit<StormAlert, 'id' | 'firedAt' | 'status'>,
  ) => StormAlert;
  dismiss: (id: string) => void;
  markActedOn: (id: string) => void;
  clear: () => void;
  latestActive: () => StormAlert | undefined;
};

export const useStormAlertStore = create<StormAlertStoreState>()(
  persist(
    (set, get) => ({
      alerts: [],

      inject: (input) => {
        // Everything the scan knows rides the alert — where it hit, how
        // strong, how many reports — so the detail screen and the knock route
        // read the same facts the notification did.
        const alert: StormAlert = {
          ...input,
          id: newId(),
          firedAt: new Date().toISOString(),
          status: 'new',
        };
        set((s) => ({ alerts: [alert, ...s.alerts] }));
        return alert;
      },

      dismiss: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, status: 'dismissed' } : a,
          ),
        })),

      markActedOn: (id) =>
        set((s) => ({
          alerts: s.alerts.map((a) =>
            a.id === id ? { ...a, status: 'acted_on' } : a,
          ),
        })),

      clear: () => set({ alerts: [] }),

      latestActive: () =>
        get().alerts.find((a) => a.status === 'new'),
    }),
    {
      name: 'roofwise.stormAlerts.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ alerts: s.alerts }),
    },
  ),
);
