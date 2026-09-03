// Where an activity event leads when tapped.
//
// Events carry the ids of the records they describe; this turns them into a
// route — and returns `null` when the record no longer exists, so a feed row
// for a deleted job renders as plain text rather than as a button that opens
// "Job not found" (no dead buttons).

import type { ActivityEvent } from '@/lib/models/types';

export type ActivityRouteContext = {
  hasInspection: (id: string) => boolean;
  hasLead: (id: string) => boolean;
  /** The job a proposal belongs to, for events that only carry `proposalId`. */
  proposalJobId: (proposalId: string) => string | undefined;
};

export function activityHref(evt: ActivityEvent, ctx: ActivityRouteContext): string | null {
  if (evt.proposalId) {
    const jobId = evt.inspectionId ?? evt.jobId ?? ctx.proposalJobId(evt.proposalId);
    if (jobId && ctx.hasInspection(jobId)) return `/proposal/${jobId}`;
  }
  const jobId = evt.inspectionId ?? evt.jobId;
  if (jobId && ctx.hasInspection(jobId)) return `/job/${jobId}`;
  if (evt.leadId && ctx.hasLead(evt.leadId)) return `/lead/${evt.leadId}`;
  return null;
}
