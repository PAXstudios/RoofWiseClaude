import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { IconTile } from '@/components/ui/IconTile';
import { recentActivity } from '@/lib/mock/activity';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

const toneToColors: Record<string, { bg: string; fg: string }> = {
  brand: { bg: colors.brandSoft, fg: colors.brand },
  accent: { bg: colors.accentSoft, fg: colors.accentPressed },
  success: { bg: colors.successSoft, fg: '#1F8F5E' },
  warn: { bg: colors.warnSoft, fg: '#9A7100' },
};

export function RecentActivity() {
  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader title="Recent Activity" />
      </View>
      <Card style={styles.card}>
        {recentActivity.map((a, idx) => {
          const c = toneToColors[a.tone];
          return (
            <View
              key={a.id}
              style={[styles.row, idx < recentActivity.length - 1 && styles.rowDivider]}
            >
              <IconTile name={a.icon} bg={c.bg} fg={c.fg} size={32} />
              <View style={{ flex: 1 }}>
                <Text style={styles.text}>{a.text}</Text>
                <Text style={styles.meta}>{a.meta}</Text>
              </View>
            </View>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  card: { marginHorizontal: spacing.lg, paddingVertical: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  text: {
    fontSize: fontSize.sm,
    color: colors.text,
    fontWeight: fontWeight.medium,
  },
  meta: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    marginTop: 2,
  },
});
