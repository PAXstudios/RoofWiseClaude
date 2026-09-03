// Gemini vision service — newest Flash model via Google AI Studio direct REST.
// Model id comes from env (`EXPO_PUBLIC_GEMINI_MODEL`, default
// `gemini-3.8-flash`, owner directive 2026-09-01) and is only the FIRST model
// tried: Google retires model ids for new keys (`gemini-2.5-pro` now answers
// HTTP 404 "no longer available"), so every call falls through
// GEMINI_FALLBACK_MODELS on a model-gone response and records which model
// actually answered (`modelUsed`) on the result. Any other failure — quota,
// safety, auth, network, timeout — surfaces AS ITSELF; it is never retried
// across models, because a quota error on 3.8 is a quota error on 3.7 too and
// the roofer needs the real reason.
//
// Spec section "Gemini System Prompt for Damage Detection" +
// docs/PRODUCT_SYNTHESIS.md §1 "AI analysis" (scale-aware detection,
// anti-fabrication guard, ridge-cap false-positive mitigation).
//
// Real API only — no mock fallback (Drift #5). Throws a clear error when the
// API key is missing so callers can surface a friendly "Not available" state.
// A placeholder/invalid key produces GeminiNotConfiguredError or
// GeminiAnalysisError — never synthesized findings.

import {
  DAMAGE_CATEGORIES,
  type DamageCategory,
  type DamageMarker,
  type InspectionFinding,
  type Severity,
  type ShingleTypeClassification,
  type SlopeOrientation,
  PHOTO_SUBJECTS,
  COLLATERAL_DAMAGE_KINDS,
  type PhotoSubject,
  type CollateralFinding,
  type CollateralDamageKind,
  ROOF_MATERIAL_LABELS,
  type CaptureMode,
  type RoofMaterial,
  type HitEvidence,
} from '../models/types';
import { env, isGeminiConfigured } from '../env';

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Deprecation-proof fallback chain, newest first. Verified live 2026-09-01
 * against the owner's key (see PROMPT_LOG for the ground-truth table): every
 * entry answers the vision + structured-JSON damage request with valid JSON.
 * The configured model is always tried first; these follow, deduplicated.
 * `gemini-2.5-flash` is the last resort only — older, kept so a total retire
 * of the 3.x line still leaves the roofer with an answer.
 */
export const GEMINI_FALLBACK_MODELS: readonly string[] = [
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.5-flash',
  'gemini-2.5-flash',
];

/** Hard per-attempt ceiling. A 2560px JPEG + JSON reply lands in ~2–8 s on
 *  Flash; anything past a minute is a hung socket, not a slow model. */
export const GEMINI_TIMEOUT_MS = 60_000;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini API key not configured. Set EXPO_PUBLIC_GEMINI_API_KEY in .env.local.');
    this.name = 'GeminiNotConfiguredError';
  }
}

/**
 * Coarse failure class so callers can decide retry vs. stop and show honest
 * copy. `model_unavailable` means the WHOLE chain was exhausted, not a single
 * 404 (single 404s are absorbed by the fallback).
 */
export type GeminiErrorCode =
  | 'model_unavailable'
  | 'auth'
  | 'bad_request'
  | 'quota'
  | 'safety'
  | 'timeout'
  | 'network'
  | 'server'
  | 'bad_response';

export class GeminiAnalysisError extends Error {
  constructor(
    message: string,
    public status?: number,
    public code: GeminiErrorCode = 'bad_response',
  ) {
    super(message);
    this.name = 'GeminiAnalysisError';
  }
}

/** True for failures a later attempt can plausibly fix (rate limit, hung
 *  socket, offline, 5xx). Auth, safety, bad request, exhausted model chain and
 *  unparseable output are NOT retryable — retrying them only burns quota and
 *  hides the real reason from the roofer. */
export function isRetryableGeminiError(e: unknown): boolean {
  if (!(e instanceof GeminiAnalysisError)) {
    // Unknown throwables (file read errors etc.) are the caller's call; a
    // GeminiNotConfiguredError is never retryable.
    return !(e instanceof GeminiNotConfiguredError);
  }
  return e.code === 'quota' || e.code === 'timeout' || e.code === 'network' || e.code === 'server';
}

/** Plain-words reason for UI copy — never the raw JSON dump. */
export function describeAnalysisError(e: unknown): string {
  if (e instanceof GeminiNotConfiguredError) {
    return 'AI not connected — add EXPO_PUBLIC_GEMINI_API_KEY to .env.local.';
  }
  if (e instanceof Error && e.message.trim().length > 0) return e.message;
  return 'Analysis failed for an unknown reason.';
}

// Once a fallback model has answered, later calls start from it instead of
// paying a 404 round-trip per photo on the retired one. Process-lifetime
// only — a fresh launch re-tries the configured model, so a restored model
// or a corrected env value wins again without a code change.
let preferredModel: string | null = null;

/** The model the next call will try first. For Diagnostics / report footer. */
export function getActiveGeminiModel(): string {
  return preferredModel ?? env.GEMINI_MODEL;
}

/** Ordered, deduplicated list of models a call will try. */
export function geminiModelChain(): string[] {
  const chain = [preferredModel, env.GEMINI_MODEL, ...GEMINI_FALLBACK_MODELS].filter(
    (m): m is string => typeof m === 'string' && m.trim().length > 0,
  );
  return Array.from(new Set(chain));
}

/** HTTP 404 / NOT_FOUND / "no longer available" — the only failure class
 *  that moves on to the next model in the chain. The body phrases are
 *  consulted only on a 404 or a 400 (Google's two "that model id is not
 *  served here" shapes); a 401/403/429/5xx never walks the chain, whatever
 *  its body says — those must surface as themselves. */
function isModelGone(status: number, bodyText: string): boolean {
  if (status === 404) return true;
  if (status !== 400) return false;
  return (
    /"status"\s*:\s*"NOT_FOUND"/.test(bodyText) ||
    /no longer available/i.test(bodyText) ||
    /is not found for API version/i.test(bodyText)
  );
}

function errorSnippet(bodyText: string): string {
  try {
    const parsed = JSON.parse(bodyText);
    const msg = parsed?.error?.message;
    if (typeof msg === 'string' && msg.length > 0) return msg.slice(0, 240);
  } catch {
    // Not JSON — fall through to the raw slice.
  }
  return bodyText.replace(/\s+/g, ' ').trim().slice(0, 240);
}

function classifyHttpError(model: string, status: number, bodyText: string): GeminiAnalysisError {
  const snippet = errorSnippet(bodyText);
  if (status === 400 && /API key not valid/i.test(bodyText)) {
    return new GeminiAnalysisError(
      'Gemini rejected the API key as invalid (400). Check EXPO_PUBLIC_GEMINI_API_KEY.',
      status,
      'auth',
    );
  }
  if (status === 400) {
    return new GeminiAnalysisError(`Gemini rejected the request (400): ${snippet}`, status, 'bad_request');
  }
  if (status === 401 || status === 403) {
    return new GeminiAnalysisError(
      `Gemini API key not authorized (${status}) for ${model}. Check the key and its restrictions in AI Studio.`,
      status,
      'auth',
    );
  }
  if (status === 429) {
    return new GeminiAnalysisError(
      'Gemini quota or rate limit hit (429). Wait a minute and retry, or check billing in AI Studio.',
      status,
      'quota',
    );
  }
  if (status >= 500) {
    return new GeminiAnalysisError(
      `Gemini is unavailable right now (${status}). Retry in a moment.`,
      status,
      'server',
    );
  }
  return new GeminiAnalysisError(`Gemini ${status} on ${model}: ${snippet}`, status, 'bad_response');
}

export type GenerateContentOutcome = {
  /** Raw generateContent JSON body. */
  json: any;
  /** Model id that answered. */
  modelUsed: string;
  /** Wall-clock ms of the answering attempt only. */
  latencyMs: number;
  /** Models that returned model-gone before `modelUsed` answered. */
  modelsSkipped: string[];
};

export type GenerateContentOptions = {
  /** Per-attempt timeout. Defaults to GEMINI_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Caller-side cancel (screen unmounted, live scan stopped). */
  signal?: AbortSignal;
};

/**
 * POST a generateContent body through the fallback chain. Exported so other
 * Gemini callers (transcription, live scan) share one transport instead of
 * re-implementing the 404 handling. Throws GeminiAnalysisError with a code;
 * never returns synthesized content.
 */
export async function geminiGenerateContent(
  body: unknown,
  opts: GenerateContentOptions = {},
): Promise<GenerateContentOutcome> {
  if (!isGeminiConfigured) throw new GeminiNotConfiguredError();

  const timeoutMs = opts.timeoutMs ?? GEMINI_TIMEOUT_MS;
  const chain = geminiModelChain();
  const payload = JSON.stringify(body);
  const modelsSkipped: string[] = [];

  for (const model of chain) {
    if (opts.signal?.aborted) {
      throw new GeminiAnalysisError('Analysis cancelled.', undefined, 'timeout');
    }
    const controller = new AbortController();
    const onOuterAbort = () => controller.abort();
    opts.signal?.addEventListener('abort', onOuterAbort);
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);

    const startedAt = Date.now();
    let res: Response;
    try {
      res = await fetch(`${endpoint(model)}?key=${env.GEMINI_API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      opts.signal?.removeEventListener('abort', onOuterAbort);
      if (timedOut) {
        throw new GeminiAnalysisError(
          `Gemini did not answer within ${Math.max(1, Math.round(timeoutMs / 1000))} s (${model}). Check signal and retry.`,
          undefined,
          'timeout',
        );
      }
      if (opts.signal?.aborted) {
        throw new GeminiAnalysisError('Analysis cancelled.', undefined, 'timeout');
      }
      const detail = e instanceof Error ? e.message : String(e);
      throw new GeminiAnalysisError(
        `Could not reach Gemini (${detail}). Check the connection and retry.`,
        undefined,
        'network',
      );
    }
    clearTimeout(timer);
    opts.signal?.removeEventListener('abort', onOuterAbort);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (isModelGone(res.status, text)) {
        modelsSkipped.push(model);
        if (__DEV__) {
          console.warn(`[gemini] ${model} unavailable (${res.status}) — trying next in chain`);
        }
        continue;
      }
      throw classifyHttpError(model, res.status, text);
    }

    let json: any;
    try {
      json = await res.json();
    } catch {
      throw new GeminiAnalysisError(
        `Gemini (${model}) returned an unreadable response body.`,
        res.status,
        'bad_response',
      );
    }

    const latencyMs = Date.now() - startedAt;
    if (model !== preferredModel) {
      if (model !== env.GEMINI_MODEL && __DEV__) {
        console.info(`[gemini] answered by fallback model ${model} in ${latencyMs} ms`);
      }
      preferredModel = model;
    }
    return { json, modelUsed: model, latencyMs, modelsSkipped };
  }

  throw new GeminiAnalysisError(
    `No Gemini model answered — tried ${modelsSkipped.join(', ')} (all retired or unavailable). ` +
      'Set EXPO_PUBLIC_GEMINI_MODEL to a current model from aistudio.google.com.',
    404,
    'model_unavailable',
  );
}

/**
 * Concatenate the answer text from a generateContent body. Thinking models
 * may prepend `thought: true` parts — those are never the answer. An empty
 * answer is reported with the model's own reason (safety block, token cap),
 * never treated as "no findings".
 */
export function extractGeminiText(json: any, modelUsed: string): string {
  const blockReason = json?.promptFeedback?.blockReason;
  if (typeof blockReason === 'string' && blockReason.length > 0) {
    throw new GeminiAnalysisError(
      `Gemini safety filter blocked this photo (${blockReason}). Re-shoot the roof surface only.`,
      undefined,
      'safety',
    );
  }
  const candidate = json?.candidates?.[0];
  const parts: any[] = Array.isArray(candidate?.content?.parts) ? candidate.content.parts : [];
  const text = parts
    .filter((p) => p && p.thought !== true)
    .map((p) => (typeof p.text === 'string' ? p.text : typeof p.inline_text === 'string' ? p.inline_text : ''))
    .join('')
    .trim();
  if (text.length > 0) return text;

  const finish = typeof candidate?.finishReason === 'string' ? candidate.finishReason : '';
  if (finish === 'SAFETY' || finish === 'RECITATION' || finish === 'PROHIBITED_CONTENT') {
    throw new GeminiAnalysisError(
      `Gemini declined to describe this photo (${finish}). Re-shoot the roof surface only.`,
      undefined,
      'safety',
    );
  }
  throw new GeminiAnalysisError(
    `Gemini (${modelUsed}) returned an empty answer${finish ? ` (${finish})` : ''}. Retry.`,
    undefined,
    'bad_response',
  );
}

export type DetectionAudit = {
  /** Parseable detections the model returned, before client filtering. */
  rawCount: number;
  /** Detections that survived sanitizeMarkers. */
  keptCount: number;
  /** True when the whole batch was rejected as a grid hallucination. */
  gridRejected: boolean;
};

/** Scale calibration derived from the in-photo shingle ruler.
 *  Standard asphalt shingle geometry (12in x 36in, ~5.6in exposed course)
 *  gives the model a known physical reference in almost every roof photo. */
export type ShingleScaleEstimate = {
  /** Estimated image resolution at the roof plane. Null when the model found
   *  no reliable shingle feature to measure (extreme angle, macro crop,
   *  non-asphalt material). */
  pixelsPerInch: number | null;
  /** Which shingle feature the model measured to derive the scale. */
  reference?: string;
  /** 0-100 — how confident the model is in the scale estimate itself. */
  confidence: number;
};

/** Friendly copy for the no-roof state (Drift #5 — honest empty state,
 *  never synthesized findings). Call sites surface this when
 *  `noRoofDetected` is true instead of the "withheld detections" copy. */
export const NO_ROOF_MESSAGE =
  'No roof detected in this photo. Nothing was flagged — re-aim at the shingle surface and re-shoot.';

export type AnalysisResult = {
  analyzed: boolean;
  /** Anti-fabrication guard: true when the model could not identify a
   *  roof/shingle surface in frame. Findings and markers are always empty
   *  when set — surface NO_ROOF_MESSAGE in the UI. */
  noRoofDetected: boolean;
  /** What the frame shows — identified even when it is not a roof. */
  subject?: PhotoSubject;
  subjectDetail?: string;
  /** Damage on a non-roof subject. Corroboration only, never roof hits. */
  collateralDamage?: CollateralFinding[];
  /** Whole shingles visible (roof photos). */
  shingleCount?: number;
  /** Fraction of one 100 sq ft test square this frame documents. */
  squareCoverage?: { visible: boolean; fraction: number; confidence: number };
  shingleType?: ShingleTypeClassification;
  /** Persisted on the result for calibration logging/sync. Absent on older
   *  cached results that predate scale-aware detection. */
  shingleScaleEstimate?: ShingleScaleEstimate;
  findings: InspectionFinding[];
  markers: DamageMarker[];
  /** Why markers may differ from what the model produced — drives the
   *  "AI withheld detections" inspector toast. */
  detectionAudit: DetectionAudit;
  raw: unknown;
  /** Model id that actually answered — may be a fallback, never assumed.
   *  Shown in the report footer + Diagnostics. Absent on cached results that
   *  predate the fallback chain. */
  modelUsed?: string;
  /** Wall-clock ms of the answering request. */
  latencyMs?: number;
  /** Models that returned "no longer available" before `modelUsed` answered. */
  modelsSkipped?: string[];
};

const SYSTEM_PROMPT = `You are a forensic roof inspector trained on HAAG (Haag Engineering) standards. You are reviewing a single roof photograph.

Your output drives an overlay drawn on top of the photo. The inspector trusts you to flag every real damage instance — under-detection is just as bad as over-detection. Detect comprehensively, then describe the evidence honestly so the inspector can verify.

Return STRICT JSON only (no markdown wrapper), with this exact schema:

{
  "analyzed": true|false,
  "no_roof_detected": true|false,
  "shingle_scale_estimate": {
    "pixels_per_inch": <number, or null when no reliable reference is measurable>,
    "reference": "<which shingle feature you measured and its approximate pixel extent>",
    "confidence": 0-100
  },
  "shingle_type": {
    "type": "3-tab asphalt|architectural asphalt|luxury asphalt|wood shake|wood shingle|metal standing seam|metal shingle|clay tile|concrete tile|slate|synthetic slate|composite|rolled roofing|TPO|EPDM|unknown",
    "confidence": 0-100,
    "note": "<short evidence>"
  },
  "subject": "roof_field|gutter_downspout|hvac_condenser|siding|window_screen|fascia_soffit|garage_door|fence_gate|roof_vent_soft_metal|chimney|skylight|vehicle|other|unidentifiable",
  "subject_detail": "<one short line: what is in frame and where, e.g. 'aluminum gutter run, north eave, several dents'>",
  "collateral_damage": [
    {
      "kind": "dents|bent_fins|spatter|cracks|punctures|tears|other",
      "severity": "minor|moderate|severe",
      "confidence": 0-100,
      "note": "<short pixel evidence>"
    }
  ],
  "shingle_count": <int: whole shingles visible in frame, or null when they cannot be counted>,
  "test_square_coverage": {
    "visible": true|false,
    "fraction": <0-1: how much of ONE 10x10 ft (100 sq ft) test square this frame shows>,
    "confidence": 0-100
  },
  "findings": [
    {
      "label": "hail_hits|bruising|granule_loss|wind_damage|wind_creasing|blistering|cracking|flashing_damage|algae_moss|missing_shingles|splitting|lifted_shingles|structural_sagging",
      "detected": true|false,
      "severity": "none|minor|moderate|severe",
      "confidence": 0-100,
      "count": <int>,
      "note": "<short pixel evidence>"
    }
  ],
  "detections": [
    {
      "box_2d": [ymin, xmin, ymax, xmax],
      "label": "hail_hits|bruising|granule_loss|wind_damage|wind_creasing|blistering|cracking|flashing_damage|algae_moss|missing_shingles|splitting|lifted_shingles|structural_sagging",
      "severity": "minor|moderate|severe",
      "confidence": 0-100,
      "evidence": "mat_fracture|exposed_substrate|granule_loss_only|cosmetic|unclear",
      "note": "<specific pixel feature inside the box — color, shape, size, what makes it damage>"
    }
  ]
}

STEP 0 — IDENTIFY THE SUBJECT, THEN THE ANTI-FABRICATION GUARD (absolute; evaluate before anything else)
First say what the frame shows in "subject". A roof/shingle surface is "roof_field". Anything else — a gutter or downspout, an HVAC condenser, siding, a window or screen, fascia/soffit, a garage door, a fence, a roof vent / turbine / soft-metal cap, a chimney, a skylight, a vehicle — is named with the matching value and described in one line in "subject_detail"; use "other" for a recognisable subject not in the list and "unidentifiable" only when you genuinely cannot tell (blank, corrupted, indoors, sky, an unrelated screenshot).
If the subject is NOT "roof_field", you MUST return "analyzed": false, "no_roof_detected": true, EMPTY "findings", EMPTY "detections", and "shingle_scale_estimate" with pixels_per_inch null — the 13 roof categories and the per-square hit count apply ONLY to a roof field. Instead, describe the damage you can see on that subject in "collateral_damage" (dents, bent condenser fins, hail spatter on oxidised metal, cracks, punctures, torn screens) with severity and confidence. Collateral damage is corroborating evidence about the hailstorm — its size, hardness and direction — and is valuable, but it is never a roof hit. NEVER invent findings to be helpful: zero roof findings on a non-roof photo is the correct, expected answer, and zero collateral findings on an undamaged gutter is too.
When the subject IS "roof_field", set "no_roof_detected": false, leave "collateral_damage" empty, and continue.

STEP 1 — CALIBRATE SCALE (before sizing any detection)
Standard asphalt shingles are manufactured to known dimensions: a full shingle is 12in tall x 36in wide, and the exposed course (the visible band between horizontal course lines) is ~5.6in tall. On 3-tab shingles each tab is ~12in wide. Use whichever of these is most cleanly visible as an in-photo ruler:
- Measure that feature's extent in image pixels, divide by its known size in inches, and report the result as "shingle_scale_estimate.pixels_per_inch", naming what you measured in "reference".
- If no shingle geometry is measurable (extreme oblique angle, tight macro crop, non-asphalt material), report "pixels_per_inch": null and lower your detection confidences to reflect the missing scale anchor.
- Size EVERY detection by its pixel extent RELATIVE TO THIS SCALE: convert a candidate's pixel extent into inches using your estimate and check that the physical size is plausible for that damage class before emitting it. Do NOT assume any fixed pixel size for damage, and do NOT apply a memorized absolute size range without converting through the measured scale — the same hail bruise can span 15px in a wide establishing shot and 400px in a close-up.

ALL 13 DAMAGE CATEGORIES ARE IN SCOPE
You are not a hail-only detector. Look for and emit detections for every category visible: hail_hits AND bruising AND granule_loss AND wind_damage AND wind_creasing AND blistering AND cracking AND flashing_damage AND algae_moss AND missing_shingles AND splitting AND lifted_shingles AND structural_sagging. Multiple categories can and often do appear in the same photo.

BOUNDING-BOX COORDINATE SYSTEM (critical — use the integer 0–1000 scale, NOT decimal fractions)
"box_2d" is a 4-integer array [ymin, xmin, ymax, xmax] where each value is on a 0–1000 scale relative to the image (ymin=0 is the top edge, ymax=1000 is the bottom edge; xmin=0 is the left, xmax=1000 is the right). Boxes tightly enclose the damage instance — no padding. Box extent follows from the calibrated scale (STEP 1), never from a stock size: measure the damage's true pixel extent, then express it on the 0–1000 scale. There is no "typical" box size — it depends entirely on how close the shot is. ymin < ymax and xmin < xmax always.

DETECTION VOLUME GUIDANCE (calibrate to what you see)
- Clean roof, no storm: 0–2 detections (most likely 0).
- Light weathering with a few age-related blemishes: 2–6 detections, mostly granule_loss / minor cracking.
- Confirmed hail or wind storm damage: 5–20 detections is normal.
- Severe widespread storm damage: 15–30 detections is appropriate.
Detect every distinct damage instance you can see. Do not artificially cap yourself.

ANTI-HALLUCINATION RULES (avoid these specific failure modes)

1. Each detection MUST point at a single, named, visible feature inside the box. Your "note" must answer: "what color/shape/texture inside this box tells me this is damage?" If you cannot answer that with a unique observation, do NOT output the detection.

2. NEVER produce a perfect grid. Real damage is mostly randomly distributed across the slope. A few impacts may coincidentally line up — that's fine. But if you find yourself outputting 6+ boxes with the same x-center or evenly-stepped y values, you are pattern-matching the shingle layout. Stop and rebuild from actual pixel evidence.

3. SHINGLE FEATURES ARE NOT DAMAGE. Architectural asphalt shingles have intentional dark shadow bands, dimensional cutouts, and color variation between tabs. The dark horizontal line between courses is a shadow joint, not missing shingles or wind damage. The dimensional cutouts on each tab are by design, not impacts.

4. GRANULE LOSS — output ONE box per patch covering the whole visible patch, not multiple boxes inside one patch.

5. HAIL HITS — each strike is its own box. A hail bruise has: a circular/oval shape, exposed darker substrate (mat) in the center, granule displacement at the edges, often with a faint shiny appearance from compressed asphalt. Judge its size through the calibrated scale (STEP 1), never against a fixed pixel expectation.

6. RIDGE AND HIP CAPS ARE FALSE-POSITIVE MAGNETS. The cut edges of ridge/hip cap shingles, their overlap seams, and the hard shadow lines they cast are routinely mistaken for hail hits. For any candidate detection on or immediately adjacent to a ridge or hip line, emit it as hail_hits or bruising ONLY if you can see mat fracture or exposed substrate INSIDE the mark itself — a cap edge, seam, or shadow line alone is not evidence. Without that substrate-level evidence, either skip the detection or emit it with confidence below 60 and a note stating it sits on a ridge line with limited evidence.

FINDINGS (the 13-row summary table)
Include all 13 damage categories in "findings". "detected": true when that category is genuinely present. "count" is the number of distinct instances visible (should roughly match the number of boxes you output for that category).

HAAG FUNCTIONAL TEST — "evidence" on every hail_hits / bruising detection (this decides the claim)
HAAG defines functional hail damage on asphalt as a puncture, tear, or FRACTURE OF THE SHINGLE MAT (a bruise: an indentation with a fracture in the mat that feels soft). Granule loss that does not expose the mat is NOT functional damage by itself. For every hail_hits or bruising box, set "evidence":
- "mat_fracture": you can see the fiberglass/organic mat fractured or crushed inside the mark.
- "exposed_substrate": the dark asphalt/mat is visibly exposed through the granules at the impact centre.
- "granule_loss_only": granules displaced, but the mat below looks intact.
- "cosmetic": a mark with no loss of granules or mat integrity (spatter, algae shadow).
- "unclear": cannot tell at this resolution or angle.
Be strict. An inspector's per-slope functional determination is derived from mat_fracture / exposed_substrate evidence on test-square photos; claiming a mat fracture that is not visible is the most expensive mistake this tool can make, and missing one that is visible is the second.

HAAG LOOK-ALIKES (do not report these as hail)
- Blisters: raised bubbles, often with a popped crater and granules still around the rim; a rough, irregular floor, not a fractured mat. Report as blistering, never hail_hits.
- Mechanical / foot-traffic scuffs: linear or smeared granule loss, often in a walking path, with no circular impact geometry.
- Manufacturing defects and rasp marks: uniform or repeating patterns from the factory.
- Thermal cracking / craze: fine linear cracks with age, no impact centre.
- Nail pops, hip/ridge cap edges and shadow lines (rule 6), tab cutouts and shadow bands (rule 3).
If a mark could be any of these, choose the look-alike category or lower the evidence to "unclear" — never upgrade to hail on a hunch.

COUNTING (fill "shingle_count" and "test_square_coverage")
- "shingle_count": whole shingles fully visible in frame (count courses x shingles per course for the visible area; for laminate, count exposed-course units). null when framing, angle or material makes a count meaningless.
- "test_square_coverage": inspectors chalk a 10x10 ft (100 sq ft) test square. If chalk lines are visible, set "visible": true and estimate the fraction of ONE square this frame contains (a whole chalked square = 1.0; half = 0.5). Without chalk, estimate the fraction from the calibrated scale (STEP 1): frame width in inches / 120, times frame height in inches / 120, capped at 1.0, with lower confidence. This adds up to how many squares the photos actually document.

CONFIDENCE RUBRIC (apply per-detection — be willing to commit to high confidence when the evidence is clear)
- 90–100: Unmistakable. Multiple definitive indicators visible (e.g. for hail: circular shape + exposed mat + granule displacement). Use this freely when warranted.
- 75–89: Clear damage with one strong indicator. Most real detections land here.
- 60–74: Probable damage but partial view, glare, or angle leaves some ambiguity.
- 45–59: Possible damage, worth flagging for inspector review.
- Below 45: Do not emit a detection.

Calibrate honestly. If you see clear hail bruising, score 90+. Do not default every detection to 75 — uniform confidences mean you are hedging, which is itself dishonest.`;

export type AnalyzeOptions = {
  /** Base64-encoded JPEG image bytes (no data URI prefix). */
  imageBase64: string;
  mimeType?: string;
  slope?: SlopeOrientation;
  /** How the frame was shot — a 10x10 test square or a single-shingle close-up. */
  captureMode?: CaptureMode;
  /** The job's declared roof material (the model still reports what it sees). */
  material?: RoofMaterial;
  /** What the inspector said the frame is of ("Front Slope", "Gutters / Downspouts"). */
  areaTag?: string;
  /** Optional per-user prompt prefix from LocalLearningEngine. */
  userStylePrefix?: string;
  /** Caller-side cancel (screen unmounted, live scan stopped). */
  signal?: AbortSignal;
  /** Per-attempt timeout override. Defaults to GEMINI_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Live-viewfinder frame (components/capture/LiveOverlay.tsx): a reduced
   * ≤1024px grab whose result is drawn for a few seconds and discarded. The
   * system prompt and schema are unchanged; the user turn asks for the
   * detections + the no-roof verdict only, so the 13-row findings table is
   * not generated for a frame nobody stores. Never set for a saved photo.
   */
  live?: boolean;
};

/** Extra user-turn text for a live frame. Same schema, less output. */
const LIVE_FRAME_ADDENDUM =
  '\n\nLIVE VIEWFINDER FRAME: this is a reduced-resolution preview grab that is shown for a few seconds and then discarded — it is not the inspection photo. Apply STEP 0 and STEP 1 exactly as above, then return the same JSON schema with "detections" populated for every visible damage instance and "findings" as an empty array. Always fill "shingle_scale_estimate", "shingle_count" and "test_square_coverage" — the viewfinder draws a 10x10 test-square guide from your pixels_per_inch and shows the shingle count live, so a null scale hides the guide. Do not lower your evidence bar: a box you would not draw on a full-resolution photo must not be drawn here either.';

/**
 * The exact generateContent body `analyzePhoto` sends. Exported so the
 * request contract (13 canonical categories, severity, 0–100 confidence,
 * 0–1000 bboxes, no_roof_detected, shingle_scale_estimate) can be exercised
 * against the live API without the file-system half of the pipeline.
 */
export function buildAnalyzeRequest(opts: AnalyzeOptions): unknown {
  // What the inspector told the camera. The model still reports what it SEES
  // (a declared 3-tab that is really laminate is reported as laminate), but
  // knowing this is a chalked test square vs a close-up changes what counting
  // and coverage mean, and the declared material sets the geometry to
  // calibrate against.
  const context: string[] = [];
  if (opts.slope) context.push(`slope orientation ${opts.slope}`);
  if (opts.areaTag) context.push(`inspector's subject tag "${opts.areaTag}"`);
  if (opts.captureMode) {
    context.push(
      opts.captureMode === 'square_10x10'
        ? 'shot as a 10x10 ft TEST SQUARE (expect a chalked square; count hits per square)'
        : 'shot as a SINGLE-SHINGLE close-up (several marks on one shingle are NOT several hits in a square; test_square_coverage should be small)',
    );
  }
  if (opts.material) context.push(`declared roof material ${ROOF_MATERIAL_LABELS[opts.material]}`);
  const slopeHint = context.length > 0 ? `\n\nCAPTURE CONTEXT: ${context.join('; ')}.` : '';
  const prefix = opts.userStylePrefix ? `${opts.userStylePrefix}\n\n` : '';
  const liveAddendum = opts.live ? LIVE_FRAME_ADDENDUM : '';

  return {
    systemInstruction: {
      role: 'system',
      parts: [{ text: prefix + SYSTEM_PROMPT + slopeHint }],
    },
    contents: [
      {
        role: 'user',
        parts: [
          {
            inlineData: {
              mimeType: opts.mimeType ?? 'image/jpeg',
              data: opts.imageBase64,
            },
          },
          {
            text: 'Analyze this roof photograph. First confirm a roof/shingle surface is actually in frame (if not, return no_roof_detected: true with zero findings), then calibrate pixels-per-inch from the standard shingle geometry and report shingle_scale_estimate. Identify the shingle type, evaluate all 13 damage categories in findings, and detect every distinct damage instance you can see with a tight bounding box on the 0–1000 integer scale (box_2d), sized by pixel extent relative to your scale estimate. Cover ALL damage categories present — hail, wind, granule loss, missing shingles, cracking, blistering, lifted shingles, flashing, algae, structural sagging, splitting, bruising, wind creasing. If real storm damage is present you should output many detections; the inspector trusts you to flag everything they would.' +
              liveAddendum,
          },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      // Spatial coordinate generation is the failure-prone path; high
      // determinism keeps the model from drifting into grid hallucinations.
      temperature: 0.1,
    },
  };
}

export async function analyzePhoto(opts: AnalyzeOptions): Promise<AnalysisResult> {
  if (!isGeminiConfigured) throw new GeminiNotConfiguredError();

  const body = buildAnalyzeRequest(opts);
  const { json, modelUsed, latencyMs, modelsSkipped } = await geminiGenerateContent(body, {
    signal: opts.signal,
    timeoutMs: opts.timeoutMs,
  });

  const text = extractGeminiText(json, modelUsed);

  let parsed: any;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new GeminiAnalysisError(
      `Gemini (${modelUsed}) returned non-JSON output. Retry.`,
      undefined,
      'bad_response',
    );
  }

  const result = normalize(parsed, json);
  result.modelUsed = modelUsed;
  result.latencyMs = latencyMs;
  if (modelsSkipped.length > 0) result.modelsSkipped = modelsSkipped;
  return result;
}

function normalize(parsed: any, raw: unknown): AnalysisResult {
  const noRoofDetected =
    // Current prompt: explicit machine-readable flag.
    parsed?.no_roof_detected === true ||
    parsed?.analyzed === false ||
    // Legacy prompt versions signalled this as a pseudo-finding; keep parsing
    // it so older cached responses still surface the state.
    !!parsed?.findings?.find?.((f: any) => f?.label === 'no_roof_detected');

  const shingleScaleEstimate = parseScaleEstimate(parsed?.shingle_scale_estimate);
  const subject = parseSubject(parsed?.subject, noRoofDetected);
  const subjectDetail =
    typeof parsed?.subject_detail === 'string' && parsed.subject_detail.trim().length > 0
      ? parsed.subject_detail.trim().slice(0, 200)
      : undefined;
  // Collateral only ever rides a NON-roof frame: a roof photo's damage is in
  // the 13 categories, and letting a model attach "dents" to a shingle field
  // would be a second, uncounted channel for roof findings (Drift #7).
  const collateralDamage = noRoofDetected ? parseCollateral(parsed?.collateral_damage) : undefined;

  if (noRoofDetected) {
    // Anti-fabrication guard: a no-roof verdict wins over any detections the
    // model contradicted itself with — zero findings is the only honest
    // output (Drift #5). The audit reports an empty batch so the "AI
    // withheld detections" toast (which coaches a re-shoot for light) never
    // fires for a non-roof photo; callers surface NO_ROOF_MESSAGE via the
    // noRoofDetected flag instead.
    return {
      analyzed: false,
      noRoofDetected: true,
      subject,
      subjectDetail,
      collateralDamage,
      shingleType: undefined,
      shingleScaleEstimate,
      findings: [],
      markers: [],
      detectionAudit: { rawCount: 0, keptCount: 0, gridRejected: false },
      raw,
    };
  }

  const findings: InspectionFinding[] = (parsed?.findings ?? [])
    .map((f: any): InspectionFinding | null => {
      if (!isDamageCategory(f?.label)) return null;
      return {
        label: f.label as DamageCategory,
        detected: !!f.detected,
        severity: coerceSeverity(f.severity),
        confidence: clamp(Number(f.confidence ?? 0), 0, 100),
        count: Math.max(0, Number(f.count ?? 0)),
        note: typeof f.note === 'string' ? f.note : undefined,
      };
    })
    .filter(Boolean) as InspectionFinding[];

  // Primary path: Gemini's native bounding-box detection mode. Boxes are
  // [ymin, xmin, ymax, xmax] on the 0–1000 integer scale; we convert each
  // to the existing DamageMarker shape (center + radius) so the overlay
  // renderer doesn't need to change.
  const detections: DamageMarker[] = (parsed?.detections ?? [])
    .map((d: any, i: number): DamageMarker | null => {
      const cat = mapMarkerType(d?.label);
      if (!cat) return null;
      const box = bboxFrom(d?.box_2d);
      if (!box) return null;
      const { x, y, radius } = bboxToCircle(box);
      return {
        id: `mk_${Date.now()}_${i}`,
        category: cat,
        severity: coerceSeverity(d.severity),
        x,
        y,
        radius,
        box,
        confidence: clamp(Number(d.confidence ?? 0), 0, 100),
        note: typeof d.note === 'string' ? d.note : undefined,
        evidence: parseEvidence(d.evidence),
      };
    })
    .filter(Boolean) as DamageMarker[];

  // Fallback path: a stale response that still uses the legacy
  // damage_markers shape. Keep parsing it so the app doesn't lose data
  // if Gemini ever ignores the new schema.
  const legacyMarkers: DamageMarker[] = (parsed?.damage_markers ?? [])
    .map((m: any, i: number): DamageMarker | null => {
      const cat = mapMarkerType(m?.type);
      if (!cat) return null;
      return {
        id: `mk_${Date.now()}_legacy_${i}`,
        category: cat,
        severity: coerceSeverity(m.severity),
        x: clamp(Number(m.x ?? 0), 0, 1),
        y: clamp(Number(m.y ?? 0), 0, 1),
        radius: clamp(Number(m.radius ?? 0.02), 0, 1),
        confidence: clamp(Number(m.confidence ?? 0), 0, 100),
        note: typeof m.note === 'string' ? m.note : undefined,
      };
    })
    .filter(Boolean) as DamageMarker[];

  const candidates = detections.length > 0 ? detections : legacyMarkers;
  const { markers, gridRejected } = sanitizeMarkers(candidates);

  const shingleCountRaw = Number(parsed?.shingle_count);
  const shingleCount =
    Number.isFinite(shingleCountRaw) && shingleCountRaw >= 0 ? Math.round(shingleCountRaw) : undefined;
  const squareCoverage = parseCoverage(parsed?.test_square_coverage);

  const shingleType: ShingleTypeClassification | undefined = parsed?.shingle_type?.type
    ? {
        type: String(parsed.shingle_type.type),
        confidence: clamp(Number(parsed.shingle_type.confidence ?? 0), 0, 100),
        note:
          typeof parsed.shingle_type.note === 'string'
            ? parsed.shingle_type.note
            : undefined,
      }
    : undefined;

  return {
    analyzed: parsed?.analyzed !== false,
    // Always false here — the no-roof case returned early above.
    noRoofDetected: false,
    subject,
    subjectDetail,
    shingleCount,
    squareCoverage,
    shingleType,
    shingleScaleEstimate,
    findings,
    markers,
    detectionAudit: {
      rawCount: candidates.length,
      keptCount: markers.length,
      gridRejected,
    },
    raw,
  };
}

/** Subject enum, defensively. A roof frame without a subject is a roof field;
 *  a non-roof frame without one is unidentifiable — never a guess. */
function parseSubject(raw: unknown, noRoof: boolean): PhotoSubject {
  if (typeof raw === 'string' && (PHOTO_SUBJECTS as readonly string[]).includes(raw)) {
    const s = raw as PhotoSubject;
    // A model saying "roof_field" while also saying no roof contradicts itself;
    // the anti-fabrication verdict wins and the subject becomes unidentifiable.
    if (noRoof && s === 'roof_field') return 'unidentifiable';
    return s;
  }
  return noRoof ? 'unidentifiable' : 'roof_field';
}

function parseCoverage(raw: any): AnalysisResult['squareCoverage'] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const fraction = Number(raw.fraction);
  if (!Number.isFinite(fraction)) return undefined;
  return {
    visible: raw.visible === true,
    fraction: clamp(fraction, 0, 1),
    confidence: clamp(Number(raw.confidence ?? 0), 0, 100),
  };
}

const HIT_EVIDENCE_VALUES: readonly string[] = [
  'mat_fracture',
  'exposed_substrate',
  'granule_loss_only',
  'cosmetic',
  'unclear',
];

/** Evidence class, defensively — anything unrecognised is absent, never functional. */
function parseEvidence(raw: unknown): HitEvidence | undefined {
  return typeof raw === 'string' && HIT_EVIDENCE_VALUES.includes(raw) ? (raw as HitEvidence) : undefined;
}

function parseCollateral(raw: unknown): CollateralFinding[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: CollateralFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const kind = (COLLATERAL_DAMAGE_KINDS as readonly string[]).includes(String((item as any).kind))
      ? ((item as any).kind as CollateralDamageKind)
      : 'other';
    const sevRaw = String((item as any).severity ?? '');
    const severity: Severity =
      sevRaw === 'severe' || sevRaw === 'moderate' || sevRaw === 'minor' ? sevRaw : 'minor';
    out.push({
      kind,
      severity,
      confidence: clamp(Number((item as any).confidence ?? 0), 0, 100),
      note: typeof (item as any).note === 'string' ? (item as any).note.slice(0, 200) : undefined,
    });
  }
  return out;
}

// Defensive parse of the scale-calibration block. Older cached responses
// (and any model reply that omits or malforms it) yield undefined — callers
// must treat the field as optional.
function parseScaleEstimate(raw: any): ShingleScaleEstimate | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const ppi = Number(raw.pixels_per_inch);
  return {
    pixelsPerInch: Number.isFinite(ppi) && ppi > 0 ? ppi : null,
    reference: typeof raw.reference === 'string' ? raw.reference : undefined,
    confidence: clamp(Number(raw.confidence ?? 0), 0, 100),
  };
}

function isDamageCategory(s: unknown): s is DamageCategory {
  return typeof s === 'string' && (DAMAGE_CATEGORIES as readonly string[]).includes(s);
}

function mapMarkerType(s: unknown): DamageCategory | null {
  if (!isDamageCategory(s)) return null;
  return s;
}

function coerceSeverity(s: unknown): Severity {
  const v = String(s ?? '').toLowerCase();
  if (v === 'severe' || v === 'moderate' || v === 'minor' || v === 'none') return v;
  return 'minor';
}

function clamp(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

// Validate and normalize a Gemini box_2d into 0–1 fractions.
// Input: [ymin, xmin, ymax, xmax] on the 0–1000 integer scale.
function bboxFrom(
  raw: unknown,
): { ymin: number; xmin: number; ymax: number; xmax: number } | null {
  if (!Array.isArray(raw) || raw.length !== 4) return null;
  const [ymin, xmin, ymax, xmax] = raw.map((v) => Number(v));
  if (![ymin, xmin, ymax, xmax].every(Number.isFinite)) return null;
  if (ymax <= ymin || xmax <= xmin) return null;
  return {
    ymin: clamp(ymin / 1000, 0, 1),
    xmin: clamp(xmin / 1000, 0, 1),
    ymax: clamp(ymax / 1000, 0, 1),
    xmax: clamp(xmax / 1000, 0, 1),
  };
}

// Render a rectangular detection as a circle overlay: center of the box,
// radius covers the box's longer side so the whole detection is inside.
function bboxToCircle(b: {
  ymin: number;
  xmin: number;
  ymax: number;
  xmax: number;
}): { x: number; y: number; radius: number } {
  const x = (b.xmin + b.xmax) / 2;
  const y = (b.ymin + b.ymax) / 2;
  const radius = Math.max(b.xmax - b.xmin, b.ymax - b.ymin) / 2;
  return { x, y, radius };
}

// Client-side guardrails. Bbox mode (#32) made spatial output much more
// honest, so these are now tuned to let real high-volume detections through
// (a severe-hail roof can legitimately show 20+ markers) while still catching
// the worst grid-hallucination case.
const MARKER_MIN_CONFIDENCE = 45; // matches the prompt's "do not emit below 45"
const MARKER_HARD_CAP = 30;
const DUP_DISTANCE = 0.02; // collapse same-category markers within ±2%

// Grid-detection thresholds (deliberately loose — only catch egregious cases)
const GRID_MIN_BATCH = 10; // don't run the heuristic at all on small batches
const GRID_ALIGN_TOLERANCE = 0.015; // 1.5%, tighter than before
const GRID_MIN_CLUSTER = 6; // need 6+ markers on one line to call it a grid

function sanitizeMarkers(markers: DamageMarker[]): {
  markers: DamageMarker[];
  gridRejected: boolean;
} {
  if (markers.length === 0) return { markers, gridRejected: false };

  // 1. Drop sub-threshold confidence.
  let kept = markers.filter((m) => m.confidence >= MARKER_MIN_CONFIDENCE);
  if (kept.length === 0) return { markers: [], gridRejected: false };

  // 2. Only nuke the batch if it's an egregious grid — small batches and
  //    even moderately-aligned batches now pass through, because real
  //    storm damage can naturally land near horizontal courses.
  if (isGridHallucination(kept)) return { markers: [], gridRejected: true };

  // 3. Collapse near-duplicates (same category, tightly overlapping).
  kept = dedupNearbyMarkers(kept);

  // 4. Hard cap by confidence (severe roofs can legitimately exceed this;
  //    we trust the model up to MARKER_HARD_CAP).
  if (kept.length > MARKER_HARD_CAP) {
    kept = [...kept].sort((a, b) => b.confidence - a.confidence).slice(0, MARKER_HARD_CAP);
  }
  return { markers: kept, gridRejected: false };
}

function isGridHallucination(markers: DamageMarker[]): boolean {
  // Don't penalize small batches — they're more likely to coincidentally
  // line up than to be a pattern hallucination.
  if (markers.length < GRID_MIN_BATCH) return false;

  // Are 6+ markers stacked on a single x column or y row within 1.5%?
  // That's an unambiguous grid, not natural clustering.
  const xs = markers.map((m) => m.x).sort((a, b) => a - b);
  const ys = markers.map((m) => m.y).sort((a, b) => a - b);
  if (countAlignedAxisValues(xs) >= GRID_MIN_CLUSTER) return true;
  if (countAlignedAxisValues(ys) >= GRID_MIN_CLUSTER) return true;

  // Round-number bias check is no longer needed: bbox mode uses 0–1000
  // integer scale and the lazy-decimal failure mode doesn't apply.
  return false;
}

// Find the size of the largest cluster of values within GRID_ALIGN_TOLERANCE
// of each other. A high return value means the markers are aligned on an axis.
function countAlignedAxisValues(sortedValues: number[]): number {
  let best = 0;
  for (let i = 0; i < sortedValues.length; i++) {
    let n = 1;
    for (let j = i + 1; j < sortedValues.length; j++) {
      if (sortedValues[j] - sortedValues[i] <= GRID_ALIGN_TOLERANCE) n++;
      else break;
    }
    if (n > best) best = n;
  }
  return best;
}

function dedupNearbyMarkers(markers: DamageMarker[]): DamageMarker[] {
  const kept: DamageMarker[] = [];
  // Process highest-confidence first so duplicates inherit the strong one.
  const sorted = [...markers].sort((a, b) => b.confidence - a.confidence);
  for (const m of sorted) {
    const tooClose = kept.some(
      (k) =>
        k.category === m.category &&
        Math.hypot(k.x - m.x, k.y - m.y) < DUP_DISTANCE,
    );
    if (!tooClose) kept.push(m);
  }
  return kept;
}
