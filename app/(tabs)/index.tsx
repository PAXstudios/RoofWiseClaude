import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  Image,
  RefreshControl,
  Alert,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import { useAuthStore } from '@/lib/auth/authStore';
import { syncLeads } from '@/lib/services/leadSync';
import { syncCorrections } from '@/lib/services/correctionsSync';
import { checkStormWatch, leadsInStormCluster } from '@/lib/services/stormWatch';
import { FOCUS_STORM_LEADS } from '@/app/(tabs)/map';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { AICalibrationCard } from '@/components/AICalibrationCard';
import { WeatherTile } from '@/components/WeatherTile';
import { AnalysisQueueChip } from '@/components/AnalysisQueueChip';
import { PressableScale } from '@/components/PressableScale';
import { AnimatedCounter, PulseRing } from '@/components/motion';
import {
  LEAD_STAGE_LABELS,
  LEAD_STAGE_ORDER,
  ROOF_MATERIAL_LABELS,
  leadStageColumn,
  type LeadStage,
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

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const user = useAuthStore((s) => s.user);
  const inspections = useInspectionStore((s) => s.inspections);
  const alerts = useStormAlertStore((s) => s.alerts);
  const dismissAlert = useStormAlertStore((s) => s.dismiss);
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

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    homeEntrancePlayed = true;
  }, []);

  // Leads this alert's storm actually passed over. Re-derived from each lead's
  // persisted `lastStormMatch` (Storm Watch stamps `matchedAt` with the
  // alert's `firedAt`), so it survives a restart with no schema change.
  // Null when nothing matched — the line is omitted rather than reading
  // "0 leads" (Drift #5).
  const stormCluster = useMemo(
    () => (activeAlert ? leadsInStormCluster(leads, activeAlert) : null),
    [leads, activeAlert],
  );

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
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={[
        styles.container,
        // Clears the tab bar + home indicator + floating FAB so the last
        // module is never clipped behind chrome.
        { paddingBottom: insets.bottom + touchTarget.preferred + spacing.xl },
      ]}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.accent}
        />
      }
    >
      {/* Large-title greeting on the grouped ground — no card. */}
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

      {/* Storm Alert hero — hides when no active alert (Drift #4). */}
      {activeAlert && (
        <Rise index={1}>
          <PressableScale
            onPress={() =>
              router.push({ pathname: '/storm-alert/[id]', params: { id: activeAlert.id } } as any)
            }
            style={styles.stormHero}
          >
            <View style={styles.stormHeroChipRow}>
              <View style={styles.stormHeroChip}>
                <PulseRing size={8} color={colors.textInverse} />
                <Ionicons name="thunderstorm" size={14} color={colors.textInverse} />
                <Text style={styles.stormHeroChipText}>
                  {activeAlert.eventKind === 'hail' ? 'Severe Hail' : 'Severe Wind'}
                </Text>
              </View>
            </View>
            <Text style={styles.stormHeroTitle}>{activeAlert.areaLabel}</Text>
            <Text style={styles.stormHeroSub}>
              {activeAlert.propertyCount} propert{activeAlert.propertyCount === 1 ? 'y' : 'ies'} in range
              {activeAlert.hailSizeInches ? ` · ${activeAlert.hailSizeInches}" hail` : ''}
              {activeAlert.windSpeedMph ? ` · ${activeAlert.windSpeedMph} mph` : ''}
            </Text>
            {stormCluster && (
              <Pressable
                style={styles.stormClusterLink}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`${stormCluster.headline}. Opens the map filtered to matched leads.`}
                onPress={() =>
                  router.push({
                    pathname: '/(tabs)/map',
                    params: { focus: FOCUS_STORM_LEADS },
                  } as any)
                }
              >
                <Text style={styles.stormHeroSub}>{stormCluster.headline} ›</Text>
              </Pressable>
            )}
            <View style={styles.stormHeroCta}>
              <Text style={styles.stormHeroCtaText}>View impacted properties</Text>
              <Ionicons name="arrow-forward" size={20} color={colors.navy} />
            </View>
            {/* Real 56pt dismiss target, floated over the card corner. */}
            <Pressable
              style={styles.stormHeroClose}
              onPress={() => dismissAlert(activeAlert.id)}
              accessibilityRole="button"
              accessibilityLabel="Dismiss storm alert"
            >
              <Ionicons name="close" size={20} color={colors.textInverse} />
            </Pressable>
          </PressableScale>
        </Rise>
      )}

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

      {/* Stats — three quiet white cells, tabular-nums ink numbers. */}
      <Rise index={2}>
        <View style={styles.statsCard}>
          <StatCell label="Revenue YTD" value={revenueYTD} format={(n) => `$${formatShort(n)}`} />
          <View style={styles.statDivider} />
          <StatCell label="Leads" value={openLeads} />
          <View style={styles.statDivider} />
          <StatCell label="Pipeline" value={pipelineValue} format={(n) => `$${formatShort(n)}`} />
        </View>
      </Rise>

      {/* Hero CTAs — side by side (Drift #3). Quick Inspection is the one
          orange moment on this screen; New Job goes quiet. */}
      <Rise index={3} style={styles.heroRow}>
        <PressableScale
          style={[styles.heroCta, styles.heroPrimary]}
          accessibilityRole="button"
          accessibilityLabel="Quick Inspection. Camera to AI to claim packet."
          onPress={() => {
            tap();
            router.push('/quick-inspection');
          }}
        >
          <Ionicons name="scan-outline" size={26} color={colors.textInverse} />
          <View>
            <Text style={styles.heroPrimaryText}>Quick{'\n'}Inspection</Text>
            <Text style={styles.heroPrimarySub}>Camera → AI → Claim packet</Text>
          </View>
        </PressableScale>

        <PressableScale
          style={[styles.heroCta, styles.heroQuiet]}
          accessibilityRole="button"
          accessibilityLabel="New Job. Customer, insurance, roof."
          onPress={() => {
            tap();
            router.push('/new-job');
          }}
        >
          <Ionicons name="briefcase-outline" size={26} color={colors.text} />
          <View>
            <Text style={styles.heroQuietText}>New{'\n'}Job</Text>
            <Text style={styles.heroQuietSub}>Customer · Insurance · Roof</Text>
          </View>
        </PressableScale>
      </Rise>

      {/* Field tools — quiet iOS cells, thin icons, no tinted circles. */}
      <Rise index={4} style={styles.utilityRow}>
        <UtilityCta icon="thunderstorm-outline" title="Hail Tracer" sub="NOAA map" onPress={() => router.push('/hail-tracer')} />
        <UtilityCta icon="calculator-outline" title="Estimator" sub="Solar + cost" onPress={() => router.push('/estimator')} />
        <UtilityCta icon="car-outline" title="Mileage" sub="Tax log" onPress={() => router.push('/mileage')} />
      </Rise>

      <Rise index={5} style={styles.stack}>
        <WeatherTile />
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
                <Ionicons
                  name={step.done ? 'checkmark-circle' : step.icon}
                  size={22}
                  color={step.done ? colors.success : colors.textMuted}
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
          <SectionTitle title="What RoofWise does" />
          <View style={styles.groupCard}>
            <PressableScale
              style={styles.groupRow}
              accessibilityRole="button"
              accessibilityLabel="Hail Tracer. See where hail actually fell, straight from NOAA radar."
              onPress={() => router.push('/hail-tracer')}
            >
              <Ionicons name="thunderstorm-outline" size={22} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.groupTitle}>Hail Tracer</Text>
                <Text style={styles.groupSub}>
                  See where hail actually fell, straight from NOAA radar
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
              <Ionicons name="scan-outline" size={22} color={colors.textMuted} />
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
          owns the first-run state. */}
      {inspections.length > 0 && (
        <Rise index={7}>
          <Pressable
            onPress={() => router.push('/inspections')}
            accessibilityRole="button"
            accessibilityLabel="Recent jobs. View all."
            style={styles.sectionHeaderPressable}
          >
            <View style={styles.sectionHeaderRow}>
              <SectionTitle title="Recent Jobs" />
              <Text style={styles.viewAll}>View all</Text>
            </View>
          </Pressable>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {inspections.slice(0, 8).map((ins) => {
              const firstPhoto = ins.slopes.flatMap((sl) => sl.photoPaths)[0];
              return (
                <PressableScale
                  key={ins.id}
                  style={styles.recentCard}
                  onPress={() => router.push(`/job/${ins.id}` as any)}
                >
                  {firstPhoto ? (
                    <Image source={{ uri: firstPhoto }} style={styles.recentImage} />
                  ) : (
                    <View style={styles.recentImagePlaceholder}>
                      <Ionicons name="image-outline" size={28} color={colors.textSubtle} />
                    </View>
                  )}
                  <View style={styles.recentBody}>
                    <View style={styles.recentTopRow}>
                      <Text style={styles.recentReport}>{ins.reportId}</Text>
                      <View style={styles.statusPill}>
                        <Text style={styles.statusText}>{ins.status.replace('_', ' ')}</Text>
                      </View>
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
              );
            })}
          </ScrollView>
        </Rise>
      )}

      {/* Pipeline mini-Kanban — only occupied stages (Drift #5). */}
      {pipelineStages.length > 0 && (
        <Rise index={8}>
          <SectionTitle title="Pipeline" />
          <View style={styles.pipelineRow}>
            {pipelineStages.map(({ stage, label, count }) => (
              <View key={stage} style={styles.pipelineCard}>
                <AnimatedCounter value={count} style={styles.pipelineCount} />
                <Text style={styles.pipelineLabel} numberOfLines={2}>
                  {label}
                </Text>
              </View>
            ))}
          </View>
        </Rise>
      )}

      {/* Saved Estimates */}
      {estimates.length > 0 && (
        <View>
          <SectionTitle title="Saved estimates" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {estimates.map((est) => (
              <PressableScale
                key={est.id}
                style={styles.estimateCard}
                onPress={() => router.push('/estimator')}
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
          <Pressable
            onPress={() => router.push('/activity')}
            accessibilityRole="button"
            accessibilityLabel="Recent activity. View all."
            style={styles.sectionHeaderPressable}
          >
            <View style={styles.sectionHeaderRow}>
              <SectionTitle title="Recent Activity" />
              <Text style={styles.viewAll}>View all</Text>
            </View>
          </Pressable>
          <View style={styles.activityCard}>
            {recentActivity.map((evt, i) => (
              <View
                key={evt.id}
                style={[styles.activityRow, i > 0 && styles.activityRowBorder]}
              >
                <View style={styles.activityIconWrap}>
                  <Ionicons name={iconFor(evt.kind)} size={18} color={colors.textMuted} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityMsg}>{evt.message}</Text>
                  <Text style={styles.activityTime}>{formatRelative(evt.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        </View>
      )}
    </ScrollView>

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
        <Ionicons name={icon} size={22} color={colors.text} />
      </View>
    </PressableScale>
  );
}

function StatCell({
  label,
  value,
  format,
}: {
  label: string;
  value: number;
  format?: (n: number) => string;
}) {
  return (
    <View style={styles.statCell}>
      <AnimatedCounter value={value} format={format} style={styles.statValue} />
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

/** iOS grouped-list section label — 13/semibold uppercase, textSubtle. */
function SectionTitle({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
}

function UtilityCta({
  icon,
  title,
  sub,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
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
      <Ionicons name={icon} size={22} color={colors.text} />
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

  // Large-title header on the grouped ground.
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  greeting: {
    flex: 1,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
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
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Stats — quiet white cells with hairline separation.
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
  },

  stack: { gap: spacing.md },

  // Hero CTAs — one orange moment + one quiet surface, side by side.
  heroRow: { flexDirection: 'row', gap: spacing.md },
  heroCta: {
    flex: 1,
    minHeight: 128,
    borderRadius: radii.card,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  heroPrimary: {
    backgroundColor: colors.accent,
    ...shadows.card,
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
  heroQuiet: {
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.card,
  },
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

  // iOS grouped-list section headers.
  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  sectionHeaderPressable: { minHeight: touchTarget.standard, justifyContent: 'center' },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  sectionMeta: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    fontVariant: ['tabular-nums'],
  },
  viewAll: {
    color: colors.text,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
  },

  // Grouped white cards with 56pt rows — setup + education modules.
  groupCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.card,
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
    flexBasis: 88,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.md,
    alignItems: 'center',
    minHeight: touchTarget.standard,
    justifyContent: 'center',
    ...shadows.card,
  },
  pipelineCount: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  pipelineLabel: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: spacing.xs,
    textAlign: 'center',
  },

  // Storm hero — severity is a sanctioned accent moment; card itself is ink.
  stormHero: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },
  stormHeroChipRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  stormHeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.accent,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  stormHeroChipText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  stormHeroClose: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stormHeroTitle: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
  },
  stormHeroSub: {
    fontSize: fontSize.bodyMd,
    color: colors.textInverse,
    opacity: 0.85,
  },
  // Drift #1: a one-line text link is ~19pt tall on its own. The gloved-roofer
  // floor is a real 56pt target, not text height plus hitSlop.
  stormClusterLink: { minHeight: touchTarget.standard, justifyContent: 'center' },
  stormHeroCta: {
    marginTop: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stormHeroCtaText: {
    color: colors.navy,
    fontWeight: fontWeight.semibold,
    fontSize: fontSize.bodyMd,
  },

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
    ...shadows.card,
  },
  utilityTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    marginTop: spacing.xs,
  },
  utilitySub: { fontSize: fontSize.caption, color: colors.textMuted },

  recentRow: { gap: spacing.md, paddingRight: spacing.xl },
  recentCard: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
    ...shadows.card,
  },
  recentImage: { width: '100%', height: 120, backgroundColor: colors.surfaceMuted },
  recentImagePlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
  },
  statusText: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
    textTransform: 'capitalize',
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
    ...shadows.card,
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
    ...shadows.card,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  activityRowBorder: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  activityIconWrap: {
    width: 24,
    alignItems: 'center',
    marginTop: 1,
  },
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
    backgroundColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },
});
