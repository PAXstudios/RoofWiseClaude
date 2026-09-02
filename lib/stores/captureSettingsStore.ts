// Capture-settings sheet state (Quick Inspection ⚙︎). Persisted so a roofer's
// choice survives a relaunch — but Live overlay is deliberately OFF by
// default: every "on" minute costs a Gemini call every ~3 s and battery, so
// it is an opt-in per device, never a surprise.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';

type State = {
  /** Live scan: a reduced frame is analysed every ~3 s and drawn over the
   *  viewfinder. Results are never saved as findings. OFF by default. */
  liveOverlay: boolean;
  /** Level indicator + rule-of-thirds grid over the viewfinder. */
  guides: boolean;
  /** "Notify me" for anchored AR markers, which need the native build. Local
   *  only — nothing is sent anywhere; it is read back when the build ships. */
  arNotify: boolean;
  /** Model id that last answered a live frame (honest provenance for the
   *  "LIVE · <model>" label before the first frame of a new session). */
  lastLiveModel: string | null;

  setLiveOverlay: (v: boolean) => void;
  setGuides: (v: boolean) => void;
  setArNotify: (v: boolean) => void;
  setLastLiveModel: (model: string | null) => void;
};

export const useCaptureSettingsStore = create<State>()(
  persist(
    (set) => ({
      liveOverlay: false,
      guides: true,
      arNotify: false,
      lastLiveModel: null,
      setLiveOverlay: (v) => set({ liveOverlay: v }),
      setGuides: (v) => set({ guides: v }),
      setArNotify: (v) => set({ arNotify: v }),
      setLastLiveModel: (model) => set({ lastLiveModel: model }),
    }),
    {
      name: 'roofwise.captureSettings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        liveOverlay: s.liveOverlay,
        guides: s.guides,
        arNotify: s.arNotify,
        lastLiveModel: s.lastLiveModel,
      }),
    },
  ),
);
