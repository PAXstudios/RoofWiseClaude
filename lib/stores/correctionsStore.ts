import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Correction,
  CorrectionType,
  DamageCategory,
  DamageMarker,
  InspectionFinding,
} from '../models/types';

let counter = 0;

function newId(): string {
  return `corr_${Date.now()}_${counter++}`;
}

export type RecordCorrectionInput = {
  inspectionId: string;
  photoId: string;
  slopeId?: string;
  correctionType: CorrectionType;
  categoriesAffected: DamageCategory[];
  originalDetection: { findings: InspectionFinding[]; markers: DamageMarker[] };
  correctedDetection: { findings: InspectionFinding[]; markers: DamageMarker[] };
  delta: Record<string, unknown>;
  photoUrl?: string;
  photoHash?: string;
};

type CorrectionsStoreState = {
  corrections: Correction[];

  record: (input: RecordCorrectionInput) => Correction;
  pending: () => Correction[];
  markSyncing: (ids: string[]) => void;
  markSynced: (ids: string[]) => void;
  markFailed: (ids: string[]) => void;
  countByCategory: () => Record<DamageCategory, number>;
  totalCount: () => number;
  clear: () => void;
};

export const useCorrectionsStore = create<CorrectionsStoreState>()(
  persist(
    (set, get) => ({
      corrections: [],

      record: (input) => {
        const corr: Correction = {
          id: newId(),
          inspectionId: input.inspectionId,
          photoId: input.photoId,
          slopeId: input.slopeId,
          correctionType: input.correctionType,
          categoriesAffected: input.categoriesAffected,
          originalDetection: input.originalDetection,
          correctedDetection: input.correctedDetection,
          delta: input.delta,
          photoUrl: input.photoUrl,
          photoHash: input.photoHash,
          syncStatus: 'pending',
          correctedAt: new Date().toISOString(),
        };
        set((s) => ({ corrections: [corr, ...s.corrections].slice(0, 1000) }));
        return corr;
      },

      pending: () => get().corrections.filter((c) => c.syncStatus === 'pending'),

      markSyncing: (ids) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            ids.includes(c.id) ? { ...c, syncStatus: 'syncing' } : c,
          ),
        })),

      markSynced: (ids) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            ids.includes(c.id) ? { ...c, syncStatus: 'synced' } : c,
          ),
        })),

      markFailed: (ids) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            ids.includes(c.id) ? { ...c, syncStatus: 'failed' } : c,
          ),
        })),

      countByCategory: () => {
        const out: Record<string, number> = {};
        for (const c of get().corrections) {
          for (const cat of c.categoriesAffected) {
            out[cat] = (out[cat] ?? 0) + 1;
          }
        }
        return out as Record<DamageCategory, number>;
      },

      totalCount: () => get().corrections.length,

      clear: () => set({ corrections: [] }),
    }),
    {
      name: 'roofwise.corrections.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ corrections: s.corrections }),
    },
  ),
);
