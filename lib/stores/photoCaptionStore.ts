// Per-photo captions for the job page's Photo Log — "tap a photo to add or
// edit its caption" (the owner's reference screenshots). Keyed by the photo's
// URI, the same key `Slope.photoAnalysis` / `photoSync` use, so a caption
// survives a photo's INDEX shifting when another photo on the slope is
// deleted, and rides across slopes without touching `inspectionStore.ts` —
// a different wave owns that store this session.
//
// Persisted; never seeded (Drift #5) — a photo has no caption until the
// roofer writes one, and the store starts empty on every fresh install.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

export type PhotoCaption = {
  text: string;
  /** ISO timestamp of the last edit — the Photo Log's "edited …" line. */
  updatedAt: string;
};

type PhotoCaptionState = {
  /** localUri -> caption. */
  captions: Record<string, PhotoCaption>;
  /** Write (or, given blank text, clear) a photo's caption. */
  setCaption: (uri: string, text: string) => void;
  clearCaption: (uri: string) => void;
};

export const usePhotoCaptionStore = create<PhotoCaptionState>()(
  persist(
    (set) => ({
      captions: {},

      setCaption: (uri, text) => {
        const trimmed = text.trim();
        set((s) => {
          if (!trimmed) {
            if (!(uri in s.captions)) return s;
            const next = { ...s.captions };
            delete next[uri];
            return { captions: next };
          }
          return {
            captions: {
              ...s.captions,
              [uri]: { text: trimmed, updatedAt: new Date().toISOString() },
            },
          };
        });
      },

      clearCaption: (uri) =>
        set((s) => {
          if (!(uri in s.captions)) return s;
          const next = { ...s.captions };
          delete next[uri];
          return { captions: next };
        }),
    }),
    {
      name: 'roofwise.photoCaptions.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ captions: s.captions }),
    },
  ),
);

/** Stable selector for one photo's caption (undefined when it has none). */
export function selectCaption(uri: string) {
  return (s: PhotoCaptionState): PhotoCaption | undefined => s.captions[uri];
}
