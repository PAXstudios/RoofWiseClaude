// The drawing on a photo, as react-native-svg — one <Svg> the size of the
// photo's container, with the image's letterbox / crop rect passed in so the
// normalised items land on the pixels they were drawn over. Pure rendering:
// the geometry comes from lib/services/annotationSvg.ts, the same code that
// writes the report's inline SVG, so the app and the PDF can never disagree.
//
// `pointerEvents="none"` — the layer never takes a touch. The annotator draws
// through it; every other surface taps the photo underneath.

import { useMemo } from 'react';
import { StyleSheet, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Ellipse, G, Line, Path, Polygon, Rect, Text as SvgText } from 'react-native-svg';
import type { Annotation } from '@/lib/models/annotations';
import type { DamageMarker } from '@/lib/models/types';
import { annotationShapes, annotationToShapes, markerShapes, type PxRect, type Shape } from '@/lib/services/annotationSvg';

type Props = {
  /** Container size (pt). The <Svg> fills it. */
  width: number;
  height: number;
  /** Where the image sits inside the container (from `fitRect`). */
  rect: PxRect;
  items: readonly Annotation[];
  /** Existing damage markers, drawn underneath as dashed outlines. */
  markers?: readonly DamageMarker[];
  /** The in-progress item while the roofer is still drawing it. */
  draft?: Annotation | null;
  style?: StyleProp<ViewStyle>;
};

function shapeElement(s: Shape, key: string) {
  switch (s.kind) {
    case 'path':
      return <Path key={key} d={s.d} fill="none" stroke={s.stroke} strokeWidth={s.width} strokeLinecap="round" strokeLinejoin="round" />;
    case 'line':
      return <Line key={key} x1={s.x1} y1={s.y1} x2={s.x2} y2={s.y2} stroke={s.stroke} strokeWidth={s.width} strokeLinecap="round" />;
    case 'polygon':
      return <Polygon key={key} points={s.points} fill={s.fill} stroke={s.fill} strokeWidth={1} strokeLinejoin="round" />;
    case 'ellipse':
      return (
        <Ellipse
          key={key}
          cx={s.cx}
          cy={s.cy}
          rx={s.rx}
          ry={s.ry}
          fill={s.fill ?? 'none'}
          stroke={s.stroke}
          strokeWidth={s.width}
          strokeDasharray={s.dashed ? [6, 4] : undefined}
        />
      );
    case 'rect':
      return (
        <Rect
          key={key}
          x={s.x}
          y={s.y}
          width={s.w}
          height={s.h}
          rx={s.rx}
          fill={s.fill ?? 'none'}
          stroke={s.stroke}
          strokeWidth={s.width}
          strokeDasharray={s.dashed ? [6, 4] : undefined}
        />
      );
    case 'text':
      return (
        <G key={key}>
          <Rect x={s.bg.x} y={s.bg.y} width={s.bg.w} height={s.bg.h} rx={s.bg.rx} fill={s.bg.fill} />
          <SvgText x={s.x} y={s.y} textAnchor="middle" fontSize={s.fontSize} fontWeight="700" fill={s.fill}>
            {s.text}
          </SvgText>
        </G>
      );
  }
}

export function AnnotationLayer({ width, height, rect, items, markers, draft, style }: Props) {
  const { left, top, width: rw, height: rh } = rect;
  // Committed items only re-project when the items or the rect change — a
  // stroke in progress re-renders the draft alone.
  const committed = useMemo(
    () => annotationShapes(items, { left, top, width: rw, height: rh }),
    [items, left, top, rw, rh],
  );
  const under = useMemo(
    () => (markers && markers.length > 0 ? markerShapes(markers, { left, top, width: rw, height: rh }) : []),
    [markers, left, top, rw, rh],
  );
  const live = draft ? annotationToShapes(draft, { left, top, width: rw, height: rh }) : [];

  if (!(width > 0) || !(height > 0)) return null;

  return (
    <Svg width={width} height={height} style={[StyleSheet.absoluteFill, style]} pointerEvents="none">
      {under.map((s, i) => shapeElement(s, `m${i}`))}
      {committed.map((s, i) => shapeElement(s, `a${i}`))}
      {live.map((s, i) => shapeElement(s, `d${i}`))}
    </Svg>
  );
}
