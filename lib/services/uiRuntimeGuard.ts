// UI-runtime (worklet) error trap — what CAN and CANNOT be caught, honestly.
//
// The owner's iOS crash log (Expo Go 54.0.6, iPhone17,2): EXC_CRASH / SIGABRT,
// innermost frames `__cxa_throw ← HermesRuntimeImpl::throwPendingError ←
// HermesRuntimeImpl::call ← … ← worklets::UIScheduler::triggerUI`. A JS
// exception thrown INSIDE A WORKLET on the UI runtime escaped as a C++
// jsi::JSError, nothing caught it, std::terminate aborted the process. The JS
// ErrorBoundary and the ErrorUtils handler in diagnostics.ts never saw it —
// they live on the React Native runtime, and the process died.
//
// What react-native-worklets 0.5.1 actually offers (read from node_modules):
//
//   Common/cpp/worklets/SharedItems/Serializable.h  `runOnRuntimeGuarded`:
//     #ifndef NDEBUG  → getCallGuard(rt).call(rt, function, args...)  // wraps in JS
//     #else           → function.asObject(rt).asFunction(rt).call(...) // DIRECT
//
//   i.e. in a RELEASE NATIVE BINARY — which Expo Go from the App Store is,
//   regardless of whether the JS bundle is dev or release — every worklet is
//   invoked directly with NO guard. There is no global error hook on the UI
//   runtime that C++ consults in release. The `__callGuardDEV` global (set by
//   src/callGuard.ts `setupCallGuard`) and the RN-side
//   `__reportFatalRemoteError` (src/errors.ts) are only exercised by a debug
//   native build (a `expo run:ios` dev client / a debug EAS build).
//
// So this module does two things and is explicit about their reach:
//
//   1. `reportWorkletError(err, where)` — a worklet-safe helper for a
//      try/catch INSIDE a worklet body. This is the only trap that works in
//      Expo Go: the throw is caught in JS on the UI runtime before it can
//      reach C++, and the message is forwarded to Diagnostics via runOnJS.
//      Every worklet we own on the Map tab uses it (see app/(tabs)/map.tsx).
//
//   2. `installUiRuntimeGuard()` — for DEBUG native builds only: replaces the
//      UI runtime's `__callGuardDEV` with one that records to Diagnostics and
//      does NOT escalate to RN's fatal path, and wraps the RN-side
//      `__reportFatalRemoteError` so a worklet error that does come through
//      it is recorded before RN handles it. In Expo Go these are inert
//      (harmless) — documented, not hidden.
//
// The NEXT crash log therefore carries the JS message only if the throw
// happened inside a worklet that uses (1). Third-party worklets (Reanimated's
// own layout animations, etc.) remain unguarded in release — see open risks.

import { runOnJS, runOnUI } from 'react-native-reanimated';
import { recordError } from '@/lib/services/diagnostics';

const PREFIX = '[ui-runtime]';

type ErrorLike = { message?: unknown; stack?: unknown; name?: unknown } | null | undefined;

/** JS-runtime side: record a worklet error to Diagnostics. Never throws. */
function recordWorkletErrorOnJS(message: string, stack: string, name: string): void {
  try {
    const err = new Error(message);
    err.name = name || 'WorkletError';
    if (stack) err.stack = stack;
    recordError(err, { kind: 'js_error' });
  } catch {
    // Recording must never throw back into the runtime that just recovered.
  }
}

/**
 * Call from a `catch` block INSIDE a worklet. Forwards the error to
 * Diagnostics on the JS thread and returns — the caller then returns a safe
 * fallback value so the animation frame completes instead of aborting the
 * process.
 *
 *   const style = useAnimatedStyle(() => {
 *     try { ... } catch (e) { reportWorkletError(e, 'map.Rise'); return FALLBACK; }
 *   });
 */
export function reportWorkletError(error: unknown, where: string): void {
  'worklet';
  const e = error as ErrorLike;
  const message =
    e && typeof e.message === 'string' ? e.message : typeof error === 'string' ? error : 'unknown error';
  const stack = e && typeof e.stack === 'string' ? e.stack : '';
  const name = e && typeof e.name === 'string' ? e.name : 'WorkletError';
  runOnJS(recordWorkletErrorOnJS)(`${PREFIX} ${where}: ${message}`, stack, name);
}

let installed = false;

/**
 * Mount ONCE at boot, after diagnostics.install():
 *
 *   import { installUiRuntimeGuard } from '@/lib/services/uiRuntimeGuard';
 *   installUiRuntimeGuard();   // app/_layout.tsx, right after installDiagnostics()
 *
 * Idempotent; never throws. See the module comment for what this reaches.
 */
export function installUiRuntimeGuard(): void {
  if (installed) return;
  installed = true;

  // (a) RN runtime: record before RN's fatal path sees a remote (worklet) error.
  try {
    const g = globalThis as {
      __reportFatalRemoteError?: (error: Error, force?: boolean) => void;
    };
    const previous = g.__reportFatalRemoteError;
    if (typeof previous === 'function') {
      g.__reportFatalRemoteError = (error: Error, force?: boolean) => {
        try {
          recordError(error, { kind: 'js_error' });
        } catch {
          // never block the original path
        }
        previous(error, force);
      };
    }
  } catch {
    // Global not writable on this runtime — nothing to wrap.
  }

  // (b) UI runtime: a non-fatal call guard. Only a DEBUG native binary calls
  // `__callGuardDEV` (Serializable.h, `#ifndef NDEBUG`); in Expo Go this
  // assignment is inert. Errors are recorded and swallowed — the worklet
  // returns undefined for that frame instead of taking the process down.
  try {
    runOnUI(() => {
      'worklet';
      const ui = globalThis as {
        __callGuardDEV?: (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => unknown;
      };
      ui.__callGuardDEV = (fn: (...a: unknown[]) => unknown, ...args: unknown[]) => {
        try {
          return fn(...args);
        } catch (error) {
          reportWorkletError(error, 'callGuard');
          return undefined;
        }
      };
    })();
  } catch {
    // Reanimated not initialised yet (or web) — the per-worklet try/catch
    // helper above is still fully functional.
  }
}
