// Camera chrome — what the Quick Inspection HUD remembers between launches,
// and the crash-safety signal that makes it render static.
//
// The viewfinder is clean by default: shutter, last-shot thumbnail, slope
// pill, close, and one chevron. Everything else (mode strip, tool rail,
// instrument cluster) is "secondary chrome" that the chevron or a tap on the
// viewfinder reveals and that tucks itself away after a few idle seconds.
// This store keeps the roofer's preferences for that chrome so the camera
// opens the way they left it.
//
// Safety mode mirrors the Map tab's contract (PROMPT_LOG #63): a native abort
// records nothing, so an "armed" flag is set while the camera is on screen
// and cleared on blur / unmount / background. Still set at the next launch
// ⇒ the previous run ended on the camera ⇒ the chrome renders with NO
// Reanimated worklets for this session (plain Views, cut transitions) and
// says so in one line in Capture settings, with a row to turn motion back on.

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { list as listDiagnostics } from '@/lib/services/diagnostics';

export type CoachDetent = 'peek' | 'half' | 'full';

/** Why the chrome is static this session, when it is. */
export type ChromeSafetySignal = 'armed-flag' | 'diagnostics' | null;

type Persisted = {
  /** Last explicit open/closed state of the secondary chrome. */
  chromeOpen: boolean;
  /** Long-press on the chevron: the chrome stays open instead of tucking
   *  itself away after the idle timeout. */
  keepOpen: boolean;
  /** Where the coach drawer was left. */
  coachDetent: CoachDetent;
  /** Draw the 10×10 test-square guide + course grid in Test-square mode
   *  (needs Live overlay for the scale). */
  squareGuide: boolean;
};

type State = Persisted & {
  /** In-memory only: set at mount from `readChromeSafetySignal()`. */
  staticReason: ChromeSafetySignal;

  setChromeOpen: (v: boolean) => void;
  setKeepOpen: (v: boolean) => void;
  setCoachDetent: (d: CoachDetent) => void;
  setSquareGuide: (v: boolean) => void;
  setStaticReason: (r: ChromeSafetySignal) => void;
};

const DEFAULTS: Persisted = {
  chromeOpen: false,
  keepOpen: false,
  coachDetent: 'peek',
  squareGuide: true,
};

const PERSIST_VERSION = 1;

function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === 'boolean' ? v : fallback;
}

function detent(v: unknown): CoachDetent {
  return v === 'peek' || v === 'half' || v === 'full' ? v : DEFAULTS.coachDetent;
}

/** Fill anything a stored blob is missing with its default; never drop a choice. */
function migrateCaptureChrome(persisted: unknown): Persisted {
  const raw = (persisted && typeof persisted === 'object' ? persisted : {}) as Partial<
    Record<keyof Persisted, unknown>
  >;
  return {
    chromeOpen: bool(raw.chromeOpen, DEFAULTS.chromeOpen),
    keepOpen: bool(raw.keepOpen, DEFAULTS.keepOpen),
    coachDetent: detent(raw.coachDetent),
    squareGuide: bool(raw.squareGuide, DEFAULTS.squareGuide),
  };
}

export const useCaptureChromeStore = create<State>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      staticReason: null,
      setChromeOpen: (v) => set({ chromeOpen: v }),
      setKeepOpen: (v) => set({ keepOpen: v }),
      setCoachDetent: (d) => set({ coachDetent: d }),
      setSquareGuide: (v) => set({ squareGuide: v }),
      setStaticReason: (r) => set({ staticReason: r }),
    }),
    {
      name: 'roofwise.captureChrome.v1',
      storage: createJSONStorage(() => AsyncStorage),
      version: PERSIST_VERSION,
      migrate: (persisted) => migrateCaptureChrome(persisted),
      partialize: (s): Persisted => ({
        chromeOpen: s.chromeOpen,
        keepOpen: s.keepOpen,
        coachDetent: s.coachDetent,
        squareGuide: s.squareGuide,
      }),
    },
  ),
);

// -----------------------------------------------------------------------------
// Crash-safety signal (same two-signal reading as the Map tab)
// -----------------------------------------------------------------------------

const CHROME_ARMED_KEY = 'roofwise.camera.chromeArmed.v1';
const CAMERA_ROUTE_RE = /\/quick-inspection$/;
const BOOT_PROXIMITY_MS = 5_000;

/**
 * Did the last run die with the camera on screen? Either the armed flag is
 * still set (the process never got to clear it) or Diagnostics holds an error
 * on the camera route inside the previous session. Never throws.
 */
export async function readChromeSafetySignal(): Promise<ChromeSafetySignal> {
  try {
    const armed = await AsyncStorage.getItem(CHROME_ARMED_KEY);
    if (armed) return 'armed-flag';
  } catch {
    // Storage unavailable — fall through to the diagnostics read.
  }
  try {
    const entries = listDiagnostics(); // newest first
    const bootIdx = entries
      .map((e, i) => (e.kind === 'boot' ? i : -1))
      .filter((i) => i >= 0);
    if (bootIdx.length === 0) return null;
    const start = bootIdx[0] + 1;
    const end = bootIdx.length >= 2 ? bootIdx[1] + 1 : entries.length;
    const prevBootMs = bootIdx.length >= 2 ? Date.parse(entries[bootIdx[1]].iso) : NaN;
    for (let i = start; i < end; i += 1) {
      const e = entries[i];
      if (!e.route || !CAMERA_ROUTE_RE.test(e.route)) continue;
      const isError = e.kind === 'js_error' || e.kind === 'promise_rejection';
      const nearBoot =
        Number.isFinite(prevBootMs) && Math.abs(Date.parse(e.iso) - prevBootMs) <= BOOT_PROXIMITY_MS;
      if (isError || nearBoot) return 'diagnostics';
    }
  } catch {
    // Diagnostics unreadable — no signal, normal boot.
  }
  return null;
}

/** Set while the camera is focused and the app active; cleared otherwise. Best-effort. */
export function setChromeArmed(on: boolean): void {
  const op = on
    ? AsyncStorage.setItem(CHROME_ARMED_KEY, new Date().toISOString())
    : AsyncStorage.removeItem(CHROME_ARMED_KEY);
  op.catch(() => {
    // A missed write only means one less crash signal.
  });
}
