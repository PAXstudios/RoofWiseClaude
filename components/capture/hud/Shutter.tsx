// The shutter — the one control a gloved thumb must never miss. 88pt (the
// sticky-CTA size, Drift #1), a white ring around a white core, centred in
// the thumb zone.
//
// Tap → capture. Long-press → "hold to steady": the screen forces the level
// guide on and the ring takes the level's tint; letting go fires the capture
// (a two-stage shutter, like half-pressing a camera). Burst was considered
// and rejected: three back-to-back full-res captures + three image
// manipulations is the exact memory shape that produced the Expo Go OOM
// aborts in PROMPT_LOG #23/#24, and each frame is a Gemini call.
//
// Worklet safety: the press spring reads one number and is wrapped so a
// throw on the UI runtime records to Diagnostics instead of aborting the
// process (PROMPT_LOG #63). `static` renders a plain View — no worklet.

import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { colors, motion, radii, touchTarget } from '@/theme/tokens';

const RING = touchTarget.sticky;
const RING_WIDTH = 5;
const CORE = RING - 22;
const CORE_BUSY = CORE - 20;
const PRESSED_SCALE = 0.9;

type Props = {
  onCapture: () => void;
  /** Long-press began — the screen shows the level. */
  onSteadyStart?: () => void;
  /** Finger lifted after a long-press — the screen captures. */
  onSteadyEnd?: () => void;
  /** A capture is in flight. */
  busy: boolean;
  disabled?: boolean;
  /** Holding to steady right now. */
  steadying?: boolean;
  /** Level verdict while steadying: true square, false off, null unknown. */
  levelOk?: boolean | null;
  /** No worklets (crash-safety session or Reduce Motion). */
  static?: boolean;
};

export function Shutter({
  onCapture,
  onSteadyStart,
  onSteadyEnd,
  busy,
  disabled = false,
  steadying = false,
  levelOk = null,
  static: isStatic = false,
}: Props) {
  const scale = useSharedValue(1);

  const anim = useAnimatedStyle(() => {
    try {
      const raw = scale.value;
      const s = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
      return { transform: [{ scale: s }] };
    } catch (error) {
      reportWorkletError(error, 'capture.Shutter');
      return { transform: [{ scale: 1 }] };
    }
  });

  const ringTint = steadying
    ? levelOk === true
      ? colors.success
      : levelOk === false
      ? colors.warn
      : colors.textInverse
    : colors.textInverse;

  const label = busy
    ? 'Capturing photo'
    : steadying
    ? 'Hold steady. Let go to capture.'
    : 'Capture photo. Hold to steady with the level first.';

  const content = (
    <View style={[styles.ring, { borderColor: ringTint }, busy && styles.ringBusy]}>
      <View style={[styles.core, busy && styles.coreBusy]} />
    </View>
  );

  return (
    <Pressable
      onPress={onCapture}
      onLongPress={onSteadyStart}
      delayLongPress={350}
      onPressIn={() => {
        if (!isStatic) scale.value = withSpring(PRESSED_SCALE, motion.snappy);
      }}
      onPressOut={() => {
        if (!isStatic) scale.value = withSpring(1, motion.snappy);
        if (steadying) onSteadyEnd?.();
      }}
      disabled={disabled || busy}
      style={styles.hit}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: disabled || busy, busy }}
    >
      {isStatic ? content : <Animated.View style={anim}>{content}</Animated.View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: { width: RING, height: RING, alignItems: 'center', justifyContent: 'center' },
  ring: {
    width: RING,
    height: RING,
    borderRadius: radii.pill,
    borderWidth: RING_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'transparent',
  },
  ringBusy: { opacity: 0.6 },
  core: { width: CORE, height: CORE, borderRadius: radii.pill, backgroundColor: colors.surface },
  // Busy: the core pulls in to a rounded square — the "recording" glyph
  // every camera uses for "the shutter is doing something".
  coreBusy: { width: CORE_BUSY, height: CORE_BUSY, borderRadius: radii.md },
});
