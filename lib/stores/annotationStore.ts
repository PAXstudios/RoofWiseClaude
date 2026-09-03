// Photo annotations, persisted — keyed by the photo's URI, independent of the
// inspection store (a drawing is not a finding: it never touches counts,
// markers, or the decision engine).
//
// Why the URI and not inspection/slope/index: `removePhoto` renumbers indices
// and a rotate gives the photo a fresh URI, which is exactly the convention
// `Slope.photoAnalysis` settled on. Read with `get(uri)` / `count(uri)`;
// components subscribe with `useAnnotationStore((s) => s.byUri[uri])` so only
// the tile whose photo changed re-renders.

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { isAnnotation, type Annotation, type PhotoAnnotations } from '../models/annotations';

const EMPTY: readonly Annotation[] = Object.freeze([]) as readonly Annotation[];

type AnnotationStoreState = {
  byUri: Record<string, PhotoAnnotations>;
  /** The items on a photo — an empty array when it has none. Stable reference. */
  get: (uri: string) => readonly Annotation[];
  /** The whole record, when there is one. */
  getRecord: (uri: string) => PhotoAnnotations | undefined;
  /**
   * Replace the photo's items. Saving an empty list removes the record
   * (`count` reads 0 and the badge disappears) — there is no such thing as
   * a photo annotated with nothing. `size` is the pixel size the items were
   * normalised against; omit to keep the stored one.
   */
  set: (uri: string, items: readonly Annotation[], size?: { imageW: number; imageH: number }) => void;
  clear: (uri: string) => void;
  count: (uri: string) => number;
};

/** The persisted slice — records only; actions are rebuilt on load. */
type Persisted = { byUri: Record<string, PhotoAnnotations> };

const PERSIST_VERSION = 1;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

/** Rehydration guard: drop items that are not annotations rather than crash a render. */
function normalizeRecord(uri: string, raw: unknown): PhotoAnnotations | null {
  if (!isRecord(raw)) return null;
  const items = Array.isArray(raw.items) ? raw.items.filter(isAnnotation) : [];
  if (items.length === 0) return null;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0);
  return {
    uri,
    imageW: num(raw.imageW),
    imageH: num(raw.imageH),
    items,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date(0).toISOString(),
  };
}

function migrate(persisted: unknown): Persisted {
  const raw = isRecord(persisted) && isRecord(persisted.byUri) ? persisted.byUri : {};
  const byUri: Record<string, PhotoAnnotations> = {};
  for (const [uri, rec] of Object.entries(raw)) {
    const n = normalizeRecord(uri, rec);
    if (n) byUri[uri] = n;
  }
  return { byUri };
}

export const useAnnotationStore = create<AnnotationStoreState>()(
  persist(
    (set, get) => ({
      byUri: {},

      get: (uri) => get().byUri[uri]?.items ?? EMPTY,

      getRecord: (uri) => get().byUri[uri],

      set: (uri, items, size) => {
        const clean = items.filter(isAnnotation);
        set((s) => {
          if (clean.length === 0) {
            if (!(uri in s.byUri)) return s;
            const { [uri]: _dropped, ...rest } = s.byUri;
            return { byUri: rest };
          }
          const prev = s.byUri[uri];
          return {
            byUri: {
              ...s.byUri,
              [uri]: {
                uri,
                imageW: size?.imageW ?? prev?.imageW ?? 0,
                imageH: size?.imageH ?? prev?.imageH ?? 0,
                items: clean,
                updatedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      clear: (uri) =>
        set((s) => {
          if (!(uri in s.byUri)) return s;
          const { [uri]: _dropped, ...rest } = s.byUri;
          return { byUri: rest };
        }),

      count: (uri) => get().byUri[uri]?.items.length ?? 0,
    }),
    {
      name: 'roofwise.annotations.v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: PERSIST_VERSION,
      migrate: (persisted) => migrate(persisted),
      partialize: (s): Persisted => ({ byUri: s.byUri }),
    },
  ),
);

/** Subscribe to one photo's items (stable empty array when none). */
export function useAnnotationsFor(uri: string | undefined): readonly Annotation[] {
  return useAnnotationStore((s) => (uri ? s.byUri[uri]?.items ?? EMPTY : EMPTY));
}
