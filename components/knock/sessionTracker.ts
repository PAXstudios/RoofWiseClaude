// The one GPS watcher behind door knocking, and the route lifecycle around it.
//
// A module-level singleton rather than a hook inside the screen so the track
// keeps accruing while the roofer hops to a lead or the Plan tab mid-route —
// the watcher lives as long as a session is active OR the screen is
// mounted, and stops when neither holds (battery). It feeds three things on
// every fix: the live position the screen reads (`useLiveFix`), the session's
// walked-path polyline (`appendTrackPoint`), and the mileage trip running with
// the session (`recordSample`) — all through the same ≥10 m / ≤50 m accuracy
// gate in lib/services/knockTrip.ts so the three can never disagree.
//
// HONESTY: this is FOREGROUND tracking. iOS suspends the watcher when the app
// is backgrounded; true background location needs the native build
// (BACKLOG ⚡ STANDING TRIGGER). The end-of-route sheet says so in one line;
// nothing here pretends otherwise.

import { useSyncExternalStore } from 'react';
import * as Location from 'expo-location';
import type { KnockRouteTarget, KnockSession } from '@/lib/models/types';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { accumulateMiles, milesSince } from '@/lib/services/knockTrip';

export type LiveFix = {
  lat: number;
  lng: number;
  /** Horizontal accuracy in meters, when the platform reports one. */
  accuracy: number | null;
  heading: number | null;
  /** Native observation time; null means the platform did not supply one. */
  ts: number | null;
};

/**
 * Where location permission stands. `denied_forever` = the OS will not show
 * the prompt again; the only way back is Settings.
 */
export type LocationGate = 'unknown' | 'granted' | 'denied' | 'denied_forever' | 'unavailable';

/** What the mileage trip is filed as — matches the Mileage screen's own chip. */
export const KNOCK_TRIP_PURPOSE = 'Door knocking';

let subscription: Location.LocationSubscription | null = null;
let starting: Promise<boolean> | null = null;
let latest: LiveFix | null = null;
let gate: LocationGate = 'unknown';
let screenMounted = false;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** Ask for foreground location (once; never re-prompts a hard denial). */
export async function requestLocationAccess(): Promise<LocationGate> {
  try {
    let perm = await Location.getForegroundPermissionsAsync();
    if (perm.status !== 'granted' && perm.canAskAgain) {
      perm = await Location.requestForegroundPermissionsAsync();
    }
    gate =
      perm.status === 'granted' ? 'granted' : perm.canAskAgain === false ? 'denied_forever' : 'denied';
  } catch {
    gate = 'unavailable';
  }
  emit();
  return gate;
}

function onFix(loc: Location.LocationObject): void {
  const c = loc.coords;
  if (!Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return;
  latest = {
    lat: c.latitude,
    lng: c.longitude,
    accuracy: typeof c.accuracy === 'number' ? c.accuracy : null,
    heading: typeof c.heading === 'number' ? c.heading : null,
    // Receiving coordinates now does not prove they were observed now.
    ts: typeof loc.timestamp === 'number' ? loc.timestamp : null,
  };

  const ks = useKnockSessionStore.getState();
  const session = ks.activeSession;
  if (session) {
    const sample = { lat: latest.lat, lng: latest.lng, accuracy: latest.accuracy };
    ks.appendTrackPoint(sample);
    const ms = useMileageStore.getState();
    if (!session.mileageTripId && !ms.active) {
      // A session started before the first fix (or from the storm-alert
      // screen) gets its trip the moment the phone knows where it is.
      const trip = ms.start({ lat: sample.lat, lng: sample.lng, purpose: KNOCK_TRIP_PURPOSE });
      ks.setMileageTrip(trip.id, true);
    } else if (!session.mileageTripId && ms.active) {
      // A trip the roofer started by hand meanwhile is the same walk — ride
      // it, but leave it running when the route wraps.
      ks.setMileageTrip(ms.active.id, false);
      ms.recordSample(sample);
    } else if (ms.active && ms.active.id === session.mileageTripId) {
      ms.recordSample(sample);
    }
  }
  emit();
}

/**
 * Start the watcher (idempotent). Resolves true when fixes will arrive.
 * Foreground only — see the header note.
 */
export async function startWatching(): Promise<boolean> {
  if (subscription) return true;
  if (starting) return starting;
  starting = (async () => {
    const g = await requestLocationAccess();
    if (g !== 'granted') return false;
    try {
      const initial = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }).catch(
        () => null,
      );
      if (initial) onFix(initial);
      subscription = await Location.watchPositionAsync(
        // 5 m keeps the blue dot honest at walking pace; the stores apply
        // their own 10 m floor before anything counts as distance.
        { accuracy: Location.Accuracy.High, distanceInterval: 5, timeInterval: 3000 },
        onFix,
      );
      return true;
    } catch {
      gate = 'unavailable';
      emit();
      return false;
    }
  })().finally(() => {
    starting = null;
  });
  return starting;
}

/** Stop the watcher unless a route is still running or the screen is up. */
export function stopWatchingIfIdle(): void {
  if (screenMounted) return;
  if (useKnockSessionStore.getState().activeSession) return;
  subscription?.remove();
  subscription = null;
}

/** The door-knocking screen tells the tracker it is on screen. */
export function setScreenMounted(mounted: boolean): void {
  screenMounted = mounted;
  if (!mounted) stopWatchingIfIdle();
}

export function latestFix(): LiveFix | null {
  return latest;
}

/** The most recent fix; re-renders on every accepted fix. */
export function useLiveFix(): LiveFix | null {
  return useSyncExternalStore(subscribe, () => latest, () => latest);
}

export function useLocationGate(): LocationGate {
  return useSyncExternalStore(subscribe, () => gate, () => gate);
}

export type StartRouteOptions = {
  routeStormAlertId?: string;
  routeTarget?: KnockRouteTarget;
  routeStops?: KnockRouteTarget[];
};

export type StartRouteResult =
  | { ok: true; session: KnockSession }
  | { ok: false; gate: LocationGate };

/**
 * Start a route: permission → watcher → mileage trip → session. A trip the
 * roofer already started by hand (Mileage screen) is adopted rather than
 * replaced, and is left running when the route wraps.
 */
export async function startRoute(opts: StartRouteOptions = {}): Promise<StartRouteResult> {
  const ok = await startWatching();
  if (!ok) return { ok: false, gate };
  const ks = useKnockSessionStore.getState();
  if (ks.activeSession) return { ok: true, session: ks.activeSession };

  const ms = useMileageStore.getState();
  let mileageTripId: string | undefined;
  let owned = false;
  if (ms.active) {
    mileageTripId = ms.active.id;
  } else if (latest) {
    mileageTripId = ms.start({ lat: latest.lat, lng: latest.lng, purpose: KNOCK_TRIP_PURPOSE }).id;
    owned = true;
  }
  const session = ks.start(opts.routeStormAlertId, opts.routeTarget, {
    routeStops: opts.routeStops,
    mileageTripId,
    mileageTripOwned: owned,
  });
  if (latest) useKnockSessionStore.getState().appendTrackPoint(latest);
  return { ok: true, session };
}

/**
 * Miles on the route right now: the running trip's accumulator when the
 * session owns it, the trip's samples since the session began when it was
 * adopted, the session's own track otherwise.
 */
export function liveRouteMiles(session: KnockSession | null): number {
  if (!session) return 0;
  const ms = useMileageStore.getState();
  if (session.mileageTripId && ms.active?.id === session.mileageTripId) {
    if (session.mileageTripOwned) return ms.liveMiles();
    return milesSince(ms.active.samples, new Date(session.startedAt).getTime());
  }
  return accumulateMiles(session.track ?? []);
}

/**
 * Wrap the route: settle the miles, end the mileage trip the session owns,
 * archive the session, and let the watcher go if nothing else needs it.
 */
export function endRoute(): KnockSession | null {
  const ks = useKnockSessionStore.getState();
  const session = ks.activeSession;
  if (!session) return null;
  const ms = useMileageStore.getState();
  let miles: number | undefined;
  if (session.mileageTripId && ms.active?.id === session.mileageTripId) {
    if (session.mileageTripOwned) {
      const last = ms.active.samples[ms.active.samples.length - 1];
      const end = latest ?? last;
      const trip = end ? ms.stop({ lat: end.lat, lng: end.lng }) : null;
      miles = trip?.miles;
    } else {
      miles = milesSince(ms.active.samples, new Date(session.startedAt).getTime());
    }
  }
  if (miles === undefined) miles = accumulateMiles(session.track ?? []);
  const ended = ks.end({ miles });
  stopWatchingIfIdle();
  return ended;
}
