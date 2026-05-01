import { Platform, ViewStyle } from 'react-native';

export const colors = {
  bg: '#F6F7F9',
  surface: '#FFFFFF',
  surfaceMuted: '#F1F3F6',
  border: '#E6E8EC',
  borderStrong: '#D8DCE3',

  text: '#0E1116',
  textMuted: '#5B6472',
  textSubtle: '#8A93A1',
  textInverse: '#FFFFFF',

  accent: '#F26B1F',
  accentSoft: '#FFE6D5',
  accentPressed: '#D85B14',

  brand: '#1E66F5',
  brandSoft: '#E0EAFF',

  success: '#2BB673',
  successSoft: '#DBF5E7',
  warn: '#F4B400',
  warnSoft: '#FFF1C2',
  danger: '#E5484D',
  dangerSoft: '#FCE2E3',
  info: '#3B82F6',
  infoSoft: '#DBEAFE',

  overlay: 'rgba(14, 17, 22, 0.45)',
  scrim: 'rgba(14, 17, 22, 0.7)',

  stormHail: '#1E66F5',
  stormWind: '#F26B1F',
  stormSevere: '#E5484D',
};

export const radii = {
  sm: 8,
  md: 12,
  card: 16,
  lg: 20,
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

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 18,
  xl: 22,
  xxl: 28,
  display: 34,
};

export const fontWeight = {
  regular: '400' as const,
  medium: '500' as const,
  semibold: '600' as const,
  bold: '700' as const,
};

const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#0E1116',
    shadowOpacity: 0.06,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
  },
  android: {
    elevation: 2,
  },
  web: {
    // @ts-expect-error react-native-web accepts boxShadow
    boxShadow: '0 4px 14px rgba(14,17,22,0.06)',
  },
  default: {},
}) as ViewStyle;

const pressedShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: '#0E1116',
    shadowOpacity: 0.1,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  android: { elevation: 6 },
  web: {
    // @ts-expect-error react-native-web accepts boxShadow
    boxShadow: '0 10px 24px rgba(14,17,22,0.1)',
  },
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

export const theme = {
  colors,
  radii,
  spacing,
  fontSize,
  fontWeight,
  shadows,
  breakpoints,
};

export type Theme = typeof theme;
