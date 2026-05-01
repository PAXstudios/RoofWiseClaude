import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function StubScreen({
  icon,
  title,
  description,
  bullets,
}: {
  icon: keyof typeof import('@expo/vector-icons').Ionicons.glyphMap;
  title: string;
  description: string;
  bullets: string[];
}) {
  return (
    <View style={styles.wrap}>
      <Card style={styles.card}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={28} color={colors.brand} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{description}</Text>
        <View style={styles.bullets}>
          {bullets.map((b) => (
            <View key={b} style={styles.bulletRow}>
              <View style={styles.dot} />
              <Text style={styles.bulletText}>{b}</Text>
            </View>
          ))}
        </View>
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    padding: spacing.lg,
    backgroundColor: colors.bg,
  },
  card: {
    gap: spacing.md,
  },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radii.md,
    backgroundColor: colors.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  body: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    lineHeight: 20,
  },
  bullets: { gap: spacing.sm, marginTop: spacing.sm },
  bulletRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.accent,
    marginTop: 7,
  },
  bulletText: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 20,
  },
});
