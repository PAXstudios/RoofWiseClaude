import type { Inspection, Slope, TrainingItem } from '../models/types';
import { readPhotoAnalysis } from './photoAnalysisState';

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value)
    .filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

const markersKey = (markers: Slope['damage']) => markers
  .map(({ photoIndex: _index, ...marker }) => stable(marker)).sort().join('|');

/** Fail closed: a stale card cannot erase reanalysis or an inspector's edit. */
export function resolveReviewEvidence(inspection: Inspection | undefined, item: TrainingItem) {
  if (!inspection) throw new Error('The original inspection is no longer available.');
  if (inspection.reportFinalizedAt) throw new Error('Reopen the finalized report before changing its evidence.');
  const candidates = inspection.slopes.filter((s) =>
    (!item.slopeId || s.id === item.slopeId) && s.photoPaths.includes(item.photoPath));
  if (candidates.length !== 1) throw new Error('The original photo is missing or its source is ambiguous.');
  const slope = candidates[0];
  const expected = item.reviewEvidence;
  const attachmentMatches = slope.photoAttachmentIds?.flatMap((id, index) => id === expected?.attachmentId ? [index] : []) ?? [];
  if (expected?.attachmentId && (attachmentMatches.length !== 1 || slope.photoPaths[attachmentMatches[0]] !== item.photoPath)) {
    throw new Error('The original photo attachment is no longer available.');
  }
  if (!expected?.attachmentId && slope.photoPaths.filter((uri) => uri === item.photoPath).length !== 1) {
    throw new Error('This photo has more than one attachment. Open the photo to review it.');
  }
  const photoIndex = expected?.attachmentId ? attachmentMatches[0] : slope.photoPaths.indexOf(item.photoPath);
  const analysis = readPhotoAnalysis(slope, photoIndex);
  const attachmentId = slope.photoAttachmentIds?.[photoIndex];
  if (analysis && analysis.status !== 'done') throw new Error('This photo is being analyzed or needs a retry.');
  // Old cards had neither findings provenance nor an applied-evidence snapshot.
  // Only a single-photo slope can establish ownership of its untagged findings.
  const legacy = !expected && slope.photoPaths.length === 1;
  const findings = (slope.aiFindings ?? []).filter((f) => f.photoAttachmentId
    ? f.photoAttachmentId === attachmentId
    : f.photoPath === item.photoPath || (legacy && !f.photoPath));
  const normalizeFindings = (list: typeof findings) => list
    .map(({ photoPath: _path, photoAttachmentId: _attachment, ...f }) => stable(f)).sort().join('|');
  const liveMarkers = slope.damage.filter((m) => m.photoIndex === photoIndex);
  if ((!expected && !legacy) ||
      (expected?.attachmentId && expected.attachmentId !== slope.photoAttachmentIds?.[photoIndex]) ||
      (!legacy && (slope.aiFindings ?? []).some((f) => !f.photoPath && !f.photoAttachmentId)) ||
      (slope.photoPaths.filter((uri) => uri === item.photoPath).length > 1 &&
        (slope.aiFindings ?? []).some((f) => !f.photoAttachmentId && f.photoPath === item.photoPath)) ||
      (!expected && analysis && analysis.at > item.enqueuedAt) ||
      (expected && expected.analysisAt !== analysis?.at) ||
      markersKey(liveMarkers) !== markersKey(expected?.markers ?? item.originalAnalysis.markers) ||
      normalizeFindings(findings) !== normalizeFindings(expected?.findings ?? item.originalAnalysis.findings) ||
      slope.damage.some((m) => m.photoIndex == null)) {
    throw new Error('The evidence changed or lacks photo provenance. Open the photo and review its current findings.');
  }
  return { slope, photoIndex, findings, liveMarkers };
}
