import { ScrollView, View, Text, Pressable, StyleSheet, Image } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useAuthStore } from '@/lib/auth/authStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useInspectorProfileStore } from '@/lib/stores/inspectorProfileStore';
import { AICalibrationCard } from '@/components/AICalibrationCard';
import { WeatherTile } from '@/components/WeatherTile';
import { ROOF_MATERIAL_LABELS } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

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
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.container}
      showsVerticalScrollIndicator={false}
    >
      {/* Welcome header */}
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
          <Ionicons name="search" size={22} color={colors.navy} />
        </Pressable>
        <Pressable
          style={styles.iconBtn}
          onPress={() => router.push('/settings')}
          hitSlop={8}
        >
          <Ionicons name="person-circle-outline" size={28} color={colors.navy} />
        </Pressable>
      </View>

      <WeatherTile />

      {/* Storm Alert hero — hides when no active alert (Drift #4). */}
      {activeAlert && (
        <Pressable
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
        </Pressable>
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

      {/* Hail Tracer + Estimator + Mileage CTAs */}
      <View style={styles.utilityRow}>
        <Pressable style={styles.utilityCta} onPress={() => router.push('/hail-tracer')}>
          <Ionicons name="thunderstorm" size={22} color={colors.orange} />
          <View style={{ flex: 1 }}>
            <Text style={styles.utilityTitle}>Hail Tracer</Text>
            <Text style={styles.utilitySub}>NOAA map</Text>
          </View>
        </Pressable>
        <Pressable style={styles.utilityCta} onPress={() => router.push('/estimator')}>
          <Ionicons name="calculator-outline" size={22} color={colors.orange} />
          <View style={{ flex: 1 }}>
            <Text style={styles.utilityTitle}>Estimator</Text>
            <Text style={styles.utilitySub}>Solar + cost</Text>
          </View>
        </Pressable>
        <Pressable style={styles.utilityCta} onPress={() => router.push('/mileage')}>
          <Ionicons name="car-outline" size={22} color={colors.orange} />
          <View style={{ flex: 1 }}>
            <Text style={styles.utilityTitle}>Mileage</Text>
            <Text style={styles.utilitySub}>Tax log</Text>
          </View>
        </Pressable>
      </View>

      {/* Hero CTAs */}
      <View style={styles.heroRow}>
        <Pressable
          style={[styles.heroCta, styles.heroPrimary]}
          onPress={() => router.push('/quick-inspection')}
        >
          <Ionicons name="scan-outline" size={28} color={colors.textInverse} />
          <Text style={styles.heroPrimaryText}>Quick Inspection</Text>
          <Text style={styles.heroPrimarySub}>Camera → AI → Claim packet</Text>
        </Pressable>

        <Pressable
          style={[styles.heroCta, styles.heroSecondary]}
          onPress={() => router.push('/new-job')}
        >
          <Ionicons name="briefcase-outline" size={28} color={colors.navy} />
          <Text style={styles.heroSecondaryText}>New Job</Text>
          <Text style={styles.heroSecondarySub}>Customer · Insurance · Roof</Text>
        </Pressable>
      </View>

      {/* KPI tiles */}
      <View style={styles.kpiRow}>
        <Kpi label="Revenue YTD" value={revenueYTD > 0 ? `$${formatShort(revenueYTD)}` : '$0'} />
        <Kpi label="Leads" value={String(openLeads)} />
        <Kpi label="Pipeline" value={pipelineValue > 0 ? `$${formatShort(pipelineValue)}` : '$0'} />
      </View>

      <AICalibrationCard />

      {/* Recent Jobs */}
      <Pressable onPress={() => router.push('/inspections')} hitSlop={6}>
        <View style={styles.activityHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Jobs</Text>
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
              <Pressable
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
              </Pressable>
            );
          })}
        </ScrollView>
      )}

      {/* Pipeline mini-Kanban */}
      <SectionHeader title="Pipeline" />
      <View style={styles.pipelineRow}>
        {(Object.entries(pipelineCounts) as [string, number][]).map(([stage, count]) => (
          <View key={stage} style={styles.pipelineCard}>
            <Text style={styles.pipelineCount}>{count}</Text>
            <Text style={styles.pipelineLabel}>{stage}</Text>
          </View>
        ))}
      </View>

      {/* Today's Plan */}
      <SectionHeader title="Today's Plan" />
      <EmptyCard
        icon="calendar-outline"
        message="Nothing scheduled. Add jobs to your plan to see them here."
      />

      {/* Saved Estimates */}
      {estimates.length > 0 && (
        <>
          <SectionHeader title="Saved estimates" />
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={styles.recentRow}
          >
            {estimates.map((est) => (
              <Pressable
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
              </Pressable>
            ))}
          </ScrollView>
        </>
      )}

      {/* Activity */}
      <Pressable onPress={() => router.push('/activity')} hitSlop={6}>
        <View style={styles.activityHeaderRow}>
          <Text style={styles.sectionTitle}>Recent Activity</Text>
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
              <Ionicons name={iconFor(evt.kind)} size={18} color={colors.orange} />
              <View style={{ flex: 1 }}>
                <Text style={styles.activityMsg}>{evt.message}</Text>
                <Text style={styles.activityTime}>{formatRelative(evt.createdAt)}</Text>
              </View>
            </View>
          ))}
        </View>
      )}

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
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
    <View style={styles.kpiCard}>
      <Text style={styles.kpiValue}>{value}</Text>
      <Text style={styles.kpiLabel}>{label}</Text>
    </View>
  );
}

function SectionHeader({ title }: { title: string }) {
  return <Text style={styles.sectionTitle}>{title}</Text>;
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
      <Ionicons name={icon} size={32} color={colors.slate} />
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
  headerRow: { flexDirection: 'row', alignItems: 'center' },
  greeting: { fontSize: fontSize.bodyMd, color: colors.slate },
  name: { fontSize: fontSize.titleXl, fontWeight: fontWeight.semibold, color: colors.navy },
  profileBtn: { padding: spacing.sm },
  iconBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: spacing.sm,
    ...shadows.card,
  },

  heroRow: { flexDirection: 'row', gap: spacing.md },
  heroCta: {
    flex: 1,
    minHeight: 120,
    borderRadius: radii.card,
    padding: spacing.lg,
    justifyContent: 'space-between',
    ...shadows.card,
  },
  heroPrimary: { backgroundColor: colors.orange },
  heroPrimaryText: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    marginTop: spacing.sm,
  },
  heroPrimarySub: {
    fontSize: fontSize.bodySm,
    color: 'rgba(255,255,255,0.92)',
  },
  heroSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
  },
  heroSecondaryText: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    marginTop: spacing.sm,
  },
  heroSecondarySub: { fontSize: fontSize.bodySm, color: colors.slate },

  kpiRow: { flexDirection: 'row', gap: spacing.md },
  kpiCard: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  kpiValue: {
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  kpiLabel: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs },

  sectionTitle: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
    marginTop: spacing.md,
  },

  emptyCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyText: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
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
  pipelineCount: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.orange,
  },
  pipelineLabel: { fontSize: fontSize.caption, color: colors.slate, marginTop: spacing.xs },

  stormHero: {
    backgroundColor: colors.navy,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  utilityTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.navy },
  utilitySub: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2 },

  recentRow: { gap: spacing.md, paddingRight: spacing.xl },
  recentCard: {
    width: 260,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    overflow: 'hidden',
    ...shadows.card,
  },
  recentImage: { width: '100%', height: 110, backgroundColor: colors.surfaceMuted },
  recentImagePlaceholder: {
    width: '100%',
    height: 110,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentBody: { padding: spacing.lg, gap: spacing.xs },
  recentTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  recentReport: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.semibold },
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
    ...shadows.card,
  },
  estimateAmount: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.orange },
  estimateRange: { fontSize: fontSize.caption, color: colors.slate },
  estimateAddress: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium, marginTop: spacing.xs },
  estimateMeta: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2, textTransform: 'capitalize' },

  activityHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.md,
  },
  viewAll: { color: colors.orange, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

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
  activityMsg: { fontSize: fontSize.bodyMd, color: colors.navy },
  activityTime: { fontSize: fontSize.caption, color: colors.slate, marginTop: 2 },
});
