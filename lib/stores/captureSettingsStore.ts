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

/** The persisted slice — everything but the setters. */
type Persisted = Pick<
  State,
  | 'liveOverlay'
  | 'guides'
  | 'arNotify'
  | 'lastLiveModel'
  | 'multiSelectImport'
  | 'coachEnabled'
  | 'coachStepByJob'
>;

/** One place for the defaults: the fresh-install state AND what a missing
 *  field rehydrates to, so the two can never disagree. */
const DEFAULTS: Persisted = {
  liveOverlay: false,
  guides: true,
  arNotify: false,
  lastLiveModel: null,
  multiSelectImport: true,
  coachEnabled: true,
  coachStepByJob: {},
};

/**
 * Bump whenever the persisted shape changes, and teach `migrate` the new
 * field at the same time. zustand DROPS a stored blob whose version does not
 * match and no migrate function handles it — for this store that would
 * silently switch Live overlay / the coach back to defaults on every device.
 */
const PERSIST_VERSION = 1;

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

/**
 * Fill every field the current shape needs with its default when a stored
 * blob predates it (or holds the wrong type). Nothing the roofer chose is
 * changed — only what is missing is filled.
 */
function migrateCaptureSettings(persisted: unknown): Persisted {
  const raw = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<
    Record<keyof Persisted, unknown>
  >;
  const steps = raw.coachStepByJob;
  const coachStepByJob: Record<string, string> = {};
  if (steps && typeof steps === 'object' && !Array.isArray(steps)) {
    for (const [jobId, stepId] of Object.entries(steps as Record<string, unknown>)) {
      if (typeof stepId === 'string') coachStepByJob[jobId] = stepId;
    }
  }
  return {
    liveOverlay: bool(raw.liveOverlay, DEFAULTS.liveOverlay),
    guides: bool(raw.guides, DEFAULTS.guides),
    arNotify: bool(raw.arNotify, DEFAULTS.arNotify),
    lastLiveModel: typeof raw.lastLiveModel === 'string' ? raw.lastLiveModel : null,
    multiSelectImport: bool(raw.multiSelectImport, DEFAULTS.multiSelectImport),
    coachEnabled: bool(raw.coachEnabled, DEFAULTS.coachEnabled),
    coachStepByJob,
  };
}

export const useCaptureSettingsStore = create<State>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setLiveOverlay: (v) => set({ liveOverlay: v }),
      setGuides: (v) => set({ guides: v }),
      setArNotify: (v) => set({ arNotify: v }),
      setLastLiveModel: (model) => set({ lastLiveModel: model }),
      setMultiSelectImport: (v) => set({ multiSelectImport: v }),
      setCoachEnabled: (v) => set({ coachEnabled: v }),
      setCoachStep: (jobId, stepId) =>
        set((s) => ({ coachStepByJob: { ...s.coachStepByJob, [jobId]: stepId } })),
    }),
    {
      name: 'roofwise.captureSettings.v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: PERSIST_VERSION,
      migrate: (persisted) => migrateCaptureSettings(persisted),
      partialize: (s): Persisted => ({
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
