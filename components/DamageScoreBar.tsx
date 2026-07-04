import { useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { AnimatedCounter } from '@/components/motion';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  spacing,
} from '@/theme/tokens';

type Props = {
  score: number; // 0–100
};

export function DamageScoreBar({ score }: Props) {
  const clamped = Math.max(0, Math.min(100, score));
  const tone =
    clamped >= 70 ? colors.danger : clamped >= 40 ? colors.warn : colors.success;
  const label =
    clamped >= 70 ? 'Severe' : clamped >= 40 ? 'Moderate' : clamped === 0 ? 'No damage' : 'Minor';

  // Fill springs from empty to the score — the analysis payoff moment.
  const progress = useSharedValue(0);
  useEffect(() => {
    progress.value = withSpring(clamped, motion.gentle);
  }, [clamped, progress]);
  const fillStyle = useAnimatedStyle(() => ({
    width: `${progress.value}%`,
  }));

  return (
    <View style={styles.wrap}>
      <View style={styles.headerRow}>
        <Text style={styles.label}>Damage score</Text>
        <AnimatedCounter value={clamped} style={[styles.value, { color: tone }]} />
      </View>
      <View style={styles.track}>
        <Animated.View style={[styles.fill, { backgroundColor: tone }, fillStyle]} />
      </View>
      <View style={styles.legendRow}>
        <Text style={styles.legend}>0</Text>
        <Text style={[styles.statusPill, { backgroundColor: `${tone}22`, color: tone }]}>
          {label}
        </Text>
        <Text style={styles.legend}>100</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  label: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  value: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold },
  track: {
    height: 12,
    borderRadius: 6,
    backgroundColor: colors.surfaceMuted,
    overflow: 'hidden',
  },
  fill: { height: 12, borderRadius: 6 },
  legendRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  legend: { fontSize: fontSize.caption, color: colors.slate },
  statusPill: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.pill,
    overflow: 'hidden',
  },
});
