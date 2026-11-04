import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  RefreshControl,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import { Image } from 'expo-image';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useAuthStore } from '@/lib/auth/authStore';
import { syncLeads } from '@/lib/services/leadSync';
import { syncCorrections } from '@/lib/services/correctionsSync';
import { checkStormWatch } from '@/lib/services/stormWatch';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { AICalibrationCard } from '@/components/AICalibrationCard';
import { WeatherHero } from '@/components/WeatherHero';
import { AnalysisQueueChip } from '@/components/AnalysisQueueChip';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter } from '@/components/motion';
import { AreaActivityCard } from '@/components/home/AreaActivityCard';
import { TodayModule, useTodayAgenda } from '@/components/home/TodayModule';
import { QuickActionsSheet } from '@/components/sheets/QuickActionsSheet';
import { selectUnreadCount, useNotificationStore } from '@/lib/stores/notificationStore';
import { coverPhotoUri, recordCardUrl } from '@/lib/services/propertyRecord';
import { activityHref } from '@/components/home/activityRoute';
import { IconChip, CHIP_TONES, type ChipTone } from '@/components/ui/IconChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Pill, type PillTone } from '@/components/ui/Pill';
import { useTaskStore } from '@/lib/stores/taskStore';
import {
  buildPipeline,
  PIPELINE_GROUPS,
  PIPELINE_GROUP_LABELS,
  summarizePipeline,
  ytdSignedRevenue,
  type PipelineGroup,
} from '@/lib/services/pipeline';
import {
  ROOF_MATERIAL_LABELS,
  type InspectionStatus,
} from '@/lib/models/types';
import {
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  gradients,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
  typography,
} from '@/theme/tokens';

function tap() {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

// First-paint-only entrance gate. Module-scoped so returning to the Home tab
// (which remounts the screen under expo-router's Slot) renders statically
// instead of replaying the stagger. Dev fast-refresh resets it, which is fine.
let homeEntrancePlayed = false;

/**
 * Subtle iOS entrance: 8pt rise + fade on the snappy spring, staggered by
 * index. Built from the same reanimated primitives the repo already ships on
 * web (useSharedValue / useAnimatedStyle / withSpring). Sections that mount
 * later in the session (e.g. a storm alert landing) appear without animation.
 */
function Rise({
  index = 0,
  style,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(homeEntrancePlayed ? 1 : 0);

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

// Colour families cycled across pipeline stage cards so each stage reads as
// its own object rather than a repeated grey block (craft rule: shared
// colour between a chip and its data).
const PIPELINE_TONES: ChipTone[] = ['blue', 'purple', 'orange', 'green'];

const STATUS_PILL_TONE: Record<InspectionStatus, PillTone> = {
  lead: 'neutral',
  scheduled: 'info',
  in_progress: 'warn',
  complete: 'success',
};

export default function HomeScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const inspections = useInspectionStore((s) => s.inspections);
  const alerts = useStormAlertStore((s) => s.alerts);
  const injectAlert = useStormAlertStore((s) => s.inject);
  const activeAlert = useMemo(
    () => alerts.find((a) => a.status === 'new'),
    [alerts],
  );
  const recentActivity = useActivityStore((s) => s.events.slice(0, 5));
  const allEstimates = useEstimateStore((s) => s.estimates);
  const estimates = useMemo(() => allEstimates.slice(0, 4), [allEstimates]);
  const proposals = useProposalStore((s) => s.proposals);
  const leads = useLeadStore((s) => s.leads);
  const tasks = useTaskStore((s) => s.tasks);
  const inspectorName = useInspectorProfileStore((s) => s.profile.fullName);
  const serviceAreaCount = useServiceAreaStore((s) => s.areas.length);
  // Today's real next actions — same helper Plan reads, so the two agree.
  const agenda = useTodayAgenda();
  const unread = useNotificationStore(selectUnreadCount);

  // Activity rows route to the record they describe and stay plain text when
  // it no longer exists — never a button that opens "Job not found".
  const activityRouteCtx = useMemo(
    () => ({
      hasInspection: (id: string) => inspections.some((i) => i.id === id),
      hasLead: (id: string) => leads.some((l) => l.id === id),
      proposalJobId: (id: string) => proposals.find((p) => p.id === id)?.jobId,
    }),
    [inspections, leads, proposals],
  );

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    homeEntrancePlayed = true;
  }, []);

  // Gentle scroll-linked parallax on the screen's hero cards (Storm Alert /
  // WeatherHero): a few points of lag + a touch of overscroll stretch, the
  // same "physical" feel as Apple Weather's pull header. Static when there's
  // no motion (reduced-motion devices just never move scrollY).
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
  });
  const heroParallaxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: interpolate(scrollY.value, [-140, 0], [-24, 0], Extrapolation.CLAMP) },
      { scale: interpolate(scrollY.value, [-140, 0], [1.05, 1], Extrapolation.CLAMP) },
    ],
  }));

  // The one pipeline build for this screen — the stat row's "Pipeline" figure
  // and the stage strip at the bottom both read off it, so the header number
  // and the strip's own total can never disagree (lib/services/pipeline.ts —
  // the same fold Reports and the Pipeline board use).
  const pipelineItems = useMemo(
    () => buildPipeline({ leads, inspections, proposals, estimates: allEstimates, tasks }),
    [leads, inspections, proposals, allEstimates, tasks],
  );
  const pipelineSummary = useMemo(() => summarizePipeline(pipelineItems), [pipelineItems]);
  const pipelineValue = pipelineSummary.pipelineValue;

  // Same "Year to date" window app/reports.tsx's own range picker defaults
  // to — factored into pipeline.ts so the two never drift (see its doc
  // comment).
  const revenueYTD = useMemo(() => ytdSignedRevenue(proposals), [proposals]);

  const openLeads = useMemo(
    () => leads.filter((l) => l.stage !== 'signed' && l.stage !== 'lost').length,
    [leads],
  );

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      syncLeads().catch(() => {}),
      syncCorrections().catch(() => {}),
      checkStormWatch().catch(() => {}),
    ]);
    setRefreshing(false);
  };

  // The "+" opens the Quick Actions sheet (owner's reference app), not a
  // system Alert — every fast path on one grid, in the thumb zone.
  const [quickOpen, setQuickOpen] = useState(false);
  const onQuickAdd = () => setQuickOpen(true);

  // Optional first name — null when we genuinely have nothing, so the
  // greeting reads complete either way ("Up early." / "Up early, Dan.").
  // Never a dangling filler word.
  const firstName = useMemo(() => {
    const fromProfile = inspectorName?.trim();
    if (fromProfile) return fromProfile.split(/\s+/)[0];
    const email = user?.email ?? '';
    if (!email) return null;
    const derived = email
      .split('@')[0]
      .split(/[._-]/)[0]
      .replace(/^\w/, (c) => c.toUpperCase());
    return derived || null;
  }, [user, inspectorName]);

  const hour = new Date().getHours();
  const greetingBase =
    hour < 5 ? 'Up early' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const greeting = firstName ? `${greetingBase}, ${firstName}.` : `${greetingBase}.`;

  // Real stage-GROUP counts — the same fold the Pipeline board's own columns
  // use (leads / inspecting / estimating / sold / production / done), not a
  // separate per-screen grouping (docs/DESIGN_1A.md §6). Lost sits outside
  // the funnel narrative here, same as Reports' `funnelByGroup`. Groups with
  // nothing in them are omitted rather than rendered as zero cards (Drift #5).
  const pipelineStages = useMemo(() => {
    const counts = new Map<PipelineGroup, number>();
    for (const it of pipelineItems) counts.set(it.group, (counts.get(it.group) ?? 0) + 1);
    return PIPELINE_GROUPS.filter((g) => g !== 'lost' && (counts.get(g) ?? 0) > 0).map((group) => ({
      group,
      label: PIPELINE_GROUP_LABELS[group],
      count: counts.get(group) ?? 0,
    }));
  }, [pipelineItems]);
  const pipelineTotal = useMemo(
    () => pipelineStages.reduce((sum, s) => sum + s.count, 0),
    [pipelineStages],
  );

  // Honest setup checklist — every state read from a real persisted store,
  // every row lands on the real screen (density spec: structured setup
  // content instead of a void; Drift #5: nothing fabricated).
  const setupSteps = useMemo(
    () =>
      [
        {
          key: 'area',
          icon: 'map-outline' as const,
          title: 'Set your service area',
          sub: 'Storm Watch scans it for hail and wind',
          done: serviceAreaCount > 0,
          href: '/settings/service-area',
        },
        {
          key: 'profile',
          icon: 'person-outline' as const,
          title: 'Fill out your inspector profile',
          sub: 'Shows on every claim packet you send',
          done: Boolean(inspectorName?.trim()),
          href: '/settings/inspector-profile',
        },
        {
          key: 'lead',
          icon: 'people-outline' as const,
          title: 'Add your first lead',
          sub: 'Track knocks, proposals, and signatures',
          done: leads.length > 0,
          href: '/new-lead',
        },
        {
          key: 'inspection',
          icon: 'scan-outline' as const,
          title: 'Run your first inspection',
          sub: 'Camera → AI → HAAG claim packet',
          done: inspections.length > 0,
          href: '/quick-inspection',
        },
      ] as const,
    [serviceAreaCount, inspectorName, leads.length, inspections.length],
  );
  const setupDone = setupSteps.filter((s) => s.done).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <Animated.ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[
        styles.container,
        // Clears the tab bar + home indicator + floating FAB so the last
        // module is never clipped behind chrome.
        { paddingBottom: insets.bottom + touchTarget.preferred + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
      onScroll={onScroll}
      scrollEventThrottle={16}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      {/* Courtside masthead: real identity, search and store-derived metrics. */}
      <View style={styles.heroBlock}>
        <Rise index={0}>
          <View style={styles.headerRow}>
            <PressableScale accessibilityRole="button" accessibilityLabel="Open profile and settings" onPress={() => router.push('/settings')} style={styles.identity}>
              <Image source={require('@/assets/roofwise-app-logo.png')} style={styles.brandLogo} contentFit="contain" />
              <Text style={styles.greeting}>{greeting}</Text>
            </PressableScale>
            <View style={styles.headerActions}>
              <HeaderIconButton icon="add" label="Quick add: inspection, job, lead, or estimate" onPress={() => { tap(); onQuickAdd(); }} />

              <HeaderIconButton
                icon={unread > 0 ? 'notifications' : 'notifications-outline'}
                label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
                badge={unread}
                onPress={() => router.push('/notifications')}
              />

            </View>
          </View>
        </Rise>

        <View style={styles.headlineWrap}>
          <Text accessibilityRole="header" style={[styles.headline, width < 360 && styles.headlineCompact]}>Your workday</Text>
        </View>
        <PressableScale accessibilityRole="button" accessibilityLabel="Search jobs, addresses and customers" onPress={() => router.push('/search')} style={styles.searchEntry}>
          <Ionicons name="search-outline" size={20} color={colors.textMuted} />
          <Text style={styles.searchEntryText}>Search jobs, addresses, customers</Text>
        </PressableScale>

        {/* The mock's header stat row — Revenue YTD / Leads / Pipeline, real
            numbers from lib/services/pipeline.ts (see the useMemo above),
            not a new invented figure (Drift #5). Each opens Reports, same
            affordance the old mid-scroll StatCard trio carried. */}
        <Rise index={1} style={styles.heroStatsRow}>
          <HeroStat
            value={`$${formatShort(revenueYTD)}`}
            label="Revenue YTD"
            onPress={() => router.push('/reports')}
            accessibilityLabel={`Revenue year to date $${formatShort(revenueYTD)}. Open reports.`}
          />

          <HeroStat
            value={String(openLeads)}
            label="Leads"
            onPress={() => router.push('/reports')}
            accessibilityLabel={`${openLeads} open leads. Open reports.`}
          />

          <HeroStat
            value={`$${formatShort(pipelineValue)}`}
            label="Pipeline"
            onPress={() => router.push('/reports')}
            accessibilityLabel={`Pipeline $${formatShort(pipelineValue)}. Open reports.`}
          />
        </Rise>

      </View>

      {!activeAlert && __DEV__ && (
        <Pressable
          style={styles.debugStorm}
          onPress={() =>
            injectAlert({
              eventKind: 'hail',
              areaLabel: 'Plano, TX · 75024',
              propertyCount: 3,
              hailSizeInches: 1.75,
            })
          }
        >
          <Ionicons name="bug-outline" size={14} color={colors.textMuted} />
          <Text style={styles.debugStormText}>Inject demo storm alert</Text>
        </Pressable>
      )}

      {/* Courtside's paired actions preserve the original capture and job flows. */}
      <Rise index={2} style={styles.heroRow}>
        <PressableScale style={[styles.heroCta, styles.primaryAction]} accessibilityRole="button" accessibilityLabel="Quick Inspection. Camera to AI to claim packet." onPress={() => { tap(); router.push('/quick-inspection'); }}>
          <Ionicons name="camera-outline" size={22} color={colors.textInverse}/>
          <Text style={styles.pairedActionText}>Quick inspection</Text>
        </PressableScale>
        <PressableScale style={[styles.heroCta, styles.newJobAction]} accessibilityRole="button" accessibilityLabel="New Job. Customer, insurance, roof." onPress={() => { tap(); router.push('/new-job'); }}>
          <Ionicons name="add-circle-outline" size={22} color={colors.textInverse}/>
          <Text style={styles.pairedActionText}>New job</Text>
        </PressableScale>
      </Rise>

      {agenda.hasItems && <Rise index={3}><TodayModule agenda={agenda} /></Rise>}
      <SectionHeader title="Tools & services"/>

      {/* Tools — directly under the two hero CTAs (owner 2026-09-03): the
          four things a roofer opens between jobs, each its own saturated
          tile. Knock Planner is the storm-hit-streets finder. */}
      <Rise index={3} style={styles.toolGrid}>
        <ToolTile
          icon="thunderstorm"
          tone="blue"
          title="Storm Tracer"
          sub="Hail + wind map"
          onPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'storms' } } as any)}
        />
        <ToolTile
          icon="compass"
          tone="orange"
          title="Knock Planner"
          sub="Storm-hit streets"
          onPress={() => router.push('/knock-finder')}
        />
        <ToolTile
          icon="calculator"
          tone="navy"
          title="Estimator"
          sub="Solar + cost"
          onPress={() => router.push('/estimator')}
        />
        <ToolTile
          icon="car"
          tone="neutral"
          title="Mileage"
          sub="Tax log"
          onPress={() => router.push('/mileage')}
        />
      </Rise>

      {/* Live field intelligence retains its own honest loading and error states. */}
      <Rise index={3}>
        <AreaActivityCard />
      </Rise>

        <Rise index={1} style={styles.heroSlot}>
          <Animated.View style={heroParallaxStyle}>
            <WeatherHero scrollY={scrollY} />
          </Animated.View>
        </Rise>
      {/* Revenue / Leads / Pipeline now live in the header stat row (above,
          inside the mesh hero) rather than a second copy down here — one
          number per metric, not two that could drift. */}

      {/* Field tools — crafted cells, colour-chipped per tool. */}

      <Rise index={6} style={styles.stack}>
        <AnalysisQueueChip />
      </Rise>

      <Rise index={6}>
        <AICalibrationCard />
      </Rise>

      {/* Density: with no jobs yet, the first session renders structured,
          honest setup content instead of a column of "No X yet" voids.
          Every state below is read from a real store (Drift #5). */}
      {inspections.length === 0 && (
        <Rise index={7}>
          <View style={styles.sectionHeaderRow}>
            <SectionTitle title="Get set up" />
            <Text style={styles.sectionMeta}>
              {setupDone} of {setupSteps.length}
            </Text>
          </View>
          <View style={styles.groupCard}>
            {setupSteps.map((step, i) => (
              <PressableScale
                key={step.key}
                style={[styles.groupRow, i > 0 && styles.groupRowBorder]}
                accessibilityRole="button"
                accessibilityLabel={`${step.title}. ${step.done ? 'Done.' : step.sub}`}
                onPress={() => router.push(step.href as any)}
              >
                <IconChip
                  name={step.done ? 'checkmark-circle' : step.icon}
                  tone={step.done ? 'green' : 'blue'}
                  size="md"
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.groupTitle}>{step.title}</Text>
                  <Text style={styles.groupSub}>{step.sub}</Text>
                </View>
                {!step.done && (
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                )}
              </PressableScale>
            ))}
          </View>
        </Rise>
      )}

      {inspections.length === 0 && (
        <Rise index={8}>
          <SectionHeader title="What RoofWise does" style={styles.sectionHeaderSpacing} />
          <View style={styles.groupCard}>
            <PressableScale
              style={styles.groupRow}
              accessibilityRole="button"
              accessibilityLabel="Storm Tracer. See where hail and wind actually hit, from NOAA storm reports."
              onPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'storms' } } as any)}
            >
              <IconChip name="thunderstorm-outline" tone="blue" size="md" />
              <View style={{ flex: 1 }}>
                <Text style={styles.groupTitle}>Storm Tracer</Text>
                <Text style={styles.groupSub}>
                  See where hail and wind actually hit, from NOAA storm reports
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            </PressableScale>
            <PressableScale
              style={[styles.groupRow, styles.groupRowBorder]}
              accessibilityRole="button"
              accessibilityLabel="Quick Inspection. Photos become a HAAG-ready claim packet."
              onPress={() => router.push('/quick-inspection')}
            >
              <IconChip name="scan-outline" tone="orange" size="md" />
              <View style={{ flex: 1 }}>
                <Text style={styles.groupTitle}>Quick Inspection</Text>
                <Text style={styles.groupSub}>
                  Photos become a HAAG-ready claim packet
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
            </PressableScale>
          </View>
        </Rise>
      )}

      {/* Recent Jobs — rendered only when jobs exist; the setup module above
          owns the first-run state. Real inspection photos via expo-image; no
          photo gets a crafted gradient tile, never a stock image. */}
      {inspections.length > 0 && (
        <Rise index={7}>
          <SectionHeader
            title="Recent Jobs"
            action={{ label: 'View all', onPress: () => router.push('/inspections') }}
            style={styles.sectionHeaderSpacing}
          />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {inspections.slice(0, 8).map((ins) => {
              // The house, not a shingle: the Zillow photo when there is one.
              const firstPhoto = coverPhotoUri(ins, 'card');
              return (
                <View key={ins.id} style={styles.recentCardShadow}>
                  <PressableScale
                    style={styles.recentCard}
                    onPress={() => router.push(`/job/${ins.id}` as any)}
                  >
                    {firstPhoto ? (
                      <Image
                        source={{ uri: firstPhoto }}
                        style={styles.recentImage}
                        contentFit="cover"
                        transition={150}
                      />
                    ) : (
                      <LinearGradient
                        colors={gradients.clearDay}
                        style={[styles.recentImage, styles.recentImageFallback]}
                        start={{ x: 0, y: 0 }}
                        end={{ x: 1, y: 1 }}
                      >
                        <Ionicons name="home-outline" size={30} color={colors.textInverse} />
                      </LinearGradient>
                    )}
                    <View style={styles.recentBody}>
                      <View style={styles.recentTopRow}>
                        <Text style={styles.recentReport}>{ins.reportId}</Text>
                        <Pill
                          label={ins.status.replace('_', ' ')}
                          tone={STATUS_PILL_TONE[ins.status]}
                          size="sm"
                        />
                      </View>
                      <Text style={styles.recentCustomer} numberOfLines={1}>
                        {ins.customerName}
                      </Text>
                      <Text style={styles.recentAddress} numberOfLines={1}>
                        {ins.address}
                      </Text>
                      <Text style={styles.recentMeta}>{ROOF_MATERIAL_LABELS[ins.material]} · {ins.ageYears}yr</Text>
                    </View>
                  </PressableScale>
                </View>
              );
            })}
          </ScrollView>
        </Rise>
      )}

      {/* Pipeline mini — stage-GROUP cards with a colour-matched progress
          bar, occupied groups only (Drift #5). */}
      {pipelineStages.length > 0 && (
        <Rise index={8}>
          <SectionHeader title="Pipeline" style={styles.sectionHeaderSpacing} />
          <View style={styles.pipelineRow}>
            {pipelineStages.map(({ group, label, count }, i) => {
              const tone = PIPELINE_TONES[i % PIPELINE_TONES.length];
              const progress = pipelineTotal > 0 ? count / pipelineTotal : 0;
              return (
                <View key={group} style={styles.pipelineCard}>
                  <AnimatedCounter
                    value={count}
                    style={[styles.pipelineCount, { color: CHIP_TONES[tone].fg }]}
                  />
                  <Text style={[styles.pipelineLabel, dataLabel]} numberOfLines={2}>
                    {label}
                  </Text>
                  <ProgressBar
                    progress={progress}
                    tone={tone}
                    height={6}
                    style={styles.pipelineBar}
                    accessibilityLabel={`${label}, ${count} of ${pipelineTotal} items`}
                  />
                </View>
              );
            })}
          </View>
        </Rise>
      )}

      {/* Saved Estimates */}
      {estimates.length > 0 && (
        <View>
          <SectionHeader title="Saved estimates" style={styles.sectionHeaderSpacing} />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {estimates.map((est) => (
              <PressableScale
                key={est.id}
                style={styles.estimateCard}
                accessibilityRole="button"
                accessibilityLabel={`Saved estimate, ${est.address || 'no address'}, $${est.totalMid.toLocaleString()}. Open.`}
                // The saved estimate itself — not a fresh wizard.
                onPress={() => router.push({ pathname: '/estimate/[id]', params: { id: est.id } } as any)}
              >
                {recordCardUrl(est.propertyRecord) ? (
                  <Image
                    source={{ uri: recordCardUrl(est.propertyRecord) }}
                    style={styles.estimateImage}
                    contentFit="cover"
                    transition={150}
                  />
                ) : null}
                <Text style={styles.estimateAmount}>
                  ${est.totalMid.toLocaleString()}
                </Text>
                <Text style={styles.estimateRange}>
                  ${est.totalLow.toLocaleString()} – ${est.totalHigh.toLocaleString()}
                </Text>
                <Text style={styles.estimateAddress} numberOfLines={1}>
                  {est.address || 'No address'}
                </Text>
                <Text style={styles.estimateMeta}>
                  {est.totalSquares.toFixed(1)} sq · {est.scope.replace('_', ' ')}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>
        </View>
      )}

      {/* Activity — hidden until real events exist; lifecycle hooks fill it
          from the first job onward. */}
      {recentActivity.length > 0 && (
        <View>
          <SectionHeader
            title="Recent Activity"
            action={{ label: 'View all', onPress: () => router.push('/activity') }}
            style={styles.sectionHeaderSpacing}
          />
          <View style={styles.activityCard}>
            {recentActivity.map((evt, i) => {
              const href = activityHref(evt, activityRouteCtx);
              const body = (
                <>
                  <IconChip name={iconFor(evt.kind)} tone="quiet" size="sm" />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.activityMsg}>{evt.message}</Text>
                    <Text style={styles.activityTime}>{formatRelative(evt.createdAt)}</Text>
                  </View>
                  {href && <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />}
                </>
              );
              // Pressable only when the record it names still exists.
              return href ? (
                <PressableScale
                  key={evt.id}
                  style={[
                    styles.activityRow,
                    styles.activityRowPressable,
                    i > 0 && styles.activityRowBorder,
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={`${evt.message}. Open.`}
                  onPress={() => router.push(href as any)}
                >
                  {body}
                </PressableScale>
              ) : (
                <View key={evt.id} style={[styles.activityRow, i > 0 && styles.activityRowBorder]}>
                  {body}
                </View>
              );
            })}
          </View>
        </View>
      )}
    </Animated.ScrollView>

    <QuickActionsSheet visible={quickOpen} onClose={() => setQuickOpen(false)} />
    </View>
  );
}

function formatShort(amount: number): string {
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return String(Math.round(amount));
}

function iconFor(kind: string): keyof typeof Ionicons.glyphMap {
  switch (kind) {
    case 'job_created': return 'briefcase-outline';
    case 'photo_captured': return 'camera-outline';
    case 'analysis_ran': return 'analytics-outline';
    case 'proposal_sent': return 'send-outline';
    case 'proposal_signed': return 'document-text-outline';
    case 'knock_logged': return 'walk-outline';
    case 'storm_alert_received': return 'thunderstorm-outline';
    default: return 'ellipse-outline';
  }
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

function HeaderIconButton({
  icon,
  label,
  badge,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  /** Unread count; hidden at 0. */
  badge?: number;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={styles.iconBtn}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <View style={styles.iconBtnFill}>
        <Ionicons name={icon} size={22} color={colors.textInverse} />
        {badge && badge > 0 ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{badge > 99 ? '99+' : badge}</Text>
          </View>
        ) : null}
      </View>
    </PressableScale>
  );
}

/** Real report metrics, grouped on the navy dashboard masthead. */
function HeroStat({
  value,
  label,
  onPress,
  accessibilityLabel,
}: {
  value: string;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      style={styles.heroStat}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <Text style={styles.heroStatValue} numberOfLines={1}>
        {value}
      </Text>
      <Text style={[styles.heroStatLabel, dataLabel]} numberOfLines={2}>
        {label}
      </Text>
    </PressableScale>
  );
}

/** iOS grouped-list section label — 13/semibold uppercase, textSubtle. Kept
 *  only for the one header ("Get set up") that pairs with a non-actionable
 *  count rather than SectionHeader's pressable trailing action. */
function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

const TOOL_TONES = {
  blue: { fill: colors.headerBg, border: colors.headerBorder, ink: colors.tileBlueInk, muted: colors.textMuted, iconFill: colors.surface },
  orange: { fill: colors.tileOrange, border: colors.accentBorder, ink: colors.tileOrangeInk, muted: colors.accentInk, iconFill: colors.accentSoft },
  navy: { fill: colors.navy, border: colors.navyBorder, ink: colors.textInverse, muted: colors.onDarkMuted, iconFill: colors.navyRaised },
  neutral: { fill: colors.surface, border: colors.border, ink: colors.text, muted: colors.textMuted, iconFill: colors.brandSoft },
};

function ToolTile({
  icon,
  tone,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: keyof typeof TOOL_TONES;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  const palette = TOOL_TONES[tone];
  return (
    <PressableScale
      style={styles.toolTileShadow}
      pressedScale={0.97}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}.`}
      onPress={() => {
        tap();
        onPress();
      }}
    >
      <View style={[styles.toolTile, { backgroundColor: palette.fill, borderColor: palette.border }]}>
        <View style={[styles.toolTileIcon, { backgroundColor: palette.iconFill }]}>
          <Ionicons name={icon} size={24} color={palette.ink} />
        </View>
        <View style={styles.toolTileCopy}>
          <Text style={[styles.toolTileTitle, { color: palette.ink }]} numberOfLines={2}>{title}</Text>
          <Text style={[styles.toolTileSub, { color: palette.muted }]} numberOfLines={2}>{sub}</Text>
        </View>
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },

  // Full-width dashboard masthead, followed by the grouped workspace.
  heroBlock: {
    marginHorizontal: -spacing.xl,
    marginTop: -spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,

    overflow: 'hidden',
    backgroundColor: colors.navy,
  },
  heroSlot: { minHeight: touchTarget.standard },

  // Profile and utilities share the masthead's inverse contrast pair.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  identity: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget.standard },
  brandLogo: { width: 36, height: 36 },
  greeting: { flex: 1, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.medium, color: colors.onDarkMuted },
  headlineWrap: { position: 'relative', overflow: 'hidden', paddingVertical: spacing.xs },
  headline: { ...typography.heading, fontSize: fontSize.heroCompact, lineHeight: 44, color: colors.textInverse },
  headlineCompact: { fontSize: fontSize.display, lineHeight: fontSize.heroCompact },
  searchEntry: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: touchTarget.standard, paddingHorizontal: spacing.md, borderWidth: 1, borderColor: colors.border, borderRadius: radii.control, backgroundColor: colors.surface },
  searchEntryText: { flex: 1, color: colors.textMuted, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm },
  primaryAction: { backgroundColor: colors.accent },
  newJobAction: { backgroundColor: colors.brand },
  pairedActionText: { color: colors.textInverse, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, flexShrink: 1 },
  headerActions: { flexDirection: 'row' },
  badge: { position: 'absolute', top: -4, right: -6, minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.accent, borderWidth: 2, borderColor: colors.navy },
  badgeText: { fontSize: fontSize.caption, fontFamily: fontFamily.archivo.bold, color: colors.textInverse },
  iconBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnFill: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.control,
    backgroundColor: colors.navyRaised,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: colors.navyBorder,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Upright figures and compact captions keep small-phone metrics readable.
  heroStatsRow: { gap: spacing.sm, flexDirection: 'row', alignItems: 'stretch' },
  heroStat: { flex: 1, minHeight: touchTarget.preferred, gap: spacing.sm, padding: spacing.md, borderWidth: 1, borderColor: colors.navyBorder, borderRadius: radii.md, backgroundColor: colors.navyRaised },
  heroStatValue: {
    fontSize: fontSize.titleXl,
    fontFamily: fontFamily.heading,
    color: colors.textInverse,
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  heroStatLabel: { color: colors.onDarkMuted },
  heroStatDivider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.border },

  stack: { gap: spacing.md },

  // Hero CTAs — one burnt-gradient moment + one royal-chipped RichCard,
  // side by side, matched heights.
  heroRow: { flexDirection: 'row', gap: spacing.md },
  heroCta: { flex: 1, minHeight: touchTarget.preferred, padding: spacing.md, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, borderRadius: radii.button },

  // Quick Inspection: shadow lives on the outer (unclipped) layer so the
  // brand-tinted lift isn't clipped by the gradient's rounded corners — the
  // same split GlassCard uses for `glow` (a clipping layer can't also cast a
  // shadow on iOS).
  heroPrimaryShadow: { borderRadius: radii.card, ...shadows.raised },
  heroPrimaryClip: { flex: 1, borderRadius: radii.card, overflow: 'hidden' },
  heroPrimaryContent: { flex: 1, padding: spacing.lg, justifyContent: 'space-between' },
  heroPrimaryIconBadge: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: glass.fillHigh,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroPrimaryText: {
    fontSize: fontSize.titleMd,
    fontFamily: fontFamily.archivo.bold,
    color: colors.textInverse,
    lineHeight: 24,
  },
  heroPrimarySub: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.medium,
    color: colors.textInverse,
    opacity: 0.9,
    marginTop: spacing.xs,
  },
  heroQuietContent: { flex: 1, justifyContent: 'space-between' },
  heroQuietText: {
    fontSize: fontSize.titleMd,
    fontFamily: fontFamily.archivo.bold,
    color: colors.text,
    lineHeight: 24,
  },
  heroQuietSub: {
    fontSize: fontSize.caption,
    fontFamily: fontFamily.archivo.medium,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // iOS grouped-list section headers (the one hand-rolled exception).
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  sectionHeaderSpacing: { marginBottom: spacing.sm },
  sectionMeta: { fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },

  // Grouped white cards with 56pt rows — setup + education modules.
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.raised,
  },
  groupRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  groupRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  groupTitle: {
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
  groupSub: { fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },

  pipelineRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  pipelineCard: {
    flexGrow: 1,
    flexBasis: 110,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    minHeight: touchTarget.preferred,
    justifyContent: 'center',
    gap: spacing.xs,
    ...shadows.raised,
  },
  pipelineCount: {
    fontSize: fontSize.titleSm,
    fontFamily: fontFamily.archivo.bold,
    fontVariant: ['tabular-nums'],
  },
  // dataLabel supplies the mono/caps/tracking; only colour lives here.
  pipelineLabel: {
    color: colors.textMuted,
  },
  pipelineBar: { marginTop: spacing.xs },

  debugStorm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  debugStormText: { fontFamily: fontFamily.archivo.medium,
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },

  // Two-column tools use flat brand fills and stacked labels at small widths.
  toolGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  toolTileShadow: { width: '47.5%', borderRadius: radii.card, ...shadows.card },
  toolTile: {
    minHeight: touchTarget.preferred + touchTarget.small,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.card,
    padding: spacing.md,
    alignItems: 'flex-start',
    gap: spacing.sm,
    overflow: 'hidden',
  },
  toolTileCopy: { alignSelf: 'stretch', gap: spacing.xs },
  toolTileIcon: {
    width: 36,
    height: 36,
    borderRadius: radii.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.brandSoft,
  },
  toolTileTitle: { fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.semibold, color: colors.text },
  toolTileSub: { fontSize: fontSize.caption, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },

  recentRow: { gap: spacing.md, paddingRight: spacing.xl },
  // Shadow on the outer wrapper, clip + fill on the inner PressableScale —
  // a view can't clip its own content (rounded photo corners) and cast an
  // unclipped shadow at the same time on iOS.
  recentCardShadow: { borderRadius: radii.card, ...shadows.raised },
  recentCard: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  recentImage: { width: '100%', height: 120, backgroundColor: colors.surfaceMuted },
  recentImageFallback: { alignItems: 'center', justifyContent: 'center' },
  recentBody: { padding: spacing.lg, gap: spacing.xs },
  recentTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  // Report id — the mock's "RW-2841" convention (docs/DESIGN_1A.md §3).
  recentReport: {
    ...dataLabel,
    color: colors.textSubtle,
  },
  recentCustomer: {
    fontSize: fontSize.bodyLg,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
  recentAddress: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted },
  recentMeta: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.caption, color: colors.textSubtle, marginTop: spacing.xs },

  estimateImage: { width: '100%', height: 84, borderRadius: radii.md, marginBottom: spacing.sm, backgroundColor: colors.surfaceMuted },
  estimateCard: {
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: 4,
    ...shadows.raised,
  },
  estimateAmount: {
    fontSize: fontSize.titleMd,
    fontFamily: fontFamily.archivo.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  estimateRange: { fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  estimateAddress: { fontFamily: fontFamily.archivo.medium,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xs,
  },
  estimateMeta: { fontFamily: fontFamily.archivo.regular,
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: 2,
    textTransform: 'capitalize',
  },

  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    ...shadows.raised,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  activityRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  // A row that opens something takes the glove floor (Drift #1).
  activityRowPressable: { minHeight: touchTarget.standard },
  activityMsg: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.text },
  activityTime: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 2 },


});
