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

/**
 * Upload retry policy. A correction is the training signal the whole
 * learning loop runs on, so a flaky network must never lose one — but
 * neither may the app hammer a dead backend forever. A failed batch stays
 * `pending` behind an exponential backoff (5 min, 10, 20 … capped at 6 h)
 * and only becomes `failed` — terminal until a manual "Sync now" re-arms it
 * — after MAX_SYNC_ATTEMPTS. Roughly fourteen hours of trying in total.
 */
export const MAX_SYNC_ATTEMPTS = 8;
const SYNC_BACKOFF_BASE_MS = 5 * 60 * 1000;
const SYNC_BACKOFF_MAX_MS = 6 * 60 * 60 * 1000;

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
  /**
   * Records due for upload: `pending`, and past their backoff window unless
   * `ignoreBackoff` (a manual "Sync now") says to send them regardless.
   */
  pending: (opts?: { ignoreBackoff?: boolean }) => Correction[];
  markSyncing: (ids: string[]) => void;
  markSynced: (ids: string[]) => void;
  /**
   * One failed attempt for each id: the record stays `pending` behind a
   * backoff, or becomes `failed` once MAX_SYNC_ATTEMPTS is reached. `reason`
   * is kept on the record in plain words either way.
   */
  markFailed: (ids: string[], reason?: string) => void;
  /** Re-arm every terminal `failed` record — a deliberate retry. */
  requeueFailed: () => void;
  /**
   * Put records stuck in `syncing` (a crash mid-upload) back to `pending`.
   * Only the sync calls this, and only while it holds its own run guard, so
   * nothing else can be mid-flight.
   */
  requeueStale: () => void;
  countByCategory: () => Record<DamageCategory, number>;
  totalCount: () => number;
  clear: () => void;
};

/** The persisted slice — the records only; every action is rebuilt on load. */
type Persisted = { corrections: Correction[] };

/**
 * Bump whenever the persisted shape changes, and teach `migrate` the new
 * field at the same time. zustand DROPS a stored blob whose version does not
 * match and no migrate function handles it — for this store that would be
 * every correction on the device, i.e. the whole local training signal.
 */
const PERSIST_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function normalizeDetection(v: unknown): Correction['originalDetection'] {
  const raw = isRecord(v) ? v : {};
  return {
    findings: Array.isArray(raw.findings) ? (raw.findings as InspectionFinding[]) : [],
    markers: Array.isArray(raw.markers) ? (raw.markers as DamageMarker[]) : [],
  };
}

/**
 * Fill every field the current shape REQUIRES with its neutral default when
 * a stored record predates it. Nothing recorded is rewritten; nothing is
 * invented. Sync state resolves toward `pending`: a record caught mid-upload
 * by a crash, or one with no state at all, costs at most one extra upload —
 * the wrong direction (assuming it synced) would lose it.
 */
function migrateCorrections(persisted: unknown): Persisted {
  const raw = isRecord(persisted) ? persisted : {};
  const list = Array.isArray(raw.corrections) ? raw.corrections.filter(isRecord) : [];
  return {
    corrections: list.map((c) => ({
      ...(c as unknown as Correction),
      categoriesAffected: Array.isArray(c.categoriesAffected)
        ? (c.categoriesAffected as DamageCategory[])
        : [],
      originalDetection: normalizeDetection(c.originalDetection),
      correctedDetection: normalizeDetection(c.correctedDetection),
      delta: isRecord(c.delta) ? c.delta : {},
      syncStatus:
        c.syncStatus === 'synced' || c.syncStatus === 'failed' ? c.syncStatus : 'pending',
    })),
  };
}

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

      pending: (opts) => {
        const now = Date.now();
        return get().corrections.filter((c) => {
          if (c.syncStatus !== 'pending') return false;
          if (opts?.ignoreBackoff || !c.nextSyncAt) return true;
          return new Date(c.nextSyncAt).getTime() <= now;
        });
      },

      markSyncing: (ids) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            ids.includes(c.id) ? { ...c, syncStatus: 'syncing' } : c,
          ),
        })),

      markSynced: (ids) =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            ids.includes(c.id)
              ? {
                  ...c,
                  syncStatus: 'synced',
                  syncAttempts: undefined,
                  nextSyncAt: undefined,
                  syncError: undefined,
                }
              : c,
          ),
        })),

      markFailed: (ids, reason) =>
        set((s) => {
          const now = Date.now();
          return {
            corrections: s.corrections.map((c) => {
              if (!ids.includes(c.id)) return c;
              const attempts = (c.syncAttempts ?? 0) + 1;
              if (attempts >= MAX_SYNC_ATTEMPTS) {
                return {
                  ...c,
                  syncStatus: 'failed',
                  syncAttempts: attempts,
                  syncError: reason,
                  nextSyncAt: undefined,
                };
              }
              const delay = Math.min(
                SYNC_BACKOFF_MAX_MS,
                SYNC_BACKOFF_BASE_MS * 2 ** (attempts - 1),
              );
              return {
                ...c,
                syncStatus: 'pending',
                syncAttempts: attempts,
                syncError: reason,
                nextSyncAt: new Date(now + delay).toISOString(),
              };
            }),
          };
        }),

      requeueFailed: () =>
        set((s) => ({
          corrections: s.corrections.map((c) =>
            c.syncStatus === 'failed'
              ? { ...c, syncStatus: 'pending', syncAttempts: 0, nextSyncAt: undefined }
              : c,
          ),
        })),

      requeueStale: () =>
        set((s) =>
          s.corrections.some((c) => c.syncStatus === 'syncing')
            ? {
                corrections: s.corrections.map((c) =>
                  c.syncStatus === 'syncing' ? { ...c, syncStatus: 'pending' } : c,
                ),
              }
            : s,
        ),

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
      version: PERSIST_VERSION,
      migrate: (persisted) => migrateCorrections(persisted),
      partialize: (s): Persisted => ({ corrections: s.corrections }),
    },
  ),
);
