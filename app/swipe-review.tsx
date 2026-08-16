import { useCallback, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  Dimensions,
  Modal,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTrainingQueueStore } from '@/lib/stores/trainingQueueStore';
import {
  useCorrectionsStore,
  type ConfidenceStars,
} from '@/lib/stores/correctionsStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  DAMAGE_CATEGORY_LABELS,
  type TrainingItem,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const { width: SCREEN_W, height: SCREEN_H } = Dimensions.get('window');
const H_THRESHOLD = SCREEN_W * 0.3;
const V_THRESHOLD = SCREEN_H * 0.15;

/** Pitch Deck gesture contract: right = accept, left = reject, up = correct. */
type Verdict = 'accept' | 'reject' | 'correct' | 'skip';

const STARS: ConfidenceStars[] = [1, 2, 3, 4, 5];

type AwaitingCorrection = {
  itemId: string;
  inspectionId: string;
  knownCorrectionIds: string[];
};

export default function SwipeReview() {
  const router = useRouter();
  const allItems = useTrainingQueueStore((s) => s.items);
  const setStatus = useTrainingQueueStore((s) => s.setStatus);
  const recordCorrection = useCorrectionsStore((s) => s.record);
  const setConfidence = useCorrectionsStore((s) => s.setConfidence);
  const toast = useToastStore((s) => s.show);

  const [index, setIndex] = useState(0);
  // Items handled in this session stay in the deck so the queue filter
  // shifting underneath us can't skip the next card.
  const [handledIds, setHandledIds] = useState<string[]>([]);
  const [rating, setRating] = useState<{ correctionId: string; itemId: string } | null>(null);
  const [previewStars, setPreviewStars] = useState(0);

  // Set when we hand off to the editor; read back when this screen refocuses.
  const awaitingRef = useRef<AwaitingCorrection | null>(null);

  const deck = useMemo(() => {
    const handled = new Set(handledIds);
    return allItems
      .filter((i) => i.status === 'pending' || handled.has(i.id))
      .sort((a, b) => a.enqueuedAt.localeCompare(b.enqueuedAt));
  }, [allItems, handledIds]);

  const current = deck[index];

  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const advance = useCallback(
    (itemId: string) => {
      setHandledIds((prev) => (prev.includes(itemId) ? prev : [...prev, itemId]));
      setIndex((i) => i + 1);
      x.value = 0;
      y.value = 0;
    },
    [x, y],
  );

  /** Resolve the queue item back to a real slope photo for the editor. */
  const resolveEditTarget = (item: TrainingItem) => {
    const inspection = useInspectionStore
      .getState()
      .inspections.find((i) => i.id === item.inspectionId);
    if (!inspection) return null;

    const slope =
      inspection.slopes.find((s) => s.id === item.slopeId) ??
      inspection.slopes.find((s) => s.photoPaths.includes(item.photoPath));
    if (!slope) return null;

    // No fallback index: if the queued photo is gone (deleted, which renumbers
    // photoPaths) the "next best" photo is a DIFFERENT photo, and editing it
    // would file the reviewer's correction against the wrong detection.
    const photoIndex = slope.photoPaths.indexOf(item.photoPath);
    if (photoIndex < 0) return null;
    return { slopeId: slope.id, photoIndex };
  };

  /** Up-swipe: hand the detection to the marker editor, then ask for stars. */
  const openCorrection = (item: TrainingItem) => {
    const target = resolveEditTarget(item);
    if (!target) {
      x.value = withSpring(0, motion.quick);
      y.value = withSpring(0, motion.quick);
      toast({
        tone: 'warn',
        title: 'Cannot open editor',
        body: 'The original photo for this detection is no longer on this device.',
      });
      return;
    }

    awaitingRef.current = {
      itemId: item.id,
      inspectionId: item.inspectionId,
      knownCorrectionIds: useCorrectionsStore.getState().corrections.map((c) => c.id),
    };

    router.push({
      pathname: '/edit-detection',
      params: {
        inspectionId: item.inspectionId,
        slopeId: target.slopeId,
        photoIndex: String(target.photoIndex),
      },
    });
  };

  // Back from the editor: if a correction actually landed, ask how sure they are.
  useFocusEffect(
    useCallback(() => {
      const awaiting = awaitingRef.current;
      if (!awaiting) return;
      awaitingRef.current = null;

      const known = new Set(awaiting.knownCorrectionIds);
      const fresh = useCorrectionsStore
        .getState()
        .corrections.find((c) => !known.has(c.id) && c.inspectionId === awaiting.inspectionId);

      // No new correction → they backed out. Leave the card exactly where it was.
      if (!fresh) return;

      setStatus(awaiting.itemId, 'reviewed');
      setPreviewStars(0);
      setRating({ correctionId: fresh.id, itemId: awaiting.itemId });
    }, [setStatus]),
  );

  const commitRating = (stars: ConfidenceStars) => {
    if (!rating) return;
    Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    setConfidence(rating.correctionId, stars, { via: 'swipe_correct' });
    toast({
      tone: 'success',
      title: 'Correction saved',
      body: `Confidence logged at ${stars} of 5.`,
    });
    const { itemId } = rating;
    setRating(null);
    setPreviewStars(0);
    advance(itemId);
  };

  const dismissRating = () => {
    if (!rating) return;
    // The correction itself is already saved by the editor — only the star is
    // being skipped, so no second toast here.
    Haptics.selectionAsync();
    const { itemId } = rating;
    setRating(null);
    setPreviewStars(0);
    advance(itemId);
  };

  const handleVerdict = (verdict: Verdict, item: TrainingItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    if (verdict === 'correct') {
      openCorrection(item);
      return;
    }

    const original = item.originalAnalysis;

    if (verdict === 'skip') {
      setStatus(item.id, 'discarded');
      toast({ tone: 'warn', title: 'Skipped' });
      advance(item.id);
      return;
    }

    const corrected =
      verdict === 'accept' ? original : { findings: [], markers: [] };

    setStatus(item.id, 'reviewed');
    recordCorrection({
      inspectionId: item.inspectionId,
      photoId: `${item.slopeId ?? 'unknown'}#queue`,
      slopeId: item.slopeId,
      correctionType: verdict === 'accept' ? 'swipe_accept' : 'swipe_reject',
      categoriesAffected: Array.from(new Set(original.markers.map((m) => m.category))),
      originalDetection: original,
      correctedDetection: corrected,
      delta: { verdict },
    });

    toast(
      verdict === 'accept'
        ? { tone: 'success', title: 'Accepted' }
        : { tone: 'info', title: 'Marked not damage' },
    );
    advance(item.id);
  };

  const pan = Gesture.Pan()
    .enabled(!rating)
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY;
    })
    .onEnd(() => {
      'worklet';
      if (!current) return;
      const horizontal = Math.abs(x.value) > Math.abs(y.value);

      if (horizontal && x.value > H_THRESHOLD) {
        x.value = withTiming(SCREEN_W * 1.5);
        runOnJS(handleVerdict)('accept', current);
      } else if (horizontal && x.value < -H_THRESHOLD) {
        x.value = withTiming(-SCREEN_W * 1.5);
        runOnJS(handleVerdict)('reject', current);
      } else if (!horizontal && y.value < -V_THRESHOLD) {
        // Correct hands off to the editor and comes back to this same card,
        // so it springs home rather than flying off-screen.
        x.value = withSpring(0, motion.quick);
        y.value = withSpring(0, motion.quick);
        runOnJS(handleVerdict)('correct', current);
      } else if (!horizontal && y.value > V_THRESHOLD) {
        y.value = withTiming(SCREEN_H);
        runOnJS(handleVerdict)('skip', current);
      } else {
        x.value = withSpring(0, motion.quick);
        y.value = withSpring(0, motion.quick);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotateZ: `${(x.value / SCREEN_W) * 15}deg` },
    ],
  }));

  const acceptCue = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [0, H_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));
  const rejectCue = useAnimatedStyle(() => ({
    opacity: interpolate(x.value, [-H_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));
  const correctCue = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [-V_THRESHOLD, 0], [1, 0], Extrapolation.CLAMP),
  }));
  const skipCue = useAnimatedStyle(() => ({
    opacity: interpolate(y.value, [0, V_THRESHOLD], [0, 1], Extrapolation.CLAMP),
  }));

  if (!current) {
    return (
      <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.header}>
          <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
            <Ionicons name="chevron-back" size={26} color={colors.navy} />
          </Pressable>
          <Text style={styles.headerTitle}>Swipe Review</Text>
        </View>
        <View style={styles.empty}>
          <Ionicons name="checkmark-done-circle" size={64} color={colors.success} />
          <Text style={styles.emptyTitle}>All caught up</Text>
          <Text style={styles.emptyBody}>
            Low-confidence detections from analysis will queue up here for your review.
          </Text>
          <Pressable style={styles.doneBtn} onPress={() => router.back()}>
            <Text style={styles.doneBtnText}>Back to Train</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const detected = current.originalAnalysis.findings.filter((f) => f.detected);
  const avgConfidence = current.originalAnalysis.markers.length === 0
    ? 0
    : Math.round(
        current.originalAnalysis.markers.reduce((s, m) => s + m.confidence, 0) /
          current.originalAnalysis.markers.length,
      );

  return (
    <SafeAreaView style={styles.root} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="close" size={24} color={colors.navy} />
        </Pressable>
        <Text style={styles.headerTitle}>
          {index + 1} of {deck.length}
        </Text>
      </View>

      <View style={styles.cardWrap}>
        <GestureDetector gesture={pan}>
          <Animated.View style={[styles.card, cardStyle]}>
            <Image source={{ uri: current.photoPath }} style={styles.cardImage} />

            <View style={styles.cardMeta}>
              <Text style={styles.cardHeader}>
                {detected.length > 0
                  ? DAMAGE_CATEGORY_LABELS[detected[0].label].toUpperCase()
                  : 'NO DAMAGE'}
              </Text>
              <Text style={styles.cardSub}>
                {current.originalAnalysis.markers.length} markers · {avgConfidence}% confidence
              </Text>
              {detected.slice(0, 3).map((f) => (
                <Text key={f.label} style={styles.findingLine}>
                  • {DAMAGE_CATEGORY_LABELS[f.label]} × {f.count}
                </Text>
              ))}
            </View>

            <View style={styles.cueLayer} pointerEvents="none">
              <Animated.View style={[styles.cue, correctCue]}>
                <Ionicons name="arrow-up" size={20} color={colors.accent} />
                <Text style={[styles.cueText, { color: colors.accent }]}>CORRECT</Text>
              </Animated.View>
              <View style={styles.cueMiddle}>
                <Animated.View style={[styles.cue, rejectCue]}>
                  <Ionicons name="arrow-back" size={20} color={colors.slate} />
                  <Text style={[styles.cueText, { color: colors.slate }]}>REJECT</Text>
                </Animated.View>
                <Animated.View style={[styles.cue, acceptCue]}>
                  <Text style={[styles.cueText, { color: colors.success }]}>ACCEPT</Text>
                  <Ionicons name="arrow-forward" size={20} color={colors.success} />
                </Animated.View>
              </View>
              <Animated.View style={[styles.cue, skipCue]}>
                <Ionicons name="arrow-down" size={20} color={colors.info} />
                <Text style={[styles.cueText, { color: colors.info }]}>SKIP</Text>
              </Animated.View>
            </View>
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.hintRow}>
        <Hint icon="arrow-back" label="Reject" tone={colors.slate} />
        <Hint icon="arrow-up" label="Correct" tone={colors.accent} />
        <Hint icon="arrow-down" label="Skip" tone={colors.info} />
        <Hint icon="arrow-forward" label="Accept" tone={colors.success} />
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon="close"
          label="Reject"
          tone={colors.slate}
          onPress={() => handleVerdict('reject', current)}
        />
        <ActionButton
          icon="create-outline"
          label="Correct"
          tone={colors.orange}
          onPress={() => handleVerdict('correct', current)}
        />
        <ActionButton
          icon="play-skip-forward"
          label="Skip"
          tone={colors.info}
          onPress={() => handleVerdict('skip', current)}
        />
        <ActionButton
          icon="checkmark"
          label="Accept"
          tone={colors.success}
          onPress={() => handleVerdict('accept', current)}
        />
      </View>

      <Modal
        visible={rating !== null}
        transparent
        animationType="fade"
        onRequestClose={dismissRating}
      >
        <View style={styles.sheetScrim}>
          <View style={styles.sheet}>
            <Text style={styles.sheetTitle}>How sure are you?</Text>
            <Text style={styles.sheetBody}>
              Tells the learning loop how much to trust this correction.
            </Text>
            <View style={styles.starRow}>
              {STARS.map((n) => (
                <Pressable
                  key={n}
                  style={styles.starBtn}
                  onPressIn={() => setPreviewStars(n)}
                  onPress={() => commitRating(n)}
                  accessibilityRole="button"
                  accessibilityLabel={`${n} of 5 confidence`}
                >
                  <Ionicons
                    name={n <= previewStars ? 'star' : 'star-outline'}
                    size={38}
                    color={n <= previewStars ? colors.accent : colors.borderStrong}
                  />
                </Pressable>
              ))}
            </View>
            <Pressable style={styles.sheetSkip} onPress={dismissRating}>
              <Text style={styles.sheetSkipText}>Not sure — skip</Text>
            </Pressable>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function Hint({
  icon,
  label,
  tone,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
}) {
  return (
    <View style={styles.hint}>
      <Ionicons name={icon} size={14} color={tone} />
      <Text style={styles.hintText}>{label}</Text>
    </View>
  );
}

function ActionButton({
  icon,
  label,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  tone: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={[styles.actionBtn, { backgroundColor: tone }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Ionicons name={icon} size={26} color={colors.textInverse} />
      <Text style={styles.actionLabel}>{label}</Text>
    </Pressable>
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
  headerTitle: { flex: 1, fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy, textAlign: 'center' },

  cardWrap: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  card: {
    width: '100%',
    height: 460,
    borderRadius: radii.xl,
    backgroundColor: colors.surface,
    overflow: 'hidden',
    ...shadows.pressed,
  },
  cardImage: { flex: 1, width: '100%' },
  cardMeta: { padding: spacing.lg, backgroundColor: colors.surface, gap: 4 },
  cardHeader: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.orange, letterSpacing: 0.5 },
  cardSub: { fontSize: fontSize.bodySm, color: colors.slate },
  findingLine: { fontSize: fontSize.bodySm, color: colors.navy, marginTop: 2 },

  cueLayer: {
    ...StyleSheet.absoluteFillObject,
    padding: spacing.lg,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cueMiddle: {
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  cueText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, letterSpacing: 0.5 },

  hintRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.sm,
  },
  hint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  hintText: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: fontWeight.semibold },

  actions: {
    flexDirection: 'row',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  actionBtn: {
    flex: 1,
    minHeight: touchTarget.sticky,
    borderRadius: radii.card,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    ...shadows.card,
  },
  actionLabel: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  sheetScrim: { flex: 1, backgroundColor: colors.scrim, justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radii.xl,
    borderTopRightRadius: radii.xl,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.xl,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  sheetTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    textAlign: 'center',
  },
  sheetBody: {
    fontSize: fontSize.bodyMd,
    color: colors.textMuted,
    textAlign: 'center',
    paddingHorizontal: spacing.sm,
  },
  starRow: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  starBtn: {
    flex: 1,
    minWidth: touchTarget.standard,
    minHeight: touchTarget.sticky,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.card,
    backgroundColor: colors.surfaceMuted,
  },
  sheetSkip: {
    marginTop: spacing.md,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetSkipText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.textMuted },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.navy },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
  doneBtn: {
    marginTop: spacing.xl,
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  doneBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
});
