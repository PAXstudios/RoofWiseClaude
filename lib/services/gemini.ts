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

const SYSTEM_PROMPT = `You are a forensic roof inspector trained on HAAG (Haag Engineering) standards.

Analyze the attached roof photograph. Identify the roof covering material and any visible damage. Be conservative — only flag damage you can actually see in the pixels. Empty arrays are correct when nothing is visible.

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
  "damage_markers": [
    {
      "type": "hail_hits|bruising|granule_loss|wind_damage|wind_creasing|blistering|cracking|flashing_damage|algae_moss|missing_shingles|splitting|lifted_shingles|structural_sagging",
      "x": 0.0-1.0,
      "y": 0.0-1.0,
      "radius": 0.0-1.0,
      "severity": "minor|moderate|severe",
      "confidence": 0-100,
      "note": "<short pixel-level observation>"
    }
  ]
}

Coordinate system: x and y are normalized fractions of the image dimensions where (0,0) is top-left and (1,1) is bottom-right. Radius is normalized to min(width, height).

Include all 13 damage categories in "findings" (set "detected": false for categories you don't see).

Mark each visible damage instance individually in "damage_markers". If the image is NOT a roof (grass, sky, indoors, person, vehicle), set "analyzed": false, return empty "damage_markers", and add a finding with label "no_roof_detected".

CONFIDENCE SCORING:
- 90-100: damage characteristics are unmistakable and multiple indicators present
- 70-89: clear damage with at least one definitive indicator
- 50-69: probable damage but some ambiguity (lighting, angle, partial view)
- 30-49: possible damage but more evidence needed
- Below 30: do not include this marker — too uncertain

When in doubt, mark fewer. False positives waste inspector time more than missing borderline cases.`;

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
          { text: 'Analyze this photo and return the JSON schema.' },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
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

  const markers: DamageMarker[] = (parsed?.damage_markers ?? [])
    .map((m: any, i: number): DamageMarker | null => {
      const cat = mapMarkerType(m?.type);
      if (!cat) return null;
      return {
        id: `mk_${Date.now()}_${i}`,
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
