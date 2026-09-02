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
import { useActivityStore } from '../stores/activityStore';
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
