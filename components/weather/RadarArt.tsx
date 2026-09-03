// Weather art for the Home hero — radar, aurora wash, precipitation veil.
//
// This is the ONBOARDING radar motif (components/onboarding/scenes.tsx →
// StormScene) carried into the app proper: concentric rings on a soft brand
// glow, a slow rotating sweep, ring pulses breathing out from the centre, and
// storm cells that breathe. Same language, same tokens — so the first screen
// after onboarding is recognisably the same product rather than a settings
// list.
//
// ── ART vs DATA ──────────────────────────────────────────────────────────
// The three pieces here split cleanly:
//
//   `AuroraWash`  pure decoration. Renders in EVERY hero state, including
//                 "weather not available" — a module with no data still gets
//                 its designed frame; only the text layer changes.
//   `RadarArt`    the rings, sweep and pulses are decoration; the CELLS are
//                 data (see the honesty contract below) and are absent unless
//                 the caller has a real storm to draw.
//   `PrecipVeil`  falling rain / hail. Mounted ONLY where the caller can point
//                 at a real precipitation reading — see WeatherHero's
//                 `precipVeil()`. Never mounted to make a card look busy.
//
// ── HONESTY CONTRACT (Drift #5) ──────────────────────────────────────────
// `cells` are a picture of REAL storm data or they are absent. The caller
// passes them only when an active storm alert exists, and derives each one
// from a value that was actually measured (hail size / wind speed for the
// intensity, a matched lead's true distance from the core for the radius).
// With no storm, the art is rings + sweep + pulses only — an ambient pattern
// that makes no claim. We never draw a cell to fill the space.
//
// The rings are a MOTIF, not a map: `r` carries a real distance where the
// caller has one, but `angle` is an even decorative spread and is NEVER a
// bearing. Nothing here is labelled or scaled as geography, and the art
// always sits behind a scrim, under text that states the actual numbers.
//
// ── SETTLED, NOT LOADING ─────────────────────────────────────────────────
// The hero's unavailable state is a SETTLED state, so nothing here may read
// as a spinner or a skeleton. `tone="idle"` slows the sweep well past any
// progress-indicator cadence and drops its weight, and there is no shimmer
// anywhere in this file. Reduce Motion parks every loop at a composed resting
// pose rather than hiding the art.

import { useEffect, useId } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Svg, { Circle, Defs, Ellipse, Line, Path, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { brand, colors, glass, motion, radii } from '@/theme/tokens';

/** One storm cell on the radar. Every field is derived from measured data. */
export type RadarCell = {
  /** 0–1, centre → outer ring. A real distance, normalised, where one exists. */
  r: number;
  /** Degrees. Decorative spread only — this is not a bearing. */
  angle: number;
  /** 0–1 visual weight, from the storm's real magnitude. */
  intensity: number;
};

/**
 * `severe` burns orange (an alert is live); `calm` washes royal (ambient);
 * `idle` is the same royal art at lower weight and half speed — the tone for
 * a hero that has no reading to show and must look settled rather than busy.
 */
export type RadarTone = 'severe' | 'calm' | 'idle';

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

/** Ring-pulse geometry: how far a pulse travels, and how many are in flight. */
const PULSE_MIN_SCALE = 0.3;
const PULSE_TRAVEL = 0.78;
const PULSE_COUNT = 2;
/** Slow enough to read as breathing, never as a progress indicator. */
const PULSE_MS = motion.pulseMs * 2.6;

/**
 * Sweep period per tone. `idle` runs at 1.7× the ambient loop so the settled
 * state drifts rather than ticks — an unmistakably non-loading cadence.
 */
const SWEEP_MS: Record<RadarTone, number> = {
  severe: motion.ambientMs * 0.75,
  calm: motion.ambientMs,
  idle: motion.ambientMs * 1.7,
};

/** Resting sweep angle under Reduce Motion — a composed diagonal, not 12:00. */
const SWEEP_REST = 0.11;

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
  // The idle hero is a background, not a subject: same art, quieter ink.
  const artOpacity = tone === 'idle' ? 0.72 : 1;

  const enter = useSharedValue(0);
  const sweep = useSharedValue(0);

  useEffect(() => {
    enter.value = reduced ? 1 : withSpring(1, motion.gentle);
  }, [enter, reduced]);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(sweep);
      sweep.value = SWEEP_REST;
      return;
    }
    // Restart from 0 so every revolution covers a full 360° — picking the loop
    // up mid-value would skip an arc and read as a stutter once a second.
    sweep.value = 0;
    sweep.value = withRepeat(
      withTiming(1, { duration: SWEEP_MS[tone], easing: Easing.linear }),
      -1,
      false,
    );
    return () => cancelAnimation(sweep);
  }, [moving, sweep, tone]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value * artOpacity,
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

      {/* Ring pulse — concentric rings breathing outward from the centre.
          Decoration in every state: it claims nothing, it just keeps the art
          alive under copy that may have no numbers in it. */}
      {Array.from({ length: PULSE_COUNT }, (_, i) => (
        <RingPulse key={i} index={i} size={size} color={accent} moving={moving} />
      ))}

      <Animated.View style={[StyleSheet.absoluteFill, sweepStyle]}>
        <Svg width={size} height={size}>
          <Defs>
            <RadialGradient id={sweepId} cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor={accent} stopOpacity={tone === 'idle' ? 0.28 : 0.42} />
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
 * One expanding ring, on a slow stagger with its siblings. Held mid-travel
 * and dimmed under Reduce Motion so the composition still reads as concentric
 * rings rather than losing a layer.
 */
function RingPulse({
  index,
  size,
  color,
  moving,
}: {
  index: number;
  size: number;
  color: string;
  moving: boolean;
}) {
  const t = useSharedValue(0);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = withDelay(
      (index * PULSE_MS) / PULSE_COUNT,
      withRepeat(withTiming(1, { duration: PULSE_MS, easing: Easing.out(Easing.quad) }), -1, false),
    );
    return () => cancelAnimation(t);
  }, [moving, index, t]);

  const style = useAnimatedStyle(() => ({
    opacity: moving ? 0.4 * (1 - t.value) : 0.16,
    transform: [{ scale: PULSE_MIN_SCALE + t.value * PULSE_TRAVEL }],
  }));

  const d = size * RING_FRACTIONS[RING_FRACTIONS.length - 1];
  const inset = (size - d) / 2;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.pulse,
        { left: inset, top: inset, width: d, height: d, borderRadius: d / 2, borderColor: color },
        style,
      ]}
    />
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

/* ─────────────────────────── aurora wash ─────────────────────────────── */

type WashOrb = {
  /** Percentages of the card box — the SVG stretches to whatever it fills. */
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  /** Drift in POINTS, so the wash behaves the same on any card width. */
  drift: { x: number; y: number };
  delayMs: number;
  opacity: number;
};

const WASH_ORBS: readonly WashOrb[] = [
  { cx: 20, cy: 24, rx: 46, ry: 52, drift: { x: 14, y: 10 }, delayMs: 0, opacity: 0.55 },
  { cx: 82, cy: 70, rx: 40, ry: 46, drift: { x: -13, y: -12 }, delayMs: 1400, opacity: 0.4 },
  { cx: 52, cy: 104, rx: 54, ry: 44, drift: { x: 9, y: -9 }, delayMs: 2800, opacity: 0.45 },
];

/** Which brand hues carry the wash, per tone. Severe leans burnt, as the hero does. */
const WASH_COLORS: Record<RadarTone, readonly [string, string, string]> = {
  severe: [brand.burnt, brand.burntDeep, brand.royalDeep],
  calm: [brand.royal, brand.burnt, brand.royalDeep],
  idle: [brand.royal, brand.royalDeep, brand.burntDeep],
};

/**
 * Slow-drifting brand-coloured light behind the hero gradient — the same
 * device the onboarding sky uses (`components/glass/Aurora.tsx`), but sized to
 * a CARD rather than the window.
 *
 * `Aurora` positions its orbs off the shorter screen edge, so dropped into a
 * 224pt card it lands one orb and clips the rest. This draws in a percentage
 * viewBox instead, so the wash always composes to the box it fills, at any
 * card width, on native and on web. Pure decoration: it renders in every hero
 * state, including "weather not available".
 */
export function AuroraWash({
  tone = 'calm',
  animate = true,
  style,
}: {
  tone?: RadarTone;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const moving = animate && !reduced;
  const palette = WASH_COLORS[tone];

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {WASH_ORBS.map((orb, i) => (
        <WashOrbLayer key={i} orb={orb} color={palette[i]} moving={moving} />
      ))}
    </View>
  );
}

function WashOrbLayer({
  orb,
  color,
  moving,
}: {
  orb: WashOrb;
  color: string;
  moving: boolean;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const id = `wash${uid}`;
  const t = useSharedValue(0);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(t);
      t.value = 0.5;
      return;
    }
    t.value = withDelay(
      orb.delayMs,
      withRepeat(
        withTiming(1, { duration: motion.ambientMs, easing: Easing.inOut(Easing.sin) }),
        -1,
        true, // reverse, so the drift never snaps back
      ),
    );
    return () => cancelAnimation(t);
  }, [moving, orb.delayMs, t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: (t.value - 0.5) * orb.drift.x * 2 },
      { translateY: (t.value - 0.5) * orb.drift.y * 2 },
    ],
  }));

  return (
    <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, style]}>
      {/* `preserveAspectRatio="none"` is deliberate: the orbs should stretch
          into soft wide bands on a wide card, which is what an aurora does. */}
      <Svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={color} stopOpacity={orb.opacity} />
            <Stop offset="55%" stopColor={color} stopOpacity={orb.opacity * 0.28} />
            <Stop offset="100%" stopColor={color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Ellipse cx={orb.cx} cy={orb.cy} rx={orb.rx} ry={orb.ry} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/* ─────────────────────────── precipitation veil ──────────────────────── */

export type PrecipKind = 'rain' | 'hail';

/** Streak geometry per kind. Hail falls as short hard dashes; rain as lines. */
const PRECIP_SHAPE: Record<PrecipKind, { length: number; width: number; slantDeg: number; ms: number }> = {
  rain: { length: 26, width: 2, slantDeg: 14, ms: 1500 },
  hail: { length: 9, width: 3.5, slantDeg: 8, ms: 950 },
};

const PRECIP_MIN_STREAKS = 6;
const PRECIP_STREAK_RANGE = 9;
/** Kept well under the scrim's weight — the copy owns the card, not the art. */
const PRECIP_OPACITY: Record<PrecipKind, number> = { rain: 0.3, hail: 0.42 };

/**
 * Falling rain / hail over the hero gradient.
 *
 * MOUNT THIS ONLY where the caller can name the reading it came from. The
 * streaks are decoration, but "it is precipitating" is a claim, so drawing
 * them without a real precipitation reading would be a synthesized forecast
 * (Drift #5). `intensity` scales the DENSITY only — it is a visual weight,
 * never a stated number.
 */
export function PrecipVeil({
  kind,
  intensity,
  height,
  animate = true,
  style,
}: {
  kind: PrecipKind;
  /** 0–1 visual weight, from a real reading where the caller has one. */
  intensity: number;
  /** Card height in pt — the fall distance. */
  height: number;
  animate?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const reduced = useReducedMotion();
  const moving = animate && !reduced;
  const shape = PRECIP_SHAPE[kind];
  const count =
    PRECIP_MIN_STREAKS + Math.round(Math.min(1, Math.max(0, intensity)) * PRECIP_STREAK_RANGE);
  const color = kind === 'hail' ? colors.textInverse : brand.royalSoft;

  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.veil, style]}>
      {Array.from({ length: count }, (_, i) => (
        <PrecipStreak
          key={i}
          index={i}
          count={count}
          shape={shape}
          color={color}
          baseOpacity={PRECIP_OPACITY[kind]}
          height={height}
          moving={moving}
        />
      ))}
    </View>
  );
}

/**
 * Golden-ratio spread across the card, with a different irrational for the
 * fall phase — deterministic (no Math.random, so nothing re-scatters on a
 * render) and decorrelated, so the streaks never line up into a visible band.
 */
const PRECIP_SPREAD = 61.803;
const PRECIP_PHASE_SPREAD = 41.7;

function PrecipStreak({
  index,
  count,
  shape,
  color,
  baseOpacity,
  height,
  moving,
}: {
  index: number;
  count: number;
  shape: { length: number; width: number; slantDeg: number; ms: number };
  color: string;
  baseOpacity: number;
  height: number;
  moving: boolean;
}) {
  const phase = ((index * PRECIP_PHASE_SPREAD) % 100) / 100;
  const speed = shape.ms * (0.78 + ((index * 37) % 11) / 22);
  const t = useSharedValue(phase);

  useEffect(() => {
    if (!moving) {
      cancelAnimation(t);
      t.value = phase;
      return;
    }
    // Each streak starts mid-fall at its own phase so the field is populated
    // on the first frame, finishes that partial fall, then loops whole. The
    // zero-duration reset is invisible because opacity is already 0 at t=1.
    t.value = withSequence(
      withTiming(1, { duration: Math.max(1, speed * (1 - phase)), easing: Easing.linear }),
      withTiming(0, { duration: 1 }),
      withRepeat(withTiming(1, { duration: speed, easing: Easing.linear }), -1, false),
    );
    return () => cancelAnimation(t);
  }, [moving, phase, speed, t]);

  const travel = height + shape.length * 2;
  const style = useAnimatedStyle(() => ({
    opacity: moving
      ? baseOpacity * Math.min(1, Math.min(t.value, 1 - t.value) * 5)
      : baseOpacity * 0.75,
    transform: [
      { translateY: -shape.length + t.value * travel },
      { rotate: `${shape.slantDeg}deg` },
    ],
  }));

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.streak,
        {
          left: `${((index * PRECIP_SPREAD) % 100) * (count / (count + 1))}%`,
          width: shape.width,
          height: shape.length,
          borderRadius: radii.pill,
          backgroundColor: color,
        },
        style,
      ]}
    />
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
  cellHalo: { ...StyleSheet.absoluteFill, borderWidth: 1.5 },
  pulse: { position: 'absolute', borderWidth: 1.5 },
  veil: { overflow: 'hidden' },
  streak: { position: 'absolute', top: 0 },
});
