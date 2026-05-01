import { View, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing, fontSize, fontWeight } from '@/theme/tokens';

export type PillTone = 'neutral' | 'accent' | 'brand' | 'success' | 'warn' | 'danger' | 'info';

const tones: Record<PillTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.surfaceMuted, fg: colors.textMuted },
  accent: { bg: colors.accentSoft, fg: colors.accentPressed },
  brand: { bg: colors.brandSoft, fg: colors.brand },
  success: { bg: colors.successSoft, fg: '#1F8F5E' },
  warn: { bg: colors.warnSoft, fg: '#9A7100' },
  danger: { bg: colors.dangerSoft, fg: '#B83239' },
  info: { bg: colors.infoSoft, fg: '#1D4ED8' },
};

export function Pill({
  label,
  tone = 'neutral',
  solid = false,
}: {
  label: string;
  tone?: PillTone;
  solid?: boolean;
}) {
  const t = tones[tone];
  const bg = solid ? t.fg : t.bg;
  const fg = solid ? '#fff' : t.fg;
  return (
    <View style={[styles.pill, { backgroundColor: bg }]}>
      <Text style={[styles.label, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.2,
  },
});
