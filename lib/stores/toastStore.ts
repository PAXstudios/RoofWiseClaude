import { create } from 'zustand';

export type Toast = {
  id: string;
  tone: 'success' | 'info' | 'warn' | 'danger';
  title: string;
  body?: string;
};

let counter = 0;

type ToastStoreState = {
  toasts: Toast[];
  show: (toast: Omit<Toast, 'id'>) => void;
  dismiss: (id: string) => void;
};

export const useToastStore = create<ToastStoreState>((set) => ({
  toasts: [],
  show: (t) => {
    const id = `toast_${Date.now()}_${counter++}`;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 3000);
  },
  dismiss: (id) =>
    set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })),
}));
