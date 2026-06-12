import { useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  ScrollView,
  Dimensions,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { StatusBar } from 'expo-status-bar';
import { Ionicons } from '@expo/vector-icons';
import { useOnboardingStore } from '@/lib/stores/onboardingStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const { width: SCREEN_W } = Dimensions.get('window');

type Slide = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  body: string;
};

const SLIDES: Slide[] = [
  {
    icon: 'scan-outline',
    title: 'Forensic inspection in 10 minutes',
    body:
      'Open the camera, capture each slope, and let the AI flag every hail strike, bruise, and crack at HAAG-protocol confidence.',
  },
  {
    icon: 'thunderstorm-outline',
    title: 'Storm Watch on autopilot',
    body:
      'Add the cities you cover. We scan NOAA every 30 minutes and push you the moment ≥0.75" hail or ≥58 mph wind crosses your area.',
  },
  {
    icon: 'document-text-outline',
    title: 'Claim-defensible packets',
    body:
      'Slope-by-slope verdicts, test-square math, NOAA-verified weather event, and signatures — all in a single HAAG PDF the adjuster accepts.',
  },
  {
    icon: 'sparkles-outline',
    title: 'The AI gets better the more you use it',
    body:
      'Every correction you make trains a per-user calibration that lifts accuracy on your jobs. Tinder-swipe review keeps it fast.',
  },
];

export default function Onboarding() {
  const router = useRouter();
  const complete = useOnboardingStore((s) => s.complete);
  const scrollRef = useRef<ScrollView>(null);
  const [index, setIndex] = useState(0);

  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / SCREEN_W));
  };

  const onNext = () => {
    if (index < SLIDES.length - 1) {
      scrollRef.current?.scrollTo({ x: (index + 1) * SCREEN_W, animated: true });
      setIndex(index + 1);
    } else {
      complete();
      router.replace('/(tabs)');
    }
  };

  return (
    <LinearGradient
      colors={[colors.navy, '#1a2a52']}
      style={styles.gradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
    >
      <StatusBar style="light" />
      <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.topRow}>
          <Pressable
            onPress={() => {
              complete();
              router.replace('/(tabs)');
            }}
            hitSlop={10}
          >
            <Text style={styles.skip}>Skip</Text>
          </Pressable>
        </View>

        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onScroll={onScroll}
          scrollEventThrottle={16}
          style={{ flex: 1 }}
        >
          {SLIDES.map((s) => (
            <View key={s.title} style={styles.slide}>
              <View style={styles.iconWrap}>
                <Ionicons name={s.icon} size={48} color={colors.orange} />
              </View>
              <Text style={styles.title}>{s.title}</Text>
              <Text style={styles.body}>{s.body}</Text>
            </View>
          ))}
        </ScrollView>

        <View style={styles.dotsRow}>
          {SLIDES.map((_, i) => (
            <View
              key={i}
              style={[styles.dot, i === index && styles.dotActive]}
            />
          ))}
        </View>

        <Pressable style={styles.cta} onPress={onNext}>
          <Text style={styles.ctaText}>
            {index < SLIDES.length - 1 ? 'Next' : 'Get started'}
          </Text>
          <Ionicons name="arrow-forward" size={20} color={colors.textInverse} />
        </Pressable>
      </SafeAreaView>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  gradient: { flex: 1 },
  safe: { flex: 1 },
  topRow: {
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    alignItems: 'flex-end',
  },
  skip: { color: 'rgba(240,240,228,0.78)', fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  slide: {
    width: SCREEN_W,
    paddingHorizontal: spacing.xxl,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  iconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(252,96,24,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.cream,
    textAlign: 'center',
  },
  body: {
    fontSize: fontSize.bodyLg,
    color: 'rgba(240,240,228,0.88)',
    textAlign: 'center',
    lineHeight: 26,
  },

  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
  },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(240,240,228,0.32)' },
  dotActive: { width: 24, backgroundColor: colors.orange },

  cta: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: spacing.xxl,
    marginBottom: spacing.lg,
  },
  ctaText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },
});
