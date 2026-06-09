import { useMemo } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
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
    <Pressable style={styles.card} onPress={() => router.push('/(tabs)/train')}>
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Ionicons name="sparkles" size={20} color={colors.textInverse} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>AI accuracy on your jobs</Text>
          <Text style={styles.value}>{accuracy}%</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.slate} />
      </View>
      <Text style={styles.sub}>
        Calibrated from {profile.totalCorrections} correction{profile.totalCorrections === 1 ? '' : 's'}.
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: { fontSize: fontSize.bodySm, color: colors.slate },
  value: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginLeft: 48 },
});
