// Drains the persisted analysis queue while the app is in the foreground.
// Expo Go can't run JS while backgrounded, so this is the honest version of
// "run in background": jobs survive app restarts and resume the moment the
// app is open again. Each completion fires a local notification.

import { useAnalysisQueueStore } from '../stores/analysisQueueStore';
import { useActivityStore } from '../stores/activityStore';
import { analyzeSlope } from './analyzeSlope';
import { sendLocalNotification } from './pushNotifications';
import { isGeminiConfigured } from '../env';

const MAX_ATTEMPTS = 2;

let draining = false;

export async function drainAnalysisQueue(): Promise<void> {
  if (draining) return;
  if (!isGeminiConfigured) return;
  draining = true;
  try {
    // Fresh read each loop iteration — jobs can be enqueued mid-drain.
    for (;;) {
      const store = useAnalysisQueueStore.getState();
      const job = store.nextQueued();
      if (!job) break;

      store.setStatus(job.id, 'running');
      store.bumpAttempts(job.id);
      try {
        const result = await analyzeSlope(job.inspectionId, job.slopeId, {
          onlyNew: true,
        });
        useAnalysisQueueStore.getState().setStatus(job.id, 'done');
        useActivityStore.getState().log({
          kind: 'analysis_ran',
          inspectionId: job.inspectionId,
          message: `Queued analysis finished — ${result.attached} photo${result.attached === 1 ? '' : 's'} on ${job.slopeLabel} slope`,
        });
        sendLocalNotification({
          title: 'Analysis complete',
          body: `${job.slopeLabel} slope · ${result.attached} photo${result.attached === 1 ? '' : 's'} analyzed${result.failed > 0 ? ` · ${result.failed} failed` : ''}`,
          data: { kind: 'analysis_done', inspectionId: job.inspectionId },
        }).catch(() => {});
      } catch {
        const attempts = useAnalysisQueueStore
          .getState()
          .jobs.find((j) => j.id === job.id)?.attempts ?? MAX_ATTEMPTS;
        useAnalysisQueueStore
          .getState()
          .setStatus(job.id, attempts >= MAX_ATTEMPTS ? 'failed' : 'queued');
        if (attempts >= MAX_ATTEMPTS) {
          sendLocalNotification({
            title: 'Analysis failed',
            body: `${job.slopeLabel} slope — open the job to retry manually.`,
            data: { kind: 'analysis_failed', inspectionId: job.inspectionId },
          }).catch(() => {});
        } else {
          // Back off before the retry loop picks it up again.
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
    }
    useAnalysisQueueStore.getState().clearFinished();
  } finally {
    draining = false;
  }
}
