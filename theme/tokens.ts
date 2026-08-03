import { Platform, ViewStyle } from 'react-native';

// RoofWise brand palette — single source of truth. No raw hex anywhere else.
//
// BRAND v2 (2026): royal blue + burnt orange. Onboarding runs on true black
// with glass surfaces (iOS-style translucency); the app proper runs on white.
// The legacy `navy` / `orange` / `cream` names are kept and REPOINTED at the
// new palette so every existing screen rebrands without touching 40 files.
// New work should prefer the explicit names (`royal`, `burnt`, `ink`, …).

export const brand = {
  // Royal blue — primary identity. Saturated enough to read on black,
  // dark enough to pass contrast on white.
  royal: '#2B4EF5',
  royalDeep: '#1B31A8',
  royalInk: '#0E1330',        // near-black with a blue bias, for text/dark surfaces
  royalSoft: '#E4E9FE',       // tint for light surfaces

  // Burnt orange — accent + primary CTA. Deliberately burnt, not neon,
  // so it reads as a considered pair to the blue rather than a warning.
  burnt: '#D9541E',
  burntDeep: '#A63C12',
  burntSoft: '#FBE7DD',

  // Dark scale (onboarding). True black for OLED depth, iOS-style.
  black: '#000000',
  black2: '#0A0C14',          // raised dark surface
  black3: '#141824',          // higher elevation
};

// Glass surfaces. Pair these fills with expo-blur; the fill alone is the
// fallback when blur is unavailable (Android, reduced transparency).
export const glass = {
  fillLow: 'rgba(255,255,255,0.06)',
  fill: 'rgba(255,255,255,0.10)',
  fillHigh: 'rgba(255,255,255,0.16)',
  border: 'rgba(255,255,255,0.14)',
  borderStrong: 'rgba(255,255,255,0.24)',
  // On white surfaces, glass tints toward the brand rather than pure grey.
  lightFill: 'rgba(43,78,245,0.06)',
  lightBorder: 'rgba(43,78,245,0.14)',
};

export const colors = {
  // Legacy names, repointed to brand v2.
  navy: brand.royalInk,
  orange: brand.burnt,
  cream: '#FFFFFF',
  slate: '#5A6180',

  bg: '#FFFFFF',
  surface: '#FFFFFF',
  // Neutrals carry a slight blue bias so they read as chosen, not defaulted.
  surfaceMuted: '#F5F6FA',
  border: '#E6E8F0',
  borderStrong: '#CFD3E2',

  text: '#0E1330',
  textMuted: '#5A6180',
  textSubtle: '#8A90A8',
  textInverse: '#FFFFFF',

  accent: brand.burnt,
  accentSoft: brand.burntSoft,
  accentPressed: brand.burntDeep,

  brand: brand.royal,
  brandSoft: brand.royalSoft,

  // Semantic colors stay separate from the brand hues so "good/warning/bad"
  // never collides with "this is a RoofWise accent".
  success: '#1E9E62',
  successSoft: '#DCF3E8',
  warn: '#C77A0A',
  warnSoft: '#FBEED6',
  danger: '#D93A3F',
  dangerSoft: '#FBE3E4',
  info: brand.royal,
  infoSoft: brand.royalSoft,

  overlay: 'rgba(14, 19, 48, 0.45)',
  scrim: 'rgba(14, 19, 48, 0.72)',

  stormHail: brand.royal,
  stormWind: brand.burnt,
  stormSevere: '#D93A3F',
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

  // Onboarding. Slower and more deliberate than in-app motion — these
  // animations are doing explanatory work, so they need time to be read.
  sceneEnterMs: 620,
  sceneExitMs: 280,
  sceneStaggerMs: 90,
  ambientMs: 9000,  // slow background drift loop
};

export const theme = {
  brand,
  glass,
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
