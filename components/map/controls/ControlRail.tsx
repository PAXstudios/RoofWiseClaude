// The collapsible control rail — a vertical stack of round glass buttons in
// the map's top-right corner (Apple Maps' cluster, Google Maps' layer
// button), topped by a chevron that tucks the whole stack away.
//
//   expanded  → chevron-up + every button, 12pt apart (Drift #1 spacing)
//   tucked    → the chevron alone; the map is clean
//   hidden    → nothing — the screen passes this while its bottom drawer is
//               raised (Google Maps' FABs leave as the sheet comes up), so a
//               button is never half-buried under the panel. Transient: it
//               does not touch the remembered `tucked` preference.
//
// The screen decides WHEN to tuck (a hand pan of the map — see
// `useMapPanTuck` below — or the chevron) and remembers it per screen in
// lib/stores/mapChromeStore.ts. The rail only animates the transition: an
// 8pt rise + fade on the snappy spring, or a plain cut when `animated` is
// false (the map screens' safety mode — no worklets on that screen's chrome
// after a UI-thread crash) or Reduce Motion is on.
//
// Worklet safety: the animated styles read one numeric shared value each
// inside a try/catch and fall back to the resting style
// (lib/services/uiRuntimeGuard).

import { useCallback, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, type GestureResponderEvent, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { motion, spacing } from '@/theme/tokens';
import { RailButton, type RailButtonProps } from './RailButton';

export type RailItem = RailButtonProps & { key: string };

type Props = {
  items: RailItem[];
  tucked: boolean;
  onTuckedChange: (tucked: boolean) => void;
  /** Leave the screen entirely (drawer raised). Default false. */
  hidden?: boolean;
  /** False → no Reanimated on this rail at all (safety mode). Default true. */
  animated?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

/** Rise distance, captured as a NUMBER for the worklet. */
const RISE_PX = spacing.sm;

function clamp01(raw: unknown): number {
  'worklet';
  return typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
}

/**
 * Drive a 0→1 presence value from a boolean: mounts before the entrance,
 * fades before unmounting (so nothing invisible is left to trip a screen
 * reader or a stray tap). `cut` makes both directions instant.
 */
function usePresence(present: boolean, cut: boolean) {
  const [mounted, setMounted] = useState(present);
  const progress = useSharedValue(present ? 1 : 0);
  useEffect(() => {
    if (cut) {
      // No shared-value write at all: the animated style is not applied in
      // cut mode, so nothing should reach the UI runtime (safety mode).
      setMounted(present);
      return;
    }
    if (present) {
      setMounted(true);
      progress.value = withSpring(1, motion.snappy);
    } else {
      progress.value = withTiming(0, { duration: motion.sceneExitMs }, (done) => {
        if (done) runOnJS(setMounted)(false);
      });
    }
  }, [present, cut, progress]);
  return { mounted, progress };
}

export function ControlRail({
  items,
  tucked,
  onTuckedChange,
  hidden = false,
  animated = true,
  testID,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const cut = !animated || reduced;

  const rail = usePresence(!hidden, cut);
  const stack = usePresence(!tucked, cut);

  const railStyle = useAnimatedStyle(() => {
    try {
      return { opacity: clamp01(rail.progress.value) };
    } catch (error) {
      reportWorkletError(error, 'ControlRail.rail');
      return { opacity: 1 };
    }
  });
  const stackStyle = useAnimatedStyle(() => {
    try {
      const p = clamp01(stack.progress.value);
      return { opacity: p, transform: [{ translateY: (1 - p) * -RISE_PX }] };
    } catch (error) {
      reportWorkletError(error, 'ControlRail.stack');
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
  });

  const toggle = useCallback(() => onTuckedChange(!tucked), [onTuckedChange, tucked]);

  if (!rail.mounted) return null;

  const buttons = stack.mounted ? (
    <View
      style={styles.stack}
      pointerEvents={tucked ? 'none' : 'auto'}
      testID={testID ? `${testID}-stack` : undefined}
    >
      {items.map(({ key, ...item }) => (
        <RailButton key={key} {...item} />
      ))}
    </View>
  ) : null;

  const body = (
    <>
      <RailButton
        icon={tucked ? 'chevron-down' : 'chevron-up'}
        label={tucked ? 'Show map controls' : 'Hide map controls'}
        onPress={toggle}
        testID={testID ? `${testID}-tuck` : undefined}
      />
      {cut ? buttons : <Animated.View style={stackStyle} pointerEvents="box-none">{buttons}</Animated.View>}
    </>
  );

  const events = hidden ? 'none' : 'box-none';
  return cut ? (
    <View style={[styles.rail, style]} pointerEvents={events} testID={testID}>
      {body}
    </View>
  ) : (
    <Animated.View style={[styles.rail, style, railStyle]} pointerEvents={events} testID={testID}>
      {body}
    </Animated.View>
  );
}

/**
 * Tuck the rail when the roofer pans the map by hand — the Apple Maps rule
 * that chrome gets out of the way the moment the map is being used.
 *
 * Two signals, because the unified Map exposes only `onRegionChangeComplete`:
 *   1. a touch that MOVES over the map wrapper (`onTouchMove`, immediate);
 *   2. a settled region change that was not one of ours — the screen calls
 *      `markAutoMove()` right before every `animateToRegion`, and any settle
 *      inside the grace window after that is ignored. The map's own first
 *      settle after mount (it reports its initial region) is ignored too.
 * A plain tap (no movement) never tucks, so a pin tap keeps the rail.
 */
export function useMapPanTuck(tucked: boolean, setTucked: (t: boolean) => void, graceMs = 1500) {
  const lastAutoMoveAt = useRef(0);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const settles = useRef(0);
  const mountedAt = useRef(Date.now());
  const tuckedRef = useRef(tucked);
  tuckedRef.current = tucked;

  const tuck = useCallback(() => {
    if (!tuckedRef.current) setTucked(true);
  }, [setTucked]);

  const markAutoMove = useCallback(() => {
    lastAutoMoveAt.current = Date.now();
  }, []);

  /** True when a region settle came from our own camera move, not a hand. */
  const isAutoMove = useCallback(() => Date.now() - lastAutoMoveAt.current < graceMs, [graceMs]);

  const onTouchStart = useCallback((e: GestureResponderEvent) => {
    touchStart.current = { x: e.nativeEvent.pageX, y: e.nativeEvent.pageY };
  }, []);
  const onTouchMove = useCallback(
    (e: GestureResponderEvent) => {
      const s = touchStart.current;
      if (!s) return;
      const dx = e.nativeEvent.pageX - s.x;
      const dy = e.nativeEvent.pageY - s.y;
      if (dx * dx + dy * dy > PAN_THRESHOLD_PX * PAN_THRESHOLD_PX) {
        touchStart.current = null;
        tuck();
      }
    },
    [tuck],
  );
  const onTouchEnd = useCallback(() => {
    touchStart.current = null;
  }, []);

  /** Wire this into `onRegionChangeComplete` after the screen's own handling. */
  const onUserRegionSettled = useCallback(() => {
    settles.current += 1;
    // The native map's initial-region report arrives once, shortly after
    // mount, and is nobody's pan.
    if (settles.current === 1 && Date.now() - mountedAt.current < INITIAL_SETTLE_MS) return;
    if (!isAutoMove()) tuck();
  }, [isAutoMove, tuck]);

  return { markAutoMove, isAutoMove, onTouchStart, onTouchMove, onTouchEnd, onUserRegionSettled };
}

const PAN_THRESHOLD_PX = 10;
const INITIAL_SETTLE_MS = 4000;

const styles = StyleSheet.create({
  rail: { alignItems: 'flex-end', gap: spacing.md },
  stack: { gap: spacing.md, alignItems: 'flex-end' },
});
