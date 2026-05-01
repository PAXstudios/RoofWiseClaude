import { Pressable, Text, StyleSheet } from 'react-native';
import { colors, radii, spacing, fontSize, fontWeight } from '@/theme/tokens';

export function Chip({
  label,
  active = false,
  onPress,
  tone = 'brand',
}: {
  label: string;
  active?: boolean;
  onPress?: () => void;
  tone?: 'brand' | 'accent';
}) {
  const activeBg = tone === 'accent' ? colors.accent : colors.text;
  const activeFg = colors.textInverse;
  return (
    <Pressable
      onPress={onPress}
      style={[
        styles.chip,
        active ? { backgroundColor: activeBg, borderColor: activeBg } : styles.inactive,
      ]}
    >
      <Text
        style={[
          styles.label,
          { color: active ? activeFg : colors.textMuted },
        ]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  inactive: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
  },
  label: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
  },
});
