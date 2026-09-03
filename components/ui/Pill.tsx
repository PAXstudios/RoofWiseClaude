import { useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { brand, colors, fontFamily, fontSize, fontWeight, motion, radii, spacing } from '@/theme/tokens';
import type { IoniconName } from './IconChip';

/** Status colour. Semantic tones state a verdict; brand tones state identity. */
export type PillTone =
  | 'neutral'
  | 'brand'
  | 'accent'
  | 'success'
  | 'warn'
  | 'danger'
  | 'info';

export type PillSize = 'sm' | 'md';

const TONES: Record<PillTone, { soft: string; ink: string; solid: string }> = {
  neutral: { soft: colors.fillQuiet, ink: colors.textMuted, solid: colors.textMuted },
  brand: { soft: colors.brandSoft, ink: brand.royalDeep, solid: colors.brand },
  accent: { soft: colors.accentSoft, ink: brand.burntDeep, solid: colors.accent },
  success: { soft: colors.successSoft, ink: colors.success, solid: colors.success },
  warn: { soft: colors.warnSoft, ink: colors.warn, solid: colors.warn },
  danger: { soft: colors.dangerSoft, ink: colors.danger, solid: colors.danger },
  info: { soft: colors.infoSoft, ink: brand.royalDeep, solid: colors.info },
};

type Props = {
  label: string;
  /** Default `neutral`. */
  tone?: PillTone;
  /** `sm` 22pt for dense rows, `md` 28pt on cards. Default `md`. */
  size?: PillSize;
  /** Filled tone instead of the soft ground. For the one pill that must shout. */
  solid?: boolean;
  /** Leading glyph. Mutually exclusive with `dot` — the dot wins. */
  icon?: IoniconName;
  /** Leading status dot, the "this is a state" marker. */
  dot?: boolean;
  /** Breathe the dot on the ambient loop. Only for genuinely LIVE state. */
  pulse?: boolean;
  style?: StyleProp<ViewStyle>;
};

/**
 * Small status pill — a state, not a button.
 *
 * Caps out at 28pt so it can never be mistaken for a tap target (Drift #1
 * reserves >=56pt for anything tappable): if a pill needs to be pressable,
 * wrap it in the row's own Pressable rather than growing the pill.
 */
export function Pill({
  label,
  tone = 'neutral',
  size = 'md',
  solid = false,
  icon,
  dot = false,
  pulse = false,
  style,
}: Props) {
  const t = TONES[tone];
  const bg = solid ? t.solid : t.soft;
  const fg = solid ? colors.textInverse : t.ink;
  const small = size === 'sm';

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel={label}
      style={[styles.pill, small ? styles.pillSm : styles.pillMd, { backgroundColor: bg }, style]}
    >
      {dot ? (
        <StatusDot color={fg} pulse={pulse} />
      ) : icon ? (
        <Ionicons name={icon} size={small ? 11 : 13} color={fg} />
      ) : null}
      <Text
        numberOfLines={1}
        style={[styles.label, small ? styles.labelSm : styles.labelMd, { color: fg }]}
      >
        {label}
      </Text>
    </View>
  );
}

/**
 * The dot fades rather than scales: a scaling dot inside a pill with
 * `overflow: visible` renders differently across web and native, and the
 * opacity loop reads identically everywhere.
 */
function StatusDot({ color, pulse }: { color: string; pulse: boolean }) {
  const o = useSharedValue(1);

  useEffect(() => {
    if (!pulse) {
      o.value = 1;
      return;
    }
    o.value = withRepeat(
      withTiming(0.3, { duration: motion.pulseMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      true,
    );
  }, [pulse, o]);

  const animated = useAnimatedStyle(() => ({ opacity: o.value }));

  return <Animated.View style={[styles.dot, { backgroundColor: color }, animated]} />;
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    borderRadius: radii.pill,
  },
  pillSm: { minHeight: 22, paddingHorizontal: spacing.sm, paddingVertical: 3 },
  pillMd: { minHeight: 28, paddingHorizontal: spacing.md, paddingVertical: spacing.xs },
  label: { fontWeight: fontWeight.semibold, fontFamily: fontFamily.archivo.semibold, letterSpacing: 0.2 },
  labelSm: { fontSize: fontSize.caption },
  labelMd: { fontSize: fontSize.bodySm },
  dot: { width: 7, height: 7, borderRadius: 4 },
});
