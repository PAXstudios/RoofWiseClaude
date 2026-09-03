// Knock Planner runs — detached from the screen. Network I/O via knockFinder.
//
// The roofer taps Find and can walk away: the run reports into
// `useKnockFinderStore.activeRun` (any screen can show progress), saves a
// dated plan when it finishes, drops an in-app notification (the Home bell)
// and a local push, and records a Diagnostics entry when it fails so "it
// didn't work" comes with a reason. One run at a time; a second Find while
// one is running returns the same promise.
//
// Honest limit: JavaScript keeps running while the app is on screen or
// briefly after it is backgrounded; iOS suspends it after that. A run that is
// interrupted resumes from the storm pull on the next Find (results are
// cached per address / cell, so the second pass is fast). True background
// execution needs the native build (BACKLOG ⚡ standing trigger).

import { findKnockOpportunities, type FinderStep, type KnockFinderResult } from './knockFinder';
import type { BasePoint, OwnActivity } from './knockOpportunities';
import { planTitleFor, useKnockFinderStore, type KnockPlan } from '../stores/knockFinderStore';
import { useNotificationStore } from '../stores/notificationStore';
import { sendLocalNotification } from './pushNotifications';
import { recordError } from './diagnostics';

export type PlanRunOutcome =
  | { status: 'ok'; plan: KnockPlan }
  | { status: 'no_storms'; eventCount: number }
  | { status: 'unavailable'; reason: string };

let inFlight: Promise<PlanRunOutcome> | null = null;
let counter = 0;

export function isPlanRunning(): boolean {
  return inFlight != null;
}

export function startKnockPlan(args: { base: BasePoint; own?: OwnActivity }): Promise<PlanRunOutcome> {
  if (inFlight) return inFlight;
  const store = useKnockFinderStore.getState();
  const notify = useNotificationStore.getState().push;
  const runId = `run_${Date.now()}_${counter++}`;
  const key = `plan_run_${runId}`;

  store.beginRun({ id: runId, startedAt: new Date().toISOString(), baseLabel: args.base.label, step: 'storms' });
  notify({
    kind: 'plan_queued',
    key,
    title: 'Knock Planner is working',
    body: `Scoring storm-hit streets within 100 mi of ${args.base.label}. You can leave this screen.`,
    href: '/knock-finder',
  });

  const run = (async (): Promise<PlanRunOutcome> => {
    try {
      const outcome = await findKnockOpportunities({
        base: args.base,
        own: args.own,
        housingCache: {
          get: (k) => useKnockFinderStore.getState().cachedHousing(k),
          set: (k, p) => useKnockFinderStore.getState().cacheHousing(k, p),
        },
        onStep: (step: FinderStep) => useKnockFinderStore.getState().updateRun({ step }),
        onPartial: (partial: KnockFinderResult) => useKnockFinderStore.getState().updateRun({ partial }),
      });

      if (outcome.status === 'ok') {
        const plan = useKnockFinderStore.getState().savePlan(outcome.result, planTitleFor(outcome.result));
        const top = plan.result.areas[0];
        const body = top
          ? `${plan.result.areas.length} areas · best: ${top.name ?? top.storm.town ?? 'area'} (Knock ${top.knockScore}) · expect ~${Math.round(plan.result.plan.expected)} claim-grade roofs`
          : `${plan.result.areas.length} areas ranked`;
        notify({ kind: 'plan_ready', key, title: `Knock plan ready — ${plan.title}`, body, href: `/knock-plan/${plan.id}` });
        void sendLocalNotification({
          title: 'Your knock plan is ready',
          body,
          data: { kind: 'knock_plan', planId: plan.id },
        }).catch(() => {});
        return { status: 'ok', plan };
      }

      if (outcome.status === 'no_storms') {
        notify({
          kind: 'plan_failed',
          key,
          title: 'No qualifying storms',
          body: `${outcome.eventCount} NWS reports within 100 mi of ${args.base.label} in 24 months — none landed in a rankable area.`,
          href: '/knock-finder',
        });
        return outcome;
      }

      notify({ kind: 'plan_failed', key, title: 'Knock Planner could not finish', body: outcome.reason, href: '/knock-finder' });
      recordError(new Error(`Knock Planner unavailable: ${outcome.reason}`), { extraStack: 'knockPlanRunner · /knock-finder' });
      return outcome;
    } catch (e) {
      const reason = e instanceof Error ? e.message : 'Unknown error';
      notify({ kind: 'plan_failed', key, title: 'Knock Planner hit an error', body: reason, href: '/knock-finder' });
      recordError(e instanceof Error ? e : new Error(reason), { extraStack: 'knockPlanRunner · /knock-finder' });
      return { status: 'unavailable', reason };
    } finally {
      useKnockFinderStore.getState().endRun();
      inFlight = null;
    }
  })();

  inFlight = run;
  return run;
}
