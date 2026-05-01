import { View, Text, StyleSheet } from 'react-native';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

const items = [
  { label: 'Hail < 0.75"', color: '#7AA2F7' },
  { label: 'Hail 0.75–1.25"', color: '#1E66F5' },
  { label: 'Hail ≥ 1.25"', color: '#E5484D' },
  { label: 'Wind < 50 kt', color: '#FFB061' },
  { label: 'Wind 50–60 kt', color: '#F26B1F' },
  { label: 'Wind ≥ 60 kt', color: '#B83239' },
];

export function StormLegend() {
  return (
    <Card style={styles.card} padded>
      <Text style={styles.title}>Severity</Text>
      <View style={styles.grid}>
        {items.map((it) => (
          <View key={it.label} style={styles.row}>
            <View style={[styles.dot, { backgroundColor: it.color }]} />
            <Text style={styles.label}>{it.label}</Text>
          </View>
        ))}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { padding: spacing.md },
  title: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 2,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  label: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: fontWeight.semibold },
});
