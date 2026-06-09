import { View, Text, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { drainAnalysisQueue } from '@/lib/services/analysisQueue';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

/** Shows on Home while queued AI analysis jobs are pending. */
export function AnalysisQueueChip() {
  const jobs = useAnalysisQueueStore((s) => s.jobs);
  const pending = jobs.filter((j) => j.status === 'queued' || j.status === 'running');
  const running = jobs.find((j) => j.status === 'running');

  if (pending.length === 0) return null;

  return (
    <Pressable
      style={styles.chip}
      onPress={() => drainAnalysisQueue().catch(() => {})}
    >
      <ActivityIndicator size="small" color={colors.orange} />
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
      <Ionicons name="play" size={18} color={colors.slate} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
    ...shadows.card,
  },
  title: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
});
