// One round control over map imagery — the unit the control rail is built
// from (Apple Maps' top-right cluster, sized for a glove).
//
//   • 56pt round target (Drift #1), frosted glass so the glyph reads in sun
//     over any imagery (`GlassCard onLight onArt`: ≥13:1 for ink on frost).
//   • Selected breaks from glass to the royal ramp — glass reads "available",
//     solid reads "on" (the same grammar the map chips used).
//   • Optional count badge (the layers button wears the number of active
//     filters) and busy spinner (my-location while a fix is being read).
//   • Optional long-press for the second function ("my location" holds to
//     toggle follow-me); the accessibility hint says so.

import { ActivityIndicator, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '@/components/glass/GlassCard';
import { PressableScale } from '@/components/PressableScale';
import type { IoniconName } from '@/components/ui/IconChip';
import { brand, colors, fontSize, fontWeight, gradients, radii, shadows, touchTarget } from '@/theme/tokens';

export const RAIL_BUTTON_SIZE = touchTarget.standard;

export type RailButtonProps = {
  icon: IoniconName;
  /** Spoken name — always descriptive ("Go to my location"), never the glyph. */
  label: string;
  onPress: () => void;
  /** Second function on a hold. Announced via the accessibility hint. */
  onLongPress?: () => void;
  longPressHint?: string;
  active?: boolean;
  /** Small count worn top-right (active filters). Hidden when 0/undefined. */
  badge?: number;
  busy?: boolean;
  disabled?: boolean;
  testID?: string;
  style?: StyleProp<ViewStyle>;
};

export function RailButton({
  icon,
  label,
  onPress,
  onLongPress,
  longPressHint,
  active = false,
  badge,
  busy = false,
  disabled = false,
  testID,
  style,
}: RailButtonProps) {
  const glyphColor = active ? colors.textInverse : colors.text;
  const glyph = busy ? (
    <ActivityIndicator color={glyphColor} />
  ) : (
    <Ionicons name={icon} size={24} color={glyphColor} />
  );

  return (
    <PressableScale
      style={[styles.hit, style]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={onLongPress ? 380 : undefined}
      disabled={disabled}
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={onLongPress ? longPressHint : undefined}
      accessibilityState={{ selected: active, disabled, busy }}
    >
      {active ? (
        <View style={[styles.fill, styles.fillActive]}>
          <LinearGradient
            colors={gradients.clearDay}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          {glyph}
        </View>
      ) : (
        <GlassCard onLight onArt radius={radii.pill} style={styles.fill}>
          {glyph}
        </GlassCard>
      )}
      {badge != null && badge > 0 ? (
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>{badge > 9 ? '9+' : String(badge)}</Text>
        </View>
      ) : null}
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // Shadow on the wrapper: the glass card clips to its own radius.
  hit: {
    width: RAIL_BUTTON_SIZE,
    height: RAIL_BUTTON_SIZE,
    borderRadius: radii.pill,
    ...shadows.float,
  },
  fill: {
    width: RAIL_BUTTON_SIZE,
    height: RAIL_BUTTON_SIZE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  fillActive: { backgroundColor: colors.brand },
  // Deep royal, not burnt: white on burnt is 4.0:1 at this size, white on
  // royalDeep is 10:1 (Drift #1). The badge is a count, not an alarm.
  badge: {
    position: 'absolute',
    top: -2,
    right: -2,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 5,
    borderRadius: radii.pill,
    backgroundColor: brand.royalDeep,
    borderWidth: 2,
    borderColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
});
