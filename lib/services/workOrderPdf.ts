// Work order + material list — the two documents a crew and a supply house
// need once a proposal is signed (JobNimbus: "create work orders from
// estimates", "send material orders to your local supply house").
//
// The quantities are PURE and Node-testable (`materialList`). They are rules
// of thumb a roofer would recognise — bundles per square, rolls per square,
// a perimeter estimated from the footprint — and every line that is not a
// measured number says "estimated" on the page. There is no eave, ridge or
// valley length model in RoofWise yet (BACKLOG "Traced roof outline"), so
// nothing here pretends to have one. Quantities only, no prices: the price
// book belongs on the proposal, not on an order to a supplier.
//
// Both PDFs carry the same company branding the proposal PDF prints
// (`companyCoverLine` / `companyFooterLine` from haagPdf.ts) and go out
// through the system share sheet (expo-sharing, the same path as the mileage
// log and the reports screen).

import { readPhotoAnalysis } from './photoAnalysisState';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { formatDate, formatDateTime } from '../format/date';
import type {
  Inspection,
  Lead,
  Proposal,
  RoofGeometry,
  RoofMaterial,
  SavedEstimate,
} from '../models/types';
import {
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
  pitchDegreesToRatio,
} from '../models/types';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import type { DamageScope } from './costEstimator';
import { ROOFWISE_RECOMMENDATION_LABELS } from './decisionEngine';
import { companyCoverLine, companyFooterLine, esc } from './haagPdf';
import { isMeasured, roofPlanes, totalSquares as totalSquaresFor } from './propertyIntel';
import { resolveEngineResult } from './storedEngine';

// -----------------------------------------------------------------------------
// Quantities — pure
// -----------------------------------------------------------------------------

/** Waste allowance by roof shape. Hips and valleys eat shingles; a flat roof barely does. */
export const WASTE_BY_GEOMETRY: Record<RoofGeometry, number> = {
  gable: 0.1,
  hip: 0.15,
  mansard: 0.15,
  mixed: 0.15,
  flat: 0.05,
};

/** The families sold in bundles; everything else is ordered by the square. */
export const BUNDLES_PER_SQUARE: Partial<Record<RoofMaterial, number>> = {
  three_tab_asphalt: 3,
  architectural_asphalt: 3,
  luxury_asphalt: 4,
  synthetic_slate: 3,
  composite: 3,
};

/** Coverage constants behind the rules of thumb — one place to correct them. */
export const MATERIAL_COVERAGE = {
  /** Synthetic underlayment: one 10-square roll. */
  underlaymentSqPerRoll: 10,
  /** Ice & water: a 66 lf roll laid two courses deep at the eaves ≈ 33 lf of eave. */
  iceWaterEaveLfPerRoll: 33,
  /** Starter strip bundle ≈ 100 lf. */
  starterLfPerBundle: 100,
  /** Hip & ridge cap bundle ≈ 33 lf. */
  ridgeLfPerBundle: 33,
  /** Drip edge sold in 10 ft sticks. */
  dripEdgeLfPerStick: 10,
  /** Roofing coil nails ≈ 2 lb per square; 30 lb boxes. */
  nailLbPerSquare: 2,
  nailLbPerBox: 30,
  /** Roof vents / pipe boots — the same ~1 per 15 squares costEstimator assumes. */
  squaresPerVent: 15,
} as const;

export type MaterialLineUnit = 'sq' | 'bundle' | 'roll' | 'stick' | 'box' | 'ea' | 'lf';

export type MaterialLine = {
  key: string;
  label: string;
  quantity: number;
  unit: MaterialLineUnit;
  /** One line on how the number was reached — printed under the label. */
  basis: string;
  /** False only for the measured squares themselves. */
  estimated: boolean;
};

export type MaterialListInput = {
  /** Measured (or hand-entered) roof area in squares — the one real number. */
  totalSquares: number;
  material: RoofMaterial;
  geometry?: RoofGeometry;
  /** 0–1. Defaults from `WASTE_BY_GEOMETRY` (10% when the shape is unknown). */
  wastePercent?: number;
  /** Repair scopes order for the affected share, like costEstimator's scope factor. */
  scope?: DamageScope;
};

export type MaterialList = {
  measuredSquares: number;
  /** Share of the roof being worked (1 for a full replacement). */
  scopeShare: number;
  wastePercent: number;
  /** Squares to order, waste included, rounded up to the next whole square. */
  orderSquares: number;
  /** Footprint-derived perimeter estimate, in linear feet. */
  perimeterLf: number;
  eaveLf: number;
  ridgeLf: number;
  lines: MaterialLine[];
  /** Plain-English caveats printed at the foot of the list. */
  notes: string[];
};

const SCOPE_SHARE: Record<DamageScope, number> = {
  repair: 0.25,
  partial_replacement: 0.55,
  full_replacement: 1,
};

/**
 * Perimeter of a roughly square footprint with this much roof on it. For
 * 30 squares (3,000 sq ft) that is ~219 lf — the right order of magnitude for
 * a suburban house, and labelled estimated wherever it is used.
 */
export function estimatePerimeterLf(roofSquares: number): number {
  if (!Number.isFinite(roofSquares) || roofSquares <= 0) return 0;
  return Math.round(4 * Math.sqrt(roofSquares * 100));
}

export function materialList(input: MaterialListInput): MaterialList {
  const measured = Number.isFinite(input.totalSquares) && input.totalSquares > 0 ? input.totalSquares : 0;
  const scopeShare = SCOPE_SHARE[input.scope ?? 'full_replacement'];
  const waste =
    input.wastePercent !== undefined && Number.isFinite(input.wastePercent)
      ? Math.min(0.5, Math.max(0, input.wastePercent))
      : input.geometry
        ? WASTE_BY_GEOMETRY[input.geometry]
        : 0.1;
  const worked = measured * scopeShare;
  const orderSquares = Math.ceil(worked * (1 + waste));

  // Footprint geometry for the linear items. Eaves are about half the
  // perimeter on a gable (the rakes are the other half); a hip roof is all
  // eave. Ridge + hips: one long side for a gable, more for a hip.
  const perimeterLf = Math.round(estimatePerimeterLf(worked));
  const hipLike = input.geometry === 'hip' || input.geometry === 'mansard' || input.geometry === 'mixed';
  const eaveLf = Math.round(hipLike ? perimeterLf : perimeterLf / 2);
  const side = perimeterLf / 4;
  const ridgeLf = Math.round(input.geometry === 'flat' ? 0 : hipLike ? side * 2.5 : side * 1.2);

  const lines: MaterialLine[] = [];
  const notes: string[] = [];
  const C = MATERIAL_COVERAGE;

  lines.push({
    key: 'squares',
    label: `${ROOF_MATERIAL_LABELS[input.material]} — roof area`,
    quantity: Math.round(worked * 10) / 10,
    unit: 'sq',
    basis:
      scopeShare < 1
        ? `${measured.toFixed(1)} sq measured × ${Math.round(scopeShare * 100)}% scope`
        : 'Measured roof area (1 sq = 100 sq ft)',
    estimated: scopeShare < 1,
  });

  const bundles = BUNDLES_PER_SQUARE[input.material];
  if (bundles) {
    lines.push({
      key: 'shingles',
      label: 'Shingles',
      quantity: orderSquares * bundles,
      unit: 'bundle',
      basis: `${orderSquares} sq to order (${Math.round(waste * 100)}% waste) × ${bundles} bundles/sq`,
      estimated: true,
    });
  } else {
    lines.push({
      key: 'roofing',
      label: `${ROOF_MATERIAL_LABELS[input.material]} — roofing`,
      quantity: orderSquares,
      unit: 'sq',
      basis: `${Math.round(waste * 100)}% waste added; confirm panel / piece counts with the supplier`,
      estimated: true,
    });
    notes.push(`${ROOF_MATERIAL_LABELS[input.material]} is ordered by the square — the supplier converts to panels or pieces.`);
  }

  lines.push({
    key: 'underlayment',
    label: 'Synthetic underlayment',
    quantity: Math.max(1, Math.ceil(orderSquares / C.underlaymentSqPerRoll)),
    unit: 'roll',
    basis: `${orderSquares} sq ÷ ${C.underlaymentSqPerRoll} sq per roll`,
    estimated: true,
  });

  if (eaveLf > 0) {
    lines.push({
      key: 'ice_water',
      label: 'Ice & water shield',
      quantity: Math.max(1, Math.ceil(eaveLf / C.iceWaterEaveLfPerRoll)),
      unit: 'roll',
      basis: `${eaveLf} lf of eave, two courses — add valleys and penetrations on site`,
      estimated: true,
    });
    lines.push({
      key: 'starter',
      label: 'Starter strip',
      quantity: Math.max(1, Math.ceil(perimeterLf / C.starterLfPerBundle)),
      unit: 'bundle',
      basis: `${perimeterLf} lf eaves + rakes ÷ ${C.starterLfPerBundle} lf per bundle`,
      estimated: true,
    });
    lines.push({
      key: 'drip_edge',
      label: 'Drip edge',
      quantity: Math.max(1, Math.ceil(perimeterLf / C.dripEdgeLfPerStick)),
      unit: 'stick',
      basis: `${perimeterLf} lf perimeter ÷ ${C.dripEdgeLfPerStick} ft sticks`,
      estimated: true,
    });
  }

  if (ridgeLf > 0) {
    lines.push({
      key: 'ridge_cap',
      label: 'Hip & ridge cap',
      quantity: Math.max(1, Math.ceil(ridgeLf / C.ridgeLfPerBundle)),
      unit: 'bundle',
      basis: `${ridgeLf} lf ridge${hipLike ? ' + hips' : ''} ÷ ${C.ridgeLfPerBundle} lf per bundle`,
      estimated: true,
    });
  }

  lines.push({
    key: 'nails',
    label: 'Roofing nails (coil)',
    quantity: Math.max(1, Math.ceil((orderSquares * C.nailLbPerSquare) / C.nailLbPerBox)),
    unit: 'box',
    basis: `${C.nailLbPerSquare} lb per sq, ${C.nailLbPerBox} lb boxes`,
    estimated: true,
  });

  lines.push({
    key: 'vents',
    label: 'Roof vents / pipe boots',
    quantity: Math.max(1, Math.ceil(orderSquares / C.squaresPerVent)),
    unit: 'ea',
    basis: `~1 per ${C.squaresPerVent} sq — count penetrations on site`,
    estimated: true,
  });

  notes.push(
    'Linear quantities are estimated from the roof footprint — RoofWise has no eave, ridge or valley length model yet. Walk the roof before ordering.',
  );
  if (waste > 0) notes.push(`Waste allowance ${Math.round(waste * 100)}%${input.geometry ? ` (${input.geometry} roof)` : ''}.`);

  return {
    measuredSquares: measured,
    scopeShare,
    wastePercent: waste,
    orderSquares,
    perimeterLf,
    eaveLf,
    ridgeLf,
    lines,
    notes,
  };
}

export const MATERIAL_UNIT_LABELS: Record<MaterialLineUnit, { one: string; many: string }> = {
  sq: { one: 'sq', many: 'sq' },
  bundle: { one: 'bundle', many: 'bundles' },
  roll: { one: 'roll', many: 'rolls' },
  stick: { one: 'stick', many: 'sticks' },
  box: { one: 'box', many: 'boxes' },
  ea: { one: 'ea', many: 'ea' },
  lf: { one: 'lf', many: 'lf' },
};

export function formatQuantity(line: Pick<MaterialLine, 'quantity' | 'unit'>): string {
  const u = MATERIAL_UNIT_LABELS[line.unit];
  const q = line.unit === 'sq' ? line.quantity.toFixed(1) : String(line.quantity);
  return `${q} ${line.quantity === 1 ? u.one : u.many}`;
}

// -----------------------------------------------------------------------------
// Inputs from the job
// -----------------------------------------------------------------------------

export type JobDocumentContext = {
  inspection: Inspection;
  /** The saved estimate behind the job, when one exists — squares + scope come from it if the roof is unmeasured. */
  estimate?: SavedEstimate;
  /** The signed (or newest) proposal — its scope of work is printed on the work order. */
  proposal?: Proposal;
  /** The linked lead — install date and crew notes live there today. */
  lead?: Lead;
  installStartAt?: string;
  installEndAt?: string;
  crewNotes?: string;
  wastePercent?: number;
};

/**
 * The squares a job's documents are built on: the aerial / hand-entered
 * measurement first (the same reader every other surface uses), then the
 * saved estimate's figure. Undefined means "not measured" — the caller says
 * so instead of printing a one-square roof.
 */
export function documentSquares(ctx: Pick<JobDocumentContext, 'inspection' | 'estimate'>): number | undefined {
  const measured = totalSquaresFor(ctx.inspection);
  if (measured !== undefined && measured > 0) return measured;
  if (ctx.estimate && ctx.estimate.totalSquares > 0) return ctx.estimate.totalSquares;
  return undefined;
}

function scopeFor(ctx: Pick<JobDocumentContext, 'inspection' | 'estimate'>): DamageScope {
  const { decision } = resolveEngineResult(ctx.inspection, Date.now(), { honorFreeze: false });
  if (decision.roofRecommendation === 'full_replacement') return 'full_replacement';
  if (decision.roofRecommendation === 'partial_replacement') return 'partial_replacement';
  // With no photos the engine cannot say — fall back to the estimate's scope,
  // then to a full replacement (the order a supplier can trim, not pad).
  return ctx.estimate?.scope ?? 'full_replacement';
}

export function materialListForJob(ctx: JobDocumentContext): MaterialList | { error: string } {
  const squares = documentSquares(ctx);
  if (squares === undefined) {
    return { error: 'Roof not measured — measure the roof (Measure tab) or save an estimate before ordering material.' };
  }
  return materialList({
    totalSquares: squares,
    material: ctx.inspection.material,
    geometry: ctx.inspection.geometry,
    wastePercent: ctx.wastePercent,
    scope: scopeFor(ctx),
  });
}

// -----------------------------------------------------------------------------
// HTML
// -----------------------------------------------------------------------------

const DOC_CSS = `
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #0C183C; margin: 0; padding: 0; }
  .page { padding: 32px 40px; }
  .cover { background: #0C183C; color: #fff; padding: 40px 40px; margin: -32px -40px 28px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .mark { width: 44px; height: 44px; border-radius: 12px; background: #FC6018; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .mark span { color: #fff; }
  .name { font-size: 22px; font-weight: 700; }
  h1 { font-size: 28px; margin: 22px 0 6px; }
  .sub { color: rgba(240,240,228,0.85); font-size: 13px; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px 24px; margin-top: 20px; }
  .meta .label { font-size: 11px; color: rgba(240,240,228,0.7); text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .value { font-size: 15px; font-weight: 600; margin-top: 2px; }
  h2 { font-size: 17px; border-bottom: 2px solid #FC6018; padding-bottom: 6px; margin: 30px 0 12px; }
  p { font-size: 13px; line-height: 1.6; margin: 0 0 8px; }
  .quiet { color: #546078; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 9px 12px; border-bottom: 1px solid #E0E0D6; vertical-align: top; }
  th { background: #F0F0E4; font-weight: 600; }
  td.num, th.num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  td .basis { display: block; color: #546078; font-size: 11px; margin-top: 2px; }
  .tag { display: inline-block; font-size: 10px; font-weight: 700; letter-spacing: 0.4px; text-transform: uppercase; padding: 2px 6px; border-radius: 6px; background: #FBEED6; color: #8F3210; margin-left: 6px; vertical-align: middle; }
  .facts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 18px; }
  .facts .label { font-size: 11px; color: #546078; text-transform: uppercase; letter-spacing: 0.5px; }
  .facts .value { font-size: 14px; font-weight: 600; margin-top: 2px; }
  .notes { background: #F0F0E4; padding: 14px 16px; border-radius: 12px; }
  .notes p { margin: 0 0 6px; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 28px; margin-top: 44px; }
  .sig-box { border-top: 1px solid #0C183C; padding-top: 8px; font-size: 11px; color: #546078; }
  .footer { text-align: center; color: #546078; font-size: 10px; padding: 22px 0; border-top: 1px solid #E0E0D6; margin-top: 36px; }
`;

function coverHtml(title: string, ins: Inspection, generatedAt: string, extraMeta: string): string {
  const inspector = useInspectorProfileStore.getState().profile;
  return `
  <div class="cover">
    <div class="brand"><div class="mark"><span>RW</span></div><div class="name">RoofWise</div></div>
    ${companyCoverLine(inspector.company)}
    <h1>${esc(title)}</h1>
    <div class="sub">${esc(ins.reportId)} · Prepared ${esc(generatedAt)}</div>
    <div class="meta">
      <div><div class="label">Customer</div><div class="value">${esc(ins.customerName)}</div></div>
      <div><div class="label">Property</div><div class="value">${esc(ins.address)}</div></div>
      ${extraMeta}
    </div>
  </div>`;
}

function footerHtml(kind: string, generatedAt: string): string {
  const inspector = useInspectorProfileStore.getState().profile;
  return `<div class="footer">${esc(kind)} · Generated ${esc(generatedAt)} · RoofWise — Forensic Roof Inspection${companyFooterLine(inspector.company)}</div>`;
}

function materialTableHtml(list: MaterialList): string {
  return `
  <table>
    <thead><tr><th>Item</th><th class="num">Quantity</th></tr></thead>
    <tbody>
      ${list.lines
        .map(
          (l) => `<tr>
        <td>${esc(l.label)}${l.estimated ? '<span class="tag">estimated</span>' : ''}<span class="basis">${esc(l.basis)}</span></td>
        <td class="num">${esc(formatQuantity(l))}</td>
      </tr>`,
        )
        .join('')}
    </tbody>
  </table>
  <div class="notes" style="margin-top:14px;">
    ${list.notes.map((n) => `<p class="quiet">${esc(n)}</p>`).join('')}
  </div>`;
}

export function renderMaterialListHtml(ctx: JobDocumentContext, list: MaterialList): string {
  const ins = ctx.inspection;
  const generatedAt = formatDateTime(new Date());
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${esc(ins.reportId)} — Material list</title><style>${DOC_CSS}</style></head>
<body><div class="page">
  ${coverHtml('Material List', ins, generatedAt, `
      <div><div class="label">Material</div><div class="value">${esc(ROOF_MATERIAL_LABELS[ins.material])}</div></div>
      <div><div class="label">Order</div><div class="value">${list.orderSquares} sq incl. ${Math.round(list.wastePercent * 100)}% waste</div></div>`)}

  <h2>Quantities</h2>
  <p class="quiet">Quantities only — pricing is on the proposal. ${list.measuredSquares.toFixed(1)} squares measured${list.scopeShare < 1 ? `, ${Math.round(list.scopeShare * 100)}% in scope` : ''}.</p>
  ${materialTableHtml(list)}

  <h2>Deliver to</h2>
  <p>${esc(ins.address)}</p>
  <p class="quiet">Contact: ${esc(ins.customerName)}${ins.customerPhone ? ` · ${esc(ins.customerPhone)}` : ''}</p>

  ${footerHtml('Material list', generatedAt)}
</div></body></html>`;
}

function roofFactsHtml(ctx: JobDocumentContext, squares: number | undefined): string {
  const ins = ctx.inspection;
  const intel = ins.propertyIntel;
  const planes = isMeasured(intel) ? roofPlanes(intel) : [];
  const pitch =
    ins.pitchDegrees !== undefined
      ? `${pitchDegreesToRatio(ins.pitchDegrees)} (gauge)`
      : planes[0]
        ? `${planes[0].pitchRatio} (aerial)`
        : '—';
  const rec = ins.propertyRecord;
  const facts: { label: string; value: string }[] = [
    { label: 'Material', value: ROOF_MATERIAL_LABELS[ins.material] },
    { label: 'Roof area', value: squares !== undefined ? `${squares.toFixed(1)} sq` : 'Not measured' },
    { label: 'Pitch', value: pitch },
    { label: 'Shape', value: ins.geometry },
    { label: 'Roof age', value: ins.ageYears > 0 ? `${ins.ageYears} yr` : '—' },
    { label: 'Stories', value: rec?.stories ? String(rec.stories) : '—' },
  ];
  return `<div class="facts">${facts
    .map((f) => `<div><div class="label">${esc(f.label)}</div><div class="value">${esc(f.value)}</div></div>`)
    .join('')}</div>`;
}

export function renderWorkOrderHtml(ctx: JobDocumentContext, list: MaterialList | { error: string }): string {
  const ins = ctx.inspection;
  const generatedAt = formatDateTime(new Date());
  const { haag, decision } = resolveEngineResult(ins, Date.now(), { honorFreeze: false });
  const analyzed = ins.slopes.reduce(
    (n, sl) => n + sl.photoPaths.filter((uri, i) => readPhotoAnalysis(sl, i)?.status === 'done' || sl.analyzedPhotoIndices?.includes(i)).length,
    0,
  );
  const photos = ins.slopes.reduce((n, sl) => n + sl.photoPaths.length, 0);
  const hasEvidence = analyzed > 0;
  const squares = 'error' in list ? documentSquares(ctx) : list.measuredSquares;
  const scope = hasEvidence
    ? `${ROOFWISE_RECOMMENDATION_LABELS[haag.roofwise_recommendation]}. ${decision.roofVerdictReasoning}`
    : ctx.proposal?.scopeOfWork
      ? ctx.proposal.scopeOfWork
      : 'No analyzed photos — the HAAG verdict is not established yet. Scope below is from the estimate.';
  const start = ctx.installStartAt ? formatDate(ctx.installStartAt) : 'Not scheduled';
  const end = ctx.installEndAt ? formatDate(ctx.installEndAt) : ctx.installStartAt ? 'TBD' : '—';
  const carrier = ins.carrier ? INSURANCE_CARRIER_LABELS[ins.carrier] : undefined;
  const notes = [ctx.crewNotes?.trim(), ins.notes?.trim()].filter((s): s is string => Boolean(s));

  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" /><title>${esc(ins.reportId)} — Work order</title><style>${DOC_CSS}</style></head>
<body><div class="page">
  ${coverHtml('Work Order', ins, generatedAt, `
      <div><div class="label">Start</div><div class="value">${esc(start)}</div></div>
      <div><div class="label">End</div><div class="value">${esc(end)}</div></div>`)}

  <h2>Scope of work</h2>
  <p>${esc(scope)}</p>
  ${ctx.proposal ? `<p class="quiet">Proposal ${esc(ctx.proposal.id)} · ${esc(PROPOSAL_STATUS_WORD[ctx.proposal.status])}${ctx.proposal.status === 'signed' ? ` · contract $${ctx.proposal.total.toLocaleString()}` : ''}${carrier ? ` · ${esc(carrier)}` : ''}</p>` : carrier ? `<p class="quiet">Carrier: ${esc(carrier)}</p>` : ''}

  <h2>Roof facts</h2>
  ${roofFactsHtml(ctx, squares)}
  <p class="quiet" style="margin-top:10px;">${photos} photo${photos === 1 ? '' : 's'} on file, ${analyzed} analyzed. Slopes documented: ${ins.slopes.map((s) => s.orientation).join(', ') || 'none'}.</p>

  <h2>Material summary</h2>
  ${'error' in list ? `<p class="quiet">${esc(list.error)}</p>` : materialTableHtml(list)}

  <h2>Crew</h2>
  <p class="quiet">Crew assignment is not in RoofWise yet — there are no team roles to pick from. Write the crew lead in by hand.</p>
  <p>Crew lead: ______________________________</p>

  <h2>Crew notes</h2>
  ${notes.length > 0 ? notes.map((n) => `<p>${esc(n)}</p>`).join('') : '<p class="quiet">No notes on this job.</p>'}

  <div class="sig-row">
    <div class="sig-box">Crew lead signature</div>
    <div class="sig-box">Homeowner acknowledgement</div>
    <div class="sig-box">Date</div>
  </div>

  ${footerHtml('Work order', generatedAt)}
</div></body></html>`;
}

const PROPOSAL_STATUS_WORD: Record<Proposal['status'], string> = {
  draft: 'draft',
  sent: 'sent',
  viewed: 'viewed',
  signed: 'signed',
  declined: 'declined',
  expired: 'expired',
};

// -----------------------------------------------------------------------------
// Generate + share (I/O)
// -----------------------------------------------------------------------------

export async function generateMaterialListPdf(ctx: JobDocumentContext): Promise<{ uri: string; list: MaterialList }> {
  const list = materialListForJob(ctx);
  if ('error' in list) throw new Error(list.error);
  const html = renderMaterialListHtml(ctx, list);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri, list };
}

export async function generateWorkOrderPdf(ctx: JobDocumentContext): Promise<{ uri: string }> {
  const list = materialListForJob(ctx);
  const html = renderWorkOrderHtml(ctx, list);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri };
}

/** The system share sheet for a generated PDF — same path as the mileage log and reports. */
export async function sharePdf(uri: string, dialogTitle: string): Promise<void> {
  if (!(await Sharing.isAvailableAsync())) {
    throw new Error('Sharing is not available on this device.');
  }
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle, UTI: 'com.adobe.pdf' });
}
