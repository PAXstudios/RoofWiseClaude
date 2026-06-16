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

Your output drives an overlay drawn on top of the photo. Each detection becomes a marker the inspector sees. WRONG detections waste an inspector's day; missing borderline ones does not. Bias hard toward "no detection" when uncertain.

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
      "note": "<specific pixel feature you see inside the box — color, shape, size, what makes it damage>"
    }
  ]
}

BOUNDING-BOX COORDINATE SYSTEM (critical — use the integer 0–1000 scale, NOT decimal fractions)
"box_2d" is a 4-integer array [ymin, xmin, ymax, xmax] where each value is on a 0–1000 scale relative to the image (ymin=0 is the top edge, ymax=1000 is the bottom edge; xmin=0 is the left, xmax=1000 is the right). Boxes tightly enclose the damage instance — no padding. A real hail-strike bounding box is typically 20–60 wide and 20–60 tall on the 0–1000 scale. ymin < ymax and xmin < xmax always.

DETECTION RULES (the most common failure mode is fabricating spatial patterns instead of finding real damage)

1. Each detection MUST point at a single, named, visible feature inside the box. Your "note" must answer: "what color/shape/texture inside this box tells me this is damage?" If you cannot answer that with a unique observation, do NOT output the detection.

2. ZERO DETECTIONS IS A VALID AND COMMON ANSWER. A weathered roof with no actual storm damage gets 0 detections. A roof with one impact gets 1 detection. Most real photos have 0–3 detections, not 10+. If you produce more than 6 detections, you are almost certainly hallucinating — stop and reconsider.

3. NEVER place detections in a regular pattern. Forbidden behaviors:
   - Evenly-spaced columns or rows (box centers progressing by a fixed step)
   - Aligning boxes to shingle edges, shingle tabs, or shingle joints (the dark horizontal lines between courses are NOT damage)
   - Stacking 2+ boxes vertically with the same x-center
   - Stacking 2+ boxes horizontally with the same y-center
   Real hail impacts are randomly distributed across the slope. If your output looks like a grid, you're pattern-matching the shingle layout instead of finding damage.

4. SHINGLE FEATURES ARE NOT DAMAGE. Architectural asphalt shingles have intentional dark shadow bands, dimensional cutouts, and color variation between tabs. These are design elements, not impacts, bruising, or missing shingles. Do not box them.

5. GRANULE LOSS exception: if you see a TRUE granule-loss patch (asphalt substrate visible as a darker irregular blotch, not a manufacturer shadow line), output ONE box covering the whole patch. Do not output multiple boxes inside one patch.

FINDINGS (the 13-row summary table)
Include all 13 damage categories in "findings". "detected": true only if you have HIGH confidence that category is genuinely present. Count is the number of distinct instances visible — not the number of detections you generated.

NOT-A-ROOF DETECTION
If the image is not a roof (grass, sky, indoors, person, vehicle, blank screenshot), set "analyzed": false, return empty "detections", and add ONE finding with label "no_roof_detected".

CONFIDENCE RUBRIC (apply per-detection)
- 90–100: unique impact/bruise unmistakable inside the box with substrate or fracture pattern visible. Used rarely.
- 70–89: clear damage feature inside the box, single definitive indicator.
- 50–69: probable damage but lighting/angle/partial view introduces ambiguity.
- Below 50: DO NOT EMIT A DETECTION.

When in doubt, return fewer detections (or none). Inspector trust is the product.`;

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
            text: 'Analyze this roof photograph. Identify the shingle type, evaluate all 13 damage categories in findings, and detect each individual damage instance with a tight bounding box on the 0–1000 integer scale (box_2d). Return zero detections if no damage is visible — that is the correct answer for an undamaged or clean-weathered roof.',
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

// Hard backstop for the most common Gemini failure: hallucinating a regular
// grid of markers stair-stepping down shingle joints instead of finding
// actual damage. Even when the prompt forbids this, the model still does it
// sometimes — so we detect grid patterns post-hoc and reject the whole batch
// rather than trust suspicious spatial output.
const MARKER_MIN_CONFIDENCE = 60;
const MARKER_HARD_CAP = 6;
const ALIGN_TOLERANCE = 0.03; // markers within ±3% of an axis count as aligned
const DUP_DISTANCE = 0.04; // markers within ±4% of each other collapse to one

function sanitizeMarkers(markers: DamageMarker[]): DamageMarker[] {
  if (markers.length === 0) return markers;

  // 1. Drop low confidence (the prompt asks the model not to emit these, but
  //    enforce it client-side so a rogue value doesn't paint the overlay).
  let kept = markers.filter((m) => m.confidence >= MARKER_MIN_CONFIDENCE);
  if (kept.length === 0) return [];

  // 2. Reject the entire response if it looks like a grid hallucination.
  if (isGridHallucination(kept)) return [];

  // 3. Collapse near-duplicates (same category + close in space).
  kept = dedupNearbyMarkers(kept);

  // 4. Keep at most MARKER_HARD_CAP, ranked by confidence.
  if (kept.length > MARKER_HARD_CAP) {
    kept = [...kept].sort((a, b) => b.confidence - a.confidence).slice(0, MARKER_HARD_CAP);
  }
  return kept;
}

function isGridHallucination(markers: DamageMarker[]): boolean {
  if (markers.length < 4) return false; // need a sample to detect a pattern

  // Heuristic A: are many markers stacked on a small set of x columns or
  // y rows? Real damage is randomly distributed; grid hallucinations cluster
  // onto 2–3 vertical lines tracing shingle joints.
  const xs = markers.map((m) => m.x).sort((a, b) => a - b);
  const ys = markers.map((m) => m.y).sort((a, b) => a - b);
  const xClusterCount = countAlignedAxisValues(xs);
  const yClusterCount = countAlignedAxisValues(ys);
  if (xClusterCount >= 3 || yClusterCount >= 3) return true;

  // Heuristic B: do many coordinates land on round decimal values (.0, .1,
  // .2, .5 — the model's lazy default when it's not actually looking)?
  const roundCount = markers.reduce((n, m) => {
    const rx = Math.abs((m.x * 10) - Math.round(m.x * 10)) < 0.01;
    const ry = Math.abs((m.y * 10) - Math.round(m.y * 10)) < 0.01;
    return n + (rx && ry ? 1 : 0);
  }, 0);
  if (roundCount >= Math.ceil(markers.length * 0.5)) return true;

  return false;
}

// Count how many markers share an axis value (within tolerance) with at
// least 2 others — returns the size of the largest such cluster.
function countAlignedAxisValues(sortedValues: number[]): number {
  let best = 0;
  for (let i = 0; i < sortedValues.length; i++) {
    let n = 1;
    for (let j = i + 1; j < sortedValues.length; j++) {
      if (sortedValues[j] - sortedValues[i] <= ALIGN_TOLERANCE) n++;
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
