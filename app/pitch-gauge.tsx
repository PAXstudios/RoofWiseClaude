import { useMemo } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useDeviceMotion, useAltitudeFeet } from '@/lib/services/deviceMotion';
import { pitchDegreesToRatio } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function PitchGauge() {
  // Pitch measurement needs the phone's motion sensors held flat against
  // the slope — there is no desktop-web equivalent. Branching lives in this
  // wrapper so the native component's hooks stay unconditional.
  if (Platform.OS === 'web') return <PitchGaugeWebNotice />;
  return <PitchGaugeNative />;
}

function PitchGaugeWebNotice() {
  const router = useRouter();
  return (
    <SafeAreaView style={webStyles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={webStyles.wrap}>
        <View style={webStyles.iconWrap}>
          <Ionicons name="compass-outline" size={36} color={colors.brand} />
        </View>
        <Text style={webStyles.title}>Pitch Gauge uses the phone&apos;s motion sensors</Text>
        <Text style={webStyles.body}>
          This tool runs on the RoofWise mobile app — your jobs, leads,
          reports, and map stay in sync here on the web.
        </Text>
        <Pressable style={webStyles.cta} onPress={() => router.replace('/')}>
          <Text style={webStyles.ctaText}>Back to dashboard</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const webStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xxl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 72,
    height: 72,
    borderRadius: radii.pill,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
    maxWidth: 420,
  },
  body: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
    maxWidth: 420,
  },
  cta: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxxl,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.lg,
  },
  ctaText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },
});

function PitchGaugeNative() {
  const router = useRouter();
  const { pitchDegrees, rollDegrees } = useDeviceMotion();
  const altFeet = useAltitudeFeet();

  const ratio = useMemo(() => pitchDegreesToRatio(pitchDegrees), [pitchDegrees]);

  const levelTint = (() => {
    const r = Math.abs(rollDegrees);
    if (r < 2) return colors.success;
    if (r < 8) return colors.warn;
    return colors.danger;
  })();

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.textInverse} />
        </Pressable>
        <Text style={styles.headerTitle}>Pitch Gauge</Text>
      </View>

      <View style={styles.body}>
        <Text style={styles.hint}>Hold the phone flat against the slope.</Text>

        <View style={styles.readout}>
          <Text style={styles.degrees}>{pitchDegrees.toFixed(1)}°</Text>
          <Text style={styles.ratio}>{ratio}</Text>
        </View>

        <View style={styles.bullseye}>
          <View style={[styles.bullseyeOuter, { borderColor: levelTint }]} />
          <View
            style={[
              styles.bullseyeDot,
              {
                backgroundColor: levelTint,
                transform: [
                  { translateX: clampTransform(rollDegrees) },
                  { translateY: 0 },
                ],
              },
            ]}
          />
        </View>

        <View style={styles.altRow}>
          <Ionicons name="trending-up-outline" size={20} color={colors.cream} />
          <Text style={styles.altText}>
            {altFeet === null ? 'Reading altitude…' : `${altFeet.toFixed(0)} ft elevation`}
          </Text>
        </View>
      </View>

      <Pressable
        style={styles.cta}
        onPress={() => router.back()}
      >
        <Text style={styles.ctaText}>Save pitch ({pitchDegrees.toFixed(0)}°)</Text>
      </Pressable>
    </SafeAreaView>
  );
}

function clampTransform(rollDegrees: number): number {
  // Move the bullseye dot horizontally based on roll, capped at ±60px.
  const x = rollDegrees * 2;
  return Math.max(-60, Math.min(60, x));
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.navy },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  headerTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.textInverse },

  body: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.xxl },
  hint: { fontSize: fontSize.bodyMd, color: 'rgba(255,255,255,0.78)', textAlign: 'center', paddingHorizontal: spacing.xxl },

  readout: { alignItems: 'center' },
  degrees: { fontSize: 96, fontWeight: fontWeight.bold, color: colors.cream, letterSpacing: -2 },
  ratio: { fontSize: fontSize.titleLg, fontWeight: fontWeight.semibold, color: colors.orange, marginTop: -spacing.sm },

  bullseye: {
    width: 140,
    height: 140,
    borderRadius: 70,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bullseyeOuter: { ...StyleSheet.absoluteFillObject, borderWidth: 2, borderRadius: 70 },
  bullseyeDot: { width: 24, height: 24, borderRadius: 12 },

  altRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  altText: { color: colors.cream, fontSize: fontSize.bodyMd },

  cta: {
    margin: spacing.xl,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
});
