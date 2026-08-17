import { useMemo } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import { RichCard } from '@/components/ui/RichCard';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { colors, fontSize, fontWeight } from '@/theme/tokens';

/**
 * AI accuracy on the roofer's own jobs — hides entirely below 5 corrections
 * (Drift #5: no fabricated confidence). Once it renders, the accuracy figure
 * shares its purple with the icon chip and the progress fill, so the number
 * and its chrome read as one object rather than a chip beside a stat.
 */
export function AICalibrationCard() {
  const router = useRouter();
  const corrections = useCorrectionsStore((s) => s.corrections);
  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);

  if (accuracy === null) return null;

  return (
    <RichCard
      onPress={() => router.push('/(tabs)/train')}
      icon="sparkles-outline"
      iconTone="purple"
      title="AI calibration"
      subtitle={`Calibrated from ${profile.totalCorrections} correction${
        profile.totalCorrections === 1 ? '' : 's'
      }`}
      headerTrailing={<Text style={styles.accuracy}>{accuracy}%</Text>}
      chevron
      accessibilityLabel={`AI accuracy on your jobs: ${accuracy}%. Calibrated from ${profile.totalCorrections} corrections.`}
    >
      <ProgressBar
        progress={accuracy / 100}
        tone="purple"
        accessibilityLabel={`AI accuracy ${accuracy}%`}
      />
    </RichCard>
  );
}

const styles = StyleSheet.create({
  accuracy: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.tilePurpleInk,
    fontVariant: ['tabular-nums'],
  },
});
