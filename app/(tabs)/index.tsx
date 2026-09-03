import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  RefreshControl,
  Alert,
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
import { activityHref } from '@/components/home/activityRoute';
import { Aurora } from '@/components/glass/Aurora';
import { IconChip, CHIP_TONES, type ChipTone } from '@/components/ui/IconChip';
import { StatCard } from '@/components/ui/StatCard';
import { RichCard } from '@/components/ui/RichCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { Pill, type PillTone } from '@/components/ui/Pill';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  ROOF_MATERIAL_LABELS,
  leadStageColumn,
  type InspectionStatus,
  type LeadStage,
} from '@/lib/models/types';
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
  const estimates = useEstimateStore((s) => s.estimates.slice(0, 4));
  const proposals = useProposalStore((s) => s.proposals);
  const leads = useLeadStore((s) => s.leads);
  const inspectorName = useInspectorProfileStore((s) => s.profile.fullName);
  const serviceAreaCount = useServiceAreaStore((s) => s.areas.length);
  // Today's real next actions — same helper Plan reads, so the two agree.
  const agenda = useTodayAgenda();

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

  const pipelineValue = useMemo(
    () =>
      proposals
        .filter((p) => p.status === 'sent' || p.status === 'viewed')
        .reduce((sum, p) => sum + p.total, 0),
    [proposals],
  );

  const revenueYTD = useMemo(() => {
    const year = new Date().getFullYear();
    return proposals
      .filter(
        (p) =>
          p.status === 'signed' &&
          p.signedAt &&
          new Date(p.signedAt).getFullYear() === year,
      )
      .reduce((sum, p) => sum + p.total, 0);
  }, [proposals]);

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

  const onQuickAdd = () => {
    Alert.alert('Add', undefined, [
      { text: 'Quick Inspection', onPress: () => router.push('/quick-inspection') },
      { text: 'New Job', onPress: () => router.push('/new-job') },
      { text: 'New Lead', onPress: () => router.push('/new-lead') },
      { text: 'Cost Estimate', onPress: () => router.push('/estimator') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

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

  // Real per-stage lead counts, folded onto board columns exactly as the Leads
  // Pipeline board buckets them. Stages with no leads are omitted rather than
  // rendered as zero cards (Drift #5).
  const pipelineStages = useMemo(() => {
    const counts = new Map<LeadStage, number>();
    for (const l of leads) {
      const column = leadStageColumn(l.stage);
      counts.set(column, (counts.get(column) ?? 0) + 1);
    }
    return LEAD_STAGE_ORDER.filter((s) => (counts.get(s) ?? 0) > 0).map((stage) => ({
      stage,
      label: LEAD_STAGE_LABELS[stage],
      count: counts.get(stage) ?? 0,
    }));
  }, [leads]);
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
      {/* ── The cinematic moment ────────────────────────────────────────
          Greeting + WeatherHero are ONE bleed-to-edge dark block, not two
          modules on the grey ground. This is the congruence fix: the app
          used to open on #F6F6FA with white cells while onboarding opens on
          black with a drifting brand aurora, so the two read as different
          products. Same sky here — `gradients.stormNight` with the SAME
          `Aurora` component onboarding uses, layered transparent so the
          gradient ramp survives underneath. One per screen: everything
          below stays light and quiet. */}
      <View style={styles.heroBlock}>
        <LinearGradient
          colors={gradients.stormNight}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />
        <Aurora transparent />

        <Rise index={0}>
          <View style={styles.headerRow}>
            <Text style={styles.greeting} accessibilityRole="header">
              {greeting}
            </Text>
            <View style={styles.headerActions}>
              <HeaderIconButton
                icon="search-outline"
                label="Search"
                onPress={() => router.push('/search')}
              />
              <HeaderIconButton
                icon="person-circle-outline"
                label="Settings"
                onPress={() => router.push('/settings')}
              />
            </View>
          </View>
        </Rise>

        {/* The owner's headline ask — first module under the greeting, per
            the v3 Home composition. It self-selects among alert / calm /
            checking / unavailable and always renders SOMETHING, so this slot
            is never an empty gap between the greeting and the stats. */}
        <Rise index={1} style={styles.heroSlot}>
          <Animated.View style={heroParallaxStyle}>
            <WeatherHero scrollY={scrollY} />
          </Animated.View>
        </Rise>
      </View>

      {/* No standalone Storm Alert card here: WeatherHero (mounted above,
          in the slot WeatherTile used to occupy) reads useStormAlertStore
          itself and renders the full escalated treatment — flag, headline,
          real cluster consequence line, dismiss — as its own state A. A
          second card here would duplicate it and break "one cinematic
          moment per screen." Drift #4 still holds: it only appears with a
          genuine active alert, because that's WeatherHero's own gate. */}
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

      {/* Hero CTAs — side by side (Drift #3). Quick Inspection is the one
          burnt moment; New Job is a crafted, royal-chipped card. */}
      <Rise index={2} style={styles.heroRow}>
        <PressableScale
          style={[styles.heroCta, styles.heroPrimaryShadow]}
          accessibilityRole="button"
          accessibilityLabel="Quick Inspection. Camera to AI to claim packet."
          onPress={() => {
            tap();
            router.push('/quick-inspection');
          }}
        >
          <View style={styles.heroPrimaryClip}>
            <LinearGradient
              colors={gradients.accent}
              style={StyleSheet.absoluteFill}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
            />
            <View style={styles.heroPrimaryContent}>
              <View style={styles.heroPrimaryIconBadge}>
                <Ionicons name="scan-outline" size={22} color={colors.textInverse} />
              </View>
              <View>
                <Text style={styles.heroPrimaryText}>Quick{'\n'}Inspection</Text>
                <Text style={styles.heroPrimarySub}>Camera → AI → Claim packet</Text>
              </View>
            </View>
          </View>
        </PressableScale>

        <RichCard
          onPress={() => {
            tap();
            router.push('/new-job');
          }}
          accessibilityLabel="New Job. Customer, insurance, roof."
          style={styles.heroCta}
          contentStyle={styles.heroQuietContent}
        >
          <IconChip name="briefcase-outline" tone="blue" size="md" />
          <View>
            <Text style={styles.heroQuietText}>New{'\n'}Job</Text>
            <Text style={styles.heroQuietSub}>Customer · Insurance · Roof</Text>
          </View>
        </RichCard>
      </Rise>

      {/* Today — the roofer's real next actions (today's inspections,
          follow-ups due, leads going cold, the live route), each row landing
          on its job or lead. It sits right under the hero CTAs ONLY when
          there is something to do: on a quiet day it is absent entirely, so
          the weather + map first-screenful the owner asked for is untouched
          and no "nothing today" placeholder ever occupies the cockpit. */}
      {agenda.hasItems && (
        <Rise index={3}>
          <TodayModule agenda={agenda} />
        </Rise>
      )}

      {/* Area Activity — the owner's second headline module, directly under
          the hero CTAs so weather and map are the two things the first screen
          is about. Always rendered: the card owns its own honest states (no
          Maps key / no service area / no qualifying storms) and never
          fabricates a pin or a count (Drift #5).

          It sits ABOVE the stats deliberately. The stats row costs ~100pt and
          on a fresh install reads "$0 / 0 / $0" — the least useful thing on a
          390×844 first screen — and with it in front, the 200pt map body
          started below the fold, so the owner's "map AND the weather" ask was
          only half met on first paint. Weather and map now both land in the
          first screenful; the numbers are one thumb-flick away. */}
      <Rise index={3}>
        <AreaActivityCard />
      </Rise>

      {/* Stats — colour-chipped StatCards. Deltas are omitted: nothing in the
          stores yet tracks a true prior-period comparison, and inventing one
          would be a mock (Drift #5). Each card opens Reports — the business
          dashboard used to be two levels deep behind Settings. */}
      <Rise index={4} style={styles.statsRow}>
        <StatCard
          icon="cash-outline"
          tone="green"
          value={`$${formatShort(revenueYTD)}`}
          label="Revenue YTD"
          style={{ flex: 1 }}
          onPress={() => router.push('/reports')}
          accessibilityLabel={`Revenue year to date $${formatShort(revenueYTD)}. Open reports.`}
        />
        <StatCard
          icon="people-outline"
          tone="blue"
          value={String(openLeads)}
          label="Leads"
          style={{ flex: 1 }}
          onPress={() => router.push('/reports')}
          accessibilityLabel={`${openLeads} open leads. Open reports.`}
        />
        <StatCard
          icon="trending-up-outline"
          tone="purple"
          value={`$${formatShort(pipelineValue)}`}
          label="Pipeline"
          style={{ flex: 1 }}
          onPress={() => router.push('/reports')}
          accessibilityLabel={`Pipeline $${formatShort(pipelineValue)}. Open reports.`}
        />
      </Rise>

      {/* Field tools — crafted cells, colour-chipped per tool. */}
      <Rise index={5} style={styles.utilityRow}>
        <UtilityCta icon="thunderstorm-outline" tone="blue" title="Storm Tracer" sub="Hail + wind map" onPress={() => router.push({ pathname: '/(tabs)/map', params: { filter: 'storms' } } as any)} />
        <UtilityCta icon="calculator-outline" tone="green" title="Estimator" sub="Solar + cost" onPress={() => router.push('/estimator')} />
        <UtilityCta icon="car-outline" tone="purple" title="Mileage" sub="Tax log" onPress={() => router.push('/mileage')} />
      </Rise>

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
              const firstPhoto = ins.slopes.flatMap((sl) => sl.photoPaths)[0];
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

      {/* Pipeline mini — stage cards with a colour-matched progress bar,
          occupied stages only (Drift #5). */}
      {pipelineStages.length > 0 && (
        <Rise index={8}>
          <SectionHeader title="Pipeline" style={styles.sectionHeaderSpacing} />
          <View style={styles.pipelineRow}>
            {pipelineStages.map(({ stage, label, count }, i) => {
              const tone = PIPELINE_TONES[i % PIPELINE_TONES.length];
              const progress = pipelineTotal > 0 ? count / pipelineTotal : 0;
              return (
                <View key={stage} style={styles.pipelineCard}>
                  <AnimatedCounter
                    value={count}
                    style={[styles.pipelineCount, { color: CHIP_TONES[tone].fg }]}
                  />
                  <Text style={styles.pipelineLabel} numberOfLines={2}>
                    {label}
                  </Text>
                  <ProgressBar
                    progress={progress}
                    tone={tone}
                    height={6}
                    style={styles.pipelineBar}
                    accessibilityLabel={`${label}, ${count} of ${pipelineTotal} leads`}
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

    <Rise index={9} style={styles.fabWrap}>
      <PressableScale
        style={styles.fab}
        pressedScale={0.9}
        accessibilityRole="button"
        accessibilityLabel="Quick add: inspection, job, lead, or estimate"
        onPress={() => {
          tap();
          onQuickAdd();
        }}
      >
        <Ionicons name="add" size={28} color={colors.textInverse} />
      </PressableScale>
    </Rise>
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
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
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
      </View>
    </PressableScale>
  );
}

/** iOS grouped-list section label — 13/semibold uppercase, textSubtle. Kept
 *  only for the one header ("Get set up") that pairs with a non-actionable
 *  count rather than SectionHeader's pressable trailing action. */
function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function UtilityCta({
  icon,
  tone,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  tone: ChipTone;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <PressableScale
      style={styles.utilityCta}
      accessibilityRole="button"
      accessibilityLabel={`${title}. ${sub}.`}
      onPress={onPress}
    >
      <IconChip name={icon} tone={tone} size="md" />
      <Text style={styles.utilityTitle}>{title}</Text>
      <Text style={styles.utilitySub}>{sub}</Text>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    gap: spacing.lg,
  },

  // ── Dark bleed-to-edge hero block ──────────────────────────────────────
  // Negative margins cancel the scroll container's gutter + top pad so the
  // brand sky runs to all three edges; the bottom keeps a large radius so the
  // block reads as a pane the light content slides out from under.
  heroBlock: {
    marginHorizontal: -spacing.xl,
    marginTop: -spacing.md,
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.lg,
    borderBottomLeftRadius: radii.xl,
    borderBottomRightRadius: radii.xl,
    overflow: 'hidden',
    backgroundColor: brand.royalInk,
  },
  heroSlot: { minHeight: touchTarget.standard },

  // Large-title header, now on the brand sky rather than the grouped ground.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  greeting: {
    flex: 1,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    // Tight, large, high-contrast — the onboarding display voice, carried
    // into the app's own titles.
    color: colors.textInverse,
    letterSpacing: -0.8,
  },
  headerActions: { flexDirection: 'row' },
  iconBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconBtnFill: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: glass.fillHigh,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stats — colour-chipped StatCards in a row.
  statsRow: { flexDirection: 'row', gap: spacing.md },

  stack: { gap: spacing.md },

  // Hero CTAs — one burnt-gradient moment + one royal-chipped RichCard,
  // side by side, matched heights.
  heroRow: { flexDirection: 'row', gap: spacing.md },
  heroCta: { flex: 1, minHeight: 132 },

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
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    lineHeight: 24,
  },
  heroPrimarySub: {
    fontSize: fontSize.caption,
    color: colors.textInverse,
    opacity: 0.9,
    marginTop: spacing.xs,
  },
  heroQuietContent: { flex: 1, justifyContent: 'space-between' },
  heroQuietText: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    lineHeight: 24,
  },
  heroQuietSub: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
  },

  // iOS grouped-list section headers (the one hand-rolled exception).
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
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
  sectionMeta: {
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
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  groupSub: {
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
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  pipelineLabel: {
    fontSize: fontSize.caption,
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
  debugStormText: {
    color: colors.textMuted,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
  },

  utilityRow: { flexDirection: 'row', gap: spacing.md },
  utilityCta: {
    flex: 1,
    alignItems: 'center',
    gap: 2,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    minHeight: touchTarget.standard,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    justifyContent: 'center',
    ...shadows.raised,
  },
  utilityTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  utilitySub: { fontSize: fontSize.caption, color: colors.textMuted },

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
  recentReport: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.3,
  },
  recentCustomer: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  recentAddress: { fontSize: fontSize.bodySm, color: colors.textMuted },
  recentMeta: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: spacing.xs },

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
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  estimateRange: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  estimateAddress: {
    fontSize: fontSize.bodyMd,
    color: colors.text,
    fontWeight: fontWeight.medium,
    marginTop: spacing.xs,
  },
  estimateMeta: {
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
  activityMsg: { fontSize: fontSize.bodyMd, color: colors.text },
  activityTime: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 2 },

  fabWrap: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
  },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.hero,
  },
});
