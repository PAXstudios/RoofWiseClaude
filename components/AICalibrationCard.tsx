import { useMemo } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { PressableScale } from '@/components/PressableScale';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export function AICalibrationCard() {
  const router = useRouter();
  const corrections = useCorrectionsStore((s) => s.corrections);
  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);

  if (accuracy === null) return null;

  return (
    <PressableScale style={styles.card} onPress={() => router.push('/(tabs)/train')}>
      <View style={styles.row}>
        <Ionicons name="sparkles-outline" size={22} color={colors.text} />
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>AI accuracy on your jobs</Text>
          <Text style={styles.value}>{accuracy}%</Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </View>
      <Text style={styles.sub}>
        Calibrated from {profile.totalCorrections} correction{profile.totalCorrections === 1 ? '' : 's'}.
      </Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // White iOS cell on the grouped ground — hairline + near-zero shadow.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  label: { fontSize: fontSize.bodySm, color: colors.textMuted },
  value: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sub: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    marginLeft: spacing.xxxl + 2,
  },
});
