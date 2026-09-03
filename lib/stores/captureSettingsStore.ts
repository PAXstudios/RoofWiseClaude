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
  /** Try real multi-select when importing from the library (SDK 54 / expo-image
   *  -picker 17 modern PHPicker). ON by default; a one-tap kill switch that
   *  drops the importer back to the proven single-asset loop if a device ever
   *  shows the old Expo Go crash (PROMPT_LOG #24/#25). */
  multiSelectImport: boolean;
  /** Model id that last answered a live frame (honest provenance for the
   *  "LIVE · <model>" label before the first frame of a new session). */
  lastLiveModel: string | null;
  /** Guided capture: the step strip over the camera that walks every slope
   *  and collateral surface. ON by default — a complete packet is the point;
   *  a one-tap switch off for the roofer who knows the walk. */
  coachEnabled: boolean;
  /** Which step each job is on, so leaving and coming back resumes there. */
  coachStepByJob: Record<string, string>;

  setLiveOverlay: (v: boolean) => void;
  setGuides: (v: boolean) => void;
  setArNotify: (v: boolean) => void;
  setLastLiveModel: (model: string | null) => void;
  setMultiSelectImport: (v: boolean) => void;
  setCoachEnabled: (v: boolean) => void;
  setCoachStep: (jobId: string, stepId: string) => void;
};

export const useCaptureSettingsStore = create<State>()(
  persist(
    (set) => ({
      liveOverlay: false,
      guides: true,
      arNotify: false,
      lastLiveModel: null,
      multiSelectImport: true,
      setLiveOverlay: (v) => set({ liveOverlay: v }),
      setGuides: (v) => set({ guides: v }),
      setArNotify: (v) => set({ arNotify: v }),
      setLastLiveModel: (model) => set({ lastLiveModel: model }),
      setMultiSelectImport: (v) => set({ multiSelectImport: v }),
      coachEnabled: true,
      coachStepByJob: {},
      setCoachEnabled: (v) => set({ coachEnabled: v }),
      setCoachStep: (jobId, stepId) =>
        set((s) => ({ coachStepByJob: { ...s.coachStepByJob, [jobId]: stepId } })),
    }),
    {
      name: 'roofwise.captureSettings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({
        liveOverlay: s.liveOverlay,
        guides: s.guides,
        arNotify: s.arNotify,
        lastLiveModel: s.lastLiveModel,
        multiSelectImport: s.multiSelectImport,
        coachEnabled: s.coachEnabled,
        coachStepByJob: s.coachStepByJob,
      }),
    },
  ),
);
