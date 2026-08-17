import type { PropsWithChildren, ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PressableScale } from '@/components/PressableScale';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';
import { IconChip, type ChipTone, type IoniconName } from './IconChip';

type CardAction = {
  label: string;
  onPress: () => void;
  /** Trailing glyph. Default `chevron-forward`; pass `null` for text only. */
  icon?: IoniconName | null;
};

type Props = PropsWithChildren<{
  /** Header title. Omit the whole header by passing no title/icon/action. */
  title?: string;
  subtitle?: string;
  /** Leading icon chip — the colour cue that tells the module apart. */
  icon?: IoniconName;
  iconTone?: ChipTone;
  /** Trailing text action in the header row. */
  action?: CardAction;
  /** Arbitrary trailing header node (a `Pill`, a count). Renders after `action`. */
  headerTrailing?: ReactNode;
  /** Footer strip, separated by a hairline. */
  footer?: ReactNode;
  /** Makes the whole card tappable, with the house press-spring. */
  onPress?: () => void;
  /** Quiet chevron at the header's trailing edge — for a whole-card `onPress`. */
  chevron?: boolean;
  /** Inner padding on the body. Set `false` for edge-to-edge media. Default true. */
  padded?: boolean;
  /**
   * Depth rung. `raised` is the crafted content card; `flat` is the grouped
   * list cell. Depth is layered — pick one rung and stay on it, never stack
   * a hero glow on a raised card on a flat cell.
   */
  elevation?: 'raised' | 'flat';
  style?: StyleProp<ViewStyle>;
  contentStyle?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
}>;

/**
 * The crafted content card — white surface, `radii.card`, a real lift.
 *
 * This is the workhorse that replaces the flat hairline cell. It exists so
 * every screen composes the same object: optional header (icon chip + title
 * + trailing action), body, optional footer. Anything that would otherwise
 * be "a View with a border and some padding" should be this instead, so the
 * app reads as one system rather than forty hand-rolled boxes.
 *
 * The lift lives on the outer view and the corners are clipped by an inner
 * one, because on iOS a view that clips (`overflow: hidden`) cannot also
 * cast a shadow.
 */
export function RichCard({
  title,
  subtitle,
  icon,
  iconTone = 'blue',
  action,
  headerTrailing,
  footer,
  onPress,
  chevron = false,
  padded = true,
  elevation = 'raised',
  style,
  contentStyle,
  accessibilityLabel,
  children,
}: Props) {
  const hasHeader = Boolean(title || icon || action || headerTrailing || chevron);
  const hasBody = children !== undefined && children !== null && children !== false;
  const actionIcon = action?.icon === undefined ? 'chevron-forward' : action.icon;

  const body = (
    <View style={styles.clip}>
      {hasHeader && (
        <View style={[styles.header, !hasBody && !footer && styles.headerOnly]}>
          {icon && <IconChip name={icon} tone={iconTone} size="md" />}

          {(title || subtitle) && (
            <View style={styles.headerText}>
              {title && (
                <Text style={styles.title} numberOfLines={1}>
                  {title}
                </Text>
              )}
              {subtitle && (
                <Text style={styles.subtitle} numberOfLines={2}>
                  {subtitle}
                </Text>
              )}
            </View>
          )}

          {action && (
            <Pressable
              onPress={action.onPress}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={action.label}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Text style={styles.actionText}>{action.label}</Text>
              {actionIcon && <Ionicons name={actionIcon} size={14} color={colors.brand} />}
            </Pressable>
          )}

          {headerTrailing}

          {chevron && !action && (
            <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
          )}
        </View>
      )}

      {hasBody && (
        <View
          style={[
            padded && styles.bodyPad,
            padded && hasHeader && styles.bodyUnderHeader,
            contentStyle,
          ]}
        >
          {children}
        </View>
      )}

      {footer && <View style={styles.footer}>{footer}</View>}
    </View>
  );

  const shell: StyleProp<ViewStyle> = [
    styles.card,
    elevation === 'raised' ? shadows.raised : shadows.card,
    onPress && styles.tappable,
    style,
  ];

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel ?? title}
        style={shell}
      >
        {body}
      </PressableScale>
    );
  }

  return (
    <View style={shell} accessibilityLabel={accessibilityLabel}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  // A whole-card tap is a primary action, so it takes the glove-sized target.
  tappable: { minHeight: touchTarget.standard },
  clip: { borderRadius: radii.card, overflow: 'hidden' },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerOnly: { paddingBottom: spacing.lg },
  headerText: { flex: 1, gap: 2 },
  title: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  subtitle: { fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },

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

  bodyPad: { padding: spacing.lg },
  bodyUnderHeader: { paddingTop: 0 },

  footer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
