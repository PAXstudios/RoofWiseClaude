// The last-shot thumbnail — the Pixel/iOS gateway to review. 64pt, bottom
// left of the shutter. Carries the count badge and the analysis state of the
// session in one glance: a pulsing ring while photos analyse, a red ring
// with "!" when one failed, a green tick when everything is done. Tap →
// the review drawer.
//
// The ring pulse is one opacity loop on a shared value, guarded like every
// worklet on this screen; `static` draws a steady ring instead.

import { useEffect } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { colors, fontSize, fontWeight, glass, motion, radii, spacing, touchTarget } from '@/theme/tokens';

export type ThumbState = 'empty' | 'queued' | 'analyzing' | 'done' | 'failed' | 'no_ai';

type Props = {
  /** Most recent photo, or null before the first. */
  uri: string | null;
  count: number;
  state: ThumbState;
  /** How many photos failed analysis (the badge says so). */
  failedCount?: number;
  /** A library import in flight — shown as progress on the tile. */
  importing?: { done: number; total?: number } | null;
  onPress: () => void;
  static?: boolean;
};

const SIZE = touchTarget.preferred;

export function ShotThumb({
  uri,
  count,
  state,
  failedCount = 0,
  importing = null,
  onPress,
  static: isStatic = false,
}: Props) {
  const pulse = useSharedValue(1);
  const pulsing = state === 'analyzing' && !isStatic;

  useEffect(() => {
    if (!pulsing) {
      cancelAnimation(pulse);
      pulse.value = 1;
      return;
    }
    pulse.value = withRepeat(
      withTiming(0.35, { duration: motion.pulseMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
    return () => cancelAnimation(pulse);
  }, [pulsing, pulse]);

  const ringAnim = useAnimatedStyle(() => {
    try {
      const raw = pulse.value;
      return { opacity: typeof raw === 'number' && Number.isFinite(raw) ? raw : 1 };
    } catch (error) {
      reportWorkletError(error, 'capture.ShotThumb');
      return { opacity: 1 };
    }
  });

  const ringColor =
    state === 'failed'
      ? colors.danger
      : state === 'analyzing'
      ? colors.info
      : state === 'done'
      ? colors.success
      : state === 'no_ai'
      ? colors.warn
      : colors.textInverse;

  const stateWord =
    state === 'analyzing'
      ? 'analyzing'
      : state === 'failed'
      ? `${failedCount || 1} failed`
      : state === 'done'
      ? 'all analyzed'
      : state === 'queued'
      ? 'queued'
      : state === 'no_ai'
      ? 'saved without AI'
      : '';

  const a11y = importing
    ? `Importing${importing.total ? ` ${importing.done} of ${importing.total}` : `, ${importing.done} so far`}.`
    : count === 0
    ? 'No photos yet. Photos you take show here — tap to review them.'
    : `Review ${count} photo${count === 1 ? '' : 's'}${stateWord ? `, ${stateWord}` : ''}. Tap to open.`;

  const ring = (
    <View
      style={[
        styles.ring,
        { borderColor: ringColor },
        state === 'empty' && !importing && styles.ringEmpty,
      ]}
    />
  );

  return (
    <Pressable
      onPress={onPress}
      disabled={count === 0 && !importing}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed]}
      accessibilityRole="button"
      accessibilityLabel={a11y}
    >
      <View style={styles.tile}>
        {uri ? (
          <Image source={{ uri }} style={styles.image} />
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="images-outline" size={22} color={colors.textInverse} />
          </View>
        )}
        {importing && (
          <View style={styles.importOverlay}>
            <Text style={styles.importText} numberOfLines={1}>
              {importing.total ? `${importing.done}/${importing.total}` : `+${importing.done}`}
            </Text>
          </View>
        )}
        {state === 'failed' && !importing && (
          <View style={[styles.stateDot, { backgroundColor: colors.danger }]}>
            <Ionicons name="alert" size={12} color={colors.textInverse} />
          </View>
        )}
        {state === 'done' && !importing && (
          <View style={[styles.stateDot, { backgroundColor: colors.success }]}>
            <Ionicons name="checkmark" size={12} color={colors.textInverse} />
          </View>
        )}
      </View>
      {isStatic || !pulsing ? ring : <Animated.View style={[StyleSheet.absoluteFill, ringAnim]}>{ring}</Animated.View>}
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 99 ? '99+' : count}</Text>
        </View>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: SIZE, height: SIZE },
  pressed: { opacity: 0.8 },
  tile: {
    width: SIZE,
    height: SIZE,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: glass.smokeFill,
  },
  image: { width: '100%', height: '100%' },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', opacity: 0.7 },
  ring: {
    ...StyleSheet.absoluteFill,
    borderRadius: radii.md,
    borderWidth: 2.5,
  },
  ringEmpty: { borderColor: glass.smokeBorder, borderStyle: 'dashed' },
  importOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  importText: { color: colors.textInverse, fontSize: fontSize.bodyMd, fontWeight: fontWeight.bold },
  stateDot: {
    position: 'absolute',
    left: 4,
    bottom: 4,
    width: 20,
    height: 20,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: colors.textInverse,
  },
  badge: {
    position: 'absolute',
    top: -spacing.sm,
    right: -spacing.sm,
    minWidth: 24,
    height: 24,
    paddingHorizontal: spacing.xs + 2,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.textInverse,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});
