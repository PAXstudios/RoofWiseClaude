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
import { useEffect, useMemo, useRef, useState, type PropsWithChildren, type ReactNode } from 'react';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { LinearGradient } from 'expo-linear-gradient';
import { Aurora } from '@/components/glass/Aurora';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter, PulseRing } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { IconChip, CHIP_TONES, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import type { Inspection, Lead, KnockSession } from '@/lib/models/types';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  gradients,
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

/** One stop on Today's rail — a real point in time from a real store. */
type ScheduleItem =
  | { key: string; time: number; kind: 'inspection'; ins: Inspection }
  | { key: string; time: number; kind: 'followup'; lead: Lead; overdue: boolean }
  | { key: string; time: number; kind: 'route'; session: KnockSession };

const STATUS_PILL_TONE: Record<Inspection['status'], PillTone> = {
  lead: 'neutral',
  scheduled: 'info',
  in_progress: 'warn',
  complete: 'success',
};

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
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

  // Today's rail — every stop is a genuinely persisted timestamp: an
  // inspection actually logged today, a lead follow-up actually due, or the
  // door-knocking route actually in progress. Nothing here is invented
  // (Drift #5); "actual scheduled items" means real data, not a filled slot.
  const scheduleItems = useMemo<ScheduleItem[]>(() => {
    if (view !== 'today') return [];
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const items: ScheduleItem[] = [];

    for (const ins of todayInspections) {
      items.push({ key: `ins_${ins.id}`, time: new Date(ins.createdAt).getTime(), kind: 'inspection', ins });
    }
    for (const lead of followUpsDue) {
      const t = new Date(lead.followUpAt!).getTime();
      items.push({
        key: `fu_${lead.id}`,
        time: t,
        kind: 'followup',
        lead,
        overdue: t < startOfDay.getTime(),
      });
    }
    if (active) {
      items.push({
        key: `route_${active.id}`,
        time: new Date(active.startedAt).getTime(),
        kind: 'route',
        session: active,
      });
    }

    return items.sort((a, b) => a.time - b.time);
  }, [view, todayInspections, followUpsDue, active]);

  // The one dot that pulses: the route in progress if there is one (it's
  // genuinely happening right now), otherwise the earliest stop still ahead
  // of the clock. All-past and no active route → nothing pulses; that's
  // honest, not a bug (Drift #5: never fake a "live" state).
  const liveKey = useMemo(() => {
    const routeItem = scheduleItems.find((i) => i.kind === 'route');
    if (routeItem) return routeItem.key;
    const now = Date.now();
    const next = scheduleItems
      .filter((i) => i.kind !== 'route' && i.time >= now)
      .sort((a, b) => a.time - b.time)[0];
    return next?.key ?? null;
  }, [scheduleItems]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View style={styles.root}>
    <ScreenHeader title="Plan" />
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Plan's one cinematic moment: a branded day header carrying the real
          date and today's real counts, in the onboarding's language (brand
          sky + the same drifting `Aurora`). This screen used to open on a
          plain title over three white stat cells — the purest "Apple
          Settings menu" surface in the app. */}
      <Rise index={0}>
        <View style={styles.dayHero}>
          <LinearGradient
            colors={gradients.stormNight}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <Aurora transparent />
          <Text style={styles.dayHeroKicker}>TODAY</Text>
          <Text style={styles.dayHeroDate} numberOfLines={2}>
            {today}
          </Text>
          <View style={styles.statsRow}>
            <PlanStat icon="briefcase-outline" tone="blue" label="Inspections" value={todayInspections.length} />
            <PlanStat icon="walk-outline" tone="purple" label="Knocks today" value={todayKnocks} />
            <PlanStat
              icon="navigate-outline"
              tone="green"
              label="Active route"
              value={active ? active.knocks.length : null}
              live={!!active}
            />
          </View>
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

      {view === 'today' ? (
        <Rise index={2}>
          <Text style={styles.sectionLabel}>Today's Schedule</Text>
          {scheduleItems.length === 0 ? (
            // Compact, top-anchored, honest — a hint in the flow, not a void.
            <View style={styles.empty}>
              <Ionicons name="calendar-outline" size={28} color={colors.textSubtle} />
              <Text style={styles.emptyTitle}>Nothing scheduled today</Text>
              <Text style={styles.emptyBody}>
                Inspections you log and follow-ups you set will show up here as they happen.
              </Text>
            </View>
          ) : (
            <View style={styles.rail}>
              {scheduleItems.map((item, i) => (
                <ScheduleRow
                  key={item.key}
                  item={item}
                  isFirst={i === 0}
                  isLast={i === scheduleItems.length - 1}
                  live={item.key === liveKey}
                  onPress={() => {
                    if (item.kind === 'inspection') router.push(`/job/${item.ins.id}` as any);
                    else if (item.kind === 'followup') router.push(`/lead/${item.lead.id}` as any);
                    else router.push('/door-knocking');
                  }}
                />
              ))}
            </View>
          )}
        </Rise>
      ) : (
        <>
          <Rise index={2}>
            <Text style={styles.sectionLabel}>This week</Text>
            {todayInspections.length === 0 ? (
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
                    <IconChip name="briefcase-outline" tone="blue" size="sm" />
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
                      <IconChip
                        name={overdue ? 'alert-circle' : 'call-outline'}
                        tone={overdue ? 'orange' : 'blue'}
                        size="sm"
                      />
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rowTitle}>{lead.customerName}</Text>
                        <Text style={styles.rowSub}>{lead.address}</Text>
                      </View>
                      <Pill
                        label={overdue ? 'Overdue' : 'Due today'}
                        tone={overdue ? 'danger' : 'info'}
                        size="sm"
                      />
                    </PressableScale>
                  );
                })}
              </View>
            </Rise>
          )}
        </>
      )}

      {/* Every action chip carries a tile hue — a single peach chip beside
          two greys read as an inconsistency, not as emphasis. */}
      <Rise index={4}>
        <Text style={styles.sectionLabel}>Quick actions</Text>
        <View style={styles.card}>
          <PressableScale
            style={styles.actionRow}
            accessibilityRole="button"
            accessibilityLabel="Start door-knocking route"
            onPress={() => router.push('/door-knocking')}
          >
            <IconChip name="walk-outline" tone="orange" size="sm" />
            <Text style={styles.actionText}>Start door-knocking route</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="Start mileage tracking"
            onPress={() => router.push('/mileage')}
          >
            <IconChip name="car-outline" tone="purple" size="sm" />
            <Text style={styles.actionText}>Start mileage tracking</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="New job"
            onPress={() => router.push('/new-job')}
          >
            <IconChip name="add-circle-outline" tone="blue" size="sm" />
            <Text style={styles.actionText}>New job</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
        </View>
      </Rise>
    </ScrollView>
    </View>
  );
}

/** Colour-chipped stat card — matches `components/ui/StatCard`'s grammar
 *  with room for the counting/live animations Plan already carried. */
function PlanStat({
  icon,
  tone,
  label,
  value,
  live = false,
}: {
  icon: IoniconName;
  tone: ChipTone;
  label: string;
  value: number | null;
  live?: boolean;
}) {
  return (
    <View style={styles.statCard} accessibilityRole="summary" accessibilityLabel={`${label}: ${value ?? 'none'}`}>
      <IconChip name={icon} tone={tone} size="md" />
      <View style={styles.statReadout}>
        <View style={styles.statValueRow}>
          {live && <PulseRing size={8} color={CHIP_TONES[tone].fg} />}
          {value === null ? (
            // Explicit absence. A bare em-dash reads as a value that failed
            // to load rather than as "there isn't one".
            <Text style={[styles.statValue, styles.statValueNone]}>None</Text>
          ) : (
            <AnimatedCounter value={value} style={styles.statValue} />
          )}
        </View>
        <Text style={styles.statLabel} numberOfLines={2}>{label}</Text>
      </View>
    </View>
  );
}

/** One rail row: time · dot-on-line · RichCard stop. */
function ScheduleRow({
  item,
  isFirst,
  isLast,
  live,
  onPress,
}: {
  item: ScheduleItem;
  isFirst: boolean;
  isLast: boolean;
  live: boolean;
  onPress: () => void;
}) {
  const tone: ChipTone = item.kind === 'inspection' ? 'blue' : item.kind === 'route' ? 'green' : item.overdue ? 'orange' : 'purple';
  const dotColor = CHIP_TONES[tone].fg;

  let icon: IoniconName;
  let title: string;
  let subtitle: string;
  let trailing: ReactNode;

  if (item.kind === 'inspection') {
    icon = 'briefcase-outline';
    title = item.ins.customerName;
    subtitle = item.ins.address;
    trailing = <Pill label={item.ins.status.replace('_', ' ')} tone={STATUS_PILL_TONE[item.ins.status]} size="sm" />;
  } else if (item.kind === 'followup') {
    icon = item.overdue ? 'alert-circle' : 'call-outline';
    title = item.lead.customerName;
    subtitle = item.lead.address;
    trailing = (
      <Pill label={item.overdue ? 'Overdue' : 'Due today'} tone={item.overdue ? 'danger' : 'info'} size="sm" />
    );
  } else {
    icon = 'walk-outline';
    title = 'Door-knocking route';
    subtitle = `${item.session.knocks.length} knock${item.session.knocks.length === 1 ? '' : 's'} logged`;
    trailing = <Pill label="LIVE" tone="success" size="sm" dot pulse />;
  }

  return (
    <View style={styles.timelineRow}>
      <Text style={styles.timelineTime}>{timeLabel(item.time)}</Text>
      <View style={styles.railCol}>
        <View style={[styles.railSegment, isFirst && styles.railSegmentHidden]} />
        {live ? (
          <PulseRing size={10} color={dotColor} style={styles.railDot} />
        ) : (
          <View style={[styles.railDotStatic, { backgroundColor: dotColor }]} />
        )}
        <View style={[styles.railSegment, isLast && styles.railSegmentHidden]} />
      </View>
      <RichCard
        icon={icon}
        iconTone={tone}
        title={title}
        subtitle={subtitle}
        headerTrailing={trailing}
        onPress={onPress}
        style={styles.timelineCard}
      />
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

  // Day hero — the brand sky, with the day's real counts living inside it
  // rather than as three separate white cells below.
  dayHero: {
    borderRadius: radii.xl,
    overflow: 'hidden',
    padding: spacing.xl,
    gap: spacing.xs,
    // Painted under the gradient so the card is never briefly transparent.
    backgroundColor: brand.royalInk,
    ...shadows.hero,
  },
  dayHeroKicker: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.brandSoft,
    letterSpacing: 1.4,
  },
  dayHeroDate: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.6,
  },

  // Stats — glass cells on the hero, one per real count.
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  statCard: {
    flex: 1,
    minHeight: touchTarget.sticky,
    backgroundColor: glass.smokeFill,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    padding: spacing.md,
    gap: spacing.sm,
  },
  statReadout: { gap: 2 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statValue: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
  },
  statValueNone: { fontSize: fontSize.titleMd, color: colors.brandSoft },
  statLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.brandSoft,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
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

  // Today's Schedule — a rail with a dot per stop; RichCard carries each stop.
  rail: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  timelineTime: {
    width: 52,
    paddingTop: spacing.lg + 2,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },
  railCol: { width: 20, alignItems: 'center' },
  railSegment: { width: 2, flex: 1, backgroundColor: colors.border },
  railSegmentHidden: { backgroundColor: 'transparent' },
  railDot: { marginVertical: spacing.lg },
  railDotStatic: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginVertical: spacing.lg + 2,
  },
  timelineCard: { flex: 1, marginBottom: spacing.sm },

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
