// Photo annotations — what a roofer draws ON a photo: an arrow at the hit, a
// circle round the crease, "soft here" next to the bruise. Kept as DATA, never
// baked into the pixels: the photograph in the packet stays unaltered (the
// report certifies it is), the drawing rides on top as a separate layer, and
// every surface that shows the photo — the job page, the review strip, the
// report PDF — draws the same items from the same record.
//
// Every coordinate is NORMALISED to the image (0–1 of its width / height), so
// one record renders correctly at any size: a 96pt thumbnail, the full-screen
// annotator, or the 700px downscale in the PDF. Stroke widths and text sizes
// are fractions of the image's SHORTER side for the same reason.
//
// Stored by durable photo attachment identity. URI remains file provenance;
// it cannot distinguish duplicate attachments or a removed/reused image.

export type AnnotationKind = 'pen' | 'arrow' | 'circle' | 'rect' | 'text';

/**
 * Four colours, named by the token they resolve to (theme/tokens.ts):
 * danger (red) for damage, warn (amber) for "look here", brand (royal) for
 * neutral callouts, white for dark roofs. Resolved in annotationSvg.ts —
 * the model never carries a hex.
 */
export type AnnotationColor = 'danger' | 'warn' | 'brand' | 'white';

export const ANNOTATION_COLORS: readonly AnnotationColor[] = ['danger', 'warn', 'brand', 'white'];

export const ANNOTATION_COLOR_LABELS: Record<AnnotationColor, string> = {
  danger: 'Red',
  warn: 'Amber',
  brand: 'Blue',
  white: 'White',
};

/** Normalised point: 0–1 of the image's width and height. */
export type NormPoint = { x: number; y: number };

/** Normalised rectangle: origin + size, all 0–1, `w`/`h` ≥ 0. */
export type NormRect = { x: number; y: number; w: number; h: number };

/**
 * Stroke width as a fraction of the image's shorter side. Three chips, sized
 * so "thin" still reads on a 96pt thumbnail and "thick" is a highlighter on
 * a full-screen photo.
 */
export const ANNOTATION_WIDTHS = {
  thin: 0.006,
  medium: 0.011,
  thick: 0.02,
} as const;

export type AnnotationWidthName = keyof typeof ANNOTATION_WIDTHS;

export const ANNOTATION_WIDTH_ORDER: readonly AnnotationWidthName[] = ['thin', 'medium', 'thick'];

/** Text size as a fraction of the image's shorter side. */
export const ANNOTATION_TEXT_SIZES = {
  small: 0.04,
  medium: 0.055,
  large: 0.075,
} as const;

export type AnnotationTextSizeName = keyof typeof ANNOTATION_TEXT_SIZES;

export const ANNOTATION_TEXT_SIZE_ORDER: readonly AnnotationTextSizeName[] = ['small', 'medium', 'large'];

/** Longest label the text tool accepts — one short phrase, not a paragraph. */
export const ANNOTATION_TEXT_MAX = 40;

/**
 * A pen stroke is thinned to one point per ~4 rendered px and capped here so
 * a long scribble on Hermes stays one cheap path (see app/annotate.tsx).
 */
export const PEN_MAX_POINTS = 400;

export type Annotation = {
  id: string;
  kind: AnnotationKind;
  color: AnnotationColor;
  /** Fraction of the image's shorter side — one of ANNOTATION_WIDTHS. */
  width: number;
  /** `pen`: the stroke, ≥ 1 point. */
  points?: NormPoint[];
  /** `arrow`: tail → head. */
  from?: NormPoint;
  to?: NormPoint;
  /** `circle` (ellipse inscribed) and `rect`. */
  rect?: NormRect;
  /** `text`: the label … */
  text?: string;
  /** … centred on this point … */
  at?: NormPoint;
  /** … at this size (fraction of the shorter side — one of ANNOTATION_TEXT_SIZES). */
  size?: number;
  /** ISO timestamp. */
  createdAt: string;
};

/** Everything drawn on one photo. */
export type PhotoAnnotations = {
  uri: string;
  /** Pixel size of the image the items were normalised against (0 when unknown). */
  imageW: number;
  imageH: number;
  items: Annotation[];
  /** ISO timestamp of the last save. */
  updatedAt: string;
};

let counter = 0;

export function newAnnotationId(): string {
  return `an_${Date.now()}_${counter++}`;
}

/** Clamp to the image. */
export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Two corners (any order) → a normalised rect with non-negative size, clamped to the image. */
export function rectFromCorners(a: NormPoint, b: NormPoint): NormRect {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 };
}

/** Runtime guard for a persisted or hand-built item — keeps a bad record from crashing a render. */
export function isAnnotation(v: unknown): v is Annotation {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  if (typeof a.id !== 'string' || typeof a.createdAt !== 'string') return false;
  if (!['pen', 'arrow', 'circle', 'rect', 'text'].includes(String(a.kind))) return false;
  if (!ANNOTATION_COLORS.includes(a.color as AnnotationColor)) return false;
  if (typeof a.width !== 'number' || !Number.isFinite(a.width)) return false;
  switch (a.kind) {
    case 'pen':
      return Array.isArray(a.points) && a.points.length > 0;
    case 'arrow':
      return isPoint(a.from) && isPoint(a.to);
    case 'circle':
    case 'rect':
      return isRect(a.rect);
    case 'text':
      return typeof a.text === 'string' && isPoint(a.at);
    default:
      return false;
  }
}

function isPoint(v: unknown): v is NormPoint {
  return !!v && typeof v === 'object' && Number.isFinite((v as NormPoint).x) && Number.isFinite((v as NormPoint).y);
}

function isRect(v: unknown): v is NormRect {
  if (!v || typeof v !== 'object') return false;
  const r = v as NormRect;
  return [r.x, r.y, r.w, r.h].every((n) => Number.isFinite(n));
}
