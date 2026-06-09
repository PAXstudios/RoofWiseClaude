import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { useAuthStore } from '@/lib/auth/authStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
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

  const firstName = useMemo(() => {
    const email = user?.email ?? '';
    if (!email) return 'there';
    return email.split('@')[0].split(/[._-]/)[0].replace(/^\w/, (c) => c.toUpperCase());
  }, [user]);

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
          style={styles.profileBtn}
          onPress={() => router.push('/settings')}
          hitSlop={8}
        >
          <Ionicons name="person-circle-outline" size={32} color={colors.navy} />
        </Pressable>
      </View>

      {/* Storm Alert hero — hides when no active alert (Drift #4) */}
      {/* TODO Phase 6D: wire to StormAlertStore.latestActiveAlert */}

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
        <Kpi label="Revenue" value="$0" />
        <Kpi label="Open" value={String(inspections.length)} />
        <Kpi label="Pipeline" value="$0" />
      </View>

      {/* Recent Jobs */}
      <SectionHeader title="Recent Jobs" />
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
          {inspections.slice(0, 8).map((ins) => (
            <Pressable
              key={ins.id}
              style={styles.recentCard}
              onPress={() => router.push(`/job/${ins.id}` as any)}
            >
              <View style={styles.recentTopRow}>
                <Text style={styles.recentReport}>{ins.reportId}</Text>
                <View style={styles.statusPill}>
                  <Text style={styles.statusText}>{ins.status.replace('_', ' ')}</Text>
                </View>
              </View>
              <Text style={styles.recentCustomer} numberOfLines={1}>
                {ins.customerName}
              </Text>
              <Text style={styles.recentAddress} numberOfLines={2}>
                {ins.address}
              </Text>
              <Text style={styles.recentMeta}>{ROOF_MATERIAL_LABELS[ins.material]} · {ins.ageYears}yr</Text>
            </Pressable>
          ))}
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

      <View style={{ height: spacing.xxxl }} />
    </ScrollView>
  );
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

  recentRow: { gap: spacing.md, paddingRight: spacing.xl },
  recentCard: {
    width: 240,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
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
});
