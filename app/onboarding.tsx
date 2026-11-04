import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  FadeIn,
  FadeInDown,
  useReducedMotion,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { RoofWiseBrand } from '@/components/ui/RoofWiseBrand';
import { useAuthStore } from '@/lib/auth/authStore';
import { env } from '@/lib/env';
import { MeshBackground } from '@/components/ui/MeshBackground';
import {
  PacketScene,
  ONBOARDING_SCENE_SIZE,
  ScanScene,
  StormScene,
  VerdictScene,
  type SceneProps,
} from '@/components/onboarding/scenes';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Scene = {
  key: string;
  eyebrow: string;
  title: string;
  body: string;
  Illustration: (p: SceneProps) => React.JSX.Element;
};

const SCENES: Scene[] = [
  {
    key: 'storm',
    eyebrow: '1 of 4 · Storm reports',
    title: 'Find storm-affected roofs',
    body: 'Check reported hail and wind near your service area before planning a visit.',
    Illustration: StormScene,
  },
  {
    key: 'scan',
    eyebrow: '2 of 4 · Inspection',
    title: 'Photograph each slope',
    body: 'Frame the test square, photograph the shingles, and review the damage marked in each image.',
    Illustration: ScanScene,
  },
  {
    key: 'verdict',
    eyebrow: '3 of 4 · Assessment',
    title: 'Review the findings',
    body: 'Compare confirmed hits with the threshold for the roof material. The example shows an architectural asphalt test square.',
    Illustration: VerdictScene,
  },
  {
    key: 'packet',
    eyebrow: '4 of 4 · Report',
    title: 'Assemble the roof report',
    body: 'Bring the slope photos, measurements and reviewed findings into one report for the property.',
    Illustration: PacketScene,
  },
];

export default function Onboarding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const complete = useOnboardingStore((s) => s.complete);
  const session = useAuthStore((s) => s.session);
  const previouslyCompleted = useOnboardingStore((s) => s.completed);
  const reducedMotion = useReducedMotion();
  const listRef = useRef<FlatList<Scene>>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SCENES.length - 1;

  const leave = useCallback(() => {
    complete();
    if (session || (previouslyCompleted && !env.REQUIRE_AUTH)) {
      router.dismissTo('/(tabs)');
    } else {
      router.replace('/welcome');
    }
  }, [complete, previouslyCompleted, router, session]);

  const enterWorkspace = () => {
    complete();
    router.dismissTo('/(tabs)');
  };

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const next = Math.round(e.nativeEvent.contentOffset.x / width);
    if (next !== index && next >= 0 && next < SCENES.length) {
      setIndex(next);
      Haptics.selectionAsync().catch(() => {});
    }
  };

  const advance = () => {
    if (isLast) {
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
      leave();
      return;
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    listRef.current?.scrollToOffset({ offset: (index + 1) * width, animated: !reducedMotion });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="dark" />
      <MeshBackground variant="hero" />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <RoofWiseBrand />

          <Pressable
            onPress={leave}
            hitSlop={12}
            style={styles.skip}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={SCENES}
          keyExtractor={(s) => s.key}
          horizontal
          style={styles.carousel}
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          renderItem={({ item, index: i }) => (
            <SceneSlide scene={item} active={i === index} width={width} />
          )}
        />

        <View style={styles.footer}>
          <View style={styles.dots}>
            {SCENES.map((s, i) => (
              <Dot key={s.key} active={i === index} />
            ))}
          </View>

          <Animated.View entering={FadeInDown.duration(motion.enterMs).delay(120)}>
            <Pressable
              onPress={advance}
              style={({ pressed }) => [styles.cta, pressed && styles.ctaPressed]}
              accessibilityRole="button"
              accessibilityLabel={isLast ? 'Get started' : 'Next'}
            >
              <Text style={styles.ctaText}>{isLast ? 'Get started' : 'Next'}</Text>
              <Ionicons
                name={isLast ? 'arrow-forward' : 'chevron-forward'}
                size={20}
                color={colors.textInverse}
              />
            </Pressable>
          </Animated.View>

          {!session && !env.REQUIRE_AUTH && (
            <Pressable onPress={enterWorkspace} accessibilityRole="button" style={styles.secondary}>
              <Text style={styles.secondaryText}>Continue as guest</Text>
            </Pressable>
          )}
        </View>
      </SafeAreaView>
    </View>
  );
}

function SceneSlide({ scene, active, width }: { scene: Scene; active: boolean; width: number }) {
  const { Illustration } = scene;
  return (
    <ScrollView
      style={[styles.slideViewport, { width }]}
      contentContainerStyle={styles.slide}
      nestedScrollEnabled
      showsVerticalScrollIndicator
    >
      <View style={styles.stageWrap}>
        <Illustration active={active} />
      </View>

      {active && (
        <Animated.View
          key={`${scene.key}-copy`}
          entering={FadeIn.duration(motion.sceneEnterMs)}
          style={styles.copy}
        >
          <Animated.Text
            entering={FadeInDown.duration(motion.sceneEnterMs)}
            style={styles.eyebrow}
          >
            {scene.eyebrow}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.duration(motion.sceneEnterMs).delay(motion.sceneStaggerMs)}
            style={styles.title}
          >
            {scene.title}
          </Animated.Text>
          <Animated.Text
            entering={FadeInDown.duration(motion.sceneEnterMs).delay(motion.sceneStaggerMs * 2)}
            style={styles.body}
          >
            {scene.body}
          </Animated.Text>
        </Animated.View>
      )}
    </ScrollView>
  );
}

function Dot({ active }: { active: boolean }) {
  const w = useSharedValue(active ? 26 : 7);
  const o = useSharedValue(active ? 1 : 0.35);
  const s = useSharedValue(1);

  useEffect(() => {
    w.value = withSpring(active ? 26 : 7, motion.snappy);
    o.value = withTiming(active ? 1 : 0.35, { duration: 220 });
    if (active) {
      // Small overshoot pop as the carousel advances onto this dot.
      s.value = withSequence(
        withSpring(1.2, motion.snappy),
        withSpring(1, motion.snappy),
      );
    }
  }, [active, w, o, s]);

  const style = useAnimatedStyle(() => ({
    width: w.value,
    opacity: o.value,
    transform: [{ scale: s.value }],
  }));
  // Colour is a plain (non-animated) style keyed off the `active` prop —
  // the width/opacity/scale spring already carries the motion, the colour
  // just needs to be correct on the render where `active` flips.
  return (
    <Animated.View
      style={[styles.dot, { backgroundColor: active ? brand.burntLight : colors.onMesh }, style]}
    />
  );
}

const styles = StyleSheet.create({
  // Dark edge under the mesh (offscreen safe-area slivers, a slow grain
  // load) — matches the ramp's own 0% stop rather than pure black.
  root: { flex: 1, backgroundColor: colors.bg },
  safe: { flex: 1 },

  topBar: {
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  skip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  skipText: {
    color: colors.textMuted,
    fontFamily: fontFamily.archivo.semibold,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },

  // Keep the horizontal pager bounded while each page can scroll vertically.
  // Fixed-size art must not collapse into the copy on short screens or when
  // larger system text needs more room. Next and Skip stay outside the scroll.
  carousel: { flex: 1, minHeight: 0 },
  slideViewport: { flex: 1, minHeight: 0 },
  slide: { flexGrow: 1, paddingHorizontal: spacing.xl },
  stageWrap: {
    flexGrow: 1,
    flexShrink: 0,
    minHeight: ONBOARDING_SCENE_SIZE + spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  copy: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    padding: spacing.xl,
    marginBottom: spacing.lg,
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  eyebrow: { ...dataLabel, color: colors.tileBlueInk },
  title: {
    color: colors.text,
    fontFamily: fontFamily.archivo.bold,
    fontSize: fontSize.titleLg,
  },
  body: {
    color: colors.textMuted,
    fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodyMd,
    lineHeight: 22,
  },

  footer: { flexShrink: 0, paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.md },
  dots: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'center' },
  // backgroundColor is set per-instance in <Dot> (active → burntLight,
  // inactive → onMesh) — this base only carries shape.
  dot: { height: 7, borderRadius: 4 },

  // touchTarget.sticky (88) kept per Drift #1 / docs §4 — the mock's 54-60px
  // in-flow buttons don't apply to the one true sticky bottom CTA. The
  // brand-tinted `shadows.hero` is the "coloured shadow" §6 calls for.
  cta: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: brand.burnt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    ...shadows.hero,
  },
  ctaPressed: { backgroundColor: brand.burntDeep, transform: [{ scale: 0.985 }] },
  ctaText: {
    color: colors.textInverse,
    fontFamily: fontFamily.archivo.bold,
    fontWeight: fontWeight.bold,
    fontSize: fontSize.bodyLg,
    letterSpacing: -0.2,
  },
  secondary: { alignSelf: 'center', minHeight: touchTarget.standard, justifyContent: 'center' },
  secondaryText: {
    color: colors.textMuted,
    fontFamily: fontFamily.archivo.medium,
    fontWeight: fontWeight.medium,
    fontSize: fontSize.bodyMd,
  },
});
