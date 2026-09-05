import type { DamageMarker, Inspection, InspectionFinding, PhotoAnalysisState, TrainingItem } from '../models/types';
import { readPhotoAnalysis } from './photoAnalysisState';

export function evidenceKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(evidenceKey).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${evidenceKey(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}
export const markerEvidenceKey = (markers: DamageMarker[]) => markers
  .map(({ photoIndex: _index, ...marker }) => evidenceKey(marker)).sort().join('|');
const findingsEvidenceKey = (findings: InspectionFinding[]) => findings
  .map(({ photoPath: _path, photoAttachmentId: _attachment, ...finding }) => evidenceKey(finding)).sort().join('|');

export type CorrectionSession = {
  id: string;
  inspectionId: string;
  slopeId: string;
  photoPath: string;
  attachmentId: string;
  queueItemId?: string;
  markers: DamageMarker[];
  findings: InspectionFinding[];
  analysisKey: string;
  originalAnalysis?: TrainingItem['originalAnalysis'];
};

/** Current-photo edits pin an attachment and the evidence actually shown. */
export function resolveCorrectionPhoto(inspection: Inspection | undefined, slopeId: string, attachmentId: string, photoPath: string) {
  if (!inspection) throw new Error('The original inspection is no longer available.');
  if (inspection.reportFinalizedAt) throw new Error('Reopen the finalized report before changing its evidence.');
  const slope = inspection.slopes.find((s) => s.id === slopeId);
  const matches = slope?.photoAttachmentIds?.flatMap((id, index) => id === attachmentId ? [index] : []) ?? [];
  if (!slope || matches.length !== 1 || slope.photoPaths[matches[0]] !== photoPath) {
    throw new Error('The photo attachment changed. Reopen the current photo to edit it.');
  }
  const photoIndex = matches[0];
  const analysis = readPhotoAnalysis(slope, photoIndex);
  if (analysis && analysis.status !== 'done') throw new Error('This photo is being analyzed or needs a retry.');
  const single = slope.photoPaths.length === 1;
  const uniqueUri = slope.photoPaths.filter((uri) => uri === photoPath).length === 1;
  if ((!single && slope.damage.some((m) => m.photoIndex == null)) ||
      (slope.aiFindings ?? []).some((f) => !f.photoAttachmentId &&
        ((!f.photoPath && !single) || (f.photoPath === photoPath && !uniqueUri)))) {
    throw new Error('Legacy evidence lacks photo provenance. Analyze the current photos before editing.');
  }
  const findings = (slope.aiFindings ?? []).filter((f) => f.photoAttachmentId
    ? f.photoAttachmentId === attachmentId : f.photoPath === photoPath || (single && !f.photoPath));
  const markers = slope.damage.filter((m) => m.photoIndex === photoIndex || (single && m.photoIndex == null));
  return { slope, photoIndex, findings, markers, analysis };
}

export function validateCorrectionSession(inspection: Inspection | undefined, session: CorrectionSession) {
  const target = resolveCorrectionPhoto(inspection, session.slopeId, session.attachmentId, session.photoPath);
  if (markerEvidenceKey(target.markers) !== markerEvidenceKey(session.markers) ||
      findingsEvidenceKey(target.findings) !== findingsEvidenceKey(session.findings) ||
      evidenceKey(target.analysis) !== session.analysisKey) {
    throw new Error('The evidence changed while editing. Reopen the photo to review the current findings.');
  }
  return target;
}

/** Only edited categories lose their model narrative; unrelated findings survive. */
export function correctedPhotoEvidence(session: CorrectionSession, markers: DamageMarker[]) {
  const changed = [...session.markers, ...markers].filter((marker) => {
    const before = session.markers.find((m) => m.id === marker.id);
    const after = markers.find((m) => m.id === marker.id);
    return !before || !after || markerEvidenceKey([before]) !== markerEvidenceKey([after]);
  });
  const categories = Array.from(new Set(changed.map((m) => m.category)));
  const findings = session.findings.filter((f) => !categories.includes(f.label));
  for (const category of categories) {
    const group = markers.filter((m) => m.category === category);
    if (!group.length) continue;
    findings.push({ label: category, detected: true, count: group.length,
      severity: group.some((m) => m.severity === 'severe') ? 'severe' : group.some((m) => m.severity === 'moderate') ? 'moderate' : 'minor',
      confidence: Math.min(...group.map((m) => m.confidence)),
      note: 'Markers reviewed by inspector.', photoPath: session.photoPath, photoAttachmentId: session.attachmentId });
  }
  return { findings, categories };
}

/** A manual edit is explicit completed review, including photos never sent to AI.
 * Marking roof damage overrides a conflicting model subject; the complete
 * previous metadata is retained in the correction audit by the caller. */
export function manuallyReviewedAnalysis(before: PhotoAnalysisState | undefined, markers: DamageMarker[], at: string): Partial<PhotoAnalysisState> {
  const roofMarked = markers.length > 0;
  const subjectChanged = roofMarked && (before?.noRoofDetected === true || (before?.subject != null && before.subject !== 'roof_field'));
  return {
    status: 'done', at, reviewSource: 'inspector', reviewedAt: at, findingCount: markers.length,
    ...(roofMarked ? { noRoofDetected: false, subject: 'roof_field' } : {}),
    ...(subjectChanged ? { subjectDetail: 'Roof damage marked by inspector.', collateralDamage: undefined } : {}),
  };
}
