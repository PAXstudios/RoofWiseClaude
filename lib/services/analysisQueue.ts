// Drains the persisted analysis queue while the app is in the foreground.
// Expo Go can't run JS while backgrounded, so this is the honest version of
// "run in background": jobs survive app restarts and resume the moment the
// app is open again. Each completion fires a local notification.
//
// FAILURE CONTRACT (spec §1): a job never sits in "queued" forever with no
// explanation. A job that cannot run (no API key) or whose every photo failed
// is marked `failed` with the real reason in the notification, and each photo
// carries its own `failed` state + reason on the slope (written by
// analyzeSlope / markPhotosFailed) so the capture strip shows
// "Failed · Retry". Retries happen only for failures a retry can fix.

import { useAnalysisQueueStore, type AnalysisJob } from '../stores/analysisQueueStore';
import { useNotificationStore } from '../stores/notificationStore';
import { useActivityStore } from '../stores/activityStore';
import type { Inspection } from '../models/types';
import {
  analyzeSlope,
  markPhotosFailed,
  markPhotosQueued,
  type SlopeAnalysisResult,
} from './analyzeSlope';
import { sendLocalNotification } from './pushNotifications';
import { describeAnalysisError, isRetryableGeminiError, GeminiAnalysisError } from './gemini';
import { isGeminiConfigured } from '../env';
import { mark, measure, clearMark } from './telemetry';

const MAX_ATTEMPTS = 2;
const RETRY_BACKOFF_MS = 3000;

/** Telemetry metric: one queue job, enqueue-to-finish wall clock. */
export const QUEUE_JOB_METRIC = 'analysis_queue_job';

const NOT_CONFIGURED_REASON =
  'AI not connected — add EXPO_PUBLIC_GEMINI_API_KEY to .env.local, then queue again.';

/** Raised when a pass produced no analyzed photo at all — the job as a whole
 *  failed, and the first photo's reason is the job's reason. */
class QueueJobError extends Error {
  constructor(message: string, public retryable: boolean) {
    super(message);
    this.name = 'QueueJobError';
  }
}

let draining = false;

// ── Module-level background pump ───────────────────────────────────────────
// The drain must run whenever queued jobs exist, NOT only while a particular
// screen (/analyze) is mounted. Three things kick it:
//   1. app boot + every foreground transition — lib/services/lifecycleHooks.ts
//      calls drainAnalysisQueue() on AppState 'active'.
//   2. enqueue — the store subscription below wakes the drain the instant a
//      job is added, from anywhere, with no screen involved.
//   3. a manual "run now" tap (Analyze screen / retry).
// `drainAnalysisQueue` is re-entrancy-guarded (`draining`) and re-reads the
// store each loop iteration, so kicking it redundantly is always a safe no-op.
let pumpStarted = false;

/** Wire the store→drain pump exactly once. Idempotent; safe to call from
 *  several import sites. */
export function startAnalysisQueuePump(): void {
  if (pumpStarted) return;
  pumpStarted = true;
  useAnalysisQueueStore.subscribe((state) => {
    if (state.jobs.some((j) => j.status === 'queued')) {
      void drainAnalysisQueue().catch(() => {});
    }
  });
}

// Self-install on first import. analysisQueue is imported at app boot
// (lifecycleHooks) and by the queue chip, so the pump is live before any job
// can be enqueued.
startAnalysisQueuePump();

/**
 * Enqueue a slope for background analysis and wake the pump. Returns false when
 * the slope already has a queued/running job (dedup). Photos land in the same
 * per-photo Queued/Analyzing/Done/Failed states the capture strip and Analyze
 * screen read, so the Processing view reflects the work immediately.
 */
export function queueSlopeAnalysis(input: {
  inspectionId: string;
  slopeId: string;
  slopeLabel: string;
}): boolean {
  const job = useAnalysisQueueStore.getState().enqueue(input);
  void drainAnalysisQueue().catch(() => {});
  return !!job;
}

export async function drainAnalysisQueue(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    // Fresh read each loop iteration — jobs can be enqueued mid-drain.
    for (;;) {
      const store = useAnalysisQueueStore.getState();
      const job = store.nextQueued();
      if (!job) break;

      if (!isGeminiConfigured) {
        // Never a silent, permanent "queued": fail the job and every photo it
        // covers with the reason, so the roofer sees WHY and can re-queue
        // once the key is in place.
        store.setStatus(job.id, 'failed');
        markPhotosFailed(job.inspectionId, job.slopeId, NOT_CONFIGURED_REASON);
        useNotificationStore.getState().push({ kind: 'analysis_failed', key: `analysis_${job.id}`, title: `Analysis not run · ${job.slopeLabel}`, body: NOT_CONFIGURED_REASON, href: `/job/${job.inspectionId}` });
        notifyFailure(job, NOT_CONFIGURED_REASON);
        continue;
      }

      store.setStatus(job.id, 'running');
      store.bumpAttempts(job.id);
      markPhotosQueued(job.inspectionId, job.slopeId);
      const jobMark = `analysis.queue.${job.id}`;
      mark(jobMark);

      try {
        const result = await analyzeSlope(job.inspectionId, job.slopeId, {
          onlyNew: true,
        });
        const attempted = result.attached + result.failed;
        if (attempted > 0 && result.attached === 0) {
          // Nothing landed. Treat as a job failure so the retry / give-up
          // logic and the failure notification carry the real reason.
          const first = result.failures[0];
          throw new QueueJobError(
            first?.reason ?? 'No photo could be analyzed.',
            first?.retryable ?? false,
          );
        }

        useAnalysisQueueStore.getState().setStatus(job.id, 'done');
        useNotificationStore.getState().push({ kind: 'analysis_done', key: `analysis_${job.id}`, title: `Analysis finished · ${job.slopeLabel}`, body: 'Findings are on the job.', href: `/job/${job.inspectionId}` });
        measure(jobMark, { metric: QUEUE_JOB_METRIC, n: attempted });
        useActivityStore.getState().log({
          kind: 'analysis_ran',
          inspectionId: job.inspectionId,
          message:
            `Queued analysis finished — ${result.attached} photo${result.attached === 1 ? '' : 's'} on ${job.slopeLabel} slope` +
            (result.failed > 0 ? ` · ${result.failed} failed` : '') +
            (result.modelUsed ? ` · ${result.modelUsed}` : ''),
        });
        sendLocalNotification({
          title: result.failed > 0 ? 'Analysis finished with failures' : 'Analysis complete',
          body: completionBody(job, result),
          data: { kind: 'analysis_done', inspectionId: job.inspectionId },
        }).catch(() => {});
      } catch (e) {
        clearMark(jobMark);
        const reason = describeAnalysisError(e);
        const retryable = isJobRetryable(e);
        const attempts =
          useAnalysisQueueStore.getState().jobs.find((j) => j.id === job.id)?.attempts ??
          MAX_ATTEMPTS;
        const giveUp = !retryable || attempts >= MAX_ATTEMPTS;
        useAnalysisQueueStore.getState().setStatus(job.id, giveUp ? 'failed' : 'queued');
        if (giveUp) useNotificationStore.getState().push({ kind: 'analysis_failed', key: `analysis_${job.id}`, title: `Analysis failed · ${job.slopeLabel}`, body: reason, href: `/job/${job.inspectionId}` });
        if (__DEV__) {
          console.warn(
            `[analysisQueue] job ${job.id} (${job.slopeLabel}) attempt ${attempts} failed: ${reason}` +
              (giveUp ? ' — giving up' : ' — will retry'),
          );
        }
        if (giveUp) {
          notifyFailure(job, reason);
        } else {
          // Back off before the retry loop picks it up again.
          await new Promise((r) => setTimeout(r, RETRY_BACKOFF_MS));
        }
      }
    }
    useAnalysisQueueStore.getState().clearFinished();
  } finally {
    draining = false;
  }
}

function completionBody(job: AnalysisJob, result: SlopeAnalysisResult): string {
  const ok = `${job.slopeLabel} slope · ${result.attached} photo${result.attached === 1 ? '' : 's'} analyzed`;
  if (result.failed === 0) return ok;
  const first = result.failures[0]?.reason ?? 'unknown reason';
  return `${ok} · ${result.failed} failed — ${first} Open the job to retry.`;
}

function notifyFailure(job: AnalysisJob, reason: string): void {
  useActivityStore.getState().log({
    kind: 'analysis_ran',
    inspectionId: job.inspectionId,
    message: `Queued analysis failed on ${job.slopeLabel} slope — ${reason}`,
  });
  sendLocalNotification({
    title: 'Analysis failed',
    body: `${job.slopeLabel} slope — ${reason} Open the job to retry.`,
    data: { kind: 'analysis_failed', inspectionId: job.inspectionId },
  }).catch(() => {});
}

/**
 * Only failures a later attempt can fix get a second run. A missing slope,
 * an invalid key or an exhausted model chain fail the job on the spot —
 * retrying them just delays the roofer seeing the reason.
 */
function isJobRetryable(e: unknown): boolean {
  if (e instanceof QueueJobError) return e.retryable;
  if (e instanceof GeminiAnalysisError) return isRetryableGeminiError(e);
  return false;
}

// -----------------------------------------------------------------------------
// In-flight progress — the Processing view + the queue chip
// -----------------------------------------------------------------------------
//
// The honest source of "what's still processing" is the per-photo
// `slope.photoAnalysis` state that `analyzeSlope` writes live — regardless of
// whether the pass was started by this background queue, the Analyze screen, or
// the capture strip's own pump. Deriving from it (rather than from the queue's
// job list alone) means every in-flight analysis shows up, and the counts are
// real photo counts, never a fabricated number.

/** One slope with unfinished analysis work, flattened for the Processing view. */
export type SlopeAnalysisProgress = {
  inspectionId: string;
  slopeId: string;
  /** Slope orientation, e.g. "S". */
  slopeLabel: string;
  reportId: string;
  customerName: string;
  queued: number;
  analyzing: number;
  done: number;
  failed: number;
  /** Photos on this slope carrying any analysis state. */
  total: number;
  /** photoPaths indexes of the failed photos — the Retry target. */
  failedIndexes: number[];
};

/**
 * Every slope that still has queued, analyzing, or failed photos, across all
 * inspections. A slope whose photos are all done (or has no analysis state at
 * all) is omitted — it is not "in flight". Pure over its input so a component
 * can subscribe to `inspections` and call this in render.
 */
export function deriveAnalysisProgress(inspections: Inspection[]): SlopeAnalysisProgress[] {
  const groups: SlopeAnalysisProgress[] = [];
  for (const ins of inspections) {
    for (const sl of ins.slopes) {
      const pa = sl.photoAnalysis;
      if (!pa) continue;
      let queued = 0;
      let analyzing = 0;
      let done = 0;
      let failed = 0;
      const failedIndexes: number[] = [];
      for (const [uri, st] of Object.entries(pa)) {
        // Skip records for photos that were removed/rotated out of photoPaths.
        const idx = sl.photoPaths.indexOf(uri);
        if (idx < 0) continue;
        switch (st.status) {
          case 'queued':
            queued++;
            break;
          case 'analyzing':
            analyzing++;
            break;
          case 'done':
            done++;
            break;
          case 'failed':
            failed++;
            failedIndexes.push(idx);
            break;
        }
      }
      if (queued + analyzing + failed === 0) continue;
      groups.push({
        inspectionId: ins.id,
        slopeId: sl.id,
        slopeLabel: sl.orientation,
        reportId: ins.reportId,
        customerName: ins.customerName,
        queued,
        analyzing,
        done,
        failed,
        total: queued + analyzing + done + failed,
        failedIndexes,
      });
    }
  }
  return groups;
}

/** Pending (queued + analyzing) photo count across all groups — drives the
 *  chip's live count and whether it shows at all. */
export function pendingPhotoCount(groups: SlopeAnalysisProgress[]): number {
  return groups.reduce((a, g) => a + g.queued + g.analyzing, 0);
}

/** Photos actively analyzing right now — drives the spinner. */
export function analyzingPhotoCount(groups: SlopeAnalysisProgress[]): number {
  return groups.reduce((a, g) => a + g.analyzing, 0);
}
