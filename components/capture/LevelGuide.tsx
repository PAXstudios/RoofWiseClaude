// Live capture guides for the Quick Inspection viewfinder:
//   - `useThrottledMotion` — one ~10 Hz DeviceMotion subscription the screen
//     owns and hands to every consumer (LevelGuide, CameraHUD), so the camera
//     screen never runs two sensor streams fighting over the global interval.
//   - `LevelGuide` — a bullseye level that turns green when the phone is
//     square to the roof plane (within LEVEL_TOLERANCE_DEG of the slope's
//     pitch when it is known, else of horizontal) and level side-to-side.
//   - `ThirdsGrid` — rule-of-thirds hairlines.
//
// All of it is presentational: nothing here writes to a store or a photo.

import { useEffect, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { DeviceMotion } from 'expo-sensors';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type { MotionSample } from '@/lib/services/deviceMotion';
import { colors, fontFamily, fontSize, fontWeight, glass, motion, radii, spacing } from '@/theme/tokens';

/** ~10 Hz — plenty for a level, a tenth of the pitch gauge's 30 Hz. */
const MOTION_INTERVAL_MS = 100;

/** "Square to the roof" tolerance, in degrees, on both axes. */
export const LEVEL_TOLERANCE_DEG = 8;
/** Beyond this the bubble reads amber-then-red instead of just "off". */
const LEVEL_WARN_DEG = 20;

const RING = 104;
const BUBBLE = 22;
/** Bubble travel per degree of error, clamped to the ring. */
const PX_PER_DEG = 2;
const MAX_TRAVEL = (RING - BUBBLE) / 2 - 6;

/**
 * Throttled DeviceMotion sample, or null when inactive, unavailable, or on
 * web (no sensors in the browser export). Subscribes only while `active` —
 * the screen passes focus × app-state so the stream stops on blur.
 */
export function useThrottledMotion(active: boolean): MotionSample | null {
  const [sample, setSample] = useState<MotionSample | null>(null);

  useEffect(() => {
    if (!active || Platform.OS === 'web') {
      setSample(null);
      return;
    }
    let mounted = true;
    let sub: { remove: () => void } | null = null;

    (async () => {
      try {
        const available = await DeviceMotion.isAvailableAsync();
        if (!available || !mounted) return;
        DeviceMotion.setUpdateInterval(MOTION_INTERVAL_MS);
        sub = DeviceMotion.addListener(({ rotation }) => {
          if (!mounted || !rotation) return;
          setSample({
            pitchDegrees: Math.abs((rotation.beta * 180) / Math.PI),
            rollDegrees: (rotation.gamma * 180) / Math.PI,
            yawDegrees: ((rotation.alpha * 180) / Math.PI + 360) % 360,
          });
        });
      } catch {
        // No motion sensors (or the module refused) — the guide simply hides.
      }
    })();

    return () => {
      mounted = false;
      sub?.remove();
    };
  }, [active]);

  return sample;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

type LevelProps = {
  motion: MotionSample | null;
  /**
   * Pitch of the slope being shot, in degrees, when the job knows it. The
   * camera is square to the roof when the phone is tilted by the same amount
   * — so this is the target the level is measured against. Undefined means
   * "aim for horizontal" (a flat deck, or a slope nobody has measured yet).
   */
  targetPitchDegrees?: number;
  /** Skip the spring on the bubble (system Reduce Motion). */
  reducedMotion?: boolean;
};

/**
 * Bullseye level. Green ring + "Square to roof" when both axes are within
 * tolerance; amber / red as the error grows, with a one-line instruction a
 * roofer can act on without reading numbers.
 */
export function LevelGuide({ motion: sample, targetPitchDegrees, reducedMotion }: LevelProps) {
  const bx = useSharedValue(0);
  const by = useSharedValue(0);

  const target = targetPitchDegrees ?? 0;
  const roll = sample?.rollDegrees ?? 0;
  const pitchErr = (sample?.pitchDegrees ?? 0) - target;

  useEffect(() => {
    const x = clamp(roll * PX_PER_DEG, -MAX_TRAVEL, MAX_TRAVEL);
    // Bubble rises when the top of the phone is tilted up past the target —
    // the way a real bubble level reads.
    const y = clamp(-pitchErr * PX_PER_DEG, -MAX_TRAVEL, MAX_TRAVEL);
    if (reducedMotion) {
      bx.value = x;
      by.value = y;
    } else {
      bx.value = withSpring(x, motion.quick);
      by.value = withSpring(y, motion.quick);
    }
  }, [roll, pitchErr, reducedMotion, bx, by]);

  const bubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: bx.value }, { translateY: by.value }],
  }));

  if (!sample) return null;

  const worst = Math.max(Math.abs(roll), Math.abs(pitchErr));
  const tint =
    worst <= LEVEL_TOLERANCE_DEG
      ? colors.success
      : worst <= LEVEL_WARN_DEG
      ? colors.warn
      : colors.danger;

  const caption = captionFor(roll, pitchErr, targetPitchDegrees);

  return (
    <View style={styles.wrap} pointerEvents="none">
      <View style={[styles.ring, { borderColor: tint }]}>
        <View style={styles.crossH} />
        <View style={styles.crossV} />
        <View style={[styles.target, { borderColor: tint }]} />
        <Animated.View style={[styles.bubble, { backgroundColor: tint }, bubbleStyle]} />
      </View>
      <View style={[styles.captionPill, { borderColor: tint }]}>
        <Text style={[styles.caption, { color: tint }]} numberOfLines={1}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

function captionFor(roll: number, pitchErr: number, target: number | undefined): string {
  const rollOk = Math.abs(roll) <= LEVEL_TOLERANCE_DEG;
  const pitchOk = Math.abs(pitchErr) <= LEVEL_TOLERANCE_DEG;
  if (rollOk && pitchOk) return target === undefined ? 'Level' : 'Square to roof';
  // One instruction at a time — fix the bigger error first.
  if (!pitchOk && (rollOk || Math.abs(pitchErr) >= Math.abs(roll))) {
    const deg = Math.round(Math.abs(pitchErr));
    return pitchErr > 0 ? `Tilt down ${deg}°` : `Tilt up ${deg}°`;
  }
  // Positive roll = right side dipped (the HUD's ↘ convention).
  const deg = Math.round(Math.abs(roll));
  return roll > 0 ? `Raise right side ${deg}°` : `Raise left side ${deg}°`;
}

/** Rule-of-thirds hairlines over the viewfinder. */
export function ThirdsGrid() {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <View style={[styles.gridLineV, { left: '33.33%' }]} />
      <View style={[styles.gridLineV, { left: '66.66%' }]} />
      <View style={[styles.gridLineH, { top: '33.33%' }]} />
      <View style={[styles.gridLineH, { top: '66.66%' }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ring: {
    width: RING,
    height: RING,
    borderRadius: radii.pill,
    borderWidth: 3,
    backgroundColor: glass.smokeFill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  crossH: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.textInverse,
    opacity: 0.5,
  },
  crossV: {
    position: 'absolute',
    top: spacing.md,
    bottom: spacing.md,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.textInverse,
    opacity: 0.5,
  },
  target: {
    position: 'absolute',
    width: BUBBLE + spacing.md,
    height: BUBBLE + spacing.md,
    borderRadius: radii.pill,
    borderWidth: 2,
    opacity: 0.7,
  },
  bubble: {
    width: BUBBLE,
    height: BUBBLE,
    borderRadius: radii.pill,
  },
  captionPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    backgroundColor: glass.smokeFill,
  },
  caption: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: colors.textInverse,
    opacity: 0.45,
  },
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.textInverse,
    opacity: 0.45,
  },
});
