import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, fontWeight, radii, spacing, shadows } from '@/theme/tokens';

export function QuickActions() {
  return (
    <View style={styles.row}>
      <Card style={styles.cardOutline}>
        <View style={[styles.iconWrap, { backgroundColor: colors.brandSoft }]}>
          <Ionicons name="checkmark-circle-outline" size={20} color={colors.brand} />
        </View>
        <Text style={styles.label}>Start New Job</Text>
      </Card>
      <Pressable style={[styles.cardSolid, shadows.card]}>
        <View style={[styles.iconWrap, { backgroundColor: 'rgba(255,255,255,0.18)' }]}>
          <Ionicons name="camera" size={20} color={colors.surface} />
        </View>
        <Text style={[styles.label, { color: colors.surface }]}>Quick Analysis</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.lg,
  },
  cardOutline: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.lg,
  },
  cardSolid: {
    flex: 1,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingVertical: spacing.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.sm,
  },
  label: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
});
