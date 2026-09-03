// Proposal selectors — the read side of the proposal store, kept out of the
// store itself. Pure functions take the lists; the hooks at the bottom wire
// them to the stores for screens.
//
// Why a separate file: the store's `getByJob` returns ONE proposal (the
// newest), which is what the proposal screen needs. The job page's Proposal
// tab lists EVERY proposal for the job, links each to the estimate it came
// from, and works out the job's amount the way the Pipeline does. None of
// that is store state, so none of it belongs in the store.

import { useMemo } from 'react';
import type { Inspection, Lead, Proposal, ProposalStatus, SavedEstimate } from '../models/types';
import { useEstimateStore } from '../stores/estimateStore';
import { useProposalStore } from '../stores/proposalStore';
import { addressKey } from './propertyRecord';

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: 'Draft',
  sent: 'Sent',
  viewed: 'Viewed',
  signed: 'Signed',
  declined: 'Declined',
  expired: 'Expired',
};

const ID_TIMESTAMP = /^prop_(\d{12,14})_/;

/**
 * When the proposal was minted. `createdAt` when the store wrote one; else
 * the millisecond timestamp the id carries (`prop_<ms>_<n>` — every id the
 * store has ever minted); else the first lifecycle stamp. Undefined only for
 * a record that carries none of those, in which case the card says nothing
 * rather than "Created just now".
 */
export function proposalCreatedAt(p: Pick<Proposal, 'id' | 'createdAt' | 'sentAt' | 'signedAt'>): string | undefined {
  if (p.createdAt && !Number.isNaN(Date.parse(p.createdAt))) return p.createdAt;
  const m = p.id.match(ID_TIMESTAMP);
  if (m) {
    const ms = Number(m[1]);
    if (Number.isFinite(ms) && ms > 0) return new Date(ms).toISOString();
  }
  return p.sentAt ?? p.signedAt;
}

/**
 * The status a card should show. A draft/sent/viewed proposal whose
 * expiration has passed reads as Expired without anyone having to write
 * that back — the store is not mutated here, so the record still says what
 * the roofer last set.
 */
export function effectiveStatus(p: Pick<Proposal, 'status' | 'expirationAt'>, now: number = Date.now()): ProposalStatus {
  if (p.status === 'signed' || p.status === 'declined' || p.status === 'expired') return p.status;
  if (p.expirationAt) {
    const exp = Date.parse(p.expirationAt);
    if (Number.isFinite(exp) && exp < now) return 'expired';
  }
  return p.status;
}

/** Every proposal for the job, newest first (by creation time, then id). */
export function listByJob(jobId: string, proposals: readonly Proposal[]): Proposal[] {
  return proposals
    .filter((p) => p.jobId === jobId)
    .sort((a, b) => {
      const ta = Date.parse(proposalCreatedAt(a) ?? '') || 0;
      const tb = Date.parse(proposalCreatedAt(b) ?? '') || 0;
      if (tb !== ta) return tb - ta;
      return b.id.localeCompare(a.id);
    });
}

/**
 * The saved estimate behind a job: the explicit `originEstimateId` link when
 * one was recorded, else the newest saved estimate for the SAME address
 * (normalised through `addressKey`, the same key the property-record cache
 * uses). Never a name match — an estimate is for a house, not a person.
 */
export function estimateForJob(
  inspection: Pick<Inspection, 'originEstimateId' | 'address'>,
  estimates: readonly SavedEstimate[],
): SavedEstimate | undefined {
  if (inspection.originEstimateId) {
    const hit = estimates.find((e) => e.id === inspection.originEstimateId);
    if (hit) return hit;
  }
  const key = addressKey(inspection.address);
  if (!key) return undefined;
  return estimates
    .filter((e) => addressKey(e.address) === key)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

export type JobAmountSource = 'signed' | 'sent' | 'estimate' | 'lead';

export type JobAmount = { value: number; source: JobAmountSource; proposalId?: string };

/**
 * The job's amount, in the Pipeline's precedence: a SIGNED proposal (the
 * contract) → a SENT / viewed proposal (the ask) → the saved estimate's
 * mid figure → the lead's own value. A draft proposal is deliberately not an
 * amount: the roofer has not put it in front of anyone yet. Null when there
 * is no number anywhere — the hero then shows no amount at all.
 */
export function jobAmount(input: {
  proposals: readonly Proposal[];
  estimate?: SavedEstimate;
  lead?: Lead;
}): JobAmount | null {
  const valid = (n: number | undefined): n is number => n !== undefined && Number.isFinite(n) && n > 0;
  const byRecency = (a: Proposal, b: Proposal) =>
    (Date.parse(b.signedAt ?? b.sentAt ?? proposalCreatedAt(b) ?? '') || 0) -
    (Date.parse(a.signedAt ?? a.sentAt ?? proposalCreatedAt(a) ?? '') || 0);

  const signed = input.proposals.filter((p) => p.status === 'signed' && valid(p.total)).sort(byRecency)[0];
  if (signed) return { value: signed.total, source: 'signed', proposalId: signed.id };

  const sent = input.proposals
    .filter((p) => (p.status === 'sent' || p.status === 'viewed') && valid(p.total))
    .sort(byRecency)[0];
  if (sent) return { value: sent.total, source: 'sent', proposalId: sent.id };

  if (input.estimate && valid(input.estimate.totalMid)) {
    return { value: input.estimate.totalMid, source: 'estimate' };
  }
  if (input.lead && valid(input.lead.value)) return { value: input.lead.value, source: 'lead' };
  return null;
}

export const JOB_AMOUNT_SOURCE_LABELS: Record<JobAmountSource, string> = {
  signed: 'Signed',
  sent: 'Proposed',
  estimate: 'Estimated',
  lead: 'Lead value',
};

// -----------------------------------------------------------------------------
// Hooks — select the whole list (a stable reference) and derive with useMemo,
// so the zustand selector never hands React a fresh array on every render.
// -----------------------------------------------------------------------------

export function useProposalsForJob(jobId: string | undefined): Proposal[] {
  const proposals = useProposalStore((s) => s.proposals);
  return useMemo(() => (jobId ? listByJob(jobId, proposals) : []), [jobId, proposals]);
}

export function useEstimateForJob(
  inspection: Pick<Inspection, 'originEstimateId' | 'address'> | undefined,
): SavedEstimate | undefined {
  const estimates = useEstimateStore((s) => s.estimates);
  const originEstimateId = inspection?.originEstimateId;
  const address = inspection?.address;
  return useMemo(
    () =>
      address === undefined ? undefined : estimateForJob({ originEstimateId, address }, estimates),
    [originEstimateId, address, estimates],
  );
}
