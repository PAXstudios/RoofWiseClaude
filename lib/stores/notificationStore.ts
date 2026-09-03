// In-app notifications — the bell on Home and the Notifications screen.
//
// One durable list of "things that queued, finished or need you": a knock
// plan started / ready / failed, a slope analysis finished or failed, a storm
// alert, a follow-up reminder. Each entry carries the route that opens the
// thing it is about, so the bell is a to-do list, not a log. Local push
// notifications (lib/services/pushNotifications.ts) mirror the entries that
// matter when the app is not in front; this store is what the app shows.
//
// Drift #5: entries are written only by real events; nothing is seeded.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppNotificationKind =
  | 'plan_queued'
  | 'plan_ready'
  | 'plan_failed'
  | 'analysis_done'
  | 'analysis_failed'
  | 'storm_alert'
  | 'follow_up'
  | 'info';

export type AppNotification = {
  id: string;
  kind: AppNotificationKind;
  title: string;
  body?: string;
  createdAt: string;
  read: boolean;
  /** Route to open (expo-router href). */
  href?: string;
  /** Dedupe key: a second push with the same key replaces the first. */
  key?: string;
};

const MAX = 200;
let counter = 0;
const newId = () => `ntf_${Date.now()}_${counter++}`;

type NotificationState = {
  items: AppNotification[];
  push: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'> & { read?: boolean }) => AppNotification;
  markRead: (id: string) => void;
  markAllRead: () => void;
  remove: (id: string) => void;
  clear: () => void;
  unreadCount: () => number;
};

export const useNotificationStore = create<NotificationState>()(
  persist(
    (set, get) => ({
      items: [],

      push: (n) => {
        const item: AppNotification = { id: newId(), createdAt: new Date().toISOString(), read: n.read ?? false, ...n };
        set((s) => ({
          items: [item, ...s.items.filter((x) => !(n.key && x.key === n.key))].slice(0, MAX),
        }));
        return item;
      },

      markRead: (id) => set((s) => ({ items: s.items.map((x) => (x.id === id ? { ...x, read: true } : x)) })),
      markAllRead: () => set((s) => ({ items: s.items.map((x) => (x.read ? x : { ...x, read: true })) })),
      remove: (id) => set((s) => ({ items: s.items.filter((x) => x.id !== id) })),
      clear: () => set({ items: [] }),
      unreadCount: () => get().items.filter((x) => !x.read).length,
    }),
    {
      name: 'roofwise.notifications.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }),
    },
  ),
);

/** Selector for the bell badge (re-renders only when the count changes). */
export const selectUnreadCount = (s: NotificationState) => s.items.reduce((n, x) => n + (x.read ? 0 : 1), 0);
