// The HUD host — the iOS-17-Camera idea that chrome should get out of the
// way of the viewfinder.
//
// Two layers over the camera:
//   primary    always on: close, slope pill, chevron; thumbnail, shutter,
//              Done. Passed in as `primary`.
//   secondary  the mode strip, the tool rail, the instrument cluster.
//              Fades in on the chevron or a tap on the viewfinder, fades out
//              on the next tap, on capture, and after `idleMs` with no touch
//              (unless the roofer pinned it open). Passed in as `secondary`.
//
// A full-screen Pressable UNDER both layers is the viewfinder tap target;
// the layers are `box-none`, so only real controls take a touch and every
// empty patch of roof toggles the chrome. No drag gestures on the viewfinder
// — the level guide and the pitch gauge use motion, not swipes.
//
// The fade is one opacity + a 6pt rise on a shared value, guarded like every
// worklet on this screen; `static` renders the secondary layer conditionally
// with no Animated view at all.

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { hudMotion, spacing } from '@/theme/tokens';

const RISE_PX = spacing.sm;

type Props = {
  open: boolean;
  /** A tap on bare viewfinder. */
  onViewfinderTap: () => void;
  /** The idle timeout elapsed with the chrome open. */
  onIdle: () => void;
  /** Pinned open — no idle collapse. */
  keepOpen: boolean;
  /** A sheet is up: the viewfinder does not toggle and the idle clock stops. */
  paused: boolean;
  idleMs?: number;
  static?: boolean;
  primary: ReactNode;
  secondary: ReactNode;
};

export function HudChrome({
  open,
  onViewfinderTap,
  onIdle,
  keepOpen,
  paused,
  idleMs = hudMotion.idleCollapseMs,
  static: isStatic = false,
  primary,
  secondary,
}: Props) {
  // Any touch inside the secondary layer restarts the idle clock.
  const [touchTick, setTouchTick] = useState(0);
  const onIdleRef = useRef(onIdle);
  onIdleRef.current = onIdle;

  useEffect(() => {
    if (!open || keepOpen || paused) return;
    const t = setTimeout(() => onIdleRef.current(), idleMs);
    return () => clearTimeout(t);
  }, [open, keepOpen, paused, idleMs, touchTick]);

  const progress = useSharedValue(open ? 1 : 0);
  useEffect(() => {
    if (isStatic) {
      progress.value = open ? 1 : 0;
      return;
    }
    progress.value = withTiming(open ? 1 : 0, { duration: hudMotion.chromeFadeMs });
  }, [open, isStatic, progress]);

  const fade = useAnimatedStyle(() => {
    try {
      const raw = progress.value;
      const p = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
      return { opacity: p, transform: [{ translateY: (1 - p) * -RISE_PX }] };
    } catch (error) {
      reportWorkletError(error, 'capture.HudChrome');
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
  });

  const secondaryLayer = (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents={open ? 'box-none' : 'none'}
      accessibilityElementsHidden={!open}
      importantForAccessibility={open ? 'auto' : 'no-hide-descendants'}
      // Observe every touch that starts inside the chrome without claiming it.
      onStartShouldSetResponderCapture={() => {
        setTouchTick((t) => t + 1);
        return false;
      }}
    >
      {secondary}
    </View>
  );

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onViewfinderTap}
        disabled={paused}
        accessibilityRole="button"
        accessibilityLabel={open ? 'Viewfinder. Tap to hide the controls.' : 'Viewfinder. Tap to show the controls.'}
      />
      {isStatic ? (
        open && secondaryLayer
      ) : (
        <Animated.View style={[StyleSheet.absoluteFill, fade]} pointerEvents="box-none">
          {secondaryLayer}
        </Animated.View>
      )}
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {primary}
      </View>
    </View>
  );
}
