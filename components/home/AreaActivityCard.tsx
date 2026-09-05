// Area Activity — the live storm map on Home.
//
// The owner's ask, verbatim: "a google map that has functionaity for storm
// data tracking". The card this replaces was gated on having geocoded leads,
// so a brand-new user (and every build without keys) never saw a map at all.
//
// THE RULE THIS FILE IS BUILT AROUND: missing data changes the TEXT, never
// the DESIGN. This card always renders its full designed frame — 200pt of
// map, the segmented control, the honest status rows — and swaps only the
// words when something is unavailable. It never fabricates a storm, a pin or
// a count (Drift #5), and it never collapses to a one-liner.
//
// The three states from the spec, all inside that frame:
//   a) No Google Maps key      -> real storm/lead data plotted over a branded
//                                 gradient ground with NO tiles, plus one
//                                 honest row routing to Settings. NOAA needs
//                                 no key, so the DATA still shows.
//   b) Key but no service area -> neutral wide view + "Set your service area"
//                                 routing to Settings. We do NOT fetch: TX
//                                 storms shown to an Ohio contractor is real
//                                 data in the wrong place, which reads as
//                                 correct and is worse than an error
//                                 (see lib/services/serviceState.ts).
//   c) Key + area + no storms  -> the map + "No qualifying storms in the last
//                                 3 years" — a true statement, not a void.
//   d) Key + area + NOAA down  -> the map + "NOAA storm history isn't
//                                 reachable" with a retry — distinct from (c).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, {
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { Map as AreaMap, MapPin, type Region } from '@/components/map/Map';
import { GlassCard } from '@/components/glass/GlassCard';
import { Aurora } from '@/components/glass/Aurora';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { FOCUS_STORM_LEADS } from '@/app/(tabs)/map';
import { env } from '@/lib/env';
import { magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { resolveServiceCenter, stateFromText } from '@/lib/services/serviceState';
import {
  clampLookbackYears,
  fetchAddressStormHistory,
  HISTORY_LOOKBACK_YEARS_DEFAULT,
  type StormHistoryResult,
} from '@/lib/services/stormMatch';
import {
  leadsInStormCluster,
  matchLeadsToStorm,
  pickStormCore,
  summarizeStormLeadCluster,
  LEAD_CLUSTER_RADIUS_MILES,
  STORM_HISTORY_BROWSE_RADIUS_MILES,
  type StormLeadCluster,
} from '@/lib/services/stormWatch';
import { isValidLatLon } from '@/lib/services/stormCluster';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import type { Lead } from '@/lib/models/types';
import {
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
} from '@/theme/tokens';

// -----------------------------------------------------------------------------
// Constants
// -----------------------------------------------------------------------------

type Layer = 'leads' | 'storms';

const LAYER_OPTIONS: readonly { id: Layer; label: string }[] = [
  { id: 'leads', label: 'Leads' },
  { id: 'storms', label: 'Storms' },
];

/** Stable identity so `stormEvents` doesn't change on every render. */
const EMPTY_EVENTS: StormEvent[] = [];

/** Card map height, per the reference dashboard. */
const MAP_HEIGHT = 200;

/**
 * Storm pins drawn on a real basemap at once — the same cap the Map tab uses
 * (app/(tabs)/map.tsx MAX_STORM_PINS). The count row always reports the real
 * total alongside what was actually drawn.
 */
const MAX_STORM_PINS = 300;

/**
 * Lower cap when we're plotting into plain Views over the keyless ground:
 * each pin is a real view inside a 200pt card, so 300 of them is a scroll-jank
 * bill Home shouldn't pay. The count row reports this number honestly too.
 */
const PLOT_PIN_CAP = 120;

/** A storm fetch that hasn't answered by now falls through to the honest
 *  "not reachable" row rather than spinning forever. */
const STORM_FETCH_TIMEOUT_MS = 12_000;

/**
 * Severity BANDING for pin colour only — mirrors the private
 * SEVERE_HAIL_INCHES in lib/services/stormWatch.ts, which is likewise a copy
 * threshold ("Severe Hail Warning" vs "Hail Alert"). It is NOT a validation
 * floor (that's HAIL_VALIDATION_FLOOR_INCHES = 0.25", already enforced inside
 * fetchAddressStormHistory) and NOT a HAAG damage threshold
 * (docs/HAAG_DECISION_ENGINE.md owns those).
 */
const SEVERE_HAIL_INCHES = 0.75;

/** Minimum plotted span so a single point doesn't project to infinite zoom. */
const MIN_SPAN_DEG = 0.08;

/** Keeps plotted pins clear of the frame's rounded edges. */
const PLOT_INSET = spacing.xxl;

const SEG_PAD = spacing.xs;

/** Wide, state-scale region when we have nothing better to centre on. */
const WIDE_DELTA = 4;
/** Market-scale region around a known centroid (~60 mi across). */
const MARKET_DELTA = 0.9;

/**
 * Can this platform actually draw basemap tiles?
 *
 * Only the TILES are gated by a key — NOAA storm history is keyless, which is
 * why state (a) still shows real data. Expo Go on iOS falls back to Apple
 * Maps (see components/map/Map.tsx), which needs no key of ours.
 */
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const HAS_BASEMAP_TILES =
  Platform.OS === 'web'
    ? env.GOOGLE_MAPS_WEB_KEY.length > 0
    : Platform.OS === 'android'
    ? env.GOOGLE_MAPS_ANDROID_KEY.length > 0
    : inExpoGo || env.GOOGLE_MAPS_IOS_KEY.length > 0;

// -----------------------------------------------------------------------------
// Pin colour
// -----------------------------------------------------------------------------

/** Pin tones the Map abstraction understands, paired with their token hue so
 *  the tiled map and the keyless plot draw the same colour. */
type PinTone = 'info' | 'warn' | 'orange' | 'success' | 'cream' | 'danger';

const TONE_COLOR: Record<PinTone, string> = {
  info: colors.info,
  warn: colors.warn,
  orange: colors.orange,
  success: colors.success,
  cream: colors.cream,
  danger: colors.danger,
};

/** Storm pins ride the semantic storm tokens, not raw per-magnitude hex
 *  (Drift #11). Any qualifying wind already cleared the NWS severe criterion,
 *  so wind reads as wind rather than being re-banded. */
function stormColor(e: StormEvent): string {
  if (e.type === 'hail') {
    return (e.magnitude ?? 0) >= SEVERE_HAIL_INCHES ? colors.stormSevere : colors.stormHail;
  }
  return colors.stormWind;
}

/** Lead pins toned by pipeline stage; a lead carrying a NOAA storm match is
 *  highlighted in the severe-storm hue — the same read the Map tab gives a
 *  lead sitting inside a storm core. */
function leadTone(lead: Lead): PinTone {
  if (lead.lastStormMatch) return 'danger';
  switch (lead.stage) {
    case 'new':
      return 'info';
    case 'contacted':
    case 'inspection_scheduled':
    case 'inspected':
      return 'warn';
    case 'proposal_sent':
    case 'estimate_sent':
      return 'orange';
    case 'signed':
    case 'install_scheduled':
    case 'in_progress':
    case 'completed':
    case 'invoiced':
    case 'paid':
      return 'success';
    case 'lost':
      return 'cream';
    default:
      return 'info';
  }
}

// -----------------------------------------------------------------------------
// Geometry
// -----------------------------------------------------------------------------

type GeoPoint = {
  key: string;
  lat: number;
  lon: number;
  color: string;
  /** Storm-matched leads get the highlighted ring treatment. */
  highlighted?: boolean;
  size: number;
};

type PlottedPoint = GeoPoint & { x: number; y: number };

function regionFor(
  points: readonly { lat: number; lon: number }[],
  fallback: { lat: number; lon: number; delta: number },
): Region {
  if (points.length === 0) {
    return {
      latitude: fallback.lat,
      longitude: fallback.lon,
      latitudeDelta: fallback.delta,
      longitudeDelta: fallback.delta,
    };
  }
  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLon = Math.min(...lons);
  const maxLon = Math.max(...lons);
  return {
    latitude: (minLat + maxLat) / 2,
    longitude: (minLon + maxLon) / 2,
    latitudeDelta: Math.max(MIN_SPAN_DEG, (maxLat - minLat) * 1.6),
    longitudeDelta: Math.max(MIN_SPAN_DEG, (maxLon - minLon) * 1.6),
  };
}

/**
 * Equirectangular projection with a cosine correction at the centre latitude —
 * plenty for a 200pt card covering tens of miles, and it keeps the keyless
 * ground honest: every dot sits where its real coordinate says it sits.
 */
function projectPoints(points: readonly GeoPoint[], w: number, h: number): PlottedPoint[] {
  if (w <= 0 || points.length === 0) return [];

  const lats = points.map((p) => p.lat);
  const lons = points.map((p) => p.lon);
  const midLat = (Math.min(...lats) + Math.max(...lats)) / 2;
  const midLon = (Math.min(...lons) + Math.max(...lons)) / 2;
  const k = Math.cos((midLat * Math.PI) / 180) || 1;

  const spanLat = Math.max(Math.max(...lats) - Math.min(...lats), MIN_SPAN_DEG);
  const spanLon = Math.max((Math.max(...lons) - Math.min(...lons)) * k, MIN_SPAN_DEG);

  const innerW = Math.max(1, w - PLOT_INSET * 2);
  const innerH = Math.max(1, h - PLOT_INSET * 2);
  const scale = Math.min(innerW / spanLon, innerH / spanLat);

  return points.map((p) => ({
    ...p,
    x: PLOT_INSET + innerW / 2 + (p.lon - midLon) * k * scale,
    y: PLOT_INSET + innerH / 2 - (p.lat - midLat) * scale,
  }));
}

// -----------------------------------------------------------------------------
// Keyless ground — the designed frame with no tiles in it
// -----------------------------------------------------------------------------

/** Soft light band that drifts across the plotted ground, so the module reads
 *  as a live instrument rather than a static error card. Token stops only. */
const SWEEP_STOPS = [glass.fillLow, glass.fillHigh, glass.fillLow] as const;

function ScanSweep({ width }: { width: number }) {
  const t = useSharedValue(0);
  const band = Math.max(1, width * 0.55);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: motion.ambientMs, easing: Easing.inOut(Easing.sin) }),
      -1,
      false,
    );
  }, [t]);

  const style = useAnimatedStyle(() => ({
    transform: [{ translateX: -band + t.value * (width + band) }],
  }));

  return (
    <Animated.View pointerEvents="none" style={[styles.sweep, { width: band }, style]}>
      <LinearGradient
        colors={SWEEP_STOPS}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 0 }}
        style={StyleSheet.absoluteFill}
      />
    </Animated.View>
  );
}

const GRID_H = [0.25, 0.5, 0.75];
const GRID_V = [0.2, 0.4, 0.6, 0.8];
const RINGS = [0.46, 0.78];

/**
 * The no-tiles ground: brand gradient, drifting aurora, a graticule and range
 * rings, with the REAL points plotted on top. Same height, same corner, same
 * structure as the tiled map — only the basemap is missing, and the status row
 * underneath says exactly that.
 */
function PlottedGround({
  points,
  width,
  reduced,
}: {
  points: readonly GeoPoint[];
  width: number;
  reduced: boolean;
}) {
  const plotted = useMemo(() => projectPoints(points, width, MAP_HEIGHT), [points, width]);
  const cx = width / 2;
  const cy = MAP_HEIGHT / 2;

  return (
    <View style={StyleSheet.absoluteFill}>
      <LinearGradient
        colors={gradients.stormNight}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      {!reduced && <Aurora transparent />}

      {/* Graticule + range rings — the map-ness of a map, with no tiles to
          borrow it from. */}
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        {GRID_H.map((f) => (
          <View key={`h${f}`} style={[styles.gridLineH, { top: MAP_HEIGHT * f }]} />
        ))}
        {width > 0 &&
          GRID_V.map((f) => (
            <View key={`v${f}`} style={[styles.gridLineV, { left: width * f }]} />
          ))}
        {width > 0 &&
          RINGS.map((f) => {
            const d = MAP_HEIGHT * f;
            return (
              <View
                key={`r${f}`}
                style={[
                  styles.ring,
                  { width: d, height: d, borderRadius: d / 2, left: cx - d / 2, top: cy - d / 2 },
                ]}
              />
            );
          })}
      </View>

      {!reduced && width > 0 && <ScanSweep width={width} />}

      {plotted.map((p) => (
        <View
          key={p.key}
          pointerEvents="none"
          style={[
            styles.plotDot,
            {
              width: p.size,
              height: p.size,
              borderRadius: p.size / 2,
              left: p.x - p.size / 2,
              top: p.y - p.size / 2,
              backgroundColor: p.color,
            },
            p.highlighted && styles.plotDotHighlighted,
          ]}
        />
      ))}
    </View>
  );
}

// -----------------------------------------------------------------------------
// Segmented control — the app's existing iOS-17 language (leads.tsx, plan.tsx,
// hail-tracer.tsx): fillQuiet track, white thumb on the snappy spring, and a
// 56pt PRESSABLE (not merely a 56pt wrapper) so a gloved thumb always lands on
// every platform (Drift #1) — see the `segTrack` / `segBtn` note below.
// -----------------------------------------------------------------------------

function Segmented({
  options,
  value,
  onChange,
  reduced,
}: {
  options: readonly { id: Layer; label: string }[];
  value: Layer;
  onChange: (v: Layer) => void;
  reduced: boolean;
}) {
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(
    0,
    options.findIndex((o) => o.id === value),
  );
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / options.length : 0;
  const x = useSharedValue(0);
  const laidOut = useRef(false);

  useEffect(() => {
    if (segW <= 0) return;
    // First layout — and every move under Reduce Motion — places the thumb
    // without animating.
    if (!laidOut.current || reduced) {
      laidOut.current = true;
      x.value = idx * segW;
      return;
    }
    x.value = withSpring(idx * segW, motion.snappy);
  }, [idx, segW, x, reduced]);

  const thumbStyle = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }));

  return (
    <View style={styles.segWrap}>
      <View style={styles.segTrack} onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}>
        {segW > 0 && <Animated.View style={[styles.segThumb, { width: segW }, thumbStyle]} />}
        {options.map((o) => (
          <PressableScale
            key={o.id}
            style={styles.segBtn}
            accessibilityRole="button"
            accessibilityState={{ selected: value === o.id }}
            accessibilityLabel={`Show ${o.label}`}
            onPress={() => onChange(o.id)}
          >
            <Text style={[styles.segLabel, value === o.id && styles.segLabelActive]}>
              {o.label}
            </Text>
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

// -----------------------------------------------------------------------------
// Status rows — the honest text layer
// -----------------------------------------------------------------------------

type StatusRow = {
  key: string;
  icon: IoniconName;
  text: string;
  /** Present when there is a real route to fixing what's missing. */
  onPress?: () => void;
  actionLabel?: string;
};

/** Never claims to have drawn more pins than it drew. */
function stormCountLine(total: number, shown: number, years: number): string {
  const scope = `within ${STORM_HISTORY_BROWSE_RADIUS_MILES} mi`;
  if (total === 0) return `No qualifying storms in the last ${years} years ${scope}`;
  if (shown < total) {
    return `Showing ${shown} of ${total} storm events · past ${years} yr ${scope}`;
  }
  return `${total} storm event${total === 1 ? '' : 's'} · past ${years} yr ${scope}`;
}

// -----------------------------------------------------------------------------
// Card
// -----------------------------------------------------------------------------

type StormState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; events: StormEvent[]; lookbackYears: number }
  | { status: 'unavailable' };

/**
 * Last answer, module-scoped. Home remounts under expo-router's Slot every
 * time the user comes back to the tab; without this, every visit would re-hit
 * NOAA over cellular and flash the "Checking…" row over a count we already
 * had. Cached results seed the first render, and anything older than
 * STORM_CACHE_TTL_MS is refreshed quietly underneath what's already drawn.
 * No store, no persistence — session memory only.
 */
let stormCache: { key: string; at: number; state: StormState } | null = null;
const STORM_CACHE_TTL_MS = 15 * 60 * 1000;

export function AreaActivityCard() {
  const router = useRouter();
  const reduced = useReducedMotion();

  const leads = useLeadStore((s) => s.leads);
  const areas = useServiceAreaStore((s) => s.areas);
  const inspections = useInspectionStore((s) => s.inspections);
  const alerts = useStormAlertStore((s) => s.alerts);

  // Storms first: it's the layer that works with zero user data (NOAA is
  // keyless) and it's the thing the owner actually asked for. Component state
  // only — no new store.
  const [layer, setLayer] = useState<Layer>('storms');
  const [retryTick, setRetryTick] = useState(0);
  const [plotW, setPlotW] = useState(0);

  /**
   * Have basemap tiles actually painted?
   *
   * Having a key is not the same as having a map. When the tiles can't be
   * fetched — no signal on a roof, a referrer-restricted key, a blocked
   * host — the Map abstraction falls back to its own SCREEN-scale panel
   * ("Map isn't available right now" + two lines of body). That panel is
   * right for the Map tab and wrong here: at 200pt its headline overflows
   * the frame and lands under this card's own status row and CTA, so the
   * module reads as broken — the exact complaint this card exists to fix.
   *
   * So the card keeps its own ground. `PlottedGround` (the designed
   * no-tiles state, with the REAL pins on it) is the base layer, and the
   * tiled map fades in over it only once it reports ready. Tiles that never
   * arrive simply leave the branded ground in place — a settled state, not
   * an error card, and never a fabricated pin either way.
   */
  const [tilesReady, setTilesReady] = useState(false);
  const onTilesReady = useCallback(() => setTilesReady(true), []);
  const tileFade = useSharedValue(0);
  useEffect(() => {
    tileFade.value = tilesReady
      ? withTiming(1, { duration: reduced ? 0 : motion.enterMs })
      : 0;
  }, [tilesReady, reduced, tileFade]);
  const tileStyle = useAnimatedStyle(() => ({ opacity: tileFade.value }));

  // ---------------------------------------------------------------------------
  // Where are we?
  // ---------------------------------------------------------------------------

  /**
   * True when the user has told us where they work — a service-area label
   * carrying a state, or an inspection address we can read one out of. Without
   * it `resolveServiceCenter()` falls back to the launch market, and querying
   * that would show a contractor another state's storms: real data in the
   * wrong place (lib/services/serviceState.ts). So we don't query at all.
   */
  const anchored = useMemo(
    () =>
      areas.some((a) => stateFromText(a.label) != null) ||
      inspections.some((i) => stateFromText(i.address) != null),
    [areas, inspections],
  );

  const serviceCenter = useMemo(
    () => resolveServiceCenter(),
    // Recompute when the inputs that feed resolution change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas, inspections],
  );

  /** Prefer a geocoded service-area centroid; fall back to the state centre. */
  const anchor = useMemo(() => {
    const area = areas.find(
      (a) =>
        typeof a.centroidLat === 'number' &&
        typeof a.centroidLng === 'number' &&
        Number.isFinite(a.centroidLat) &&
        Number.isFinite(a.centroidLng),
    );
    if (area) {
      return {
        lat: area.centroidLat as number,
        lon: area.centroidLng as number,
        delta: MARKET_DELTA,
      };
    }
    return { lat: serviceCenter.lat, lon: serviceCenter.lon, delta: WIDE_DELTA };
  }, [areas, serviceCenter]);

  // ---------------------------------------------------------------------------
  // Storm history — cancel-safe, bounded, fetched once per market
  // ---------------------------------------------------------------------------

  // 3-year default (36 months, hail + wind) rather than the 4-year ceiling:
  // with the per-point IEM service this is ~1 MB, inside STORM_FETCH_TIMEOUT_MS
  // on cellular. The old 4-year statewide pull tripped the 12 s bound.
  const lookbackYears = clampLookbackYears(HISTORY_LOOKBACK_YEARS_DEFAULT);
  const fetchKey = `${serviceCenter.state}|${anchor.lat.toFixed(3)}|${anchor.lon.toFixed(
    3,
  )}|${retryTick}`;

  // Seed from the session cache only when it belongs to THIS market — a cached
  // answer for another state must never paint here, even for a frame.
  const [storms, setStorms] = useState<StormState>(() =>
    stormCache?.key === fetchKey ? stormCache.state : { status: 'idle' },
  );
  const fetchedKeyRef = useRef<string | null>(null);

  // Deliberately NOT keyed on `layer`: the fetch runs once per market and both
  // layers read the result (the Leads layer uses it for the storm-match
  // insight), so toggling the segmented control can neither refetch nor strand
  // an in-flight request in a permanent "loading" row.
  useEffect(() => {
    if (!anchored) return;
    if (fetchedKeyRef.current === fetchKey) return;

    const cached = stormCache?.key === fetchKey ? stormCache : null;
    if (cached && Date.now() - cached.at < STORM_CACHE_TTL_MS) {
      fetchedKeyRef.current = fetchKey;
      setStorms(cached.state);
      return;
    }
    fetchedKeyRef.current = fetchKey;

    let cancelled = false;
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // A stale-but-real answer keeps showing while the refresh runs; only a
    // cold start gets the "Checking…" row.
    setStorms((prev) => (prev.status === 'ok' ? prev : { status: 'loading' }));

    // Bounded: a hung request resolves into the honest "not reachable" row
    // instead of leaving a spinner that reads as "still loading" forever.
    const bound = new Promise<StormHistoryResult>((resolve) => {
      timer = setTimeout(
        () => resolve({ status: 'unavailable', reason: 'Storm history timed out' }),
        STORM_FETCH_TIMEOUT_MS,
      );
    });

    Promise.race([
      fetchAddressStormHistory({
        lat: anchor.lat,
        lng: anchor.lon,
        state: serviceCenter.state,
        lookbackYears,
        radiusMiles: STORM_HISTORY_BROWSE_RADIUS_MILES,
      }),
      bound,
    ])
      .then((res) => {
        const next: StormState =
          res.status === 'ok'
            ? { status: 'ok', events: res.events, lookbackYears: res.lookbackYears }
            : { status: 'unavailable' };
        // Cache the answer even if this instance went away — the next mount
        // still benefits. A failure is cached too, so a dead network doesn't
        // retry on a loop; the row offers an explicit retry.
        stormCache = { key: fetchKey, at: Date.now(), state: next };
        if (!cancelled) setStorms(next);
      })
      .catch(() => {
        const next: StormState = { status: 'unavailable' };
        stormCache = { key: fetchKey, at: Date.now(), state: next };
        if (!cancelled) setStorms(next);
      })
      .finally(() => {
        settled = true;
        if (timer) clearTimeout(timer);
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Re-run-safe (React 19 StrictMode / Fast Refresh): if this run was
      // cancelled before its request settled, release the once-per-market
      // guard so the next run refetches instead of stranding the row on
      // "Checking…" while the cancelled promise's result is dropped.
      if (!settled) fetchedKeyRef.current = null;
    };
  }, [anchored, fetchKey, anchor.lat, anchor.lon, serviceCenter.state, lookbackYears]);

  const retry = useCallback(() => {
    fetchedKeyRef.current = null;
    setRetryTick((t) => t + 1);
  }, []);

  // ---------------------------------------------------------------------------
  // Data
  // ---------------------------------------------------------------------------

  const stormEvents = storms.status === 'ok' ? storms.events : EMPTY_EVENTS;

  const leadPins = useMemo(
    () =>
      leads.filter(
        (l) =>
          typeof l.lat === 'number' &&
          typeof l.lng === 'number' &&
          Number.isFinite(l.lat) &&
          Number.isFinite(l.lng),
      ),
    [leads],
  );

  // Which surface is actually drawing decides the cap — and the count row
  // reports whichever number really got drawn, in both phases.
  const groundShowing = !HAS_BASEMAP_TILES || !tilesReady;
  const pinCap = groundShowing ? PLOT_PIN_CAP : MAX_STORM_PINS;
  const stormPins = useMemo(
    () => stormEvents.filter((event) => isValidLatLon(event.lat, event.lon)).slice(0, pinCap),
    [stormEvents, pinCap],
  );

  /**
   * The floating insight — a REAL matchLeadsToStorm result, never a
   * placeholder. Two genuine sources, in order:
   *   1. a live alert's cluster, re-derived from the leads Storm Watch stamped
   *      (the same call Home and the Map tab already make), and
   *   2. otherwise the strongest core in the NOAA history we just fetched,
   *      matched against the lead book here.
   * Both return null on zero matches, and null means the overlay is absent
   * entirely (Drift #5).
   */
  const activeAlert = useMemo(() => alerts.find((a) => a.status === 'new'), [alerts]);
  const insight = useMemo<{ cluster: StormLeadCluster; label: string } | null>(() => {
    if (activeAlert) {
      const live = leadsInStormCluster(leads, activeAlert);
      // A live alert fired today, so the headline's bare "Apr 18" is this year
      // and needs no qualifier.
      if (live) return { cluster: live, label: 'STORM MATCH' };
    }
    const core = pickStormCore(stormEvents);
    if (!core) return null;
    const matches = matchLeadsToStorm(leads, core, LEAD_CLUSTER_RADIUS_MILES, {
      matchedAt: core.occurredAt,
    });
    const summary = summarizeStormLeadCluster(matches, {
      eventKind: core.type,
      radiusMiles: LEAD_CLUSTER_RADIUS_MILES,
    });
    if (!summary) return null;
    // `clusterHeadline` was written for a live alert, so it dates the core as
    // "the Apr 18 hail core" with no year. THIS core comes out of a 4-year
    // lookback, where a 2023 storm would read as three weeks ago. Name the
    // year whenever it isn't the current one — the date has to be as true as
    // the count (Drift #5).
    const ms = Date.parse(core.occurredAt);
    const year = Number.isFinite(ms) ? new Date(ms).getFullYear() : null;
    return {
      cluster: summary,
      label:
        year !== null && year !== new Date().getFullYear()
          ? `STORM MATCH · ${year}`
          : 'STORM MATCH',
    };
  }, [activeAlert, leads, stormEvents]);
  const cluster = insight?.cluster ?? null;

  const clusterLeadIds = useMemo(() => new Set(cluster?.leadIds ?? []), [cluster]);

  /** Points for the keyless ground — the same data the tiled map would draw. */
  const plotPoints = useMemo<GeoPoint[]>(() => {
    if (layer === 'storms') {
      return stormPins.map((e) => ({
        key: e.id,
        lat: e.lat,
        lon: e.lon,
        color: stormColor(e),
        size: 9,
      }));
    }
    return leadPins.slice(0, PLOT_PIN_CAP).map((l) => ({
      key: l.id,
      lat: l.lat as number,
      lon: l.lng as number,
      color: TONE_COLOR[leadTone(l)],
      highlighted: Boolean(l.lastStormMatch) || clusterLeadIds.has(l.id),
      size: 11,
    }));
  }, [layer, stormPins, leadPins, clusterLeadIds]);

  const region = useMemo(
    () =>
      regionFor(
        layer === 'leads'
          ? leadPins.map((l) => ({ lat: l.lat as number, lon: l.lng as number }))
          : stormPins.map((e) => ({ lat: e.lat, lon: e.lon })),
        anchor,
      ),
    [layer, leadPins, stormPins, anchor],
  );

  // ---------------------------------------------------------------------------
  // The honest text layer
  // ---------------------------------------------------------------------------

  const rows = useMemo<StatusRow[]>(() => {
    const out: StatusRow[] = [];

    if (layer === 'storms') {
      if (!anchored) {
        out.push({
          key: 'area',
          icon: 'location-outline',
          // A saved area that carries no state code resolves no market, so the
          // "set your service area" line would be a lie to someone who already
          // did. Say the true thing instead: it's the state we can't read.
          text:
            areas.length > 0
              ? 'Add a state to your service area so Storm Watch can scan it'
              : 'Set your service area so Storm Watch can scan it',
          actionLabel: 'Open your service area in Settings',
          onPress: () => router.push('/settings/service-area' as any),
        });
      } else if (storms.status === 'loading' || storms.status === 'idle') {
        out.push({
          key: 'loading',
          icon: 'cloud-download-outline',
          text: `Checking NOAA storm reports for ${serviceCenter.state}…`,
        });
      } else if (storms.status === 'unavailable') {
        out.push({
          key: 'unavailable',
          icon: 'cloud-offline-outline',
          text: 'NOAA storm history isn’t reachable right now',
          actionLabel: 'Retry the NOAA storm history request',
          onPress: retry,
        });
      } else {
        out.push({
          key: 'count',
          icon: 'thunderstorm-outline',
          text: stormCountLine(stormEvents.length, stormPins.length, storms.lookbackYears),
        });
      }
    } else if (leadPins.length === 0) {
      out.push({
        key: 'leads-empty',
        icon: 'person-add-outline',
        text:
          leads.length > 0
            ? `0 of ${leads.length} leads mapped — add addresses to place them`
            : 'No leads yet — add one and it lands on this map',
        actionLabel: leads.length > 0 ? 'Open Leads' : 'Add a lead',
        onPress: () => router.push((leads.length > 0 ? '/(tabs)/leads' : '/new-lead') as any),
      });
    } else {
      out.push({
        key: 'leads-count',
        icon: 'people-outline',
        text: `${leadPins.length} of ${leads.length} lead${leads.length === 1 ? '' : 's'} mapped`,
      });
    }

    // State (a): the data above is real and already drawn — only the tiles are
    // missing, and this row says so and routes to the fix.
    if (!HAS_BASEMAP_TILES) {
      out.push({
        key: 'basemap',
        icon: 'map-outline',
        text: 'Add a Google Maps key in Settings to see the basemap',
        actionLabel: 'Open Settings to add a Google Maps key',
        onPress: () => router.push('/settings' as any),
      });
    }

    return out;
  }, [
    layer,
    anchored,
    areas.length,
    storms,
    stormEvents.length,
    stormPins.length,
    leadPins.length,
    leads.length,
    serviceCenter.state,
    retry,
    router,
  ]);

  /**
   * The frame's own invitation.
   *
   * Both empty grounds are honest but PASSIVE: the storms layer draws nothing
   * until a market can be resolved, and the leads layer draws nothing until a
   * lead is geocoded. The status row underneath already names the fix, but
   * nothing on the 200pt body itself does — so the owner's headline module
   * opens on an empty ground and the user has no reason to know a Settings
   * trip would fill it. This puts the same real route on the map.
   *
   * Fabricates nothing: it is a label and a link, never a pin or a count, and
   * it only ever appears when there is genuinely nothing plotted. It yields to
   * the insight overlay so the two never stack.
   */
  const emptyCta = useMemo<{
    label: string;
    icon: IoniconName;
    a11y: string;
    onPress: () => void;
  } | null>(() => {
    if (plotPoints.length > 0) return null;
    if (layer === 'storms') {
      if (anchored) return null; // "checking", "unreachable" and a true zero own their rows.
      return {
        label: areas.length > 0 ? 'Add a state to your area' : 'Set your service area',
        icon: 'location-outline',
        a11y: 'Set your service area so Storm Watch can scan it. Opens Settings.',
        onPress: () => router.push('/settings/service-area' as any),
      };
    }
    return {
      label: leads.length > 0 ? 'Add lead addresses' : 'Add your first lead',
      icon: leads.length > 0 ? 'location-outline' : 'person-add-outline',
      a11y:
        leads.length > 0
          ? 'Add addresses to your leads so they land on this map. Opens Leads.'
          : 'Add your first lead and it lands on this map.',
      onPress: () => router.push((leads.length > 0 ? '/(tabs)/leads' : '/new-lead') as any),
    };
  }, [plotPoints.length, layer, anchored, areas.length, leads.length, router]);

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------

  /**
   * Deep-link to the Map tab on the layer the card is showing. The Map tab's
   * own default filter is `storms`, and FOCUS_STORM_LEADS is its published
   * contract for "land on Leads with the storm-matched pins highlighted" — so
   * both layers map straight onto it with no change to that screen.
   */
  const openMap = useCallback(() => {
    router.push(
      layer === 'leads'
        ? ({ pathname: '/(tabs)/map', params: { focus: FOCUS_STORM_LEADS } } as any)
        : ('/(tabs)/map' as any),
    );
  }, [router, layer]);

  const openMatchedLeads = useCallback(() => {
    router.push({ pathname: '/(tabs)/map', params: { focus: FOCUS_STORM_LEADS } } as any);
  }, [router]);

  const mapA11y = `Area activity, ${
    layer === 'storms' ? 'storm' : 'lead'
  } layer. ${rows[0]?.text ?? ''}. Opens the map.`;

  return (
    <View>
      <SectionHeader
        title="Area Activity"
        action={{ label: 'Open map', onPress: openMap }}
        style={styles.header}
      />

      <View style={styles.cardShadow}>
        <View style={styles.card}>
          <View style={styles.controlRow}>
            <Segmented
              options={LAYER_OPTIONS}
              value={layer}
              onChange={setLayer}
              reduced={reduced}
            />
          </View>

          {/* The map body owns one tap target for the whole 200pt frame. The
              insight overlay is a SIBLING inside this slot, not a nested
              pressable. */}
          <View style={styles.mapSlot}>
            <PressableScale
              style={styles.mapBody}
              accessibilityRole="button"
              accessibilityLabel={mapA11y}
              onPress={openMap}
              onLayout={(e) => setPlotW(e.nativeEvent.layout.width)}
            >
              {/* The designed ground is the BASE: it holds the frame while
                  tiles load, and holds it for good if they never come. */}
              {(!HAS_BASEMAP_TILES || !tilesReady) && (
                <PlottedGround points={plotPoints} width={plotW} reduced={reduced} />
              )}

              {HAS_BASEMAP_TILES && (
                // Decorative preview — the card's own onPress owns the tap, so
                // the map never fights the parent scroll.
                <Animated.View
                  pointerEvents="none"
                  style={[StyleSheet.absoluteFill, tileStyle]}
                >
                  <AreaMap
                    region={region}
                    showsUserLocation={false}
                    showsCompass={false}
                    onMapReady={onTilesReady}
                    style={StyleSheet.absoluteFill}
                  >
                    {layer === 'storms'
                      ? stormPins.map((e) => (
                          <MapPin
                            key={e.id}
                            coordinate={{ latitude: e.lat, longitude: e.lon }}
                            title={`${e.type === 'hail' ? 'Hail' : 'Wind'} · ${magnitudeLabel(e)}`}
                            pinColor={stormColor(e)}
                          />
                        ))
                      : leadPins.map((l) => (
                          <MapPin
                            key={l.id}
                            coordinate={{
                              latitude: l.lat as number,
                              longitude: l.lng as number,
                            }}
                            title={l.customerName}
                            tone={leadTone(l)}
                          />
                        ))}
                  </AreaMap>
                </Animated.View>
              )}
            </PressableScale>

            {/* Nothing to plot yet — put the fix on the map, not only in the
                row beneath it. `box-none` so the rest of the frame still
                belongs to the map's own tap target. */}
            {!insight && emptyCta && (
              <View pointerEvents="box-none" style={styles.emptyOverlay}>
                <PressableScale
                  style={styles.emptyCtaWrap}
                  accessibilityRole="button"
                  accessibilityLabel={emptyCta.a11y}
                  onPress={emptyCta.onPress}
                >
                  <GlassCard onArt onLight radius={radii.pill} style={styles.emptyCta}>
                    <Ionicons name={emptyCta.icon} size={18} color={colors.brand} />
                    <Text style={styles.emptyCtaText}>{emptyCta.label}</Text>
                    <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
                  </GlassCard>
                </PressableScale>
              </View>
            )}

            {/* A real cluster or nothing at all — never a placeholder line. */}
            {insight && (
              <PressableScale
                style={styles.insightWrap}
                accessibilityRole="button"
                accessibilityLabel={`${insight.label.replace('·', '')}. ${
                  insight.cluster.headline
                }. Opens the map filtered to the matched leads.`}
                onPress={openMatchedLeads}
              >
                <GlassCard onArt onLight radius={radii.card} style={styles.insightCard}>
                  <IconChip name="thunderstorm" tone="orange" size="md" />
                  <View style={styles.insightText}>
                    <Text style={styles.insightLabel}>{insight.label}</Text>
                    <Text style={styles.insightHeadline} numberOfLines={2}>
                      {insight.cluster.headline}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </GlassCard>
              </PressableScale>
            )}
          </View>

          {rows.map((row) =>
            row.onPress ? (
              <PressableScale
                key={row.key}
                style={styles.statusRow}
                accessibilityRole="button"
                accessibilityLabel={`${row.text}. ${row.actionLabel ?? ''}`}
                onPress={row.onPress}
              >
                <Ionicons name={row.icon} size={16} color={colors.brand} />
                <Text style={[styles.statusText, styles.statusTextAction]}>{row.text}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
              </PressableScale>
            ) : (
              <View key={row.key} style={styles.statusRow}>
                <Ionicons name={row.icon} size={16} color={colors.textSubtle} />
                <Text style={styles.statusText}>{row.text}</Text>
              </View>
            ),
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Matches Home's `sectionHeaderSpacing`; the scroll container's own
  // `gap: spacing.lg` owns the space above.
  header: { marginBottom: spacing.sm },

  cardShadow: { borderRadius: radii.card, ...shadows.raised },
  card: {
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surface,
  },

  controlRow: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },

  // --- iOS-17 segmented control -------------------------------------------
  segWrap: { justifyContent: 'center' },
  // The BUTTON carries the 56pt, not a wrapper around it.
  //
  // `segWrap` used to set `minHeight: touchTarget.standard`, which sized the
  // wrapper and bought the tap target nothing: `segBtn` is `flex: 1` inside a
  // track that was a fixed 44 high with SEG_PAD each side, so the real
  // pressable measured 36pt — under the Drift #1 floor. `hitSlop` couldn't
  // cover it either: react-native-web doesn't implement hitSlop on Pressable,
  // so the web export got the bare 36.
  //
  // So the track no longer fixes its own height — `segBtn`'s minHeight does,
  // and the track lands at 56 + SEG_PAD*2. Same iOS-17 look, thumb still
  // inset by SEG_PAD, and every platform gets a real 56pt target.
  segTrack: {
    flexDirection: 'row',
    borderRadius: radii.md,
    backgroundColor: colors.fillQuiet,
    padding: SEG_PAD,
  },
  segThumb: {
    position: 'absolute',
    top: SEG_PAD,
    bottom: SEG_PAD,
    left: SEG_PAD,
    borderRadius: radii.control,
    backgroundColor: colors.surface,
    ...shadows.thumb,
  },
  segBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  segLabelActive: { color: colors.text },

  // --- Map body ------------------------------------------------------------
  // Height comes from the map body alone, so the insight overlay's `bottom`
  // is measured against the map and not against this gap.
  mapSlot: { position: 'relative', marginBottom: spacing.md },
  mapBody: {
    height: MAP_HEIGHT,
    marginHorizontal: spacing.md,
    borderRadius: radii.md,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },

  // Keyless ground.
  gridLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: StyleSheet.hairlineWidth,
    backgroundColor: glass.border,
  },
  gridLineV: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: StyleSheet.hairlineWidth,
    backgroundColor: glass.border,
  },
  ring: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.border,
  },
  sweep: { position: 'absolute', top: 0, bottom: 0, left: 0 },
  plotDot: {
    position: 'absolute',
    borderWidth: StyleSheet.hairlineWidth * 2,
    borderColor: glass.borderStrong,
  },
  plotDotHighlighted: {
    borderWidth: 2,
    borderColor: colors.surface,
    ...shadows.thumb,
  },

  // --- Empty-frame call to action ------------------------------------------
  emptyOverlay: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: spacing.xl,
    right: spacing.xl,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyCtaWrap: { borderRadius: radii.pill, ...shadows.float },
  emptyCta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
  },
  emptyCtaText: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },

  // --- Floating insight ----------------------------------------------------
  insightWrap: {
    position: 'absolute',
    left: spacing.xl,
    right: spacing.xl,
    bottom: spacing.md,
    borderRadius: radii.card,
    ...shadows.float,
  },
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: touchTarget.standard,
  },
  insightText: { flex: 1, gap: 1 },
  insightLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.accent,
    letterSpacing: 0.8,
  },
  insightHeadline: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },

  // --- Honest status rows --------------------------------------------------
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  statusText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
  },
  statusTextAction: { color: colors.text, fontWeight: fontWeight.semibold },
});
