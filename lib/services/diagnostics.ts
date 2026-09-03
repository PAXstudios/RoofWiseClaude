// On-device crash diagnostics — LOCAL ONLY, same shape as `telemetry.ts`.
//
// Why this exists: the app just ran on a real device (EAS Update, Expo Go
// SDK 54, New Architecture) for the first time after an SDK 51 -> 54 jump,
// and the only report back is "it keeps crashing". That is not actionable.
// This module turns the next crash into a pasteable text block: what threw,
// where, on what route, on what device/update — without a debugger attached.
//
// What it captures:
//   - JS errors        -- ErrorUtils.setGlobalHandler (wraps whatever handler
//                          was already installed and still calls it — RN's
//                          own redbox/reporting must keep working).
//   - Promise rejections -- the DOM-style `unhandledrejection` listener where
//                          the runtime exposes one, else Hermes's own
//                          `HermesInternal.enablePromiseRejectionTracker`
//                          (this app's actual engine — the `promise` npm
//                          package's tracker is a no-op under Hermes, see
//                          the comment on `installUnhandledRejectionHandler`).
//   - console.error     -- wrapped, still calls through to the real console.
//   - Boot markers      -- one entry per app start, with the EAS Update id /
//                          runtime version / channel when expo-updates can
//                          supply them (each read individually try/caught —
//                          these throw in plain Expo Go, not just "return
//                          null").
//
// Ring buffer of the last 50 entries, in memory, mirrored to AsyncStorage
// under one key, write-behind: persistence is chained and swallows its own
// errors so a full disk or a storage hiccup can never fail the log call, let
// alone the crash it's recording.
//
// Route tagging: expo-router's `usePathname()` needs a component inside the
// router tree, and this file must stay hook-free at the top level so
// `recordError` stays a safe thing to call from anywhere (including a class
// component's componentDidCatch, and the ErrorUtils handler, which do not
// have a hook context). So route tracking is a tiny external component,
// `DiagnosticsGate`, that does nothing but keep a module-level "last known
// route" current — see the mount instruction in this module's own doc below.

import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect } from 'react';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import { usePathname } from 'expo-router';

const STORAGE_KEY = 'roofwise.diagnostics.crashlog.v1';
const MAX_ENTRIES = 50;
const MAX_STACK_CHARS = 1200;

export type DiagnosticKind = 'js_error' | 'promise_rejection' | 'console_error' | 'boot';

export type DiagnosticEntry = {
  id: string;
  /** ISO-8601 timestamp. */
  iso: string;
  kind: DiagnosticKind;
  message: string;
  /** First 1200 chars of the stack (or component stack), when there is one. */
  stack?: string;
  /** Best-known route at the moment this was recorded. */
  route?: string;
  /** `Platform.OS · executionEnvironment · app version`. */
  device: string;
};

export type UpdateInfo = {
  updateId: string | null;
  runtimeVersion: string | null;
  channel: string | null;
};

// -----------------------------------------------------------------------------
// Route tracking
// -----------------------------------------------------------------------------

let lastRoute: string | null = null;

/** Last pathname `DiagnosticsGate` observed. Never throws; may be null pre-mount. */
export function getLastRoute(): string | null {
  return lastRoute;
}

/**
 * Mount ONCE, anywhere inside the router tree (e.g. `app/_layout.tsx`,
 * alongside `<ToastHost />`). Renders nothing — it only keeps `lastRoute`
 * current so every entry recorded after the first navigation is tagged with
 * where the user actually was.
 *
 *   import { DiagnosticsGate } from '@/lib/services/diagnostics';
 *   // inside RootLayout's return, next to <ToastHost />:
 *   <DiagnosticsGate />
 */
export function DiagnosticsGate(): null {
  const pathname = usePathname();
  useEffect(() => {
    lastRoute = pathname;
  }, [pathname]);
  return null;
}

// -----------------------------------------------------------------------------
// Device / update info
// -----------------------------------------------------------------------------

function executionEnvLabel(): string {
  try {
    switch (Constants.executionEnvironment) {
      case ExecutionEnvironment.StoreClient:
        return 'ExpoGo';
      case ExecutionEnvironment.Standalone:
        return 'Standalone';
      case ExecutionEnvironment.Bare:
        return 'Bare';
      default:
        return 'Unknown';
    }
  } catch {
    return 'Unknown';
  }
}

function currentDevice(): string {
  let version = '?';
  try {
    version = Constants.expoConfig?.version ?? '?';
  } catch {
    // expoConfig can be unavailable depending on how the bundle was loaded.
  }
  return `${Platform.OS} · ${executionEnvLabel()} · v${version}`;
}

/**
 * Each property read individually and try/caught — `expo-updates` throws on
 * some of these inside Expo Go rather than returning a safe default, so a
 * single try/catch around all three would let one throwing getter blank out
 * the other two.
 */
function readUpdateInfo(): UpdateInfo {
  let updateId: string | null = null;
  let runtimeVersion: string | null = null;
  let channel: string | null = null;
  // Loaded here, not at the top of this file: `expo-updates` calls
  // requireNativeModule('ExpoUpdates') at import time, which THROWS when the
  // native module is missing. This module is the crash recorder — it must
  // never be the module that crashes boot, so a missing/failed expo-updates
  // just leaves all three fields null.
  let Updates: {
    updateId?: string | null;
    runtimeVersion?: string | null;
    channel?: string | null;
  };
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    Updates = require('expo-updates');
  } catch {
    return { updateId, runtimeVersion, channel };
  }
  try {
    updateId = Updates.updateId ?? null;
  } catch {
    // not available in this runtime
  }
  try {
    runtimeVersion = Updates.runtimeVersion ?? null;
  } catch {
    // not available in this runtime
  }
  try {
    channel = Updates.channel ?? null;
  } catch {
    // not available in this runtime
  }
  return { updateId, runtimeVersion, channel };
}

let bootInfo: UpdateInfo = { updateId: null, runtimeVersion: null, channel: null };

/** Update id / runtime version / channel captured at boot, for a footer display. */
export function getBootInfo(): UpdateInfo {
  return bootInfo;
}

// -----------------------------------------------------------------------------
// Ring buffer + write-behind persistence
// -----------------------------------------------------------------------------

let buffer: DiagnosticEntry[] = []; // newest-first
let counter = 0;
let writeQueue: Promise<void> = Promise.resolve();

function nextId(): string {
  counter += 1;
  return `diag_${Date.now()}_${counter}`;
}

function isDiagnosticEntry(v: unknown): v is DiagnosticEntry {
  return (
    !!v &&
    typeof v === 'object' &&
    typeof (v as DiagnosticEntry).id === 'string' &&
    typeof (v as DiagnosticEntry).iso === 'string' &&
    typeof (v as DiagnosticEntry).kind === 'string' &&
    typeof (v as DiagnosticEntry).message === 'string'
  );
}

/** Chained + swallowed: a storage failure must never surface to the caller. */
function persist(): void {
  const snapshot = buffer;
  writeQueue = writeQueue
    .then(() => AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot)))
    .catch(() => {
      // Best-effort. The in-memory buffer is still correct for this session.
    });
}

function truncateStack(stack?: string): string | undefined {
  if (!stack) return undefined;
  return stack.length > MAX_STACK_CHARS ? stack.slice(0, MAX_STACK_CHARS) : stack;
}

function pushEntry(fields: { kind: DiagnosticKind; message: string; stack?: string }): void {
  const entry: DiagnosticEntry = {
    id: nextId(),
    iso: new Date().toISOString(),
    kind: fields.kind,
    message: fields.message || '(no message)',
    stack: truncateStack(fields.stack),
    route: lastRoute ?? undefined,
    device: currentDevice(),
  };
  buffer = [entry, ...buffer].slice(0, MAX_ENTRIES);
  persist();
}

function normalizeError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message || error.name || 'Error', stack: error.stack };
  }
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function safeStringifyArg(a: unknown): string {
  if (a instanceof Error) return a.stack ?? a.message;
  if (typeof a === 'string') return a;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Record a caught error/rejection. Never throws. */
export function recordError(
  error: unknown,
  opts: { kind?: DiagnosticKind; extraStack?: string } = {},
): void {
  try {
    const { message, stack } = normalizeError(error);
    const combinedStack = opts.extraStack
      ? `${stack ? stack + '\n\n' : ''}${opts.extraStack}`
      : stack;
    pushEntry({ kind: opts.kind ?? 'js_error', message, stack: combinedStack });
  } catch {
    // Logging must never throw into whatever just crashed.
  }
}

// -----------------------------------------------------------------------------
// Global hooks
// -----------------------------------------------------------------------------

function installGlobalErrorHandler(): void {
  try {
    const errorUtils = (globalThis as { ErrorUtils?: {
      getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
      setGlobalHandler?: (handler: (error: Error, isFatal?: boolean) => void) => void;
    } }).ErrorUtils;
    if (!errorUtils?.setGlobalHandler) return;
    const previousHandler = errorUtils.getGlobalHandler?.();
    errorUtils.setGlobalHandler((error, isFatal) => {
      recordError(error, { kind: 'js_error' });
      previousHandler?.(error, isFatal);
    });
  } catch {
    // No ErrorUtils on this runtime — nothing to hook.
  }
}

function installUnhandledRejectionHandler(): void {
  const g = globalThis as unknown as {
    addEventListener?: (type: string, listener: (event: { reason?: unknown }) => void) => void;
    HermesInternal?: {
      hasPromise?: () => boolean;
      enablePromiseRejectionTracker?: (options: {
        allRejections?: boolean;
        onUnhandled: (id: number, rejection: unknown) => void;
        onHandled: (id: number) => void;
      }) => void;
    };
  };

  // DOM-style listener — present on web and some RN configurations.
  if (typeof g.addEventListener === 'function') {
    try {
      g.addEventListener('unhandledrejection', (event) => {
        recordError(event?.reason, { kind: 'promise_rejection' });
      });
      return;
    } catch {
      // Fall through to the Hermes fallback below.
    }
  }

  // Hermes-compatible fallback. On Hermes (this app's engine), `global.Promise`
  // is Hermes' own native implementation, NOT the `promise` npm polyfill — so
  // hooking `promise/setimmediate/rejection-tracking` (which patches that
  // polyfill's Promise class) would be a silent no-op here. RN wires its own
  // dev-mode LogBox warning through `HermesInternal.enablePromiseRejectionTracker`
  // for exactly this reason (see react-native's `promiseRejectionTrackingOptions.js`
  // + `Core/polyfillPromise.js`), so that's the hook used here too — wrapping
  // whatever RN already installed and still calling it through, same as the
  // ErrorUtils and console.error wraps below, so the existing dev-mode
  // "Possible unhandled promise rejection" warning keeps firing.
  try {
    if (g.HermesInternal?.hasPromise?.() && g.HermesInternal.enablePromiseRejectionTracker) {
      let previous: {
        onUnhandled?: (id: number, rejection: unknown) => void;
        onHandled?: (id: number) => void;
      } = {};
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        previous = require('react-native/Libraries/promiseRejectionTrackingOptions').default;
      } catch {
        // Deep RN import moved/renamed — diagnostics still records below;
        // only RN's own dev-mode LogBox warning is lost.
      }
      g.HermesInternal.enablePromiseRejectionTracker({
        allRejections: true,
        onUnhandled: (id, rejection) => {
          recordError(rejection, { kind: 'promise_rejection' });
          previous.onUnhandled?.(id, rejection);
        },
        onHandled: (id) => previous.onHandled?.(id),
      });
      return;
    }
  } catch {
    // Fall through to the last-resort fallback below.
  }

  // Last resort for a non-Hermes, non-DOM runtime: the `promise` package's
  // own tracker, which only fires while `global.Promise` is still its polyfill.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const rejectionTracking = require('promise/setimmediate/rejection-tracking');
    rejectionTracking.enable({
      allRejections: true,
      onUnhandled: (_id: number, error: unknown) => {
        recordError(error, { kind: 'promise_rejection' });
      },
      onHandled: () => {},
    });
  } catch {
    // Nothing available on this runtime — rejections go uncaptured rather
    // than throwing out of install().
  }
}

function installConsoleErrorWrap(): void {
  try {
    const original = console.error.bind(console);
    console.error = (...args: unknown[]) => {
      try {
        const message = args.map(safeStringifyArg).join(' ');
        const errArg = args.find((a): a is Error => a instanceof Error);
        pushEntry({ kind: 'console_error', message, stack: errArg?.stack });
      } catch {
        // Never let logging break the real console.error call below.
      }
      original(...args);
    };
  } catch {
    // console.error not writable on this runtime — skip the wrap.
  }
}

function recordBoot(): void {
  bootInfo = readUpdateInfo();
  const parts = [
    'App started',
    `updateId=${bootInfo.updateId ?? 'embedded'}`,
    `runtimeVersion=${bootInfo.runtimeVersion ?? 'unknown'}`,
    `channel=${bootInfo.channel ?? 'unknown'}`,
  ];
  pushEntry({ kind: 'boot', message: parts.join(' · ') });
}

// -----------------------------------------------------------------------------
// Public lifecycle
// -----------------------------------------------------------------------------

let installed = false;

/**
 * Wire every capture hook and record a boot marker. Idempotent — safe to
 * call from more than one place (e.g. a redeploy of `DiagnosticsGate`'s
 * host, or a future second call site) without double-wrapping handlers.
 *
 * Hydrates the persisted buffer from AsyncStorage first (best-effort — a
 * read failure just starts from an empty buffer) so entries from a previous
 * session that crashed the app outright are still there to read afterward.
 */
export function install(): void {
  if (installed) return;
  installed = true;

  installGlobalErrorHandler();
  installUnhandledRejectionHandler();
  installConsoleErrorWrap();

  void AsyncStorage.getItem(STORAGE_KEY)
    .then((raw) => {
      if (!raw) return;
      const parsed: unknown = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const persisted = parsed.filter(isDiagnosticEntry);
      // Anything already pushed during this brief hydration window is newer
      // than everything on disk, so it stays first.
      buffer = [...buffer, ...persisted].slice(0, MAX_ENTRIES);
    })
    .catch(() => {
      // Corrupt or unavailable storage — start clean.
    })
    .finally(() => {
      recordBoot();
    });
}

/** Current buffer, newest first. Synchronous — safe to call from a render. */
export function list(): DiagnosticEntry[] {
  return [...buffer];
}

/** Wipe every recorded entry, in memory and on disk. */
export function clear(): void {
  buffer = [];
  persist();
}

/** Plain-text dump of everything recorded, newest first — paste into a chat. */
export function toText(): string {
  const info = getBootInfo();
  const header = [
    `RoofWise diagnostics — ${buffer.length} ${buffer.length === 1 ? 'entry' : 'entries'}`,
    `updateId=${info.updateId ?? 'embedded'} runtimeVersion=${info.runtimeVersion ?? 'unknown'} channel=${info.channel ?? 'unknown'}`,
    `device=${currentDevice()}`,
  ].join('\n');

  if (buffer.length === 0) {
    return `${header}\n\nNo errors recorded on this device.`;
  }

  const body = buffer
    .map((e, i) => {
      const lines = [
        `#${i + 1} [${e.kind}] ${e.iso}`,
        `route: ${e.route ?? 'unknown'}`,
        `device: ${e.device}`,
        `message: ${e.message}`,
      ];
      if (e.stack) lines.push(`stack:\n${e.stack}`);
      return lines.join('\n');
    })
    .join('\n\n---\n\n');

  return `${header}\n\n${body}`;
}
