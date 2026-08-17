/**
 * WeatherHero — the Home screen's one cinematic moment.
 *
 * A ~224pt hero card in the onboarding's visual language (brand gradient
 * ground + the radar motif + frosted chips), sitting first under the greeting.
 * It reads its own stores and services and picks its own state, so Home mounts
 * `<WeatherHero />` and never branches.
 *
 * ── THE THREE HONEST STATES ───────────────────────────────────────────────
 *
 *  A. ACTIVE STORM ALERT (`stormAlertStore` has an alert with status 'new')
 *     Escalated hero: `gradients.stormSevere`, radar cells derived from the
 *     alert's real magnitude and its matched leads' true distances, a burnt
 *     "STORM ALERT" flag, the warning headline, the area, the measured hail /
 *     wind, and the current temperature when weather resolved. The footer CTA
 *     carries the real consequence line from `leadsInStormCluster()` —
 *     "3 leads within 1.4 mi of the Apr 18 hail core" — and opens the Map
 *     focused on those leads. No cluster → the alert's own property count,
 *     and never a "0 leads" line (Drift #5).
 *
 *  B. NO ALERT, WEATHER AVAILABLE
 *     Calm hero: `gradients.clearDay` by day / `gradients.stormNight` after
 *     dark, big light-weight temperature, the condition, feels-like, and only
 *     the wind / gust / rain figures the API actually reported. A HAAG §7
 *     roof-work safety chip appears when the forecast carried enough real
 *     readings to rate. A quiet "Storm Watch is scanning <area>" footer
 *     appears only when a service area exists. The radar runs as an ambient
 *     ring-and-sweep pattern with NO cells — there is no storm to draw.
 *
 *  C. WEATHER UNAVAILABLE / NOT CONFIGURED
 *     A compact one-line cell ("Weather not available" / "Weather needs
 *     location access"). Never a hero-sized placeholder.
 *
 *  (+ a fourth, BOUNDED state: while the location + weather round-trip is
 *   still in flight the module renders the branded hero frame — gradient
 *   ground + radar — with a plain "Checking conditions" line where the
 *   reading will land. It never renders nothing: Home's cinematic moment is
 *   this card, and an absent card leaves the greeting sitting straight on the
 *   stat row. It also never pends forever: a permission prompt the user
 *   walks away from used to hang here indefinitely, so the round-trip is
 *   capped at `PENDING_TIMEOUT_MS` and falls through to state C. Nothing is
 *   synthesized in the meantime — the frame carries no numbers at all.)
 *
 * Drift #4 holds: the storm-alert TREATMENT appears only with a genuine
 * active alert. State B is live weather, not a stale alert placeholder.
 */

import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  Pressable,
  StyleSheet,
  Text,
  View,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { FOCUS_STORM_LEADS } from '@/app/(tabs)/map';
import {
  fetchCurrentWeather,
  hasSafetySignal,
  type CurrentWeather,
} from '@/lib/services/weather';
import {
  evaluateSafety,
  SAFETY_RATING_LABELS,
  type SafetyRating,
} from '@/lib/services/safetyEngine';
import { leadsInStormCluster, type StormLeadCluster } from '@/lib/services/stormWatch';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import type { Lead, StormAlert } from '@/lib/models/types';
import { PulseRing } from '@/components/motion';
import { RadarArt, type RadarCell, type RadarTone } from '@/components/weather/RadarArt';
import type { IoniconName } from '@/components/ui/IconChip';
import {
  brand,
  colors,
  fontSize,
  fontWeight,
  glass,
  gradients,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
  type GradientStops,
} from '@/theme/tokens';

/** Hero geometry. 224pt sits mid-range of the 200–240 the design calls for. */
const HERO_HEIGHT = 224;
const ART_SIZE = 240;
const PRESSED_SCALE = 0.985;

/**
 * Cap on the location + weather round-trip. An unanswered OS permission
 * prompt never settles its promise, so without this the module sits in
 * `pending` for the life of the session and Home opens on an empty hero slot.
 * Four seconds is past a normal cold fetch and short of "is this broken?".
 */
const PENDING_TIMEOUT_MS = 4000;

const GROUND_START = { x: 0, y: 0 } as const;
const GROUND_END = { x: 1, y: 1 } as const;
/** The scrim only bites in the lower half, where the copy lives. */
const SCRIM_START = { x: 0, y: 0.25 } as const;
const SCRIM_END = { x: 0, y: 1 } as const;

/**
 * The hero's display number. Derived from the type ramp rather than typed as
 * a literal (Drift #11): the temperature is the largest thing on the screen
 * by design, two steps past `display`.
 */
const TEMP_SIZE = fontSize.display * 2;

/**
 * HAAG §7 go/no-go chip, over a dark hero.
 *
 * SAFE / USE_CAUTION take the contrast-checked tile pairs (5.5:1 and 6.6:1).
 * UNSAFE deliberately breaks the pattern and goes solid `danger` with white
 * (4.5:1) — the one rating that should shout on a roof, in sun, is the one
 * that reads as a filled red badge rather than a soft chip.
 */
const SAFETY_CHIP: Record<SafetyRating, { bg: string; ink: string; icon: IoniconName }> = {
  SAFE: { bg: colors.tileGreen, ink: colors.tileGreenInk, icon: 'shield-checkmark' },
  USE_CAUTION: { bg: colors.tileOrange, ink: colors.tileOrangeInk, icon: 'alert-circle' },
  UNSAFE: { bg: colors.danger, ink: colors.textInverse, icon: 'warning' },
};

type WeatherPhase =
  | { kind: 'pending' }
  | { kind: 'ready'; weather: CurrentWeather }
  | { kind: 'unavailable'; reason: 'permission' | 'service' };

export function WeatherHero({ style }: { style?: StyleProp<ViewStyle> }) {
  const router = useRouter();
  const alerts = useStormAlertStore((s) => s.alerts);
  const dismissAlert = useStormAlertStore((s) => s.dismiss);
  const leads = useLeadStore((s) => s.leads);
  const areas = useServiceAreaStore((s) => s.areas);
  const [phase, setPhase] = useState<WeatherPhase>({ kind: 'pending' });

  const activeAlert = useMemo(() => alerts.find((a) => a.status === 'new'), [alerts]);

  // The leads this alert's storm actually passed over, re-derived from each
  // lead's persisted `lastStormMatch` (Storm Watch stamps `matchedAt` with the
  // alert's `firedAt`). Null when nothing matched — the line is omitted.
  const cluster = useMemo(
    () => (activeAlert ? leadsInStormCluster(leads, activeAlert) : null),
    [leads, activeAlert],
  );

  const cells = useMemo(
    () => (activeAlert ? stormCells(activeAlert, cluster, leads) : undefined),
    [activeAlert, cluster, leads],
  );

  useEffect(() => {
    let cancelled = false;
    // Fall through to the compact "not available" cell if the round-trip
    // hasn't settled in time. `setPhase` is idempotent here: whichever of the
    // two paths lands first wins, and a late-granted permission still
    // upgrades the card when its fetch resolves.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setPhase((p) => (p.kind === 'pending' ? { kind: 'unavailable', reason: 'service' } : p));
      }
    }, PENDING_TIMEOUT_MS);
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (cancelled) return;
          // A prompt the user never answers never resolves — we stay in
          // `pending` and render nothing rather than a forever-skeleton.
          if (req.status !== 'granted') {
            setPhase({ kind: 'unavailable', reason: 'permission' });
            return;
          }
        }
        const pos = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        const weather = await fetchCurrentWeather({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        if (!cancelled) setPhase({ kind: 'ready', weather });
      } catch {
        // Missing key, unreachable service, no fix — all the same to the UI:
        // say so plainly, never synthesize a forecast (Drift #5).
        if (!cancelled) setPhase({ kind: 'unavailable', reason: 'service' });
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  const weather = phase.kind === 'ready' ? phase.weather : null;

  // ── A · Active storm alert ─────────────────────────────────────────────
  if (activeAlert) {
    const headline = stormHeadline(activeAlert);
    const magnitude = magnitudeLine(activeAlert);
    const properties = activeAlert.propertyCount;
    const alertId = activeAlert.id;

    const openAlert = () =>
      router.push({ pathname: '/storm-alert/[id]', params: { id: alertId } } as any);

    const footer: FooterSpec = cluster
      ? {
          icon: 'location',
          label: cluster.headline,
          accessibilityLabel: `${cluster.headline}. Opens the map filtered to matched leads.`,
          onPress: () =>
            router.push({
              pathname: '/(tabs)/map',
              params: { focus: FOCUS_STORM_LEADS },
            } as any),
        }
      : {
          icon: 'home',
          label:
            properties > 0
              ? `${properties} propert${properties === 1 ? 'y' : 'ies'} in range`
              : 'View storm alert',
          onPress: openAlert,
        };

    return (
      <HeroFrame
        style={style}
        ground={gradients.stormSevere}
        tone="severe"
        cells={cells}
        footer={footer}
        onPress={openAlert}
        onDismiss={() => dismissAlert(alertId)}
        accessibilityLabel={[
          headline,
          activeAlert.areaLabel,
          magnitude,
          weather ? `${weather.temperatureF} degrees` : '',
          'Opens the storm alert.',
        ]
          .filter(Boolean)
          .join('. ')}
      >
        <View style={[styles.flagRow, styles.flagRowInset]}>
          <View style={styles.alertFlag}>
            <PulseRing size={7} color={brand.burnt} />
            <Text style={styles.alertFlagText}>STORM ALERT</Text>
          </View>
        </View>

        <View style={styles.readingBlock}>
          {/* With no temperature to carry the card, the warning headline
              takes the display slot instead of leaving the hero half-empty. */}
          <Text
            style={[styles.title, !weather && styles.titleAlone]}
            numberOfLines={weather ? 1 : 2}
          >
            {headline}
          </Text>
          <View style={styles.readingRow}>
            {weather && <BigTemp value={weather.temperatureF} />}
            <View style={styles.readingMeta}>
              <Text style={styles.metaPrimary} numberOfLines={1}>
                {activeAlert.areaLabel}
              </Text>
              {magnitude !== '' && (
                <Text style={[styles.metaSecondary, styles.metaSecondaryWarm]} numberOfLines={1}>
                  {magnitude}
                </Text>
              )}
            </View>
          </View>
        </View>
      </HeroFrame>
    );
  }

  // ── B · No alert, weather available ────────────────────────────────────
  if (weather) {
    const safety = hasSafetySignal(weather.safety) ? evaluateSafety(weather.safety) : null;
    const conditions = conditionsLine(weather);
    const scanning = areas.length > 0 ? scanLabel(areas) : null;

    return (
      <HeroFrame
        style={style}
        ground={weather.isDaytime ? gradients.clearDay : gradients.stormNight}
        tone="calm"
        footer={
          scanning
            ? { icon: 'radio-outline', label: `Storm Watch is scanning ${scanning}` }
            : null
        }
        // Only offer a target when there is somewhere genuinely useful to go:
        // the §7 rating leads straight to the pre-flight safety check.
        onPress={safety ? () => router.push('/safety-check') : undefined}
        accessibilityLabel={[
          `${weather.temperatureF} degrees`,
          weather.description,
          `feels like ${weather.feelsLikeF}`,
          conditions,
          safety ? `Roof work: ${SAFETY_RATING_LABELS[safety.rating]}. Opens the safety check.` : '',
        ]
          .filter(Boolean)
          .join('. ')}
      >
        <View style={styles.flagRow}>
          <View style={styles.nowChip}>
            <Ionicons
              name={weather.isDaytime ? 'sunny' : 'moon'}
              size={13}
              color={colors.textInverse}
            />
            <Text style={styles.nowChipText}>RIGHT NOW</Text>
          </View>
          {safety && (
            <View
              style={[styles.safetyChip, { backgroundColor: SAFETY_CHIP[safety.rating].bg }]}
              accessibilityRole="text"
              accessibilityLabel={`Roof work safety: ${SAFETY_RATING_LABELS[safety.rating]}`}
            >
              <Ionicons
                name={SAFETY_CHIP[safety.rating].icon}
                size={13}
                color={SAFETY_CHIP[safety.rating].ink}
              />
              <Text style={[styles.safetyChipText, { color: SAFETY_CHIP[safety.rating].ink }]}>
                {SAFETY_RATING_LABELS[safety.rating].toUpperCase()}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.readingBlock}>
          <Text style={styles.title} numberOfLines={1}>
            {weather.description}
          </Text>
          <View style={styles.readingRow}>
            <BigTemp value={weather.temperatureF} />
            <View style={styles.readingMeta}>
              <Text style={styles.metaPrimary} numberOfLines={1}>
                Feels like {weather.feelsLikeF}°
              </Text>
              {conditions !== '' && (
                <Text style={styles.metaSecondary} numberOfLines={2}>
                  {conditions}
                </Text>
              )}
            </View>
          </View>
        </View>
      </HeroFrame>
    );
  }

  // ── C · Unavailable — one compact line, never a hero-sized void ─────────
  if (phase.kind === 'unavailable') {
    const label =
      phase.reason === 'permission' ? 'Weather needs location access' : 'Weather not available';
    return (
      <View style={[styles.compact, style]} accessibilityRole="text" accessibilityLabel={label}>
        <Ionicons name="cloud-offline-outline" size={20} color={colors.textInverse} />
        <Text style={styles.compactText}>{label}</Text>
      </View>
    );
  }

  // ── D · Still resolving — the branded frame, no numbers ────────────────
  // Bounded by PENDING_TIMEOUT_MS above, so this can't become the permanent
  // skeleton that #52 fixed. It carries no readings at all: the art and the
  // gradient are the card, and the copy simply says what it's doing.
  return (
    <HeroFrame
      style={style}
      ground={gradients.stormNight}
      tone="calm"
      footer={null}
      accessibilityLabel="Checking current conditions."
    >
      <View style={styles.flagRow}>
        <View style={styles.nowChip}>
          <Ionicons name="radio-outline" size={13} color={colors.textInverse} />
          <Text style={styles.nowChipText}>RIGHT NOW</Text>
        </View>
      </View>
      <View style={styles.readingBlock}>
        <Text style={[styles.title, styles.titleAlone]} numberOfLines={2}>
          Checking conditions
        </Text>
      </View>
    </HeroFrame>
  );
}

/* ─────────────────────────── frame ───────────────────────────────────── */

type FooterSpec = {
  icon: IoniconName;
  label: string;
  onPress?: () => void;
  accessibilityLabel?: string;
};

type FrameProps = PropsWithChildren<{
  ground: GradientStops;
  tone: RadarTone;
  cells?: readonly RadarCell[];
  footer: FooterSpec | null;
  onPress?: () => void;
  onDismiss?: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Gradient ground → radar art → scrim → copy. The press targets (body,
 * footer, dismiss) are SIBLINGS rather than nested pressables, and they share
 * one spring so the whole card compresses no matter which one you hit.
 */
function HeroFrame({
  ground,
  tone,
  cells,
  footer,
  onPress,
  onDismiss,
  accessibilityLabel,
  style,
  children,
}: FrameProps) {
  const scale = useSharedValue(1);
  const shellStyle = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }));

  const press = {
    onPressIn: () => {
      scale.value = withSpring(PRESSED_SCALE, motion.snappy);
    },
    onPressOut: () => {
      scale.value = withSpring(1, motion.snappy);
    },
  };

  return (
    // The shell carries the shadow and the card carries the clip: on iOS a
    // view cannot both clip its children and cast a shadow.
    <Animated.View style={[styles.shell, shadows.hero, style, shellStyle]}>
      <View style={styles.card}>
        <LinearGradient
          colors={ground}
          start={GROUND_START}
          end={GROUND_END}
          style={StyleSheet.absoluteFill}
        />
        <RadarArt size={ART_SIZE} cells={cells} tone={tone} style={styles.art} />
        {/* Legibility scrim over the copy only — the footer band carries its
            own weighted fill, so stacking both would read as a black bar. */}
        <LinearGradient
          colors={gradients.scrim}
          start={SCRIM_START}
          end={SCRIM_END}
          style={[StyleSheet.absoluteFill, footer && styles.scrimAboveFooter]}
          pointerEvents="none"
        />

        {onPress ? (
          <Pressable
            style={styles.body}
            onPress={onPress}
            accessibilityRole="button"
            accessibilityLabel={accessibilityLabel}
            {...press}
          >
            {children}
          </Pressable>
        ) : (
          <View style={styles.body} accessible accessibilityLabel={accessibilityLabel}>
            {children}
          </View>
        )}

        {footer &&
          (footer.onPress ? (
            <Pressable
              style={styles.footer}
              onPress={footer.onPress}
              accessibilityRole="button"
              accessibilityLabel={footer.accessibilityLabel ?? footer.label}
              {...press}
            >
              <Ionicons name={footer.icon} size={17} color={colors.textInverse} />
              <Text style={styles.footerText} numberOfLines={1}>
                {footer.label}
              </Text>
              <Ionicons name="chevron-forward" size={18} color={colors.textInverse} />
            </Pressable>
          ) : (
            <View style={styles.footer}>
              <Ionicons name={footer.icon} size={17} color={colors.textInverse} />
              <Text style={styles.footerText} numberOfLines={1}>
                {footer.label}
              </Text>
            </View>
          ))}

        {onDismiss && (
          <Pressable
            style={styles.dismiss}
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss storm alert"
          >
            <Ionicons name="close" size={20} color={colors.textInverse} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  );
}

/** The one display number. Capped scaling so 68pt cannot break the card. */
function BigTemp({ value }: { value: number }) {
  return (
    <Text style={styles.temp} maxFontSizeMultiplier={1.2}>
      {value}
      <Text style={styles.tempUnit}>°</Text>
    </Text>
  );
}

/* ─────────────────────────── data → art / copy ───────────────────────── */

/** Even decorative spread — see the RadarArt honesty note on `angle`. */
const GOLDEN_ANGLE = 137.5;

/**
 * Radar cells for a live alert.
 *
 * With matched leads, each cell sits at that lead's TRUE distance from the
 * core (normalised against the cluster radius). Without them there is still a
 * real storm, so one cell marks the core itself. Intensity always comes from
 * the measured hail size or wind speed.
 */
function stormCells(
  alert: StormAlert,
  cluster: StormLeadCluster | null,
  leads: readonly Lead[],
): RadarCell[] {
  const intensity = alertIntensity(alert);

  if (cluster) {
    const distanceById = new Map<string, number>();
    for (const lead of leads) {
      const d = lead.lastStormMatch?.distanceMiles;
      if (typeof d === 'number' && Number.isFinite(d)) distanceById.set(lead.id, d);
    }

    const plotted: RadarCell[] = [];
    cluster.leadIds.forEach((id, i) => {
      const miles = distanceById.get(id);
      if (miles === undefined) return;
      const r = clamp(miles / Math.max(cluster.radiusMiles, 0.1), 0.12, 0.92);
      plotted.push({
        r,
        angle: (i * GOLDEN_ANGLE + 28) % 360,
        // Nearer the core reads heavier — same storm, closer hit.
        intensity: clamp(intensity * (1.1 - 0.4 * r), 0.15, 1),
      });
    });
    if (plotted.length > 0) return plotted;
  }

  return [{ r: 0.1, angle: 32, intensity }];
}

/**
 * Measured magnitude → 0–1 visual weight. Hail runs from the 0.25" validation
 * floor to 2"; wind from the 58 mph severe criterion to 90. An alert always
 * carries one of the two — the fallback is a mid weight, never a loud one.
 */
function alertIntensity(alert: StormAlert): number {
  if (typeof alert.hailSizeInches === 'number') {
    return clamp((alert.hailSizeInches - 0.25) / 1.75, 0.15, 1);
  }
  if (typeof alert.windSpeedMph === 'number') {
    return clamp((alert.windSpeedMph - 58) / 32, 0.15, 1);
  }
  return 0.4;
}

/**
 * Warning headline for an alert. Mirrors `alertTitle()` inside
 * `lib/services/stormWatch.ts` (not exported, and `lib/` is read-only in this
 * wave): any qualifying wind is severe by definition, hail earns "Severe" at
 * 0.75" and above.
 */
function stormHeadline(alert: StormAlert): string {
  if (alert.eventKind === 'wind') return 'Severe Wind Warning';
  if (alert.eventKind === 'mixed') return 'Severe Storm Warning';
  return (alert.hailSizeInches ?? 0) >= 0.75 ? 'Severe Hail Warning' : 'Hail Alert';
}

/** Only the magnitudes the alert actually carries. */
function magnitudeLine(alert: StormAlert): string {
  const parts: string[] = [];
  if (typeof alert.hailSizeInches === 'number' && alert.hailSizeInches > 0) {
    parts.push(`${alert.hailSizeInches}" hail`);
  }
  if (typeof alert.windSpeedMph === 'number' && alert.windSpeedMph > 0) {
    parts.push(`${alert.windSpeedMph} mph wind`);
  }
  return parts.join(' · ');
}

/** Wind / gust / rain — only the parts the API reported (mirrors WeatherTile). */
function conditionsLine(weather: CurrentWeather): string {
  const parts: string[] = [];
  if (weather.windMph !== undefined && weather.windMph > 0) {
    parts.push(`${weather.windMph} mph wind`);
  }
  if (weather.gustMph !== undefined && weather.gustMph > 0) {
    parts.push(`gusts ${weather.gustMph}`);
  }
  if (weather.precipChancePercent !== undefined && weather.precipChancePercent > 0) {
    parts.push(`${weather.precipChancePercent}% rain`);
  }
  return parts.join(' · ');
}

function scanLabel(areas: readonly { label: string }[]): string {
  const first = areas[0].label;
  return areas.length > 1 ? `${first} +${areas.length - 1} more` : first;
}

function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

/* ─────────────────────────── styles ──────────────────────────────────── */

const styles = StyleSheet.create({
  shell: { borderRadius: radii.xl },
  card: {
    minHeight: HERO_HEIGHT,
    borderRadius: radii.xl,
    overflow: 'hidden',
    // Painted under the gradient so the card is never briefly transparent.
    backgroundColor: brand.royalInk,
  },
  art: { position: 'absolute', top: -ART_SIZE * 0.2, right: -ART_SIZE * 0.24 },
  scrimAboveFooter: { bottom: touchTarget.standard },

  body: {
    flex: 1,
    padding: spacing.lg,
    justifyContent: 'space-between',
  },
  flagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  /** Keeps the flag clear of the 56pt dismiss target in the top-right corner. */
  flagRowInset: { paddingRight: touchTarget.standard - spacing.lg },

  alertFlag: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.sm,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    // Frost, not burnt fill: the burnt ink on near-white clears 6:1, where
    // white on burnt would land at 4.0 — under AA at flag size (Drift #1).
    backgroundColor: glass.frostFill,
  },
  alertFlagText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: brand.burntDeep,
  },

  nowChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  nowChipText: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    letterSpacing: 1.2,
    color: colors.textInverse,
  },

  safetyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
  },
  safetyChipText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, letterSpacing: 0.6 },

  readingBlock: { gap: spacing.xs },
  title: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.textInverse,
    letterSpacing: -0.2,
  },
  readingRow: { flexDirection: 'row', alignItems: 'flex-end', gap: spacing.md },
  temp: {
    fontSize: TEMP_SIZE,
    lineHeight: TEMP_SIZE,
    // Light-weight and huge — the Apple Weather contrast between a display
    // number and the small bold labels around it.
    fontWeight: fontWeight.regular,
    color: colors.textInverse,
    fontVariant: ['tabular-nums'],
  },
  tempUnit: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.regular,
    color: colors.textInverse,
  },
  readingMeta: { flex: 1, paddingBottom: spacing.sm, gap: 2 },
  metaPrimary: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },
  titleAlone: { fontSize: fontSize.titleXl },
  metaSecondary: { fontSize: fontSize.bodySm, color: colors.brandSoft },
  /** Warm secondary for the burnt hero — 5.3:1 on `stormSevere`. */
  metaSecondaryWarm: { color: colors.accentSoft },

  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    // A weighted band rather than raw art under the copy: the consequence
    // line has to stay readable in sun whatever the gradient is doing.
    backgroundColor: glass.smokeFill,
    borderTopWidth: StyleSheet.hairlineWidth * 2,
    borderTopColor: glass.smokeBorder,
  },
  footerText: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },

  dismiss: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },

  // Compact cell, weighted for the DARK hero ground it sits on in Home's
  // header block — a white card there would read as a broken hero rather
  // than a quiet line.
  compact: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    backgroundColor: glass.smokeFill,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  compactText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },
});
