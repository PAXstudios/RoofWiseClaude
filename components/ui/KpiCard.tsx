import { View, Text, StyleSheet, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from './Card';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

type IconName = keyof typeof Ionicons.glyphMap;

export type KpiTone = 'success' | 'brand' | 'accent' | 'warn' | 'danger' | 'neutral';

const tones: Record<KpiTone, { bg: string; fg: string }> = {
  success: { bg: colors.successSoft, fg: '#1F8F5E' },
  brand: { bg: colors.brandSoft, fg: colors.brand },
  accent: { bg: colors.accentSoft, fg: colors.accentPressed },
  warn: { bg: colors.warnSoft, fg: '#9A7100' },
  danger: { bg: colors.dangerSoft, fg: '#B83239' },
  neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
};

export function KpiCard({
  label,
  value,
  icon,
  tone = 'brand',
  delta,
  deltaTone = 'success',
  footer,
  style,
}: {
  label: string;
  value: string;
  icon: IconName;
  tone?: KpiTone;
  delta?: string;
  deltaTone?: 'success' | 'danger' | 'neutral';
  footer?: string;
  style?: ViewStyle;
}) {
  const t = tones[tone];
  const deltaColors = {
    success: colors.success,
    danger: colors.danger,
    neutral: colors.textMuted,
  } as const;
  return (
    <Card style={[styles.card, style]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconWrap, { backgroundColor: t.bg }]}>
          <Ionicons name={icon} size={16} color={t.fg} />
        </View>
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value}>{value}</Text>
      {delta && (
        <View style={styles.deltaRow}>
          <Ionicons
            name={deltaTone === 'danger' ? 'trending-down' : 'trending-up'}
            size={14}
            color={deltaColors[deltaTone]}
          />
          <Text style={[styles.delta, { color: deltaColors[deltaTone] }]}>{delta}</Text>
        </View>
      )}
      {footer && <Text style={styles.footer}>{footer}</Text>}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    width: 156,
    minHeight: 124,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  iconWrap: {
    width: 28,
    height: 28,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  label: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
    flexShrink: 1,
  },
  value: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  deltaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: spacing.xs,
  },
  delta: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
  footer: {
    marginTop: spacing.xs,
    fontSize: fontSize.sm,
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
});
