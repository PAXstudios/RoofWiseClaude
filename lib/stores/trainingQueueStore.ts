import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  DamageMarker,
  InspectionFinding,
  TrainingItem,
  TrainingItemStatus,
} from '../models/types';

let counter = 0;
function newId(): string {
  return `tq_${Date.now()}_${counter++}`;
}

type EnqueueInput = {
  inspectionId: string;
  slopeId?: string;
  photoPath: string;
  findings: InspectionFinding[];
  markers: DamageMarker[];
};

type TrainingQueueState = {
  items: TrainingItem[];

  enqueue: (input: EnqueueInput) => TrainingItem;
  setStatus: (id: string, status: TrainingItemStatus) => void;
  pendingCount: () => number;
};

export const useTrainingQueueStore = create<TrainingQueueState>()(
  persist(
    (set, get) => ({
      items: [],

      enqueue: (input) => {
        const item: TrainingItem = {
          id: newId(),
          inspectionId: input.inspectionId,
          slopeId: input.slopeId,
          photoPath: input.photoPath,
          originalAnalysis: {
            findings: input.findings,
            markers: input.markers,
          },
          status: 'pending',
          enqueuedAt: new Date().toISOString(),
        };
        set((s) => ({ items: [item, ...s.items].slice(0, 500) }));
        return item;
      },

      setStatus: (id, status) =>
        set((s) => ({
          items: s.items.map((it) => (it.id === id ? { ...it, status } : it)),
        })),

      pendingCount: () => get().items.filter((i) => i.status === 'pending').length,
    }),
    {
      name: 'roofwise.trainingQueue.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ items: s.items }),
    },
  ),
);
