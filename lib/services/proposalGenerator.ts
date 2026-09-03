// Auto-build a Proposal draft from an Inspection.
// Uses the Decision Engine + CostEstimator to seed line items, scope, and total.

import type { Inspection, Proposal, ProposalLineItem } from '../models/types';
import { totalSquares as totalSquaresFor } from './propertyIntel';
import { resolveEngineResult } from './storedEngine';
import { estimateCost, regionForState, type DamageScope } from './costEstimator';

let lineCounter = 0;
function newLineId(): string {
  return `pli_${Date.now()}_${lineCounter++}`;
}

export type GenerateOptions = {
  totalSquares?: number;        // If not provided, derive from inspection.slopes.areaSquares
  taxRate?: number;             // 0–1
  depositRate?: number;         // 0–1 of subtotal
  warrantyYears?: number;
  expirationDays?: number;
};

const DEFAULTS = {
  taxRate: 0.0825,
  depositRate: 0.25,
  warrantyYears: 10,
  expirationDays: 30,
};

export function generateProposalDraft(
  inspection: Inspection,
  opts: GenerateOptions = {},
): Omit<Proposal, 'id'> {
  const cfg = { ...DEFAULTS, ...opts };

  // Same read path as the job screen and the reports: the STORED
  // determination when it still speaks for the current inputs. Re-deriving
  // here would let a proposal quote a different scope than the HAAG packet
  // the homeowner was already shown.
  //
  // `honorFreeze: false`: a proposal is a PRICE THE ROOFER IS ABOUT TO SIGN.
  // If the inspection changed after the last report was finalized, quoting the
  // pre-edit scope is quoting the wrong roof — that risk is the contractor's,
  // not the document's. The job screen flags the same drift and asks for a
  // regenerated packet.
  const { decision } = resolveEngineResult(inspection, Date.now(), { honorFreeze: false });
  const scope: DamageScope =
    decision.roofRecommendation === 'full_replacement'
      ? 'full_replacement'
      : decision.roofRecommendation === 'partial_replacement'
      ? 'partial_replacement'
      : 'repair';

  // One roof, one area. `measuredSquares` reads the aerial measurement, then
  // hand-entered slope areas, in that order — the same reader the HAAG cost
  // formula and the estimator use, so a proposal can never quote a different
  // size than the packet the homeowner was shown.
  //
  // The `Math.max(1, ...)` floor below is a LAST RESORT, and it is why this
  // roof must be measured: without it the generator used to price a 1-square
  // roof in silence, which reads as a real quote for about $400. When it fires,
  // `squaresAreEstimated` is true and the scope of work says so in words.
  const measuredSquares = totalSquaresFor(inspection);
  const squaresAreEstimated = opts.totalSquares == null && measuredSquares == null;
  const totalSquares = opts.totalSquares ?? measuredSquares ?? 1;

  const cost = estimateCost({
    material: inspection.material,
    region: regionForState(parseStateFromAddress(inspection.address)),
    scope,
    totalSquares,
  });

  const lineItems: ProposalLineItem[] = cost.lineItems.map((li) => {
    const unitPrice = (li.unitPriceLow + li.unitPriceHigh) / 2;
    return {
      id: newLineId(),
      label: li.label,
      unit: li.unit === 'sq' ? 'sq' : li.unit === 'lf' ? 'ft' : 'ea',
      quantity: li.quantity,
      unitPrice,
      subtotal: unitPrice * li.quantity,
    };
  });

  const subtotal = lineItems.reduce((s, li) => s + li.subtotal, 0);
  const tax = subtotal * cfg.taxRate;
  const total = subtotal + tax;
  const deposit = total * cfg.depositRate;

  const expirationAt = new Date();
  expirationAt.setDate(expirationAt.getDate() + cfg.expirationDays);

  return {
    jobId: inspection.id,
    status: 'draft',
    coverNarrative: buildCoverNarrative(inspection),
    scopeOfWork: buildScope(decision.roofVerdictReasoning, totalSquares, squaresAreEstimated),
    lineItems,
    subtotal: Math.round(subtotal),
    tax: Math.round(tax),
    deposit: Math.round(deposit),
    total: Math.round(total),
    warrantyYears: cfg.warrantyYears,
    termsText: buildTerms(cfg.warrantyYears),
    expirationAt: expirationAt.toISOString(),
  };
}

function parseStateFromAddress(addr: string): string | undefined {
  const m = addr.match(/,\s*([A-Z]{2})\s*\d*\s*$/);
  return m ? m[1] : undefined;
}

function buildCoverNarrative(ins: Inspection): string {
  return (
    `Proposal for ${ins.customerName} at ${ins.address}. ` +
    `Following our HAAG-protocol inspection (report ${ins.reportId}), we are pleased to propose ` +
    `the scope below to restore the roof to a fully functional, claim-defensible state.`
  );
}

function buildScope(reasoning: string, squares: number, estimated: boolean): string {
  // An unmeasured roof says so IN THE PROPOSAL. A homeowner signing a price
  // is entitled to know the area behind it was never established.
  const area = estimated
    ? 'Roof area has not been measured yet — this price is a placeholder until it is. ' +
      'Measure the roof (aerial or on site) and re-issue before sending.'
    : `Scope of work covers ${squares.toFixed(1)} squares (~${Math.round(squares * 100)} sq ft).`;
  return `${area} ${reasoning} All materials installed per manufacturer specification and applicable code.`;
}

function buildTerms(warrantyYears: number): string {
  return (
    `Workmanship warranty: ${warrantyYears} years from completion. Manufacturer materials warranty per ` +
    `data sheet. Payment: 25% deposit on signing, 25% on material delivery, balance on completion. ` +
    `Proposal valid for 30 days. Change orders billed separately.`
  );
}
