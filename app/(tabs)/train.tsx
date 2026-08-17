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
import { useEffect, useMemo, type PropsWithChildren, type ReactNode } from 'react';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Svg, { Circle } from 'react-native-svg';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Aurora } from '@/components/glass/Aurora';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useTrainingQueueStore } from '@/lib/stores/trainingQueueStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import {
  DAMAGE_CATEGORY_LABELS,
  type DamageCategory,
  type TrainingItem,
} from '@/lib/models/types';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  gradients,
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

/* ─────────────────────────── accuracy dial ───────────────────────────── */
// The cinematic moment: an SVG progress ring built ONLY from real correction
// data (`computeProfile` → `overallAccuracy`). Below the 5-correction floor
// there is no honest percentage to show, so the ring renders as an empty
// track with a plain "not enough data yet" message — never a dial reading
// a fabricated 0% (Drift #5: that would read as "the AI is always wrong").

const DIAL_SIZE = 176;
const DIAL_STROKE = 14;
const DIAL_RADIUS = (DIAL_SIZE - DIAL_STROKE) / 2;
const DIAL_CIRCUMFERENCE = 2 * Math.PI * DIAL_RADIUS;
const DIAL_CENTER = DIAL_SIZE / 2;

/** Tier colour from the real number — never decoration, always a reading. */
function accuracyTint(accuracy: number): string {
  if (accuracy >= 85) return colors.success;
  if (accuracy >= 60) return colors.warn;
  return colors.danger;
}

/**
 * The ring's fill is a plain, honestly-computed `strokeDashoffset` — not a
 * per-frame animated SVG attribute. This repo's only proven-on-web reanimated
 * pattern for SVG art (RadarArt.tsx, onboarding/scenes.tsx) is a spring on a
 * wrapping `Animated.View`'s transform/opacity, never a raw shape attribute
 * via `useAnimatedProps`/`createAnimatedComponent`; staying inside that
 * pattern keeps the web export safe. The ring still reads as "spring
 * animated" — it springs into place (scale + fade) exactly like a radar cell.
 */
function AccuracyRing({ value, color }: { value: number | null; color: string }) {
  const enter = useSharedValue(0);

  useEffect(() => {
    enter.value = withSpring(1, motion.gentle);
  }, [enter]);

  const enterStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [{ scale: 0.82 + enter.value * 0.18 }],
  }));

  const pct = value === null ? 0 : Math.max(0, Math.min(100, value)) / 100;
  const dashOffset = DIAL_CIRCUMFERENCE * (1 - pct);

  return (
    <Animated.View style={enterStyle}>
      <Svg width={DIAL_SIZE} height={DIAL_SIZE}>
        {/* Track. `brand.royalDeep` rather than a 14%-white hairline: on the
            near-black hero the old stroke was effectively invisible, so an
            un-calibrated dial read as a broken card. Still clearly dimmer
            than any value arc, so the two never compete. */}
        <Circle
          cx={DIAL_CENTER}
          cy={DIAL_CENTER}
          r={DIAL_RADIUS}
          stroke={brand.royalDeep}
          strokeWidth={DIAL_STROKE}
          fill="none"
        />
        {value !== null && (
          <Circle
            cx={DIAL_CENTER}
            cy={DIAL_CENTER}
            r={DIAL_RADIUS}
            stroke={color}
            strokeWidth={DIAL_STROKE}
            fill="none"
            strokeLinecap="round"
            strokeDasharray={`${DIAL_CIRCUMFERENCE} ${DIAL_CIRCUMFERENCE}`}
            strokeDashoffset={dashOffset}
            rotation={-90}
            origin={`${DIAL_CENTER}, ${DIAL_CENTER}`}
          />
        )}
      </Svg>
    </Animated.View>
  );
}

function AccuracyDial({
  accuracy,
  totalCorrections,
}: {
  accuracy: number | null;
  totalCorrections: number;
}) {
  const ready = accuracy !== null;
  const tint = ready ? accuracyTint(accuracy!) : brand.royal;
  const remaining = Math.max(0, 5 - totalCorrections);

  return (
    <View style={styles.dialShell}>
      <View style={styles.dialCard}>
        {/* Same hero language as WeatherHero's frame: the brand sky plus the
            drifting `Aurora` from onboarding. The card was a near-flat black
            with nothing brand about it. */}
        <LinearGradient
          colors={gradients.stormNight}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Aurora transparent />
        <View style={styles.dialRingWrap}>
          <AccuracyRing value={accuracy} color={tint} />
          <View style={styles.dialCenter} pointerEvents="none">
            {ready ? (
              <Text style={styles.dialValue} maxFontSizeMultiplier={1.2}>
                {accuracy}
                <Text style={styles.dialUnit}>%</Text>
              </Text>
            ) : (
              <Ionicons name="hourglass-outline" size={26} color={colors.textInverse} style={styles.dialIcon} />
            )}
            <Text style={styles.dialCaption}>ACCURACY</Text>
          </View>
        </View>

        <View style={styles.dialFooter}>
          {ready ? (
            <Text style={styles.dialFooterText}>
              Calibrated from {totalCorrections} correction{totalCorrections === 1 ? '' : 's'}
            </Text>
          ) : totalCorrections === 0 ? (
            <>
              <Text style={styles.dialFooterTitle}>Not enough data yet</Text>
              <Text style={styles.dialFooterText}>
                Review AI detections in the queue below to start building your score.
              </Text>
            </>
          ) : (
            <>
              <Text style={styles.dialFooterTitle}>Almost there</Text>
              <Text style={styles.dialFooterText}>
                {remaining} more correction{remaining === 1 ? '' : 's'} to unlock your accuracy score.
              </Text>
            </>
          )}
        </View>
      </View>
    </View>
  );
}

/* ─────────────────────────── review queue ────────────────────────────── */

const QUEUE_SHOWN = 6;

function describeItem(item: TrainingItem): string {
  const markers = item.originalAnalysis.markers;
  if (markers.length === 0) return 'No markers flagged';
  const counts = new Map<DamageCategory, number>();
  for (const m of markers) counts.set(m.category, (counts.get(m.category) ?? 0) + 1);
  const [topCategory] = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return `${markers.length} marker${markers.length === 1 ? '' : 's'} · ${DAMAGE_CATEGORY_LABELS[topCategory]}`;
}

function formatRelative(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function QueueCell({
  item,
  bordered,
  onPress,
}: {
  item: TrainingItem;
  bordered: boolean;
  onPress: () => void;
}) {
  const label = describeItem(item);
  return (
    <PressableScale
      style={[styles.queueCell, bordered && styles.rowBorder]}
      accessibilityRole="button"
      accessibilityLabel={`Review photo. ${label}. Enqueued ${formatRelative(item.enqueuedAt)}.`}
      onPress={onPress}
    >
      <Image
        source={{ uri: item.photoPath }}
        style={styles.queueThumb}
        contentFit="cover"
        transition={150}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.queueTitle} numberOfLines={1}>{label}</Text>
        <Text style={styles.queueSub}>{formatRelative(item.enqueuedAt)}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </PressableScale>
  );
}

/* ─────────────────────────── screen ───────────────────────────────────── */

export default function TrainScreen() {
  const router = useRouter();
  const corrections = useCorrectionsStore((s) => s.corrections);
  const queueItems = useTrainingQueueStore((s) => s.items);

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    trainEntrancePlayed = true;
  }, []);

  const pending = useMemo(
    () => queueItems.filter((i) => i.status === 'pending'),
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
      {/* The one cinematic moment on this screen — everything else stays quiet. */}
      <Rise index={0}>
        <AccuracyDial accuracy={accuracy} totalCorrections={corrections.length} />
      </Rise>

      <Rise index={1}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.sectionTitle}>Review Queue</Text>
          {pending.length > 0 && (
            <Text style={styles.sectionMeta}>{pending.length} pending</Text>
          )}
        </View>
        {pending.length === 0 ? (
          <View style={styles.card}>
            <View style={styles.row}>
              <IconChip name="checkmark-circle" tone="green" size="sm" />
              <Text style={styles.emptyRowText}>
                All caught up — no photos waiting on your verdict.
              </Text>
            </View>
          </View>
        ) : (
          <View style={styles.card}>
            {pending.slice(0, QUEUE_SHOWN).map((item, i) => (
              <QueueCell
                key={item.id}
                item={item}
                bordered={i > 0}
                onPress={() => router.push('/swipe-review')}
              />
            ))}
            {pending.length > QUEUE_SHOWN && (
              <PressableScale
                style={[styles.row, styles.rowBorder]}
                accessibilityRole="button"
                accessibilityLabel={`See all ${pending.length} pending photos`}
                onPress={() => router.push('/swipe-review')}
              >
                <IconChip name="layers-outline" tone="quiet" size="sm" />
                <Text style={styles.seeAllText}>
                  See all {pending.length} pending
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </PressableScale>
            )}
          </View>
        )}
      </Rise>

      <Section title="Field tools" index={2}>
        <Row
          icon="compass-outline"
          tone="blue"
          label="Pitch gauge"
          sub="Measure roof slope with the accelerometer"
          onPress={() => router.push('/pitch-gauge')}
        />
        <Row
          icon="bulb-outline"
          tone="orange"
          label="Damage explainer"
          sub="What each damage type looks like"
          style={styles.rowBorder}
          onPress={() => router.push('/damage-explainer')}
        />
        <Row
          icon="walk-outline"
          tone="purple"
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
          <IconChip name="school-outline" tone="quiet" size="sm" />
          <Text style={styles.emptyRowText}>Lessons will appear here. Coming soon.</Text>
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
  children: ReactNode;
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
  tone,
  label,
  sub,
  style,
  onPress,
}: {
  icon: IoniconName;
  tone: ChipTone;
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
      <IconChip name={icon} tone={tone} size="sm" />
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

  // Accuracy dial — the one dark, cinematic card on this screen.
  dialShell: { borderRadius: radii.xl, ...shadows.hero },
  dialCard: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    alignItems: 'center',
    paddingVertical: spacing.xxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.lg,
    // Painted under the gradient so the card is never briefly transparent.
    backgroundColor: brand.royalInk,
  },
  dialRingWrap: {
    width: DIAL_SIZE,
    height: DIAL_SIZE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dialCenter: {
    position: 'absolute',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  dialIcon: { marginBottom: 2 },
  dialValue: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.regular,
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.5,
  },
  dialUnit: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.regular,
    color: colors.textInverse,
  },
  dialCaption: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    // Full opacity: at 11pt over near-black, a 0.6 wash was unreadable in
    // sun (Drift #1). Small and bold is the contrast device here, not dimness.
    color: colors.textInverse,
    letterSpacing: 1.2,
  },
  dialFooter: { alignItems: 'center', gap: 2 },
  dialFooterTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },
  dialFooterText: {
    fontSize: fontSize.bodySm,
    color: colors.textInverse,
    opacity: 0.72,
    textAlign: 'center',
  },

  // iOS grouped-list section headers.
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionMeta: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.accent,
    fontVariant: ['tabular-nums'],
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

  emptyRowText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textMuted },
  seeAllText: { flex: 1, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },

  // Crafted review-queue cell — a real inspection photo, never a placeholder.
  queueCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  queueThumb: {
    width: 48,
    height: 48,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceMuted,
  },
  queueTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  queueSub: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 2 },
});
