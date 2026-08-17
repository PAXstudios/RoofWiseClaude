// Radar / precipitation art for the Home weather hero.
//
// This is the ONBOARDING radar motif (components/onboarding/scenes.tsx →
// StormScene) carried into the app proper: concentric rings on a soft brand
// glow, a slow rotating sweep, and storm cells that breathe. Same language,
// same tokens — so the first screen after onboarding is recognisably the same
// product rather than a settings list.
//
// ── HONESTY CONTRACT (Drift #5) ──────────────────────────────────────────
// `cells` are a picture of REAL storm data or they are absent. The caller
// passes them only when an active storm alert exists, and derives each one
// from a value that was actually measured (hail size / wind speed for the
// intensity, a matched lead's true distance from the core for the radius).
// With no storm, the art is rings + sweep only — an ambient pattern that
// makes no claim. We never draw a cell to fill the space.
//
// The rings are a MOTIF, not a map: `r` carries a real distance where the
// caller has one, but `angle` is an even decorative spread and is NEVER a
// bearing. Nothing here is labelled or scaled as geography, and the art
// always sits behind a scrim, under text that states the actual numbers.

import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { brand, glass, motion } from '@/theme/tokens';

/** One storm cell on the radar. Every field is derived from measured data. */
export type RadarCell = {
  /** 0–1, centre → outer ring. A real distance, normalised, where one exists. */
  r: number;
  /** Degrees. Decorative spread only — this is not a bearing. */
  angle: number;
  /** 0–1 visual weight, from the storm's real magnitude. */
  intensity: number;
};

/** `severe` burns orange (an alert is live); `calm` washes royal (ambient). */
export type RadarTone = 'severe' | 'calm';

type Props = {
  /** Square edge in pt. The art is meant to bleed off its card's corner. */
  size: number;
  /** Real storm cells. Omit entirely when there is no storm. */
  cells?: readonly RadarCell[];
  tone?: RadarTone;
  /** Ambient motion. Reduce Motion turns it off regardless. */
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
};

const RING_FRACTIONS = [0.32, 0.58, 0.82, 1] as const;
const SWEEP_DEGREES = 74;
/** Beyond this the rings stop reading as rings. Real overflow is stated in text. */
const MAX_CELLS = 7;
const CELL_STAGGER_MS = 260;
const CELL_DOT_MIN = 7;
const CELL_DOT_RANGE = 9;

export function RadarArt({ size, cells, tone = 'calm', animate = true, style }: Props) {
  // Reduce Motion → the art still renders, it simply holds still. A static
  // gradient + rings is the fallback, never a blank hole.
  const reduced = useReducedMotion();
  const moving = animate && !reduced;

  // SVG gradient ids are document-global on web, so two heroes on one page
  // would fight over them. useId gives each instance its own namespace;
  // its colons are illegal inside a url(#…) reference, hence the scrub.
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const glowId = `radarGlow${uid}`;
  const sweepId = `radarSweep${uid}`;

  const accent = tone === 'severe' ? brand.burnt : brand.royalSoft;
  const ringStroke = tone === 'severe' ? glass.borderStrong : glass.border;
  const cellColor = tone === 'severe' ? brand.burntSoft : brand.royalSoft;

  const enter = useSharedValue(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withSpring(1, motion.gentle);
  }, [enter, reduced]);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(sweep);
      sweep.value = 0;
      return;
    }
    sweep.value = withRepeat(
      withTiming(1, { duration: motion.ambientMs, easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [moving, sweep]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.86 + enter.value * 0.14 }],
  }));

  const sweepStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${sweep.value * 360}deg` }],
  }));

  const c = size / 2;
  const edge = c * 0.98;
  const plotted = (cells ?? []).slice(0, MAX_CELLS);

  return (
    <Animated.View
      pointerEvents="none"
      style={[{ width: size, height: size }, style, enterStyle]}
    >
      <Svg width={size} height={size} style={StyleSheet.absoluteFill}>
        <Defs>
          <RadialGradient id={glowId} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={accent} stopOpacity={0.3} />
            <Stop offset="68%" stopColor={accent} stopOpacity={0.09} />
            <Stop offset="100%" stopColor={accent} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={c} cy={c} r={c} fill={`url(#${glowId})`} />
        {RING_FRACTIONS.map((f) => (
          <Circle
            key={f}
            cx={c}
            cy={c}
            r={c * f - 1}
            fill="none"
            stroke={ringStroke}
            strokeWidth={1}
          />
        ))}
        <Line x1={c - edge} y1={c} x2={c + edge} y2={c} stroke={ringStroke} strokeWidth={1} />
        <Line x1={c} y1={c - edge} x2={c} y2={c + edge} stroke={ringStroke} strokeWidth={1} />
      </Svg>

      <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={sweepId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={accent} stopOpacity={0.42} />
              <Stop offset="100%" stopColor={accent} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Path d={wedgePath(c, edge, SWEEP_DEGREES)} fill={`url(#${sweepId})`} />
        </Svg>
      </Animated.View>

      {plotted.map((cell, i) => (
        <RadarBlip
          key={`${cell.r.toFixed(3)}-${cell.angle.toFixed(1)}-${i}`}
          cell={cell}
          index={i}
          center={c}
          reach={c * 0.86}
          color={cellColor}
          moving={moving}
        />
      ))}
    </Animated.View>
  );
}

/**
 * One cell: a core dot with a halo that expands and fades, on the ambient
 * loop. Held static (dot lit, halo at rest) under Reduce Motion.
 */
function RadarBlip({
  cell,
  index,
  center,
  reach,
  color,
  moving,
}: {
  cell: RadarCell;
  index: number;
  center: number;
  reach: number;
  color: string;
  moving: boolean;
}) {
  const p = useSharedValue(moving ? 0 : 1);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(p);
      p.value = 1;
      return;
    }
    p.value = withDelay(
      index * CELL_STAGGER_MS,
      withRepeat(
        // Twice the live-indicator beat: a storm cell should breathe, not blink.
        withTiming(1, { duration: motion.pulseMs * 2, easing: Easing.out(Easing.quad) }),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(p);
  }, [moving, index, p]);

  const dot = useAnimatedStyle(() => ({
    opacity: moving
      ? p.value < 0.15
        ? p.value / 0.15
        : Math.max(0.4, 1 - (p.value - 0.15) / 0.85)
      : 1,
  }));

  const halo = useAnimatedStyle(() => ({
    opacity: moving ? Math.max(0, 0.5 - p.value * 0.5) : 0,
    transform: [{ scale: 0.5 + p.value * 2.2 }],
  }));

  const rad = (cell.angle * Math.PI) / 180;
  const dotSize = CELL_DOT_MIN + cell.intensity * CELL_DOT_RANGE;
  const box = dotSize * 3;
  const left = center + Math.cos(rad) * reach * cell.r - box / 2;
  const top = center + Math.sin(rad) * reach * cell.r - box / 2;

  return (
    <View style={[styles.cell, { left, top, width: box, height: box }]} pointerEvents="none">
      <Animated.View
        style={[
          styles.cellHalo,
          { borderColor: color, borderRadius: box / 2 },
          halo,
        ]}
      />
      <Animated.View
        style={[
          {
            width: dotSize,
            height: dotSize,
            borderRadius: dotSize / 2,
            backgroundColor: color,
          },
          dot,
        ]}
      />
    </View>
  );
}

/** Pie wedge from 12 o'clock, sweeping clockwise by `sweepDeg`. */
function wedgePath(center: number, radius: number, sweepDeg: number): string {
  const rad = (sweepDeg * Math.PI) / 180;
  const endX = center + radius * Math.sin(rad);
  const endY = center - radius * Math.cos(rad);
  return (
    `M${center} ${center} L${center} ${center - radius} ` +
    `A${radius} ${radius} 0 0 1 ${endX.toFixed(2)} ${endY.toFixed(2)} Z`
  );
}

const styles = StyleSheet.create({
  cell: { position: 'absolute', alignItems: 'center', justifyContent: 'center' },
  cellHalo: { ...StyleSheet.absoluteFillObject, borderWidth: 1.5 },
});
