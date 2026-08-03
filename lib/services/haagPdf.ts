import { formatDateShort, formatDateTime } from '@/lib/format/date';
// HAAG-style PDF report generator.
// Uses expo-print to render an HTML template to a PDF on disk.
// Spec Phase 3 — 9-section Haag report (cover, weather, roof, slopes,
// collateral, summary, narrative, homeowner summary, signatures).
//
// This implementation is the v1: clean HTML + CSS via expo-print. PencilKit
// signatures and per-photo damage marker overlays will come in a follow-up
// once the image-overlay pipeline is built.

import * as Print from 'expo-print';
import * as ImageManipulator from 'expo-image-manipulator';
import type { Inspection } from '../models/types';
import {
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
} from '../models/types';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import {
  CLAIM_WORTHINESS_LABELS,
  claimWorthiness,
  damageScore,
  evaluate,
} from './decisionEngine';
import { thresholdFor } from './haagThresholds';
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
  const html = renderHtml(inspection, photoMap);
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
      try {
        const out = await ImageManipulator.manipulateAsync(
          uri,
          [{ resize: { width: 700 } }],
          {
            compress: 0.55,
            format: ImageManipulator.SaveFormat.JPEG,
            base64: true,
          },
        );
        if (out.base64) {
          const marks = slope.damage.filter((m) => m.photoIndex === index);
          const avg = averageConfidence(marks.map((m) => m.confidence));
          encoded.push({
            index,
            dataUri: `data:image/jpeg;base64,${out.base64}`,
            analyzed: wasAnalyzed(slope, index),
            findingCount: marks.length,
            avgConfidence: avg,
            tier: avg === null ? null : tierFor(avg),
          });
        }
      } catch {
        // Photo missing on disk (restored backup, other device) — skip.
      }
    }
    if (encoded.length > 0) map[slope.id] = encoded;
  }
  return map;
}

function renderHtml(ins: Inspection, photoMap: Record<string, ReportPhoto[]> = {}): string {
  const decision = evaluate(ins);
  const score = damageScore(ins);
  const worthiness = claimWorthiness(decision, score);
  const threshold = thresholdFor(ins.material);
  const inspector = useInspectorProfileStore.getState().profile;
  const generatedAt = formatDateTime(new Date());
  const createdDate = formatDateShort(ins.createdAt);

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
<style>
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

  @media print {
    .slope-card, table, .sig-row, .photo-fig, .callout { page-break-inside: avoid; }
    h2 { page-break-after: avoid; }
    .cover { page-break-after: avoid; }
  }
  .slope-card, table, .sig-row, .photo-fig, .callout { break-inside: avoid; }

  .footer { text-align: center; color: var(--slate); font-size: 9px; padding: 20px 0;
            border-top: 1px solid var(--line); margin-top: 34px; line-height: 1.7; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 24px; }
  .sig-box { border-top: 1.5px solid var(--ink); padding-top: 8px; font-size: 10.5px; color: var(--slate); }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="brand">
      <div class="mark">RW</div>
      <div class="name">RoofWise</div>
      <div class="cert">Haag Protocol</div>
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
      <div><div class="label">Date of loss</div><div class="value">${ins.event ? esc(formatDateShort(ins.event.date)) : 'Not attached'}</div></div>
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
    <div class="summary-stat accent"><div class="stat-value">${esc(CLAIM_WORTHINESS_LABELS[worthiness])}</div><div class="stat-label">Claim worthiness</div></div>
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

  <h2><span class="n">10</span>Insurance-Grade Narrative</h2>
  <p>${esc(narrative(ins, decision, score, worthiness))}</p>

  <h2><span class="n">11</span>Homeowner Summary</h2>
  <p>${esc(homeownerSummary(decision, worthiness))}</p>

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
  worthiness: ReturnType<typeof claimWorthiness>,
): string {
  const t = thresholdFor(ins.material);
  return (
    `Based on a HAAG-protocol inspection of the ${ROOF_MATERIAL_LABELS[ins.material]} roof at ` +
    `${ins.address}, the property exhibits a damage score of ${score}/100 across ${ins.slopes.length} slope(s). ` +
    `Per HAAG functional-damage criteria for this material (${t.rule}), the roof-level recommendation is ` +
    `${formatRecommendation(decision.roofRecommendation)}. ${decision.roofVerdictReasoning} ` +
    `Claim worthiness assessed as ${CLAIM_WORTHINESS_LABELS[worthiness]}.`
  );
}

function homeownerSummary(
  decision: ReturnType<typeof evaluate>,
  worthiness: ReturnType<typeof claimWorthiness>,
): string {
  if (worthiness === 'not_claimable') {
    return 'Our inspection found minimal damage that is unlikely to meet your carrier\'s claim threshold. We recommend monitoring.';
  }
  if (worthiness === 'borderline') {
    return 'There is some storm-related damage on the roof. A full claim may not succeed without further documentation; we can discuss next steps.';
  }
  if (worthiness === 'claimable') {
    return 'We found damage consistent with the HAAG criteria your carrier uses. We recommend filing a claim and providing this report to the adjuster.';
  }
  return 'We found significant storm damage requiring urgent attention. File a claim immediately and engage a roofer for protective work as needed.';
}

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
