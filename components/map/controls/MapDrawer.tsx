// The bottom drawer with detents — Apple Maps' sheet, built for a glove.
//
//   peek  → grabber + header + the sticky primary CTA: the thumb zone
//   half  → the body shows (a list, a detail card) above the CTA
//   full  → the body fills the map area
//
// The whole grabber strip is a 56pt-effective button that cycles the detents
// (no precision drag needed — Drift #1); the grabber + header also pan on the
// standard spring with a flick snapping to the next detent. The CTA slot is
// pinned to the bottom of the drawer at every detent, so the ONE primary
// action never moves under a thumb. The body scrolls on its own inside.
//
// Sizing: the drawer measures its own header and footer, so "peek" is
// exactly the chrome and nothing else; half/full are fractions of the
// container the screen measures for it (`containerHeight`). Until the first
// measurement it sizes to content — which is the peek height — so there is
// no first-frame flash.
//
// Safety mode: `animated={false}` renders NO Reanimated hooks' output and no
// gesture — heights are plain state, the grabber tap is the only detent
// control. The animated height style reads one numeric shared value inside a
// try/catch (lib/services/uiRuntimeGuard) like every worklet on these screens.

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { BlurView } from 'expo-blur';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type AnimatedStyle,
} from 'react-native-reanimated';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import type { DrawerDetent } from '@/lib/stores/mapChromeStore';
import { colors, glass, motion, radii, shadows, spacing } from '@/theme/tokens';

export type { DrawerDetent };

type Props = {
  detent: DrawerDetent;
  onDetentChange: (detent: DrawerDetent) => void;
  /** Height of the view the drawer is absolutely positioned in (the map wrap). */
  containerHeight: number;
  /** Always visible: the stat line / stats bar and its small actions. */
  header: ReactNode;
  /** Scrolls at half/full. */
  children?: ReactNode;
  /** The sticky primary CTA (88pt), pinned to the bottom at every detent. */
  footer?: ReactNode;
  /** False → no Reanimated, no gesture (safety mode). Default true. */
  animated?: boolean;
  /** Safe-area bottom on screens that own their bottom edge. */
  bottomInset?: number;
  /** Space left above the drawer at `full`. Default 16pt. */
  topInset?: number;
  /** `half` as a fraction of the container. Default 0.5. */
  halfFraction?: number;
  /** The drawer's resting height changed (per detent, JS side) — inset the map's attribution chip. */
  onHeightChange?: (height: number) => void;
  accessibilityLabel?: string;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

const HANDLE_HEIGHT = 28;
const FLICK_VELOCITY = 700;
const NEXT_DETENT: Record<DrawerDetent, DrawerDetent> = { peek: 'half', half: 'full', full: 'peek' };
const SPRING = { ...motion.standard, overshootClamping: true };

export function MapDrawer({
  detent,
  onDetentChange,
  containerHeight,
  header,
  children,
  footer,
  animated = true,
  bottomInset = 0,
  topInset = spacing.lg,
  halfFraction = 0.5,
  onHeightChange,
  accessibilityLabel = 'Map panel',
  testID,
  style,
}: Props) {
  const reduced = useReducedMotion();
  const cut = !animated || reduced;

  const [headerH, setHeaderH] = useState(0);
  const [footerH, setFooterH] = useState(0);
  const measured = headerH > 0 && (footer == null || footerH > 0);

  const bottomPad = Math.max(bottomInset, spacing.md);
  // onLayout heights INCLUDE each block's own padding (the footer carries the
  // bottom inset), so peek is the plain sum — nothing added twice.
  const peekH = HANDLE_HEIGHT + headerH + (footer != null ? footerH : bottomPad);
  const fullH = Math.max(peekH, containerHeight - topInset);
  const halfH = Math.min(fullH, Math.max(peekH, Math.round(containerHeight * halfFraction)));
  const target = detent === 'peek' ? peekH : detent === 'half' ? halfH : fullH;

  useEffect(() => {
    if (measured) onHeightChange?.(target);
  }, [measured, target, onHeightChange]);

  // Animated height. The first measured value lands without a spring so the
  // drawer never visibly grows into place; every later detent springs.
  const h = useSharedValue(target);
  const settled = useRef(false);
  useEffect(() => {
    if (!measured) return;
    if (cut) {
      // Plain state drives the height in cut mode — no shared-value write,
      // nothing reaches the UI runtime (safety mode). Re-arm the direct
      // landing for whenever animation comes back.
      settled.current = false;
      return;
    }
    if (!settled.current) {
      settled.current = true;
      h.value = target;
      return;
    }
    h.value = withSpring(target, SPRING);
  }, [measured, target, cut, h]);

  const heightStyle = useAnimatedStyle(() => {
    try {
      const v = h.value;
      return { height: typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : target };
    } catch (error) {
      reportWorkletError(error, 'MapDrawer.height');
      return { height: target };
    }
  });

  // Pan on the grabber + header. Reads and writes only numbers on the UI
  // thread; the detent name crosses to JS with runOnJS.
  const startH = useSharedValue(0);
  const pan = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetY([-8, 8])
        .onStart(() => {
          startH.value = h.value;
        })
        .onUpdate((e) => {
          const next = startH.value - e.translationY;
          h.value = Math.min(fullH, Math.max(peekH, next));
        })
        .onEnd((e) => {
          const cur = h.value;
          let name: DrawerDetent;
          if (e.velocityY < -FLICK_VELOCITY) {
            name = cur < halfH - 1 ? 'half' : 'full';
          } else if (e.velocityY > FLICK_VELOCITY) {
            name = cur > halfH + 1 ? 'half' : 'peek';
          } else {
            const dPeek = Math.abs(cur - peekH);
            const dHalf = Math.abs(cur - halfH);
            const dFull = Math.abs(cur - fullH);
            name = dPeek <= dHalf && dPeek <= dFull ? 'peek' : dHalf <= dFull ? 'half' : 'full';
          }
          const to = name === 'peek' ? peekH : name === 'half' ? halfH : fullH;
          h.value = withSpring(to, SPRING);
          runOnJS(onDetentChange)(name);
        }),
    [peekH, halfH, fullH, onDetentChange, h, startH],
  );

  const onHeaderLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (next !== headerH) setHeaderH(next);
  };
  const onFooterLayout = (e: LayoutChangeEvent) => {
    const next = Math.round(e.nativeEvent.layout.height);
    if (next !== footerH) setFooterH(next);
  };

  const cycle = () => onDetentChange(NEXT_DETENT[detent]);
  const grabLabel = detent === 'full' ? 'Collapse the panel' : detent === 'half' ? 'Expand the panel fully' : 'Expand the panel';

  const grab = (
    <View>
      {/* 28pt strip + hitSlop = a 56pt-effective full-width target. */}
      <Pressable
        onPress={cycle}
        hitSlop={{ top: 14, bottom: 14 }}
        style={styles.handleRow}
        accessibilityRole="button"
        accessibilityLabel={grabLabel}
        accessibilityHint="Cycles the panel between peek, half and full"
        testID={testID ? `${testID}-handle` : undefined}
      >
        <View style={styles.grabber} />
      </Pressable>
      <View onLayout={onHeaderLayout} style={styles.header}>
        {header}
      </View>
    </View>
  );

  // Unmeasured → size to content (== peek). Static → plain height.
  // Reanimated 4's `useAnimatedStyle` returns an opaque `AnimatedStyleHandle`,
  // not a plain style object, so this union no longer fits `StyleProp<ViewStyle>`
  // on its own — `cut` ties it 1:1 with which `Container` renders below, but
  // TS can't correlate two separately-computed ternaries, hence the cast.
  const sizing: StyleProp<ViewStyle> | AnimatedStyle<ViewStyle> =
    !measured ? undefined : cut ? { height: target } : heightStyle;
  // Cast to Animated.View's type (its `style` prop accepts both plain and
  // animated styles) even on the `cut` branch, where this is really a plain
  // `View` — safe, since a plain style is exactly what a plain `View` expects.
  const Container = (cut ? View : Animated.View) as typeof Animated.View;

  return (
    <Container
      style={[styles.shadow, sizing, style]}
      accessibilityLabel={accessibilityLabel}
      testID={testID}
    >
      <View style={styles.surface}>
        {Platform.OS === 'ios' ? (
          <BlurView intensity={28} tint="light" style={StyleSheet.absoluteFill} />
        ) : null}
        <View style={styles.fill} />
        {cut ? grab : <GestureDetector gesture={pan}>{grab}</GestureDetector>}
        <ScrollView
          style={styles.body}
          contentContainerStyle={styles.bodyContent}
          scrollEnabled={detent !== 'peek'}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          nestedScrollEnabled
          testID={testID ? `${testID}-body` : undefined}
        >
          {children}
        </ScrollView>
        {footer != null ? (
          <View onLayout={onFooterLayout} style={[styles.footer, { paddingBottom: bottomPad }]}>
            {footer}
          </View>
        ) : (
          <View style={{ height: bottomPad }} />
        )}
      </View>
    </Container>
  );
}

const styles = StyleSheet.create({
  // Shadow on the outer (a clipping view cannot cast on iOS); the surface clips.
  shadow: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    ...shadows.raised,
  },
  surface: {
    flex: 1,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    overflow: 'hidden',
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: glass.frostBorder,
  },
  // Sun-readable ground behind everything in the drawer (barFill is the
  // tab-bar white; the iOS blur beneath makes it glass, elsewhere it stands alone).
  fill: { ...StyleSheet.absoluteFill, backgroundColor: colors.barFill },
  handleRow: { height: HANDLE_HEIGHT, alignItems: 'center', justifyContent: 'center' },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.borderStrong },
  header: { paddingHorizontal: spacing.lg, paddingBottom: spacing.sm },
  body: { flex: 1 },
  bodyContent: { paddingHorizontal: spacing.lg, paddingTop: spacing.xs, paddingBottom: spacing.md, gap: spacing.sm },
  footer: { paddingHorizontal: spacing.lg, paddingTop: spacing.sm },
});
