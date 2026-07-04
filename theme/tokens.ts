import { Platform, ViewStyle } from 'react-native';

// RoofWise brand palette — single source of truth.
// Per spec: navy + orange + cream + slate. No raw hex anywhere else in the app.
export const colors = {
  navy: '#0C183C',
  orange: '#FC6018',
  cream: '#F0F0E4',
  slate: '#546078',

  // Convenience aliases (so existing call sites keep working while we migrate)
  bg: '#F0F0E4',           // cream
  surface: '#FFFFFF',
  surfaceMuted: '#F6F5EC',
  border: '#DDDED1',
  borderStrong: '#C7C8B8',

  text: '#0C183C',         // navy
  textMuted: '#546078',    // slate
  textSubtle: '#8A8F9A',
  textInverse: '#FFFFFF',

  accent: '#FC6018',       // orange
  accentSoft: '#FFE0CC',
  accentPressed: '#E04E0F',

  brand: '#0C183C',        // navy
  brandSoft: '#D6DAE8',

  success: '#2BB673',
  successSoft: '#DBF5E7',
  warn: '#F4B400',
  warnSoft: '#FFF1C2',
  danger: '#E5484D',
  dangerSoft: '#FCE2E3',
  info: '#1E66F5',
  infoSoft: '#DBEAFE',

  overlay: 'rgba(12, 24, 60, 0.45)',
  scrim: 'rgba(12, 24, 60, 0.72)',

  stormHail: '#1E66F5',
  stormWind: '#FC6018',
  stormSevere: '#E5484D',
};

export const radii = {
  sm: 8,
  md: 12,
  card: 16,
  lg: 20,
  xl: 24,
  pill: 999,
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
};

// Type ramp from spec — Apple-system font, named sizes only.
export const fontSize = {
  caption: 11,
  bodySm: 13,
  bodyMd: 15,
  bodyLg: 17,
  titleSm: 22,    // intentionally 22, not 18 — from real usage
  titleMd: 20,
  titleLg: 24,
  titleXl: 28,
  display: 34,

  // Backwards-compatible aliases used in existing components.
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
};

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

// Glove-friendly touch targets, per spec.
export const touchTarget = {
  small: 44,         // not for primary actions
  standard: 56,      // minimum for tappable elements
  preferred: 64,     // preferred for CTAs and chips
  sticky: 88,        // sticky primary CTAs in thumb zone
};

const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  android: {
    elevation: 2,
  },
  default: {},
}) as ViewStyle;

const pressedShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 6 },
  default: {},
}) as ViewStyle;

export const shadows = {
  card: cardShadow,
  pressed: pressedShadow,
};

export const breakpoints = {
  md: 768,
  lg: 1100,
};

// Motion tokens — every withTiming/withSpring/etc should reference these.
export const motion = {
  quick: { mass: 1, damping: 18, stiffness: 320 },
  standard: { mass: 1, damping: 16, stiffness: 200 },
  gentle: { mass: 1, damping: 16, stiffness: 130 },
  bouncy: { mass: 1, damping: 11, stiffness: 200 },
  staggerDelayMs: 60,
  enterMs: 360,     // screen-element entrance (FadeSlideIn)
  countUpMs: 800,   // KPI counter roll-up
  pulseMs: 1600,    // live-indicator halo loop
  shimmerMs: 1100,  // skeleton shimmer loop
};

export const theme = {
  colors,
  radii,
  spacing,
  fontSize,
  fontWeight,
  touchTarget,
  shadows,
  breakpoints,
  motion,
};

export type Theme = typeof theme;
