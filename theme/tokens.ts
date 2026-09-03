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

  // ── Over ART (gradients, radar, photography) ────────────────────────────
  // `fill` / `lightFill` are tuned for a FLAT ground: a 6–10% wash is enough
  // to read as a surface on black or on white. Floated over a hero gradient
  // they stop being surfaces — the art shows straight through and the copy
  // lands on whatever hue happens to be behind it. These two are the
  // over-art pair, weighted so the text contrast is a property of the CARD
  // and not of the art (Drift #1: sun-readable, always).
  //
  // frost: light panel, carries `colors.text`. 13.5:1 over royalInk,
  //        14.7:1 over royal, 15.2:1 over burnt.
  frostFill: 'rgba(255,255,255,0.86)',
  frostBorder: 'rgba(255,255,255,0.72)',
  // smoke: dark panel, carries `colors.textInverse`. 10.7:1 over royal,
  //        8.4:1 over burnt — i.e. legible over the brightest hero we ship.
  smokeFill: 'rgba(10,12,20,0.46)',
  smokeBorder: 'rgba(255,255,255,0.22)',
};

export const colors = {
  // Legacy names, repointed to brand v2.
  navy: brand.royalInk,
  orange: brand.burnt,
  cream: '#FFFFFF',
  slate: '#5A6180',

  // iOS grouped ground — white cards sit on this so content reads as content
  // even when compact. Keeps the house blue bias.
  bg: '#F6F6FA',
  surface: '#FFFFFF',
  // Neutrals carry a slight blue bias so they read as chosen, not defaulted.
  surfaceMuted: '#F5F6FA',
  border: '#E6E8F0',
  borderStrong: '#CFD3E2',

  // iOS chrome fills — ink at low alpha so they sit on any light surface.
  hairline: 'rgba(14,19,48,0.10)',      // separators, bar borders
  barFill: 'rgba(255,255,255,0.92)',    // tab/nav bars (rgba stands in for blur)
  fillQuiet: 'rgba(14,19,48,0.05)',     // grey-fill secondary buttons, segmented tracks

  text: '#0E1330',
  textMuted: '#5A6180',
  textSubtle: '#8A90A8',
  textInverse: '#FFFFFF',

  accent: brand.burnt,
  accentSoft: brand.burntSoft,
  accentPressed: brand.burntDeep,
  // Burnt @ 50%, as a flat *fill* for disabled primary CTAs. Painting the wash
  // into the background (instead of element-level `opacity`) keeps the button
  // one flat surface — opacity composites the label subtree as its own layer,
  // which leaves a faint rectangular seam inside the wash on web.
  accentDisabled: 'rgba(217, 84, 30, 0.5)',
  // Disabled PRIMARY CTA fill. A tinted accent is the wrong answer for a
  // sticky 88pt button: at full width it still reads as a live primary
  // control, and white-on-washed-burnt lands near 1.9:1 — unreadable in sun
  // (Drift #1). A neutral ink wash reads as "off" at a glance and carries
  // `colors.textMuted` at ~5.6:1, so the label stays legible while the
  // button stops pretending to be tappable.
  fillDisabled: 'rgba(14,19,48,0.08)',

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
  // Translucent fills for hail swath circles (the Apple Maps fallback for the
  // Google-only heatmap in Hail Tracer). Same hues as above at low alpha.
  stormHailFill: 'rgba(43, 78, 245, 0.22)',
  stormSevereFill: 'rgba(217, 58, 63, 0.28)',

  // ── Tile grounds ────────────────────────────────────────────────────────
  // Soft grounds for icon chips and stat tiles. Colour is how a crafted app
  // tells modules apart at a glance; a single accent everywhere is what made
  // v2 read like a Settings list. Each ground ships with its own ink, and
  // the pair is contrast-checked against WCAG AA (>=4.5:1) because a gloved
  // roofer reads these outdoors, in sun, at arm's length:
  //   blue   8.4:1   green 5.5:1   orange 6.6:1   purple 7.5:1
  // Use the ink for the glyph/label ON its ground — never on white, and
  // never swap inks between grounds.
  tileBlue: '#E1E8FF',
  tileBlueInk: '#1B31A8',
  tileGreen: '#D8F2E5',
  tileGreenInk: '#0F6B43',
  tileOrange: '#FCE6DA',
  tileOrangeInk: '#8F3210',
  tilePurple: '#ECE5FD',
  tilePurpleInk: '#5230A0',
};

// ── Gradients ─────────────────────────────────────────────────────────────
// Consumed directly by `<LinearGradient colors={gradients.x} />`. Typed as
// readonly tuples so a two-stop gradient can never be passed with one stop,
// and so the arrays stay frozen at the token layer (a screen must not push
// its own stop onto a shared gradient).
//
// Direction is the caller's: these are colour ramps, not compositions. The
// house default is top-to-bottom (LinearGradient's own default).
export type GradientStops = readonly [string, string, ...string[]];

export const gradients = {
  /** Hero ground, calm/night. Deep blue-black — the onboarding sky. */
  stormNight: [brand.royalInk, brand.black] as const,
  /** Hero ground, escalated. Burnt bleeding into ink — "act now". */
  stormSevere: [brand.burntDeep, brand.royalInk] as const,
  /** Hero ground, clear/day. Saturated royal with depth under it. */
  clearDay: [brand.royal, brand.royalDeep] as const,
  /**
   * Legibility scrim. Lay over art, bottom-anchored, so light copy holds its
   * contrast no matter what the art underneath is doing.
   */
  scrim: ['rgba(0,0,0,0)', 'rgba(0,0,0,0.75)'] as const,
  /** Primary CTA depth — burnt with a shadowed base so it reads as a solid. */
  accent: [brand.burnt, brand.burntDeep] as const,
  /** Home tool tiles — one saturated family per tool, white type on top. */
  tileStorm: [brand.royal, brand.royalDeep] as const,
  tileKnock: [brand.burnt, brand.burntDeep] as const,
  tileEstimate: ['#1E9E62', '#0F6B43'] as const,
  tileMileage: ['#6D48D8', '#5230A0'] as const,
} satisfies Record<string, GradientStops>;

export const radii = {
  sm: 8,
  md: 12,
  card: 16,
  lg: 20,
  xl: 24,
  pill: 999,

  // iOS-17 control shapes — buttons and inputs stop being full pills.
  button: 14,
  control: 10,
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

// iOS-subtle: cards lean on the grouped ground + hairline, not on shadow.
const cardShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.05,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 1 },
  },
  android: {
    elevation: 1,
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

// Floating chrome — bars, FABs, toasts. Slightly more present than a card.
const floatShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 2 },
  },
  android: { elevation: 6 },
  default: {},
}) as ViewStyle;

// Segmented-control thumb — the tight little iOS slider shadow.
const thumbShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
  },
  android: { elevation: 2 },
  default: {},
}) as ViewStyle;

// Real content-card lift. `card` above is deliberately timid (0.05) — right
// for a flat cell in a grouped list, wrong for a card that should feel like
// an object you could pick up. Depth is layered, so use exactly one rung:
// hero (gradient + coloured lift) > raised (content card) > card (flat cell).
const raisedShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: colors.navy,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
  android: { elevation: 4 },
  // react-native-web maps the shadow props onto `box-shadow`, so the two
  // rungs that carry the design's depth are visible in the web export too —
  // the flat rungs above stay shadowless there, which is exactly the
  // hierarchy we want.
  web: {
    shadowColor: colors.navy,
    shadowOpacity: 0.1,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
  },
  default: {},
}) as ViewStyle;

// Hero lift — the shadow is BRAND-TINTED rather than neutral, so a hero card
// appears to glow onto the ground beneath it instead of merely casting. Royal
// (the primary identity) reads under both the blue and the burnt heroes.
// Reserve this for the one cinematic element on a screen; on everything else
// it stops being depth and becomes decoration.
const heroShadow: ViewStyle = Platform.select({
  ios: {
    shadowColor: brand.royal,
    shadowOpacity: 0.3,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  android: { elevation: 10 },
  web: {
    shadowColor: brand.royal,
    shadowOpacity: 0.3,
    shadowRadius: 26,
    shadowOffset: { width: 0, height: 12 },
  },
  default: {},
}) as ViewStyle;

export const shadows = {
  card: cardShadow,
  pressed: pressedShadow,
  float: floatShadow,
  thumb: thumbShadow,
  raised: raisedShadow,
  hero: heroShadow,
};

export const breakpoints = {
  md: 768,
  lg: 1100,
};

// Motion tokens — every withTiming/withSpring/etc should reference these.
export const motion = {
  quick: { mass: 1, damping: 18, stiffness: 320 },
  snappy: { mass: 1, damping: 20, stiffness: 280 },   // iOS default-feel spring

  standard: { mass: 1, damping: 16, stiffness: 200 },
  gentle: { mass: 1, damping: 16, stiffness: 130 },
  bouncy: { mass: 1, damping: 11, stiffness: 200 },
  staggerDelayMs: 40,  // spec: entrance stagger reads as one wave, not a parade
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
  gradients,
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

// Camera chrome timing (Quick Inspection HUD). A separate export rather than
// new keys on `motion`, so nothing that spreads or enumerates `motion` moves.
export const hudMotion = {
  /** Secondary chrome (mode strip, tool rail, instruments) tucks itself away after this idle. */
  idleCollapseMs: 4000,
  /** Secondary layer fade in/out. */
  chromeFadeMs: 200,
  /** A transient status line ("Imported 3", "Hold steady") stays this long. */
  statusHoldMs: 4000,
};
