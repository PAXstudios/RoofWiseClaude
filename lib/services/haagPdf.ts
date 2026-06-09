// HAAG-style PDF report generator.
// Uses expo-print to render an HTML template to a PDF on disk.
// Spec Phase 3 — 9-section Haag report (cover, weather, roof, slopes,
// collateral, summary, narrative, homeowner summary, signatures).
//
// This implementation is the v1: clean HTML + CSS via expo-print. PencilKit
// signatures and per-photo damage marker overlays will come in a follow-up
// once the image-overlay pipeline is built.

import * as Print from 'expo-print';
import type { Inspection } from '../models/types';
import {
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
} from '../models/types';
import {
  CLAIM_WORTHINESS_LABELS,
  claimWorthiness,
  damageScore,
  evaluate,
} from './decisionEngine';
import { thresholdFor } from './haagThresholds';

export type GeneratedReport = {
  uri: string;
  inspection: Inspection;
};

export async function generateHaagReport(inspection: Inspection): Promise<GeneratedReport> {
  const html = renderHtml(inspection);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri, inspection };
}

function renderHtml(ins: Inspection): string {
  const decision = evaluate(ins);
  const score = damageScore(ins);
  const worthiness = claimWorthiness(decision, score);
  const threshold = thresholdFor(ins.material);
  const generatedAt = new Date().toLocaleString();
  const createdDate = new Date(ins.createdAt).toLocaleDateString();

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(ins.reportId)} — HAAG Report</title>
<style>
  :root {
    --navy: #0C183C;
    --orange: #FC6018;
    --cream: #F0F0E4;
    --slate: #546078;
    --border: #E0E0D6;
  }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color: var(--navy); margin: 0; padding: 0; background: #fff; }
  .page { padding: 32px 40px; }
  .cover { background: var(--navy); color: #fff; padding: 60px 40px; margin: -32px -40px 32px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .brand .mark { width: 44px; height: 44px; border-radius: 12px; background: var(--orange); color: #fff; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .brand .name { font-size: 22px; font-weight: 700; }
  .cover h1 { font-size: 32px; margin: 28px 0 6px; font-weight: 700; }
  .cover .sub { color: rgba(240, 240, 228, 0.85); font-size: 14px; }
  .meta-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px 32px; margin-top: 32px; }
  .meta-grid .label { font-size: 11px; color: rgba(240,240,228,0.7); text-transform: uppercase; letter-spacing: 0.5px; }
  .meta-grid .value { font-size: 16px; font-weight: 600; margin-top: 2px; }

  h2 { font-size: 18px; color: var(--navy); border-bottom: 2px solid var(--orange); padding-bottom: 6px; margin: 36px 0 14px; }
  h3 { font-size: 14px; color: var(--navy); margin: 18px 0 6px; }
  p { font-size: 13px; line-height: 1.55; color: var(--navy); }
  table { width: 100%; border-collapse: collapse; font-size: 12px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid var(--border); }
  th { background: var(--cream); color: var(--navy); font-weight: 600; }
  .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
  .pill-orange { background: var(--orange); color: #fff; }
  .pill-cream { background: var(--cream); color: var(--navy); }
  .pill-slate { background: var(--slate); color: #fff; }
  .pill-success { background: #2BB673; color: #fff; }
  .pill-danger { background: #E5484D; color: #fff; }

  .summary-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0 24px; }
  .summary-stat { background: var(--cream); padding: 16px; border-radius: 12px; }
  .summary-stat .stat-value { font-size: 28px; font-weight: 700; color: var(--orange); }
  .summary-stat .stat-label { font-size: 11px; color: var(--slate); text-transform: uppercase; letter-spacing: 0.5px; margin-top: 4px; }

  .slope-card { border: 1px solid var(--border); border-radius: 12px; padding: 16px; margin: 12px 0; }
  .slope-card h3 { margin-top: 0; }
  .reasoning { font-style: italic; color: var(--slate); font-size: 12px; margin-top: 8px; }

  .footer { text-align: center; color: var(--slate); font-size: 10px; padding: 24px 0; border-top: 1px solid var(--border); margin-top: 40px; }
  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 28px; }
  .sig-box { border-top: 1px solid var(--navy); padding-top: 8px; font-size: 11px; color: var(--slate); }
</style>
</head>
<body>
<div class="page">

  <div class="cover">
    <div class="brand">
      <div class="mark">RW</div>
      <div class="name">RoofWise</div>
    </div>
    <h1>Roof Damage Inspection</h1>
    <div class="sub">${esc(ins.reportId)} · ${esc(createdDate)}</div>
    <div class="meta-grid">
      <div>
        <div class="label">Customer</div>
        <div class="value">${esc(ins.customerName)}</div>
      </div>
      <div>
        <div class="label">Property</div>
        <div class="value">${esc(ins.address)}</div>
      </div>
      <div>
        <div class="label">Carrier</div>
        <div class="value">${ins.carrier ? esc(INSURANCE_CARRIER_LABELS[ins.carrier]) : '—'}</div>
      </div>
      <div>
        <div class="label">Claim #</div>
        <div class="value">${esc(ins.claimNumber ?? '—')}</div>
      </div>
    </div>
  </div>

  <h2>1. Summary</h2>
  <div class="summary-grid">
    <div class="summary-stat">
      <div class="stat-value">${score}</div>
      <div class="stat-label">Damage Score</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${ins.slopes.length}</div>
      <div class="stat-label">Slopes Inspected</div>
    </div>
    <div class="summary-stat">
      <div class="stat-value">${esc(CLAIM_WORTHINESS_LABELS[worthiness])}</div>
      <div class="stat-label">Claim Worthiness</div>
    </div>
  </div>
  <p><strong>Roof-level recommendation:</strong> ${esc(formatRecommendation(decision.roofRecommendation))}.</p>
  <p class="reasoning">${esc(decision.roofVerdictReasoning)}</p>

  <h2>2. Weather Verification</h2>
  ${ins.event
    ? `<p>${esc(ins.event.kind)} event on ${esc(new Date(ins.event.date).toLocaleDateString())}${
        ins.event.hailSizeInches ? ` — ${ins.event.hailSizeInches}\" hail` : ''}${
        ins.event.windSpeedMph ? ` — ${ins.event.windSpeedMph} mph wind` : ''}${
        ins.event.distanceMiles ? ` — ${ins.event.distanceMiles.toFixed(1)} mi from property` : ''}.</p>`
    : '<p class="reasoning">No storm event matched to this inspection. NOAA auto-fill comes online in Phase 4C.</p>'}

  <h2>3. Roof System</h2>
  <table>
    <tr><th>Material</th><td>${esc(ROOF_MATERIAL_LABELS[ins.material])}</td></tr>
    <tr><th>Age</th><td>${ins.ageYears} years</td></tr>
    <tr><th>Geometry</th><td>${esc(ins.geometry)}</td></tr>
    <tr><th>Condition</th><td>${esc(ins.condition)}</td></tr>
    <tr><th>Brittleness</th><td>${esc(ins.brittlenessTest.replace('_', ' '))}</td></tr>
    <tr><th>HAAG threshold</th><td>${esc(threshold.rule)}</td></tr>
  </table>

  <h2>4. Slope-by-Slope Findings</h2>
  ${
    ins.slopes.length === 0
      ? '<p class="reasoning">No slopes captured. Run Quick Inspection to populate this section.</p>'
      : ins.slopes
          .map((slope, i) => {
            const slopeResult = decision.perSlope.find((r) => r.slopeId === slope.id);
            const verdict = slopeResult?.verdict ?? 'repair';
            const pillClass =
              verdict === 'full_replace' || verdict === 'partial_replace'
                ? 'pill-orange'
                : verdict === 'verify_with_inspector'
                ? 'pill-cream'
                : 'pill-slate';
            const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
            return `<div class="slope-card">
        <h3>Slope ${i + 1}: ${esc(slope.orientation)} <span class="pill ${pillClass}">${esc(formatVerdict(verdict))}</span></h3>
        <p>${slope.photoPaths.length} photos · Hail ${slope.hailCount} · Wind ${slope.windLiftCount} · Missing ${slope.missingCount} · Bruising ${slope.bruisingCount}</p>
        ${detected.length === 0 ? '<p class="reasoning">No findings detected on this slope.</p>' : `<table><thead><tr><th>Category</th><th>Severity</th><th>Confidence</th><th>Count</th></tr></thead><tbody>${detected.map((f) => `<tr><td>${esc(DAMAGE_CATEGORY_LABELS[f.label])}</td><td>${esc(f.severity)}</td><td>${f.confidence}%</td><td>${f.count}</td></tr>`).join('')}</tbody></table>`}
        <p class="reasoning">${esc(slopeResult?.reasoning ?? '')}</p>
      </div>`;
          })
          .join('')
  }

  <h2>5. Collateral Checklist</h2>
  ${
    Object.keys(ins.collateralChecklist).length === 0
      ? '<p class="reasoning">No collateral checklist recorded yet.</p>'
      : `<table>${Object.entries(ins.collateralChecklist)
          .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v ? 'Yes' : 'No'}</td></tr>`)
          .join('')}</table>`
  }

  <h2>6. Insurance-Grade Narrative</h2>
  <p>${esc(narrative(ins, decision, score, worthiness))}</p>

  <h2>7. Homeowner Summary</h2>
  <p>${esc(homeownerSummary(decision, worthiness))}</p>

  <h2>8. Signatures</h2>
  <div class="sig-row">
    <div class="sig-box">
      ${ins.inspectorSignatureSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"><path d="${esc(ins.inspectorSignatureSvg)}" stroke="#0C183C" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><br/>`
        : ''}
      Inspector signature${ins.signedAt ? ` · ${new Date(ins.signedAt).toLocaleDateString()}` : ''}
    </div>
    <div class="sig-box">
      ${ins.homeownerSignatureSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"><path d="${esc(ins.homeownerSignatureSvg)}" stroke="#0C183C" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><br/>`
        : ''}
      Homeowner signature
    </div>
  </div>

  <div class="footer">
    Report ID ${esc(ins.reportId)} · Generated ${esc(generatedAt)} · RoofWise — Forensic Roof Inspection
  </div>
</div>
</body>
</html>`;
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
