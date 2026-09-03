// Job budget maths — pure, Node-testable. No I/O, no stores, no React.
//
// JobNimbus's "Budgets" promise is one comparison: what the job was projected
// to cost against what it actually cost, held up against the price the
// homeowner signed. This file is that comparison and nothing else. The
// projected split comes from the saved estimate (or the proposal's frozen
// line items); the actuals are what the roofer typed in; the contract price
// is the signed proposal's total. Every number that is NOT known is
// `undefined`, never 0 — a margin computed from a missing price would read as
// a real (and alarming) number on the card (Drift #5).

import type {
  BudgetEntry,
  BudgetKind,
  BudgetProjected,
  Proposal,
  SavedEstimate,
} from '../models/types';
import type { PricingBook } from '../stores/pricingStore';
import { estimateCost, regionForState, stateFromAddress } from './costEstimator';

// -----------------------------------------------------------------------------
// Bands — owner-tunable. Residential roofing runs 25–40% gross margin; under
// 10% the job is paying for its own truck.
// -----------------------------------------------------------------------------

/** Gross-margin share at or above which the job is healthy. */
export const BUDGET_MARGIN_GREEN = 0.25;
/** Below GREEN and at or above this the job is thin. Below this it is red. */
export const BUDGET_MARGIN_AMBER = 0.1;

export type BudgetBand = 'green' | 'amber' | 'red' | 'none';

export type BudgetSplit = { material: number; labor: number; other: number };

export type BudgetSummary = {
  /** Sum of the projected split, or undefined when nothing was projected. */
  projectedTotal?: number;
  /** Sum of every actual entry — 0 when none were recorded. */
  actualTotal: number;
  actualByKind: Record<BudgetKind, number>;
  /** Actuals folded onto the projected split's three buckets. */
  actualSplit: BudgetSplit;
  /** Contract price − projected total. Undefined without a price or a projection. */
  projectedMargin?: number;
  /** Contract price − actual total. Undefined without a price. */
  actualMargin?: number;
  /** The margin the band is judged on, as a share of the price. */
  marginPct?: number;
  /** Which margin `marginPct` and `band` describe. */
  basis: 'actual' | 'projected' | 'none';
  band: BudgetBand;
  /** True once the actuals have passed the projection. */
  overProjected: boolean;
  /** Projected − actual per bucket (positive = still under the projection). */
  remainingByBucket?: BudgetSplit;
};

// -----------------------------------------------------------------------------
// Classifying line items into the three projected buckets
// -----------------------------------------------------------------------------

export type ClassifiableLine = { key?: string; label: string; amount: number };

/**
 * Which bucket a cost line belongs to. Keys are `costEstimator`'s; the label
 * fallback covers proposal line items, whose keys were not kept when the
 * proposal snapshotted them.
 *
 * "Material (installed)" — the custom-book path prices material INSTALLED
 * and carries labor on its own line (0 until the roofer sets
 * `laborPerSquare`), so it counts as material. The card says so.
 */
export function bucketForLine(line: Pick<ClassifiableLine, 'key' | 'label'>): keyof BudgetSplit {
  const key = line.key ?? '';
  if (key === 'labor' || key === 'tear_off') return 'labor';
  if (key === 'permits') return 'other';
  if (key) return 'material';
  const l = line.label.toLowerCase();
  if (/\blabor\b|tear-?off|disposal/.test(l)) return 'labor';
  if (/permit|dump|cleanup|clean-up|haul/.test(l)) return 'other';
  return 'material';
}

/** Sum classifiable lines into the three buckets. */
export function splitFromLines(lines: readonly ClassifiableLine[]): BudgetSplit {
  const out: BudgetSplit = { material: 0, labor: 0, other: 0 };
  for (const line of lines) {
    if (!Number.isFinite(line.amount) || line.amount <= 0) continue;
    out[bucketForLine(line)] += line.amount;
  }
  return out;
}

/** Scale a split so its total equals `target` (a saved snapshot), keeping proportions. */
export function scaleSplit(split: BudgetSplit, target: number): BudgetSplit {
  const total = split.material + split.labor + split.other;
  if (total <= 0 || !Number.isFinite(target) || target <= 0) return { ...split };
  const f = target / total;
  return {
    material: Math.round(split.material * f),
    labor: Math.round(split.labor * f),
    other: Math.round(split.other * f),
  };
}

/**
 * Projected split from a SAVED estimate.
 *
 * The saved record keeps only the totals, so the proportions are re-derived
 * by running the estimator on the same inputs, then the buckets are scaled so
 * they add up to the saved `totalMid` — the number the roofer actually saw
 * and saved, not whatever today's price book would say.
 */
export function projectedFromEstimate(
  est: SavedEstimate,
  book: PricingBook | undefined,
  now: string = new Date().toISOString(),
): BudgetProjected {
  const cost = estimateCost(
    {
      material: est.material,
      region: regionForState(stateFromAddress(est.address)),
      scope: est.scope,
      totalSquares: est.totalSquares,
    },
    book,
  );
  const lines: ClassifiableLine[] = cost.lineItems.map((li) => ({
    key: li.key,
    label: li.label,
    amount: ((li.unitPriceLow + li.unitPriceHigh) / 2) * li.quantity,
  }));
  const split = scaleSplit(splitFromLines(lines), est.totalMid);
  return { ...split, source: 'estimate', sourceId: est.id, setAt: now };
}

/**
 * Projected split from a proposal's line items — already a snapshot, so the
 * subtotal (pre-tax) is the projection. Tax is a pass-through, not a cost.
 */
export function projectedFromProposal(
  p: Proposal,
  now: string = new Date().toISOString(),
): BudgetProjected {
  const lines: ClassifiableLine[] = p.lineItems.map((li) => ({
    label: li.label,
    amount: li.subtotal,
  }));
  const split = scaleSplit(splitFromLines(lines), p.subtotal);
  return { ...split, source: 'proposal', sourceId: p.id, setAt: now };
}

// -----------------------------------------------------------------------------
// Actuals
// -----------------------------------------------------------------------------

export function actualsByKind(entries: readonly BudgetEntry[]): Record<BudgetKind, number> {
  const out: Record<BudgetKind, number> = { material: 0, labor: 0, permit: 0, dump: 0, other: 0 };
  for (const e of entries) {
    if (!Number.isFinite(e.amount) || e.amount <= 0) continue;
    out[e.kind] += e.amount;
  }
  return out;
}

/** Actuals on the projected split's buckets: permit + dump + other → other. */
export function actualSplit(entries: readonly BudgetEntry[]): BudgetSplit {
  const k = actualsByKind(entries);
  return { material: k.material, labor: k.labor, other: k.permit + k.dump + k.other };
}

export function splitTotal(s: BudgetSplit | undefined): number | undefined {
  if (!s) return undefined;
  return s.material + s.labor + s.other;
}

// -----------------------------------------------------------------------------
// Contract price
// -----------------------------------------------------------------------------

/**
 * The contract price is the SIGNED proposal's total — the newest signed one
 * when several exist. A sent proposal is a price the homeowner has not agreed
 * to; a draft is a number the roofer has not sent. Neither is a contract.
 */
export function contractPriceFor(
  proposals: readonly Proposal[],
): { price: number; proposalId: string } | undefined {
  const signed = proposals
    .filter((p) => p.status === 'signed' && Number.isFinite(p.total) && p.total > 0)
    .sort((a, b) => Date.parse(b.signedAt ?? '') - Date.parse(a.signedAt ?? ''));
  const hit = signed[0];
  return hit ? { price: hit.total, proposalId: hit.id } : undefined;
}

// -----------------------------------------------------------------------------
// The comparison
// -----------------------------------------------------------------------------

export function bandFor(marginPct: number | undefined): BudgetBand {
  if (marginPct === undefined || !Number.isFinite(marginPct)) return 'none';
  if (marginPct >= BUDGET_MARGIN_GREEN) return 'green';
  if (marginPct >= BUDGET_MARGIN_AMBER) return 'amber';
  return 'red';
}

export function budgetSummary(input: {
  contractPrice?: number;
  projected?: BudgetSplit;
  actuals: readonly BudgetEntry[];
}): BudgetSummary {
  const price =
    input.contractPrice !== undefined && Number.isFinite(input.contractPrice) && input.contractPrice > 0
      ? input.contractPrice
      : undefined;
  const projectedTotal = splitTotal(input.projected);
  const byKind = actualsByKind(input.actuals);
  const aSplit = actualSplit(input.actuals);
  const actualTotal = aSplit.material + aSplit.labor + aSplit.other;

  const projectedMargin = price !== undefined && projectedTotal !== undefined ? price - projectedTotal : undefined;
  const actualMargin = price !== undefined ? price - actualTotal : undefined;

  // Judge on actuals once any exist — that is the whole point of a budget.
  // Until then the projection is the best available read, labelled as such.
  let basis: BudgetSummary['basis'] = 'none';
  let marginPct: number | undefined;
  if (price !== undefined && actualTotal > 0) {
    basis = 'actual';
    marginPct = (price - actualTotal) / price;
  } else if (price !== undefined && projectedTotal !== undefined && projectedTotal > 0) {
    basis = 'projected';
    marginPct = (price - projectedTotal) / price;
  }

  const overProjected = projectedTotal !== undefined && projectedTotal > 0 && actualTotal > projectedTotal;
  const remainingByBucket = input.projected
    ? {
        material: input.projected.material - aSplit.material,
        labor: input.projected.labor - aSplit.labor,
        other: input.projected.other - aSplit.other,
      }
    : undefined;

  return {
    projectedTotal,
    actualTotal,
    actualByKind: byKind,
    actualSplit: aSplit,
    projectedMargin,
    actualMargin,
    marginPct,
    basis,
    band: bandFor(marginPct),
    overProjected,
    remainingByBucket,
  };
}

/** "$12,400" — whole dollars, never "$12,400.00" on a card. */
export function formatMoney(n: number): string {
  const sign = n < 0 ? '−' : '';
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString()}`;
}

/** "32%" for a share; "—" when unknown. */
export function formatPct(share: number | undefined): string {
  if (share === undefined || !Number.isFinite(share)) return '—';
  return `${Math.round(share * 100)}%`;
}
