import { useMemo } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import { DAMAGE_CATEGORY_LABELS, type DamageCategory } from '@/lib/models/types';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

const IRS_RATE = 0.67;

export default function ReportsScreen() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const proposals = useProposalStore((s) => s.proposals);
  const leads = useLeadStore((s) => s.leads);
  const trips = useMileageStore((s) => s.trips);
  const corrections = useCorrectionsStore((s) => s.corrections);

  const stats = useMemo(() => {
    const year = new Date().getFullYear();
    const startOfYear = new Date(year, 0, 1).getTime();

    const ytdInspections = inspections.filter((i) => new Date(i.createdAt).getTime() >= startOfYear).length;
    const ytdRevenue = proposals
      .filter((p) => p.status === 'signed' && p.signedAt && new Date(p.signedAt).getTime() >= startOfYear)
      .reduce((sum, p) => sum + p.total, 0);
    const ytdMiles = trips.filter((t) => new Date(t.startedAt).getTime() >= startOfYear).reduce((sum, t) => sum + t.miles, 0);
    const ytdProposalsSent = proposals.filter((p) => p.sentAt && new Date(p.sentAt).getTime() >= startOfYear).length;
    const ytdProposalsSigned = proposals.filter((p) => p.status === 'signed' && p.signedAt && new Date(p.signedAt).getTime() >= startOfYear).length;

    const conversionRate = ytdProposalsSent === 0 ? null : ytdProposalsSigned / ytdProposalsSent;
    const avgDealSize = ytdProposalsSigned === 0 ? null : ytdRevenue / ytdProposalsSigned;
    const openPipeline = proposals
      .filter((p) => p.status === 'sent' || p.status === 'viewed')
      .reduce((sum, p) => sum + p.total, 0);

    return {
      ytdInspections,
      ytdRevenue,
      ytdMiles,
      ytdProposalsSent,
      ytdProposalsSigned,
      conversionRate,
      avgDealSize,
      openPipeline,
      openLeads: leads.filter((l) => l.stage !== 'signed' && l.stage !== 'lost').length,
    };
  }, [inspections, proposals, leads, trips]);

  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);
  const topCorrected = useMemo(() => {
    return (Object.keys(profile.perCategory) as DamageCategory[])
      .map((cat) => ({ cat, total: profile.perCategory[cat]?.total ?? 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .filter((x) => x.total > 0);
  }, [profile]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.sub}>Year-to-date performance</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Section title="Revenue">
          <Stat label="Signed revenue YTD" value={fmtCurrency(stats.ytdRevenue)} />
          <Stat label="Open pipeline" value={fmtCurrency(stats.openPipeline)} />
          <Stat
            label="Avg deal size"
            value={stats.avgDealSize ? fmtCurrency(stats.avgDealSize) : '—'}
          />
        </Section>

        <Section title="Funnel">
          <Stat label="Inspections YTD" value={String(stats.ytdInspections)} />
          <Stat label="Proposals sent" value={String(stats.ytdProposalsSent)} />
          <Stat label="Proposals signed" value={String(stats.ytdProposalsSigned)} />
          <Stat
            label="Conversion rate"
            value={
              stats.conversionRate === null
                ? '—'
                : `${Math.round(stats.conversionRate * 100)}%`
            }
          />
          <Stat label="Open leads" value={String(stats.openLeads)} />
        </Section>

        <Section title="Mileage">
          <Stat label="Miles YTD" value={stats.ytdMiles.toFixed(1)} />
          <Stat
            label="Tax deductible"
            value={fmtCurrency(stats.ytdMiles * IRS_RATE)}
          />
          <Stat label="Trips logged" value={String(trips.length)} />
        </Section>

        <Section title="AI calibration">
          <Stat
            label="Overall accuracy"
            value={accuracy === null ? `${corrections.length}/5 needed` : `${accuracy}%`}
          />
          <Stat label="Corrections recorded" value={String(corrections.length)} />
          {topCorrected.length > 0 && (
            <View style={{ gap: 6, marginTop: spacing.md }}>
              <Text style={styles.subSection}>Most corrected categories</Text>
              {topCorrected.map(({ cat, total }) => (
                <Text key={cat} style={styles.bullet}>
                  • {DAMAGE_CATEGORY_LABELS[cat]} · {total}
                </Text>
              ))}
            </View>
          )}
        </Section>

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>{children}</View>
    </View>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  scroll: { padding: spacing.xl, gap: spacing.lg, paddingBottom: spacing.xxxl },

  sectionTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.sm,
    ...shadows.card,
  },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  statLabel: { fontSize: fontSize.bodyMd, color: colors.slate },
  statValue: { fontSize: fontSize.bodyLg, color: colors.navy, fontWeight: fontWeight.semibold },

  subSection: {
    fontSize: fontSize.caption,
    color: colors.slate,
    fontWeight: fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bullet: { fontSize: fontSize.bodyMd, color: colors.navy, paddingVertical: 2 },
});
