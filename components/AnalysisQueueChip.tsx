import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { drainAnalysisQueue } from '@/lib/services/analysisQueue';
import { PressableScale } from '@/components/PressableScale';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/** Shows on Home while queued AI analysis jobs are pending. */
export function AnalysisQueueChip() {
  const jobs = useAnalysisQueueStore((s) => s.jobs);
  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const running = jobs.find((j) => j.status === 'running');

  if (pending.length === 0) return null;

  return (
    <PressableScale
      style={styles.chip}
      accessibilityRole="button"
      accessibilityLabel={`AI queue, ${pending.length} slope${pending.length === 1 ? '' : 's'} remaining. Tap to run now.`}
      onPress={() => drainAnalysisQueue().catch(() => {})}
    >
      <ActivityIndicator size="small" color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          AI queue · {pending.length} slope{pending.length === 1 ? '' : 's'} remaining
        </Text>
        <Text style={styles.sub}>
          {running
            ? `Analyzing ${running.slopeLabel} slope now…`
            : 'Tap to run now — completes while the app is open.'}
        </Text>
      </View>
      <Ionicons name="play" size={18} color={colors.text} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Quiet white cell — hairline instead of the old orange stripe; the
  // spinner is the live signal, not an accent border.
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    ...shadows.card,
  },
  title: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
});
