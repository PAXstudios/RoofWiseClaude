import type { PropsWithChildren } from 'react';
import { Platform, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { glass, radii } from '@/theme/tokens';

type Props = PropsWithChildren<{
  /** Visual weight. `high` for the focused element on a screen. */
  level?: 'low' | 'base' | 'high';
  /** Blur strength. Ignored where blur is unsupported. */
  intensity?: number;
  /** Use on white/light backgrounds instead of the dark onboarding scale. */
  onLight?: boolean;
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
  radius = radii.lg,
  style,
  children,
}: Props) {
  const fill = onLight ? glass.lightFill : FILL[level];
  const borderColor = onLight
    ? glass.lightBorder
    : level === 'high'
    ? glass.borderStrong
    : glass.border;

  const shell: ViewStyle = {
    borderRadius: radius,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor,
    overflow: 'hidden',
    backgroundColor: fill,
  };

  // iOS gets the real thing; elsewhere the tinted fill above already stands
  // on its own, so we skip the cost of an ineffective blur pass.
  if (Platform.OS === 'ios') {
    return (
      <View style={[shell, style]}>
        <BlurView
          intensity={intensity}
          tint={onLight ? 'light' : 'dark'}
          style={StyleSheet.absoluteFill}
        />
        {children}
      </View>
    );
  }

  return <View style={[shell, style]}>{children}</View>;
}
