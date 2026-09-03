// Knock Planner runs — detached from the screen. Network I/O via knockFinder.
//
// The roofer taps Find and can walk away: the run reports into
// `useKnockFinderStore.activeRun` (any screen can show progress), saves a
// dated plan when it finishes, drops an in-app notification (the Home bell)
// and a local push, and records a Diagnostics entry when it fails so "it
// didn't work" comes with a reason. One run at a time; a second Find while
// one is running returns the same promise. Storm Watch starts runs too
// (`trigger: { kind: 'storm_alert' }`): one plan per alert, and a storm
// request that lands mid-run waits in a one-slot queue and starts next.
// The do-not-knock list is applied after the finder ranks (drop / discount,
// re-sort, re-plan — lib/services/doNotKnock.ts) so the finder stays pure.
//
// Honest limit: JavaScript keeps running while the app is on screen or
// briefly after it is backgrounded; iOS suspends it after that. A run that is
// interrupted resumes from the storm pull on the next Find (results are
// cached per address / cell, so the second pass is fast). True background
// execution needs the native build (BACKLOG ⚡ standing trigger).

import {
  KnockRunCancelledError,
  findKnockOpportunities,
  ownJobsFrom,
  pinnedLabel,
  type FinderMode,
  type FinderStep,
  type KnockFinderResult,
} from './knockFinder';
import { clampRadiusMiles, type BasePoint, type OwnActivity } from './knockOpportunities';
import { applyDoNotKnockExclusions } from './doNotKnock';
import { reverseGeocode } from './geocoding';
import { isGoogleMapsConfigured } from '../env';
import { planTitleFor, useKnockFinderStore, type KnockPlan } from '../stores/knockFinderStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useDoNotKnockStore } from '../stores/doNotKnockStore';
import { useKnockSessionStore } from '../stores/knockSessionStore';
import { useInspectionStore } from '../stores/inspectionStore';
import { useProposalStore } from '../stores/proposalStore';
import { useLeadStore } from '../stores/leadStore';
import { sendLocalNotification } from './pushNotifications';
import { recordError } from './diagnostics';
import { syncKnocksSoon } from './knockSync';

export type PlanRunOutcome =
  | { status: 'ok'; plan: KnockPlan }
  | { status: 'no_storms'; eventCount: number }
  /** `cancelled` is set when the roofer stopped the run (`cancelKnockPlan`) — not a failure. */
  | { status: 'unavailable'; reason: string; cancelled?: true };

/**
 * What kicked a run off. A Storm Watch trigger names the plan after the
 * storm, ties it to the alert (one plan per alert) and phrases the bell
 * around the storm rather than the base.
 */
export type PlanTrigger = {
  kind: 'storm_alert';
  alertId: string;
  /** ISO timestamp of the storm core report — "Jun 14" in the copy. */
  stormDay: string;
};

export type StartKnockPlanArgs = {
  /** Any point — a pin, an address, a service area. A missing label is reverse-geocoded once here. */
  base: BasePoint;
  own?: OwnActivity;
  trigger?: PlanTrigger;
  /** Explicit plan title; defaults to `planTitleFor(result)`. */
  title?: string;
  /** 'storm' (default) or 'neighbours' — the streets around the roofer's own jobs. */
  mode?: FinderMode;
  /** Search radius; defaults to the store's last choice. Clamped to 3–50 mi. */
  radiusMiles?: number;
};

let inFlight: Promise<PlanRunOutcome> | null = null;
let counter = 0;
/**
 * One-slot queue for a storm-triggered request that arrives while a run is
 * in flight: it starts the moment the current run ends. A newer storm
 * request replaces an older waiting one (the older resolves `unavailable`).
 */
let pending: { args: StartKnockPlanArgs; resolve: (o: PlanRunOutcome) => void } | null = null;

/**
 * The run in flight, as the cancel path sees it. `cancelled` flips once and
 * every later callback from that run (step, partial, save, bell) is dropped.
 */
type RunToken = { id: string; key: string; cancelled: boolean };
let current: RunToken | null = null;

const CANCELLED_OUTCOME: PlanRunOutcome = { status: 'unavailable', reason: 'Cancelled', cancelled: true };

export function isPlanRunning(): boolean {
  return inFlight != null;
}

/**
 * Stop the run in flight at the roofer's request (the Cancel button on the
 * planner screen). On screen it lands at once: the run leaves `activeRun`
 * and Find is live again. The finder itself stops at its next phase
 * boundary (`shouldStop`) and whatever it produces is discarded — nothing is
 * saved, no failure is recorded. The bell's "working" entry becomes a quiet,
 * already-read "Plan cancelled". A stale `activeRun` with no run behind it
 * is cleared the same way. Returns true when a run was actually running.
 */
export function cancelKnockPlan(): boolean {
  const token = current;
  const store = useKnockFinderStore.getState();
  const key = token?.key ?? (store.activeRun ? `plan_run_${store.activeRun.id}` : null);
  const wasRunning = inFlight != null;
  if (token) token.cancelled = true;
  current = null;
  inFlight = null;
  if (store.activeRun) store.endRun();
  if (key) {
    useNotificationStore.getState().push({
      kind: 'info',
      key,
      read: true,
      title: 'Plan cancelled',
      body: 'Stopped at your request — nothing was saved. Tap Find to start again.',
      href: '/knock-finder',
    });
  }
  // A storm request that queued behind the cancelled run starts now.
  const next = pending;
  pending = null;
  if (next) void startKnockPlan(next.args).then(next.resolve);
  return wasRunning;
}

/** The alert whose plan is waiting for the current run to finish, if any. */
export function pendingStormAlertId(): string | null {
  return pending?.args.trigger?.alertId ?? null;
}

/**
 * The roofer's footprint the way the finder scores it: every knock from every
 * session (recent ones lower an area) and every geocoded job (a yard sign).
 * The planner screen and Storm Watch both build `own` from this.
 */
export function ownActivityNow(): OwnActivity {
  const ks = useKnockSessionStore.getState();
  const sessions = [...(ks.activeSession ? [ks.activeSession] : []), ...ks.archive];
  return {
    knocks: sessions.flatMap((s) => s.knocks.map((k) => ({ lat: k.lat, lng: k.lng, at: k.createdAt }))),
    // Every geocoded job with `signed` resolved (a signed proposal, the
    // homeowner's signature, or the lead at/after Approved / Signed) —
    // neighbours mode leads with these.
    jobs: ownJobsFrom(useInspectionStore.getState().inspections, useProposalStore.getState().proposals, useLeadStore.getState().leads),
  };
}

/**
 * A base with no name (a dropped pin) gets one from the geocoder — once,
 * here, so titles and the bell read "Frisco, TX" rather than a coordinate
 * pair. Falls back to `pinnedLabel` when the geocoder has nothing.
 */
async function resolveBaseLabel(base: BasePoint): Promise<BasePoint> {
  if (base.label?.trim()) return base;
  if (isGoogleMapsConfigured) {
    try {
      const g = await reverseGeocode({ lat: base.lat, lng: base.lng });
      const city = g?.city;
      if (city) return { ...base, label: `${city}${g?.stateCode ? `, ${g.stateCode}` : ''}` };
      const street = g?.formattedAddress?.split(',')[0]?.trim();
      if (street) return { ...base, label: street };
    } catch {
      // fall through to the coordinate label
    }
  }
  return { ...base, label: pinnedLabel(base) };
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Jun 14 storm" — or just "storm" when the day does not parse. */
export function stormLabelFor(trigger: PlanTrigger | undefined): string {
  if (!trigger) return 'storm';
  const ms = Date.parse(trigger.stormDay);
  if (!Number.isFinite(ms)) return 'storm';
  const d = new Date(ms);
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} storm`;
}

export function startKnockPlan(args: StartKnockPlanArgs): Promise<PlanRunOutcome> {
  const trigger = args.trigger;
  const notify = useNotificationStore.getState().push;

  // One plan per alert: an alert that already has its plan (or is being
  // planned right now) never starts a second run.
  if (trigger) {
    const existing = useKnockFinderStore.getState().planForAlert(trigger.alertId);
    if (existing) return Promise.resolve({ status: 'ok', plan: existing });
    if (inFlight && useKnockFinderStore.getState().activeRun?.stormAlertId === trigger.alertId) return inFlight;
  }

  if (inFlight) {
    if (!trigger) return inFlight;
    return new Promise<PlanRunOutcome>((resolve) => {
      if (pending && pending.args.trigger?.alertId === trigger.alertId) {
        const prev = pending.resolve;
        pending.resolve = (o) => {
          prev(o);
          resolve(o);
        };
        return;
      }
      pending?.resolve({ status: 'unavailable', reason: 'Replaced by a newer storm plan request' });
      pending = { args, resolve };
      notify({
        kind: 'plan_queued',
        key: `plan_alert_${trigger.alertId}`,
        title: `Planning the ${stormLabelFor(trigger)}…`,
        body: `Waiting for the current plan to finish, then scoring the streets around ${args.base.label}.`,
        href: `/storm-alert/${trigger.alertId}`,
      });
    });
  }

  const store = useKnockFinderStore.getState();
  const runId = `run_${Date.now()}_${counter++}`;
  const key = trigger ? `plan_alert_${trigger.alertId}` : `plan_run_${runId}`;
  const stormLabel = stormLabelFor(trigger);
  const mode: FinderMode = args.mode ?? 'storm';
  const radiusMiles = clampRadiusMiles(args.radiusMiles ?? store.radiusMiles);
  const startedAt = new Date();
  const baseLabelNow = args.base.label?.trim() || pinnedLabel(args.base);
  const token: RunToken = { id: runId, key, cancelled: false };
  current = token;

  store.beginRun({
    id: runId,
    startedAt: startedAt.toISOString(),
    baseLabel: baseLabelNow,
    step: 'storms',
    radiusMiles,
    ...(trigger ? { stormAlertId: trigger.alertId } : null),
  });
  notify({
    kind: 'plan_queued',
    key,
    title: trigger ? `Planning the ${stormLabel}…` : 'Knock Planner is working',
    body:
      mode === 'neighbours'
        ? `Scoring the streets around your jobs within ${radiusMiles} mi of ${baseLabelNow}. You can leave this screen.`
        : `Scoring storm-hit streets within ${radiusMiles} mi of ${baseLabelNow}. You can leave this screen.`,
    href: trigger ? `/storm-alert/${trigger.alertId}` : '/knock-finder',
  });

  // The do-not-knock list as it stands when the run starts. Applied to every
  // partial so the live progress never shows an area the plan will drop.
  const dnkEntries = useDoNotKnockStore.getState().entries;
  const exclude = (r: KnockFinderResult) => applyDoNotKnockExclusions(r, dnkEntries);

  // Step timing feeds the "About 30 s left" estimate (knockRunEstimate.ts)
  // and the run history the next estimate learns from.
  const recordHistory = (ok: boolean) => {
    const run = useKnockFinderStore.getState().activeRun;
    const stepSeconds = { ...(run?.stepSeconds ?? {}) };
    if (run) {
      const stepStart = new Date(run.stepStartedAt ?? run.startedAt).getTime();
      if (!Number.isNaN(stepStart)) stepSeconds[run.step] = Math.round(Math.max(0, (Date.now() - stepStart) / 1000) * 10) / 10;
    }
    useKnockFinderStore.getState().recordRun({
      at: new Date().toISOString(),
      radiusMiles,
      stepSeconds,
      totalSeconds: Math.round((Date.now() - startedAt.getTime()) / 1000),
      ok,
    });
  };

  const run = (async (): Promise<PlanRunOutcome> => {
    try {
      const base = await resolveBaseLabel(args.base);
      if (token.cancelled) throw new KnockRunCancelledError();
      if (base.label !== baseLabelNow) useKnockFinderStore.getState().updateRun({ baseLabel: base.label });
      const outcome = await findKnockOpportunities({
        base,
        own: args.own,
        mode,
        radiusMiles,
        housingCache: {
          get: (k) => useKnockFinderStore.getState().cachedHousing(k),
          set: (k, p) => useKnockFinderStore.getState().cacheHousing(k, p),
        },
        shouldStop: () => token.cancelled,
        onStep: (step: FinderStep) => {
          if (!token.cancelled) useKnockFinderStore.getState().advanceRunStep(step);
        },
        onPartial: (partial: KnockFinderResult) => {
          if (!token.cancelled) useKnockFinderStore.getState().updateRun({ partial: exclude(partial).result });
        },
      });
      // Cancelled after the last phase boundary: the result is not the roofer's any more.
      if (token.cancelled) return CANCELLED_OUTCOME;
      recordHistory(outcome.status === 'ok');

      if (outcome.status === 'ok') {
        // Do-not-knock zones drop or discount areas after the finder ranks
        // them (the finder itself knows nothing about the list).
        const { result, exclusions } = exclude(outcome.result);
        // The plan is worth backing up the moment it exists (Settings → Backup
        // shows the last sync); the watcher would catch it too — this is the
        // belt to its braces.
        syncKnocksSoon('plan_saved');
        const plan = useKnockFinderStore.getState().savePlan(result, args.title ?? planTitleFor(result), {
          stormAlertId: trigger?.alertId,
          exclusions: exclusions.dropped.length + exclusions.discounted.length > 0 ? exclusions : undefined,
        });
        const top = plan.result.areas[0];
        const body = top
          ? `${plan.result.areas.length} areas · best: ${top.name ?? top.storm.town ?? 'area'} (Knock ${top.knockScore}) · expect ~${Math.round(plan.result.plan.expected)} claim-grade roofs`
          : `${plan.result.areas.length} areas ranked`;
        const readyTitle = trigger ? `Plan ready for the ${stormLabel}` : `Knock plan ready — ${plan.title}`;
        notify({ kind: 'plan_ready', key, title: readyTitle, body, href: `/knock-plan/${plan.id}` });
        void sendLocalNotification({
          title: trigger ? readyTitle : 'Your knock plan is ready',
          body,
          data: { kind: 'knock_plan', planId: plan.id },
        }).catch(() => {});
        return { status: 'ok', plan };
      }

      const failHref = trigger ? `/storm-alert/${trigger.alertId}` : '/knock-finder';
      if (outcome.status === 'no_storms') {
        notify({
          kind: 'plan_failed',
          key,
          title: trigger ? `No rankable streets for the ${stormLabel}` : 'No qualifying storms',
          body: `${outcome.eventCount} NWS reports within ${radiusMiles} mi of ${baseLabelNow} in 24 months — none landed in a rankable area. Try a wider radius.`,
          href: failHref,
        });
        return outcome;
      }

      notify({
        kind: 'plan_failed',
        key,
        title: trigger ? `Couldn't plan the ${stormLabel}` : 'Knock Planner could not finish',
        body: outcome.reason,
        href: failHref,
      });
      recordError(new Error(`Knock Planner unavailable: ${outcome.reason}`), { extraStack: 'knockPlanRunner · /knock-finder' });
      return outcome;
    } catch (e) {
      // Stopped on purpose — cancelKnockPlan already cleared the run and
      // wrote the quiet bell entry; nothing here is a failure.
      if (token.cancelled || e instanceof KnockRunCancelledError) return CANCELLED_OUTCOME;
      const reason = e instanceof Error ? e.message : 'Unknown error';
      recordHistory(false);
      notify({
        kind: 'plan_failed',
        key,
        title: trigger ? `Couldn't plan the ${stormLabel}` : 'Knock Planner hit an error',
        body: reason,
        href: trigger ? `/storm-alert/${trigger.alertId}` : '/knock-finder',
      });
      recordError(e instanceof Error ? e : new Error(reason), { extraStack: 'knockPlanRunner · /knock-finder' });
      return { status: 'unavailable', reason };
    } finally {
      // A cancelled run was already torn down by cancelKnockPlan — and a
      // newer run may own `activeRun` / `inFlight` / `pending` by now.
      if (!token.cancelled) {
        useKnockFinderStore.getState().endRun();
        inFlight = null;
        if (current === token) current = null;
        // A storm request that queued behind this run starts now.
        const next = pending;
        pending = null;
        if (next) void startKnockPlan(next.args).then(next.resolve);
      }
    }
  })();

  inFlight = run;
  return run;
}
