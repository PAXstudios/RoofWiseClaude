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
import { useInspectorProfileStore } from './inspectorProfileStore';

let counter = 0;

function newId(): string {
  return `corr_${Date.now()}_${counter++}`;
}

/** Stars the contractor can give a correction. Only asked on corrections. */
export type ConfidenceStars = 1 | 2 | 3 | 4 | 5;

/**
 * Trust weighting for the learning loop.
 *
 * TODO(post-raise): certification is captured on the inspector profile
 * (`haagCertified` / `haagCertificationNumber`) but is deliberately NOT
 * weighted yet — real trust weighting needs a validated model and is
 * post-raise work. Every correction is stamped with the neutral weight so the
 * field exists on records from day one and nothing needs back-filling later.
 */
const NEUTRAL_TRUST_WEIGHT = 1;
const TRUST_WEIGHTS: Record<'certified' | 'uncertified', number> = {
  certified: NEUTRAL_TRUST_WEIGHT,
  uncertified: NEUTRAL_TRUST_WEIGHT,
};

/** Current inspector's trust weight. Neutral (1) for everyone today. */
export function inspectorTrustWeight(): number {
  const profile = useInspectorProfileStore.getState().profile;
  const certified = profile.haagCertified || Boolean(profile.haagCertificationNumber);
  return TRUST_WEIGHTS[certified ? 'certified' : 'uncertified'];
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
  /** Optional at record time — swipe-review stamps it after the fact. */
  confidenceStars?: ConfidenceStars;
  /** Defaults to the current inspector's weight; pass to override. */
  inspectorTrustWeight?: number;
};

type CorrectionsStoreState = {
  corrections: Correction[];

  record: (input: RecordCorrectionInput) => Correction;
  /**
   * Attach a 1-5 star confidence rating to an already-recorded correction.
   * Used by swipe-review after the contractor returns from the editor.
   * Re-arms sync for records that already shipped so the star follows.
   *
   * `via` records the gesture that opened the correction — the editor keeps
   * ownership of `correctionType` (edit / add_marker / remove_marker), which
   * describes *what* changed, so provenance rides along in `delta` instead.
   */
  setConfidence: (
    id: string,
    stars: ConfidenceStars,
    options?: { via?: CorrectionType },
  ) => void;
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
          confidenceStars: input.confidenceStars,
          inspectorTrustWeight: input.inspectorTrustWeight ?? inspectorTrustWeight(),
        };
        set((s) => ({ corrections: [corr, ...s.corrections].slice(0, 1000) }));
        return corr;
      },

      setConfidence: (id, stars, options) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            c.id === id
              ? {
                  ...c,
                  confidenceStars: stars,
                  inspectorTrustWeight: c.inspectorTrustWeight ?? inspectorTrustWeight(),
                  delta: options?.via ? { ...c.delta, correctedVia: options.via } : c.delta,
                  // A synced record needs to go out again to carry the star.
                  syncStatus: c.syncStatus === 'synced' ? 'pending' : c.syncStatus,
                }
              : c,
          ),
        })),

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
