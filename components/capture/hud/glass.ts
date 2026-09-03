// The camera chrome's one surface language: dark smoke glass with light ink.
//
// Every control on the viewfinder is drawn with these — the smoke pair from
// the tokens, weighted so the text contrast is a property of the control and
// not of the roof behind it (Drift #1: sun-readable, always). "Active" breaks
// from glass into a solid white fill with ink text, so state is carried by
// fill + glyph, never by hue alone.
//
// 1A (docs/DESIGN_1A.md §6) adds a SECOND active language, `hudSelected`, for
// picking one option out of a set (the mode/tag pill rows, the slope rose) —
// "recolour to brand.royal active / translucent-dark inactive". It stays
// distinct from `hudActive`: an on/off TOGGLE (Torch, Live, Guides, Coach,
// the chevron) keeps the neutral white-fill flip, because that convention's
// whole point is contrast independent of hue; a SELECTION among several
// pills gets the brand's own colour instead, per the mock. One token pair,
// defined once here, so no HUD component reaches for `brand.royal` itself.

import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { brand, colors, fontFamily, fontSize, fontWeight, glass, radii, touchTarget } from '@/theme/tokens';

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

/** Chosen state for an on/off TOGGLE: white fill, ink text. */
export const hudActive: ViewStyle = {
  backgroundColor: colors.surface,
  borderColor: colors.surface,
};

/**
 * Chosen state for a SELECTION among options — the mode/tag chip rows, the
 * slope rose. 1A's royal-fill pill (docs/DESIGN_1A.md §6). Inactive pills
 * stay on `hudPanel`'s translucent-dark smoke fill, so "selected" is the only
 * thing that ever turns royal.
 */
export const hudSelected: ViewStyle = {
  backgroundColor: brand.royal,
  borderColor: brand.royal,
};

export const hudInk = colors.textInverse;
export const hudInkActive = colors.text;
/** Text/glyph colour on a `hudSelected` fill — the mesh system's "white". */
export const hudSelectedInk = colors.onMesh;

export const hudLabel: TextStyle = {
  color: colors.textInverse,
  fontSize: fontSize.bodySm,
  fontWeight: fontWeight.semibold,
  fontFamily: fontFamily.archivo.semibold,
};

export const hudCaption: TextStyle = {
  color: colors.textInverse,
  opacity: 0.78,
  fontSize: fontSize.caption,
  fontWeight: fontWeight.semibold,
  fontFamily: fontFamily.archivo.semibold,
};

/** Minimum gap between adjacent targets (glove rule: ≥12pt). */
export const HUD_GAP = 12;
