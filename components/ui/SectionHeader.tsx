import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontFamily, fontSize, fontWeight, spacing, touchTarget } from '@/theme/tokens';
import type { IoniconName } from './IconChip';

type Action = {
  label: string;
  onPress: () => void;
  /** Trailing glyph. Default `chevron-forward`; pass `null` for text only. */
  icon?: IoniconName | null;
};

type Props = {
  title: string;
  /** Optional trailing text action ("See all", "Edit"). */
  action?: Action;
  /** Render on a dark hero ground instead of a light content ground. */
  onDark?: boolean;
  style?: StyleProp<ViewStyle>;
};

/** Clear section titles with a quiet, accessible trailing action. */
export function SectionHeader({ title, action, onDark = false, style }: Props) {
  const icon = action?.icon === undefined ? 'chevron-forward' : action.icon;

  return (
    <View style={[styles.row, style]}>
      <Text
        accessibilityRole="header"
        style={[styles.title, onDark && styles.titleOnDark]}
      >
        {title}
      </Text>

      {action && (
        <Pressable
          onPress={action.onPress}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
        >
          <Text style={[styles.actionText, onDark && styles.actionTextOnDark]}>
            {action.label}
          </Text>
          {icon && (
            <Ionicons
              name={icon}
              size={14}
              color={onDark ? colors.textInverse : colors.brand}
            />
          )}
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flexShrink: 1,
    fontSize: fontSize.bodyLg,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  titleOnDark: { color: colors.textInverse },

  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.small,
    paddingLeft: spacing.sm,
  },
  actionPressed: { opacity: 0.55 },
  actionText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontFamily: fontFamily.archivo.semibold,
    color: colors.brand,
  },
  actionTextOnDark: { color: colors.textInverse },
});
