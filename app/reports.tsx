import { Children, useMemo, useState, type ReactNode } from 'react';
import { Alert, ScrollView, View, Text, TextInput, Pressable, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Rect } from 'react-native-svg';
import Animated, { FadeInDown } from 'react-native-reanimated';
// SDK 54: string-based read/write lives under `/legacy` — same convention as
// lib/services/backup.ts.
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as Print from 'expo-print';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useEstimateStore } from '@/lib/stores/estimateStore';
import { useTaskStore } from '@/lib/stores/taskStore';
import { useMileageStore } from '@/lib/stores/mileageStore';
import { useCorrectionsStore } from '@/lib/stores/correctionsStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { computeProfile } from '@/lib/services/learning/userCorrectionProfile';
import { overallAccuracy } from '@/lib/services/learning/localLearningEngine';
import {
  buildPipeline,
  PIPELINE_GROUPS,
  PIPELINE_GROUP_LABELS,
} from '@/lib/services/pipeline';
import {
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  LEAD_SOURCE_LABELS,
  LEAD_STAGE_ORDER,
  leadStageColumn,
  normalizeLeadSource,
  type DamageCategory,
  type InsuranceCarrier,
} from '@/lib/models/types';
import { RichCard } from '@/components/ui/RichCard';
import { StatCard } from '@/components/ui/StatCard';
import { Pill } from '@/components/ui/Pill';
import {
  brand,
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  motion,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

// Last published IRS business rate ($0.70, 2025) — keep in step with app/mileage.tsx.
const IRS_RATE = 0.7;

type RangeKey = '7d' | '30d' | '90d' | 'ytd' | 'custom';

const RANGE_CHIPS: { key: RangeKey; label: string }[] = [
  { key: '7d', label: '7d' },
  { key: '30d', label: '30d' },
  { key: '90d', label: '90d' },
  { key: 'ytd', label: 'YTD' },
  { key: 'custom', label: 'Custom' },
];

/** ISO `YYYY-MM-DD` → local midnight, or null if unparseable. Custom range
 *  input is deliberately ISO — no date-picker library is installed and the
 *  format is unambiguous to type by hand. */
function parseIsoDate(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s.trim());
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function rangeBounds(
  key: RangeKey,
  customStart: string,
  customEnd: string,
): { start: Date; end: Date; label: string } {
  const now = new Date();
  const endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  if (key === 'ytd') {
    return { start: new Date(now.getFullYear(), 0, 1), end: endOfToday, label: 'Year to date' };
  }
  if (key === 'custom') {
    const s = parseIsoDate(customStart) ?? new Date(now.getFullYear(), 0, 1);
    const eRaw = parseIsoDate(customEnd) ?? endOfToday;
    const e = new Date(eRaw.getFullYear(), eRaw.getMonth(), eRaw.getDate(), 23, 59, 59, 999);
    return { start: s, end: e, label: 'Custom range' };
  }
  const days = key === '7d' ? 7 : key === '30d' ? 30 : 90;
  const start = new Date(endOfToday);
  start.setDate(start.getDate() - (days - 1));
  start.setHours(0, 0, 0, 0);
  return { start, end: endOfToday, label: `Last ${days} days` };
}

function inRange(iso: string | undefined, start: Date, end: Date): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return t >= start.getTime() && t <= end.getTime();
}

function fmtCurrency(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 10_000) return `$${(n / 1000).toFixed(1)}K`;
  return `$${Math.round(n).toLocaleString()}`;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'short' });
}

/** Every month from `start` through `end`, inclusive, capped to 12 — the
 *  x-axis for the trend chart, so a month with zero signed revenue still
 *  draws an (empty) bar instead of silently disappearing. */
function monthsBetween(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cursor = new Date(start.getFullYear(), start.getMonth(), 1);
  const last = new Date(end.getFullYear(), end.getMonth(), 1);
  while (cursor <= last && out.length < 12) {
    out.push(`${cursor.getFullYear()}-${String(cursor.getMonth() + 1).padStart(2, '0')}`);
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return out;
}

export default function ReportsScreen() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const proposals = useProposalStore((s) => s.proposals);
  const leads = useLeadStore((s) => s.leads);
  const estimates = useEstimateStore((s) => s.estimates);
  const tasks = useTaskStore((s) => s.tasks);
  const trips = useMileageStore((s) => s.trips);
  const corrections = useCorrectionsStore((s) => s.corrections);
  const toast = useToastStore((s) => s.show);

  const [rangeKey, setRangeKey] = useState<RangeKey>('ytd');
  const [customStart, setCustomStart] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-01-01`;
  });
  const [customEnd, setCustomEnd] = useState(todayIso());
  const [exporting, setExporting] = useState(false);

  const { start, end, label: rangeLabel } = useMemo(
    () => rangeBounds(rangeKey, customStart, customEnd),
    [rangeKey, customStart, customEnd],
  );

  const rangedInspections = useMemo(
    () => inspections.filter((i) => inRange(i.createdAt, start, end)),
    [inspections, start, end],
  );
  const rangedProposalsSent = useMemo(
    () => proposals.filter((p) => inRange(p.sentAt, start, end)),
    [proposals, start, end],
  );
  const rangedProposalsSigned = useMemo(
    () => proposals.filter((p) => p.status === 'signed' && inRange(p.signedAt, start, end)),
    [proposals, start, end],
  );
  const rangedTrips = useMemo(
    () => trips.filter((t) => inRange(t.startedAt, start, end)),
    [trips, start, end],
  );
  const rangedLeads = useMemo(
    () => leads.filter((l) => inRange(l.createdAt, start, end)),
    [leads, start, end],
  );

  // ── Pipeline funnel (docs/PIPELINE.md) — a right-now snapshot, same as
  // "Open pipeline (now)" above: a stage is a state, not a dated event, so
  // it is never sliced by the date range picker. ──────────────────────────
  const pipelineItems = useMemo(
    () => buildPipeline({ leads, inspections, proposals, estimates, tasks }),
    [leads, inspections, proposals, estimates, tasks],
  );
  const funnelByGroup = useMemo(
    () => PIPELINE_GROUPS.filter((g) => g !== 'lost').map((g) => ({
      label: PIPELINE_GROUP_LABELS[g],
      value: pipelineItems.filter((it) => it.group === g).length,
    })),
    [pipelineItems],
  );
  const avgDaysInStage = useMemo(() => {
    const active = pipelineItems.filter((it) => !it.lost && it.daysInStage != null);
    if (active.length === 0) return null;
    return active.reduce((sum, it) => sum + (it.daysInStage ?? 0), 0) / active.length;
  }, [pipelineItems]);

  // ── Lead source → signed rate, over the selected range ──────────────────
  const sourceSignedRate = useMemo(() => {
    const signedIdx = LEAD_STAGE_ORDER.indexOf('signed');
    const bySource = new Map<string, { total: number; signed: number }>();
    for (const l of rangedLeads) {
      const source = LEAD_SOURCE_LABELS[normalizeLeadSource(l.source)];
      const entry = bySource.get(source) ?? { total: 0, signed: 0 };
      entry.total += 1;
      const col = leadStageColumn(l.stage);
      if (col !== 'lost' && LEAD_STAGE_ORDER.indexOf(col) >= signedIdx) entry.signed += 1;
      bySource.set(source, entry);
    }
    return [...bySource.entries()]
      .map(([label, { total, signed }]) => ({ label, value: total === 0 ? 0 : Math.round((signed / total) * 100), total }))
      .sort((a, b) => b.total - a.total);
  }, [rangedLeads]);

  const stats = useMemo(() => {
    const revenue = rangedProposalsSigned.reduce((sum, p) => sum + p.total, 0);
    const miles = rangedTrips.reduce((sum, t) => sum + t.miles, 0);
    const conversionRate =
      rangedProposalsSent.length === 0 ? null : rangedProposalsSigned.length / rangedProposalsSent.length;
    const avgDealSize = rangedProposalsSigned.length === 0 ? null : revenue / rangedProposalsSigned.length;
    // Open pipeline is a snapshot of right-now, not a range total — a
    // proposal sitting open doesn't belong to any one date range.
    const openPipeline = proposals
      .filter((p) => p.status === 'sent' || p.status === 'viewed')
      .reduce((sum, p) => sum + p.total, 0);
    return {
      revenue,
      miles,
      inspectionCount: rangedInspections.length,
      proposalsSent: rangedProposalsSent.length,
      proposalsSigned: rangedProposalsSigned.length,
      conversionRate,
      avgDealSize,
      openPipeline,
      openLeads: leads.filter((l) => l.stage !== 'signed' && l.stage !== 'lost').length,
    };
  }, [rangedProposalsSigned, rangedProposalsSent, rangedTrips, rangedInspections, proposals, leads]);

  const profile = useMemo(() => computeProfile(corrections), [corrections]);
  const accuracy = overallAccuracy(profile);
  const topCorrected = useMemo(() => {
    return (Object.keys(profile.perCategory) as DamageCategory[])
      .map((cat) => ({ cat, total: profile.perCategory[cat]?.total ?? 0 }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .filter((x) => x.total > 0);
  }, [profile]);

  // ── Monthly trend: signed revenue per month across the range ────────────
  const monthlyTrend = useMemo(() => {
    const months = monthsBetween(start, end);
    const byMonth = new Map<string, number>();
    for (const m of months) byMonth.set(m, 0);
    for (const p of rangedProposalsSigned) {
      const k = monthKey(p.signedAt!);
      if (byMonth.has(k)) byMonth.set(k, (byMonth.get(k) ?? 0) + p.total);
    }
    return months.map((k) => ({ key: k, label: monthLabel(k), value: byMonth.get(k) ?? 0 }));
  }, [start, end, rangedProposalsSigned]);

  // ── Lead source breakdown ────────────────────────────────────────────────
  const leadSourceBreakdown = useMemo(() => bucketAndRank(rangedLeads.map((l) => l.source?.trim() || 'Unspecified')), [rangedLeads]);

  // ── Carrier breakdown ────────────────────────────────────────────────────
  const carrierBreakdown = useMemo(
    () =>
      bucketAndRank(
        rangedInspections
          .filter((i) => i.carrier != null)
          .map((i) => INSURANCE_CARRIER_LABELS[i.carrier as InsuranceCarrier]),
      ),
    [rangedInspections],
  );

  const runExport = async (format: 'csv' | 'pdf') => {
    if (exporting) return;
    setExporting(true);
    try {
      if (format === 'csv') {
        await exportReportCsv({ rangeLabel, stats, monthlyTrend, leadSourceBreakdown, carrierBreakdown, accuracy, corrections: corrections.length });
      } else {
        await exportReportPdf({ rangeLabel, stats, monthlyTrend, leadSourceBreakdown, carrierBreakdown, accuracy, corrections: corrections.length });
      }
    } catch (e) {
      toast({ tone: 'danger', title: 'Export failed', body: e instanceof Error ? e.message : undefined });
    } finally {
      setExporting(false);
    }
  };

  const onExportPress = () => {
    Alert.alert('Export report', `${rangeLabel} · revenue, funnel, mileage, breakdowns`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'CSV', onPress: () => runExport('csv') },
      { text: 'PDF', onPress: () => runExport('pdf') },
    ]);
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Reports</Text>
          <Text style={styles.sub}>{rangeLabel} performance</Text>
        </View>
        <Pressable
          onPress={onExportPress}
          disabled={exporting}
          hitSlop={10}
          style={styles.headerBtn}
          accessibilityRole="button"
          accessibilityLabel="Export report"
        >
          {exporting ? (
            <ActivityIndicator color={colors.text} />
          ) : (
            <Ionicons name="share-outline" size={22} color={colors.text} />
          )}
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <Animated.View entering={FadeInDown.duration(motion.enterMs)} style={styles.sections}>
          {/* Date range picker */}
          <View style={styles.rangeRow}>
            {RANGE_CHIPS.map((r) => (
              <Pressable
                key={r.key}
                style={[styles.rangeChip, rangeKey === r.key && styles.rangeChipActive]}
                onPress={() => setRangeKey(r.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: rangeKey === r.key }}
                accessibilityLabel={r.label}
              >
                <Text style={[styles.rangeChipText, rangeKey === r.key && styles.rangeChipTextActive]}>
                  {r.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {rangeKey === 'custom' && (
            <View style={styles.customRow}>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>Start (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.customInput}
                  value={customStart}
                  onChangeText={setCustomStart}
                  placeholder="2026-01-01"
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                />
              </View>
              <View style={styles.customField}>
                <Text style={styles.customLabel}>End (YYYY-MM-DD)</Text>
                <TextInput
                  style={styles.customInput}
                  value={customEnd}
                  onChangeText={setCustomEnd}
                  placeholder={todayIso()}
                  placeholderTextColor={colors.textSubtle}
                  autoCapitalize="none"
                />
              </View>
            </View>
          )}

          {/* Headline row — the three numbers a roofer checks first. */}
          <View style={styles.headlineRow}>
            <StatCard
              icon="cash-outline"
              tone="green"
              value={fmtCurrency(stats.revenue)}
              label="Revenue"
              style={{ flex: 1 }}
            />
            <StatCard
              icon="camera-outline"
              tone="blue"
              value={String(stats.inspectionCount)}
              label="Inspections"
              style={{ flex: 1 }}
            />
            <StatCard
              icon="sparkles-outline"
              tone="purple"
              value={accuracy === null ? `${corrections.length}/5` : `${accuracy}%`}
              label="AI Accuracy"
              style={{ flex: 1 }}
            />
          </View>

          <Section title="Revenue" icon="cash-outline" tone="green">
            <Stat label="Signed revenue" value={fmtCurrency(stats.revenue)} />
            <Stat label="Open pipeline (now)" value={fmtCurrency(stats.openPipeline)} />
            <Stat
              label="Avg deal size"
              value={stats.avgDealSize ? fmtCurrency(stats.avgDealSize) : '—'}
            />
          </Section>

          <ChartSection title="Monthly trend" icon="trending-up-outline" tone="green">
            {monthlyTrend.every((m) => m.value === 0) ? (
              <EmptyChartNote text="No signed proposals in this range yet." />
            ) : (
              <BarChart
                bars={monthlyTrend.map((m) => ({ label: m.label, value: m.value }))}
                formatValue={fmtCurrency}
                color={colors.success}
              />
            )}
          </ChartSection>

          <Section title="Funnel" icon="stats-chart-outline" tone="blue">
            <Stat label="Inspections" value={String(stats.inspectionCount)} />
            <Stat label="Proposals sent" value={String(stats.proposalsSent)} />
            <Stat label="Proposals signed" value={String(stats.proposalsSigned)} />
            <Stat
              label="Conversion rate"
              value={stats.conversionRate === null ? '—' : `${Math.round(stats.conversionRate * 100)}%`}
            />
            <Stat label="Open leads (now)" value={String(stats.openLeads)} />
            <Stat
              label="Average days in stage (now)"
              value={avgDaysInStage === null ? '—' : avgDaysInStage.toFixed(1)}
            />
          </Section>

          <ChartSection title="Pipeline funnel (now)" icon="funnel-outline" tone="blue">
            <BarChart bars={funnelByGroup} formatValue={(n) => String(n)} color={colors.brand} />
          </ChartSection>

          <ChartSection title="Lead source" icon="people-outline" tone="blue">
            {leadSourceBreakdown.length === 0 ? (
              <EmptyChartNote text="No leads created in this range yet." />
            ) : (
              <BarChart bars={leadSourceBreakdown} formatValue={(n) => String(n)} color={colors.brand} />
            )}
          </ChartSection>

          <ChartSection title="Lead source → signed rate" icon="trending-up-outline" tone="green">
            {sourceSignedRate.length === 0 ? (
              <EmptyChartNote text="No leads created in this range yet." />
            ) : (
              <BarChart
                bars={sourceSignedRate}
                formatValue={(n) => `${n}%`}
                color={colors.success}
              />
            )}
          </ChartSection>

          <ChartSection title="Carrier" icon="shield-outline" tone="purple">
            {carrierBreakdown.length === 0 ? (
              <EmptyChartNote text="No carrier recorded on inspections in this range yet." />
            ) : (
              <BarChart bars={carrierBreakdown} formatValue={(n) => String(n)} color={colors.tilePurpleInk} />
            )}
          </ChartSection>

          <Section title="Mileage" icon="car-outline" tone="orange">
            <Stat label="Miles" value={stats.miles.toFixed(1)} />
            <Stat label="Tax deductible" value={fmtCurrency(stats.miles * IRS_RATE)} />
            <Stat label="Trips logged" value={String(rangedTrips.length)} />
          </Section>

          <Section title="AI calibration" icon="sparkles-outline" tone="purple">
            <Stat
              label="Overall accuracy"
              value={accuracy === null ? `${corrections.length}/5 needed` : `${accuracy}%`}
            />
            <Stat label="Corrections recorded" value={String(corrections.length)} />
          </Section>

          {topCorrected.length > 0 && (
            <View style={{ gap: spacing.sm, marginLeft: spacing.lg }}>
              <Text style={styles.subSection}>Most corrected categories</Text>
              <View style={styles.pillRow}>
                {topCorrected.map(({ cat, total }) => (
                  <Pill
                    key={cat}
                    label={`${DAMAGE_CATEGORY_LABELS[cat]} · ${total}`}
                    tone="neutral"
                  />
                ))}
              </View>
            </View>
          )}
        </Animated.View>

        <View style={{ height: spacing.xxxl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

/** Count occurrences, sort descending, keep the top 6 and roll the rest into
 *  "Other" — a breakdown chart with 19 carrier bars is not readable. */
function bucketAndRank(values: string[]): { label: string; value: number }[] {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 6);
  const rest = sorted.slice(6).reduce((s, [, n]) => s + n, 0);
  const out = top.map(([label, value]) => ({ label, value }));
  if (rest > 0) out.push({ label: 'Other', value: rest });
  return out;
}

// A named section: colour-chipped RichCard header, tabular-nums rows inside,
// each row after the first separated by an inset hairline (never trailing).
function Section({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: Parameters<typeof RichCard>[0]['icon'];
  tone: Parameters<typeof RichCard>[0]['iconTone'];
  children: ReactNode;
}) {
  const items = Children.toArray(children);
  return (
    <RichCard title={title} icon={icon} iconTone={tone}>
      {items.map((child, i) => (
        <View key={i} style={i > 0 ? styles.divided : undefined}>
          {child}
        </View>
      ))}
    </RichCard>
  );
}

function ChartSection({
  title,
  icon,
  tone,
  children,
}: {
  title: string;
  icon: Parameters<typeof RichCard>[0]['icon'];
  tone: Parameters<typeof RichCard>[0]['iconTone'];
  children: ReactNode;
}) {
  return (
    <RichCard title={title} icon={icon} iconTone={tone}>
      {children}
    </RichCard>
  );
}

function EmptyChartNote({ text }: { text: string }) {
  return <Text style={styles.emptyChart}>{text}</Text>;
}

/** Horizontal bar chart — one SVG rect per bar, label + value in native Text
 *  beside it. Reads well at phone width without needing an axis/scale UI;
 *  every bar renders even at value 0 so a category never silently vanishes. */
function BarChart({
  bars,
  formatValue,
  color,
}: {
  bars: { label: string; value: number }[];
  formatValue: (n: number) => string;
  color: string;
}) {
  const max = Math.max(1, ...bars.map((b) => b.value));
  const trackWidth = 220;
  const barHeight = 10;

  return (
    <View style={{ gap: spacing.md }}>
      {bars.map((b) => {
        const w = Math.max(2, Math.round((b.value / max) * trackWidth));
        return (
          <View key={b.label} style={chartStyles.row}>
            <Text style={chartStyles.label} numberOfLines={1}>
              {b.label}
            </Text>
            <Svg width={trackWidth} height={barHeight}>
              <Rect x={0} y={0} width={trackWidth} height={barHeight} rx={barHeight / 2} fill={colors.fillQuiet} />
              <Rect x={0} y={0} width={w} height={barHeight} rx={barHeight / 2} fill={color} />
            </Svg>
            <Text style={chartStyles.value}>{formatValue(b.value)}</Text>
          </View>
        );
      })}
    </View>
  );
}

const chartStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  label: { width: 84, fontSize: fontSize.bodySm, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
  value: {
    width: 56,
    textAlign: 'right',
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.mono,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
});

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.statRow}>
      <Text style={styles.statLabel}>{label}</Text>
      <Text style={styles.statValue}>{value}</Text>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Export — CSV + PDF, both self-contained so the summary and every chart's
// underlying numbers travel with the file (not just a picture of the chart).
// -----------------------------------------------------------------------------

type ExportPayload = {
  rangeLabel: string;
  stats: {
    revenue: number;
    inspectionCount: number;
    proposalsSent: number;
    proposalsSigned: number;
    conversionRate: number | null;
    avgDealSize: number | null;
    openPipeline: number;
    openLeads: number;
    miles: number;
  };
  monthlyTrend: { label: string; value: number }[];
  leadSourceBreakdown: { label: string; value: number }[];
  carrierBreakdown: { label: string; value: number }[];
  accuracy: number | null;
  corrections: number;
}

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

function reportCsvRows(p: ExportPayload): string[][] {
  return [
    ['RoofWise Report', p.rangeLabel],
    [],
    ['Summary', ''],
    ['Signed revenue', String(p.stats.revenue)],
    ['Open pipeline (now)', String(p.stats.openPipeline)],
    ['Inspections', String(p.stats.inspectionCount)],
    ['Proposals sent', String(p.stats.proposalsSent)],
    ['Proposals signed', String(p.stats.proposalsSigned)],
    ['Conversion rate', p.stats.conversionRate === null ? '' : `${Math.round(p.stats.conversionRate * 100)}%`],
    ['Avg deal size', p.stats.avgDealSize == null ? '' : String(Math.round(p.stats.avgDealSize))],
    ['Open leads (now)', String(p.stats.openLeads)],
    ['Miles', p.stats.miles.toFixed(1)],
    ['Tax deductible', (p.stats.miles * IRS_RATE).toFixed(2)],
    ['AI accuracy', p.accuracy === null ? '' : `${p.accuracy}%`],
    ['Corrections recorded', String(p.corrections)],
    [],
    ['Monthly trend (signed revenue)', ''],
    ['Month', 'Revenue'],
    ...p.monthlyTrend.map((m) => [m.label, String(m.value)]),
    [],
    ['Lead source', 'Count'],
    ...p.leadSourceBreakdown.map((b) => [b.label, String(b.value)]),
    [],
    ['Carrier', 'Count'],
    ...p.carrierBreakdown.map((b) => [b.label, String(b.value)]),
  ];
}

async function exportReportCsv(p: ExportPayload): Promise<void> {
  const csv = reportCsvRows(p).map((r) => r.map(csvCell).join(',')).join('\n');
  const filename = `roofwise-report-${new Date().toISOString().slice(0, 10)}.csv`;
  const dir = FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? '';
  const uri = `${dir}${filename}`;
  await FileSystem.writeAsStringAsync(uri, csv, { encoding: FileSystem.EncodingType.UTF8 });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'RoofWise report', UTI: 'public.comma-separated-values-text' });
  }
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function htmlBarRows(bars: { label: string; value: number }[], fmt: (n: number) => string): string {
  const max = Math.max(1, ...bars.map((b) => b.value));
  return bars
    .map(
      (b) => `<tr><td>${escHtml(b.label)}</td><td class="barcell"><div class="bartrack"><div class="bar" style="width:${Math.round((b.value / max) * 100)}%"></div></div></td><td class="num">${escHtml(fmt(b.value))}</td></tr>`,
    )
    .join('');
}

async function exportReportPdf(p: ExportPayload): Promise<void> {
  // 1A palette, resolved from the same tokens the app renders with
  // (docs/DESIGN_1A.md §1) — never a hand-picked hex, even in a print template.
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8" /><title>RoofWise Report</title>
  <style>
    body { font-family: Archivo, -apple-system, sans-serif; color: ${colors.text}; padding: 24px; }
    h1 { font-size: 20px; margin-bottom: 2px; font-weight: 700; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.6px; color: ${colors.textMuted}; margin: 26px 0 8px; }
    .sub { color: ${colors.textMuted}; font-size: 12px; margin-bottom: 18px; }
    table { width: 100%; border-collapse: collapse; font-size: 12px; }
    th, td { text-align: left; padding: 7px 9px; border-bottom: 1px solid ${colors.border}; }
    td.num, th.num { text-align: right; }
    .barcell { width: 55%; }
    .bartrack { background: ${colors.surfaceMuted}; border-radius: 6px; height: 10px; overflow: hidden; }
    .bar { background: ${brand.royal}; height: 10px; border-radius: 6px; }
  </style></head><body>
  <h1>RoofWise Report</h1>
  <div class="sub">${escHtml(p.rangeLabel)} · Generated ${escHtml(new Date().toLocaleString('en-US'))}</div>
  <h2>Summary</h2>
  <table>
    <tr><td>Signed revenue</td><td class="num">$${p.stats.revenue.toLocaleString()}</td></tr>
    <tr><td>Open pipeline (now)</td><td class="num">$${p.stats.openPipeline.toLocaleString()}</td></tr>
    <tr><td>Inspections</td><td class="num">${p.stats.inspectionCount}</td></tr>
    <tr><td>Proposals sent / signed</td><td class="num">${p.stats.proposalsSent} / ${p.stats.proposalsSigned}</td></tr>
    <tr><td>Conversion rate</td><td class="num">${p.stats.conversionRate === null ? '—' : `${Math.round(p.stats.conversionRate * 100)}%`}</td></tr>
    <tr><td>Miles / deductible</td><td class="num">${p.stats.miles.toFixed(1)} mi / $${(p.stats.miles * IRS_RATE).toFixed(2)}</td></tr>
    <tr><td>AI accuracy</td><td class="num">${p.accuracy === null ? `${p.corrections}/5 needed` : `${p.accuracy}%`}</td></tr>
  </table>
  <h2>Monthly trend — signed revenue</h2>
  <table>${htmlBarRows(p.monthlyTrend, (n) => `$${Math.round(n).toLocaleString()}`)}</table>
  <h2>Lead source</h2>
  <table>${p.leadSourceBreakdown.length ? htmlBarRows(p.leadSourceBreakdown, (n) => String(n)) : '<tr><td>No leads in this range.</td></tr>'}</table>
  <h2>Carrier</h2>
  <table>${p.carrierBreakdown.length ? htmlBarRows(p.carrierBreakdown, (n) => String(n)) : '<tr><td>No carrier recorded in this range.</td></tr>'}</table>
  </body></html>`;
  const { uri } = await Print.printToFileAsync({ html, base64: false });
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'RoofWise report', UTI: 'com.adobe.pdf' });
  }
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
  title: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
  sub: { fontSize: fontSize.caption, fontFamily: fontFamily.archivo.regular, color: colors.textSubtle, marginTop: 1 },

  scroll: { padding: spacing.lg, paddingTop: spacing.md },
  sections: { gap: spacing.md },

  rangeRow: { flexDirection: 'row', gap: spacing.sm },
  rangeChip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rangeChipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  rangeChipText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
  },
  rangeChipTextActive: { color: colors.textInverse },

  customRow: { flexDirection: 'row', gap: spacing.md },
  customField: { flex: 1, gap: 2 },
  customLabel: { ...dataLabel, color: colors.textSubtle, letterSpacing: 0.4 },
  customInput: {
    minHeight: touchTarget.small,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    borderRadius: radii.control,
    paddingHorizontal: spacing.md,
    fontSize: fontSize.bodyMd,
    fontFamily: fontFamily.archivo.regular,
    color: colors.text,
    backgroundColor: colors.surface,
  },

  headlineRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.xs },

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
  statLabel: { flex: 1, fontSize: fontSize.bodyMd, fontFamily: fontFamily.archivo.regular, color: colors.textMuted },
  statValue: {
    fontSize: fontSize.bodyLg,
    color: colors.text,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    fontVariant: ['tabular-nums'],
  },

  emptyChart: {
    fontSize: fontSize.bodySm,
    fontFamily: fontFamily.archivo.regular,
    color: colors.textSubtle,
    paddingVertical: spacing.sm,
  },

  // "Most corrected categories" — the mock's small-caps eyebrow (§3).
  subSection: { ...dataLabel, color: colors.textSubtle },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
});
