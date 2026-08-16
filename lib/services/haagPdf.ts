import { formatDateShort, formatDateTime } from '@/lib/format/date';
// HAAG-style PDF report generator.
// Uses expo-print to render an HTML template to a PDF on disk.
//
// Two variants from one template:
//   • General — the approved 12-section RoofWise HAAG Certified Report
//     (cover, methodology, summary, storm, roof system, slopes with the
//     complete photo record, photo index, uncertainty register, notes,
//     collateral, narrative, homeowner summary, signatures).
//   • Insurance — when ins.kind === 'insurance_claim', the same 12 sections
//     PLUS the six-section Insurance Claim Supplement (Professional Report
//     doc §VI–IX): hail test-square table, brittleness repairability
//     narrative with protocol photos, per-finding HAAG rule citations,
//     causation, carrier-norm negotiation context, credentials & code notes.
//
// The 8-section narrative Long Report lives in lib/services/longReport.ts
// and shares REPORT_BASE_CSS / esc from this file.
//
// This implementation is the v1: clean HTML + CSS via expo-print. PencilKit
// signatures and per-photo damage marker overlays will come in a follow-up
// once the image-overlay pipeline is built.

import * as Print from 'expo-print';
import * as ImageManipulator from 'expo-image-manipulator';
import type {
  BrittlenessResult,
  DamageCategory,
  Inspection,
  RoofMaterial,
} from '../models/types';
import {
  CAUSE_OF_LOSS_LABELS,
  COLLATERAL_ZONES,
  COLLATERAL_ZONE_LABELS,
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  POLICY_TYPE_LABELS,
  ROOF_MATERIAL_LABELS,
  legacyBrittlenessToResult,
} from '../models/types';
import type { InspectorProfile } from '../stores/inspectorProfileStore';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import {
  CARRIER_IMPACT_NORM_NOTE,
  CLAIM_VIABILITY_LABELS,
  claimWorthiness,
  damageScore,
  evaluate,
  legacyObservation,
} from './decisionEngine';
import { tripleCheckDateOfLoss } from './stormMatch';
import { evaluateMaterialThreshold, thresholdFor } from './haagThresholds';
import {
  CONFIDENCE_BOUNDS,
  TIER_LABEL,
  TIER_MEANING,
  TIER_SHORT,
  averageConfidence,
  tierFor,
  type ConfidenceTier,
} from './confidenceTiers';

export type GeneratedReport = {
  uri: string;
  inspection: Inspection;
};

export async function generateHaagReport(inspection: Inspection): Promise<GeneratedReport> {
  const photoMap = await preparePhotoDataUris(inspection);
  const brittlenessPhotos = await prepareBrittlenessPhotoUris(inspection);
  const html = renderHtml(inspection, photoMap, brittlenessPhotos);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri, inspection };
}

export type ReportPhoto = {
  /** Index into slope.photoPaths — the photo's number on that slope. */
  index: number;
  dataUri: string;
  /** Whether Gemini actually reviewed this photo. */
  analyzed: boolean;
  /** Findings attributed to this photo. */
  findingCount: number;
  /** Mean detection confidence on this photo, or null when it has none. */
  avgConfidence: number | null;
  /** Presentation tier derived from avgConfidence (spec confidence layer). */
  tier: ConfidenceTier | null;
};

/** Was this photo run through Gemini? */
function wasAnalyzed(slope: Inspection['slopes'][number], index: number): boolean {
  // Back-compat: inspections captured before `analyzedPhotoIndices` existed
  // have no record either way. Treat their photos as analyzed rather than
  // labelling a genuinely-reviewed photo "not analyzed" in a claim packet.
  if (!slope.analyzedPhotoIndices) return true;
  return slope.analyzedPhotoIndices.includes(index);
}

/**
 * Downscale EVERY captured photo per slope and inline as data URIs.
 *
 * All photos ship, not just analyzed ones: a photo the inspector took is
 * evidence, and a carrier questioning a finding wants the documentation —
 * an absent photo reads as an absent observation. Whether Gemini reviewed
 * a given photo is a per-photo label (see ReportPhoto.analyzed), never a
 * filter. There is no cap.
 *
 * Returns index-carrying records rather than a flat URI array so a photo
 * that's missing from disk can't shift every subsequent photo's number and
 * analyzed-label out of alignment.
 */
async function preparePhotoDataUris(
  ins: Inspection,
): Promise<Record<string, ReportPhoto[]>> {
  const map: Record<string, ReportPhoto[]> = {};
  for (const slope of ins.slopes) {
    const encoded: ReportPhoto[] = [];
    for (let index = 0; index < slope.photoPaths.length; index++) {
      const uri = slope.photoPaths[index];
      if (typeof uri !== 'string') continue;
      const dataUri = await encodeJpegDataUri(uri);
      if (dataUri) {
        const marks = slope.damage.filter((m) => m.photoIndex === index);
        const avg = averageConfidence(marks.map((m) => m.confidence));
        encoded.push({
          index,
          dataUri,
          analyzed: wasAnalyzed(slope, index),
          findingCount: marks.length,
          avgConfidence: avg,
          tier: avg === null ? null : tierFor(avg),
        });
      }
    }
    if (encoded.length > 0) map[slope.id] = encoded;
  }
  return map;
}

/**
 * Downscale + inline one photo as a JPEG data URI. Returns null when the file
 * is missing on disk (restored backup, other device) — callers skip it.
 */
async function encodeJpegDataUri(uri: string): Promise<string | null> {
  try {
    const out = await ImageManipulator.manipulateAsync(
      uri,
      [{ resize: { width: 700 } }],
      { compress: 0.55, format: ImageManipulator.SaveFormat.JPEG, base64: true },
    );
    return out.base64 ? `data:image/jpeg;base64,${out.base64}` : null;
  } catch {
    return null;
  }
}

/**
 * Brittleness field-protocol photos (Professional Report §VII-C): the test
 * process and result must be photographed. These embed in the Insurance
 * Claim Supplement as the evidence behind the repairability conclusion.
 */
async function prepareBrittlenessPhotoUris(ins: Inspection): Promise<string[]> {
  const ids = ins.brittlenessProtocol?.photoIds ?? [];
  const encoded: string[] = [];
  for (const uri of ids) {
    const dataUri = await encodeJpegDataUri(uri);
    if (dataUri) encoded.push(dataUri);
  }
  return encoded;
}

/**
 * Shared print stylesheet for every RoofWise report variant. The Long Report
 * (lib/services/longReport.ts) imports this so the two documents read as one
 * product. PDF-only CSS — theme/tokens.ts (Drift #11) governs app UI, not
 * print output; these values match the report design approved with the
 * 12-section report.
 */
export const REPORT_BASE_CSS = `
  :root {
    --royal: #2B4EF5;
    --royal-deep: #1B31A8;
    --ink: #0E1330;
    --royal-soft: #E4E9FE;
    --burnt: #D9541E;
    --burnt-soft: #FBE7DD;
    --slate: #5A6180;
    --line: #E6E8F0;
    --paper: #F5F6FA;
    --ok: #1E9E62;
    --warn: #C77A0A;
    --bad: #D93A3F;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    color: var(--ink); margin: 0; padding: 0; background: #fff;
    -webkit-font-smoothing: antialiased;
  }
  .page { padding: 32px 40px; }

  /* Cover */
  .cover {
    background: linear-gradient(135deg, var(--ink) 0%, var(--royal-deep) 68%, var(--royal) 130%);
    color: #fff; padding: 52px 40px 40px; margin: -32px -40px 28px;
  }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand .mark {
    width: 42px; height: 42px; border-radius: 13px; background: var(--royal);
    display: flex; align-items: center; justify-content: center;
    font-weight: 800; font-size: 15px; letter-spacing: 0.5px;
    border: 1.5px solid rgba(255,255,255,0.25);
  }
  .brand .name { font-size: 21px; font-weight: 800; letter-spacing: -0.4px; }
  .brand .cert {
    margin-left: auto; font-size: 9.5px; font-weight: 700; letter-spacing: 1.2px;
    text-transform: uppercase; padding: 6px 12px; border-radius: 999px;
    border: 1.5px solid rgba(255,255,255,0.35); color: rgba(255,255,255,0.95);
  }
  .cover h1 { font-size: 31px; margin: 30px 0 4px; font-weight: 800; letter-spacing: -0.8px; }
  .cover .sub { color: rgba(255,255,255,0.72); font-size: 13.5px; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 15px 32px; margin-top: 30px; }
  .meta-grid .label {
    font-size: 9.5px; color: rgba(255,255,255,0.6); text-transform: uppercase;
    letter-spacing: 1px; font-weight: 700;
  }
  .meta-grid .value { font-size: 15px; font-weight: 600; margin-top: 3px; }

  h2 {
    font-size: 15px; color: var(--ink); margin: 32px 0 12px; font-weight: 800;
    letter-spacing: 0.4px; text-transform: uppercase;
    padding-bottom: 7px; border-bottom: 2px solid var(--royal);
  }
  h2 .n { color: var(--royal); margin-right: 8px; }
  h3 { font-size: 13.5px; color: var(--ink); margin: 16px 0 6px; font-weight: 700; }
  p { font-size: 12.5px; line-height: 1.6; color: var(--ink); }
  .muted { color: var(--slate); }

  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th, td { text-align: left; padding: 9px 11px; border-bottom: 1px solid var(--line); }
  th { background: var(--paper); color: var(--slate); font-weight: 700; font-size: 10px;
       text-transform: uppercase; letter-spacing: 0.7px; }

  .pill { display: inline-block; padding: 3px 9px; border-radius: 999px; font-size: 9.5px;
          font-weight: 800; text-transform: uppercase; letter-spacing: 0.7px; }
  .pill-burnt { background: var(--burnt); color: #fff; }
  .pill-royal { background: var(--royal); color: #fff; }
  .pill-soft  { background: var(--royal-soft); color: var(--royal-deep); }
  .pill-slate { background: var(--paper); color: var(--slate); border: 1px solid var(--line); }
  .pill-ok    { background: var(--ok); color: #fff; }
  .pill-warn  { background: var(--warn); color: #fff; }
  .pill-bad   { background: var(--bad); color: #fff; }

  .summary-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 10px; margin: 14px 0 18px; }
  .summary-stat { background: var(--paper); padding: 14px; border-radius: 11px; border-top: 3px solid var(--royal); }
  .summary-stat.accent { border-top-color: var(--burnt); }
  .summary-stat .stat-value { font-size: 23px; font-weight: 800; color: var(--ink); letter-spacing: -0.5px; }
  .summary-stat .stat-value-text { font-size: 14.5px; font-weight: 800; color: var(--ink); letter-spacing: -0.2px; line-height: 1.3; margin-top: 4px; }
  .summary-stat .stat-label { font-size: 9px; color: var(--slate); text-transform: uppercase;
                              letter-spacing: 0.8px; margin-top: 4px; font-weight: 700; }

  .callout { background: var(--royal-soft); border-left: 4px solid var(--royal);
             padding: 13px 15px; border-radius: 9px; margin: 12px 0;
             font-size: 11.5px; line-height: 1.6; color: var(--ink); }
  .callout.warn { background: #FDF3E3; border-left-color: var(--warn); }
  .callout strong { color: var(--royal-deep); }
  .callout.warn strong { color: var(--warn); }

  .slope-card { border: 1px solid var(--line); border-radius: 12px; padding: 15px; margin: 11px 0; }
  .slope-card h3 { margin-top: 0; display: flex; align-items: center; gap: 8px; }
  .slope-meta { font-size: 11px; color: var(--slate); margin: 2px 0 8px; }

  .photo-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 11px; margin: 10px 0 4px; }
  .photo-fig { margin: 0; }
  .slope-photo { width: 100%; aspect-ratio: 4 / 3; border-radius: 7px; object-fit: cover;
                 display: block; border: 1px solid var(--line); }
  .photo-fig figcaption { font-size: 8.5px; color: var(--slate); margin-top: 4px; line-height: 1.4; }
  .photo-fig .tag { font-weight: 800; letter-spacing: 0.3px; }
  .tag-high { color: var(--ok); }
  .tag-moderate { color: var(--warn); }
  .tag-uncertain { color: var(--bad); }
  .tag-none { color: var(--slate); }

  .reasoning { font-style: italic; color: var(--slate); font-size: 11.5px; margin-top: 8px; }

  /* Homeowner section — the only part most owners read end to end, so it
     gets a longer measure and more air than the adjuster-facing sections. */
  .homeowner p { font-size: 12.5px; line-height: 1.75; margin: 0 0 11px; }
  .homeowner p:last-child { margin-bottom: 0; }
  .homeowner strong { color: var(--royal-deep); }

  /* ── Insurance Claim Supplement (Professional Report §VI–IX) ── */
  .supp-banner { background: var(--burnt-soft); border: 1.5px solid var(--burnt);
                 border-radius: 11px; padding: 14px 16px; margin: 30px 0 4px; }
  .supp-banner .supp-kicker { font-size: 9.5px; font-weight: 800; letter-spacing: 1.2px;
                              text-transform: uppercase; color: var(--burnt); }
  .supp-banner .supp-title { font-size: 16px; font-weight: 800; color: var(--ink); margin-top: 3px; }
  .supp-banner p { margin: 6px 0 0; font-size: 11px; line-height: 1.55; }
  h2.supp { border-bottom-color: var(--burnt); }
  h2.supp .n { color: var(--burnt); }
  .negotiation { border: 2px dashed var(--slate); background: var(--paper); border-radius: 9px;
                 padding: 13px 15px; margin: 12px 0; font-size: 11.5px; line-height: 1.6;
                 color: var(--ink); }
  .negotiation .neg-kicker { display: block; font-size: 9px; font-weight: 800;
                             letter-spacing: 1.1px; text-transform: uppercase;
                             color: var(--slate); margin-bottom: 5px; }
  .cite { font-size: 10.5px; color: var(--slate); font-style: italic; line-height: 1.5; }
  ul.cite-list { margin: 6px 0 10px; padding-left: 18px; }
  ul.cite-list li { font-size: 11px; line-height: 1.55; margin: 4px 0; }

  @media print {
    .slope-card, table, .sig-row, .photo-fig, .callout { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .cover { page-break-after: avoid; }
  }
  .slope-card, table, .sig-row, .photo-fig, .callout, .supp-banner, .negotiation { break-inside: avoid; }

  .footer { text-align: center; color: var(--slate); font-size: 9px; padding: 20px 0;
            border-top: 1px solid var(--line); margin-top: 34px; line-height: 1.7; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 24px; }
  .sig-box { border-top: 1.5px solid var(--ink); padding-top: 8px; font-size: 10.5px; color: var(--slate); }
`;

function renderHtml(
  ins: Inspection,
  photoMap: Record<string, ReportPhoto[]> = {},
  brittlenessPhotos: string[] = [],
): string {
  // Evaluated as of report-generation time so the §6 two-year corroboration
  // rule participates (months_since_event stays undefined without an asOf —
  // a 3-year-old storm must render the mandated LOW band, not skip the rule).
  // Follow-up (BACKLOG): persist the HaagEngineResult with the inspection and
  // restate it here instead of re-deriving on every render.
  const decision = evaluate(ins, new Date().toISOString());
  const score = damageScore(ins);
  const worthiness = claimWorthiness(decision, score);
  // Triple-Check (§6): pure DOL-vs-event corroboration verdict for Section 03.
  // Prefers the reported date of loss (claim mode); falls back to the attached
  // event's own date for general inspections.
  const tripleCheck = ins.event
    ? tripleCheckDateOfLoss({
        reportedDateOfLoss: ins.dateOfLoss ?? ins.event.date,
        events: [ins.event],
      })
    : undefined;
  const hasHailFindings = ins.slopes.some((s) => s.hailCount > 0 || s.bruisingCount > 0);
  const threshold = thresholdFor(ins.material);
  const inspector = useInspectorProfileStore.getState().profile;
  const generatedAt = formatDateTime(new Date());
  const createdDate = formatDateShort(ins.createdAt);
  // Insurance variant (Professional Report doc §VI–IX): the approved
  // 12-section report renders unchanged; claim-mode inspections additionally
  // get the six-section Insurance Claim Supplement before certification.
  const isInsurance = ins.kind === 'insurance_claim';

  const totalPhotos = ins.slopes.reduce((n, s) => n + s.photoPaths.length, 0);

  // Everything below the high-confidence boundary, disclosed rather than
  // quietly dropped. A carrier that finds a soft finding you hid discredits
  // the whole packet; a carrier handed the list up front does not.
  const uncertainFindings = ins.slopes.flatMap((slope, si) => {
    const slopeLabel = `Slope ${si + 1} · ${slope.orientation}`;
    return slope.damage
      .filter((m) => m.confidence < CONFIDENCE_BOUNDS.high)
      .map((m) => ({
        slopeLabel,
        photo: typeof m.photoIndex === 'number' ? m.photoIndex : null,
        category: DAMAGE_CATEGORY_LABELS[m.category] ?? String(m.category).replace(/_/g, ' '),
        confidence: Math.round(m.confidence),
        tier: tierFor(m.confidence),
      }))
      .sort((a, b) => a.confidence - b.confidence);
  });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(ins.reportId)} — HAAG Report</title>
<style>${REPORT_BASE_CSS}</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="brand">
      <div class="mark">RW</div>
      <div class="name">RoofWise</div>
      <div class="cert">${isInsurance ? 'Haag Protocol · Insurance Claim' : 'Haag Protocol'}</div>
    </div>
    <h1>HAAG Certified<br/>Roof Damage Report</h1>
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
      ${isInsurance ? `
      <div><div class="label">Cause of loss</div><div class="value">${ins.causeOfLoss ? esc(CAUSE_OF_LOSS_LABELS[ins.causeOfLoss]) : 'Not recorded'}</div></div>
      <div><div class="label">Policy type</div><div class="value">${ins.policyType ? esc(POLICY_TYPE_LABELS[ins.policyType]) : 'Not recorded'}</div></div>` : ''}
    </div>
  </div>

  <h2><span class="n">01</span>Methodology &amp; Certification</h2>
  <div class="callout">
    <strong>How this inspection was conducted.</strong> Damage was assessed against
    Haag Engineering functional-damage criteria for
    ${esc(ROOF_MATERIAL_LABELS[ins.material])} — <strong>${esc(threshold.rule)}</strong>
    Every slope was documented photographically and every finding carries an explicit
    severity and a 0–100 confidence value. Detections below ${CONFIDENCE_BOUNDS.reportingFloor}%
    confidence are not emitted at all; those between ${CONFIDENCE_BOUNDS.reportingFloor}% and
    ${CONFIDENCE_BOUNDS.high}% are reported but labelled uncertain and excluded from the
    roof-level verdict. <strong>Every photograph captured on this inspection is
    reproduced in this report</strong>, including those the AI did not analyze —
    nothing observed has been withheld.
  </div>

  <h2><span class="n">02</span>Executive Summary</h2>
  <div class="summary-grid">
    <div class="summary-stat"><div class="stat-value">${score}</div><div class="stat-label">Damage score</div></div>
    <div class="summary-stat"><div class="stat-value">${ins.slopes.length}</div><div class="stat-label">Slopes inspected</div></div>
    <div class="summary-stat"><div class="stat-value">${totalPhotos}</div><div class="stat-label">Photos on file</div></div>
    <div class="summary-stat accent"><div class="stat-value">${esc(CLAIM_VIABILITY_LABELS[decision.haag.claim_viability])}</div><div class="stat-label">Claim viability</div></div>
  </div>
  <p><strong>Roof-level recommendation:</strong> ${esc(formatRecommendation(decision.roofRecommendation))}.</p>
  <p class="reasoning">${esc(decision.roofVerdictReasoning)}</p>
  ${uncertainFindings.length > 0 ? `
    <div class="callout warn">
      <strong>${uncertainFindings.length} finding${uncertainFindings.length === 1 ? '' : 's'} flagged uncertain.</strong>
      These are listed in full in Section 07 and are <em>not</em> relied upon in the
      recommendation above. They are included so the record is complete and so on-site
      verification can be targeted.
    </div>` : ''}

  <h2><span class="n">03</span>Storm Verification</h2>
  ${ins.event
    ? `<p>${esc(ins.event.kind)} event on <strong>${esc(formatDateShort(ins.event.date))}</strong>${
        ins.event.hailSizeInches ? ` — ${ins.event.hailSizeInches}\" hail` : ''}${
        ins.event.windSpeedMph ? ` — ${ins.event.windSpeedMph} mph wind` : ''}${
        ins.event.distanceMiles ? ` — ${ins.event.distanceMiles.toFixed(1)} mi from the property` : ''}.
        ${ins.event.source === 'NOAA' ? 'Source: NOAA Storm Events Database.' : `Source: ${esc(ins.event.source)}.`}</p>`
    : '<p class="reasoning">No verified storm event is attached to this inspection. Attaching the NOAA event for the date of loss materially strengthens causation.</p>'}
  ${tripleCheck
    ? tripleCheck.corroborated
      ? `<p class="reasoning">${esc(tripleCheck.note)}</p>`
      : `<div class="callout warn"><strong>Triple-Check review flag.</strong> ${esc(tripleCheck.note)}${
          hasHailFindings
            ? ' AI-detected hail damage is present on this roof — reconcile the reported date of loss before filing.'
            : ''
        }</div>`
    : ''}

  <h2><span class="n">04</span>Roof System &amp; Applicable Threshold</h2>
  <table>
    <tr><th>Material</th><td>${esc(ROOF_MATERIAL_LABELS[ins.material])}</td></tr>
    <tr><th>Age</th><td>${ins.ageYears} years</td></tr>
    <tr><th>Geometry</th><td>${esc(ins.geometry)}</td></tr>
    <tr><th>Condition</th><td>${esc(ins.condition)}</td></tr>
    <tr><th>Brittleness test</th><td>${esc(ins.brittlenessTest.replace(/_/g, ' '))}</td></tr>
    <tr><th>Haag threshold applied</th><td><strong>${esc(threshold.rule)}</strong></td></tr>
  </table>

  <h2><span class="n">05</span>Slope-by-Slope Findings</h2>
  ${
    ins.slopes.length === 0
      ? '<p class="reasoning">No slopes were captured for this inspection.</p>'
      : ins.slopes
          .map((slope, i) => {
            const slopeResult = decision.perSlope.find((r) => r.slopeId === slope.id);
            const verdict = slopeResult?.verdict ?? 'repair';
            const pillClass =
              verdict === 'full_replace' || verdict === 'partial_replace'
                ? 'pill-burnt'
                : verdict === 'verify_with_inspector'
                ? 'pill-warn'
                : 'pill-slate';
            const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
            const photos = photoMap[slope.id] ?? [];
            const total = slope.photoPaths.length;
            const analyzedCount = photos.filter((p) => p.analyzed).length;
            const unreadable = total - photos.length;
            const caption =
              `${total} photo${total === 1 ? '' : 's'} captured` +
              ` · ${analyzedCount} AI-analyzed` +
              (unreadable > 0 ? ` · ${unreadable} unavailable` : '');
            return `<div class="slope-card">
        <h3>Slope ${i + 1} · ${esc(slope.orientation)} <span class="pill ${pillClass}">${esc(formatVerdict(verdict))}</span></h3>
        <div class="slope-meta">${caption} · Hail ${slope.hailCount} · Wind ${slope.windLiftCount} · Missing ${slope.missingCount} · Bruising ${slope.bruisingCount}</div>
        ${photos.length > 0 ? `<div class="photo-row">${photos.map((ph) => photoFigure(ph)).join('')}</div>` : ''}
        ${detected.length === 0
          ? '<p class="reasoning">No findings detected on this slope.</p>'
          : `<table><thead><tr><th>Category</th><th>Severity</th><th>Confidence</th><th>Assessment</th><th>Count</th></tr></thead><tbody>${detected
              .map((f) => {
                const t = tierFor(f.confidence);
                return `<tr><td>${esc(DAMAGE_CATEGORY_LABELS[f.label] ?? String(f.label).replace(/_/g, ' '))}</td><td>${esc(f.severity)}</td><td>${f.confidence}%</td><td><span class="pill ${t === 'high' ? 'pill-ok' : t === 'moderate' ? 'pill-warn' : 'pill-bad'}">${esc(TIER_SHORT[t])}</span></td><td>${f.count}</td></tr>`;
              })
              .join('')}</tbody></table>`}
        <p class="reasoning">${esc(slopeResult?.reasoning ?? '')}</p>
      </div>`;
          })
          .join('')
  }

  <h2><span class="n">06</span>Photo Evidence Index</h2>
  <p class="muted">Every photograph captured during this inspection, by slope, with its
  analysis status. Photos marked <em>reference</em> were captured but not submitted to AI
  analysis; they are included as part of the complete record.</p>
  <table>
    <thead><tr><th>Slope</th><th>Photo</th><th>Status</th><th>Findings</th><th>Confidence</th></tr></thead>
    <tbody>
      ${ins.slopes
        .map((slope, si) => {
          const photos = photoMap[slope.id] ?? [];
          if (slope.photoPaths.length === 0) {
            return `<tr><td>Slope ${si + 1} · ${esc(slope.orientation)}</td><td colspan="4" class="muted">No photos captured</td></tr>`;
          }
          return slope.photoPaths
            .map((_, pi) => {
              const ph = photos.find((x) => x.index === pi);
              if (!ph) {
                return `<tr><td>Slope ${si + 1} · ${esc(slope.orientation)}</td><td>Photo ${pi + 1}</td><td><span class="pill pill-slate">Unavailable</span></td><td class="muted">—</td><td class="muted">—</td></tr>`;
              }
              const status = ph.analyzed
                ? '<span class="pill pill-royal">AI-analyzed</span>'
                : '<span class="pill pill-soft">Reference</span>';
              const conf = ph.avgConfidence === null
                ? '<span class="muted">—</span>'
                : `${Math.round(ph.avgConfidence)}% · ${esc(TIER_SHORT[ph.tier!])}`;
              return `<tr><td>Slope ${si + 1} · ${esc(slope.orientation)}</td><td>Photo ${pi + 1}</td><td>${status}</td><td>${ph.findingCount}</td><td>${conf}</td></tr>`;
            })
            .join('');
        })
        .join('')}
    </tbody>
  </table>

  <h2><span class="n">07</span>Uncertainty Register</h2>
  ${uncertainFindings.length === 0
    ? '<p class="muted">No findings fell below the confidence threshold. Every detection in this report is reported at moderate confidence or above.</p>'
    : `<p class="muted">Findings below ${CONFIDENCE_BOUNDS.high}% confidence, disclosed in full.
       ${esc(TIER_MEANING.uncertain)}</p>
       <table>
         <thead><tr><th>Slope</th><th>Photo</th><th>Category</th><th>Confidence</th><th>Tier</th></tr></thead>
         <tbody>${uncertainFindings
           .map((u) => `<tr><td>${esc(u.slopeLabel)}</td><td>${u.photo === null ? '<span class="muted">—</span>' : `Photo ${u.photo + 1}`}</td><td>${esc(u.category)}</td><td>${u.confidence}%</td><td><span class="pill ${u.tier === 'moderate' ? 'pill-warn' : 'pill-bad'}">${esc(TIER_LABEL[u.tier])}</span></td></tr>`)
           .join('')}</tbody>
       </table>`}

  ${ins.notes && ins.notes.trim() ? `
    <h2><span class="n">08</span>Inspector Notes</h2>
    <p>${esc(ins.notes.trim())}</p>
  ` : ''}

  <h2><span class="n">09</span>Collateral Evidence</h2>
  ${
    Object.keys(ins.collateralChecklist).length === 0
      ? '<p class="reasoning">No collateral checklist recorded.</p>'
      : `<table>${Object.entries(ins.collateralChecklist)
          .map(([k, v]) => `<tr><th>${esc(collateralLabel(k))}</th><td>${v ? '<span class="pill pill-ok">Yes</span>' : '<span class="pill pill-slate">No</span>'}</td></tr>`)
          .join('')}</table>`
  }
  ${collateralZonesBlock(ins.collateralEvidence)}

  <h2><span class="n">10</span>Insurance-Grade Narrative</h2>
  <p>${esc(narrative(ins, decision, score))}</p>

  <h2><span class="n">11</span>Homeowner Summary</h2>
  <div class="homeowner">${homeownerSummary(ins, decision, worthiness, score)}</div>

  ${isInsurance ? insuranceSupplement(ins, brittlenessPhotos, inspector) : ''}

  <h2><span class="n">12</span>Certification &amp; Signatures</h2>
  <p class="muted">The inspector of record certifies that this inspection was performed
  in accordance with Haag Engineering functional-damage criteria for the roof system
  identified in Section 04, and that the photographic record in Sections 05–06 is complete
  and unaltered.</p>
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
    <strong>RoofWise HAAG Certified Report</strong> · ${esc(ins.reportId)}<br/>
    Generated ${esc(generatedAt)} · ${totalPhotos} photograph${totalPhotos === 1 ? '' : 's'} on file · ${ins.slopes.length} slope${ins.slopes.length === 1 ? '' : 's'} inspected
  </div>
</div>
</body>
</html>`;
}

// The collateral checklist is keyed by internal snake_case ids. Carriers see
// this table, so render the same wording the inspector saw in the app.
const COLLATERAL_LABELS: Record<string, string> = {
  brittleness_observed: 'Brittleness observed on test shingles',
  mat_exposed: 'Mat exposure visible on damaged slopes',
  multi_layer: 'Multi-layer roof system (2+ layers)',
  metal_collateral: 'Collateral damage on metal (vents, flashing, AC)',
  window_screens: 'Hail damage on window screens / siding',
  gutters_dented: 'Dents in gutters or downspouts',
};

/** One photo in a slope card, captioned with its analysis + confidence state. */
function photoFigure(p: ReportPhoto): string {
  const tagClass = p.tier ? `tag-${p.tier}` : 'tag-none';
  const label = !p.analyzed
    ? 'Reference'
    : p.tier
    ? `${TIER_SHORT[p.tier]} · ${p.findingCount} finding${p.findingCount === 1 ? '' : 's'}`
    : 'Analyzed · clean';
  return `<figure class="photo-fig">
    <img class="slope-photo" src="${p.dataUri}" />
    <figcaption>Photo ${p.index + 1} · <span class="tag ${tagClass}">${esc(label)}</span></figcaption>
  </figure>`;
}

function collateralLabel(key: string): string {
  return COLLATERAL_LABELS[key] ?? key.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * The four §VIII collateral evidence zones, when the checklist-driven capture
 * flow recorded them. Renders inside Section 09 for any inspection kind —
 * the data only exists when the zones were actually worked, so nothing is
 * synthesized for older records (Drift #5).
 */
function collateralZonesBlock(ev: Inspection['collateralEvidence']): string {
  if (!ev) return '';
  const rows = COLLATERAL_ZONES.map((zone) => {
    const item = ev[zone];
    const checked = item?.checked === true;
    const photoCount = item?.photoIds.length ?? 0;
    return `<tr>
      <td>${esc(COLLATERAL_ZONE_LABELS[zone])}</td>
      <td>${checked ? '<span class="pill pill-ok">Inspected</span>' : '<span class="pill pill-slate">Not inspected</span>'}</td>
      <td>${photoCount > 0 ? `${photoCount} on file` : '<span class="muted">None</span>'}</td>
      <td>${item?.note ? esc(item.note) : '<span class="muted">—</span>'}</td>
    </tr>`;
  }).join('');
  const unphotographed = COLLATERAL_ZONES.filter(
    (zone) => ev[zone]?.checked === true && (ev[zone]?.photoIds.length ?? 0) === 0,
  );
  return `
  <h3>Collateral evidence zones (Professional Report §VIII)</h3>
  <p class="muted">Soft-metal collateral corroborates the storm event. Each zone is inspected and
  photographed even when clean — a no-damage photo proves the zone was checked. Zone photographs
  are retained in the inspection record.</p>
  <table>
    <thead><tr><th>Zone</th><th>Status</th><th>Photos</th><th>Note</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${unphotographed.length > 0
    ? `<p class="cite">Zones marked inspected without photographs on file: ${esc(
        unphotographed.map((z) => COLLATERAL_ZONE_LABELS[z]).join(', '),
      )}. The protocol expects each zone photographed; the observation stands on the inspector's certification alone until photos are attached.</p>`
    : ''}`;
}

// -----------------------------------------------------------------------------
// Insurance Claim Supplement — the 6-section insurance variant
// (Professional Report doc, Part 3 / §VI–IX). Rendered ONLY when
// ins.kind === 'insurance_claim', between Section 11 and the certification,
// leaving the approved 12-section report untouched.
// -----------------------------------------------------------------------------

/**
 * Carrier-norm context (Professional Report §VII-A). NEGOTIATION CONTEXT
 * ONLY: insurers typically look for 8–12 confirmed impacts per test square,
 * but that figure is NOT a HAAG threshold and must never gate a
 * determination — haagThresholds.ts is the only threshold authority.
 * Built on the engine's canonical CARRIER_IMPACT_NORM_NOTE so the 8–12
 * figure and the threshold numbers live in one place (decisionEngine.ts);
 * the report-specific framing sentences are appended here.
 */
const CARRIER_IMPACT_NORM_CONTEXT =
  `${CARRIER_IMPACT_NORM_NOTE} ` +
  'That figure describes common carrier behavior and is provided for negotiation context only. ' +
  'It is not part of the Haag protocol, it is not the standard this report applies, and no ' +
  'determination in this document uses it. Every determination above rests exclusively on the ' +
  'material-specific Haag thresholds cited verbatim in Sections 01, 04, and C.';

/**
 * "Show its work" doctrine: every finding presented to a carrier cites the
 * specific rule it was assessed under — black-box scores get rejected.
 * Hail/wind categories cite the material's §2 threshold string verbatim;
 * categories outside the §2 hit-count regime cite the §1 functional-damage
 * doctrine they were judged by, including the honest "not functional
 * damage" citations for blistering and biological growth.
 */
function ruleCitationFor(category: DamageCategory, material: RoofMaterial): string {
  const rule = thresholdFor(material).rule;
  switch (category) {
    case 'hail_hits':
    case 'bruising':
    case 'granule_loss':
      return (
        `${rule} Functional-damage doctrine (HAAG §1): hail damage counts only as ` +
        'mechanically-caused granule loss with substrate exposure or mat fracture; ' +
        'granule loss without substrate exposure is cosmetic.'
      );
    case 'wind_damage':
    case 'wind_creasing':
    case 'lifted_shingles':
    case 'missing_shingles':
      return (
        `${rule} Wind doctrine (HAAG §1): wind damage is creased, torn, flapped, or ` +
        'missing shingles; wear and tear must be ruled out before a finding counts.'
      );
    case 'cracking':
    case 'splitting':
      return (
        'HAAG §1 functional-damage test: qualifies when the fracture penetrates the mat or ' +
        'reduces water-shedding capability; otherwise documented as cosmetic.'
      );
    case 'blistering':
      return (
        'HAAG §1: thermal blisters are expressly NOT functional damage. Documented note-only ' +
        'and not relied on for any determination in this report.'
      );
    case 'algae_moss':
      return (
        'HAAG §1: biological growth is natural weathering, not storm damage. Documented ' +
        'note-only and not relied on for any determination in this report.'
      );
    case 'flashing_damage':
      return (
        'Appurtenance / collateral observation (Professional Report §VIII): documented as ' +
        'supporting storm evidence — not assessed under the §2 shingle hit-count thresholds.'
      );
    case 'structural_sagging':
      return (
        'Structural observation outside the §2 hail/wind thresholds: documented for scope ' +
        'and safety and warrants qualified structural evaluation.'
      );
  }
}

function insuranceSupplement(
  ins: Inspection,
  brittlenessPhotos: string[],
  inspector: InspectorProfile,
): string {
  const threshold = thresholdFor(ins.material);

  // ── A. Hail test squares ────────────────────────────────────────────────
  // Avg Size is rendered "Not measured" until impact sizing exists on the
  // record: markers carry normalized radii, not physical sizes, and turning
  // one into inches without scale calibration would be an invented number.
  // Whether calibration itself is recorded must be stated accurately — a
  // usable per-photo shingle-scale estimate (pixelsPerInch resolved) means
  // "recorded but not yet used for sizing", not "not recorded".
  const hasScaleCalibration = ins.slopes.some((s) =>
    (s.scaleEstimates ?? []).some((e) => e.pixelsPerInch != null),
  );
  const testSquareRows =
    ins.slopes.length === 0
      ? '<tr><td colspan="3" class="muted">No slopes captured — no test squares to report.</td></tr>'
      : ins.slopes
          .map(
            (slope, i) =>
              `<tr><td>Slope ${i + 1} · ${esc(slope.orientation)}</td><td>${slope.hailCount}</td><td class="muted">Not measured</td></tr>`,
          )
          .join('');
  const sectionA = `
  <h2 class="supp"><span class="n">A</span>Hail Test Squares</h2>
  <p class="muted">Confirmed hail impact counts per 10×10 ft (100 sq ft) test square, per Haag
  test-square methodology. The governing threshold for this material is cited in Section C.</p>
  <table>
    <thead><tr><th>Slope</th><th>Impact Count</th><th>Avg Size</th></tr></thead>
    <tbody>${testSquareRows}</tbody>
  </table>
  <p class="cite">${hasScaleCalibration
    ? `In-photo shingle-scale calibration is recorded on this inspection, but impact sizing is not
  yet derived from it — the column is disclosed as not measured rather than estimated.`
    : `Average impact size requires in-photo scale calibration, which is not recorded on
  this inspection — the column is disclosed as not measured rather than estimated.`} Impact severity is
  instead evidenced by count, the photographic record in Sections 05–06, and the verified storm data
  below. No size figure in this report is inferred.</p>
  ${ins.event?.hailSizeInches
    ? `<p>Verified storm hail size: <strong>up to ${ins.event.hailSizeInches}&quot;</strong> — this is
       the storm record for the event, not a measured impact size on this roof.</p>`
    : ''}`;

  // ── B. Brittleness & repairability ──────────────────────────────────────
  const proto = ins.brittlenessProtocol;
  const brittleResult: BrittlenessResult | undefined =
    proto?.result ?? legacyBrittlenessToResult(ins.brittlenessTest);
  let brittlenessNarrative: string;
  if (!brittleResult) {
    brittlenessNarrative =
      '<div class="callout warn"><strong>Brittleness test not performed.</strong> The Haag ' +
      'repairability gate (§3) cannot be evaluated: without a documented lift test there is no ' +
      'evidence on whether spot repairs are mechanically feasible on this roof. This is disclosed ' +
      'as missing data — it is not assumed either way — and it reduces confidence in any ' +
      'repair-based scope. Performing the field protocol (lift shingle corners in an undamaged ' +
      'area, photographing the process and the result) before submission closes this gap.</div>';
  } else if (brittleResult === 'PASS') {
    brittlenessNarrative =
      '<p><strong>Repairability conclusion:</strong> the brittleness test returned ' +
      '<strong>PASS</strong> — test shingles lifted and reseated without fracture. Repairs are ' +
      'mechanically feasible on this roof system, so the repair-versus-replacement determination ' +
      'rests on the Haag damage thresholds cited in Section C rather than on a repairability gate.</p>';
  } else {
    brittlenessNarrative =
      `<p><strong>Repairability conclusion:</strong> the brittleness test returned ` +
      `<strong>${brittleResult}</strong>. Under Haag repairability gating (§3) a ${brittleResult} ` +
      'result forces replacement on its own, independent of per-square hit counts: shingles too ' +
      'brittle to lift and reseat cannot be spot-repaired without causing further damage to the ' +
      'surrounding roof. Full replacement is the supported scope for the affected system.</p>';
  }
  const protoPhotoCount = proto?.photoIds.length ?? 0;
  let brittlenessPhotoBlock = '';
  if (brittlenessPhotos.length > 0) {
    brittlenessPhotoBlock =
      `<div class="photo-row">${brittlenessPhotos
        .map(
          (uri, i) =>
            `<figure class="photo-fig"><img class="slope-photo" src="${uri}" /><figcaption>Brittleness field protocol — photo ${i + 1} of ${brittlenessPhotos.length}</figcaption></figure>`,
        )
        .join('')}</div>` +
      (protoPhotoCount > brittlenessPhotos.length
        ? `<p class="muted">${protoPhotoCount - brittlenessPhotos.length} additional protocol photo(s) recorded but unavailable on this device.</p>`
        : '');
  } else if (brittleResult) {
    brittlenessPhotoBlock =
      protoPhotoCount > 0
        ? `<p class="muted">${protoPhotoCount} protocol photo(s) are recorded on this inspection but unavailable on this device.</p>`
        : '<div class="callout warn"><strong>No photographs attached to this result.</strong> The ' +
          'field protocol (§VII-C) requires the test process and result be photographed; without ' +
          "them the finding stands on the inspector's certification alone, which an adjuster may " +
          'weigh accordingly.</div>';
  }
  const sectionB = `
  <h2 class="supp"><span class="n">B</span>Brittleness Test &amp; Repairability</h2>
  ${brittlenessNarrative}
  ${proto?.notes?.trim() ? `<p class="reasoning">Inspector's protocol notes: ${esc(proto.notes.trim())}</p>` : ''}
  ${brittlenessPhotoBlock}`;

  // ── C. HAAG rule citations ("show its work") ────────────────────────────
  const anyWind = ins.slopes.some((s) => s.windLiftCount > 0 || s.missingCount > 0);
  const slopeCitations = ins.slopes
    .map((slope, i) => {
      // Evaluate the SAME observation the decision engine builds for this
      // slope (hail hits + legacyObservation's material-specific mapping —
      // broken units on tile/slate, punctures on membranes, seam
      // disengagement on metal). Rebuilding from hailCount alone made this
      // section contradict Section 05's stored engine verdict on non-asphalt
      // roofs — a report must never contradict the engine's booleans.
      const evalRes = evaluateMaterialThreshold(ins.material, {
        hailHitsPerSquare: slope.hailCount,
        ...(legacyObservation(ins.material, slope) ?? {}),
      });
      const fired =
        evalRes.triggeredRules.length > 0
          ? `<ul class="cite-list">${evalRes.triggeredRules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
          : `<p class="cite">No §2 replacement rule fired on this slope's recorded hail count (${slope.hailCount} per test square). Governing standard: ${esc(threshold.rule)}</p>`;
      const notes =
        evalRes.notes.length > 0
          ? `<ul class="cite-list">${evalRes.notes.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>`
          : '';
      return `<h3>Slope ${i + 1} · ${esc(slope.orientation)}</h3>${fired}${notes}`;
    })
    .join('');
  const findingCitationRows = ins.slopes.flatMap((slope, si) =>
    (slope.aiFindings ?? [])
      .filter((f) => f.detected)
      .map(
        (f) =>
          `<tr><td>Slope ${si + 1} · ${esc(slope.orientation)}</td><td>${esc(
            DAMAGE_CATEGORY_LABELS[f.label] ?? String(f.label).replace(/_/g, ' '),
          )}</td><td>${esc(f.severity)}</td><td class="cite">${esc(ruleCitationFor(f.label, ins.material))}</td></tr>`,
      ),
  );
  const sectionC = `
  <h2 class="supp"><span class="n">C</span>HAAG Rule Citations</h2>
  <div class="callout"><strong>Governing standard for this roof.</strong> ${esc(threshold.rule)}</div>
  ${ins.slopes.length === 0 ? '<p class="muted">No slopes captured — no rules to evaluate.</p>' : slopeCitations}
  ${anyWind
    ? `<p class="cite">Wind observations on this inspection are recorded as counts (lifted and missing
       shingles per slope, Section 05). The §2 asphalt wind threshold is expressed as a percentage of
       shingles on the slope, which requires a per-slope shingle count not recorded here — that
       conversion is disclosed as missing rather than estimated, and the wind-percentage rule is not
       claimed as triggered anywhere in this report.</p>`
    : ''}
  ${findingCitationRows.length > 0
    ? `<h3>Per-finding citations</h3>
       <p class="muted">Every finding presented above, with the specific rule it was assessed under —
       no black-box scores.</p>
       <table>
         <thead><tr><th>Slope</th><th>Finding</th><th>Severity</th><th>Rule applied</th></tr></thead>
         <tbody>${findingCitationRows.join('')}</tbody>
       </table>`
    : '<p class="muted">No AI findings are recorded on this inspection; the slope-level counts above stand as the inspector’s documented observations.</p>'}`;

  // ── D. Causation ────────────────────────────────────────────────────────
  const causationRows = ins.slopes.flatMap((slope, si) => {
    const slopeLabel = `Slope ${si + 1} · ${slope.orientation}`;
    const fromFindings = (slope.aiFindings ?? [])
      .filter((f) => f.detected && f.causation?.trim())
      .map(
        (f) =>
          `<tr><td>${esc(slopeLabel)}</td><td>${esc(DAMAGE_CATEGORY_LABELS[f.label] ?? String(f.label).replace(/_/g, ' '))}</td><td>${esc(f.causation!.trim())}</td></tr>`,
      );
    const fromMarkers = slope.damage
      .filter((m) => m.causation?.trim())
      .map(
        (m) =>
          `<tr><td>${esc(slopeLabel)}</td><td>${esc(DAMAGE_CATEGORY_LABELS[m.category] ?? String(m.category).replace(/_/g, ' '))}${typeof m.photoIndex === 'number' ? ` · Photo ${m.photoIndex + 1}` : ''}</td><td>${esc(m.causation!.trim())}</td></tr>`,
      );
    return [...fromFindings, ...fromMarkers];
  });
  const reportedDol = ins.dateOfLoss;
  const eventDate = ins.event?.date;
  let dolLine: string;
  if (reportedDol && eventDate) {
    const same = formatDateShort(reportedDol) === formatDateShort(eventDate);
    dolLine = `<p>Reported date of loss: <strong>${esc(formatDateShort(reportedDol))}</strong> ·
      Verified storm event: <strong>${esc(formatDateShort(eventDate))}</strong>${
        same
          ? ' — the dates align.'
          : '. <strong>The reported and verified dates differ.</strong> Carriers match date-of-loss strictly; reconcile before submission.'
      }</p>`;
  } else if (reportedDol) {
    dolLine = `<p>Reported date of loss: <strong>${esc(formatDateShort(reportedDol))}</strong>.
      No verified storm event is attached to corroborate it (Section 03) — this weakens causation
      and should be closed before submission.</p>`;
  } else {
    dolLine =
      '<p class="muted">No reported date of loss is recorded on this claim. Carriers require one; ' +
      'its absence is disclosed as missing data, not asserted either way.</p>';
  }
  const sectionD = `
  <h2 class="supp"><span class="n">D</span>Causation</h2>
  <p>Primary cause of loss: <strong>${ins.causeOfLoss ? esc(CAUSE_OF_LOSS_LABELS[ins.causeOfLoss]) : 'Not recorded'}</strong>.</p>
  ${dolLine}
  ${causationRows.length > 0
    ? `<table>
        <thead><tr><th>Slope</th><th>Observation</th><th>Causation statement</th></tr></thead>
        <tbody>${causationRows.join('')}</tbody>
      </table>`
    : `<div class="callout warn"><strong>No per-observation causation statements recorded.</strong>
       The Professional Report protocol requires each presented observation to carry a statement
       linking it to the cause of loss (e.g. &quot;fracture pattern consistent with hail impact&quot;).
       None are recorded on this inspection, so causation rests on the storm verification
       (Section 03) and the rule citations (Section C). Recording causation statements before
       submission strengthens the packet.</div>`}`;

  // ── E. Carrier norms — negotiation context only ─────────────────────────
  const sectionE = `
  <h2 class="supp"><span class="n">E</span>Carrier Norms — Negotiation Context</h2>
  ${ins.carrier ? `<p>Carrier on this claim: <strong>${esc(INSURANCE_CARRIER_LABELS[ins.carrier])}</strong>${ins.claimNumber ? ` · Claim ${esc(ins.claimNumber)}` : ''}.</p>` : ''}
  <div class="negotiation">
    <span class="neg-kicker">Negotiation context — not a Haag threshold</span>
    ${esc(CARRIER_IMPACT_NORM_CONTEXT)}
  </div>`;

  // ── F. Inspector credentials & code compliance ──────────────────────────
  const sectionF = `
  <h2 class="supp"><span class="n">F</span>Inspector Credentials &amp; Code Compliance</h2>
  <table>
    <tr><th>Inspector of record</th><td>${inspector.fullName ? esc(inspector.fullName) : '<span class="muted">Not recorded</span>'}</td></tr>
    <tr><th>Haag certification</th><td>${
      inspector.haagCertified
        ? `<span class="pill pill-ok">Certified</span>${inspector.haagCertificationNumber ? ` ${esc(inspector.haagCertificationNumber)}` : ' <span class="muted">(number not recorded)</span>'}`
        : '<span class="muted">Not recorded on the inspector profile</span>'
    }</td></tr>
    <tr><th>License number</th><td>${inspector.licenseNumber ? esc(inspector.licenseNumber) : '<span class="muted">Not recorded</span>'}</td></tr>
    <tr><th>Years of experience</th><td>${inspector.yearsExperience > 0 ? inspector.yearsExperience : '<span class="muted">Not recorded</span>'}</td></tr>
    <tr><th>Phone</th><td>${inspector.phone ? esc(inspector.phone) : '<span class="muted">Not recorded</span>'}</td></tr>
  </table>
  ${ins.codeComplianceNotes?.trim()
    ? `<h3>Local code-compliance notes (§IX)</h3><p>${esc(ins.codeComplianceNotes.trim())}</p>`
    : `<p class="cite">No local code-compliance items recorded. Documented code items (ventilation,
       ice &amp; water shield) expand covered scope under many policies (§IX); none are asserted in
       this report.</p>`}`;

  return `
  <div class="supp-banner">
    <span class="supp-kicker">Insurance claim supplement</span>
    <div class="supp-title">Professional Report — Insurance Variant (§VI–IX)</div>
    <p>This inspection was conducted in Insurance Claim mode. Sections A–F below carry the six
    carrier-facing components the claim requires. Nothing here replaces Sections 01–12 — the
    supplement adds documentation; it never alters a determination made above.</p>
  </div>
  ${sectionA}
  ${sectionB}
  ${sectionC}
  ${sectionD}
  ${sectionE}
  ${sectionF}`;
}

function formatRecommendation(r: string): string {
  return r.replace('_', ' ');
}

function formatVerdict(v: string): string {
  switch (v) {
    case 'full_replace': return 'Full replacement';
    case 'partial_replace': return 'Partial replacement';
    case 'verify_with_inspector': return 'Verify with inspector';
    default: return 'Repair';
  }
}

function narrative(
  ins: Inspection,
  decision: ReturnType<typeof evaluate>,
  score: number,
): string {
  const t = thresholdFor(ins.material);
  return (
    `Based on a HAAG-protocol inspection of the ${ROOF_MATERIAL_LABELS[ins.material]} roof at ` +
    `${ins.address}, the property exhibits a damage score of ${score}/100 across ${ins.slopes.length} slope(s). ` +
    `Per HAAG functional-damage criteria for this material (${t.rule}), the roof-level recommendation is ` +
    `${formatRecommendation(decision.roofRecommendation)}. ${decision.roofVerdictReasoning} ` +
    `Claim viability assessed as ${CLAIM_VIABILITY_LABELS[decision.haag.claim_viability]} (HAAG §6 band).`
  );
}

/**
 * Plain-language summary for the homeowner.
 *
 * Written at roughly an 8th-grade reading level and returned as HTML
 * paragraphs, because this is the only section most homeowners actually
 * read. It answers, in order: what did you find, what does it mean, what
 * should I do, and what will it cost me.
 *
 * Two claims are hedged on purpose, and the hedges are not padding:
 *   • The filing window. Deadlines are set by state law AND by the policy's
 *     own notice provision, and they differ. Printing a flat "you have two
 *     years" in a document a homeowner may act on a year from now risks
 *     talking someone past their actual deadline.
 *   • "You only pay your deductible." True on a replacement-cost policy;
 *     NOT true on actual-cash-value, where recoverable depreciation is held
 *     back, and wind/hail deductibles are often a percentage of the dwelling
 *     value rather than a flat amount.
 * Both are stated as the normal case with a one-line "confirm on your
 * policy", which keeps the point intact without promising money.
 */
function homeownerSummary(
  ins: Inspection,
  decision: ReturnType<typeof evaluate>,
  worthiness: ReturnType<typeof claimWorthiness>,
  score: number,
): string {
  const qualifying = decision.perSlope.filter((r) => r.qualifies).length;
  const slopeCount = ins.slopes.length;
  const threshold = thresholdFor(ins.material);
  const material = ROOF_MATERIAL_LABELS[ins.material].toLowerCase();
  // "a architectural asphalt roof" reads as a typo to a homeowner.
  const materialArticle = /^[aeiou]/.test(material) ? 'an' : 'a';

  const totals = ins.slopes.reduce(
    (acc, s) => ({
      hail: acc.hail + s.hailCount,
      wind: acc.wind + s.windLiftCount,
      missing: acc.missing + s.missingCount,
      bruising: acc.bruising + s.bruisingCount,
    }),
    { hail: 0, wind: 0, missing: 0, bruising: 0 },
  );

  const damageBits: string[] = [];
  if (totals.hail > 0) damageBits.push(`${totals.hail} hail impact${totals.hail === 1 ? '' : 's'}`);
  if (totals.bruising > 0) damageBits.push(`${totals.bruising} bruised area${totals.bruising === 1 ? '' : 's'}`);
  if (totals.wind > 0) damageBits.push(`${totals.wind} wind-lifted shingle${totals.wind === 1 ? '' : 's'}`);
  if (totals.missing > 0) damageBits.push(`${totals.missing} missing shingle${totals.missing === 1 ? '' : 's'}`);
  const damageList =
    damageBits.length === 0
      ? 'no storm-related damage'
      : damageBits.length === 1
      ? damageBits[0]
      : `${damageBits.slice(0, -1).join(', ')} and ${damageBits[damageBits.length - 1]}`;

  const stormLine = ins.event
    ? `Your roof was in the path of a ${esc(ins.event.kind)} storm on ${esc(formatDateShort(ins.event.date))}${
        ins.event.hailSizeInches ? `, which produced hail up to ${ins.event.hailSizeInches} inches across` : ''
      }. That storm is confirmed in national weather records, which matters: it ties the damage on your roof to a specific date and event.`
    : 'We have not yet attached a confirmed storm date to this inspection. Doing so strengthens the claim considerably, and we can add it.';

  // ── What we found ──────────────────────────────────────────────────────
  const found = `<p><strong>What we found.</strong> We inspected ${slopeCount} slope${
    slopeCount === 1 ? '' : 's'
  } of your ${esc(material)} roof and documented ${esc(damageList)}. ${stormLine}</p>`;

  // ── What the standard says ─────────────────────────────────────────────
  const standard = `<p><strong>How that gets judged.</strong> Insurance companies do not decide this by opinion. They use an
    engineering standard from Haag Engineering, and for ${materialArticle} ${esc(material)} roof the line is
    <strong>${esc(threshold.rule)}</strong> When a slope crosses that line, the damage is called
    <em>functional</em> — meaning the roof's ability to protect your home has actually been reduced,
    not just its appearance. ${
      qualifying > 0
        ? `<strong>${qualifying} of your ${slopeCount} slope${slopeCount === 1 ? '' : 's'} crossed that line.</strong>`
        : 'None of your slopes crossed that line in this inspection.'
    }</p>`;

  // ── Recommendation + insurance mechanics ───────────────────────────────
  const insuranceExplainer = `<p><strong>How the insurance side works.</strong> Storm damage is what a policy calls an
    <em>act of God</em> — a sudden event outside anyone's control. It is not wear and tear, and it is not
    something you did or failed to do. That distinction matters, because a covered storm loss is not held
    against you the way an at-fault claim would be. In the normal case, your carrier pays to put the roof
    back the way it was and <strong>your share is your deductible</strong> — not the cost of the roof.
    Two details worth confirming on your own policy: whether your wind and hail deductible is a flat dollar
    amount or a percentage of your home's insured value, and whether your policy pays replacement cost or
    actual cash value, since the second holds back some money until the work is finished.</p>`;

  const timing = `<p><strong>Don't sit on it.</strong> Carriers expect prompt notice after a storm, and there is a
    deadline for filing — commonly around two years from the date of the storm in many states, though the
    exact limit is set by your policy and your state's law, so confirm it rather than assume it. The longer
    you wait, the easier it is for a carrier to argue the damage came from age or from a later storm instead
    of the one on record. Filing while the storm date is documented, as it is in this report, is what keeps
    the claim clean.</p>`;

  let recommendation: string;
  if (worthiness === 'not_claimable') {
    recommendation = `<p><strong>What we recommend.</strong> Based on what we can see today, the damage on your roof
      is below the threshold a carrier uses to approve a replacement, and we are not going to tell you
      otherwise. Filing a claim that gets denied can still show up in your claims history, so we would rather
      you keep the roof under watch. Hold on to this report. If another storm comes through, we can
      re-inspect and compare against this baseline — that comparison is often what proves new damage.</p>`;
    return found + standard + recommendation;
  }

  if (worthiness === 'borderline') {
    recommendation = `<p><strong>What we recommend.</strong> Your roof sits close to the line. There is real
      storm damage here — we documented it — but it is not yet clearly past the threshold a carrier uses,
      and some of what we found is flagged for on-site verification. Our recommendation is a short
      follow-up inspection to firm up the borderline findings before you file, so that the claim goes in
      with the strongest possible evidence rather than an argument. We are happy to walk you through what
      we saw and what the options are.</p>`;
    return found + standard + recommendation + timing;
  }

  const urgent = worthiness === 'urgent';
  recommendation = `<p><strong>What we recommend.</strong> ${
    urgent
      ? `Your roof has significant storm damage (damage score ${score} of 100) and we recommend filing a claim right away.
         Where the roof is open to weather, temporary protection should go on before the next rain to prevent
         interior damage — which a carrier expects you to mitigate.`
      : `We recommend filing a claim. The damage meets the standard your carrier uses, and this report is
         built to be handed directly to the adjuster.`
  } ${
    decision.roofRecommendation === 'full_replacement'
      ? 'Because of how roofing material matching works, the qualifying damage supports replacing the full roof rather than patching individual slopes — a repaired section on an aged roof will not match, and carriers recognize that.'
      : decision.roofRecommendation === 'partial_replacement'
      ? 'The qualifying damage supports replacing the affected slopes.'
      : 'The damage supports an itemized repair scope.'
  } Give this report to your carrier when you file. It contains the photographs, the storm verification,
    and the specific standard applied to each slope — which is what an adjuster needs to approve the claim
    without a second inspection.</p>`;

  return found + standard + recommendation + insuranceExplainer + timing;
}

/** HTML-escape for report templates. Shared with lib/services/longReport.ts. */
export function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
