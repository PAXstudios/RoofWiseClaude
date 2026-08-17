import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
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

/**
 * A change against a REAL prior period.
 *
 * `value` is pre-formatted by the caller ("+2 today", "-1 vs last week") so
 * this component never invents a comparison window it doesn't understand.
 */
export type StatDelta = {
  value: string;
  direction: 'up' | 'down' | 'flat';
  /**
   * Override the reading. By default up is good and down is bad; set this
   * where the opposite is true (denials up, days-to-approval down).
   */
  tone?: 'good' | 'bad' | 'neutral';
};

const DIRECTION_ICON: Record<StatDelta['direction'], IoniconName> = {
  up: 'arrow-up',
  down: 'arrow-down',
  flat: 'remove',
};

const DIRECTION_TONE: Record<StatDelta['direction'], NonNullable<StatDelta['tone']>> = {
  up: 'good',
  down: 'bad',
  flat: 'neutral',
};

const TONE_COLOR: Record<NonNullable<StatDelta['tone']>, string> = {
  good: colors.success,
  bad: colors.danger,
  neutral: colors.textMuted,
};

type Props = {
  icon: IoniconName;
  /** Colour family for the chip. Default `blue`. */
  tone?: ChipTone;
  /** Pre-formatted headline number. Rendered in tabular figures. */
  value: string;
  /** Small bold caps caption under the number. */
  label: string;
  /**
   * OPTIONAL trend line. **Omit it entirely** unless a true prior-period
   * comparison exists — a fabricated "+0" or an invented baseline is a mock
   * (Drift #5). A stat card with no delta is the normal case, not a
   * degraded one, and it lays out identically.
   */
  delta?: StatDelta;
  onPress?: () => void;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
};

/**
 * Colour-chipped stat tile — icon chip, big tabular number, caps label.
 *
 * The typographic contrast is the design: a large, loosely-tracked figure
 * against a small bold uppercase caption is what makes a number read as a
 * headline instead of a table cell. Put these in a row with `style={{flex:1}}`.
 */
export function StatCard({
  icon,
  tone = 'blue',
  value,
  label,
  delta,
  onPress,
  style,
  accessibilityLabel,
}: Props) {
  const deltaColor = delta
    ? TONE_COLOR[delta.tone ?? DIRECTION_TONE[delta.direction]]
    : undefined;

  const body = (
    <>
      <IconChip name={icon} tone={tone} size="md" />
      <View style={styles.readout}>
        <Text style={styles.value} numberOfLines={1}>
          {value}
        </Text>
        <Text style={styles.label} numberOfLines={2}>
          {label}
        </Text>
      </View>

      {delta && (
        <View style={styles.deltaRow}>
          <Ionicons name={DIRECTION_ICON[delta.direction]} size={13} color={deltaColor} />
          <Text style={[styles.deltaText, { color: deltaColor }]} numberOfLines={1}>
            {delta.value}
          </Text>
        </View>
      )}
    </>
  );

  const a11y = accessibilityLabel ?? `${label}: ${value}${delta ? `, ${delta.value}` : ''}`;

  if (onPress) {
    return (
      <PressableScale
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={a11y}
        style={[styles.card, style]}
      >
        {body}
      </PressableScale>
    );
  }

  return (
    <View style={[styles.card, style]} accessibilityRole="summary" accessibilityLabel={a11y}>
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    minHeight: touchTarget.sticky,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.md,
    ...shadows.raised,
  },
  readout: { gap: 2 },
  value: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.textSubtle,
    textTransform: 'uppercase',
    letterSpacing: 0.7,
  },
  deltaRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  deltaText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    fontVariant: ['tabular-nums'],
  },
});
