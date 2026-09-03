import { useMemo } from 'react';
import { View, Text, StyleSheet, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { ScreenHeader } from '@/components/ScreenHeader';
import { RichCard } from '@/components/ui/RichCard';
import { Pill } from '@/components/ui/Pill';
import { IconChip } from '@/components/ui/IconChip';
import { PressableScale } from '@/components/PressableScale';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  deriveAnalysisProgress,
  pendingPhotoCount,
  analyzingPhotoCount,
  queueSlopeAnalysis,
  type SlopeAnalysisProgress,
} from '@/lib/services/analysisQueue';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Processing view — every in-flight AI analysis in one place. Lists each slope
 * that still has queued, analyzing, or failed photos, with the per-photo state
 * (Queued / Analyzing / Done n / Failed), a running total, and a Retry for
 * failures. Counts are the real per-photo states written by `analyzeSlope`, so
 * work started from the capture strip, the Analyze screen, or the background
 * queue all show here — and nothing is ever a fabricated number (Drift #5).
 */
export default function Processing() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const toast = useToastStore((s) => s.show);

  const groups = useMemo(() => deriveAnalysisProgress(inspections), [inspections]);
  const pending = pendingPhotoCount(groups);
  const analyzing = analyzingPhotoCount(groups);
  const failedGroups = groups.filter((g) => g.failed > 0);
  const totalFailed = failedGroups.reduce((a, g) => a + g.failed, 0);

  const retry = (g: SlopeAnalysisProgress) => {
    // Re-run through the resilient background queue. `onlyNew` picks up every
    // not-yet-analyzed photo on the slope — failed and any stuck ones — so a
    // single tap clears the slope's backlog.
    const queued = queueSlopeAnalysis({
      inspectionId: g.inspectionId,
      slopeId: g.slopeId,
      slopeLabel: g.slopeLabel,
    });
    toast(
      queued
        ? { tone: 'success', title: `Retrying ${g.slopeLabel} slope`, body: 'Runs in the background.' }
        : { tone: 'info', title: `${g.slopeLabel} slope is already running` },
    );
  };

  const retryAll = () => {
    let n = 0;
    for (const g of failedGroups) {
      if (queueSlopeAnalysis({ inspectionId: g.inspectionId, slopeId: g.slopeId, slopeLabel: g.slopeLabel })) {
        n++;
      }
    }
    toast(
      n > 0
        ? { tone: 'success', title: `Retrying ${n} slope${n === 1 ? '' : 's'}`, body: 'Runs in the background.' }
        : { tone: 'info', title: 'Already running' },
    );
  };

  const headline =
    pending > 0
      ? analyzing > 0
        ? `Analyzing ${pending} photo${pending === 1 ? '' : 's'}`
        : `${pending} photo${pending === 1 ? '' : 's'} queued`
      : totalFailed > 0
        ? `${totalFailed} photo${totalFailed === 1 ? '' : 's'} need a retry`
        : 'Nothing processing';

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="Processing" subtitle={groups.length > 0 ? headline : undefined} back />

      <ScrollView contentContainerStyle={styles.scroll}>
        {groups.length === 0 ? (
          <View style={styles.empty}>
            <IconChip name="sparkles-outline" tone="quiet" size="md" />
            <Text style={styles.emptyTitle}>Nothing processing</Text>
            <Text style={styles.emptyBody}>
              Photos you capture or import analyze in the background. When any are running,
              they show here with their live status.
            </Text>
            <PressableScale style={styles.secondaryBtn} onPress={() => router.back()}>
              <Text style={styles.secondaryBtnText}>Back</Text>
            </PressableScale>
          </View>
        ) : (
          <>
            {totalFailed > 0 && (
              <PressableScale
                style={styles.retryAll}
                onPress={retryAll}
                accessibilityRole="button"
                accessibilityLabel={`Retry all ${totalFailed} failed photos`}
              >
                <Ionicons name="refresh" size={18} color={colors.textInverse} />
                <Text style={styles.retryAllText}>
                  Retry all failures ({totalFailed})
                </Text>
              </PressableScale>
            )}

            {groups.map((g) => (
              <RichCard
                key={`${g.inspectionId}:${g.slopeId}`}
                icon="home-outline"
                iconTone={g.analyzing > 0 ? 'purple' : g.failed > 0 && g.queued + g.analyzing === 0 ? 'orange' : 'blue'}
                title={`Slope ${g.slopeLabel}`}
                subtitle={`${g.reportId} · ${g.customerName}`}
                onPress={() => router.push(`/job/${g.inspectionId}` as any)}
                chevron
              >
                <View style={styles.pillRow}>
                  {g.queued > 0 && <Pill label={`Queued ${g.queued}`} tone="neutral" size="sm" />}
                  {g.analyzing > 0 && (
                    <Pill label={`Analyzing ${g.analyzing}`} tone="info" size="sm" dot pulse />
                  )}
                  {g.done > 0 && <Pill label={`Done ${g.done}`} tone="success" size="sm" />}
                  {g.failed > 0 && <Pill label={`Failed ${g.failed}`} tone="danger" size="sm" />}
                </View>
                <Text style={styles.countLine}>
                  {g.total} photo{g.total === 1 ? '' : 's'} on this slope
                </Text>
                {g.failed > 0 && (
                  <PressableScale
                    style={styles.retryBtn}
                    onPress={() => retry(g)}
                    accessibilityRole="button"
                    accessibilityLabel={`Retry ${g.failed} failed photos on ${g.slopeLabel} slope`}
                  >
                    <Ionicons name="refresh" size={16} color={colors.text} />
                    <Text style={styles.retryBtnText}>Retry {g.failed} failed</Text>
                  </PressableScale>
                )}
              </RichCard>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },

  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  countLine: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    marginTop: spacing.sm,
    fontVariant: ['tabular-nums'],
  },

  // Per-slope retry — quiet grey control, glove-sized.
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    marginTop: spacing.md,
  },
  retryBtnText: { color: colors.text, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  // Retry-all — the one loud control on the screen (only when failures exist).
  retryAll: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
    ...shadows.raised,
  },
  retryAllText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
  },

  empty: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
    paddingTop: spacing.xxxl,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.text },
  emptyBody: {
    fontSize: fontSize.bodyMd,
    color: colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  secondaryBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.md,
  },
  secondaryBtnText: { color: colors.text, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
