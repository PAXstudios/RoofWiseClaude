import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass, radii, shadows } from '@/theme/tokens';

type Props = PropsWithChildren<{
  /** Visual weight. `high` for the focused element on a screen. */
  level?: 'low' | 'base' | 'high';
  /** Blur strength. Ignored where blur is unsupported. */
  intensity?: number;
  /** Use on white/light backgrounds instead of the dark onboarding scale. */
  onLight?: boolean;
  /**
   * The card floats over ART — a hero gradient, the radar motif, a photo —
   * rather than a flat ground.
   *
   * This matters because `level`'s fills are tuned for flat grounds: a 6–16%
   * wash reads as a surface on black and on white, but over a gradient the
   * art shows straight through and the copy lands on whatever hue happens to
   * be behind it. `onArt` swaps in the weighted over-art pair, so text
   * contrast becomes a property of the card rather than of the art:
   *   onArt           → dark smoke panel, carry `colors.textInverse`
   *   onArt + onLight → light frost panel, carry `colors.text`
   * Both clear 8:1 over every hero gradient we ship (Drift #1). `level` is
   * ignored while `onArt` is set — legibility is not a weight to dial down.
   */
  onArt?: boolean;
  /**
   * Brand-tinted lift (`shadows.hero`) under the card, so a focal panel
   * appears to glow onto whatever it sits on. Reserve it for the ONE
   * cinematic element on a screen; everywhere else a coloured shadow stops
   * being depth and becomes decoration.
   */
  glow?: boolean;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}>;

const FILL = { low: glass.fillLow, base: glass.fill, high: glass.fillHigh };

/**
 * Frosted translucent surface — the core of the 2026 brand language.
 *
 * Renders a real backdrop blur where the platform supports it and falls back
 * to the tinted fill alone elsewhere. The fill is always present, so the
 * component never depends on blur to stay legible: on Android (where
 * BlurView is expensive and inconsistent) and under Reduce Transparency,
 * this degrades to a flat translucent card rather than an unreadable one.
 */
export function GlassCard({
  level = 'base',
  intensity = 28,
  onLight = false,
  onArt = false,
  glow = false,
  radius = radii.lg,
  style,
  children,
}: Props) {
  const fill = onArt
    ? onLight
      ? glass.frostFill
      : glass.smokeFill
    : onLight
    ? glass.lightFill
    : FILL[level];

  const borderColor = onArt
    ? onLight
      ? glass.frostBorder
      : glass.smokeBorder
    : onLight
    ? glass.lightBorder
    : level === 'high'
    ? glass.borderStrong
    : glass.border;

  const shell: ViewStyle = {
    borderRadius: radius,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor,
    // A clipping layer cannot also cast a shadow on iOS (`overflow: hidden`
    // sets clipsToBounds, which clips the shadow with it). When the card is
    // glowing, the blur below takes the corner radius instead — the card
    // keeps one view, so layout and every existing call site are unchanged.
    overflow: glow ? 'visible' : 'hidden',
    backgroundColor: fill,
  };

  // iOS gets the real thing; elsewhere the tinted fill above already stands
  // on its own, so we skip the cost of an ineffective blur pass.
  if (Platform.OS === 'ios') {
    return (
      <View style={[shell, glow && shadows.hero, style]}>
        <BlurView
          intensity={intensity}
          tint={onLight ? 'light' : 'dark'}
          style={[StyleSheet.absoluteFill, { borderRadius: radius, overflow: 'hidden' }]}
        />
        {children}
      </View>
    );
  }

  return <View style={[shell, glow && shadows.hero, style]}>{children}</View>;
}
