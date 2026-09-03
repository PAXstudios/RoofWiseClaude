// The radius dial — how far from base the Knock Planner looks (3–50 mi).
//
// An arc dial, not a slider: a 270° track with a tick every 5 mi, the chosen
// span filled in the brand ramp (royal at the near end, burnt at the far
// end), a 56pt thumb a gloved finger drags round the ring, the number big in
// the middle with a line under it that says what the radius means ("the
// county"), and ± buttons under the two ends of the arc for a thumb that
// would rather tap than drag. The dial and the ring on the map above it are
// ONE control — `onChange` fires on every mile so the ring redraws live;
// `onCommit` fires when the finger lifts (or a button is pressed) so the
// store is written once, not fifty times a drag.
//
// Gesture: a Pan that activates on touch-down only inside the ring band
// (the annulus ±40pt around the track), so the rest of the card still
// scrolls the screen. Callbacks run on the JS thread (`runOnJS(true)`) —
// the maths is plain TypeScript, nothing crosses into a worklet but two
// numbers (the Expo Go SIGABRT class). Reanimated moves the thumb and the
// arc between values; reduced motion sets them without a tween.
//
// The pure maths lives between the `pure maths` markers with no imports —
// the Node test slices it out of this file and checks angle ↔ miles, the
// snapping, the clamping and the arc path.

import { useCallback, useEffect, useMemo, useRef } from 'react';
import { Platform, StyleSheet, Text, View, type AccessibilityActionEvent } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Svg, { Circle, Defs, Line, LinearGradient, Path, Stop, Text as SvgText } from 'react-native-svg';
import Animated, { Easing, useAnimatedProps, useReducedMotion, useSharedValue, withTiming } from 'react-native-reanimated';
import { PressableScale } from '@/components/PressableScale';
import { MAX_SEARCH_RADIUS_MILES, MIN_SEARCH_RADIUS_MILES } from '@/lib/services/knockOpportunities';
import { brand, colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

// ── pure maths ──────────────────────────────────────────────────────────────
// No imports above this line are used below it. Angles are degrees clockwise
// from 12 o'clock; the track runs from −135° (bottom-left) to +135°
// (bottom-right) with the gap at the bottom.

export const DIAL_START_DEG = -135;
export const DIAL_SWEEP_DEG = 270;
/** The top of the track. The value floor is the engine's minimum, passed in. */
export const DIAL_TRACK_MAX_MILES = 50;

/** Track angle for `miles` (0 → −135°, 50 → +135°), clamped to the track. */
export function angleForMiles(miles: number, max: number = DIAL_TRACK_MAX_MILES): number {
  'worklet';
  const t = Math.min(1, Math.max(0, miles / max));
  return DIAL_START_DEG + DIAL_SWEEP_DEG * t;
}

/** Unsnapped miles for a touch angle (−180..180). Inside the bottom gap the nearer end wins. */
export function milesForAngle(deg: number, max: number = DIAL_TRACK_MAX_MILES): number {
  if (deg <= DIAL_START_DEG) return 0;
  if (deg >= DIAL_START_DEG + DIAL_SWEEP_DEG) return max;
  return ((deg - DIAL_START_DEG) / DIAL_SWEEP_DEG) * max;
}

/** Touch angle about the dial's centre: clockwise from 12 o'clock, −180..180. */
export function touchAngle(x: number, y: number, cx: number, cy: number): number {
  return (Math.atan2(x - cx, -(y - cy)) * 180) / Math.PI;
}

/** Whole miles inside [min, max]; a non-number lands on the floor. */
export function snapMiles(raw: number, min: number, max: number): number {
  if (!Number.isFinite(raw)) return min;
  return Math.min(max, Math.max(min, Math.round(raw)));
}

/** Point on the circle of radius `r` about (cx, cy) at `deg` clockwise from 12 o'clock. */
export function pointOnArc(cx: number, cy: number, r: number, deg: number): { x: number; y: number } {
  'worklet';
  const a = ((deg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
}

/** SVG path of the clockwise arc from `fromDeg` to `toDeg`; '' when there is no span. */
export function arcPath(cx: number, cy: number, r: number, fromDeg: number, toDeg: number): string {
  'worklet';
  const span = toDeg - fromDeg;
  if (span <= 0.01) return '';
  const a = pointOnArc(cx, cy, r, fromDeg);
  const b = pointOnArc(cx, cy, r, toDeg);
  const large = span > 180 ? 1 : 0;
  return `M${a.x.toFixed(2)},${a.y.toFixed(2)} A${r},${r} 0 ${large} 1 ${b.x.toFixed(2)},${b.y.toFixed(2)}`;
}

/** The line under the number — what this many miles means to a roofer. */
export function radiusCaption(miles: number, min: number): string {
  if (miles <= min) return `The floor — one ${min}-mile cell, the smallest area the engine scores`;
  if (miles <= 10) return 'One town';
  if (miles <= 25) return 'The county';
  if (miles <= 40) return 'The metro';
  return "As far as a day's drive";
}
// ── /pure maths ─────────────────────────────────────────────────────────────

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedCircle = Animated.createAnimatedComponent(Circle);

/** Dial geometry, in points (the SVG is drawn 1:1). */
export const DIAL_WIDTH = 280;
const DIAL_HEIGHT = 240;
const CX = 140;
const CY = 146;
const R = 100;
const TRACK_WIDTH = 14;
const TICK_IN = R + 13;
const TICK_OUT = R + 19;
const TICK_OUT_MAJOR = R + 23;
const LABEL_R = R + 35;
/** Half-width of the annulus that owns the drag (≥ 56pt across, Drift #1). */
const BAND = 40;
const THUMB_R = 18;
const THUMB_GLOW_R = 27;
const TWEEN_MS = 180;

const MIN = MIN_SEARCH_RADIUS_MILES;
const MAX = MAX_SEARCH_RADIUS_MILES;
const LABELLED = [10, 25, 50];
const TICKS = Array.from({ length: DIAL_TRACK_MAX_MILES / 5 + 1 }, (_, i) => i * 5);

type Props = {
  /** Whole miles, MIN..MAX. */
  value: number;
  /** Every 1-mi step, live — the ring on the map follows this. */
  onChange: (miles: number) => void;
  /** The finger lifted or a button was pressed — persist here. */
  onCommit?: (miles: number) => void;
  disabled?: boolean;
  testID?: string;
};

export function RadiusDial({ value, onChange, onCommit, disabled = false, testID = 'radius-dial' }: Props) {
  const reduced = useReducedMotion();
  const miles = useSharedValue(snapMiles(value, MIN, MAX));
  const dragging = useRef(false);
  const latest = useRef(value);
  latest.current = value;

  // Follow the prop between gestures (the store hydrating, a button press).
  useEffect(() => {
    if (dragging.current) return;
    const next = snapMiles(value, MIN, MAX);
    miles.value = reduced ? next : withTiming(next, { duration: TWEEN_MS, easing: Easing.out(Easing.quad) });
  }, [value, reduced, miles]);

  // Haptics: a tick every 5 mi, a firmer bump when the dial hits an end.
  const feel = useCallback((prev: number, next: number) => {
    if (Platform.OS === 'web') return;
    if (next === MIN || next === MAX) {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    } else if (Math.floor(prev / 5) !== Math.floor(next / 5)) {
      Haptics.selectionAsync().catch(() => {});
    }
  }, []);

  const step = useCallback(
    (next: number) => {
      const prev = latest.current;
      if (next === prev) return;
      feel(prev, next);
      latest.current = next;
      onChange(next);
    },
    [feel, onChange],
  );

  const setFromTouch = useCallback(
    (x: number, y: number) => {
      const next = snapMiles(milesForAngle(touchAngle(x, y, CX, CY), DIAL_TRACK_MAX_MILES), MIN, MAX);
      miles.value = next;
      step(next);
    },
    [miles, step],
  );

  const bump = useCallback(
    (delta: number) => {
      const next = snapMiles(latest.current + delta, MIN, MAX);
      if (next === latest.current) {
        feel(next, next);
        return;
      }
      miles.value = reduced ? next : withTiming(next, { duration: TWEEN_MS, easing: Easing.out(Easing.quad) });
      step(next);
      onCommit?.(next);
    },
    [feel, miles, onCommit, reduced, step],
  );

  const pan = useMemo(
    () =>
      Gesture.Pan()
        .enabled(!disabled)
        .runOnJS(true)
        .manualActivation(true)
        .onTouchesDown((e, manager) => {
          const t = e.allTouches[0];
          if (!t) return;
          const dx = t.x - CX;
          const dy = t.y - CY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist >= R - BAND && dist <= R + BAND) manager.activate();
          else manager.fail();
        })
        .onStart((e) => {
          dragging.current = true;
          setFromTouch(e.x, e.y);
        })
        .onUpdate((e) => setFromTouch(e.x, e.y))
        .onFinalize(() => {
          if (!dragging.current) return;
          dragging.current = false;
          onCommit?.(latest.current);
        }),
    [disabled, onCommit, setFromTouch],
  );

  // The arc and the thumb are pure functions of one number — the animated
  // props build the path `d` and the thumb's centre from the angle. (Never
  // an animated group transform: react-native-svg does not apply it on every
  // platform.) On web the same values arrive as plain props from state.
  const arcProps = useAnimatedProps(() => ({ d: arcPath(CX, CY, R, DIAL_START_DEG, angleForMiles(miles.value, DIAL_TRACK_MAX_MILES)) }));
  const thumbProps = useAnimatedProps(() => {
    const p = pointOnArc(CX, CY, R, angleForMiles(miles.value, DIAL_TRACK_MAX_MILES));
    return { cx: p.x, cy: p.y };
  });
  const staticAngle = angleForMiles(value, DIAL_TRACK_MAX_MILES);
  const staticArc = arcPath(CX, CY, R, DIAL_START_DEG, staticAngle);
  const staticThumb = pointOnArc(CX, CY, R, staticAngle);
  const isWeb = Platform.OS === 'web';

  const onAccessibilityAction = useCallback(
    (e: AccessibilityActionEvent) => {
      if (e.nativeEvent.actionName === 'increment') bump(1);
      else if (e.nativeEvent.actionName === 'decrement') bump(-1);
    },
    [bump],
  );

  const atMin = value <= MIN;
  const atMax = value >= MAX;

  return (
    <View style={styles.root} testID={testID}>
      <GestureDetector gesture={pan}>
        <View
          style={styles.dial}
          accessible
          accessibilityRole="adjustable"
          accessibilityLabel="Search radius"
          accessibilityHint="Drag around the ring, or use the plus and minus buttons"
          accessibilityValue={{ min: MIN, max: MAX, now: value, text: `${value} miles` }}
          accessibilityActions={[{ name: 'increment' }, { name: 'decrement' }]}
          onAccessibilityAction={onAccessibilityAction}
        >
          <Svg width={DIAL_WIDTH} height={DIAL_HEIGHT} viewBox={`0 0 ${DIAL_WIDTH} ${DIAL_HEIGHT}`}>
            <Defs>
              <LinearGradient id="radiusRamp" x1={CX - R} y1={0} x2={CX + R} y2={0} gradientUnits="userSpaceOnUse">
                <Stop offset="0" stopColor={brand.royal} />
                <Stop offset="1" stopColor={brand.burnt} />
              </LinearGradient>
            </Defs>

            {/* Track. */}
            <Path d={arcPath(CX, CY, R, DIAL_START_DEG, DIAL_START_DEG + DIAL_SWEEP_DEG)} stroke={colors.borderStrong} strokeWidth={TRACK_WIDTH} strokeLinecap="round" fill="none" />

            {/* Ticks every 5 mi; the labelled ones a touch longer. */}
            {TICKS.map((m) => {
              const deg = angleForMiles(m, DIAL_TRACK_MAX_MILES);
              const major = LABELLED.includes(m);
              const a = pointOnArc(CX, CY, TICK_IN, deg);
              const b = pointOnArc(CX, CY, major ? TICK_OUT_MAJOR : TICK_OUT, deg);
              return <Line key={m} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={major ? colors.text : colors.textSubtle} strokeWidth={major ? 2.5 : 1.5} strokeLinecap="round" />;
            })}
            {LABELLED.map((m) => {
              const p = pointOnArc(CX, CY, LABEL_R, angleForMiles(m, DIAL_TRACK_MAX_MILES));
              return (
                <SvgText key={m} x={p.x} y={p.y + 4} fontSize={fontSize.bodySm} fontWeight={fontWeight.semibold} fill={colors.textMuted} textAnchor="middle">
                  {String(m)}
                </SvgText>
              );
            })}

            {/* The chosen span. */}
            <AnimatedPath
              {...(isWeb ? { d: staticArc } : null)}
              animatedProps={arcProps}
              stroke="url(#radiusRamp)"
              strokeWidth={TRACK_WIDTH}
              strokeLinecap="round"
              fill="none"
            />

            {/* Thumb: a soft glow, then the white knob with the burnt ring. */}
            <AnimatedCircle {...(isWeb ? { cx: staticThumb.x, cy: staticThumb.y } : null)} animatedProps={thumbProps} r={THUMB_GLOW_R} fill={brand.burnt} fillOpacity={0.16} />
            <AnimatedCircle {...(isWeb ? { cx: staticThumb.x, cy: staticThumb.y } : null)} animatedProps={thumbProps} r={THUMB_R} fill={colors.surface} stroke={brand.burnt} strokeWidth={4} />
          </Svg>

          {/* The number, then what it means. Sits inside the ring. */}
          <View style={styles.centre} pointerEvents="none">
            <View style={styles.valueRow}>
              <Text style={styles.value} testID={`${testID}-value`}>
                {value}
              </Text>
              <Text style={styles.unit}>mi</Text>
            </View>
            <Text style={[styles.caption, atMin && styles.captionFloor]} numberOfLines={3}>
              {radiusCaption(value, MIN)}
            </Text>
          </View>
        </View>
      </GestureDetector>

      {/* ± under the two ends of the arc — for a thumb that would rather tap. */}
      <View style={styles.buttons}>
        <PressableScale
          style={[styles.roundBtn, styles.minusBtn, (disabled || atMin) && styles.roundBtnOff]}
          onPress={() => bump(-1)}
          disabled={disabled || atMin}
          accessibilityRole="button"
          accessibilityLabel="One mile less"
          accessibilityState={{ disabled: disabled || atMin }}
          testID={`${testID}-minus`}
        >
          <Ionicons name="remove" size={28} color={disabled || atMin ? colors.textSubtle : brand.royalDeep} />
        </PressableScale>
        <Text style={styles.hint}>Drag the ring, or tap ±{'\n'}The circle on the map follows</Text>
        <PressableScale
          style={[styles.roundBtn, styles.plusBtn, (disabled || atMax) && styles.roundBtnOff]}
          onPress={() => bump(1)}
          disabled={disabled || atMax}
          accessibilityRole="button"
          accessibilityLabel="One mile more"
          accessibilityState={{ disabled: disabled || atMax }}
          testID={`${testID}-plus`}
        >
          <Ionicons name="add" size={28} color={disabled || atMax ? colors.textSubtle : brand.royalDeep} />
        </PressableScale>
      </View>
    </View>
  );
}

const ARC_END_X = 0.7071 * R;

const styles = StyleSheet.create({
  root: { alignSelf: 'center', width: DIAL_WIDTH },
  dial: { width: DIAL_WIDTH, height: DIAL_HEIGHT },
  centre: {
    position: 'absolute',
    left: 50,
    right: 50,
    top: CY - 40,
    alignItems: 'center',
    gap: spacing.xs,
  },
  valueRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.xs },
  value: { fontSize: fontSize.display, fontWeight: fontWeight.bold, color: colors.text, fontVariant: ['tabular-nums'], letterSpacing: -1 },
  unit: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.textMuted },
  caption: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.textMuted, textAlign: 'center', lineHeight: 17 },
  captionFloor: { color: colors.warn },
  buttons: { height: touchTarget.standard, marginTop: -spacing.sm, justifyContent: 'center' },
  roundBtn: {
    position: 'absolute',
    top: 0,
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  roundBtnOff: { backgroundColor: colors.fillDisabled },
  minusBtn: { left: CX - ARC_END_X - touchTarget.standard / 2 },
  plusBtn: { left: CX + ARC_END_X - touchTarget.standard / 2 },
  hint: {
    alignSelf: 'center',
    maxWidth: 120,
    textAlign: 'center',
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    lineHeight: 14,
  },
});
