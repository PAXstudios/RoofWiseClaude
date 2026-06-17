// Gemini 2.5 Flash vision service.
// Spec section "Gemini System Prompt for Damage Detection" + Drift Warning #9.
//
// Real API only — no mock fallback. Throws a clear error when the API key is
// missing so callers can surface a friendly "Not available" state.

import {
  DAMAGE_CATEGORIES,
  type DamageCategory,
  type DamageMarker,
  type InspectionFinding,
  type Severity,
  type ShingleTypeClassification,
  type SlopeOrientation,
} from '../models/types';
import { env, isGeminiConfigured } from '../env';

function endpoint(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini API key not configured. Set EXPO_PUBLIC_GEMINI_API_KEY in .env.local.');
    this.name = 'GeminiNotConfiguredError';
  }
}

export class GeminiAnalysisError extends Error {
  constructor(message: string, public status?: number) {
    super(message);
    this.name = 'GeminiAnalysisError';
  }
}

export type AnalysisResult = {
  analyzed: boolean;
  noRoofDetected: boolean;
  shingleType?: ShingleTypeClassification;
  findings: InspectionFinding[];
  markers: DamageMarker[];
  raw: unknown;
};

const SYSTEM_PROMPT = `You are a forensic roof inspector trained on HAAG (Haag Engineering) standards. You are reviewing a single roof photograph.

Your output drives an overlay drawn on top of the photo. The inspector trusts you to flag every real damage instance — under-detection is just as bad as over-detection. Detect comprehensively, then describe the evidence honestly so the inspector can verify.

Return STRICT JSON only (no markdown wrapper), with this exact schema:

{
  "analyzed": true|false,
  "shingle_type": {
    "type": "3-tab asphalt|architectural asphalt|luxury asphalt|wood shake|wood shingle|metal standing seam|metal shingle|clay tile|concrete tile|slate|synthetic slate|composite|rolled roofing|TPO|EPDM|unknown",
    "confidence": 0-100,
    "note": "<short evidence>"
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
      "note": "<specific pixel feature inside the box — color, shape, size, what makes it damage>"
    }
  ]
}

ALL 13 DAMAGE CATEGORIES ARE IN SCOPE
You are not a hail-only detector. Look for and emit detections for every category visible: hail_hits AND bruising AND granule_loss AND wind_damage AND wind_creasing AND blistering AND cracking AND flashing_damage AND algae_moss AND missing_shingles AND splitting AND lifted_shingles AND structural_sagging. Multiple categories can and often do appear in the same photo.

BOUNDING-BOX COORDINATE SYSTEM (critical — use the integer 0–1000 scale, NOT decimal fractions)
"box_2d" is a 4-integer array [ymin, xmin, ymax, xmax] where each value is on a 0–1000 scale relative to the image (ymin=0 is the top edge, ymax=1000 is the bottom edge; xmin=0 is the left, xmax=1000 is the right). Boxes tightly enclose the damage instance — no padding. A real hail-strike bounding box is typically 20–60 wide and 20–60 tall on the 0–1000 scale; a granule-loss patch can be 80–250 across; a missing shingle can be 100–300 across. ymin < ymax and xmin < xmax always.

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

5. HAIL HITS — each strike is its own box. A hail bruise has: a circular/oval shape, exposed darker substrate (mat) in the center, granule displacement at the edges, often with a faint shiny appearance from compressed asphalt.

FINDINGS (the 13-row summary table)
Include all 13 damage categories in "findings". "detected": true when that category is genuinely present. "count" is the number of distinct instances visible (should roughly match the number of boxes you output for that category).

NOT-A-ROOF DETECTION
If the image is not a roof (grass, sky, indoors, person, vehicle, blank screenshot), set "analyzed": false, return empty "detections", and add ONE finding with label "no_roof_detected".

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
  /** Optional per-user prompt prefix from LocalLearningEngine. */
  userStylePrefix?: string;
};

export async function analyzePhoto(opts: AnalyzeOptions): Promise<AnalysisResult> {
  if (!isGeminiConfigured) throw new GeminiNotConfiguredError();

  const slopeHint = opts.slope ? `\n\nThe photo is of slope orientation: ${opts.slope}.` : '';
  const prefix = opts.userStylePrefix ? `${opts.userStylePrefix}\n\n` : '';

  const body = {
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
            text: 'Analyze this roof photograph. Identify the shingle type, evaluate all 13 damage categories in findings, and detect every distinct damage instance you can see with a tight bounding box on the 0–1000 integer scale (box_2d). Cover ALL damage categories present — hail, wind, granule loss, missing shingles, cracking, blistering, lifted shingles, flashing, algae, structural sagging, splitting, bruising, wind creasing. If real storm damage is present you should output many detections; the inspector trusts you to flag everything they would.',
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

  const url = `${endpoint(env.GEMINI_MODEL)}?key=${env.GEMINI_API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new GeminiAnalysisError(`Gemini ${res.status}: ${text.slice(0, 500)}`, res.status);
  }

  const json = await res.json();
  const text =
    json?.candidates?.[0]?.content?.parts?.[0]?.text ??
    json?.candidates?.[0]?.content?.parts?.[0]?.inline_text ??
    '';

  let parsed: any;
  try {
    parsed = typeof text === 'string' ? JSON.parse(text) : text;
  } catch {
    throw new GeminiAnalysisError('Gemini returned non-JSON output.');
  }

  return normalize(parsed, json);
}

function normalize(parsed: any, raw: unknown): AnalysisResult {
  const noRoofDetected =
    parsed?.analyzed === false ||
    !!parsed?.findings?.find?.((f: any) => f?.label === 'no_roof_detected');

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
        confidence: clamp(Number(d.confidence ?? 0), 0, 100),
        note: typeof d.note === 'string' ? d.note : undefined,
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

  const markers = sanitizeMarkers(detections.length > 0 ? detections : legacyMarkers);

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
    noRoofDetected,
    shingleType,
    findings,
    markers,
    raw,
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

function sanitizeMarkers(markers: DamageMarker[]): DamageMarker[] {
  if (markers.length === 0) return markers;

  // 1. Drop sub-threshold confidence.
  let kept = markers.filter((m) => m.confidence >= MARKER_MIN_CONFIDENCE);
  if (kept.length === 0) return [];

  // 2. Only nuke the batch if it's an egregious grid — small batches and
  //    even moderately-aligned batches now pass through, because real
  //    storm damage can naturally land near horizontal courses.
  if (isGridHallucination(kept)) return [];

  // 3. Collapse near-duplicates (same category, tightly overlapping).
  kept = dedupNearbyMarkers(kept);

  // 4. Hard cap by confidence (severe roofs can legitimately exceed this;
  //    we trust the model up to MARKER_HARD_CAP).
  if (kept.length > MARKER_HARD_CAP) {
    kept = [...kept].sort((a, b) => b.confidence - a.confidence).slice(0, MARKER_HARD_CAP);
  }
  return kept;
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
