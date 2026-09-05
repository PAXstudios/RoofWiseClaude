import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {
  Knock,
  KnockOutcome,
  KnockSession,
  KnockRouteTarget,
  KnockTrackPoint,
} from '../models/types';
import { acceptSample, nearestKnock, thinTrack } from '../services/knockTrip';

let counter = 0;

function newId(prefix: string): string {
  return `${prefix}_${Date.now()}_${counter++}`;
}

/** The session polyline is bounded here; the raw fixes live on the mileage trip. */
const MAX_TRACK_POINTS = 500;

export type LogKnockInput = {
  lat: number;
  lng: number;
  address?: string;
  outcome: KnockOutcome;
  notes?: string;
  followUpAt?: string;
  createdLeadId?: string;
  contactName?: string;
  contactPhone?: string;
  propertyRecord?: Knock['propertyRecord'];
  damageNoted?: boolean;
  comeBackWhen?: Knock['comeBackWhen'];
  placedBy?: Knock['placedBy'];
  /** Seed history (a "knock again" on a house from an earlier session). */
  history?: Knock['history'];
};

/** Everything on a knock the roofer can change after the fact. */
export type KnockPatch = Partial<
  Pick<
    Knock,
    | 'address'
    | 'outcome'
    | 'notes'
    | 'followUpAt'
    | 'createdLeadId'
    | 'contactName'
    | 'contactPhone'
    | 'propertyRecord'
    | 'damageNoted'
    | 'comeBackWhen'
    | 'lat'
    | 'lng'
  >
>;

type KnockSessionState = {
  activeSession: KnockSession | null;
  archive: KnockSession[];

  /**
   * Start a session. The first two arguments are the original signature
   * (storm alert screen + knock finder call them); `opts` carries the
   * multi-stop plan and the mileage trip the session runs with.
   */
  start: (
    routeStormAlertId?: string,
    routeTarget?: KnockRouteTarget,
    opts?: { routeStops?: KnockRouteTarget[]; mileageTripId?: string; mileageTripOwned?: boolean },
  ) => KnockSession;
  /** Visit this area now, keeping the previous current and pending stops next. */
  setRouteTarget: (target: KnockRouteTarget) => void;
  /**
   * Replace the multi-stop route. The knock planner's "Start this day" calls
   * this; the first stop also becomes `routeTarget` so single-target readers
   * keep working.
   */
  setRouteStops: (stops: KnockRouteTarget[], startIndex?: number) => void;
  /** Move to the next stop (clamped at the last). Returns the new stop or null. */
  advanceStop: () => KnockRouteTarget | null;
  setCurrentStop: (index: number) => void;
  /** Record which mileage trip is running with this session. */
  setMileageTrip: (tripId: string | undefined, owned: boolean) => void;
  /**
   * Append a GPS fix to the session polyline. Same acceptance gate as the
   * mileage trip (≥10 m, accuracy ≤50 m); thinned past 500 points.
   */
  appendTrackPoint: (p: { lat: number; lng: number; accuracy?: number | null }) => void;
  /** Close the session. `miles` is the figure the mileage trip settled on. */
  end: (summary?: { miles?: number }) => KnockSession | null;
  logKnock: (input: LogKnockInput) => Knock | null;
  /**
   * Edit a knock in the active session. A changed outcome pushes the old one
   * into `history` (with the notes it was saved with), so a second visit never
   * erases the first.
   */
  updateKnock: (id: string, patch: KnockPatch) => Knock | null;
  removeKnock: (id: string) => void;
  /** The active session's knock at (or within ~15 m of) a point, if any. */
  knockNear: (lat: number, lng: number, maxMeters?: number) => Knock | null;
};

export const useKnockSessionStore = create<KnockSessionState>()(
  persist(
    (set, get) => ({
      activeSession: null,
      archive: [],

      start: (routeStormAlertId, routeTarget, opts) => {
        const stops = opts?.routeStops && opts.routeStops.length > 0 ? opts.routeStops : undefined;
        const session: KnockSession = {
          id: newId('ks'),
          startedAt: new Date().toISOString(),
          routeStormAlertId,
          routeTarget: routeTarget ?? stops?.[0],
          knocks: [],
          routeStops: stops,
          currentStopIndex: stops ? 0 : undefined,
          mileageTripId: opts?.mileageTripId,
          mileageTripOwned: opts?.mileageTripId ? (opts.mileageTripOwned ?? true) : undefined,
          track: [],
        };
        set({ activeSession: session });
        return session;
      },

      setRouteTarget: (target) =>
        set((s) => {
          const active = s.activeSession;
          if (!active) return s;
          const stops = [...(active.routeStops?.length ? active.routeStops : active.routeTarget ? [active.routeTarget] : [])];
          let index = Math.min(Math.max(0, active.currentStopIndex ?? 0), Math.max(0, stops.length - 1));
          const found = stops.findIndex((stop) => stop.lat === target.lat && stop.lng === target.lng && stop.radiusMiles === target.radiusMiles);
          let next = target;
          if (found >= 0) {
            // Re-select a saved stop without adding a duplicate or losing its
            // provenance. Removing an earlier stop shifts the insertion slot.
            next = { ...stops[found], ...target };
            stops.splice(found, 1);
            if (found < index) index -= 1;
          }
          stops.splice(index, 0, next);
          return {
            activeSession: {
              ...active,
              routeStops: stops,
              currentStopIndex: index,
              routeTarget: next,
              routeStormAlertId: next.stormAlertId ?? active.routeStormAlertId,
            },
          };
        }),

      setRouteStops: (stops, startIndex = 0) =>
        set((s) => {
          if (!s.activeSession) return s;
          if (stops.length === 0) {
            return {
              activeSession: { ...s.activeSession, routeStops: undefined, currentStopIndex: undefined },
            };
          }
          const idx = Math.min(Math.max(0, startIndex), stops.length - 1);
          return {
            activeSession: {
              ...s.activeSession,
              routeStops: stops,
              currentStopIndex: idx,
              routeTarget: stops[idx],
              routeStormAlertId: stops[idx].stormAlertId ?? s.activeSession.routeStormAlertId,
            },
          };
        }),

      advanceStop: () => {
        const active = get().activeSession;
        const stops = active?.routeStops;
        if (!active || !stops || stops.length === 0) return null;
        const next = Math.min((active.currentStopIndex ?? 0) + 1, stops.length - 1);
        set({
          activeSession: { ...active, currentStopIndex: next, routeTarget: stops[next] },
        });
        return stops[next];
      },

      setCurrentStop: (index) =>
        set((s) => {
          const stops = s.activeSession?.routeStops;
          if (!s.activeSession || !stops || stops.length === 0) return s;
          const idx = Math.min(Math.max(0, index), stops.length - 1);
          return { activeSession: { ...s.activeSession, currentStopIndex: idx, routeTarget: stops[idx] } };
        }),

      setMileageTrip: (tripId, owned) =>
        set((s) =>
          s.activeSession
            ? { activeSession: { ...s.activeSession, mileageTripId: tripId, mileageTripOwned: tripId ? owned : undefined } }
            : s,
        ),

      appendTrackPoint: (p) => {
        const active = get().activeSession;
        if (!active) return;
        const track = active.track ?? [];
        const last = track[track.length - 1];
        if (!acceptSample(last, p)) return;
        let next: KnockTrackPoint[] = [...track, { lat: p.lat, lng: p.lng, ts: Date.now() }];
        if (next.length > MAX_TRACK_POINTS) next = thinTrack(next, MAX_TRACK_POINTS);
        set({ activeSession: { ...active, track: next } });
      },

      end: (summary) => {
        const active = get().activeSession;
        if (!active) return null;
        const ended: KnockSession = {
          ...active,
          endedAt: new Date().toISOString(),
          miles: summary?.miles ?? active.miles,
        };
        set((s) => ({
          activeSession: null,
          archive: [ended, ...s.archive].slice(0, 100),
        }));
        return ended;
      },

      logKnock: (input) => {
        const active = get().activeSession;
        if (!active) return null;
        const now = new Date().toISOString();
        const knock: Knock = {
          id: newId('kn'),
          sessionId: active.id,
          lat: input.lat,
          lng: input.lng,
          address: input.address,
          outcome: input.outcome,
          notes: input.notes,
          followUpAt: input.followUpAt,
          createdLeadId: input.createdLeadId,
          createdAt: now,
          contactName: input.contactName,
          contactPhone: input.contactPhone,
          propertyRecord: input.propertyRecord,
          damageNoted: input.damageNoted,
          comeBackWhen: input.comeBackWhen,
          placedBy: input.placedBy,
          history: input.history && input.history.length > 0 ? input.history : undefined,
        };
        set({
          activeSession: { ...active, knocks: [...active.knocks, knock] },
        });
        return knock;
      },

      updateKnock: (id, patch) => {
        const active = get().activeSession;
        if (!active) return null;
        const current = active.knocks.find((k) => k.id === id);
        if (!current) return null;
        const now = new Date().toISOString();
        const outcomeChanged = patch.outcome !== undefined && patch.outcome !== current.outcome;
        const history = outcomeChanged
          ? [
              ...(current.history ?? []),
              { outcome: current.outcome, at: current.updatedAt ?? current.createdAt, notes: current.notes },
            ]
          : current.history;
        const next: Knock = { ...current, ...patch, history, updatedAt: now };
        set({
          activeSession: { ...active, knocks: active.knocks.map((k) => (k.id === id ? next : k)) },
        });
        return next;
      },

      removeKnock: (id) =>
        set((s) =>
          s.activeSession
            ? { activeSession: { ...s.activeSession, knocks: s.activeSession.knocks.filter((k) => k.id !== id) } }
            : s,
        ),

      knockNear: (lat, lng, maxMeters) => {
        const active = get().activeSession;
        if (!active) return null;
        return nearestKnock(active.knocks, { lat, lng }, maxMeters)?.knock ?? null;
      },
    }),
    {
      name: 'roofwise.knockSessions.v1',
      storage: createJSONStorage(() => AsyncStorage),
      partialize: (s) => ({ activeSession: s.activeSession, archive: s.archive }),
    },
  ),
);
