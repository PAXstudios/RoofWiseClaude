// The "searching the map" animation behind "Where should I knock?".
//
// A roofer waits 10–40 s while 24 months of storm reports are pulled and
// scored; a spinner says nothing. This draws what the finder is doing: a
// night map grid with street lines, a radar sweep from the roofer's base,
// storm cells that flare as the sweep passes, houses that light up when a
// cell is scored, and a scanline that walks the frame. Brand palette only
// (royal blue ground, burnt-orange sweep and hits — theme tokens), pure
// react-native-svg + reanimated, no video asset, no network. Reduced motion
// renders a single still frame.
//
// Worklet safety (the Expo Go SIGABRT class): every animated prop reads only
// numeric shared values and does arithmetic — no JS calls, no closures over
// non-serialisable objects.

import { useEffect, useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Defs, G, Line, LinearGradient, Path, Polygon, RadialGradient, Rect, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  type SharedValue,
  useAnimatedProps,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { brand, colors, radii } from '@/theme/tokens';

const AnimatedG = Animated.createAnimatedComponent(G);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedLine = Animated.createAnimatedComponent(Line);
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);

export const SEARCH_ANIMATION_HEIGHT = 200;
const W = 360;
const H = SEARCH_ANIMATION_HEIGHT;
const CX = 180;
const CY = 112;
const SWEEP_MS = 3200;
const SCAN_MS = 4200;
const RING_MS = 2600;

/** Storm cells at (angle°, radius) from base — spread like a real hail swath. */
const CELLS: { a: number; r: number; s: number }[] = [
  { a: 20, r: 62, s: 9 },
  { a: 48, r: 104, s: 12 },
  { a: 75, r: 78, s: 7 },
  { a: 118, r: 120, s: 10 },
  { a: 150, r: 70, s: 8 },
  { a: 205, r: 96, s: 11 },
  { a: 240, r: 58, s: 6 },
  { a: 268, r: 128, s: 9 },
  { a: 305, r: 84, s: 8 },
  { a: 338, r: 112, s: 10 },
];

/** Little house glyphs scattered along the "streets". */
const HOUSES: { x: number; y: number; a: number }[] = [
  { x: 62, y: 58, a: 30 },
  { x: 118, y: 40, a: 62 },
  { x: 250, y: 44, a: 110 },
  { x: 304, y: 70, a: 140 },
  { x: 318, y: 132, a: 200 },
  { x: 262, y: 168, a: 236 },
  { x: 150, y: 176, a: 270 },
  { x: 70, y: 150, a: 312 },
  { x: 40, y: 104, a: 350 },
  { x: 214, y: 92, a: 88 },
];

const toXY = (a: number, r: number) => ({
  x: CX + r * Math.cos(((a - 90) * Math.PI) / 180),
  y: CY + r * Math.sin(((a - 90) * Math.PI) / 180),
});

/** 0..1 glow for an element at `angle` when the sweep is at `sweep` degrees — brightest just after the sweep passes. */
function glowFor(angle: number, sweep: number): number {
  'worklet';
  let d = sweep - angle;
  d = ((d % 360) + 360) % 360; // degrees since the sweep passed this angle
  if (d > 110) return 0.08;
  return 0.08 + 0.92 * (1 - d / 110) * (1 - d / 110);
}

function StormCell({ a, r, s, sweep }: { a: number; r: number; s: number; sweep: SharedValue<number> }) {
  const { x, y } = toXY(a, r);
  const props = useAnimatedProps(() => {
    const g = glowFor(a, sweep.value);
    return { opacity: g, r: s * (0.6 + 0.6 * g) };
  });
  return <AnimatedCircle cx={x} cy={y} fill={brand.burnt} animatedProps={props} />;
}

function House({ x, y, a, sweep }: { x: number; y: number; a: number; sweep: SharedValue<number> }) {
  const props = useAnimatedProps(() => {
    const g = glowFor(a, sweep.value);
    return { opacity: 0.25 + 0.75 * g };
  });
  // Roof + body, 14 px wide.
  const d = `M${x - 7},${y} L${x},${y - 7} L${x + 7},${y} Z M${x - 5},${y} h10 v7 h-10 Z`;
  return (
    <AnimatedG animatedProps={props}>
      <Path d={d} fill={colors.textInverse} fillOpacity={0.9} />
    </AnimatedG>
  );
}

type Props = {
  /** Which finder step is running — drives the caption strip under the map. */
  caption?: string;
};

export function SearchAnimation({ caption }: Props) {
  const reduced = useReducedMotion();
  const sweep = useSharedValue(0);
  const scan = useSharedValue(0);
  const ring = useSharedValue(0);

  useEffect(() => {
    if (reduced) {
      sweep.value = 40;
      scan.value = 0.5;
      ring.value = 0.5;
      return;
    }
    sweep.value = withRepeat(withTiming(360, { duration: SWEEP_MS, easing: Easing.linear }), -1, false);
    scan.value = withRepeat(withTiming(1, { duration: SCAN_MS, easing: Easing.inOut(Easing.quad) }), -1, true);
    ring.value = withRepeat(withTiming(1, { duration: RING_MS, easing: Easing.out(Easing.quad) }), -1, false);
  }, [reduced, sweep, scan, ring]);

  // The sweep: a wedge about the base. Its geometry is computed from the
  // angle directly (points + line end) rather than rotating a group — an
  // animated group transform is not applied by react-native-svg on every
  // platform, and numbers are all a worklet needs.
  const sweepPolyProps = useAnimatedProps(() => {
    const a = ((sweep.value - 90) * Math.PI) / 180;
    const half = (24 * Math.PI) / 180;
    const R = 144;
    const x1 = CX + R * Math.cos(a - half);
    const y1 = CY + R * Math.sin(a - half);
    const x2 = CX + R * Math.cos(a + half);
    const y2 = CY + R * Math.sin(a + half);
    return { points: `${CX},${CY} ${x1},${y1} ${x2},${y2}` };
  });
  const sweepLineProps = useAnimatedProps(() => {
    const a = ((sweep.value - 90) * Math.PI) / 180;
    return { x2: CX + 136 * Math.cos(a), y2: CY + 136 * Math.sin(a) };
  });
  // Expanding ring from the base.
  const ringProps = useAnimatedProps(() => ({ r: 10 + ring.value * 130, opacity: 0.55 * (1 - ring.value) }));
  // Horizontal scanline.
  const scanProps = useAnimatedProps(() => {
    const y = 14 + scan.value * (H - 28);
    return { y1: y, y2: y };
  });
  const scanGlowProps = useAnimatedProps(() => {
    const y = 14 + scan.value * (H - 28);
    return { y: y - 10 };
  });

  const grid = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let x = 0; x <= W; x += 30) lines.push({ x1: x, y1: 0, x2: x, y2: H });
    for (let y = 0; y <= H; y += 30) lines.push({ x1: 0, y1: y, x2: W, y2: y });
    return lines;
  }, []);

  return (
    <View style={styles.frame} accessibilityRole="image" accessibilityLabel="Searching the map for storm-hit neighbourhoods">
      <Svg width="100%" height={H} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id="ground" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={brand.royalInk} />
            <Stop offset="1" stopColor={brand.black} />
          </LinearGradient>
          <RadialGradient id="wedge" cx={CX} cy={CY} r={150} gradientUnits="userSpaceOnUse">
            <Stop offset="0" stopColor={brand.burnt} stopOpacity="0.55" />
            <Stop offset="1" stopColor={brand.burnt} stopOpacity="0" />
          </RadialGradient>
          <LinearGradient id="scan" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={brand.royal} stopOpacity="0" />
            <Stop offset="0.5" stopColor={brand.royal} stopOpacity="0.35" />
            <Stop offset="1" stopColor={brand.royal} stopOpacity="0" />
          </LinearGradient>
        </Defs>

        <Rect x="0" y="0" width={W} height={H} fill="url(#ground)" />

        {/* Map grid + a few "streets". */}
        {grid.map((l, i) => (
          <Line key={i} {...l} stroke={colors.textInverse} strokeOpacity={0.06} strokeWidth={1} />
        ))}
        <Path d="M0,96 C80,90 140,120 200,104 S300,72 360,84" stroke={colors.textInverse} strokeOpacity={0.18} strokeWidth={2} fill="none" />
        <Path d="M120,0 C130,60 100,120 128,200" stroke={colors.textInverse} strokeOpacity={0.14} strokeWidth={2} fill="none" />
        <Path d="M260,0 C240,70 300,130 276,200" stroke={colors.textInverse} strokeOpacity={0.14} strokeWidth={2} fill="none" />

        {/* Range rings. */}
        {[40, 80, 120].map((r) => (
          <Circle key={r} cx={CX} cy={CY} r={r} stroke={brand.royal} strokeOpacity={0.35} strokeWidth={1} fill="none" />
        ))}
        <AnimatedCircle cx={CX} cy={CY} stroke={brand.burnt} strokeWidth={2} fill="none" animatedProps={ringProps} />

        {/* Houses and storm cells respond to the sweep. */}
        {HOUSES.map((h, i) => (
          <House key={i} {...h} sweep={sweep} />
        ))}
        {CELLS.map((c, i) => (
          <StormCell key={i} {...c} sweep={sweep} />
        ))}

        {/* The sweep wedge and its leading edge. */}
        <AnimatedPolygon fill="url(#wedge)" animatedProps={sweepPolyProps} />
        <AnimatedLine x1={CX} y1={CY} stroke={brand.burnt} strokeWidth={2} strokeOpacity={0.9} animatedProps={sweepLineProps} />

        {/* Base — the roofer. */}
        <Circle cx={CX} cy={CY} r={7} fill={brand.burnt} />
        <Circle cx={CX} cy={CY} r={3} fill={colors.textInverse} />

        {/* Scanline. */}
        <AnimatedRect animatedProps={scanGlowProps} />
        <AnimatedLine x1={0} x2={W} stroke={brand.royal} strokeOpacity={0.8} strokeWidth={1.5} animatedProps={scanProps} />
      </Svg>
      {caption ? (
        <View style={styles.captionWrap}>
          <View style={styles.captionDot} />
          <Animated.Text style={styles.caption} numberOfLines={2}>
            {caption}
          </Animated.Text>
        </View>
      ) : null}
    </View>
  );
}

// A rect that follows the scanline (soft band). Kept separate so the props
// hook stays tiny.
const AnimatedRectBase = Animated.createAnimatedComponent(Rect);
function AnimatedRect({ animatedProps }: { animatedProps: any }) {
  return <AnimatedRectBase x={0} width={W} height={20} fill="url(#scan)" animatedProps={animatedProps} />;
}

const styles = StyleSheet.create({
  frame: { borderRadius: radii.card, overflow: 'hidden', backgroundColor: brand.royalInk },
  captionWrap: {
    position: 'absolute',
    left: 12,
    right: 12,
    bottom: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  captionDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: brand.burnt },
  caption: { flex: 1, color: colors.textInverse, fontSize: 13, fontWeight: '600' },
});
