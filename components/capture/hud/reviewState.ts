// Pure review-state helpers for the camera: what a captured photo is, what
// the strip/thumbnail should say about it, and how a whole session rolls up
// into one thumbnail ring. No I/O, no React — shared by the screen, the
// review drawer and the last-shot thumbnail so they can never disagree.

import type { PillTone } from '@/components/ui/Pill';
import { isGeminiConfigured } from '@/lib/env';
import type {
  CaptureMode,
  Inspection,
  PhotoAnalysisStatus,
  SlopeOrientation,
} from '@/lib/models/types';
import type { ThumbState } from './ShotThumb';

export type CapturedPhoto = {
  uri: string;
  slope: SlopeOrientation;
  /** One of AREA_TAGS — the subject the inspector had selected when shooting. */
  areaTag: string;
  captureMode: CaptureMode;
  /** Library imports are flagged so the strip can show where a photo came from. */
  imported?: boolean;
  /** Where the photo landed in the store the moment it was taken. */
  inspectionId: string;
  slopeId: string;
  photoIndex: number;
};

/**
 * Screen-local analysis bookkeeping for photos the store has not (yet)
 * recorded a `photoAnalysis` entry for. The store's record wins whenever it
 * exists — this only fills the gap between "attached" and "analyzeSlope
 * wrote something".
 */
export type LocalAnalysis = { status: 'queued' | 'analyzing' | 'failed'; error?: string };

export type StripState = {
  status: PhotoAnalysisStatus | 'no_ai';
  findingCount?: number;
  error?: string;
};

/** State of one thumbnail: the store's record wins, screen-local fills gaps. */
export function stripStateFor(
  photo: CapturedPhoto,
  inspection: Inspection | undefined,
  local: LocalAnalysis | undefined,
): StripState {
  if (!isGeminiConfigured) return { status: 'no_ai' };
  const slope = inspection?.slopes.find((s) => s.id === photo.slopeId);
  const markersOnPhoto = slope
    ? slope.damage.filter((m) => m.photoIndex === photo.photoIndex).length
    : 0;
  const stored = slope?.photoAnalysis?.[photo.uri];
  // Done is done — the store knows before this screen's batch reconciles.
  if (stored?.status === 'done') {
    return { status: 'done', findingCount: stored.findingCount ?? markersOnPhoto };
  }
  // A fresh local queue/analyzing entry (a retry) outranks a stale stored
  // failure; otherwise the store's own record is the truth.
  if (local && local.status !== 'failed') return { status: local.status };
  if (stored) {
    return {
      status: stored.status,
      findingCount: stored.findingCount ?? markersOnPhoto,
      error: stored.error,
    };
  }
  if (slope?.analyzedPhotoIndices?.includes(photo.photoIndex)) {
    return { status: 'done', findingCount: markersOnPhoto };
  }
  if (local) return { status: local.status, error: local.error };
  return { status: 'queued' };
}

export function pillFor(state: StripState): { label: string; tone: PillTone; pulse: boolean } {
  switch (state.status) {
    case 'no_ai':
      return { label: 'No AI', tone: 'warn', pulse: false };
    case 'analyzing':
      return { label: 'Analyzing', tone: 'info', pulse: true };
    case 'done':
      return { label: `Done · ${state.findingCount ?? 0}`, tone: 'success', pulse: false };
    case 'failed':
      return { label: 'Failed · Retry', tone: 'danger', pulse: false };
    default:
      return { label: 'Queued', tone: 'neutral', pulse: false };
  }
}

export type SessionSummary = {
  state: ThumbState;
  total: number;
  done: number;
  analyzing: number;
  queued: number;
  failed: number;
  /** The most recent failure's plain-words reason. */
  lastFailure?: string;
};

/** The whole session in one ring: failed > analyzing > queued > done. */
export function summarizeSession(
  photos: readonly CapturedPhoto[],
  inspection: Inspection | undefined,
  localAnalysis: Record<string, LocalAnalysis | undefined>,
): SessionSummary {
  let done = 0;
  let analyzing = 0;
  let queued = 0;
  let failed = 0;
  let lastFailure: string | undefined;
  for (const p of photos) {
    const s = stripStateFor(p, inspection, localAnalysis[p.uri]);
    if (s.status === 'done') done += 1;
    else if (s.status === 'analyzing') analyzing += 1;
    else if (s.status === 'failed') {
      failed += 1;
      lastFailure = s.error ?? lastFailure;
    } else if (s.status === 'queued') queued += 1;
  }
  const total = photos.length;
  const state: ThumbState =
    total === 0
      ? 'empty'
      : !isGeminiConfigured
      ? 'no_ai'
      : failed > 0
      ? 'failed'
      : analyzing > 0
      ? 'analyzing'
      : queued > 0
      ? 'queued'
      : 'done';
  return { state, total, done, analyzing, queued, failed, lastFailure };
}
