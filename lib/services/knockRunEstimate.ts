// "About 30 s left" — the Knock Planner's estimated time. Pure: no I/O, no
// clock reads; the caller passes `now`.
//
// Every run records how long each step took (knockFinderStore.runHistory,
// last 10). The estimate for a step is the median of that history, scaled
// to the radius in hand — the storm pull and cell scoring grow with the
// area of the circle, the housing step with the number of areas enriched
// (capped at 6), naming is flat, the brief is bounded by its 20 s timeout.
// With no history the defaults below apply and the answer says so
// (`basis: 'default'`), so the first run's number is labelled a guess.

import type { FinderStep } from './knockFinder';

export const FINDER_STEP_ORDER: readonly FinderStep[] = ['storms', 'scoring', 'housing', 'naming', 'brief'];

/** Seconds per step with no history, measured on the first device runs. */
export const DEFAULT_STEP_SECONDS: Record<FinderStep, number> = {
  storms: 4,
  scoring: 1,
  housing: 3,
  naming: 2,
  brief: 8,
};

/** The radius the defaults and the history are normalised to. */
export const REFERENCE_RADIUS_MILES = 25;
/** The brief's own timeout in the finder — an estimate never promises more than this. */
export const BRIEF_CAP_SECONDS = 20;
/** Housing enriches at most this many areas (knockFinder.ts ENRICH). */
export const HOUSING_AREAS_CAP = 6;

export type RunHistoryEntry = {
  at: string;
  radiusMiles: number;
  stepSeconds: Partial<Record<FinderStep, number>>;
  totalSeconds: number;
  ok: boolean;
};

export type RunProgress = {
  step: FinderStep;
  /** ISO — when the run started. */
  startedAt: string;
  /** ISO — when the current step started. */
  stepStartedAt?: string;
  /** Seconds each finished step took, so far. */
  stepSeconds?: Partial<Record<FinderStep, number>>;
};

export type RunEstimate = {
  /** Seconds left, best guess. */
  seconds: number;
  low: number;
  high: number;
  basis: 'history' | 'default';
  /** Seconds the whole run should take at this radius. */
  totalSeconds: number;
};

function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** How a step's time scales from one radius to another. */
function scaleFor(step: FinderStep, fromRadius: number, toRadius: number, areas: number): number {
  const from = Math.max(1, fromRadius);
  const to = Math.max(1, toRadius);
  switch (step) {
    case 'storms':
    case 'scoring':
      return (to / from) ** 2;
    case 'housing':
      return Math.min(HOUSING_AREAS_CAP, Math.max(1, areas)) / HOUSING_AREAS_CAP;
    case 'naming':
    case 'brief':
      return 1;
  }
}

/**
 * Typical seconds per step for a run at `radiusMiles`. History wins when
 * there is any successful run to learn from; each entry is normalised to the
 * reference radius before the median so a 50-mi run and a 10-mi run agree.
 */
export function typicalStepSeconds(
  history: readonly RunHistoryEntry[],
  radiusMiles: number,
  areas = HOUSING_AREAS_CAP,
): { seconds: Record<FinderStep, number>; basis: 'history' | 'default' } {
  const seconds = {} as Record<FinderStep, number>;
  let fromHistory = 0;
  for (const step of FINDER_STEP_ORDER) {
    const samples = history
      .filter((h) => h.ok && typeof h.stepSeconds[step] === 'number' && (h.stepSeconds[step] as number) >= 0)
      .map((h) => (h.stepSeconds[step] as number) / scaleFor(step, REFERENCE_RADIUS_MILES, h.radiusMiles, HOUSING_AREAS_CAP));
    const m = median(samples);
    const atRef = m ?? DEFAULT_STEP_SECONDS[step];
    if (m != null) fromHistory += 1;
    let s = atRef * scaleFor(step, REFERENCE_RADIUS_MILES, radiusMiles, areas);
    if (step === 'brief') s = Math.min(BRIEF_CAP_SECONDS, s);
    seconds[step] = Math.max(0.5, s);
  }
  return { seconds, basis: fromHistory > 0 ? 'history' : 'default' };
}

/**
 * Seconds left in a run: the remainder of the current step (typical minus
 * elapsed, never below a quarter of typical — a slow step is not "done") plus
 * every step still to come. `low`/`high` bracket it at ×0.6 / ×1.8 for
 * history-based estimates and ×0.5 / ×2.5 for defaults.
 */
export function estimateRemainingSeconds(
  run: RunProgress,
  history: readonly RunHistoryEntry[],
  radiusMiles: number,
  now: Date,
  areas = HOUSING_AREAS_CAP,
): RunEstimate {
  const { seconds, basis } = typicalStepSeconds(history, radiusMiles, areas);
  const idx = Math.max(0, FINDER_STEP_ORDER.indexOf(run.step));
  const stepStart = new Date(run.stepStartedAt ?? run.startedAt).getTime();
  const elapsedInStep = Number.isNaN(stepStart) ? 0 : Math.max(0, (now.getTime() - stepStart) / 1000);
  const current = seconds[run.step];
  let remaining = Math.max(current * 0.25, current - elapsedInStep);
  for (let i = idx + 1; i < FINDER_STEP_ORDER.length; i += 1) remaining += seconds[FINDER_STEP_ORDER[i]];
  const total = FINDER_STEP_ORDER.reduce((t, s) => t + seconds[s], 0);
  const [lo, hi] = basis === 'history' ? [0.6, 1.8] : [0.5, 2.5];
  return {
    seconds: Math.round(remaining),
    low: Math.round(remaining * lo),
    high: Math.round(remaining * hi),
    basis,
    totalSeconds: Math.round(total),
  };
}

/** "About 30 s left" / "About 2 min left" / "Almost done". */
export function remainingLabel(est: RunEstimate): string {
  const s = est.seconds;
  if (s <= 3) return 'Almost done';
  if (s < 60) return `About ${Math.max(5, Math.round(s / 5) * 5)} s left`;
  const m = Math.round(s / 60);
  return `About ${m} min left`;
}
