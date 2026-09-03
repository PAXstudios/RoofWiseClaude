import { formatDateTime } from '@/lib/format/date';
// Branded proposal PDF generator. expo-print + HTML template.

import * as Print from 'expo-print';
import type { Inspection, Proposal } from '../models/types';
import { INSURANCE_CARRIER_LABELS, ROOF_MATERIAL_LABELS } from '../models/types';
import { useInspectorProfileStore } from '../stores/inspectorProfileStore';
import { companyCoverLine, companyFooterLine } from './haagPdf';

export type GeneratedProposalPdf = {
  uri: string;
  proposal: Proposal;
};

export async function generateProposalPdf(
  proposal: Proposal,
  inspection: Inspection,
): Promise<GeneratedProposalPdf> {
  const html = renderHtml(proposal, inspection);
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  return { uri, proposal };
}

function renderHtml(p: Proposal, ins: Inspection): string {
  const generatedAt = formatDateTime(new Date());
  const carrier = ins.carrier ? INSURANCE_CARRIER_LABELS[ins.carrier] : '—';
  const inspector = useInspectorProfileStore.getState().profile;

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(ins.reportId)} — Proposal</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; color: #0C183C; margin: 0; padding: 0; }
  .page { padding: 32px 40px; }
  .cover { background: #0C183C; color: #fff; padding: 56px 40px; margin: -32px -40px 32px; }
  .brand { display: flex; align-items: center; gap: 12px; }
  .mark { width: 44px; height: 44px; border-radius: 12px; background: #FC6018; display: flex; align-items: center; justify-content: center; font-weight: 700; }
  .mark span { color: #fff; }
  .name { font-size: 22px; font-weight: 700; }
  h1 { font-size: 30px; margin: 24px 0 6px; }
  .sub { color: rgba(240,240,228,0.85); font-size: 14px; }
  .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px 24px; margin-top: 24px; }
  .meta .label { font-size: 11px; color: rgba(240,240,228,0.7); text-transform: uppercase; letter-spacing: 0.5px; }
  .meta .value { font-size: 16px; font-weight: 600; margin-top: 2px; }

  h2 { font-size: 18px; border-bottom: 2px solid #FC6018; padding-bottom: 6px; margin: 36px 0 14px; }
  p { font-size: 13px; line-height: 1.6; }
  .narrative { background: #F0F0E4; padding: 16px; border-radius: 12px; }

  table { width: 100%; border-collapse: collapse; font-size: 13px; margin-top: 8px; }
  th, td { text-align: left; padding: 10px 12px; border-bottom: 1px solid #E0E0D6; }
  th { background: #F0F0E4; font-weight: 600; }
  td.num, th.num { text-align: right; }

  .total-row { background: #FC6018; color: #fff; }
  .total-row td { border: none; font-weight: 700; font-size: 16px; }

  .totals { margin-top: 16px; }
  .totals tr td:first-child { color: #546078; }
  .totals tr td:last-child { text-align: right; font-weight: 600; }

  .terms { font-size: 12px; line-height: 1.6; color: #546078; }

  .sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 32px; }
  .sig-box { border-top: 1px solid #0C183C; padding-top: 8px; font-size: 11px; color: #546078; }

  .footer { text-align: center; color: #546078; font-size: 10px; padding: 24px 0; border-top: 1px solid #E0E0D6; margin-top: 40px; }
</style>
</head>
<body>
<div class="page">
  <div class="cover">
    <div class="brand"><div class="mark"><span>RW</span></div><div class="name">RoofWise</div></div>
    ${companyCoverLine(inspector.company)}
    <h1>Roof Restoration Proposal</h1>
    <div class="sub">${esc(ins.reportId)} · Prepared ${esc(generatedAt)}</div>
    <div class="meta">
      <div><div class="label">Customer</div><div class="value">${esc(ins.customerName)}</div></div>
      <div><div class="label">Property</div><div class="value">${esc(ins.address)}</div></div>
      <div><div class="label">Carrier</div><div class="value">${esc(carrier)}</div></div>
      <div><div class="label">Material</div><div class="value">${esc(ROOF_MATERIAL_LABELS[ins.material])}</div></div>
    </div>
  </div>

  <h2>Cover</h2>
  <div class="narrative">
    <p>${esc(p.coverNarrative ?? '')}</p>
  </div>

  <h2>Scope of work</h2>
  <p>${esc(p.scopeOfWork ?? '')}</p>

  <h2>Line items</h2>
  <table>
    <thead>
      <tr>
        <th>Item</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">Subtotal</th>
      </tr>
    </thead>
    <tbody>
      ${p.lineItems
        .map(
          (li) => `<tr>
          <td>${esc(li.label)}</td>
          <td class="num">${li.quantity.toFixed(1)} ${esc(li.unit)}</td>
          <td class="num">$${li.unitPrice.toFixed(2)}</td>
          <td class="num">$${Math.round(li.subtotal).toLocaleString()}</td>
        </tr>`,
        )
        .join('')}
    </tbody>
  </table>

  <table class="totals">
    <tr><td>Subtotal</td><td>$${p.subtotal.toLocaleString()}</td></tr>
    <tr><td>Tax</td><td>$${p.tax.toLocaleString()}</td></tr>
    <tr><td>Deposit (25%)</td><td>$${p.deposit.toLocaleString()}</td></tr>
    <tr class="total-row"><td>Total</td><td>$${p.total.toLocaleString()}</td></tr>
  </table>

  <h2>Terms</h2>
  <p class="terms">${esc(p.termsText ?? '')}</p>

  <h2>Signatures</h2>
  <div class="sig-row">
    <div class="sig-box">Inspector signature</div>
    <div class="sig-box">
      ${p.homeownerSignatureSvg
        ? `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="80" viewBox="0 0 320 200" preserveAspectRatio="xMidYMid meet"><path d="${esc(p.homeownerSignatureSvg)}" stroke="#0C183C" stroke-width="3" fill="none" stroke-linejoin="round" stroke-linecap="round"/></svg><br/>`
        : ''}
      Homeowner signature
    </div>
  </div>

  <div class="footer">
    Proposal ${esc(p.id)} · Generated ${esc(generatedAt)} · RoofWise — Forensic Roof Inspection${companyFooterLine(inspector.company)}
  </div>
</div>
</body>
</html>`;
}

function esc(s: string | number): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
