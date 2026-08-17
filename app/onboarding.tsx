// Onboarding — the product loop, told in four animated beats.
//
// Design intent: black ground, brand-lit aurora, glass foreground. Every
// scene animates one real step of the RoofWise loop so a contractor
// understands what they bought before they ever sign in. Skip is always
// available and always lands on auth — onboarding never traps anyone.

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
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
  Easing,
  FadeIn,
  FadeInDown,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Aurora } from '@/components/glass/Aurora';
import {
  PacketScene,
  ScanScene,
  StormScene,
  VerdictScene,
  type SceneProps,
} from '@/components/onboarding/scenes';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
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
    eyebrow: 'Storm intelligence',
    title: 'Know the\nminute it hits',
    body: 'RoofWise watches NOAA for hail and wind across your service area, then shows you exactly which properties sit under the swath.',
    Illustration: StormScene,
  },
  {
    key: 'scan',
    eyebrow: 'AI inspection',
    title: 'Walk it once.\nMiss nothing.',
    body: 'Point the camera. AI reads every shingle across all 13 damage categories and marks each finding with a severity and a confidence score.',
    Illustration: ScanScene,
  },
  {
    key: 'verdict',
    eyebrow: 'HAAG protocol',
    title: 'Thresholds,\nnot opinions',
    body: 'Findings are measured against the material-specific Haag criteria your carrier already uses — so the verdict is the standard, not your word against theirs.',
    Illustration: VerdictScene,
  },
  {
    key: 'packet',
    eyebrow: 'Claim packet',
    title: 'Evidence they\ncan’t wave away',
    body: 'Leave the driveway with a certified report: annotated photos, storm verification, thresholds met, and signatures. Ready for the adjuster.',
    Illustration: PacketScene,
  },
];

export default function Onboarding() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const complete = useOnboardingStore((s) => s.complete);
  const listRef = useRef<FlatList<Scene>>(null);
  const [index, setIndex] = useState(0);

  const isLast = index === SCENES.length - 1;

  // Onboarding is never a gate. Finishing and skipping both land on auth;
  // the only difference is whether the user saw the pitch.
  const leave = useCallback(() => {
    complete();
    router.replace('/welcome');
  }, [complete, router]);

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
    listRef.current?.scrollToOffset({ offset: (index + 1) * width, animated: true });
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar style="light" />
      <Aurora />

      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <View style={styles.topBar}>
          <View style={styles.brandRow}>
            <View style={styles.brandMark}>
              <Ionicons name="shield-checkmark" size={15} color={colors.textInverse} />
            </View>
            <Text style={styles.brandName}>RoofWise</Text>
          </View>

          <Pressable
            onPress={leave}
            hitSlop={12}
            style={styles.skip}
            accessibilityRole="button"
            accessibilityLabel="Skip onboarding and go to sign in"
          >
            <Text style={styles.skipText}>Skip</Text>
          </Pressable>
        </View>

        <FlatList
          ref={listRef}
          data={SCENES}
          keyExtractor={(s) => s.key}
          horizontal
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

          <Pressable onPress={leave} hitSlop={10} style={styles.secondary}>
            <Text style={styles.secondaryText}>
              {isLast ? 'I’ll explore first' : 'I already have an account'}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    </View>
  );
}

/**
 * Slow ambient drift on the scene art — a few points of translate on the
 * ambient loop, out of phase with the Aurora orbs behind it, so the hero
 * reads as parallax depth rather than a static cutout.
 */
function AmbientDrift({ children }: { children: React.ReactNode }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: motion.ambientMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      true, // reverse so the drift never snaps back
    );
  }, [t]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * 6 },
      { translateY: t.value * -8 },
    ],
  }));

  return <Animated.View style={style}>{children}</Animated.View>;
}

function SceneSlide({ scene, active, width }: { scene: Scene; active: boolean; width: number }) {
  const { Illustration } = scene;
  return (
    <View style={[styles.slide, { width }]}>
      <View style={styles.stageWrap}>
        <AmbientDrift>
          <Illustration active={active} />
        </AmbientDrift>
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
    </View>
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
  return <Animated.View style={[styles.dot, style]} />;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: brand.black },
  safe: { flex: 1 },

  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  brandMark: {
    width: 28,
    height: 28,
    borderRadius: 9,
    backgroundColor: brand.royal,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.3,
  },
  skip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radii.pill,
    backgroundColor: glass.fillLow,
    borderWidth: 1,
    borderColor: glass.border,
  },
  skipText: {
    color: 'rgba(255,255,255,0.82)',
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
  },

  // Illustration takes the free space at the top and centers within it; the
  // copy sits directly above the footer. Centering the whole group instead
  // left a large dead gap under the text on tall screens.
  slide: { flex: 1, paddingHorizontal: spacing.xl },
  stageWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  copy: {
    alignItems: 'flex-start',
    alignSelf: 'stretch',
    gap: spacing.sm,
    paddingBottom: spacing.xl,
  },
  eyebrow: {
    color: brand.burnt,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.6,
    textTransform: 'uppercase',
  },
  title: {
    color: colors.textInverse,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    letterSpacing: -1,
    lineHeight: 38,
  },
  body: {
    color: 'rgba(255,255,255,0.66)',
    fontSize: fontSize.bodyLg,
    lineHeight: 25,
  },

  footer: { paddingHorizontal: spacing.xl, paddingBottom: spacing.md, gap: spacing.md },
  dots: { flexDirection: 'row', gap: spacing.sm, alignSelf: 'center' },
  dot: { height: 7, borderRadius: 4, backgroundColor: colors.textInverse },

  cta: {
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: brand.burnt,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
  },
  ctaPressed: { backgroundColor: brand.burntDeep, transform: [{ scale: 0.985 }] },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    letterSpacing: -0.2,
  },
  secondary: { alignSelf: 'center', minHeight: touchTarget.standard, justifyContent: 'center' },
  secondaryText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
  },
});
