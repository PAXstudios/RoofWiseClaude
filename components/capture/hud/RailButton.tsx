// One round 56pt glass button on the tool rail (or anywhere on the camera
// chrome). Icon + a one-word caption under it — a gloved roofer in sun reads
// the word, not the glyph. `active` swaps the disc to white with ink so a
// toggle's state is carried by the fill, not by colour alone.

import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';
import { hudActive, hudDisc, hudInk, hudInkActive } from './glass';

type Props = {
  icon: IoniconName;
  /** One short word under the disc. */
  caption: string;
  /** Spoken label — the full sentence. */
  accessibilityLabel: string;
  onPress: () => void;
  onLongPress?: () => void;
  /** Toggle state, when the button is one. */
  active?: boolean;
  /** Dimmed and inert (an import in flight, etc.). */
  disabled?: boolean;
  /** Small "attention" dot on the disc (e.g. Live paused). */
  dot?: boolean;
  /** Hide the caption (the top bar's discs). */
  bare?: boolean;
  style?: StyleProp<ViewStyle>;
};

export function RailButton({
  icon,
  caption,
  accessibilityLabel,
  onPress,
  onLongPress,
  active = false,
  disabled = false,
  dot = false,
  bare = false,
  style,
}: Props) {
  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      style={({ pressed }) => [styles.wrap, pressed && styles.pressed, disabled && styles.disabled, style]}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      accessibilityState={{ disabled, ...(active !== undefined ? { selected: active } : {}) }}
      hitSlop={spacing.xs}
    >
      <View style={[styles.disc, active && styles.discActive]}>
        <Ionicons name={icon} size={24} color={active ? hudInkActive : hudInk} />
        {dot && <View style={styles.dot} />}
      </View>
      {!bare && (
        <Text style={[styles.caption, active && styles.captionActive]} numberOfLines={1}>
          {caption}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2, minWidth: touchTarget.standard },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.45 },
  disc: hudDisc,
  discActive: hudActive,
  // Caption on smoke: small but bold, with its own shadow-free contrast — the
  // caption sits on the viewfinder itself, so it gets a dark halo pill.
  caption: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 0.2,
    paddingHorizontal: spacing.xs,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
    overflow: 'hidden',
  },
  captionActive: { backgroundColor: colors.surface, color: colors.text },
  dot: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 10,
    height: 10,
    borderRadius: radii.pill,
    backgroundColor: colors.warn,
    borderWidth: 2,
    borderColor: colors.textInverse,
  },
});
