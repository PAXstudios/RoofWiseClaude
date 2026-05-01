import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Pill, PillTone } from '@/components/ui/Pill';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { leads, pipelineStages } from '@/lib/mock/leads';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';
import { useResponsive } from '@/theme/useResponsive';

const stageBars: Record<string, string> = {
  New: colors.brand,
  Contacted: colors.accent,
  Proposal: colors.success,
  Won: colors.success,
  Lost: colors.danger,
};

const tonesByStage: Record<string, PillTone> = {
  New: 'brand',
  Contacted: 'accent',
  Proposal: 'success',
  Won: 'success',
  Lost: 'danger',
};

export function PipelineKanban() {
  const { isWide } = useResponsive();
  const columns = pipelineStages.map((s) => {
    const stageLeads = leads.filter((l) => l.stage === s.stage);
    const total = stageLeads.reduce((acc, l) => acc + l.value, 0);
    return { ...s, count: stageLeads.length, total, leads: stageLeads };
  });

  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader
          title="Pipeline"
          right={
            <View style={styles.menu}>
              <Ionicons name="ellipsis-horizontal" size={18} color={colors.textMuted} />
            </View>
          }
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scroller}
      >
        {columns.map((col) => (
          <Card key={col.stage} style={[styles.col, isWide && styles.colWide]}>
            <View style={styles.colHeader}>
              <Text style={styles.colTitle}>{col.stage.toUpperCase()}</Text>
              <Pill label={`${col.count}`} tone={tonesByStage[col.stage]} />
            </View>
            <View style={styles.metaRow}>
              <Text style={styles.count}>{col.count}</Text>
              <Text style={styles.value}>${formatK(col.total)}</Text>
            </View>
            <View style={styles.bar}>
              <View
                style={[
                  styles.barFill,
                  { width: `${Math.min(100, col.count * 18)}%`, backgroundColor: stageBars[col.stage] },
                ]}
              />
            </View>
            {isWide &&
              col.leads.slice(0, 3).map((l) => (
                <View key={l.id} style={styles.leadRow}>
                  <Text style={styles.leadName} numberOfLines={1}>
                    {l.name}
                  </Text>
                  <Text style={styles.leadValue}>${formatK(l.value)}</Text>
                </View>
              ))}
          </Card>
        ))}
      </ScrollView>
    </View>
  );
}

function formatK(n: number) {
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  scroller: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
  },
  col: {
    width: 130,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  colWide: { width: 220 },
  colHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  colTitle: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    letterSpacing: 0.6,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  count: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.4,
  },
  value: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  bar: {
    height: 4,
    backgroundColor: colors.surfaceMuted,
    borderRadius: 2,
    overflow: 'hidden',
  },
  barFill: { height: '100%', borderRadius: 2 },
  leadRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    marginTop: spacing.sm,
  },
  leadName: { fontSize: fontSize.sm, color: colors.text, flex: 1 },
  leadValue: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: fontWeight.semibold },
  menu: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
