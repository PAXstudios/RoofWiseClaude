import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, fontSize, fontWeight, spacing, touchTarget } from '@/theme/tokens';
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

/**
 * Small uppercase label that opens a group of content.
 *
 * Deliberately quiet — 13/semibold in `textSubtle` — because the typographic
 * contrast in this design comes from big light numbers sitting against small
 * bold labels. A section header that competes with its own section is what
 * makes a screen feel flat.
 *
 * The action is secondary chrome, so it takes the 44pt target rather than
 * the 56pt one, and buys the rest back with hitSlop.
 */
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
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.8,
  },
  titleOnDark: { color: colors.textInverse, opacity: 0.7 },

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
    color: colors.brand,
  },
  actionTextOnDark: { color: colors.textInverse },
});
