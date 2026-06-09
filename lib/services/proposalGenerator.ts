// Auto-build a Proposal draft from an Inspection.
// Uses the Decision Engine + CostEstimator to seed line items, scope, and total.

import type { Inspection, Proposal, ProposalLineItem } from '../models/types';
import { evaluate } from './decisionEngine';
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

  const decision = evaluate(inspection);
  const scope: DamageScope =
    decision.roofRecommendation === 'full_replacement'
      ? 'full_replacement'
      : decision.roofRecommendation === 'partial_replacement'
      ? 'partial_replacement'
      : 'repair';

  const totalSquares =
    opts.totalSquares ??
    Math.max(
      1,
      inspection.slopes.reduce((s, sl) => s + (sl.detectedAreaSquares ?? sl.areaSquares ?? 0), 0),
    );

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
    scopeOfWork: buildScope(decision.roofVerdictReasoning, totalSquares),
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

function buildScope(reasoning: string, squares: number): string {
  return (
    `Scope of work covers ${squares.toFixed(1)} squares (~${Math.round(squares * 100)} sq ft). ` +
    `${reasoning} All materials installed per manufacturer specification and applicable code.`
  );
}

function buildTerms(warrantyYears: number): string {
  return (
    `Workmanship warranty: ${warrantyYears} years from completion. Manufacturer materials warranty per ` +
    `data sheet. Payment: 25% deposit on signing, 25% on material delivery, balance on completion. ` +
    `Proposal valid for 30 days. Change orders billed separately.`
  );
}
