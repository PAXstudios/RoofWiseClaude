import {
  Linking,
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
import { scheduledDaysFrom, useKnockFinderStore, type ScheduledKnockDay } from '@/lib/stores/knockFinderStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { startRoute } from '@/components/knock/sessionTracker';
import { localYmd, startClockLabel } from '@/components/knock/ScheduleDaySheet';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { directionsUrl } from '@/lib/services/knockFinder';
import { fmtMinutes } from '@/lib/services/knockOpportunities';
import { KNOCK_ROUTE_RADIUS_MILES } from '@/lib/services/stormWatch';
import { cancelKnockDayReminder } from '@/lib/services/pushNotifications';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter, PulseRing } from '@/components/motion';
import { RichCard } from '@/components/ui/RichCard';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { IconChip, CHIP_TONES, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { SettingsAffordance } from '@/components/ui/SettingsAffordance';
import { MeshBackground } from '@/components/ui/MeshBackground';
import {
  followUpsDue as followUpsDueFor,
  inspectionsThisWeek,
  inspectionsToday,
  liveKeyFor,
  scheduleItemsFor,
  type ScheduleItem,
} from '@/components/home/todayAgenda';
import { daysInStage, goingColdLeads } from '@/components/pipeline/chain';
import type { Inspection, KnockRouteTarget } from '@/lib/models/types';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
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

// `ScheduleItem` — one stop on Today's rail, a real point in time from a real
// store — now lives in `components/home/todayAgenda.ts` so Home's Today
// module and this screen build the day from the same rules.

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

  // Shared with Home's Today module (`components/home/todayAgenda.ts`) so the
  // two screens can never disagree about what is due.
  const followUpsDue = useMemo(() => followUpsDueFor(leads), [leads]);

  const todayInspections = useMemo(
    () => (view === 'today' ? inspectionsToday(inspections) : inspectionsThisWeek(inspections)),
    [inspections, view],
  );

  // Leads going quiet: pre-sale, no follow-up on the calendar, a week or
  // more in their stage. Stalest first — the one that has waited longest is
  // the one to call first. Hidden entirely when there are none.
  const goingCold = useMemo(() => goingColdLeads(leads), [leads]);

  // Knock days the roofer put on the calendar from a plan (today and ahead,
  // soonest first). A day that slipped past unstarted drops off this list
  // but stays on its plan page. Section is absent when there are none.
  const plans = useKnockFinderStore((s) => s.plans);
  const todayYmd = localYmd(new Date());
  const knockDays = useMemo(
    () => scheduledDaysFrom(plans).filter((d) => d.schedule.date >= todayYmd),
    [plans, todayYmd],
  );

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
  const scheduleItems = useMemo<ScheduleItem[]>(
    () =>
      view !== 'today'
        ? []
        : scheduleItemsFor({ inspections: todayInspections, followUps: followUpsDue, activeRoute: active }),
    [view, todayInspections, followUpsDue, active],
  );

  // The one dot that pulses: the route in progress if there is one (it's
  // genuinely happening right now), otherwise the earliest stop still ahead
  // of the clock. All-past and no active route → nothing pulses; that's
  // honest, not a bug (Drift #5: never fake a "live" state).
  const liveKey = useMemo(() => liveKeyFor(scheduleItems), [scheduleItems]);

  const today = new Date().toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  return (
    <View style={styles.root}>
    <ScreenHeader title="Plan" right={<SettingsAffordance />} />
    <ScrollView
      style={styles.root}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      {/* Plan's one cinematic moment: a branded day header carrying the real
          date and today's real counts — the same mesh signature Home's hero
          runs (docs/DESIGN_1A.md §2, §6). This screen used to open on a
          plain title over three white stat cells — the purest "Apple
          Settings menu" surface in the app. */}
      <Rise index={0}>
        <View style={styles.dayHero}>
          <MeshBackground variant="home" style={styles.dayHeroMesh} />
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

      {/* Knock days — scheduled trip days from saved knock plans, as stops
          with a start time. Start route rides the day onto a session exactly
          as the plan page's "Start this day" does. Absent when none. */}
      {knockDays.length > 0 && (
        <Rise index={3}>
          <Text style={styles.sectionLabel}>Knock days</Text>
          <View style={styles.knockDays}>
            {knockDays.map((d) => (
              <KnockDayCard key={`${d.plan.id}:${d.day.day}`} item={d} isToday={d.schedule.date === todayYmd} />
            ))}
          </View>
        </Rise>
      )}

      {/* Going cold — leads that have sat a week or more in a pre-sale stage
          with nothing on the calendar. Driven by stage age (`stageChangedAt`),
          so it measures the deal, not the last edit. Absent when none. */}
      {goingCold.length > 0 && (
        <Rise index={4}>
          <Text style={styles.sectionLabel}>Going cold</Text>
          <View style={styles.card}>
            {goingCold.map((lead, i) => {
              const days = daysInStage(lead);
              return (
                <PressableScale
                  key={lead.id}
                  style={[styles.row, i > 0 && styles.rowBorder]}
                  accessibilityRole="button"
                  accessibilityLabel={`${lead.customerName}, ${
                    days === null ? 'going cold' : `${days} days in stage`
                  }`}
                  onPress={() => router.push(`/lead/${lead.id}` as any)}
                >
                  <IconChip name="snow-outline" tone="quiet" size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{lead.customerName}</Text>
                    <Text style={styles.rowSub}>{lead.address}</Text>
                  </View>
                  <Pill
                    label={days === null ? 'Going cold' : `${days}d quiet`}
                    tone="warn"
                    size="sm"
                  />
                </PressableScale>
              );
            })}
          </View>
        </Rise>
      )}

      {/* Every action chip carries a tile hue — a single peach chip beside
          two greys read as an inconsistency, not as emphasis. Jobs and Reports
          lead the list: both used to be reachable only through Home or
          Settings, and Plan is where the day's work is decided. */}
      <Rise index={5}>
        <Text style={styles.sectionLabel}>Quick actions</Text>
        <View style={styles.card}>
          <PressableScale
            style={styles.actionRow}
            accessibilityRole="button"
            accessibilityLabel="Jobs. Every inspection as a pipeline card."
            // `at` is a nonce: tab params persist, so a second tap after the
            // roofer flipped back to Leads by hand still lands on Jobs.
            onPress={() =>
              router.push({
                pathname: '/(tabs)/leads',
                params: { segment: 'jobs', at: String(Date.now()) },
              } as any)
            }
          >
            <IconChip name="briefcase-outline" tone="blue" size="sm" />
            <Text style={styles.actionText}>Jobs</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="Reports. Revenue, leads, and claim outcomes."
            onPress={() => router.push('/reports')}
          >
            <IconChip name="bar-chart-outline" tone="green" size="sm" />
            <Text style={styles.actionText}>Reports</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
            accessibilityRole="button"
            accessibilityLabel="Knock Planner. Find the best storm-hit streets and plan the day."
            onPress={() => router.push('/knock-finder')}
          >
            <IconChip name="compass-outline" tone="orange" size="sm" />
            <Text style={styles.actionText}>Knock Planner</Text>
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          </PressableScale>
          <PressableScale
            style={[styles.actionRow, styles.rowBorder]}
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

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today" / "Tomorrow" / "Thu, Sep 5" from a local YYYY-MM-DD. */
function knockDateLabel(date: string, todayYmd: string): string {
  if (date === todayYmd) return 'Today';
  const [y, m, d] = date.split('-').map(Number);
  const target = new Date(y, m - 1, d);
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  if (date === localYmd(tomorrow)) return 'Tomorrow';
  return `${WEEKDAYS_SHORT[target.getDay()]}, ${MONTHS_SHORT[target.getMonth()]} ${target.getDate()}`;
}

/**
 * One scheduled knock day: the date and start clock, the stops, and the
 * same Start / Directions / Open plan actions the plan page carries. Start
 * route mirrors `PlanView.startDay` — permission → GPS watcher → mileage
 * trip → session; a refused location still creates the session with the
 * stops on it so nothing chosen is lost.
 */
function KnockDayCard({ item, isToday }: { item: ScheduledKnockDay; isToday: boolean }) {
  const router = useRouter();
  const { plan, day, schedule } = item;
  const activeSession = useKnockSessionStore((s) => s.activeSession);
  const startSession = useKnockSessionStore((s) => s.start);
  const setRouteStops = useKnockSessionStore((s) => s.setRouteStops);
  const setAreaStatus = useKnockFinderStore((s) => s.setAreaStatus);
  const unscheduleDay = useKnockFinderStore((s) => s.unscheduleDay);
  const toast = useToastStore((s) => s.show);
  const [confirm, setConfirm] = useState(false);

  const stops = day.stops;
  const firstName = stops[0] ? stops[0].area.name ?? stops[0].area.storm.town ?? 'Storm area' : '—';
  const clock = startClockLabel(schedule.startTime);
  const dateLabel = knockDateLabel(schedule.date, localYmd(new Date()));

  const toTarget = (s: (typeof stops)[number]): KnockRouteTarget => ({
    lat: s.area.lat,
    lng: s.area.lng,
    label: s.area.name ?? s.area.storm.town ?? 'Storm area',
    radiusMiles: KNOCK_ROUTE_RADIUS_MILES,
  });

  const beginRoute = async (routeStops: KnockRouteTarget[]) => {
    const r = await startRoute({ routeStops });
    if (r.ok) return true;
    startSession(undefined, routeStops[0], { routeStops });
    toast({ tone: 'warn', title: 'Location is off', body: 'The route is set. Turn location on in Knock mode to place pins and count miles.' });
    return false;
  };

  const onStart = async () => {
    const routeStops = stops.map(toTarget);
    if (routeStops.length === 0) return;
    let ok = true;
    if (activeSession) setRouteStops(routeStops);
    else ok = await beginRoute(routeStops);
    for (const s of stops) if (!plan.areaStatus[s.area.key]) setAreaStatus(plan.id, s.area.key, 'scheduled');
    if (ok) {
      toast({
        tone: 'success',
        title: `Day ${day.day} started`,
        body: `${routeStops.length} stop${routeStops.length === 1 ? '' : 's'} on your route · first: ${routeStops[0].label}`,
      });
    }
    router.push('/door-knocking');
  };

  const onDirections = () => {
    const url = directionsUrl(plan.result.base, stops.map((s) => ({ lat: s.area.lat, lng: s.area.lng })));
    if (url) Linking.openURL(url).catch(() => toast({ tone: 'warn', title: 'Could not open Maps' }));
  };

  const onUnschedule = () => {
    if (schedule.reminderId) void cancelKnockDayReminder(schedule.reminderId);
    unscheduleDay(plan.id, day.day);
    toast({ tone: 'info', title: `Day ${day.day} taken off the calendar`, body: 'The plan still has it.' });
  };

  return (
    <>
      <RichCard
        icon="calendar-outline"
        iconTone="orange"
        title={`${dateLabel} · ${clock}`}
        subtitle={`Day ${day.day} · ${plan.title}`}
        headerTrailing={isToday ? <Pill label="Today" tone="accent" size="sm" dot /> : undefined}
        accessibilityLabel={`Knock day ${day.day}, ${dateLabel} at ${clock}, ${stops.length} stops, first ${firstName}`}
      >
        <Text style={styles.knockDayLine}>
          {stops.length} stop{stops.length === 1 ? '' : 's'} · first: {firstName} · {Math.round(day.totalMiles)} mi ·{' '}
          {fmtMinutes(day.totalMinutes)} · expect ~{Math.round(day.expected)}, at least {day.atLeast}
        </Text>
        <PressableScale
          style={isToday ? styles.knockStartPrimary : styles.knockStartSecondary}
          onPress={() => void onStart()}
          accessibilityRole="button"
          accessibilityLabel={`Start route for day ${day.day}`}
        >
          <Ionicons name="play" size={22} color={isToday ? colors.textInverse : colors.navy} />
          <Text style={isToday ? styles.knockStartPrimaryText : styles.knockStartSecondaryText}>Start route</Text>
        </PressableScale>
        <View style={styles.knockActions}>
          <PressableScale style={styles.knockBtn} onPress={onDirections} accessibilityRole="button" accessibilityLabel="Directions through every stop">
            <Ionicons name="navigate-outline" size={18} color={colors.navy} />
            <Text style={styles.knockBtnText}>Directions</Text>
          </PressableScale>
          <PressableScale
            style={styles.knockBtn}
            onPress={() => router.push(`/knock-plan/${plan.id}` as any)}
            accessibilityRole="button"
            accessibilityLabel="Open the plan"
          >
            <Ionicons name="compass-outline" size={18} color={colors.navy} />
            <Text style={styles.knockBtnText}>Open plan</Text>
          </PressableScale>
          <PressableScale style={styles.knockBtn} onPress={() => setConfirm(true)} accessibilityRole="button" accessibilityLabel={`Unschedule day ${day.day}`}>
            <Ionicons name="calendar-clear-outline" size={18} color={colors.danger} />
            <Text style={[styles.knockBtnText, styles.knockBtnDanger]}>Unschedule</Text>
          </PressableScale>
        </View>
      </RichCard>
      <ConfirmSheet
        visible={confirm}
        title={`Unschedule day ${day.day}?`}
        body="It comes off the calendar and the reminder is cancelled. The plan keeps the day."
        confirmLabel="Unschedule"
        onConfirm={onUnschedule}
        onClose={() => setConfirm(false)}
      />
    </>
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
    padding: spacing.lg,
    gap: spacing.xs,
    // Painted under the mesh so the card is never briefly transparent.
    backgroundColor: brand.royalInk,
    ...shadows.hero,
  },
  dayHeroMesh: { borderRadius: radii.xl },
  dayHeroKicker: { ...dataLabel, color: colors.onMesh, opacity: 0.8, letterSpacing: 1.4 },
  dayHeroDate: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.onMesh,
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
    padding: spacing.sm,
    gap: spacing.sm,
  },
  statReadout: { gap: 2 },
  statValueRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  statValue: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
    color: colors.onMesh,
    fontVariant: ['tabular-nums'],
  },
  statValueNone: { fontSize: fontSize.titleMd, fontFamily: fontFamily.archivo.regular, color: colors.brandSoft },
  // "INSPECTIONS" / "KNOCKS TODAY" — the mock's stat-label convention (§3).
  statLabel: {
    ...dataLabel,
    color: colors.brandSoft,
    // 0.3 rather than 1.1: at three-across, "INSPECTIONS" broke mid-word.
    letterSpacing: 0.3,
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
    fontFamily: fontFamily.archivo.semibold,
    color: colors.textMuted,
  },
  segLabelActive: { color: colors.text },

  // iOS grouped-list section headers — the mock's small-caps eyebrow (§3).
  sectionLabel: { ...dataLabel, color: colors.textSubtle, marginBottom: spacing.sm },

  // Today's Schedule — a rail with a dot per stop; RichCard carries each stop.
  rail: { gap: 0 },
  timelineRow: { flexDirection: 'row', alignItems: 'stretch', gap: spacing.sm },
  timelineTime: {
    width: 52,
    paddingTop: spacing.lg + 2,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.mono,
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
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
  rowSub: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted, marginTop: 2 },
  rowMeta: { fontSize: fontSize.caption, fontFamily: fontFamily.mono, color: colors.textSubtle, marginTop: 2 },

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
    fontFamily: fontFamily.archivo.medium,
  },

  // Knock days — scheduled trip days from a plan.
  knockDays: { gap: spacing.md },
  knockDayLine: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    lineHeight: 18,
    marginBottom: spacing.md,
  },
  // Today's day gets the sticky 88pt primary; a future day a 56pt secondary.
  knockStartPrimary: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },
  knockStartPrimaryText: {
    color: colors.textInverse,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.bold,
    fontFamily: fontFamily.archivo.bold,
  },
  knockStartSecondary: {
    flexDirection: 'row',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  knockStartSecondaryText: {
    color: colors.navy,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
  },
  knockActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  knockBtn: {
    flex: 1,
    flexDirection: 'row',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: spacing.xs,
  },
  knockBtnText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.navy,
  },
  knockBtnDanger: { color: colors.danger },

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
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  emptyBody: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
