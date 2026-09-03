// The camera chrome's one surface language: dark smoke glass with light ink.
//
// Every control on the viewfinder is drawn with these — the smoke pair from
// the tokens, weighted so the text contrast is a property of the control and
// not of the roof behind it (Drift #1: sun-readable, always). "Active" breaks
// from glass into a solid white fill with ink text, so state is carried by
// fill + glyph, never by hue alone.

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { colors, fontSize, fontWeight, glass, radii, touchTarget } from '@/theme/tokens';

/** A 56pt round smoke-glass button. */
export const hudDisc: ViewStyle = {
  width: touchTarget.standard,
  height: touchTarget.standard,
  borderRadius: radii.pill,
  backgroundColor: glass.smokeFill,
  borderWidth: StyleSheet.hairlineWidth * 2,
  borderColor: glass.smokeBorder,
  alignItems: 'center',
  justifyContent: 'center',
};

/** The same surface as a rounded rectangle (pills, strips, drawers). */
export const hudPanel: ViewStyle = {
  backgroundColor: glass.smokeFill,
  borderWidth: StyleSheet.hairlineWidth * 2,
  borderColor: glass.smokeBorder,
};

/** Chosen state: white fill, ink text. */
export const hudActive: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.surface,
};

export const hudInk = colors.textInverse;
export const hudInkActive = colors.text;

export const hudLabel: TextStyle = {
  color: colors.textInverse,
  fontSize: fontSize.bodySm,
  fontWeight: fontWeight.semibold,
};

export const hudCaption: TextStyle = {
  color: colors.textInverse,
  opacity: 0.78,
  fontSize: fontSize.caption,
  fontWeight: fontWeight.semibold,
};

/** Minimum gap between adjacent targets (glove rule: ≥12pt). */
export const HUD_GAP = 12;
