import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { colors, glass, motion, radii } from '@/theme/tokens';
import { CHIP_TONES, type ChipTone } from './IconChip';

/** Tile hues (share the colour with the row's IconChip) plus the semantics. */
export type ProgressTone = ChipTone | 'brand' | 'accent' | 'success' | 'warn' | 'danger';

const FILL: Record<ProgressTone, string> = {
  blue: CHIP_TONES.blue.fg,
  green: CHIP_TONES.green.fg,
  orange: CHIP_TONES.orange.fg,
  purple: CHIP_TONES.purple.fg,
  quiet: colors.textSubtle,
  brand: colors.brand,
  accent: colors.accent,
  success: colors.success,
  warn: colors.warn,
  danger: colors.danger,
};

type Props = {
  /** 0..1. Values outside the range are clamped, never wrapped. */
  progress: number;
  /** Default `brand`. Match the row's IconChip tone to bind the two together. */
  tone?: ProgressTone;
  /** Track thickness. Default 8. */
  height?: number;
  /** Track colour override. Defaults to the light track, or glass when `onDark`. */
  trackColor?: string;
  /** Sitting on a hero/dark ground rather than a white card. */
  onDark?: boolean;
  /** Spoken description ("Contacted, 4 of 11 leads"). */
  accessibilityLabel?: string;
  style?: StyleProp<ViewStyle>;
};

// Called from inside useAnimatedStyle, i.e. on the UI thread. Without the
// 'worklet' directive Reanimated 4 throws "Tried to synchronously call a
// non-worklet function on the UI thread" — and on a device that throw is not
// catchable: it escapes worklets::UIScheduler::triggerUI as a C++ exception
// and aborts the process (the owner's Expo Go crash log, 2026-09-02).
function clamp01(n: number): number {
  'worklet';
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}

/**
 * Token-coloured track with a fill that springs to its value.
 *
 * The spring is the point: a bar that snaps to width reads as a static
 * graphic, while one that settles reads as a measurement being taken. Width
 * is animated as a percentage — the same pattern `DamageScoreBar` already
 * ships on web — so this works identically in the web export.
 */
export function ProgressBar({
  progress,
  tone = 'brand',
  height = 8,
  trackColor,
  onDark = false,
  accessibilityLabel,
  style,
}: Props) {
  const target = clamp01(progress);
  const p = useSharedValue(0);

  useEffect(() => {
    p.value = withSpring(target, motion.snappy);
  }, [target, p]);

  const fillStyle = useAnimatedStyle(() => ({
    width: `${clamp01(p.value) * 100}%`,
  }));

  return (
    <View
      accessibilityRole="progressbar"
      accessibilityLabel={accessibilityLabel}
      accessibilityValue={{ min: 0, max: 100, now: Math.round(target * 100) }}
      style={[
        styles.track,
        {
          height,
          borderRadius: radii.pill,
          backgroundColor: trackColor ?? (onDark ? glass.fill : colors.fillQuiet),
        },
        style,
      ]}
    >
      <Animated.View
        style={[
          styles.fill,
          { height, borderRadius: radii.pill, backgroundColor: FILL[tone] },
          fillStyle,
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  track: { overflow: 'hidden', width: '100%' },
  fill: { position: 'absolute', left: 0, top: 0 },
});
