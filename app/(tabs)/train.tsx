import {
  ScrollView,
  View,
  Text,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useMemo, type PropsWithChildren } from 'react';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter } from '@/components/motion';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useTrainingQueueStore } from '@/lib/stores/trainingQueueStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
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

// First-paint-only entrance gate — same pattern as Home. Returning to the
// tab renders statically instead of replaying the stagger.
let trainEntrancePlayed = false;

/** Subtle iOS entrance: 8pt rise + fade on the snappy spring, by index. */
function Rise({
  index = 0,
  style,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(trainEntrancePlayed ? 1 : 0);

  useEffect(() => {
    if (progress.value === 1) return;
    const id = setTimeout(() => {
      progress.value = withSpring(1, motion.snappy);
    }, index * motion.staggerDelayMs);
    return () => clearTimeout(id);
    // Entrance runs once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value),
    transform: [{ translateY: (1 - progress.value) * spacing.sm }],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

export default function TrainScreen() {
  const router = useRouter();
  const corrections = useCorrectionsStore((s) => s.corrections);
  const queueItems = useTrainingQueueStore((s) => s.items);

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    trainEntrancePlayed = true;
  }, []);

  const pendingCount = useMemo(
    () => queueItems.filter((i) => i.status === 'pending').length,
    [queueItems],
  );
  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);

  return (
    <View style={styles.root}>
    <ScreenHeader title="Train" subtitle="Inspector review queue + AI calibration" />
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Queue cells — clean white cards, ink tabular-nums numbers. The
          pending count is the screen's single accent moment when work waits. */}
      <Rise index={0} style={styles.tilesRow}>
        <PressableScale
          style={styles.tile}
          accessibilityRole="button"
          accessibilityLabel={`Pending review. ${pendingCount} photos waiting.`}
          onPress={() => router.push('/swipe-review')}
        >
          <View style={styles.tileTopRow}>
            <Ionicons name="layers-outline" size={22} color={colors.textMuted} />
            <AnimatedCounter
              value={pendingCount}
              style={[styles.tileCount, pendingCount > 0 && styles.tileCountAccent]}
            />
          </View>
          <Text style={styles.tileLabel}>Pending review</Text>
          <Text style={styles.tileSub}>
            {pendingCount === 0
              ? 'All caught up.'
              : 'Photos waiting on your verdict'}
          </Text>
        </PressableScale>

        <View style={styles.tile}>
          <View style={styles.tileTopRow}>
            <Ionicons name="bar-chart-outline" size={22} color={colors.textMuted} />
            {accuracy === null ? (
              <Text style={styles.tileCount}>—</Text>
            ) : (
              <AnimatedCounter
                value={accuracy}
                format={(n) => `${Math.round(n)}%`}
                style={styles.tileCount}
              />
            )}
          </View>
          <Text style={styles.tileLabel}>Calibration accuracy</Text>
          <Text style={styles.tileSub}>
            {accuracy === null
              ? `Available after 5 corrections (${corrections.length}/5)`
              : `From ${corrections.length} corrections`}
          </Text>
        </View>
      </Rise>

      <Section title="AI Calibration" index={1}>
        <View style={styles.row}>
          <Ionicons name="git-branch-outline" size={22} color={colors.textMuted} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Calibrating to your inspection style</Text>
            <Text style={styles.rowSub}>{corrections.length} corrections recorded</Text>
          </View>
        </View>
      </Section>

      <Section title="Field tools" index={2}>
        <Row
          icon="compass-outline"
          label="Pitch gauge"
          sub="Measure roof slope with the accelerometer"
          onPress={() => router.push('/pitch-gauge')}
        />
        <Row
          icon="bulb-outline"
          label="Damage explainer"
          sub="What each damage type looks like"
          style={styles.rowBorder}
          onPress={() => router.push('/damage-explainer')}
        />
        <Row
          icon="walk-outline"
          label="Door knocking"
          sub="Live route stats + outcome logging"
          style={styles.rowBorder}
          onPress={() => router.push('/door-knocking')}
        />
      </Section>

      {/* Honest empty state — a compact quiet cell, not a centered void, and
          nothing fabricated (Drift #5). */}
      <Section title="Lessons" index={3}>
        <View style={styles.row}>
          <Ionicons name="school-outline" size={22} color={colors.textSubtle} />
          <Text style={styles.emptyText}>Lessons will appear here. Coming soon.</Text>
        </View>
      </Section>
    </ScrollView>
    </View>
  );
}

function Section({
  title,
  index = 0,
  children,
}: {
  title: string;
  index?: number;
  children: React.ReactNode;
}) {
  return (
    <Rise index={index}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </Rise>
  );
}

function Row({
  icon,
  label,
  sub,
  style,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  sub: string;
  style?: StyleProp<ViewStyle>;
  onPress?: () => void;
}) {
  return (
    <PressableScale
      style={[styles.row, style]}
      accessibilityRole="button"
      accessibilityLabel={`${label}. ${sub}`}
      onPress={onPress}
    >
      <Ionicons name={icon} size={22} color={colors.textMuted} />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowLabel}>{label}</Text>
        <Text style={styles.rowSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: {
    padding: spacing.xl,
    paddingTop: spacing.sm,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  tilesRow: { flexDirection: 'row', gap: spacing.md },
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    minHeight: 120,
    ...shadows.card,
  },
  tileTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  tileCount: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  tileCountAccent: { color: colors.accent },
  tileLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  tileSub: { fontSize: fontSize.bodySm, color: colors.textMuted },

  // iOS grouped-list section headers.
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },

  // Grouped white cards — rows carry their own padding + hairlines.
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.card,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.medium,
    color: colors.text,
  },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },

  emptyText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textMuted },
});
