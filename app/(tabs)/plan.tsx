import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter, PulseRing } from '@/components/motion';
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

type PlanView = 'today' | 'week';

// First-paint-only entrance gate — same pattern as Home. Returning to the
// tab renders statically instead of replaying the stagger.
let planEntrancePlayed = false;

/** Subtle iOS entrance: 8pt rise + fade on the snappy spring, by index. */
function Rise({
  index = 0,
  style,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(planEntrancePlayed ? 1 : 0);

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

// iOS-17 segmented control: fillQuiet track, white thumb sliding on the
// snappy spring. The 56pt wrapper + vertical hitSlop keeps the glove floor
// even though the visual track is 44pt.
const SEG_PAD = spacing.xs;

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / options.length : 0;
  const x = useSharedValue(0);
  const laidOut = useRef(false);

  useEffect(() => {
    if (segW <= 0) return;
    if (!laidOut.current) {
      // First layout: place the thumb without animating.
      laidOut.current = true;
      x.value = idx * segW;
      return;
    }
    x.value = withSpring(idx * segW, motion.snappy);
  }, [idx, segW, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={styles.segWrap}>
      <View
        style={styles.segTrack}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        {segW > 0 && (
          <Animated.View style={[styles.segThumb, { width: segW }, thumbStyle]} />
        )}
        {options.map((o) => (
          <Pressable
            key={o.id}
            style={styles.segBtn}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: value === o.id }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.id)}
          >
            <Text style={[styles.segLabel, value === o.id && styles.segLabelActive]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function PlanScreen() {
  const router = useRouter();
  const [view, setView] = useState<PlanView>('today');
  const inspections = useInspectionStore((s) => s.inspections);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const leads = useLeadStore((s) => s.leads);

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    planEntrancePlayed = true;
  }, []);

  const followUpsDue = useMemo(() => {
    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);
    return leads
      .filter(
        (l) =>
          l.followUpAt &&
          l.stage !== 'signed' &&
          l.stage !== 'lost' &&
          new Date(l.followUpAt).getTime() <= endOfDay.getTime(),
      )
      .sort(
        (a, b) =>
          new Date(a.followUpAt!).getTime() - new Date(b.followUpAt!).getTime(),
      );
  }, [leads]);

  const todayInspections = useMemo(() => {
    const now = new Date();
    const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const endOfDay = startOfDay + 24 * 60 * 60 * 1000;
    const endOfWeek = startOfDay + 7 * 24 * 60 * 60 * 1000;
    return inspections.filter((ins) => {
      const t = new Date(ins.createdAt).getTime();
      return view === 'today' ? t >= startOfDay && t < endOfDay : t >= startOfDay && t < endOfWeek;
    });
  }, [inspections, view]);

  const todayKnocks = useMemo(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const k = archive.reduce(
      (sum, s) =>
        sum +
        (new Date(s.startedAt).getTime() >= startOfDay.getTime() ? s.knocks.length : 0),
      0,
    );
    return k + (active?.knocks.length ?? 0);
  }, [archive, active]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View style={styles.root}>
    <ScreenHeader title="Plan" subtitle={today} />
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Quiet iOS stat cells — ink tabular-nums numbers, hairline dividers. */}
      <Rise index={0}>
        <View style={styles.statsCard}>
          <StatCell label="Inspections" value={todayInspections.length} />
          <View style={styles.statDivider} />
          <StatCell label="Knocks today" value={todayKnocks} />
          <View style={styles.statDivider} />
          <StatCell
            label="Active route"
            value={active ? active.knocks.length : null}
            live={!!active}
          />
        </View>
      </Rise>

      <Rise index={1}>
        <Segmented
          options={[
            { id: 'today', label: 'Today' },
            { id: 'week', label: 'This week' },
          ] as const}
          value={view}
          onChange={setView}
        />
      </Rise>

      {/* Day section — iOS grouped list; route stops are 64pt cells. */}
      <Rise index={2}>
        <Text style={styles.sectionLabel}>{view === 'today' ? 'Today' : 'This week'}</Text>
        {todayInspections.length === 0 ? (
          // Compact, top-anchored, honest — a hint in the flow, not a void.
          <View style={styles.empty}>
            <Ionicons name="calendar-outline" size={28} color={colors.textSubtle} />
            <Text style={styles.emptyTitle}>Nothing scheduled</Text>
            <Text style={styles.emptyBody}>
              Inspections, installs, and meetings will appear here once you add jobs.
            </Text>
          </View>
        ) : (
          <View style={styles.card}>
            {todayInspections.map((ins, i) => (
              <PressableScale
                key={ins.id}
                style={[styles.row, i > 0 && styles.rowBorder]}
                accessibilityRole="button"
                accessibilityLabel={`${ins.customerName}, ${ins.address}`}
                onPress={() => router.push(`/job/${ins.id}` as any)}
              >
                <Ionicons name="briefcase-outline" size={22} color={colors.textMuted} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{ins.customerName}</Text>
                  <Text style={styles.rowSub}>{ins.address}</Text>
                  <Text style={styles.rowMeta}>{ins.reportId}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </PressableScale>
            ))}
          </View>
        )}
      </Rise>

      {followUpsDue.length > 0 && (
        <Rise index={3}>
          <Text style={styles.sectionLabel}>Follow-ups due</Text>
          <View style={styles.card}>
            {followUpsDue.map((lead, i) => {
              const overdue =
                new Date(lead.followUpAt!).getTime() <
                new Date(new Date().setHours(0, 0, 0, 0)).getTime();
              return (
                <PressableScale
                  key={lead.id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  accessibilityRole="button"
                  accessibilityLabel={`${lead.customerName}, ${overdue ? 'overdue' : 'due today'}`}
                  onPress={() => router.push(`/lead/${lead.id}` as any)}
                >
                  <Ionicons
                    name={overdue ? 'alert-circle' : 'call-outline'}
                    size={22}
                    color={overdue ? colors.danger : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{lead.customerName}</Text>
                    <Text style={styles.rowSub}>{lead.address}</Text>
                    <Text style={[styles.rowMeta, overdue && { color: colors.danger }]}>
                      {overdue
                        ? `Overdue — ${new Date(lead.followUpAt!).toLocaleDateString()}`
                        : 'Due today'}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </PressableScale>
              );
            })}
          </View>
        </Rise>
      )}

      {/* Door-knocking is Plan's single accent moment; the rest stays quiet. */}
      <Rise index={4}>
        <Text style={styles.sectionLabel}>Quick actions</Text>
        <View style={styles.card}>
          <PressableScale
            style={styles.actionRow}
            accessibilityRole="button"
            accessibilityLabel="Start door-knocking route"
            onPress={() => router.push('/door-knocking')}
          >
            <Ionicons name="walk-outline" size={22} color={colors.accent} />
            <Text style={styles.actionText}>Start door-knocking route</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="Start mileage tracking"
            onPress={() => router.push('/mileage')}
          >
            <Ionicons name="car-outline" size={22} color={colors.textMuted} />
            <Text style={styles.actionText}>Start mileage tracking</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="New job"
            onPress={() => router.push('/new-job')}
          >
            <Ionicons name="add-circle-outline" size={22} color={colors.textMuted} />
            <Text style={styles.actionText}>New job</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
        </View>
      </Rise>
    </ScrollView>
    </View>
  );
}

function StatCell({
  label,
  value,
  live = false,
}: {
  label: string;
  value: number | null;
  live?: boolean;
}) {
  return (
    <View style={styles.statCell}>
      <View style={styles.statValueRow}>
        {live && <PulseRing size={8} color={colors.success} />}
        {value === null ? (
          <Text style={styles.statValue}>—</Text>
        ) : (
          <AnimatedCounter value={value} style={styles.statValue} />
        )}
      </View>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
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

  // Stats — one white card, hairline dividers, ink tabular-nums numbers.
  statsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingVertical: spacing.lg,
    ...shadows.card,
  },
  statCell: { flex: 1, alignItems: 'center' },
  statDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: spacing.xs,
    backgroundColor: colors.hairline,
  },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statValue: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
    marginTop: 2,
    textAlign: 'center',
  },

  // iOS-17 segmented control.
  segWrap: { minHeight: touchTarget.standard, justifyContent: 'center' },
  segTrack: {
    flexDirection: 'row',
    height: 44,
    borderRadius: radii.md,
    backgroundColor: colors.fillQuiet,
    padding: SEG_PAD,
  },
  segThumb: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  segLabelActive: { color: colors.text },

  // iOS grouped-list section headers.
  sectionLabel: {
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
    minHeight: touchTarget.preferred,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  rowTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 2 },
  rowMeta: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 2 },

  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  actionText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },

  // Compact top-anchored empty — thin icon, 15pt message, no card, no void.
  empty: {
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.xl,
  },
  emptyTitle: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  emptyBody: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
