import { Children, useMemo, type ReactNode } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
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
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
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
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.sub}>Year-to-date performance</Text>
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View entering={FadeInDown.duration(motion.enterMs)} style={styles.sections}>
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
              <View style={{ gap: spacing.xs, paddingVertical: spacing.md }}>
                <Text style={styles.subSection}>Most corrected categories</Text>
                {topCorrected.map(({ cat, total }) => (
                  <Text key={cat} style={styles.bullet}>
                    • {DAMAGE_CATEGORY_LABELS[cat]} · {total}
                  </Text>
                ))}
              </View>
            )}
          </Section>
        </Animated.View>

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

// iOS grouped section: 13/uppercase header outside a white inset card whose
// rows are separated by inset hairlines (never a trailing separator).
function Section({ title, children }: { title: string; children: ReactNode }) {
  const items = Children.toArray(children);
  return (
    <View style={{ gap: spacing.sm }}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.card}>
        {items.map((child, i) => (
          <View key={i} style={i > 0 ? styles.divided : undefined}>
            {child}
          </View>
        ))}
      </View>
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
  // Sub-screen inline bar: plain chevron, 17/semibold, hairline underline.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.barFill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  sub: { fontSize: fontSize.caption, color: colors.textSubtle, marginTop: 1 },

  scroll: { padding: spacing.lg, paddingTop: spacing.md },
  sections: { gap: spacing.xl },

  sectionTitle: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginLeft: spacing.lg,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    ...shadows.card,
  },
  divided: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },

  statRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.small,
    paddingVertical: spacing.sm,
  },
  statLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textMuted },
  statValue: {
    fontSize: fontSize.bodyLg,
    color: colors.text,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },

  subSection: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  bullet: { fontSize: fontSize.bodyMd, color: colors.text, paddingVertical: 2 },
});
