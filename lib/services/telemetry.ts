// Speed instrumentation — LOCAL ONLY.
//
// docs/PRODUCT_SYNTHESIS.md §"Workflow & speed contracts" publishes two
// commitments we have to be able to prove:
//   • analysis pipeline P50 ≤ 60s, P95 ≤ 180s (four squares),
//   • report generation < 60s ("minutes, not hours", "<1 min report").
// §11 of the priority list says the KPIs need data from day one. This module
// is that data.
//
// DELIBERATELY NOT A NETWORK ANALYTICS SDK:
//   • privacy — a roofer's job timings are their business, not ours, and
//     nothing here leaves the device;
//   • Drift #5 — no synthesized numbers. A metric with no samples reports
//     null, never a placeholder;
//   • offline-first — a roof with no signal must still record timings.
// Everything lives in AsyncStorage under ONE key, capped, and is readable
// from a settings/diagnostics screen.
//
// Recording never throws into the caller: a telemetry failure must never fail
// an analysis pass or a report.

import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'roofwise.telemetry.speed.v1';

/** Keep the most recent N samples per metric — bounded storage, recent truth. */
const MAX_SAMPLES = 100;

/** The two instrumented pipelines. Free-form names are allowed via mark/measure. */
export const SPEED_METRIC = {
  /** One full analyzeSlope pass, wall clock, however many photos it covered. */
  analysis: 'analysis',
  /** Report HTML render → PDF written to disk. */
  report: 'report',
} as const;

export type SpeedSample = {
  /** Duration in milliseconds. */
  ms: number;
  /** ISO timestamp the sample was recorded. */
  at: string;
  /** Optional sample size — photo count for an analysis pass. */
  n?: number;
};

type SpeedStore = Record<string, SpeedSample[]>;

/**
 * Published targets, in milliseconds, for comparison in a diagnostics view.
 * These are commitments to measure against — they never gate behavior.
 * The report commitment is a flat "<60s", so both percentiles carry it.
 */
export const SPEED_TARGETS: Record<string, { p50Ms: number; p95Ms: number }> = {
  [SPEED_METRIC.analysis]: { p50Ms: 60_000, p95Ms: 180_000 },
  [SPEED_METRIC.report]: { p50Ms: 60_000, p95Ms: 60_000 },
};

// -----------------------------------------------------------------------------
// In-flight marks
// -----------------------------------------------------------------------------

const marks = new Map<string, number>();

/** Start (or restart) a timer under `name`. */
export function mark(name: string): void {
  marks.set(name, Date.now());
}

/**
 * Close the timer opened by `mark(name)`, persist the duration under
 * `metric` (defaults to `name`), and return the elapsed milliseconds.
 * Returns null when no matching mark is open — never guesses a duration.
 */
export function measure(
  name: string,
  opts: { metric?: string; n?: number } = {},
): number | null {
  const startedAt = marks.get(name);
  if (startedAt == null) return null;
  marks.delete(name);
  const ms = Date.now() - startedAt;
  void record(opts.metric ?? name, ms, opts.n);
  return ms;
}

/** Drop an open mark without recording it (aborted pass, thrown error). */
export function clearMark(name: string): void {
  marks.delete(name);
}

// -----------------------------------------------------------------------------
// Persistence
// -----------------------------------------------------------------------------

// Writes are chained so two pipelines finishing at once cannot clobber each
// other's samples through a read-modify-write race.
let writeQueue: Promise<void> = Promise.resolve();

async function readStore(): Promise<SpeedStore> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    const out: SpeedStore = {};
    for (const [metric, samples] of Object.entries(parsed as Record<string, unknown>)) {
      if (!Array.isArray(samples)) continue;
      out[metric] = samples.filter(
        (s): s is SpeedSample =>
          !!s && typeof s === 'object' && typeof (s as SpeedSample).ms === 'number',
      );
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist one duration sample. Safe to `void` — it never rejects. */
export function record(metric: string, ms: number, n?: number): Promise<void> {
  if (!Number.isFinite(ms) || ms < 0) return Promise.resolve();
  writeQueue = writeQueue
    .then(async () => {
      const store = await readStore();
      const sample: SpeedSample = { ms: Math.round(ms), at: new Date().toISOString() };
      if (typeof n === 'number' && Number.isFinite(n)) sample.n = n;
      const next = [...(store[metric] ?? []), sample].slice(-MAX_SAMPLES);
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ ...store, [metric]: next }));
    })
    .catch(() => {
      // Telemetry is best-effort: never surface a storage failure to the
      // pipeline that produced the sample.
    });
  return writeQueue;
}

/** One completed analysis pass over `photoCount` photos. */
export function recordAnalysisMs(photoCount: number, ms: number): Promise<void> {
  return record(SPEED_METRIC.analysis, ms, photoCount);
}

/** One completed report generation (HTML render → PDF on disk). */
export function recordReportMs(ms: number): Promise<void> {
  return record(SPEED_METRIC.report, ms);
}

/** Wipe all locally recorded timings. */
export async function clearSpeedStats(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to surface — the stats are diagnostic only.
  }
}

// -----------------------------------------------------------------------------
// Stats
// -----------------------------------------------------------------------------

export type SpeedStat = {
  metric: string;
  /** Number of samples recorded (capped at MAX_SAMPLES). */
  count: number;
  /** Nearest-rank P50, milliseconds. Null when there are no samples. */
  p50Ms: number | null;
  /** Nearest-rank P95, milliseconds. Null when there are no samples. */
  p95Ms: number | null;
  /** Most recent sample, milliseconds. Null when there are no samples. */
  lastMs: number | null;
  /** Published target for this metric, when one exists. */
  target: { p50Ms: number; p95Ms: number } | null;
  /**
   * True when both percentiles sit at or under the published target, false
   * when either misses, null when there is no target or no data — an unproven
   * commitment is reported as unproven, never as met.
   */
  meetsTarget: boolean | null;
};

/** Nearest-rank percentile over an ascending array. */
function percentile(sortedMs: number[], p: number): number | null {
  if (sortedMs.length === 0) return null;
  const rank = Math.ceil((p / 100) * sortedMs.length);
  return sortedMs[Math.min(sortedMs.length - 1, Math.max(0, rank - 1))];
}

/**
 * P50/P95 per recorded metric, plus how each compares to its published
 * target. Metrics with no samples are omitted — an empty result means
 * "nothing measured yet", which callers must say out loud rather than
 * rendering zeros.
 */
export async function getSpeedStats(): Promise<SpeedStat[]> {
  const store = await readStore();
  return Object.entries(store)
    .map(([metric, samples]) => {
      const ms = samples.map((s) => s.ms).sort((a, b) => a - b);
      const p50Ms = percentile(ms, 50);
      const p95Ms = percentile(ms, 95);
      const target = SPEED_TARGETS[metric] ?? null;
      return {
        metric,
        count: samples.length,
        p50Ms,
        p95Ms,
        lastMs: samples.length > 0 ? samples[samples.length - 1].ms : null,
        target,
        meetsTarget:
          target && p50Ms !== null && p95Ms !== null
            ? p50Ms <= target.p50Ms && p95Ms <= target.p95Ms
            : null,
      };
    })
    .filter((s) => s.count > 0)
    .sort((a, b) => a.metric.localeCompare(b.metric));
}

/** Raw samples for one metric, oldest first — for a diagnostics list. */
export async function getSpeedSamples(metric: string): Promise<SpeedSample[]> {
  const store = await readStore();
  return store[metric] ?? [];
}
