import { useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import {
  deriveAnalysisProgress,
  pendingPhotoCount,
  analyzingPhotoCount,
} from '@/lib/services/analysisQueue';
import { PressableScale } from '@/components/PressableScale';
import { IconChip } from '@/components/ui/IconChip';
import {
  colors,
  fontFamily,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Live "AI is working" status. Shows only while photos are actually queued or
 * analyzing (real per-photo counts from the inspection store — never a
 * fabricated number, Drift #5). Tapping opens the Processing view, where every
 * in-flight analysis is listed with its per-photo state and a Retry for
 * failures.
 *
 * Pass `inspectionId` to scope the count to one job (used in the job header);
 * omit it on Home for the app-wide count.
 */
export function AnalysisQueueChip({ inspectionId }: { inspectionId?: string } = {}) {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const groups = useMemo(() => {
    const scoped = inspectionId
      ? inspections.filter((i) => i.id === inspectionId)
      : inspections;
    return deriveAnalysisProgress(scoped);
  }, [inspections, inspectionId]);

  const pending = pendingPhotoCount(groups);
  const analyzing = analyzingPhotoCount(groups);

  // Real counts only: nothing queued or analyzing → nothing to say.
  if (pending === 0) return null;

  const label =
    analyzing > 0
      ? `Analyzing ${pending} photo${pending === 1 ? '' : 's'}…`
      : `${pending} photo${pending === 1 ? '' : 's'} queued`;

  return (
    <PressableScale
      style={styles.chip}
      accessibilityRole="button"
      accessibilityLabel={`AI analysis, ${pending} photo${pending === 1 ? '' : 's'} pending. Tap to see what's processing.`}
      onPress={() => router.push('/processing')}
    >
      <IconChip name="sparkles-outline" tone="purple" size="md" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{label}</Text>
        <Text style={styles.sub}>Runs in the background — tap to see what's processing.</Text>
      </View>
      {analyzing > 0 ? (
        <ActivityIndicator size="small" color={colors.textMuted} />
      ) : (
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      )}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Crafted cell — purple "AI" chip identity, matching the rest of Home's
  // colour-chipped language.
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
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  sub: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted, marginTop: 2 },
});
