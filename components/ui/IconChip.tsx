import type { ComponentProps } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { colors, radii } from '@/theme/tokens';

/** Ionicons glyph name — re-exported so the ui primitives all speak one type. */
export type IoniconName = ComponentProps<typeof Ionicons>['name'];

/**
 * Colour families for tiles and chips. `quiet` is the neutral fallback for
 * anything that has no meaning of its own — reach for it rather than
 * inventing a fifth hue.
 */
export type ChipTone = 'blue' | 'green' | 'orange' | 'purple' | 'quiet';

export type ChipSize = 'sm' | 'md';

/**
 * Ground/ink pairs, each contrast-checked at the token layer (>=4.5:1). Take
 * the `fg` from here when a value should share its chip's colour — that
 * shared hue is what makes a stat read as one object instead of two.
 */
export const CHIP_TONES: Record<ChipTone, { bg: string; fg: string }> = {
  blue: { bg: colors.tileBlue, fg: colors.tileBlueInk },
  green: { bg: colors.tileGreen, fg: colors.tileGreenInk },
  orange: { bg: colors.tileOrange, fg: colors.tileOrangeInk },
  purple: { bg: colors.tilePurple, fg: colors.tilePurpleInk },
  quiet: { bg: colors.fillQuiet, fg: colors.textMuted },
};

const SIZES: Record<ChipSize, { box: number; icon: number; radius: number }> = {
  sm: { box: 32, icon: 17, radius: radii.control },
  md: { box: 40, icon: 21, radius: radii.md },
};

type Props = {
  name: IoniconName;
  /** Colour family. Default `blue`. */
  tone?: ChipTone;
  /** `sm` 32pt for list rows, `md` 40pt for cards. Default `md`. */
  size?: ChipSize;
  style?: StyleProp<ViewStyle>;
};

/**
 * Rounded-square icon tile — the smallest unit of the crafted language.
 *
 * A colour-coded chip is how a module announces what it is before anyone
 * reads a word, and it is the single cheapest thing that separates a
 * designed list from a Settings list. It is DECORATIVE: it carries no press
 * behaviour and is hidden from screen readers, because the row or card
 * around it owns the label and the touch target (Drift #1 — the 56pt target
 * belongs to the parent, never to a 32pt square).
 */
export function IconChip({ name, tone = 'blue', size = 'md', style }: Props) {
  const t = CHIP_TONES[tone];
  const s = SIZES[size];

  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[
        styles.chip,
        { width: s.box, height: s.box, borderRadius: s.radius, backgroundColor: t.bg },
        style,
      ]}
    >
      <Ionicons name={name} size={s.icon} color={t.fg} />
    </View>
  );
}

const styles = StyleSheet.create({
  chip: { alignItems: 'center', justifyContent: 'center' },
});
