// Photo annotations → geometry → SVG. Pure: no I/O, no React.
//
// One function turns normalised annotation items into pixel-space SHAPES for a
// given rendered rectangle (`annotationShapes`), and everything that draws an
// annotated photo consumes those shapes:
//   • components/photo/AnnotationLayer.tsx maps them to react-native-svg
//     elements (the annotator, thumbnails, the job page, the photo report);
//   • `annotationsToSvg` serialises them to an inline <svg> string for the
//     HTML that expo-print turns into the HAAG report PDF.
// So the arrow a roofer draws on the roof is the same arrow, pixel for pixel
// (scaled), in the packet the adjuster reads. No rasterising, no native deps.
//
// Colours resolve HERE from theme/tokens.ts (Drift #11) — the model only
// carries the token name.

import { colors } from '@/theme/tokens';
import type { Annotation, AnnotationColor, NormPoint } from '../models/annotations';
import type { DamageMarker, Severity } from '../models/types';

export const ANNOTATION_COLOR_HEX: Record<AnnotationColor, string> = {
  danger: colors.danger,
  warn: colors.warn,
  brand: colors.brand,
  white: colors.textInverse,
};

/** Ink that reads on a label pill of each colour (contrast-checked ≥ 4.5:1). */
const LABEL_INK: Record<AnnotationColor, string> = {
  danger: colors.textInverse,
  warn: colors.text,
  brand: colors.textInverse,
  white: colors.text,
};

/** Existing damage markers, drawn read-only underneath — same tints as DamageMarkerLayer. */
const MARKER_TINT: Record<Severity, string> = {
  none: colors.slate,
  minor: colors.info,
  moderate: colors.warn,
  severe: colors.danger,
};

/** Where the image lands inside its box, in the box's pixel space. */
export type PxRect = { left: number; top: number; width: number; height: number };

export type Shape =
  | { kind: 'path'; d: string; stroke: string; width: number }
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number; stroke: string; width: number }
  | { kind: 'polygon'; points: string; fill: string }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number; stroke: string; width: number; fill?: string; dashed?: boolean }
  | { kind: 'rect'; x: number; y: number; w: number; h: number; rx: number; stroke: string; width: number; fill?: string; dashed?: boolean }
  | {
      kind: 'text';
      x: number;
      y: number;
      text: string;
      fontSize: number;
      fill: string;
      bg: { x: number; y: number; w: number; h: number; rx: number; fill: string };
    };

/** Smallest stroke that still reads on a thumbnail. */
const MIN_STROKE_PX = 1.5;
/** Smallest label that still reads (a 96pt thumbnail gets one line of it). */
const MIN_FONT_PX = 8;

/**
 * Where an `imageW × imageH` image sits inside a `boxW × boxH` container.
 * `contain` letter-boxes (the annotator, the photo report); `cover` fills and
 * crops (thumbnails, the job page tiles, the PDF's 4:3 figures) — the rect
 * then overflows the box and the caller clips.
 */
export function fitRect(
  imageW: number,
  imageH: number,
  boxW: number,
  boxH: number,
  mode: 'contain' | 'cover' = 'contain',
): PxRect {
  if (!(imageW > 0) || !(imageH > 0) || !(boxW > 0) || !(boxH > 0)) {
    return { left: 0, top: 0, width: boxW > 0 ? boxW : 0, height: boxH > 0 ? boxH : 0 };
  }
  const sx = boxW / imageW;
  const sy = boxH / imageH;
  const s = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  const width = imageW * s;
  const height = imageH * s;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

/** Pixel stroke width for a normalised width inside `rect`. */
export function strokePx(width: number, rect: PxRect): number {
  const base = Math.min(rect.width, rect.height);
  return Math.max(MIN_STROKE_PX, width * base);
}

/** Pixel font size for a normalised text size inside `rect`. */
export function fontPx(size: number, rect: PxRect): number {
  const base = Math.min(rect.width, rect.height);
  return Math.max(MIN_FONT_PX, size * base);
}

/** Normalised → rect pixels. */
export function toPx(p: NormPoint, rect: PxRect): { x: number; y: number } {
  return { x: rect.left + p.x * rect.width, y: rect.top + p.y * rect.height };
}

/** Rect pixels → normalised (0–1, clamped). Inverse of `toPx`. */
export function toNorm(x: number, y: number, rect: PxRect): NormPoint {
  if (!(rect.width > 0) || !(rect.height > 0)) return { x: 0, y: 0 };
  const nx = (x - rect.left) / rect.width;
  const ny = (y - rect.top) / rect.height;
  return { x: nx < 0 ? 0 : nx > 1 ? 1 : nx, y: ny < 0 ? 0 : ny > 1 ? 1 : ny };
}

const r1 = (n: number): number => Math.round(n * 10) / 10;

/** Approximate rendered width of a label — SVG has no measureText we can rely on across renderers. */
function approxTextWidth(text: string, fontSize: number): number {
  // Bold system sans averages ~0.58em per glyph; wide glyphs are rare in a roof label.
  return text.length * fontSize * 0.58;
}

/** One annotation → its shapes in `rect` pixel space. */
export function annotationToShapes(a: Annotation, rect: PxRect): Shape[] {
  const stroke = ANNOTATION_COLOR_HEX[a.color] ?? colors.danger;
  const sw = strokePx(a.width, rect);

  switch (a.kind) {
    case 'pen': {
      const pts = a.points ?? [];
      if (pts.length === 0) return [];
      const first = toPx(pts[0], rect);
      if (pts.length === 1) {
        // A dot: a zero-length line with round caps draws nothing on some
        // renderers, so give it a hair of length.
        return [{ kind: 'line', x1: r1(first.x), y1: r1(first.y), x2: r1(first.x + 0.1), y2: r1(first.y), stroke, width: sw }];
      }
      let d = `M${r1(first.x)} ${r1(first.y)}`;
      for (let i = 1; i < pts.length; i++) {
        const p = toPx(pts[i], rect);
        d += ` L${r1(p.x)} ${r1(p.y)}`;
      }
      return [{ kind: 'path', d, stroke, width: sw }];
    }

    case 'arrow': {
      if (!a.from || !a.to) return [];
      const p1 = toPx(a.from, rect);
      const p2 = toPx(a.to, rect);
      const dx = p2.x - p1.x;
      const dy = p2.y - p1.y;
      const len = Math.hypot(dx, dy);
      if (len < 1) {
        return [{ kind: 'line', x1: r1(p1.x), y1: r1(p1.y), x2: r1(p1.x + 0.1), y2: r1(p1.y), stroke, width: sw }];
      }
      const ux = dx / len;
      const uy = dy / len;
      // Head scales with the stroke but never shrinks below a readable size.
      const head = Math.min(len, Math.max(10, sw * 3.2));
      const bx = p2.x - ux * head;
      const by = p2.y - uy * head;
      const half = head * 0.5;
      const lx = bx + -uy * half;
      const ly = by + ux * half;
      const rx = bx - -uy * half;
      const ry = by - ux * half;
      // The shaft stops a third of the way into the head so it never pokes out.
      const sx2 = bx + ux * head * 0.35;
      const sy2 = by + uy * head * 0.35;
      return [
        { kind: 'line', x1: r1(p1.x), y1: r1(p1.y), x2: r1(sx2), y2: r1(sy2), stroke, width: sw },
        { kind: 'polygon', points: `${r1(p2.x)},${r1(p2.y)} ${r1(lx)},${r1(ly)} ${r1(rx)},${r1(ry)}`, fill: stroke },
      ];
    }

    case 'circle': {
      if (!a.rect) return [];
      const x = rect.left + a.rect.x * rect.width;
      const y = rect.top + a.rect.y * rect.height;
      const w = a.rect.w * rect.width;
      const h = a.rect.h * rect.height;
      return [{ kind: 'ellipse', cx: r1(x + w / 2), cy: r1(y + h / 2), rx: r1(Math.max(sw, w / 2)), ry: r1(Math.max(sw, h / 2)), stroke, width: sw }];
    }

    case 'rect': {
      if (!a.rect) return [];
      const x = rect.left + a.rect.x * rect.width;
      const y = rect.top + a.rect.y * rect.height;
      const w = a.rect.w * rect.width;
      const h = a.rect.h * rect.height;
      return [{ kind: 'rect', x: r1(x), y: r1(y), w: r1(Math.max(sw, w)), h: r1(Math.max(sw, h)), rx: r1(sw), stroke, width: sw }];
    }

    case 'text': {
      const text = (a.text ?? '').trim();
      if (!text || !a.at) return [];
      const fontSize = fontPx(a.size ?? 0.055, rect);
      const pad = fontSize * 0.45;
      const w = approxTextWidth(text, fontSize) + pad * 2;
      const h = fontSize * 1.45;
      const c = toPx(a.at, rect);
      // Keep the pill on the photo — a label placed at the very edge would
      // otherwise half-vanish in every thumbnail.
      const minX = rect.left;
      const maxX = rect.left + rect.width - w;
      const minY = rect.top;
      const maxY = rect.top + rect.height - h;
      const bx = Math.max(minX, Math.min(maxX, c.x - w / 2));
      const by = Math.max(minY, Math.min(maxY, c.y - h / 2));
      return [
        {
          kind: 'text',
          x: r1(bx + w / 2),
          y: r1(by + h / 2 + fontSize * 0.35),
          text,
          fontSize: r1(fontSize),
          fill: LABEL_INK[a.color] ?? colors.textInverse,
          bg: { x: r1(bx), y: r1(by), w: r1(w), h: r1(h), rx: r1(h / 2), fill: stroke },
        },
      ];
    }

    default:
      return [];
  }
}

/** Every annotation → shapes, in draw order. */
export function annotationShapes(items: readonly Annotation[], rect: PxRect): Shape[] {
  const out: Shape[] = [];
  for (const a of items) out.push(...annotationToShapes(a, rect));
  return out;
}

/**
 * Existing AI / inspector damage markers, as dashed outlines with their
 * confidence — drawn UNDER the annotations so the roofer draws around what
 * the model found. Same minimum sizes as DamageMarkerLayer so a tiny bruise
 * box still shows on a thumbnail.
 */
export function markerShapes(markers: readonly DamageMarker[], rect: PxRect): Shape[] {
  const out: Shape[] = [];
  const sw = Math.max(MIN_STROKE_PX, Math.min(rect.width, rect.height) * 0.005);
  const fontSize = Math.max(MIN_FONT_PX, Math.min(rect.width, rect.height) * 0.03);
  for (const m of markers) {
    const tint = MARKER_TINT[m.severity] ?? colors.slate;
    const fill = `${tint}33`;
    let labelX: number;
    let labelY: number;
    if (m.box) {
      const MIN_DRAW = 24;
      let left = rect.left + m.box.xmin * rect.width;
      let top = rect.top + m.box.ymin * rect.height;
      let w = (m.box.xmax - m.box.xmin) * rect.width;
      let h = (m.box.ymax - m.box.ymin) * rect.height;
      if (w < MIN_DRAW) { left -= (MIN_DRAW - w) / 2; w = MIN_DRAW; }
      if (h < MIN_DRAW) { top -= (MIN_DRAW - h) / 2; h = MIN_DRAW; }
      out.push({ kind: 'rect', x: r1(left), y: r1(top), w: r1(w), h: r1(h), rx: 4, stroke: tint, width: sw, fill, dashed: true });
      labelX = left + w / 2;
      labelY = top;
    } else {
      const cx = rect.left + m.x * rect.width;
      const cy = rect.top + m.y * rect.height;
      const r = Math.max(18, m.radius * Math.min(rect.width, rect.height));
      out.push({ kind: 'ellipse', cx: r1(cx), cy: r1(cy), rx: r1(r), ry: r1(r), stroke: tint, width: sw, fill, dashed: true });
      labelX = cx;
      labelY = cy - r;
    }
    const label = String(Math.round(m.confidence));
    const w = approxTextWidth(label, fontSize) + fontSize * 0.8;
    const h = fontSize * 1.4;
    out.push({
      kind: 'text',
      x: r1(labelX),
      y: r1(labelY + fontSize * 0.35),
      text: label,
      fontSize: r1(fontSize),
      fill: colors.textInverse,
      bg: { x: r1(labelX - w / 2), y: r1(labelY - h / 2), w: r1(w), h: r1(h), rx: r1(h / 2), fill: tint },
    });
  }
  return out;
}

// -----------------------------------------------------------------------------
// SVG string — for the report HTML (expo-print) and any other HTML surface.
// -----------------------------------------------------------------------------

export function escXml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const FONT_FAMILY = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

/** One shape → one SVG element string. */
export function shapeToSvg(s: Shape): string {
  const round = 'stroke-linecap="round" stroke-linejoin="round"';
  switch (s.kind) {
    case 'path':
      return `<path d="${s.d}" fill="none" stroke="${s.stroke}" stroke-width="${r1(s.width)}" ${round}/>`;
    case 'line':
      return `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="${s.stroke}" stroke-width="${r1(s.width)}" ${round}/>`;
    case 'polygon':
      return `<polygon points="${s.points}" fill="${s.fill}" stroke="${s.fill}" stroke-width="1" ${round}/>`;
    case 'ellipse':
      return `<ellipse cx="${s.cx}" cy="${s.cy}" rx="${s.rx}" ry="${s.ry}" fill="${s.fill ?? 'none'}" stroke="${s.stroke}" stroke-width="${r1(s.width)}"${s.dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
    case 'rect':
      return `<rect x="${s.x}" y="${s.y}" width="${s.w}" height="${s.h}" rx="${s.rx}" fill="${s.fill ?? 'none'}" stroke="${s.stroke}" stroke-width="${r1(s.width)}"${s.dashed ? ' stroke-dasharray="6 4"' : ''}/>`;
    case 'text':
      return (
        `<rect x="${s.bg.x}" y="${s.bg.y}" width="${s.bg.w}" height="${s.bg.h}" rx="${s.bg.rx}" fill="${s.bg.fill}"/>` +
        `<text x="${s.x}" y="${s.y}" text-anchor="middle" font-family="${FONT_FAMILY}" font-size="${s.fontSize}" font-weight="700" fill="${s.fill}">${escXml(s.text)}</text>`
      );
  }
}

export type SvgOptions = {
  /**
   * The part of the `w × h` image that is visible — for an image drawn with
   * object-fit: cover (see `coverViewBox`). Defaults to the whole image.
   */
  viewBox?: { x: number; y: number; w: number; h: number };
  /** Existing damage markers to draw underneath. Off by default in print. */
  markers?: readonly DamageMarker[];
  /** Extra attributes on the <svg> (class, style…). */
  attrs?: string;
};

/**
 * Inline SVG for `items` drawn on a `w × h` image. Sized 100% × 100% with
 * `preserveAspectRatio="none"`, so laid absolutely over an <img> of the same
 * aspect it lines up exactly; pass `viewBox` when the <img> is cover-cropped.
 */
export function annotationsToSvg(
  items: readonly Annotation[],
  w: number,
  h: number,
  opts: SvgOptions = {},
): string {
  const rect: PxRect = { left: 0, top: 0, width: w, height: h };
  const vb = opts.viewBox ?? { x: 0, y: 0, w, h };
  const body =
    (opts.markers?.length ? markerShapes(opts.markers, rect).map(shapeToSvg).join('') : '') +
    annotationShapes(items, rect).map(shapeToSvg).join('');
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r1(vb.x)} ${r1(vb.y)} ${r1(vb.w)} ${r1(vb.h)}" ` +
    `width="100%" height="100%" preserveAspectRatio="none"${opts.attrs ? ` ${opts.attrs}` : ''}>${body}</svg>`
  );
}

/**
 * The visible region of a `w × h` image drawn with `object-fit: cover` into a
 * box of `aspect` (width / height) — the centre crop the browser shows.
 */
export function coverViewBox(w: number, h: number, aspect: number): { x: number; y: number; w: number; h: number } {
  if (!(w > 0) || !(h > 0) || !(aspect > 0)) return { x: 0, y: 0, w, h };
  const imageAspect = w / h;
  if (imageAspect > aspect) {
    const vw = h * aspect;
    return { x: (w - vw) / 2, y: 0, w: vw, h };
  }
  const vh = w / aspect;
  return { x: 0, y: (h - vh) / 2, w, h: vh };
}

export type AnnotatedImageHtmlOptions = {
  /** Image data URI (or URL). */
  src: string;
  /** Pixel size of that image. */
  width: number;
  height: number;
  items: readonly Annotation[];
  /** The <img>'s CSS aspect ratio when it is cover-cropped (e.g. 4 / 3). Omit for a natural-size image. */
  aspect?: number;
  /** class="" on the <img>. */
  imgClass?: string;
  /** Extra inline style on the wrapper. */
  wrapStyle?: string;
  alt?: string;
};

/**
 * `<div style="position:relative"><img …/><svg …/></div>` — the photo with its
 * drawing laid over it, ready for a report template. With no items it is
 * just the <img>, so an un-annotated photo prints exactly as before.
 */
export function annotatedImageHtml(o: AnnotatedImageHtmlOptions): string {
  const cls = o.imgClass ? ` class="${escXml(o.imgClass)}"` : '';
  const alt = o.alt ? ` alt="${escXml(o.alt)}"` : '';
  const img = `<img${cls} src="${o.src}"${alt} />`;
  if (o.items.length === 0) return img;
  const viewBox = o.aspect ? coverViewBox(o.width, o.height, o.aspect) : undefined;
  const svg = annotationsToSvg(o.items, o.width, o.height, {
    viewBox,
    attrs: 'style="position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;display:block"',
  });
  return `<div style="position:relative;line-height:0;${o.wrapStyle ?? ''}">${img}${svg}</div>`;
}

/** "3 drawings · 1 arrow, 1 circle, 1 label" — for captions and spoken labels. */
export function describeAnnotations(items: readonly Annotation[]): string {
  if (items.length === 0) return 'No annotations';
  const counts: Record<string, number> = {};
  for (const a of items) counts[a.kind] = (counts[a.kind] ?? 0) + 1;
  const names: Record<string, [string, string]> = {
    pen: ['stroke', 'strokes'],
    arrow: ['arrow', 'arrows'],
    circle: ['circle', 'circles'],
    rect: ['box', 'boxes'],
    text: ['label', 'labels'],
  };
  const parts = (['arrow', 'circle', 'rect', 'text', 'pen'] as const)
    .filter((k) => counts[k])
    .map((k) => `${counts[k]} ${names[k][counts[k] === 1 ? 0 : 1]}`);
  const n = items.length;
  return `${n} annotation${n === 1 ? '' : 's'} · ${parts.join(', ')}`;
}
