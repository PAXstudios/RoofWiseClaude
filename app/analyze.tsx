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
import * as Haptics from 'expo-haptics';
import * as ImageManipulator from 'expo-image-manipulator';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { useAnalysisQueueStore } from '@/lib/stores/analysisQueueStore';
import { drainAnalysisQueue } from '@/lib/services/analysisQueue';
import { analyzeSlope } from '@/lib/services/analyzeSlope';
import { scorePhotos } from '@/lib/services/photoQuality';
import { isGeminiConfigured } from '@/lib/env';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
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

  const onPhotoLongPress = (photoIndex: number) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    Alert.alert('Edit photo', undefined, [
      {
        text: 'Rotate 90°',
        onPress: async () => {
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
        },
      },
      {
        text: 'Delete photo',
        style: 'destructive',
        onPress: () => {
          if (!inspection || !slope) return;
          removePhoto(inspection.id, slope.id, photoIndex);
          toast({ tone: 'warn', title: 'Photo deleted' });
        },
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
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
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
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
      Alert.alert(
        'AI not connected',
        'Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local to enable damage detection.',
      );
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
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      if (result.failed > 0) {
        setError(`${result.failed} photo${result.failed === 1 ? '' : 's'} could not be analyzed.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
    } finally {
      setRunning(false);
      setProgress(null);
    }
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
        <View style={styles.card}>
          <Text style={styles.cardTitle}>
            {slope.photoPaths.length} photo{slope.photoPaths.length === 1 ? '' : 's'} captured
          </Text>
          <Text style={styles.cardSub}>
            {unanalyzed.length === 0
              ? 'All photos have been analyzed. Re-run to override existing markers.'
              : `${unanalyzed.length} photo${unanalyzed.length === 1 ? '' : 's'} waiting for analysis.`}
          </Text>
        </View>

        {!isGeminiConfigured && (
          <View style={styles.warnBanner}>
            <Ionicons name="information-circle-outline" size={20} color={colors.warn} />
            <Text style={styles.warnText}>
              Gemini key missing. Add EXPO_PUBLIC_GEMINI_API_KEY to .env.local.
            </Text>
          </View>
        )}

        {error && (
          <View style={styles.errorBanner}>
            <Ionicons name="warning-outline" size={20} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}

        <Text style={styles.section}>Photos</Text>
        <Text style={styles.hint}>Tap to edit detections · Long-press to rotate or delete.</Text>
        <View style={styles.grid}>
          {slope.photoPaths.map((uri, i) => {
            const analyzed = (slope.analyzedPhotoIndices ?? []).includes(i);
            return (
              <Pressable
                key={i}
                style={styles.thumb}
                onPress={() =>
                  router.push({
                    pathname: '/edit-detection',
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
                <View
                  style={[
                    styles.thumbBadge,
                    { backgroundColor: analyzed ? colors.success : colors.surfaceMuted },
                  ]}
                >
                  <Ionicons
                    name={analyzed ? 'checkmark' : 'ellipse-outline'}
                    size={14}
                    color={analyzed ? colors.textInverse : colors.slate}
                  />
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
        <View style={styles.btnRow}>
          <Pressable
            style={[styles.secondaryBtn, running && { opacity: 0.5 }]}
            disabled={running || slope.photoPaths.length === 0}
            onPress={() => run(false)}
          >
            <Text style={styles.secondaryBtnText}>Re-analyze all</Text>
          </Pressable>
          <Pressable
            style={[styles.primaryBtn, (running || unanalyzed.length === 0) && styles.primaryBtnDisabled]}
            disabled={running || unanalyzed.length === 0}
            onPress={() => run(true)}
          >
            {running ? (
              <ActivityIndicator color={colors.textInverse} />
            ) : (
              <Text style={styles.primaryBtnText}>
                Analyze {unanalyzed.length || ''} new
              </Text>
            )}
          </Pressable>
        </View>
        <Pressable
          style={[styles.queueBtn, (running || unanalyzed.length === 0) && { opacity: 0.4 }]}
          disabled={running || unanalyzed.length === 0}
          onPress={() => {
            const job = enqueueAnalysis({
              inspectionId: inspection.id,
              slopeId: slope.id,
              slopeLabel: slope.orientation,
            });
            if (!job) {
              toast({ tone: 'info', title: 'Already queued' });
              return;
            }
            toast({
              tone: 'success',
              title: 'Added to queue',
              body: 'Runs automatically while the app is open — you\'ll get a notification.',
            });
            drainAnalysisQueue().catch(() => {});
            router.back();
          }}
        >
          <Ionicons name="time-outline" size={16} color={colors.slate} />
          <Text style={styles.queueBtnText}>
            Queue for auto-run instead
          </Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  reportId: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold },
  title: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },

  scroll: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
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

  section: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
    marginTop: spacing.md,
  },
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
  queueBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.small,
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
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
  primaryBtn: {
    flex: 1,
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
