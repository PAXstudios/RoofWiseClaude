// Long Report — the 8-section narrative report (Long Report doc, via
// docs/PRODUCT_SYNTHESIS.md §1 "Reports").
//
// Report Info → Executive Summary → Weather & Event → Roof System →
// Slope-by-Slope → Collateral → Conclusions → Inspector Certification.
//
// PRESENTATION CONTRACT (load-bearing — do not loosen):
//   • This layer is PURELY presentational. It consumes one inspection +
//     stored-engine payload and restates stored values in words.
//   • It NEVER recalculates RC = D × U × R × A. The engine computes RC once
//     and stores it (HAAG_DECISION_ENGINE.md §5); this file only quotes the
//     stored figures and compares the two stored dollar amounts in words.
//   • It NEVER re-derives a recommendation, viability band, or safety rating,
//     and never contradicts a stored engine boolean
//     (e.g. haag_threshold_triggered).
//   • Confidence is never rendered as an accuracy claim (PRODUCT_SYNTHESIS
//     contradiction 19).
//   • When a field is missing it says WHICH data is missing and HOW that
//     affects confidence (HAAG_DECISION_ENGINE.md §9) — it never invents a
//     number and never silently assumes.
//
// Styling is shared with the HAAG Certified Report (REPORT_BASE_CSS / esc
// from ./haagPdf) so the two documents read as one product.

import * as Print from 'expo-print';
import { formatDateShort, formatDateTime } from '@/lib/format/date';
import type { Inspection } from '../models/types';
import {
  CAUSE_OF_LOSS_LABELS,
  COLLATERAL_ZONES,
  COLLATERAL_ZONE_LABELS,
  INSURANCE_CARRIER_LABELS,
  POLICY_TYPE_LABELS,
  ROOF_MATERIAL_LABELS,
  legacyBrittlenessToResult,
} from '../models/types';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import { thresholdFor } from './haagThresholds';
import { REPORT_BASE_CSS, engineProvenance, esc } from './haagPdf';
import { resolveEngineResult, storedEngineFreshness } from './storedEngine';
import { stampReportIntegrity } from './reportIntegrity';
import { recordReportMs } from './telemetry';
import type {
  ClaimViabilityBand,
  HaagEngineResult,
  RoofwiseRecommendation,
  SafetyRating,
  SlopeEvaluation,
  SlopeRecommendedAction,
} from './decisionEngine';

export type { RoofwiseRecommendation, SlopeRecommendedAction };

// -----------------------------------------------------------------------------
// ENGINE CONTRACT (docs/HAAG_DECISION_ENGINE.md §9) — imported from the
// decision engine so the field names live once. The payload types below are
// structural subsets: passing a full HaagEngineResult / SlopeEvaluation
// satisfies them.
// -----------------------------------------------------------------------------

export type ClaimViability = ClaimViabilityBand;

export type RooferSafetyRating = SafetyRating;

/**
 * Stored §5 cost record for one slope. Every value is engine-computed and
 * stored ONCE; this report quotes them verbatim. The `repair_cost_slope`
 * field IS the stored RC — this file must never multiply D × U × R × A
 * itself.
 */
export type EngineSlopeCost = {
  /** D — damaged units per test square. */
  damaged_units_per_square?: number;
  /** U — cost per damaged unit, dollars. */
  unit_repair_cost?: number;
  /** R — access / complexity multiplier. */
  repair_difficulty_factor?: number;
  /** A — slope area in squares (1 square = 100 sq ft). */
  area_squares?: number;
  /** Stored RC = D × U × R × A, dollars. NEVER recomputed here. */
  repair_cost_slope?: number;
  /** Stored replacement cost for the slope, dollars. */
  replacement_cost_slope?: number;
};

/**
 * Per-slope engine output (§9): the engine's own SlopeEvaluation plus the
 * stored §5 cost record, attached at the payload-build call site (the engine
 * stores costs separately under `cost_analysis`).
 */
export type EngineSlopeResult = SlopeEvaluation & {
  /** Stored §5 cost math, when the engine recorded it. */
  cost?: EngineSlopeCost;
};

/**
 * Roof-level engine output (§9) — the subset of HaagEngineResult this report
 * restates. A full HaagEngineResult satisfies it directly.
 */
export type EngineRoofResult = Pick<
  HaagEngineResult,
  | 'roofwise_recommendation'
  | 'claim_viability'
  | 'roofer_safety_rating'
  | 'policy_notes'
  | 'carrier_specific_requirements'
  | 'evidence_required'
  | 'detailed_explanation'
>;

/**
 * The single payload the Long Report consumes.
 *
 * `engine` / `perSlope` are OPTIONAL and are a fallback, not the primary
 * source: the report reads the STORED engine result for this inspection
 * (lib/services/storedEngine.ts) whenever one is present and still speaks for
 * the current inputs. A caller that already evaluated the engine may pass its
 * result — it is used only when no usable stored snapshot exists, so the two
 * paths never render different numbers for the same document.
 */
export type LongReportPayload = {
  inspection: Inspection;
  engine?: EngineRoofResult;
  perSlope?: EngineSlopeResult[];
};

export type GeneratedLongReport = {
  uri: string;
  inspection: Inspection;
  /** SHA-256 of the report HTML, as printed in the document's integrity footer. */
  integrityHash: string;
};

/** The fixed 8-section structure (Long Report doc). Order is the contract. */
export const LONG_REPORT_SECTIONS = [
  'Report Information',
  'Executive Summary',
  'Weather & Event',
  'Roof System',
  'Slope-by-Slope Findings',
  'Collateral Evidence',
  'Conclusions',
  'Inspector Certification',
] as const;

// -----------------------------------------------------------------------------
// Public API
// -----------------------------------------------------------------------------

export async function generateLongReport(
  payload: LongReportPayload,
): Promise<GeneratedLongReport> {
  // Speed instrumentation — published commitment is a report in under a
  // minute (PRODUCT_SYNTHESIS §"Workflow & speed contracts"). Local only.
  const startedAtMs = Date.now();
  // Tamper-evidence: hash the footer-free HTML, then inject the footer that
  // carries the hash (self-reference-safe contract in reportIntegrity.ts).
  const body = renderLongReportHtml(payload);
  const { html, hash } = stampReportIntegrity(body, formatDateTime(new Date()));
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  void recordReportMs(Date.now() - startedAtMs);
  return { uri, inspection: payload.inspection, integrityHash: hash };
}

/**
 * Attach each slope's stored §5 cost record to its §9 evaluation — the
 * payload-build seam. The engine keeps costs under `cost_analysis`; this only
 * re-associates them by slope key. Nothing is computed here.
 */
export function perSlopeFromEngine(haag: HaagEngineResult): EngineSlopeResult[] {
  return haag.slope_evaluations.map((ev) => {
    const cost = haag.cost_analysis?.slopes.find((c) => c.slope === ev.slope);
    return {
      ...ev,
      cost: cost
        ? {
            ...cost.inputs,
            repair_cost_slope: cost.repair_cost_slope,
            replacement_cost_slope: cost.replacement_cost_slope,
          }
        : undefined,
    };
  });
}

type ResolvedReportEngine = {
  engine: EngineRoofResult;
  perSlope: EngineSlopeResult[];
  /** One-line disclosure of where the determination came from. */
  provenance: string;
};

/**
 * Stored engine result first; the caller's payload only as a fallback.
 *
 * Order matters for report integrity: a finalized or still-valid snapshot is
 * the document of record, so it wins over anything a screen evaluated live.
 * Only when no usable snapshot exists does the caller's result get used —
 * and if the caller passed nothing, the engine is snapshotted here.
 */
function resolveReportEngine(payload: LongReportPayload): ResolvedReportEngine {
  const freshness = storedEngineFreshness(payload.inspection);
  if (!freshness.usable && payload.engine) {
    return {
      engine: payload.engine,
      perSlope: payload.perSlope ?? [],
      provenance: engineProvenance('recomputed', new Date().toISOString()),
    };
  }
  const resolved = resolveEngineResult(payload.inspection);
  return {
    engine: resolved.haag,
    perSlope: perSlopeFromEngine(resolved.haag),
    provenance: engineProvenance(resolved.source, resolved.at),
  };
}

// -----------------------------------------------------------------------------
// Wording maps — restatements of stored enum values. No logic.
// -----------------------------------------------------------------------------

const RECOMMENDATION_LABEL: Record<RoofwiseRecommendation, string> = {
  FULL_REPLACEMENT: 'Full replacement',
  PARTIAL_REPLACEMENT: 'Partial replacement',
  REPAIR: 'Repair',
  NO_STORM_DAMAGE: 'No storm damage',
};

const RECOMMENDATION_SENTENCE: Record<RoofwiseRecommendation, string> = {
  FULL_REPLACEMENT: 'full replacement of the roof system',
  PARTIAL_REPLACEMENT: 'replacement of the affected slopes',
  REPAIR: 'a localized, itemized repair scope',
  NO_STORM_DAMAGE: 'no storm-related work',
};

const RECOMMENDATION_PILL: Record<RoofwiseRecommendation, string> = {
  FULL_REPLACEMENT: 'pill-burnt',
  PARTIAL_REPLACEMENT: 'pill-royal',
  REPAIR: 'pill-slate',
  NO_STORM_DAMAGE: 'pill-slate',
};

const VIABILITY_LABEL: Record<ClaimViability, string> = {
  HIGH: 'High',
  MEDIUM: 'Medium',
  LOW: 'Low',
};

const VIABILITY_PILL: Record<ClaimViability, string> = {
  HIGH: 'pill-ok',
  MEDIUM: 'pill-warn',
  LOW: 'pill-bad',
};

/**
 * What the stored band means for the reader. Describes the §6 banding
 * standard generically — the criteria were applied by the engine, not here.
 */
const VIABILITY_SENTENCE: Record<ClaimViability, string> = {
  HIGH:
    'the documented damage, weather corroboration, and policy posture jointly support carrier approval',
  MEDIUM:
    'the claim is supportable but carries factors a carrier may contest; the evidence items in Section 07 close the strongest of those gaps',
  LOW:
    'one or more disqualifying factors weigh against approval as currently documented; Section 07 lists what the engine flagged',
};

const SAFETY_LABEL: Record<RooferSafetyRating, string> = {
  SAFE: 'Safe',
  USE_CAUTION: 'Use caution',
  UNSAFE: 'Unsafe',
};

const SAFETY_PILL: Record<RooferSafetyRating, string> = {
  SAFE: 'pill-ok',
  USE_CAUTION: 'pill-warn',
  UNSAFE: 'pill-bad',
};

const SAFETY_SENTENCE: Record<RooferSafetyRating, string> = {
  SAFE:
    'conditions at assessment fell inside the safe-access band of the Haag pre-inspection safety protocol (§7)',
  USE_CAUTION:
    'conditions at assessment fell inside the caution band of the Haag pre-inspection safety protocol (§7) — elevated wind or marginal weather',
  UNSAFE:
    'conditions at assessment fell inside the unsafe band of the Haag pre-inspection safety protocol (§7) — roof access was not advisable',
};

const ACTION_PILL: Record<SlopeRecommendedAction, string> = {
  'Full Replacement': 'pill-burnt',
  'Partial Replacement': 'pill-royal',
  'Localized Repairs': 'pill-slate',
  'No Storm-Related Work': 'pill-slate',
};

// -----------------------------------------------------------------------------
// Helpers — pure presentation
// -----------------------------------------------------------------------------

function fmtMoney(n: number): string {
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/**
 * Restate the stored §5 cost relationship in words. Quotes the stored RC and
 * replacement figures and compares the two stored numbers — it never
 * multiplies the factors itself, and says so when the figures are absent.
 */
function costNarrative(slopeName: string, cost?: EngineSlopeCost): string {
  if (!cost || cost.repair_cost_slope == null) {
    return (
      `No stored repair-cost figure (RC) exists for ${slopeName}. The Haag RC = D × U × R × A ` +
      'comparison is computed once by the decision engine and stored; without it this report ' +
      'cannot restate the repair-versus-replacement economics for this slope. Noted as missing ' +
      'rather than estimated.'
    );
  }
  const factors = [
    cost.damaged_units_per_square != null
      ? `D = ${cost.damaged_units_per_square} damaged units per square`
      : null,
    cost.unit_repair_cost != null ? `U = ${fmtMoney(cost.unit_repair_cost)} per unit` : null,
    cost.repair_difficulty_factor != null
      ? `R = ${cost.repair_difficulty_factor} difficulty factor`
      : null,
    cost.area_squares != null ? `A = ${cost.area_squares} squares` : null,
  ]
    .filter((f): f is string => f !== null)
    .join(', ');
  let out =
    `Engine-stored repair cost for this slope: ${fmtMoney(cost.repair_cost_slope)}` +
    (factors
      ? ` — computed once by the engine as RC = D × U × R × A from ${factors}, and restated here without recalculation.`
      : ' — an engine-stored RC figure, restated here without recalculation.');
  if (cost.replacement_cost_slope != null) {
    const rel =
      cost.repair_cost_slope > cost.replacement_cost_slope
        ? 'exceeds'
        : cost.repair_cost_slope === cost.replacement_cost_slope
        ? 'equals'
        : 'is below';
    out += ` Against the stored replacement cost of ${fmtMoney(cost.replacement_cost_slope)}, repair ${rel} replacement for this slope.`;
  } else {
    out += ' No stored replacement-cost figure is recorded for comparison.';
  }
  return out;
}

type MissingDatum = { what: string; effect: string };

/**
 * §9 record-completeness register: which data is missing and how each gap
 * affects confidence. Purely descriptive — nothing here alters, gates, or
 * re-derives any stored engine output.
 */
function missingDataRegister(ins: Inspection, perSlope: EngineSlopeResult[]): MissingDatum[] {
  const out: MissingDatum[] = [];
  if (!ins.event) {
    out.push({
      what: 'Verified weather event',
      effect:
        'The causation leg of the claim is undocumented; confidence in storm attribution is materially reduced until a NOAA (or equivalent) event is attached.',
    });
  }
  if (ins.slopes.length === 0) {
    out.push({
      what: 'Slope captures',
      effect: 'No slopes were captured; every roof-level statement rests on the engine inputs alone.',
    });
  }
  const noPhotoSlopes = ins.slopes
    .map((s, i) => (s.photoPaths.length === 0 ? `Slope ${i + 1} · ${s.orientation}` : null))
    .filter((s): s is string => s !== null);
  if (noPhotoSlopes.length > 0) {
    out.push({
      what: `Photographs on ${noPhotoSlopes.join(', ')}`,
      effect:
        "Findings on an unphotographed slope stand on the inspector's observation alone and are easier for a carrier to contest.",
    });
  }
  const brittleResult =
    ins.brittlenessProtocol?.result ?? legacyBrittlenessToResult(ins.brittlenessTest);
  if (!brittleResult) {
    out.push({
      what: 'Brittleness test',
      effect:
        'The §3 repairability gate is unevaluated; repair feasibility is undocumented either way, which lowers confidence in any repair-based scope.',
    });
  } else if ((ins.brittlenessProtocol?.photoIds.length ?? 0) === 0) {
    out.push({
      what: 'Brittleness protocol photographs',
      effect:
        'The result is recorded but not photographically evidenced; the field protocol (§VII-C) requires photos of the test process, so the result carries less weight with an adjuster.',
    });
  }
  out.push({
    what: 'Roof layer count',
    effect:
      'Layer count is not modeled on this inspection record, so the 2+ layer repairability gate (§3) cannot be evidenced in this document either way.',
  });
  if (ins.kind === 'insurance_claim') {
    if (!ins.dateOfLoss) {
      out.push({
        what: 'Reported date of loss',
        effect:
          'Carriers require a reported date of loss and match it against weather records; without one the claim cannot be date-anchored.',
      });
    }
    if (!ins.causeOfLoss) {
      out.push({
        what: 'Primary cause of loss',
        effect:
          'The §VI questionnaire requires a cause of loss; observations cannot be tied to a peril without it.',
      });
    }
    if (!ins.policyType) {
      out.push({
        what: 'Policy type (RCV / ACV)',
        effect:
          'RCV-versus-ACV posture feeds the §6 viability banding; unrecorded, the payout structure of the claim is unknown.',
      });
    }
    if (ins.deductible == null || ins.homeValue == null) {
      out.push({
        what: 'Deductible and home value',
        effect:
          'The deductible-to-home-value check that feeds §6 viability cannot be evidenced without both figures.',
      });
    }
    if (ins.priorClaimsWithin3Years == null) {
      out.push({
        what: 'Prior-claims history',
        effect:
          'A prior claim within 3 years is a §6 viability factor; unknown history leaves that factor unassessed.',
      });
    }
    const ev = ins.collateralEvidence;
    const unchecked = ev
      ? COLLATERAL_ZONES.filter((z) => ev[z]?.checked !== true)
      : [...COLLATERAL_ZONES];
    if (unchecked.length > 0) {
      out.push({
        what: `Collateral zones not inspected: ${unchecked
          .map((z) => COLLATERAL_ZONE_LABELS[z])
          .join(', ')}`,
        effect:
          'Uninspected zones cannot corroborate the storm; the collateral leg of causation (§VIII / §6) is weaker for each missing zone.',
      });
    }
  }
  if (perSlope.length > 0) {
    const noCost = perSlope
      .filter((s) => s.cost?.repair_cost_slope == null)
      .map((s) => s.slope);
    if (noCost.length > 0) {
      out.push({
        what: `Stored RC figures for ${noCost.join(', ')}`,
        effect:
          'The Haag RC = D × U × R × A repair-versus-replacement comparison cannot be restated for these slopes.',
      });
    }
  }
  return out;
}

// -----------------------------------------------------------------------------
// Renderer — exported so callers can preview the HTML without printing
// -----------------------------------------------------------------------------

export function renderLongReportHtml(payload: LongReportPayload): string {
  const ins = payload.inspection;
  const { engine, perSlope, provenance } = resolveReportEngine(payload);
  const inspector = useInspectorProfileStore.getState().profile;
  const generatedAt = formatDateTime(new Date());
  const createdDate = formatDateShort(ins.createdAt);
  const threshold = thresholdFor(ins.material);
  const isInsurance = ins.kind === 'insurance_claim';
  const totalPhotos = ins.slopes.reduce((n, s) => n + s.photoPaths.length, 0);
  const triggeredCount = perSlope.filter((s) => s.haag_threshold_triggered).length;
  const missing = missingDataRegister(ins, perSlope);
  const brittleResult =
    ins.brittlenessProtocol?.result ?? legacyBrittlenessToResult(ins.brittlenessTest);
  // Slope-by-slope supplementary facts (photo counts) come from the
  // inspection record and only when it aligns 1:1 with the engine's
  // per-slope array — a mismatch is disclosed instead of guessed at.
  const aligned = ins.slopes.length === perSlope.length;

  // ── 03. Weather & Event ──────────────────────────────────────────────────
  const reportedDol = ins.dateOfLoss;
  const eventDate = ins.event?.date;
  let dolPara: string;
  if (reportedDol && eventDate) {
    const same = formatDateShort(reportedDol) === formatDateShort(eventDate);
    dolPara = `<p>Reported date of loss: <strong>${esc(formatDateShort(reportedDol))}</strong> ·
      Verified event date: <strong>${esc(formatDateShort(eventDate))}</strong>${
        same
          ? ' — the dates align.'
          : '. <strong>The reported and verified dates differ.</strong> Carriers match date-of-loss strictly; reconcile before submission.'
      }</p>`;
  } else if (reportedDol) {
    dolPara = `<p>Reported date of loss: <strong>${esc(formatDateShort(reportedDol))}</strong>.
      No verified storm event is attached to corroborate it — this weakens causation and should be
      closed before submission.</p>`;
  } else {
    dolPara = '';
  }
  const weatherBlock = ins.event
    ? `<table>
        <tr><th>Event type</th><td>${esc(ins.event.kind)}</td></tr>
        <tr><th>Event date</th><td>${esc(formatDateShort(ins.event.date))}</td></tr>
        ${ins.event.hailSizeInches != null ? `<tr><th>Reported hail size</th><td>${ins.event.hailSizeInches}&quot; (storm record — not a measured impact size on this roof)</td></tr>` : ''}
        ${ins.event.windSpeedMph != null ? `<tr><th>Peak wind</th><td>${ins.event.windSpeedMph} mph</td></tr>` : ''}
        ${ins.event.distanceMiles != null ? `<tr><th>Distance from property</th><td>${ins.event.distanceMiles.toFixed(1)} mi</td></tr>` : ''}
        <tr><th>Source</th><td>${ins.event.source === 'NOAA' ? 'NOAA Storm Events Database' : esc(ins.event.source)}</td></tr>
      </table>`
    : `<div class="callout warn"><strong>No verified weather event is attached to this inspection.</strong>
       The &quot;cause&quot; leg of the claim is undocumented in this report, which materially reduces
       confidence in storm attribution regardless of the physical evidence. Attaching the NOAA event
       for the date of loss is the single strongest addition available.</div>`;

  // ── 05. Slope-by-Slope ───────────────────────────────────────────────────
  const slopeOverviewRows = perSlope
    .map(
      (s) =>
        `<tr>
          <td>${esc(s.slope)}</td>
          <td>${s.hail_hits_per_square}</td>
          <td>${s.wind_creased_count}</td>
          <td>${s.missing_shingles}</td>
          <td>${esc(s.brittleness_result)}</td>
          <td>${s.haag_threshold_triggered ? '<span class="pill pill-burnt">Triggered</span>' : '<span class="pill pill-slate">Not triggered</span>'}</td>
          <td>${esc(s.recommended_action)}</td>
        </tr>`,
    )
    .join('');
  const slopeCards = perSlope
    .map((s, i) => {
      const insSlope = aligned ? ins.slopes[i] : undefined;
      const meta =
        `Hail ${s.hail_hits_per_square}/sq · Wind-creased ${s.wind_creased_count} · ` +
        `Missing ${s.missing_shingles} · Brittleness ${s.brittleness_result} · ` +
        `HAAG threshold ${s.haag_threshold_triggered ? 'triggered' : 'not triggered'}` +
        (insSlope
          ? ` · ${insSlope.photoPaths.length} photo${insSlope.photoPaths.length === 1 ? '' : 's'} on file`
          : '');
      return `<div class="slope-card">
        <h3>${esc(s.slope)} <span class="pill ${ACTION_PILL[s.recommended_action]}">${esc(s.recommended_action)}</span></h3>
        <div class="slope-meta">${esc(meta)}</div>
        ${s.collateral_damage.length > 0 ? `<p class="muted">Collateral documented: ${esc(s.collateral_damage.join(', '))}</p>` : ''}
        <p class="reasoning">${esc(s.justification)}</p>
        <p class="cite">${esc(costNarrative(s.slope, s.cost))}</p>
      </div>`;
    })
    .join('');
  const slopeSection =
    perSlope.length === 0
      ? `<p class="reasoning">The engine payload contains no per-slope results${
          ins.slopes.length > 0
            ? `, although ${ins.slopes.length} slope${ins.slopes.length === 1 ? ' was' : 's were'} captured — slope-level determinations cannot be restated until the engine emits them`
            : ''
        }.</p>`
      : `<table>
          <thead><tr><th>Slope</th><th>Hail/sq</th><th>Wind-creased</th><th>Missing</th><th>Brittleness</th><th>HAAG threshold</th><th>Action</th></tr></thead>
          <tbody>${slopeOverviewRows}</tbody>
        </table>
        ${!aligned && ins.slopes.length > 0 ? `<p class="cite">Note: the engine reports ${perSlope.length} slope result(s) while the inspection record holds ${ins.slopes.length} captured slope(s); per-slope photo counts are omitted rather than guessed.</p>` : ''}
        ${slopeCards}`;

  // ── 06. Collateral ───────────────────────────────────────────────────────
  const engineCollateral = perSlope.filter((s) => s.collateral_damage.length > 0);
  const ev = ins.collateralEvidence;
  const zoneRows = ev
    ? COLLATERAL_ZONES.map((zone) => {
        const item = ev[zone];
        const checked = item?.checked === true;
        const photoCount = item?.photoIds.length ?? 0;
        return `<tr>
          <td>${esc(COLLATERAL_ZONE_LABELS[zone])}</td>
          <td>${checked ? '<span class="pill pill-ok">Inspected</span>' : '<span class="pill pill-slate">Not inspected</span>'}</td>
          <td>${photoCount > 0 ? `${photoCount} on file` : '<span class="muted">None</span>'}</td>
          <td>${item?.note ? esc(item.note) : '<span class="muted">—</span>'}</td>
        </tr>`;
      }).join('')
    : '';
  const legacyChecklist = Object.entries(ins.collateralChecklist);
  const collateralSection = `
    ${engineCollateral.length > 0
      ? `<table>
          <thead><tr><th>Slope</th><th>Collateral documented by the engine</th></tr></thead>
          <tbody>${engineCollateral
            .map((s) => `<tr><td>${esc(s.slope)}</td><td>${esc(s.collateral_damage.join(', '))}</td></tr>`)
            .join('')}</tbody>
        </table>`
      : '<p class="muted">The engine records no per-slope collateral damage on this inspection.</p>'}
    ${ev
      ? `<h3>Collateral evidence zones (Professional Report §VIII)</h3>
        <table>
          <thead><tr><th>Zone</th><th>Status</th><th>Photos</th><th>Note</th></tr></thead>
          <tbody>${zoneRows}</tbody>
        </table>`
      : ''}
    ${legacyChecklist.length > 0
      ? `<h3>Quick observations</h3>
        <table>${legacyChecklist
          .map(
            ([k, v]) =>
              `<tr><th>${esc(k.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()))}</th><td>${v ? '<span class="pill pill-ok">Yes</span>' : '<span class="pill pill-slate">No</span>'}</td></tr>`,
          )
          .join('')}</table>`
      : ''}
    <p class="cite">Collateral corroborates the storm event — it is not itself roof damage. Under the
    Haag claimability protocol (§6), collateral corroboration is defensible within two years of the
    weather incident.</p>`;

  // ── 07. Conclusions ──────────────────────────────────────────────────────
  const conclusionsSection = `
    <p><strong>Roof-level determination (stored):</strong> the RoofWise decision engine recommends
    <strong>${esc(RECOMMENDATION_SENTENCE[engine.roofwise_recommendation])}</strong>.
    Claim viability is banded <strong>${esc(VIABILITY_LABEL[engine.claim_viability])}</strong> —
    ${esc(VIABILITY_SENTENCE[engine.claim_viability])}.</p>
    <h3>Policy notes</h3>
    ${engine.policy_notes.trim() ? `<p>${esc(engine.policy_notes.trim())}</p>` : '<p class="muted">No policy notes recorded by the engine.</p>'}
    <h3>Carrier-specific requirements</h3>
    ${engine.carrier_specific_requirements.length > 0
      ? `<ul class="cite-list">${engine.carrier_specific_requirements.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p class="muted">None recorded by the engine.</p>'}
    <h3>Evidence required</h3>
    ${engine.evidence_required.length > 0
      ? `<ul class="cite-list">${engine.evidence_required.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
      : '<p class="muted">None recorded by the engine.</p>'}
    <h3>Record completeness &amp; effect on confidence</h3>
    ${missing.length > 0
      ? `<p class="muted">Missing data is disclosed here rather than assumed (§9). None of these gaps
         alters the stored determinations above — they describe how firmly each determination can be
         defended.</p>
        <table>
          <thead><tr><th>What is missing</th><th>How it affects confidence</th></tr></thead>
          <tbody>${missing
            .map((m) => `<tr><td>${esc(m.what)}</td><td>${esc(m.effect)}</td></tr>`)
            .join('')}</tbody>
        </table>`
      : '<p class="muted">No gaps identified in the inspection record.</p>'}
    <div class="callout"><strong>Presentation contract.</strong> This report is generated from the
    stored RoofWise decision-engine output for this inspection, per the Haag Decision Engine
    specification (§9). It restates stored values in words; it does not recalculate the Haag
    RC = D × U × R × A cost figures, re-derive any recommendation, or override any stored
    determination. ${esc(provenance)}</div>`;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(ins.reportId)} — Long Report</title>
<style>${REPORT_BASE_CSS}</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="brand">
      <div class="mark">RW</div>
      <div class="name">RoofWise</div>
      <div class="cert">${isInsurance ? 'Long Report · Insurance Claim' : 'Long Report · Haag Protocol'}</div>
    </div>
    <h1>Long-Form<br/>Inspection Report</h1>
    <div class="sub">${esc(ins.reportId)} · Inspected ${esc(createdDate)}</div>
    <div class="meta-grid">
      <div><div class="label">Customer</div><div class="value">${esc(ins.customerName)}</div></div>
      <div><div class="label">Property</div><div class="value">${esc(ins.address)}</div></div>
      <div><div class="label">Carrier</div><div class="value">${ins.carrier ? esc(INSURANCE_CARRIER_LABELS[ins.carrier]) : '—'}</div></div>
      <div><div class="label">Claim number</div><div class="value">${esc(ins.claimNumber ?? '—')}</div></div>
      <div>
        <div class="label">Inspector of record</div>
        <div class="value">${inspector.fullName ? esc(inspector.fullName) : '—'}${inspector.haagCertified ? ' · Haag Certified' : ''}${inspector.haagCertificationNumber ? ` (${esc(inspector.haagCertificationNumber)})` : ''}</div>
      </div>
      <div><div class="label">Date of loss</div><div class="value">${ins.dateOfLoss ? esc(formatDateShort(ins.dateOfLoss)) : ins.event ? esc(formatDateShort(ins.event.date)) : 'Not attached'}</div></div>
    </div>
  </div>

  <h2><span class="n">01</span>Report Information</h2>
  <table>
    <tr><th>Report</th><td>${esc(ins.reportId)} — RoofWise Long-Form Inspection Report</td></tr>
    <tr><th>Report kind</th><td>${isInsurance ? 'Insurance Claim' : 'General Inspection'}</td></tr>
    ${isInsurance ? `<tr><th>Cause of loss</th><td>${ins.causeOfLoss ? esc(CAUSE_OF_LOSS_LABELS[ins.causeOfLoss]) : 'Not recorded'}</td></tr>` : ''}
    ${isInsurance ? `<tr><th>Policy type</th><td>${ins.policyType ? esc(POLICY_TYPE_LABELS[ins.policyType]) : 'Not recorded'}</td></tr>` : ''}
    <tr><th>Inspection date</th><td>${esc(createdDate)}</td></tr>
    <tr><th>Generated</th><td>${esc(generatedAt)}</td></tr>
    <tr><th>Property</th><td>${esc(ins.address)}</td></tr>
    <tr><th>Customer</th><td>${esc(ins.customerName)}</td></tr>
    ${ins.adjusterName ? `<tr><th>Adjuster</th><td>${esc(ins.adjusterName)}</td></tr>` : ''}
    ${ins.policyNumber ? `<tr><th>Policy number</th><td>${esc(ins.policyNumber)}</td></tr>` : ''}
    <tr><th>Photographs on file</th><td>${totalPhotos} across ${ins.slopes.length} slope${ins.slopes.length === 1 ? '' : 's'} — the complete photographic record, with per-photo analysis status, is carried in the companion RoofWise HAAG Certified Report</td></tr>
  </table>

  <h2><span class="n">02</span>Executive Summary</h2>
  <div class="summary-grid">
    <div class="summary-stat accent"><div class="stat-value-text">${esc(RECOMMENDATION_LABEL[engine.roofwise_recommendation])}</div><div class="stat-label">Engine recommendation</div></div>
    <div class="summary-stat"><div class="stat-value-text"><span class="pill ${VIABILITY_PILL[engine.claim_viability]}">${esc(VIABILITY_LABEL[engine.claim_viability])}</span></div><div class="stat-label">Claim viability band</div></div>
    <div class="summary-stat"><div class="stat-value-text"><span class="pill ${SAFETY_PILL[engine.roofer_safety_rating]}">${esc(SAFETY_LABEL[engine.roofer_safety_rating])}</span></div><div class="stat-label">Roofer safety rating</div></div>
    <div class="summary-stat"><div class="stat-value">${triggeredCount}/${perSlope.length}</div><div class="stat-label">Slopes past HAAG threshold</div></div>
  </div>
  <p><strong>Stored recommendation:</strong> the RoofWise decision engine recommends
  <span class="pill ${RECOMMENDATION_PILL[engine.roofwise_recommendation]}">${esc(RECOMMENDATION_LABEL[engine.roofwise_recommendation])}</span>
  — ${esc(RECOMMENDATION_SENTENCE[engine.roofwise_recommendation])}.</p>
  <p><strong>Claim viability:</strong> banded <strong>${esc(VIABILITY_LABEL[engine.claim_viability])}</strong>
  under the Haag claimability protocol (§6) — ${esc(VIABILITY_SENTENCE[engine.claim_viability])}.
  Viability is deliberately a band, not a numeric score.</p>
  <p><strong>Safety:</strong> ${esc(SAFETY_SENTENCE[engine.roofer_safety_rating])}.</p>
  <p class="reasoning">${esc(engine.detailed_explanation)}</p>

  <h2><span class="n">03</span>Weather &amp; Event</h2>
  ${weatherBlock}
  ${dolPara}

  <h2><span class="n">04</span>Roof System</h2>
  <table>
    <tr><th>Material</th><td>${esc(ROOF_MATERIAL_LABELS[ins.material])}</td></tr>
    <tr><th>Age</th><td>${ins.ageYears} years</td></tr>
    <tr><th>Geometry</th><td>${esc(ins.geometry)}</td></tr>
    <tr><th>Condition</th><td>${esc(ins.condition)}</td></tr>
    <tr><th>Brittleness test</th><td>${brittleResult ? esc(brittleResult) : 'Not tested — disclosed in Section 07'}</td></tr>
    <tr><th>Governing Haag standard</th><td><strong>${esc(threshold.rule)}</strong></td></tr>
  </table>
  <p class="cite">The governing standard is quoted verbatim so the reader can check the engine's
  work. It is applied by the decision engine; this report does not re-apply it.</p>

  <h2><span class="n">05</span>Slope-by-Slope Findings</h2>
  ${slopeSection}

  <h2><span class="n">06</span>Collateral Evidence</h2>
  ${collateralSection}

  <h2><span class="n">07</span>Conclusions</h2>
  ${conclusionsSection}

  <h2><span class="n">08</span>Inspector Certification</h2>
  <p class="muted">The inspector of record certifies that the observations restated in this report
  were collected under Haag test-square methodology, that the determinations above quote the
  RoofWise decision engine's stored output without modification, and that where confidence values
  are recorded on individual observations they describe the AI's certainty in that observation —
  they are not accuracy claims and are never presented as such.</p>
  <table>
    <tr><th>Inspector of record</th><td>${inspector.fullName ? esc(inspector.fullName) : '<span class="muted">Not recorded</span>'}</td></tr>
    <tr><th>Haag certification</th><td>${
      inspector.haagCertified
        ? `<span class="pill pill-ok">Certified</span>${inspector.haagCertificationNumber ? ` ${esc(inspector.haagCertificationNumber)}` : ' <span class="muted">(number not recorded)</span>'}`
        : '<span class="muted">Not recorded on the inspector profile</span>'
    }</td></tr>
    <tr><th>License number</th><td>${inspector.licenseNumber ? esc(inspector.licenseNumber) : '<span class="muted">Not recorded</span>'}</td></tr>
    <tr><th>Years of experience</th><td>${inspector.yearsExperience > 0 ? inspector.yearsExperience : '<span class="muted">Not recorded</span>'}</td></tr>
  </table>
  <div class="sig-row">
    <div class="sig-box">
      ${ins.inspectorSignatureSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="76" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"><path d="${esc(ins.inspectorSignatureSvg)}" stroke="#0E1330" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><br/>`
        : ''}
      ${inspector.fullName ? `${esc(inspector.fullName)} — ` : ''}Inspector of record${ins.signedAt ? ` · ${esc(formatDateShort(ins.signedAt))}` : ''}
    </div>
    <div class="sig-box">
      ${ins.homeownerSignatureSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="230" height="76" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"><path d="${esc(ins.homeownerSignatureSvg)}" stroke="#0E1330" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><br/>`
        : ''}
      Homeowner acknowledgement
    </div>
  </div>

  <div class="footer">
    <strong>RoofWise Long-Form Inspection Report</strong> · ${esc(ins.reportId)}<br/>
    Generated ${esc(generatedAt)} · Restates the stored RoofWise decision-engine output · ${ins.slopes.length} slope${ins.slopes.length === 1 ? '' : 's'} inspected<br/>
    ${esc(provenance)}
  </div>
</div>
</body>
</html>`;
}
