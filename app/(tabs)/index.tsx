import { ScrollView, View, Text, Pressable, StyleSheet, Image, RefreshControl, Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { useMemo, useState } from 'react';
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
import { AICalibrationCard } from '@/components/AICalibrationCard';
import { WeatherTile } from '@/components/WeatherTile';
import { AnalysisQueueChip } from '@/components/AnalysisQueueChip';
import { PressableScale } from '@/components/PressableScale';
import { ROOF_MATERIAL_LABELS } from '@/lib/models/types';
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

function enter(index: number) {
  return FadeInDown.duration(360).delay(index * motion.staggerDelayMs);
}

export default function HomeScreen() {
  const router = useRouter();
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

  const firstName = useMemo(() => {
    if (inspectorName?.trim()) {
      return inspectorName.trim().split(/\s+/)[0];
    }
    const email = user?.email ?? '';
    if (!email) return 'there';
    return email.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase());
  }, [user, inspectorName]);

  const pipelineCounts = useMemo(() => {
    return {
      New: inspections.filter((i) => i.status === 'lead').length,
      Contacted: 0,
      Inspection: inspections.filter((i) => i.status === 'in_progress').length,
      Proposal: 0,
      Signed: inspections.filter((i) => i.status === 'complete').length,
    };
  }, [inspections]);

  const hour = new Date().getHours();
  const greeting =
    hour < 5 ? 'Up early' : hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl
          refreshing={refreshing}
          onRefresh={onRefresh}
          tintColor={colors.orange}
        />
      }
    >
      {/* Navy hero header card — greeting + KPIs */}
      <Animated.View entering={enter(0)}>
        <LinearGradient
          colors={[colors.navy, '#16275f']}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={styles.headerCard}
        >
          <View style={styles.headerRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.greeting}>{greeting},</Text>
              <Text style={styles.name}>{firstName}</Text>
            </View>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.push('/search')}
              hitSlop={8}
            >
              <Ionicons name="search" size={20} color={colors.cream} />
            </Pressable>
            <Pressable
              style={styles.iconBtn}
              onPress={() => router.push('/settings')}
              hitSlop={8}
            >
              <Ionicons name="person" size={20} color={colors.cream} />
            </Pressable>
          </View>

          <View style={styles.kpiRow}>
            <Kpi label="Revenue YTD" value={revenueYTD > 0 ? `$${formatShort(revenueYTD)}` : '$0'} />
            <View style={styles.kpiDivider} />
            <Kpi label="Leads" value={String(openLeads)} />
            <View style={styles.kpiDivider} />
            <Kpi label="Pipeline" value={pipelineValue > 0 ? `$${formatShort(pipelineValue)}` : '$0'} />
          </View>
        </LinearGradient>
      </Animated.View>

      <Animated.View entering={enter(1)} style={styles.section}>
        <WeatherTile />
        <AnalysisQueueChip />
      </Animated.View>

      {/* Storm Alert hero — hides when no active alert (Drift #4). */}
      {activeAlert && (
        <Animated.View entering={enter(1)}>
          <PressableScale
            onPress={() =>
              router.push({ pathname: '/storm-alert/[id]', params: { id: activeAlert.id } } as any)
            }
            style={styles.stormHero}
          >
            <View style={styles.stormHeroChipRow}>
              <View style={styles.stormHeroChip}>
                <Ionicons name="thunderstorm" size={14} color={colors.textInverse} />
                <Text style={styles.stormHeroChipText}>
                  {activeAlert.eventKind === 'hail' ? 'Severe Hail' : 'Severe Wind'}
                </Text>
              </View>
              <Pressable
                onPress={() => dismissAlert(activeAlert.id)}
                hitSlop={10}
              >
                <Ionicons name="close" size={20} color={colors.cream} />
              </Pressable>
            </View>
            <Text style={styles.stormHeroTitle}>{activeAlert.areaLabel}</Text>
            <Text style={styles.stormHeroSub}>
              {activeAlert.propertyCount} propert{activeAlert.propertyCount === 1 ? 'y' : 'ies'} in range
              {activeAlert.hailSizeInches ? ` · ${activeAlert.hailSizeInches}" hail` : ''}
              {activeAlert.windSpeedMph ? ` · ${activeAlert.windSpeedMph} mph` : ''}
            </Text>
            <View style={styles.stormHeroCta}>
              <Text style={styles.stormHeroCtaText}>View impacted properties</Text>
              <Ionicons name="arrow-forward" size={20} color={colors.navy} />
            </View>
          </PressableScale>
        </Animated.View>
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
          <Ionicons name="bug-outline" size={14} color={colors.slate} />
          <Text style={styles.debugStormText}>Inject demo storm alert</Text>
        </Pressable>
      )}

      {/* Hero CTAs */}
      <Animated.View entering={enter(2)} style={styles.heroRow}>
        <PressableScale
          style={styles.heroCta}
          onPress={() => router.push('/quick-inspection')}
        >
          <LinearGradient
            colors={[colors.orange, '#FF8A3D']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.heroPrimaryInner}
          >
            <View style={styles.heroIconWrap}>
              <Ionicons name="scan-outline" size={26} color={colors.textInverse} />
            </View>
            <Text style={styles.heroPrimaryText}>Quick{'\n'}Inspection</Text>
            <Text style={styles.heroPrimarySub}>Camera → AI → Claim packet</Text>
          </LinearGradient>
        </PressableScale>

        <PressableScale
          style={[styles.heroCta, styles.heroSecondary]}
          onPress={() => router.push('/new-job')}
        >
          <View style={[styles.heroIconWrap, styles.heroIconWrapNavy]}>
            <Ionicons name="briefcase-outline" size={26} color={colors.navy} />
          </View>
          <Text style={styles.heroSecondaryText}>New{'\n'}Job</Text>
          <Text style={styles.heroSecondarySub}>Customer · Insurance · Roof</Text>
        </PressableScale>
      </Animated.View>

      {/* Field tools */}
      <Animated.View entering={enter(3)} style={styles.utilityRow}>
        <UtilityCta icon="thunderstorm" title="Hail Tracer" sub="NOAA map" onPress={() => router.push('/hail-tracer')} />
        <UtilityCta icon="calculator-outline" title="Estimator" sub="Solar + cost" onPress={() => router.push('/estimator')} />
        <UtilityCta icon="car-outline" title="Mileage" sub="Tax log" onPress={() => router.push('/mileage')} />
      </Animated.View>

      <Animated.View entering={enter(4)}>
        <AICalibrationCard />
      </Animated.View>

      {/* Recent Jobs */}
      <Animated.View entering={enter(5)}>
        <Pressable onPress={() => router.push('/inspections')} hitSlop={6}>
          <View style={styles.sectionHeaderRow}>
            <SectionTitle title="Recent Jobs" />
            {inspections.length > 0 && (
              <Text style={styles.viewAll}>View all</Text>
            )}
          </View>
        </Pressable>
        {inspections.length === 0 ? (
          <EmptyCard
            icon="hammer-outline"
            message="No jobs yet. Tap New Job above to create your first."
          />
        ) : (
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
                      <Ionicons name="image-outline" size={28} color={colors.slate} />
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
        )}
      </Animated.View>

      {/* Pipeline mini-Kanban */}
      <Animated.View entering={enter(6)}>
        <SectionTitle title="Pipeline" />
        <View style={styles.pipelineRow}>
          {(Object.entries(pipelineCounts) as [string, number][]).map(([stage, count]) => (
            <View key={stage} style={[styles.pipelineCard, count > 0 && styles.pipelineCardActive]}>
              <Text style={[styles.pipelineCount, count === 0 && styles.pipelineCountZero]}>{count}</Text>
              <Text style={styles.pipelineLabel}>{stage}</Text>
            </View>
          ))}
        </View>
      </Animated.View>

      {/* Today's Plan */}
      <Animated.View entering={enter(7)}>
        <SectionTitle title="Today's Plan" />
        <EmptyCard
          icon="calendar-outline"
          message="Nothing scheduled. Add jobs to your plan to see them here."
        />
      </Animated.View>

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

      {/* Activity */}
      <View>
        <Pressable onPress={() => router.push('/activity')} hitSlop={6}>
          <View style={styles.sectionHeaderRow}>
            <SectionTitle title="Recent Activity" />
            {recentActivity.length > 0 && (
              <Text style={styles.viewAll}>View all</Text>
            )}
          </View>
        </Pressable>
        {recentActivity.length === 0 ? (
          <EmptyCard
            icon="time-outline"
            message="Inspections, knocks, and saves will show up here."
          />
        ) : (
          <View style={styles.activityCard}>
            {recentActivity.map((evt, i) => (
              <View
                key={evt.id}
                style={[styles.activityRow, i > 0 && styles.activityRowBorder]}
              >
                <View style={styles.activityIconWrap}>
                  <Ionicons name={iconFor(evt.kind)} size={16} color={colors.orange} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.activityMsg}>{evt.message}</Text>
                  <Text style={styles.activityTime}>{formatRelative(evt.createdAt)}</Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={{ height: spacing.xxxl * 2 }} />
    </ScrollView>

    <PressableScale style={styles.fab} pressedScale={0.92} onPress={onQuickAdd}>
      <Ionicons name="add" size={30} color={colors.textInverse} />
    </PressableScale>
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

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.kpiCell}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function SectionTitle({ title }: { title: string }) {
  return (
    <View style={styles.sectionTitleRow}>
      <View style={styles.sectionTick} />
      <Text style={styles.sectionTitle}>{title}</Text>
    </View>
  );
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
    <PressableScale style={styles.utilityCta} onPress={onPress}>
      <View style={styles.utilityIconWrap}>
        <Ionicons name={icon} size={20} color={colors.orange} />
      </View>
      <Text style={styles.utilityTitle}>{title}</Text>
      <Text style={styles.utilitySub}>{sub}</Text>
    </PressableScale>
  );
}

function EmptyCard({
  icon,
  message,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  message: string;
}) {
  return (
    <View style={styles.emptyCard}>
      <View style={styles.emptyIconWrap}>
        <Ionicons name={icon} size={24} color={colors.orange} />
      </View>
      <Text style={styles.emptyText}>{message}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    padding: spacing.xl,
    gap: spacing.lg,
    paddingBottom: spacing.xxxl,
  },

  headerCard: {
    borderRadius: radii.xl,
    padding: spacing.xl,
    gap: spacing.xl,
    ...shadows.pressed,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  greeting: { fontSize: fontSize.bodyMd, color: 'rgba(240,240,228,0.72)' },
  name: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.cream,
    letterSpacing: -0.5,
  },
  iconBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
  },

  kpiRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: radii.card,
    paddingVertical: spacing.lg,
  },
  kpiCell: { flex: 1, alignItems: 'center' },
  kpiDivider: { width: 1, height: 32, backgroundColor: 'rgba(255,255,255,0.14)' },
  kpiValue: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.orange,
  },
  kpiLabel: {
    fontSize: fontSize.caption,
    color: 'rgba(240,240,228,0.72)',
    marginTop: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  section: { gap: spacing.lg },

  heroRow: { flexDirection: 'row', gap: spacing.md },
  heroCta: {
    flex: 1,
    minHeight: 150,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...shadows.pressed,
  },
  heroPrimaryInner: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  heroIconWrap: {
    width: 44,
    height: 44,
    borderRadius: radii.md,
    backgroundColor: 'rgba(255,255,255,0.22)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  heroIconWrapNavy: { backgroundColor: colors.brandSoft },
  heroPrimaryText: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  heroPrimarySub: {
    fontSize: fontSize.caption,
    color: 'rgba(255,255,255,0.92)',
  },
  heroSecondary: {
    backgroundColor: colors.surface,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  heroSecondaryText: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    lineHeight: 24,
    marginTop: spacing.sm,
  },
  heroSecondarySub: { fontSize: fontSize.caption, color: colors.slate },

  sectionTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  sectionTick: {
    width: 4,
    height: 18,
    borderRadius: 2,
    backgroundColor: colors.orange,
  },
  sectionTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    letterSpacing: -0.3,
  },
  sectionHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  viewAll: { color: colors.orange, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.md,
    ...shadows.card,
  },
  emptyIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyText: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
    lineHeight: 20,
  },

  pipelineRow: { flexDirection: 'row', gap: spacing.sm },
  pipelineCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    padding: spacing.md,
    alignItems: 'center',
    minHeight: touchTarget.standard,
    justifyContent: 'center',
    ...shadows.card,
  },
  pipelineCardActive: {
    borderBottomWidth: 3,
    borderBottomColor: colors.orange,
  },
  pipelineCount: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.orange,
  },
  pipelineCountZero: { color: colors.borderStrong },
  pipelineLabel: { fontSize: fontSize.caption, color: colors.slate, marginTop: spacing.xs },

  stormHero: {
    backgroundColor: colors.navy,
    borderRadius: radii.lg,
    padding: spacing.lg,
    gap: spacing.sm,
    borderLeftWidth: 4,
    borderLeftColor: colors.orange,
    ...shadows.pressed,
  },
  stormHeroChipRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stormHeroChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: colors.orange,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  stormHeroChipText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.bold, textTransform: 'uppercase' },
  stormHeroTitle: { fontSize: fontSize.titleLg, fontWeight: fontWeight.bold, color: colors.textInverse },
  stormHeroSub: { fontSize: fontSize.bodyMd, color: 'rgba(240,240,228,0.85)' },
  stormHeroCta: {
    marginTop: spacing.md,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.cream,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: spacing.sm,
  },
  stormHeroCtaText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },

  debugStorm: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  debugStormText: { color: colors.slate, fontSize: fontSize.caption, fontWeight: fontWeight.medium },

  utilityRow: { flexDirection: 'row', gap: spacing.md },
  utilityCta: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.sm,
    ...shadows.card,
  },
  utilityIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  utilityTitle: { fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.navy },
  utilitySub: { fontSize: fontSize.caption, color: colors.slate },

  recentRow: { gap: spacing.md, paddingRight: spacing.xl },
  recentCard: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.lg,
    overflow: 'hidden',
    ...shadows.card,
  },
  recentImage: { width: '100%', height: 120, backgroundColor: colors.surfaceMuted },
  recentImagePlaceholder: {
    width: '100%',
    height: 120,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentBody: { padding: spacing.lg, gap: spacing.xs },
  recentTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentReport: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold, letterSpacing: 0.3 },
  statusPill: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.accentSoft,
  },
  statusText: { fontSize: fontSize.caption, color: colors.orange, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },
  recentCustomer: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  recentAddress: { fontSize: fontSize.bodySm, color: colors.slate },
  recentMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: spacing.xs },

  estimateCard: {
    width: 200,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: 4,
    borderTopWidth: 3,
    borderTopColor: colors.orange,
    ...shadows.card,
  },
  estimateAmount: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.orange },
  estimateRange: { fontSize: fontSize.caption, color: colors.slate },
  estimateAddress: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium, marginTop: spacing.xs },
  estimateMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2, textTransform: 'capitalize' },

  activityCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    paddingVertical: spacing.sm,
  },
  activityRowBorder: { borderTopWidth: 1, borderTopColor: colors.border },
  activityIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: colors.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  activityMsg: { fontSize: fontSize.bodyMd, color: colors.navy },
  activityTime: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2 },

  fab: {
    position: 'absolute',
    right: spacing.xl,
    bottom: spacing.xl,
    width: touchTarget.sticky,
    height: touchTarget.sticky,
    borderRadius: touchTarget.sticky / 2,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.pressed,
  },
});
