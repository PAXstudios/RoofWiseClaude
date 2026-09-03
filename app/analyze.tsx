import { useMemo, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  ScrollView,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconChip } from '@/components/ui/IconChip';
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { drainAnalysisQueue } from '@/lib/services/analysisQueue';
import {
  analyzeSlope,
  getPhotoAnalysisState,
  isSlopeAnalysisRunning,
} from '@/lib/services/analyzeSlope';
import { PhotoActionsSheet } from '@/components/sheets/PhotoActionsSheet';
import { describeAnalysisError } from '@/lib/services/gemini';
import { scorePhotos } from '@/lib/services/photoQuality';
import { isGeminiConfigured } from '@/lib/env';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function AnalyzeView() {
  const router = useRouter();
  const { inspectionId, slopeId } = useLocalSearchParams<{
    inspectionId: string;
    slopeId: string;
  }>();
  const inspection = useInspectionStore((s) =>
    s.inspections.find((i) => i.id === inspectionId),
  );
  const removePhoto = useInspectionStore((s) => s.removePhoto);
  const replacePhoto = useInspectionStore((s) => s.replacePhoto);
  const logActivity = useActivityStore((s) => s.log);
  const toast = useToastStore((s) => s.show);
  const enqueueAnalysis = useAnalysisQueueStore((s) => s.enqueue);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Long-press → the photo actions SHEET (with the photo in it), not a
  // system Alert. Delete confirms inside the sheet.
  const [actionIndex, setActionIndex] = useState<number | null>(null);
  const onPhotoLongPress = (photoIndex: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionIndex(photoIndex);
  };
  const rotatePhoto = async (photoIndex: number) => {
    if (!inspection || !slope) return;
    try {
      const uri = slope.photoPaths[photoIndex];
      const out = await ImageManipulator.manipulateAsync(
        uri,
        [{ rotate: 90 }],
        { compress: 0.9, format: ImageManipulator.SaveFormat.JPEG },
      );
      replacePhoto(inspection.id, slope.id, photoIndex, out.uri);
      toast({ tone: 'success', title: 'Rotated' });
    } catch {
      toast({ tone: 'danger', title: 'Rotate failed' });
    }
  };
  const deletePhoto = (photoIndex: number) => {
    if (!inspection || !slope) return;
    removePhoto(inspection.id, slope.id, photoIndex);
    toast({ tone: 'warn', title: 'Photo deleted' });
  };

  const slope = inspection?.slopes.find((sl) => sl.id === slopeId);

  const unanalyzed = useMemo(() => {
    if (!slope) return [] as number[];
    // analyzedPhotoIndices, not `damage` markers — a clean photo (analyzed,
    // zero findings) has no markers, and inferring from markers would show
    // it as still "waiting for analysis" forever.
    const seen = new Set(slope.analyzedPhotoIndices ?? []);
    return slope.photoPaths.map((_, i) => i).filter((i) => !seen.has(i));
  }, [slope]);

  if (!inspection || !slope) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <IconChip name="alert-circle-outline" tone="quiet" />
          <Text style={styles.emptyText}>Slope not found.</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const run = async (onlyNew: boolean) => {
    if (!isGeminiConfigured) {
      Alert.alert('AI not connected', "AI analysis isn't set up on this build — ask your admin.");
      return;
    }

    const toAnalyze = onlyNew
      ? unanalyzed.map((i) => slope!.photoPaths[i])
      : slope!.photoPaths;
    const quality = await scorePhotos(toAnalyze);
    if (!quality.ok) {
      const proceed = await new Promise<boolean>((resolve) => {
        Alert.alert(
          'Photo quality issues',
          quality.flags.join('\n• '),
          [
            { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
            { text: 'Analyze anyway', onPress: () => resolve(true) },
          ],
        );
      });
      if (!proceed) return;
    }

    setRunning(true);
    setError(null);
    setProgress({ done: 0, total: onlyNew ? unanalyzed.length : slope.photoPaths.length });
    try {
      const result = await analyzeSlope(inspection.id, slope.id, {
        onlyNew,
        onProgress: (p) => setProgress({ done: p.done, total: p.total }),
      });
      logActivity({
        kind: 'analysis_ran',
        inspectionId: inspection.id,
        message: `Analyzed ${result.attached} photo${result.attached === 1 ? '' : 's'} on ${slope.orientation} slope`,
      });
      if (result.failed > 0) {
        // Reason verbatim from the pipeline — never a bare count. Failed
        // photos are not in analyzedPhotoIndices, so "Analyze N new" is the
        // retry; the badge on each failed thumb shows which ones.
        const first = result.failures[0]?.reason ?? 'Unknown reason.';
        setError(
          `${result.failed} photo${result.failed === 1 ? '' : 's'} failed — ${first} ` +
            'Failed photos are marked "!" below; tap "Analyze new" to retry them.',
        );
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
      } else {
        await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      }
    } catch (e) {
      setError(describeAnalysisError(e));
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  };

  // A pass this screen did not start can still be running — the background
  // queue picked the slope up after a previous "Next". Read the real state so
  // the buttons do not invite a redundant run. Not reactive on its own, but
  // every pass writes markers to the inspection store, which re-renders here.
  const passInFlight = running || isSlopeAnalysisRunning(inspection.id, slope.id);

  // What will still be outstanding once the inspector walks away: whatever has
  // not been analyzed, plus the pass currently in flight.
  const pendingAfterLeaving = unanalyzed.length + (passInFlight ? 1 : 0);

  /**
   * Move on to the job. Never blocked on analysis.
   *
   * `replace`, not `push`: this screen was itself reached by `replace` from the
   * camera, so the job becomes the destination rather than stacking on top of a
   * capture flow the inspector has finished with. Works for a job just created
   * and for one they were adding photos to — both arrive here with the same
   * `inspectionId`.
   */
  const goToJob = () => {
    if (unanalyzed.length > 0) {
      // Idempotent: returns null when this slope is already queued or running.
      const job = enqueueAnalysis({
        inspectionId: inspection.id,
        slopeId: slope.id,
        slopeLabel: slope.orientation,
      });
      if (job) drainAnalysisQueue().catch(() => {});
      toast({
        tone: 'success',
        title: `${unanalyzed.length} photo${unanalyzed.length === 1 ? '' : 's'} still analyzing`,
        body: 'Finishing in the background — watch it on Processing.',
      });
    }
    router.replace({ pathname: `/job/${inspection.id}` as any });
  };

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportId}>{inspection.reportId} · {slope.orientation}</Text>
          <Text style={styles.title}>Analyze slope</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <RichCard
          icon="images-outline"
          iconTone="blue"
          title={`${slope.photoPaths.length} photo${slope.photoPaths.length === 1 ? '' : 's'} captured`}
        >
          <Text style={styles.cardSub}>
            {unanalyzed.length === 0
              ? 'All photos have been analyzed. Re-run to override existing markers.'
              : `${unanalyzed.length} photo${unanalyzed.length === 1 ? '' : 's'} waiting for analysis.`}
          </Text>
        </RichCard>

        {!isGeminiConfigured && (
          <View style={styles.warnBanner}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warn} />
            <Text style={styles.warnText}>
              AI analysis isn't set up on this build — ask your admin. Photos are saved without
              analysis.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <SectionHeader title="Photos" />
        <Text style={styles.hint}>Tap for the photo's damage report · Long-press to rotate or delete.</Text>
        <View style={styles.grid}>
          {slope.photoPaths.map((uri, i) => {
            const analyzed = (slope.analyzedPhotoIndices ?? []).includes(i);
            // Failure notice: a photo whose last attempt failed shows "!"
            // (reason lives in the banner above + slope.photoAnalysis).
            const failed = getPhotoAnalysisState(slope, i)?.status === 'failed';
            const badgeBg = failed
              ? colors.danger
              : analyzed
                ? colors.success
                : colors.surfaceMuted;
            const badgeIcon = failed ? 'alert' : analyzed ? 'checkmark' : 'ellipse-outline';
            const badgeColor = failed || analyzed ? colors.textInverse : colors.slate;
            return (
              <Pressable
                key={i}
                style={styles.thumb}
                onPress={() =>
                  router.push({
                    pathname: '/photo-report',
                    params: {
                      inspectionId: inspection.id,
                      slopeId: slope.id,
                      photoIndex: String(i),
                    },
                  })
                }
                onLongPress={() => onPhotoLongPress(i)}
              >
                <Image source={{ uri }} style={styles.thumbImg} />
                <View style={[styles.thumbBadge, { backgroundColor: badgeBg }]}>
                  <Ionicons name={badgeIcon} size={14} color={badgeColor} />
                </View>
              </Pressable>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        {progress && (
          <Text style={styles.progressText}>
            Analyzing {progress.done + 1} of {progress.total}…
          </Text>
        )}
        {/* The 88pt primary is whichever action is live. With new photos it
            is "Analyze N new"; with nothing new (the normal case after the
            camera's own analysis) it is "Next — go to the job", and the
            analyze button steps down to a secondary. A disabled orange
            primary above a 44pt text link left the roofer nothing to press. */}
        {unanalyzed.length > 0 ? (
          <>
            <View style={styles.btnRow}>
              <Pressable
                style={[styles.secondaryBtn, passInFlight && { opacity: 0.5 }]}
                disabled={passInFlight || slope.photoPaths.length === 0}
                onPress={() => run(false)}
              >
                <Text style={styles.secondaryBtnText}>Re-analyze all</Text>
              </Pressable>
              <Pressable
                style={[styles.primaryBtn, passInFlight && styles.primaryBtnDisabled]}
                disabled={passInFlight}
                onPress={() => run(true)}
                accessibilityRole="button"
                accessibilityLabel={`Analyze ${unanalyzed.length} new photos`}
              >
                {running ? (
                  <ActivityIndicator color={colors.textInverse} />
                ) : (
                  <Text style={styles.primaryBtnText}>Analyze {unanalyzed.length} new</Text>
                )}
              </Pressable>
            </View>
            {/* ALWAYS live — including mid-analysis. Waiting on a spinner is
                not the job; the roof is. Anything still unanalyzed is handed
                to the background queue on the way out (the Processing screen
                and the queue chip show it finishing), and `analyzeSlope` joins
                the pass already in flight rather than starting a rival one, so
                nothing is analyzed or counted twice. */}
            <Pressable
              style={styles.queueBtn}
              onPress={goToJob}
              accessibilityRole="button"
              accessibilityLabel="Next: go to the job and finish analysis in the background"
            >
              <Ionicons name="arrow-forward-circle-outline" size={18} color={colors.brand} />
              <Text style={styles.nextBtnText}>
                {`Next — finish ${pendingAfterLeaving} in the background`}
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.btnRow}>
              <Pressable
                style={[styles.secondaryBtn, passInFlight && { opacity: 0.5 }]}
                disabled={passInFlight || slope.photoPaths.length === 0}
                onPress={() => run(false)}
              >
                <Text style={styles.secondaryBtnText}>Re-analyze all</Text>
              </Pressable>
              <View style={[styles.secondaryBtn, styles.secondaryBtnDisabled]} accessibilityState={{ disabled: true }}>
                {running ? (
                  <ActivityIndicator color={colors.navy} />
                ) : (
                  <Text style={styles.secondaryBtnText}>Nothing new to analyze</Text>
                )}
              </View>
            </View>
            <Pressable
              style={styles.primaryBtn}
              onPress={goToJob}
              accessibilityRole="button"
              accessibilityLabel={
                passInFlight ? 'Next: go to the job and finish analysis in the background' : 'Next: go to the job'
              }
            >
              <Ionicons name="arrow-forward-circle-outline" size={20} color={colors.textInverse} />
              <Text style={styles.primaryBtnText}>
                {passInFlight ? 'Next — finish in the background' : 'Next — go to the job'}
              </Text>
            </Pressable>
          </>
        )}
      </View>

      <PhotoActionsSheet
        visible={actionIndex !== null}
        uri={actionIndex !== null ? slope.photoPaths[actionIndex] : undefined}
        caption={
          actionIndex !== null
            ? `Photo ${actionIndex + 1} of ${slope.photoPaths.length} · ${slope.orientation} slope`
            : undefined
        }
        onClose={() => setActionIndex(null)}
        onOpenReport={() => {
          if (actionIndex === null) return;
          router.push({
            pathname: '/photo-report',
            params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(actionIndex) },
          });
        }}
        onRotate={() => {
          if (actionIndex !== null) rotatePhoto(actionIndex).catch(() => {});
        }}
        onReanalyze={
          isGeminiConfigured
            ? () => {
                if (actionIndex === null) return;
                analyzeSlope(inspection.id, slope.id, { photoIndexes: [actionIndex] }).catch(() => {});
                toast({ tone: 'info', title: 'Re-analyzing photo' });
              }
            : undefined
        }
        onDelete={() => {
          if (actionIndex !== null) deletePhoto(actionIndex);
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.sm,
  },
  // Glove-sized back target (Drift #1) — was a 26px icon in 4pt of padding.
  headerBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  reportId: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold },
  title: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  cardSub: { fontSize: fontSize.bodyMd, color: colors.slate },

  warnBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.warnSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  warnText: { color: colors.navy, fontSize: fontSize.bodySm, flex: 1 },
  errorBanner: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, flex: 1 },

  hint: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: -spacing.xs },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  thumb: { width: 100, height: 100, borderRadius: radii.md, overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  thumbImg: { width: '100%', height: '100%' },
  thumbBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  footer: { padding: spacing.xl, gap: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  progressText: { color: colors.slate, fontSize: fontSize.bodySm, textAlign: 'center' },
  btnRow: { flexDirection: 'row', gap: spacing.md },
  // The quiet Next under a live Analyze primary — still a full 56pt row.
  queueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
  },
  nextBtnText: {
    fontSize: fontSize.bodyMd,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
  queueBtnText: { color: colors.slate, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  secondaryBtn: {
    flex: 1,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnDisabled: { opacity: 0.45 },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  primaryBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: { opacity: 0.4 },
  primaryBtnText: { color: colors.textInverse, fontWeight: fontWeight.bold, fontSize: fontSize.bodyLg },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { color: colors.slate, fontSize: fontSize.bodyMd },
});
