import { useState } from 'react';
import {
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useTrainingQueueStore } from '@/lib/stores/trainingQueueStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useToastStore } from '@/lib/stores/toastStore';
import {
  DAMAGE_CATEGORY_LABELS,
  type TrainingItem,
} from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const { width: SCREEN_W } = Dimensions.get('window');
const SWIPE_THRESHOLD = SCREEN_W * 0.3;

type Verdict = 'accept' | 'edit' | 'skip' | 'not_damage';

export default function SwipeReview() {
  const router = useRouter();
  const items = useTrainingQueueStore((s) => s.items.filter((i) => i.status === 'pending'));
  const setStatus = useTrainingQueueStore((s) => s.setStatus);
  const recordCorrection = useCorrectionsStore((s) => s.record);
  const toast = useToastStore((s) => s.show);

  const [index, setIndex] = useState(0);
  const current = items[index];

  const x = useSharedValue(0);
  const y = useSharedValue(0);

  const handleVerdict = (verdict: Verdict, item: TrainingItem) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);

    const original = item.originalAnalysis;
    let corrected = original;

    if (verdict === 'accept') {
      corrected = original;
      setStatus(item.id, 'reviewed');
    } else if (verdict === 'not_damage') {
      corrected = { findings: [], markers: [] };
      setStatus(item.id, 'reviewed');
    } else if (verdict === 'skip') {
      setStatus(item.id, 'discarded');
    } else if (verdict === 'edit') {
      // Route to detail editor; the queue item stays pending until they save.
      router.push({
        pathname: '/edit-detection',
        params: { inspectionId: item.inspectionId, slopeId: item.slopeId ?? '', photoIndex: '0' },
      });
      return;
    }

    if (verdict === 'accept' || verdict === 'not_damage') {
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
    }

    advance(verdict);
  };

  const advance = (verdict: Verdict) => {
    if (verdict === 'accept') toast({ tone: 'success', title: 'Accepted' });
    else if (verdict === 'not_damage') toast({ tone: 'info', title: 'Marked not damage' });
    else if (verdict === 'skip') toast({ tone: 'warn', title: 'Skipped' });

    x.value = 0;
    y.value = 0;
    setIndex((i) => i + 1);
  };

  const pan = Gesture.Pan()
    .onUpdate((e) => {
      x.value = e.translationX;
      y.value = e.translationY;
    })
    .onEnd(() => {
      'worklet';
      if (!current) return;
      if (x.value > SWIPE_THRESHOLD) {
        x.value = withTiming(SCREEN_W * 1.5);
        runOnJS(handleVerdict)('accept', current);
      } else if (x.value < -SWIPE_THRESHOLD) {
        x.value = withTiming(-SCREEN_W * 1.5);
        runOnJS(handleVerdict)('edit', current);
      } else if (y.value < -SWIPE_THRESHOLD) {
        y.value = withTiming(-SCREEN_W);
        runOnJS(handleVerdict)('skip', current);
      } else if (y.value > SWIPE_THRESHOLD) {
        y.value = withTiming(SCREEN_W);
        runOnJS(handleVerdict)('not_damage', current);
      } else {
        x.value = withSpring(0);
        y.value = withSpring(0);
      }
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: x.value },
      { translateY: y.value },
      { rotateZ: `${(x.value / SCREEN_W) * 15}deg` },
    ],
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
          {index + 1} of {items.length}
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
          </Animated.View>
        </GestureDetector>
      </View>

      <View style={styles.actions}>
        <ActionButton
          icon="close"
          label="Not damage"
          tone={colors.slate}
          onPress={() => handleVerdict('not_damage', current)}
        />
        <ActionButton
          icon="create-outline"
          label="Edit"
          tone={colors.orange}
          onPress={() => handleVerdict('edit', current)}
        />
        <ActionButton
          icon="arrow-up"
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

      <Text style={styles.swipeHint}>
        Swipe right to accept · left to edit · up to skip · down to mark "not damage".
      </Text>
    </SafeAreaView>
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
    <Pressable style={[styles.actionBtn, { backgroundColor: tone }]} onPress={onPress}>
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

  swipeHint: { color: colors.slate, fontSize: fontSize.caption, textAlign: 'center', padding: spacing.md },

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
