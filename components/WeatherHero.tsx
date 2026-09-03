/**
 * WeatherHero — the Home screen's one cinematic moment.
 *
 * A ~224pt hero card in the onboarding's visual language (brand gradient
 * ground + a drifting aurora + the radar motif + frosted chips), sitting first
 * under the greeting. It reads its own stores and services and picks its own
 * state, so Home mounts `<WeatherHero />` and never branches.
 *
 * ── THE GOVERNING RULE ────────────────────────────────────────────────────
 * Missing data changes the TEXT, never the DESIGN. The gradient, the aurora,
 * the radar and the card's full height are DECORATION — they render in every
 * state, including the one where the app has no weather at all. What changes
 * between states is the copy layer and, honestly, only the copy layer. The
 * card never collapses to a one-line cell, and it never fabricates a
 * temperature, a storm or a count (Drift #5).
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
 *     dark, big light-weight temperature that counts up on first resolve, the
 *     condition, feels-like, and only the wind / gust / rain figures the API
 *     actually reported. A HAAG §7 roof-work safety chip appears when the
 *     forecast carried enough real readings to rate. A quiet "Storm Watch is
 *     scanning <area>" footer appears only when a service area exists. The
 *     radar runs as an ambient ring-and-sweep pattern with NO cells — there is
 *     no storm to draw, and the art is never presented as radar returns.
 *
 *  C. WEATHER UNAVAILABLE (no key / permission denied / service unreachable)
 *     The SAME full-height cinematic frame — same gradient, same aurora, same
 *     animated radar at `tone="idle"` — carrying a "Weather not available"
 *     headline, ONE honest sub-line naming the actual cause, and a 56pt route
 *     to the fix (Settings, the OS permission prompt, or a retry). No number
 *     is shown anywhere: not a dash standing in for a temperature, not a
 *     count. This is the state a keyless build sits in permanently, so it is
 *     designed as a destination, not as a failure — and it is SETTLED: no
 *     spinner, no shimmer, nothing that reads as "still loading".
 *
 *  (+ a fourth, BOUNDED state: while the location + weather round-trip is
 *   still in flight the module renders the same frame with a plain "Checking
 *   conditions" line where the reading will land. It never pends forever —
 *   a permission prompt the user walks away from used to hang here
 *   indefinitely, so the round-trip is capped at `PENDING_TIMEOUT_MS` and
 *   falls through to state C with the cause we were actually waiting on.)
 *
 * Drift #4 holds: the storm-alert TREATMENT appears only with a genuine
 * active alert. States B and C are weather modules, not alert placeholders.
 */

import { useCallback, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';
import {
  Linking,
  Platform,
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
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withSpring,
  type SharedValue,
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
import { isWeatherConfigured } from '@/lib/env';
import type { Lead, StormAlert } from '@/lib/models/types';
import { AnimatedCounter, PulseRing } from '@/components/motion';
import {
  AuroraWash,
  PrecipVeil,
  RadarArt,
  type PrecipKind,
  type RadarCell,
  type RadarTone,
} from '@/components/weather/RadarArt';
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
 * `pending` for the life of the session. Four seconds is past a normal cold
 * fetch and short of "is this broken?".
 */
const PENDING_TIMEOUT_MS = 4000;

const GROUND_START = { x: 0, y: 0 } as const;
const GROUND_END = { x: 1, y: 1 } as const;
/** The scrim only bites in the lower half, where the copy lives. */
const SCRIM_START = { x: 0, y: 0.25 } as const;
const SCRIM_END = { x: 0, y: 1 } as const;

/** Scroll range and travel for the in-card art parallax (see `scrollY`). */
const PARALLAX_IN: number[] = [-120, 0, 260];
const PARALLAX_OUT: number[] = [22, 0, -30];

/**
 * The hero's display number. Derived from the type ramp rather than typed as
 * a literal (Drift #11): the temperature is the largest thing on the screen
 * by design, two steps past `display`.
 */
const TEMP_SIZE = fontSize.display * 2;
/**
 * State C's glyph sits in the temperature's slot. The badge takes the display
 * number's footprint so the composition is identical across states; the glyph
 * inside is sized off the same ramp value rather than a literal (Drift #11).
 */
const GLYPH_BADGE = TEMP_SIZE;
const GLYPH_SIZE = Math.round(TEMP_SIZE * 0.5);

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

/**
 * Why there is no reading. Each maps to exactly ONE honest sub-line and ONE
 * route to the fix — the difference between "this app is broken" and "this
 * app is telling me what it needs".
 */
type UnavailableReason = 'no-key' | 'permission' | 'no-fix' | 'unreachable';

const UNAVAILABLE_COPY: Record<
  UnavailableReason,
  {
    cause: string;
    cta: string;
    glyph: IoniconName;
    ctaIcon: IoniconName;
    /** The fix is another attempt here, not a trip somewhere else. */
    retry: boolean;
  }
> = {
  'no-key': {
    // "No weather API key in this build" was honest but spoke developer to a
    // gloved roofer in sun (Drift #1). Same fact, the persona's register — the
    // CTA below already names the actual fix.
    cause: 'Weather isn’t set up yet',
    cta: 'Add a weather key in Settings',
    glyph: 'key-outline',
    ctaIcon: 'settings-outline',
    retry: false,
  },
  permission: {
    cause: 'Location access is off',
    cta: 'Turn on location access',
    glyph: 'location-outline',
    ctaIcon: 'navigate-outline',
    retry: false,
  },
  'no-fix': {
    cause: 'No location fix on this device yet',
    cta: 'Try again',
    glyph: 'navigate-circle-outline',
    ctaIcon: 'refresh',
    retry: true,
  },
  unreachable: {
    cause: 'The weather service did not respond',
    cta: 'Try again',
    glyph: 'cloud-offline-outline',
    ctaIcon: 'refresh',
    retry: true,
  },
};

type WeatherPhase =
  | { kind: 'pending' }
  | { kind: 'ready'; weather: CurrentWeather }
  | { kind: 'unavailable'; reason: UnavailableReason };

type Props = {
  style?: StyleProp<ViewStyle>;
  /**
   * Optional scroll offset from the host screen. When supplied, the ART layer
   * inside the card lags the card itself — a few points of differential
   * parallax, the Apple-Weather header feel. Absent (or under Reduce Motion)
   * the art simply sits still; the hero never depends on it.
   */
  scrollY?: SharedValue<number>;
};

export function WeatherHero({ style, scrollY }: Props) {
  const router = useRouter();
  const alerts = useStormAlertStore((s) => s.alerts);
  const dismissAlert = useStormAlertStore((s) => s.dismiss);
  const leads = useLeadStore((s) => s.leads);
  const areas = useServiceAreaStore((s) => s.areas);
  // A keyless build knows its answer before the first paint, so state C is the
  // FIRST thing that renders rather than a frame of "Checking conditions".
  const [phase, setPhase] = useState<WeatherPhase>(() =>
    isWeatherConfigured ? { kind: 'pending' } : { kind: 'unavailable', reason: 'no-key' },
  );
  // Which leg of the round-trip we are on, so a timeout or a thrown error can
  // name the cause it was actually blocked by instead of guessing. Each leg
  // maps to exactly one true sentence in `UNAVAILABLE_COPY`.
  const legRef = useRef<'permission' | 'fix' | 'fetch'>('permission');
  // Per-invocation token: each resolve() takes a fresh id and every await checks
  // it is still the latest, so an effect re-run (React 19 StrictMode / Fast
  // Refresh) supersedes the in-flight round trip instead of un-cancelling it.
  const runIdRef = useRef(0);

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

  const resolve = useCallback(async () => {
    const run = ++runIdRef.current;
    const stale = () => runIdRef.current !== run;
    // No weather key means no forecast is possible, and we know that before
    // any I/O. Say so immediately rather than burning the pending window —
    // and, more importantly, never prompt a roofer for location access the
    // app cannot act on.
    if (!isWeatherConfigured) {
      setPhase((p) =>
        p.kind === 'unavailable' && p.reason === 'no-key'
          ? p
          : { kind: 'unavailable', reason: 'no-key' },
      );
      return;
    }
    setPhase({ kind: 'pending' });
    legRef.current = 'permission';
    // Fall through to state C if the round-trip hasn't settled in time.
    // `setPhase` is idempotent here: whichever path lands first wins, and a
    // late-granted permission still upgrades the card when its fetch resolves.
    const timeout = setTimeout(() => {
      if (stale()) return;
      setPhase((p) => (p.kind === 'pending' ? { kind: 'unavailable', reason: legReason() } : p));
    }, PENDING_TIMEOUT_MS);

    try {
      const perm = await Location.getForegroundPermissionsAsync();
      if (stale()) return;
      if (perm.status !== 'granted') {
        const req = await Location.requestForegroundPermissionsAsync();
        if (stale()) return;
        if (req.status !== 'granted') {
          setPhase({ kind: 'unavailable', reason: 'permission' });
          return;
        }
      }
      legRef.current = 'fix';
      const pos = await Location.getCurrentPositionAsync({});
      if (stale()) return;
      legRef.current = 'fetch';
      const weather = await fetchCurrentWeather({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
      });
      if (!stale()) setPhase({ kind: 'ready', weather });
    } catch {
      // A missing key is already handled above, so anything landing here is a
      // location the device could not give us or a service that did not answer
      // — and the leg says which. Never synthesize a forecast (Drift #5).
      if (!stale()) setPhase({ kind: 'unavailable', reason: legReason() });
    } finally {
      clearTimeout(timeout);
    }

    function legReason(): UnavailableReason {
      if (legRef.current === 'permission') return 'permission';
      return legRef.current === 'fix' ? 'no-fix' : 'unreachable';
    }
  }, []);

  useEffect(() => {
    resolve();
    return () => {
      runIdRef.current += 1;
    };
  }, [resolve]);

  /** State C's fix button. Each reason gets the action that actually helps. */
  const repair = useCallback(
    async (reason: UnavailableReason) => {
      if (reason === 'no-key') {
        router.push('/settings');
        return;
      }
      if (UNAVAILABLE_COPY[reason].retry) {
        resolve();
        return;
      }
      // Permission: ask again where the OS still allows it, otherwise hand the
      // roofer to the one place that can grant it.
      const perm = await Location.getForegroundPermissionsAsync().catch(() => null);
      if (perm && perm.canAskAgain !== false) {
        resolve();
        return;
      }
      if (Platform.OS !== 'web' && typeof Linking.openSettings === 'function') {
        Linking.openSettings().catch(() => {});
      } else {
        router.push('/settings');
      }
    },
    [resolve, router],
  );

  const weather = phase.kind === 'ready' ? phase.weather : null;
  const scanning = areas.length > 0 ? scanLabel(areas) : null;

  // Every state's card body goes to the same place. The footer is where a
  // state keeps its own consequence CTA (alert cluster, repair).
  const openWeather = useCallback(() => {
    router.push('/weather' as any);
  }, [router]);

  // ── A · Active storm alert ─────────────────────────────────────────────
  if (activeAlert) {
    const headline = stormHeadline(activeAlert);
    const magnitude = magnitudeLine(activeAlert);
    const properties = activeAlert.propertyCount;
    const alertId = activeAlert.id;

    const openAlert = () =>
      router.push({ pathname: '/storm-alert/[id]', params: { id: alertId } } as any);

    // The footer keeps the alert's own consequence CTA; the card BODY opens
    // the weather page in every state (owner's ask — "the big weather image
    // should open the weather page"), which surfaces this alert again with
    // a route to its detail.
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
        scrollY={scrollY}
        ground={gradients.stormSevere}
        tone="severe"
        cells={cells}
        precip={precipVeil(weather, activeAlert)}
        footer={footer}
        onPress={openWeather}
        onDismiss={() => dismissAlert(alertId)}
        accessibilityLabel={[
          headline,
          activeAlert.areaLabel,
          magnitude,
          weather ? `${weather.temperatureF} degrees` : '',
          'Opens the weather page.',
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

    return (
      <HeroFrame
        style={style}
        scrollY={scrollY}
        ground={weather.isDaytime ? gradients.clearDay : gradients.stormNight}
        tone="calm"
        precip={precipVeil(weather)}
        footer={
          scanning
            ? { icon: 'radio-outline', label: `Storm Watch is scanning ${scanning}` }
            : null
        }
        // The whole card is the door to the weather page — hourly, 10-day,
        // NWS alerts and the §7 roof-work window all live there now.
        onPress={openWeather}
        accessibilityLabel={[
          `${weather.temperatureF} degrees`,
          weather.description,
          `feels like ${weather.feelsLikeF}`,
          conditions,
          safety ? `Roof work: ${SAFETY_RATING_LABELS[safety.rating]}.` : '',
          'Opens the weather page.',
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

  // ── C · Unavailable — the SAME hero, an honest cause, a route to the fix ─
  if (phase.kind === 'unavailable') {
    const copy = UNAVAILABLE_COPY[phase.reason];
    const reason = phase.reason;

    return (
      <HeroFrame
        style={style}
        scrollY={scrollY}
        // Night sky rather than the day blue: this state is settled and quiet,
        // and it must never be mistaken for a live reading (Drift #4).
        ground={gradients.stormNight}
        tone="idle"
        footer={{
          icon: copy.ctaIcon,
          label: copy.cta,
          // A chevron promises navigation; a retry stays right here.
          chevron: !copy.retry,
          onPress: () => {
            repair(reason);
          },
        }}
        // The footer carries the repair; the body still opens the weather
        // page, which shows the same honest "not set up" panel and the parts
        // that need no key (NWS alerts, storm history).
        onPress={openWeather}
        accessibilityLabel={[
          'Weather not available',
          copy.cause,
          scanning ? `Storm Watch is scanning ${scanning}` : '',
          'Opens the weather page.',
          copy.cta,
        ]
          .filter(Boolean)
          .join('. ')}
      >
        <View style={styles.flagRow}>
          <View style={styles.nowChip}>
            <Ionicons name="cloud-offline-outline" size={13} color={colors.textInverse} />
            <Text style={styles.nowChipText}>WEATHER</Text>
          </View>
        </View>

        <View style={styles.readingBlock}>
          <View style={styles.readingRow}>
            {/* The temperature's slot, holding a glyph instead. No number is
                shown in this state — not even a dash standing in for one. */}
            <View style={styles.glyphSlot}>
              <Ionicons name={copy.glyph} size={GLYPH_SIZE} color={colors.brandSoft} />
            </View>
            <View style={styles.readingMeta}>
              <Text style={[styles.title, styles.titleTight]} numberOfLines={2}>
                Weather not available
              </Text>
              {/* Exactly one line naming the real cause — never a generic
                  "something went wrong", never a guess. */}
              <Text style={styles.metaPrimary} numberOfLines={2}>
                {copy.cause}
              </Text>
              {/* Storm Watch runs on NOAA, which needs no key — so when a
                  service area exists this stays true even with no forecast.
                  Omitted entirely when there is no area to name. */}
              {scanning && (
                <Text style={styles.metaSecondary} numberOfLines={1}>
                  Storm Watch is scanning {scanning}
                </Text>
              )}
            </View>
          </View>
        </View>
      </HeroFrame>
    );
  }

  // ── D · Still resolving — the branded frame, no numbers ────────────────
  // Bounded by PENDING_TIMEOUT_MS above, so this can't become a permanent
  // skeleton. It carries no readings at all: the art and the gradient are the
  // card, and the copy simply says what it's doing.
  return (
    <HeroFrame
      style={style}
      scrollY={scrollY}
      ground={gradients.stormNight}
      tone="calm"
      footer={null}
      onPress={openWeather}
      accessibilityLabel="Checking current conditions. Opens the weather page."
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
  /** Chevron reads "this navigates". Off for in-place actions like a retry. */
  chevron?: boolean;
};

type FrameProps = PropsWithChildren<{
  ground: GradientStops;
  tone: RadarTone;
  cells?: readonly RadarCell[];
  precip?: { kind: PrecipKind; intensity: number } | null;
  footer: FooterSpec | null;
  onPress?: () => void;
  onDismiss?: () => void;
  accessibilityLabel: string;
  style?: StyleProp<ViewStyle>;
  scrollY?: SharedValue<number>;
}>;

/**
 * Gradient ground → aurora wash → radar art → precipitation → scrim → copy.
 *
 * Every layer above the copy is decoration and renders in every state; only
 * `cells` and `precip` are data-gated, and their callers gate them on real
 * readings. The press targets (body, footer, dismiss) are SIBLINGS rather than
 * nested pressables, and they share one spring so the whole card compresses no
 * matter which one you hit.
 */
function HeroFrame({
  ground,
  tone,
  cells,
  precip,
  footer,
  onPress,
  onDismiss,
  accessibilityLabel,
  style,
  scrollY,
  children,
}: FrameProps) {
  const reduced = useReducedMotion();
  const scale = useSharedValue(1);
  const enter = useSharedValue(reduced ? 1 : 0);

  useEffect(() => {
    enter.value = reduced ? 1 : withSpring(1, motion.gentle);
  }, [enter, reduced]);

  // Entrance spring and press spring compose into one transform so a press
  // during the entrance doesn't fight it.
  const shellStyle = useAnimatedStyle(() => ({
    opacity: enter.value,
    transform: [
      { translateY: (1 - enter.value) * spacing.md },
      { scale: scale.value * (0.96 + enter.value * 0.04) },
    ],
  }));

  // Differential parallax on the art layer only — the host screen may already
  // be moving the whole card, and two identical translations read as lag.
  const artStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY:
          scrollY && !reduced
            ? interpolate(scrollY.value, PARALLAX_IN, PARALLAX_OUT, Extrapolation.CLAMP)
            : 0,
      },
    ],
  }));

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
        {/* Drifting brand light behind the art — the onboarding sky, sized to
            this card. Decoration, so it renders in every state. */}
        <AuroraWash tone={tone} />
        <Animated.View style={[StyleSheet.absoluteFill, artStyle]} pointerEvents="none">
          <RadarArt size={ART_SIZE} cells={cells} tone={tone} style={styles.art} />
        </Animated.View>
        {precip && (
          <PrecipVeil kind={precip.kind} intensity={precip.intensity} height={HERO_HEIGHT} />
        )}
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
            {/* Tappable affordance: a frosted chevron disc in the body's
                bottom-right, clear of the copy column and of the footer band.
                Decorative — the Pressable above owns the label. */}
            <View style={styles.affordance} pointerEvents="none" accessibilityElementsHidden>
              <Ionicons name="chevron-forward" size={18} color={colors.textInverse} />
            </View>
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
              {footer.chevron !== false && (
                <Ionicons name="chevron-forward" size={18} color={colors.textInverse} />
              )}
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

/**
 * The one display number, rolling up on first resolve. Capped scaling so 68pt
 * cannot break the card; held static under Reduce Motion, where a number that
 * animates is exactly the thing the setting is asking us not to do.
 */
function BigTemp({ value }: { value: number }) {
  const reduced = useReducedMotion();
  return (
    <Text style={styles.temp} maxFontSizeMultiplier={1.2}>
      {reduced ? value : <AnimatedCounter value={value} style={styles.temp} />}
      <Text style={styles.tempUnit}>°</Text>
    </Text>
  );
}

/* ─────────────────────────── data → art / copy ───────────────────────── */

/** Even decorative spread — see the RadarArt honesty note on `angle`. */
const GOLDEN_ANGLE = 137.5;

/**
 * Should the hero show falling precipitation, and of what kind?
 *
 * Streaks are decoration, but "it is raining" is a CLAIM, so this returns null
 * unless the weather response carried a reading that says so: measurable
 * precipitation on the ground (`qpf > 0` → `precipitation_expected`) or an
 * active thunderstorm. A percentage chance alone is not precipitation, and a
 * storm ALERT alone is not either — an alert can fire hours after the storm
 * passed, and drawing hail over a clear sky would be a synthesized forecast
 * (Drift #5). The alert only chooses the KIND once real precipitation is
 * already reported: a live hail event makes those streaks hail.
 *
 * `intensity` is visual density only — never a stated number.
 */
function precipVeil(
  weather: CurrentWeather | null,
  alert?: StormAlert,
): { kind: PrecipKind; intensity: number } | null {
  if (!weather) return null;
  const measured = weather.safety.precipitation_expected === true;
  const thunder = weather.safety.thunderstorm_watch === true;
  if (!measured && !thunder) return null;

  const hailing = measured && alert !== undefined && alert.eventKind !== 'wind';
  const chance = weather.precipChancePercent;
  return {
    kind: hailing ? 'hail' : 'rain',
    intensity: chance !== undefined ? clamp(chance / 100, 0.2, 1) : 0.5,
  };
}

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
    // A glass rim. Home mounts this hero INSIDE its own `stormNight` block, so
    // on the night grounds (state C, state B after dark) the card would
    // otherwise dissolve into the block behind it and stop reading as an
    // object. The rim costs nothing on the bright grounds and saves the dark.
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.borderStrong,
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
  /**
   * The temperature's footprint, holding state C's glyph instead — a frosted
   * disc so the slot reads as a composed element rather than as the hole
   * where a number failed to load.
   */
  glyphSlot: {
    width: GLYPH_BADGE,
    height: GLYPH_BADGE,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  // Trailing pad keeps the meta column clear of the chevron affordance.
  readingMeta: { flex: 1, paddingBottom: spacing.sm, paddingRight: spacing.xxxl, gap: 2 },
  affordance: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 32,
    height: 32,
    borderRadius: radii.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: glass.smokeFill,
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.smokeBorder,
  },
  metaPrimary: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },
  titleAlone: { fontSize: fontSize.titleXl },
  /** Headline sitting inside the meta column — tighter than the display slot. */
  titleTight: { fontSize: fontSize.titleMd, marginBottom: spacing.xs },
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
});
