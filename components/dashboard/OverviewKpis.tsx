import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { KpiCard } from '@/components/ui/KpiCard';
import { leadKpis } from '@/lib/mock/leads';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';
import { useResponsive } from '@/theme/useResponsive';

const cards = [
  {
    key: 'revenue',
    label: 'Revenue',
    value: `$${(leadKpis.revenueWonThisMonth / 1000).toFixed(1)}k`,
    icon: 'cash-outline' as const,
    tone: 'success' as const,
    delta: `+${Math.round(leadKpis.revenueDelta * 100)}% vs last mo`,
  },
  {
    key: 'leads',
    label: 'Active Leads',
    value: String(leadKpis.active),
    icon: 'person-add-outline' as const,
    tone: 'brand' as const,
    footer: `+ ${leadKpis.newToday} new today`,
  },
  {
    key: 'inspections',
    label: 'Inspections Today',
    value: String(leadKpis.inspectionsToday),
    icon: 'camera-outline' as const,
    tone: 'accent' as const,
    delta: '2 on schedule',
    deltaTone: 'neutral' as const,
  },
  {
    key: 'jobs',
    label: 'Jobs in Progress',
    value: String(leadKpis.jobsInProgress),
    icon: 'hammer-outline' as const,
    tone: 'warn' as const,
    delta: '1 closes Friday',
    deltaTone: 'neutral' as const,
  },
  {
    key: 'storms',
    label: 'Storm-Impacted',
    value: String(leadKpis.stormImpactedProperties),
    icon: 'thunderstorm-outline' as const,
    tone: 'danger' as const,
    delta: 'Severe hail today',
    deltaTone: 'danger' as const,
  },
];

export function OverviewKpis() {
  const { isWide } = useResponsive();
  return (
    <View style={styles.wrap}>
      <View style={styles.header}>
        <Text style={styles.title}>Overview</Text>
        <Pressable hitSlop={8}>
          <Text style={styles.action}>View Report</Text>
        </Pressable>
      </View>
      {isWide ? (
        <View style={styles.grid}>
          {cards.map((c) => (
            <KpiCard key={c.key} {...c} style={styles.gridCard} />
          ))}
        </View>
      ) : (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scroll}
        >
          {cards.map((c) => (
            <KpiCard key={c.key} {...c} />
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: spacing.lg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  action: {
    fontSize: fontSize.sm,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  grid: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  gridCard: {
    width: 200,
    flexGrow: 1,
  },
});
