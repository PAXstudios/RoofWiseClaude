import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { drainAnalysisQueue } from '@/lib/services/analysisQueue';
import { PressableScale } from '@/components/PressableScale';
import { IconChip } from '@/components/ui/IconChip';
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
      <IconChip name="sparkles-outline" tone="purple" size="md" />
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
      {running ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <View style={styles.playBadge}>
          <Ionicons name="play" size={16} color={colors.textInverse} />
        </View>
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Crafted cell — purple "AI" chip identity + a royal play badge instead of
  // a bare glyph, matching the rest of Home's colour-chipped language.
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
    ...shadows.raised,
  },
  title: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  playBadge: {
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
