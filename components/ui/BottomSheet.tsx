// The app's bottom sheet — the "pop-up" the owner asked for, everywhere one
// is applicable.
//
// iOS-style: a white card slides up on the snappy spring while the screen
// behind dims, a grabber sits at the top, a Cancel sits top-left, and a drag
// down (or a tap on the dim) dismisses it. Reduced-motion collapses the spring
// to a plain cut. Every sheet in the app should be this component, so they
// all move the same way.
//
// Worklet safety (the owner's Expo Go SIGABRT class): the animated styles read
// only numeric shared values and call nothing else; the dismiss callback
// crosses to JS with runOnJS.

import { useEffect, type ReactNode } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { colors, fontFamily, fontSize, fontWeight, motion, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Big title, like "Add Photos To…". */
  title?: string;
  /** One line under the title. */
  subtitle?: string;
  /** Show the top-left Cancel. Default true. */
  cancel?: boolean;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
  /** Spoken name for the sheet. */
  accessibilityLabel?: string;
};

/** Dragging further than this (pt) or flicking faster than this dismisses. */
const DISMISS_DISTANCE = 96;
const DISMISS_VELOCITY = 900;
/** Where the sheet starts before it springs up — off the bottom of the screen. */
const OFFSCREEN = 900;

export function BottomSheet({
  visible,
  onClose,
  title,
  subtitle,
  cancel = true,
  children,
  style,
  accessibilityLabel,
}: Props) {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();
  const y = useSharedValue(OFFSCREEN);
  const dim = useSharedValue(0);

  useEffect(() => {
    if (visible) {
      y.value = reduced ? 0 : withSpring(0, motion.snappy);
      dim.value = reduced ? 1 : withTiming(1, { duration: motion.enterMs });
    } else {
      y.value = OFFSCREEN;
      dim.value = 0;
    }
  }, [visible, reduced, y, dim]);

  const close = () => {
    if (reduced) {
      onClose();
      return;
    }
    dim.value = withTiming(0, { duration: motion.sceneExitMs });
    y.value = withTiming(OFFSCREEN, { duration: motion.sceneExitMs }, (done) => {
      if (done) runOnJS(onClose)();
    });
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      // Follow the finger down; never let it drag the sheet above its rest.
      y.value = e.translationY > 0 ? e.translationY : 0;
    })
    .onEnd((e) => {
      if (e.translationY > DISMISS_DISTANCE || e.velocityY > DISMISS_VELOCITY) {
        y.value = withTiming(OFFSCREEN, { duration: motion.sceneExitMs }, (done) => {
          if (done) runOnJS(onClose)();
        });
        dim.value = withTiming(0, { duration: motion.sceneExitMs });
      } else {
        y.value = withSpring(0, motion.snappy);
      }
    });

  const sheetStyle = useAnimatedStyle(() => {
    const v = y.value;
    return { transform: [{ translateY: typeof v === 'number' && Number.isFinite(v) ? v : 0 }] };
  });
  const dimStyle = useAnimatedStyle(() => {
    const v = dim.value;
    return { opacity: typeof v === 'number' && Number.isFinite(v) ? v : 1 };
  });

  return (
    <Modal visible={visible} transparent statusBarTranslucent onRequestClose={close}>
      <View style={styles.root}>
        <Animated.View style={[styles.dim, dimStyle]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={close} accessibilityLabel="Dismiss" />
        </Animated.View>
        <Animated.View
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }, sheetStyle, style]}
          accessibilityViewIsModal
          accessibilityLabel={accessibilityLabel ?? title}
        >
          {/* The header is the drag handle; the body scrolls. A sheet taller
              than the screen (eleven Quick Action tiles on an SE) used to
              push its last rows off the bottom with no way to reach them. */}
          <GestureDetector gesture={pan}>
            <View style={styles.handle}>
              <View style={styles.grabberRow}>
                <View style={styles.grabber} />
              </View>
              {cancel && (
                <Pressable
                  onPress={close}
                  style={styles.cancel}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel="Cancel"
                >
                  <Text style={styles.cancelText}>Cancel</Text>
                </Pressable>
              )}
              {(title || subtitle) && (
                <View style={styles.head}>
                  {title && <Text style={styles.title}>{title}</Text>}
                  {subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
                </View>
              )}
            </View>
          </GestureDetector>
          <ScrollView
            style={styles.body}
            contentContainerStyle={styles.bodyContent}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            nestedScrollEnabled
          >
            {children}
          </ScrollView>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, justifyContent: 'flex-end' },
  dim: { ...StyleSheet.absoluteFill, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.xl,
    gap: spacing.md,
    maxHeight: '88%',
  },
  handle: { gap: spacing.md },
  body: { flexGrow: 0 },
  bodyContent: { gap: spacing.md, paddingBottom: spacing.xs },
  grabberRow: { alignItems: 'center', paddingTop: spacing.sm },
  grabber: { width: 44, height: 5, borderRadius: 3, backgroundColor: colors.fillQuiet },
  // 56pt so a gloved thumb cancels without hunting (Drift #1).
  cancel: { minHeight: touchTarget.standard, justifyContent: 'center', alignSelf: 'flex-start' },
  cancelText: {
    color: colors.accent,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    fontFamily: fontFamily.archivo.medium,
  },
  head: { gap: spacing.xs },
  title: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.brand,
  },
  subtitle: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    lineHeight: 21,
  },
});
