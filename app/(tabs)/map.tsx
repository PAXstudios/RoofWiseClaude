import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  AppState,
  Keyboard,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import type MapView from 'react-native-maps';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Map, MapPin, MapCircle, regionForLatLon, type Region } from '@/components/map/Map';
import { StormOverlay, useStormOverlaySelection, useStormSwaths } from '@/components/map/StormOverlay';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '@/components/glass/GlassCard';
import { IconChip } from '@/components/ui/IconChip';
import { magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { LocationField, type ResolvedLocation } from '@/components/LocationField';
import { list as listDiagnostics } from '@/lib/services/diagnostics';
import { resolveServiceCenter } from '@/lib/services/serviceState';
import {
  browsedEvents,
  emptyBrowseState,
  ensureBrowsed,
  type StormBrowseState,
} from '@/lib/services/stormBrowse';
import {
  applyStormControls,
  DEFAULT_RANGE,
  MAGNITUDE_OPTIONS,
  RANGE_LABELS,
  RANGE_LOOKBACK_YEARS,
  RANGE_ORDER,
  type Magnitude,
  type Peril,
  type Range,
} from '@/lib/services/stormRange';
import {
  isValidLatLon,
  isValidRegion,
  stormOverlayCountLine,
  type StormClusterCell,
} from '@/lib/services/stormCluster';
import { fetchAddressStormHistory } from '@/lib/services/stormMatch';
import { leadsInStormCluster, type StormLeadCluster } from '@/lib/services/stormWatch';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
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

type Filter = 'leads' | 'jobs' | 'storms' | 'knocks';

const FILTERS: { id: Filter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'leads', label: 'Leads', icon: 'people-outline' },
  { id: 'jobs', label: 'Jobs', icon: 'hammer-outline' },
  { id: 'storms', label: 'Storms', icon: 'thunderstorm-outline' },
  { id: 'knocks', label: 'Knocks', icon: 'walk-outline' },
];

/** Viewport changes settle this long before the overlay re-selects. */
const REGION_DEBOUNCE_MS = 250;

/**
 * The storm fetch follows the viewport: after a pan settles, the cache is
 * asked to cover the new centre (lib/services/stormBrowse.ts decides whether
 * that costs a request). A longer settle than the overlay's, so a roofer
 * dragging across a county does not fire a request per stop.
 */
const BROWSE_SETTLE_MS = 700;

/** How far a search / my-location jump zooms in: a neighbourhood. */
const JUMP_REGION_DELTA = 0.08;

/** Statewide-ish first view: the 50-mi browse ring fits on screen. */
const INITIAL_REGION_DELTA = 2;

/**
 * Deep-link target for the dashboard storm-alert hero: land on the Leads
 * filter with the storm-matched pins already highlighted.
 * `router.push({ pathname: '/(tabs)/map', params: { focus: FOCUS_STORM_LEADS } })`
 */
export const FOCUS_STORM_LEADS = 'storm-leads';

// -----------------------------------------------------------------------------
// Map safety mode — did the last run die with storm overlays on screen?
// -----------------------------------------------------------------------------
//
// A native abort records nothing (the process is gone), so two signals stand
// in for a crash marker, both honest and both reversible from the UI:
//
//   1. A "storm overlays armed" flag in AsyncStorage. Set while the Map tab is
//      focused with storm overlays live, cleared on blur / unmount / app
//      background. Still set at the next launch ⇒ the previous run ended with
//      overlays on screen. (A force-quit from the Map tab also trips it — the
//      one-tap "turn them on" row makes that a two-second inconvenience.)
//   2. Diagnostics: an error entry tagged with the Map route inside the
//      previous session (between the current boot marker and the one before
//      it), or on the Map route within 5 s of that previous boot.
//
// Either ⇒ the Map tab opens with overlays OFF and says so in one line.

const OVERLAYS_ARMED_KEY = 'roofwise.map.stormOverlaysArmed.v1';
const MAP_ROUTE_RE = /\/map$/;
const BOOT_PROXIMITY_MS = 5_000;

type SafetySignal = 'armed-flag' | 'diagnostics' | null;

async function readSafetySignal(): Promise<SafetySignal> {
  try {
    const armed = await AsyncStorage.getItem(OVERLAYS_ARMED_KEY);
    if (armed) return 'armed-flag';
  } catch {
    // Storage unavailable — fall through to the diagnostics read.
  }
  try {
    const entries = listDiagnostics(); // newest first
    const bootIdx = entries
      .map((e, i) => (e.kind === 'boot' ? i : -1))
      .filter((i) => i >= 0);
    if (bootIdx.length === 0) return null;
    const start = bootIdx[0] + 1; // after this launch's boot marker
    const end = bootIdx.length >= 2 ? bootIdx[1] + 1 : entries.length; // through the previous boot
    const prevBootMs = bootIdx.length >= 2 ? Date.parse(entries[bootIdx[1]].iso) : NaN;
    for (let i = start; i < end; i += 1) {
      const e = entries[i];
      if (!e.route || !MAP_ROUTE_RE.test(e.route)) continue;
      const isError = e.kind === 'js_error' || e.kind === 'promise_rejection';
      const nearBoot =
        Number.isFinite(prevBootMs) && Math.abs(Date.parse(e.iso) - prevBootMs) <= BOOT_PROXIMITY_MS;
      if (isError || nearBoot) return 'diagnostics';
    }
  } catch {
    // Diagnostics unreadable — no signal, normal boot.
  }
  return null;
}

function setOverlaysArmed(on: boolean): void {
  const op = on
    ? AsyncStorage.setItem(OVERLAYS_ARMED_KEY, new Date().toISOString())
    : AsyncStorage.removeItem(OVERLAYS_ARMED_KEY);
  op.catch(() => {
    // Best-effort. A missed write only means one less crash signal.
  });
}

// First-paint-only entrance gate — same pattern as Home. Returning to the
// Map tab (kept alive by the tab navigator) renders statically instead of
// replaying the stagger. Dev fast-refresh resets it, which is fine.
let mapEntrancePlayed = false;

/** Rise distance in points — captured as a NUMBER, not the `spacing` object. */
const RISE_PX = spacing.sm;

/**
 * Subtle iOS entrance: 8pt rise + fade on the snappy spring, staggered by
 * index. The worklet body is guarded: a throw inside a worklet on the UI
 * runtime aborts the process in a release native binary (see
 * lib/services/uiRuntimeGuard.ts), so it reads only a number and falls back
 * to the resting style. `static` renders a plain View — no worklet at all —
 * which is what safety mode uses.
 */
function Rise({
  index = 0,
  style,
  static: isStatic = false,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle>; static?: boolean }>) {
  const progress = useSharedValue(mapEntrancePlayed ? 1 : 0);

  useEffect(() => {
    if (isStatic || progress.value === 1) return;
    const id = setTimeout(() => {
      progress.value = withSpring(1, motion.snappy);
    }, index * motion.staggerDelayMs);
    return () => clearTimeout(id);
    // Entrance runs once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anim = useAnimatedStyle(() => {
    try {
      const raw = progress.value;
      const p = typeof raw === 'number' && Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 1;
      return { opacity: p, transform: [{ translateY: (1 - p) * RISE_PX }] };
    } catch (error) {
      reportWorkletError(error, 'map.Rise');
      return { opacity: 1, transform: [{ translateY: 0 }] };
    }
  });

  if (isStatic) return <View style={style}>{children}</View>;
  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

/**
 * A floating control over the map imagery — real frosted glass (BlurView on
 * iOS, a tinted-fill fallback elsewhere) so it stays legible in sun no matter
 * what's under it, per Drift #1. Selected state breaks from glass into a
 * solid royal fill — glass reads as "available", solid reads as "chosen".
 */
function GlassChip({
  active,
  icon,
  label,
  onPress,
  accessibilityLabel,
}: {
  active: boolean;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onPress: () => void;
  accessibilityLabel: string;
}) {
  return (
    <PressableScale
      style={active ? styles.chipShadow : undefined}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={accessibilityLabel}
      onPress={onPress}
    >
      {active ? (
        // Selection is the royal RAMP with the brand-tinted lift, not a flat
        // fully-saturated rectangle — that was the one generic-blue moment
        // left in the app.
        <View style={[styles.chip, styles.chipActive]}>
          <LinearGradient
            colors={gradients.clearDay}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <Ionicons name={icon} size={16} color={colors.textInverse} />
          <Text style={[styles.chipText, styles.chipTextActive]}>{label}</Text>
        </View>
      ) : (
        // Idle chips live INSIDE the glass control bar now, so they carry a
        // quiet fill rather than each being its own floating glass panel.
        <View style={[styles.chip, styles.chipIdle]}>
          <Ionicons name={icon} size={16} color={colors.text} />
          <Text style={styles.chipText}>{label}</Text>
        </View>
      )}
    </PressableScale>
  );
}

/** Hail/wind/severe swatches for the semantic storm palette (Drift #11: theme
 *  tokens, not the raw per-magnitude hex `severityColor()` plots with), plus
 *  the impacted-area band scale. The label says "from storm reports" — this is
 *  the buffered contour of real NOAA LSRs, NEVER radar (Drift #5). */
function StormLegend() {
  return (
    <View style={styles.legendCard}>
      <Text style={styles.legendTitle} numberOfLines={2}>
        Impacted area — hail / wind (from storm reports)
      </Text>
      <View style={styles.legendRow}>
        <SwathSwatch color={colors.stormHail} label={'Hail  < 1"  ·  1–1.5"  ·  1.5–2"  ·  2"+'} />
      </View>
      <View style={styles.legendRow}>
        <SwathSwatch color={colors.stormWind} label="Wind  58–70  ·  70–86  ·  86+ mph" />
      </View>
      <View style={styles.legendRow}>
        <LegendSwatch color={colors.stormHail} label="Hail report" />
        <LegendSwatch color={colors.stormWind} label="Wind report" />
        <LegendSwatch color={colors.stormSevere} label="Severe" />
      </View>
    </View>
  );
}

/** A darkening ramp of the peril hue — mirrors how the nested band contours
 *  deepen from the weakest band to the strongest. */
function SwathSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={styles.swathRamp}>
        <View style={[styles.swathCell, { backgroundColor: color, opacity: 0.22 }]} />
        <View style={[styles.swathCell, { backgroundColor: color, opacity: 0.42 }]} />
        <View style={[styles.swathCell, { backgroundColor: color, opacity: 0.62 }]} />
        <View style={[styles.swathCell, { backgroundColor: color, opacity: 0.85 }]} />
      </View>
      <Text style={styles.legendText} numberOfLines={1}>{label}</Text>
    </View>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.legendDot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

/**
 * The reference's floating AI-insight pattern — a glass card surfacing the
 * real storm-matched lead cluster over the map imagery. Only ever mounted
 * with a genuine cluster (Drift #5): the caller gates on `cluster`.
 */
function ClusterInsight({ cluster, onPress }: { cluster: StormLeadCluster; onPress: () => void }) {
  return (
    <PressableScale
      style={styles.insightShadow}
      accessibilityRole="button"
      accessibilityLabel={`${cluster.headline}. Shows the matched leads on the map.`}
      onPress={onPress}
    >
      <GlassCard onLight onArt radius={radii.card} style={styles.insightCard}>
        <IconChip name="thunderstorm" tone="orange" size="md" />
        <View style={styles.insightText}>
          <Text style={styles.insightLabel}>STORM MATCH</Text>
          <Text style={styles.insightHeadline} numberOfLines={2}>
            {cluster.headline}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
      </GlassCard>
    </PressableScale>
  );
}

/**
 * Tap-a-pin detail: the real report, nothing inferred. Date, magnitude,
 * place, and the NWS remark when there is one.
 */
function StormDetailCard({ event, onClose }: { event: StormEvent; onClose: () => void }) {
  const kind = event.type === 'hail' ? 'Hail' : 'Wind';
  const when = new Date(event.occurredAt);
  const where = [event.city, event.state].filter(Boolean).join(', ');
  return (
    <GlassCard onLight onArt radius={radii.card} style={styles.detailCard}>
      <IconChip
        name={event.type === 'hail' ? 'snow-outline' : 'flag-outline'}
        tone={event.type === 'hail' ? 'blue' : 'orange'}
        size="md"
      />
      <View style={styles.insightText}>
        <Text style={styles.insightLabel}>
          {kind.toUpperCase()} · {magnitudeLabel(event)}
        </Text>
        <Text style={styles.insightHeadline} numberOfLines={1}>
          {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          {where ? ` · ${where}` : ''}
        </Text>
        {event.remarks ? (
          <Text style={styles.detailRemark} numberOfLines={2}>
            {event.remarks}
          </Text>
        ) : null}
      </View>
      <PressableScale
        style={styles.detailClose}
        accessibilityRole="button"
        accessibilityLabel="Close storm details"
        onPress={onClose}
      >
        <Ionicons name="close" size={22} color={colors.text} />
      </PressableScale>
    </GlassCard>
  );
}

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const { focus, filter: filterParam } = useLocalSearchParams<{ focus?: string; filter?: string }>();
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const serviceAreas = useServiceAreaStore((s) => s.areas);
  const alerts = useStormAlertStore((s) => s.alerts);

  const [filter, setFilter] = useState<Filter>(
    focus === FOCUS_STORM_LEADS ? 'leads' : 'storms',
  );
  // Storm Tracer controls (the retired standalone tracer's, now here).
  const [range, setRange] = useState<Range>(DEFAULT_RANGE);
  const [peril, setPeril] = useState<Peril>('both');
  const [magnitude, setMagnitude] = useState<Magnitude>('all');
  const lookbackYears = RANGE_LOOKBACK_YEARS[range];
  // Every storm loaded so far, by id, with the centres already covered — the
  // map asks for the area it is looking at and never re-asks for one it has.
  const [browse, setBrowse] = useState<StormBrowseState>(() => emptyBrowseState());
  const browseRef = useRef(browse);
  browseRef.current = browse;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<StormEvent | null>(null);
  // Address search + my-location. The map was a viewport with no way to say
  // where to look; these are the two ways a real map does.
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);

  // Safety mode. `null` = still reading the signal (overlays stay off until
  // the answer is in — the safe default costs one frame, not a crash).
  const [overlaysEnabled, setOverlaysEnabled] = useState<boolean | null>(null);
  const [safetyNotice, setSafetyNotice] = useState<SafetySignal>(null);
  useEffect(() => {
    let cancelled = false;
    readSafetySignal().then((signal) => {
      if (cancelled) return;
      setSafetyNotice(signal);
      setOverlaysEnabled(signal == null);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const overlaysOn = overlaysEnabled === true;
  const safetyMode = safetyNotice != null;

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    mapEntrancePlayed = true;
  }, []);

  // Screen focus, for the armed flag — the tab navigator keeps this screen
  // alive off-screen, so "mounted" is not "on screen".
  const [isFocused, setIsFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  // Centre: the first saved Service Area with a centroid, else the service
  // state's centre. Follows the saved area rather than assuming Texas.
  const { state: serviceState, ...stateCenter } = useMemo(
    () => resolveServiceCenter(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceAreas, inspections],
  );
  const center = useMemo(() => {
    const area = serviceAreas.find((a) => isValidLatLon(a.centroidLat, a.centroidLng));
    return area
      ? { lat: area.centroidLat as number, lon: area.centroidLng as number }
      : { lat: stateCenter.lat, lon: stateCenter.lon };
  }, [serviceAreas, stateCenter.lat, stateCenter.lon]);

  // The native map's initial region is fixed for the life of the MapView —
  // never derived per render, never passed back as `region` (a controlled
  // region prop re-animates the camera on every state change).
  const [initialRegion] = useState<Region>(() =>
    regionForLatLon(center.lat, center.lon, INITIAL_REGION_DELTA),
  );

  // Viewport, debounced. The overlay re-selects on this; the MapView never
  // remounts on it.
  const [region, setRegion] = useState<Region>(initialRegion);
  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChangeComplete = useCallback((next: Region) => {
    if (!isValidRegion(next)) return;
    if (regionTimer.current) clearTimeout(regionTimer.current);
    regionTimer.current = setTimeout(() => {
      regionTimer.current = null;
      setRegion(next);
    }, REGION_DEBOUNCE_MS);
  }, []);
  useEffect(
    () => () => {
      if (regionTimer.current) clearTimeout(regionTimer.current);
    },
    [],
  );

  // The Map tab is pre-mounted by the tab navigator, so a deep link can arrive
  // while this screen is already alive — react to the param, don't rely on the
  // initial state alone. The param is consumed once applied: it persists on
  // the tab route otherwise, so a second identical deep link (same string)
  // would not change this effect's deps and the filter would not re-apply.
  useEffect(() => {
    if (focus === FOCUS_STORM_LEADS) {
      setFilter('leads');
      router.setParams({ focus: '' });
    }
  }, [focus, router]);
  // `?filter=storms` — the Home tile and the retired /hail-tracer route land
  // here on the Storm Tracer filter. Consumed once applied, like `focus`.
  useEffect(() => {
    if (filterParam && FILTERS.some((f) => f.id === filterParam)) {
      setFilter(filterParam as Filter);
      router.setParams({ filter: '' });
    }
  }, [filterParam, router]);

  // Height of the floating stat bar / cluster card so the Google attribution
  // chip (Expo Go iOS) sits above it — Google requires the credit visible.
  const [statBarHeight, setStatBarHeight] = useState(0);

  // Storm history FOLLOWS THE VIEWPORT. Both maps used to fetch once around
  // the saved service area and never again — pan sixty miles to a property
  // and there was nothing to draw there ("the storm data does not populate").
  // Now the settled region's centre is the query; the browse cache decides
  // whether that costs a request (already-covered centres cost nothing) and
  // merges results so a return pan keeps everything. Still the shared,
  // 4-year-clamped, validation-floored history service (Drift #5: an
  // unreachable service says so, never a silent empty map).
  const browseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const browseSeq = useRef(0);
  useEffect(() => {
    if (filter !== 'storms') return;
    if (browseTimer.current) clearTimeout(browseTimer.current);
    browseTimer.current = setTimeout(() => {
      browseTimer.current = null;
      const seq = ++browseSeq.current;
      const target = { lat: region.latitude, lon: region.longitude, stateCode: serviceState, lookbackYears };
      setError(null);
      ensureBrowsed(browseRef.current, target, fetchAddressStormHistory)
        .then((out) => {
          if (seq !== browseSeq.current) return;
          if (out.kind === 'unavailable') {
            setError('Storm history not available right now.');
          } else if (out.kind === 'fetched') {
            setBrowse(out.state);
          }
        })
        .catch(() => {
          if (seq === browseSeq.current) setError('Storm history not available right now.');
        })
        .finally(() => {
          if (seq === browseSeq.current) setLoading(false);
        });
      setLoading(true);
    }, BROWSE_SETTLE_MS);
    return () => {
      if (browseTimer.current) clearTimeout(browseTimer.current);
    };
  }, [filter, serviceState, lookbackYears, region.latitude, region.longitude]);

  // What the controls leave: range crop, peril, magnitude — one place, so the
  // pins, the swaths and the count line always agree.
  const events = useMemo(
    () => applyStormControls(browsedEvents(browse), { range, peril, magnitude }),
    [browse, range, peril, magnitude],
  );

  /** Jump the camera. Search and my-location both land here. */
  const jumpTo = useCallback((lat: number, lon: number) => {
    const next = regionForLatLon(lat, lon, JUMP_REGION_DELTA);
    if (!isValidRegion(next)) return;
    mapRef.current?.animateToRegion(next, 450);
    // The settled-region callback fires after the animation; set it now too
    // so the fetch starts without waiting on the camera.
    setRegion(next);
  }, []);

  const onSearchResolved = useCallback(
    (loc: ResolvedLocation) => {
      Keyboard.dismiss();
      setSearchOpen(false);
      if (isValidLatLon(loc.lat, loc.lng)) jumpTo(loc.lat, loc.lng);
    },
    [jumpTo],
  );

  const goToMyLocation = useCallback(async () => {
    if (locating) return;
    setLocating(true);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== 'granted' && perm.canAskAgain) {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== 'granted') {
        setError('Location access is off — turn it on in Settings to use My location.');
        return;
      }
      const fix = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      jumpTo(fix.coords.latitude, fix.coords.longitude);
    } catch {
      setError("Couldn't get a location fix. Try again outside.");
    } finally {
      setLocating(false);
    }
  }, [jumpTo, locating]);

  // Everything native receives for storms comes out of here — sanitised,
  // banded by zoom, capped. Empty (but honest about totals) while overlays
  // are off.
  const selection = useStormOverlaySelection(events, region, filter === 'storms' && overlaysOn);
  // Impacted-area swaths (HailTrace-style) — the whole area the reports imply,
  // recomputed on data / zoom-bucket change, not on pan. Same gate as the pins,
  // so the hail/wind (storms) filter shows and hides both together.
  const swaths = useStormSwaths(events, region, filter === 'storms' && overlaysOn);
  const selectedStillShown = useMemo(
    () => !!selectedEvent && selection.markers.some((e) => e.id === selectedEvent.id),
    [selectedEvent, selection.markers],
  );

  // Armed flag: on only while storm overlays are actually drawn on a focused
  // screen; cleared the moment they aren't, and on every app background.
  const overlaysLive =
    isFocused && filter === 'storms' && overlaysOn &&
    (selection.markers.length > 0 || selection.clusters.length > 0);
  const overlaysLiveRef = useRef(overlaysLive);
  overlaysLiveRef.current = overlaysLive;
  useEffect(() => {
    setOverlaysArmed(overlaysLive);
  }, [overlaysLive]);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        if (overlaysLiveRef.current) setOverlaysArmed(true);
      } else {
        setOverlaysArmed(false);
      }
    });
    return () => {
      sub.remove();
      setOverlaysArmed(false);
    };
  }, []);

  const onSelectCluster = useCallback(
    (cell: StormClusterCell) => {
      const next: Region = {
        latitude: cell.lat,
        longitude: cell.lon,
        latitudeDelta: region.latitudeDelta / 3,
        longitudeDelta: region.longitudeDelta / 3,
      };
      if (!isValidRegion(next)) return;
      mapRef.current?.animateToRegion(next, 350);
    },
    [region.latitudeDelta, region.longitudeDelta],
  );

  const jobPins = useMemo(
    () => inspections.filter((i) => typeof i.lat === 'number' && typeof i.lng === 'number'),
    [inspections],
  );
  const leadPins = useMemo(
    () => leads.filter((l) => typeof l.lat === 'number' && typeof l.lng === 'number'),
    [leads],
  );
  const knockPins = useMemo(() => {
    const knocks = [
      ...archive.flatMap((s) => s.knocks),
      ...(active?.knocks ?? []),
    ];
    return knocks;
  }, [archive, active]);

  // Storm-matched lead cluster for the live alert — "3 leads within 1.4 mi of
  // the Apr 18 hail core". Rebuilt from the leads Storm Watch stamped, so it
  // survives a restart. Null when nothing matched: no line, no highlight.
  const activeAlert = useMemo(() => alerts.find((a) => a.status === 'new'), [alerts]);
  const cluster = useMemo(
    () => (activeAlert ? leadsInStormCluster(leads, activeAlert) : null),
    [leads, activeAlert],
  );
  const clusterLeadIds = useMemo(() => new Set(cluster?.leadIds ?? []), [cluster]);

  // Hold the first paint until the safety signal is in: in safety mode the
  // entrance is static (no worklets at all on this screen's own chrome).
  if (overlaysEnabled === null) {
    return <View style={styles.root} />;
  }

  // Honest about coverage: how many 50-mi areas have been fetched so far, or
  // that none has (an error and "still loading" are different facts).
  const countWindow =
    `${RANGE_LABELS[range].toLowerCase()} · ` +
    (browse.areas.length > 0
      ? `${browse.areas.length} area${browse.areas.length === 1 ? '' : 's'} loaded`
      : error
        ? 'no area loaded'
        : 'loading area');

  return (
    <View style={styles.root}>
      {/* Large title on the grouped ground. Knock mode is this screen's single
          accent action — everything else over the map goes quiet. */}
      <Rise index={0} static={safetyMode}>
        <ScreenHeader
          title={filter === 'storms' ? 'Storm Tracer' : 'Map'}
          right={
            <PressableScale
              style={styles.knockBtn}
              accessibilityRole="button"
              accessibilityLabel="Knock mode"
              onPress={() => router.push('/door-knocking')}
            >
              <View style={styles.knockBtnFill}>
                <Ionicons name="walk-outline" size={18} color={colors.textInverse} />
                <Text style={styles.knockBtnText}>Knock mode</Text>
              </View>
            </PressableScale>
          }
        />
      </Rise>

      {/* Density: the map fills everything under the header — the full-bleed
          cinematic moment. Controls float over the imagery as real glass. */}
      <View style={styles.mapWrap}>
        <Map
          ref={mapRef}
          initialRegion={initialRegion}
          onRegionChangeComplete={onRegionChangeComplete}
          // Web preview only: the fallback panel top-anchors under the two
          // floating chip rows (list-screen empty-state pattern) instead of
          // centering in the void. Offset = overlay top inset + two chip rows
          // (56pt chips + row padding) + inter-row gap + breathing room.
          fallbackTopOffset={
            spacing.md +
            2 * (touchTarget.standard + 2 * spacing.xs) +
            spacing.sm +
            spacing.xl
          }
          attributionInset={{ bottom: statBarHeight + spacing.md + spacing.sm }}
          // Expo Go iOS only: the storm swaths + hit circles are vector
          // overlays, and MapKit stacks the opaque Google tile overlay ABOVE
          // them — the impacted-area fill (the substance of this filter) would
          // vanish under it. Keep the Apple base while browsing storms; every
          // other filter (pins are annotations, always on top) keeps Google
          // imagery, and native builds render Google + overlays regardless.
          googleImagery={filter !== 'storms'}
        >
          {serviceAreas
            .filter((a) => isValidLatLon(a.centroidLat, a.centroidLng))
            .map((a) => (
              <MapCircle
                key={a.id}
                center={{ latitude: a.centroidLat as number, longitude: a.centroidLng as number }}
                radius={8047}  // 5 mi in meters
                strokeColor={colors.navy}
                strokeWidth={2}
                fillColor={glass.lightFill}
              />
            ))}
          {filter === 'storms' && overlaysOn && (
            <StormOverlay
              selection={selection}
              swaths={swaths}
              onSelectEvent={setSelectedEvent}
              onSelectCluster={onSelectCluster}
            />
          )}
          {filter === 'jobs' &&
            jobPins.map((ins) => (
              <MapPin
                key={ins.id}
                coordinate={{ latitude: ins.lat!, longitude: ins.lng! }}
                title={ins.customerName}
                description={`${ins.reportId} · ${ins.status.replace('_', ' ')}`}
                tone="orange"
                onCalloutPress={() => router.push(`/job/${ins.id}` as any)}
              />
            ))}
          {filter === 'leads' &&
            leadPins.map((lead) => {
              // Storm-matched leads ride the existing pin-tone system: red for
              // "inside the core", the same read as a severe storm pin.
              const inCore = clusterLeadIds.has(lead.id);
              const miles = lead.lastStormMatch?.distanceMiles;
              return (
                <MapPin
                  key={lead.id}
                  coordinate={{ latitude: lead.lat!, longitude: lead.lng! }}
                  title={lead.customerName}
                  description={
                    inCore && miles != null
                      ? `In storm core · ${miles.toFixed(1)} mi · ${lead.stage.replace('_', ' ')}`
                      : `Stage: ${lead.stage.replace('_', ' ')}`
                  }
                  tone={inCore ? 'danger' : 'info'}
                />
              );
            })}
          {filter === 'knocks' &&
            knockPins.map((k) => (
              <MapPin
                key={k.id}
                coordinate={{ latitude: k.lat, longitude: k.lng }}
                title={k.outcome.replace(/_/g, ' ')}
                description={new Date(k.createdAt).toLocaleString()}
                tone={
                  k.outcome === 'interested' || k.outcome === 'inspection_scheduled'
                    ? 'success'
                    : k.outcome === 'not_interested'
                    ? 'danger'
                    : 'cream'
                }
              />
            ))}
        </Map>

        {/* ONE floating glass control bar — real BlurView on iOS, tinted-fill
            fallback elsewhere; glove-sized (≥56pt) either way. */}
        <View style={styles.overlayTop} pointerEvents="box-none">
          <Rise index={1} static={safetyMode} style={styles.controlBarShadow}>
            <GlassCard onLight onArt radius={radii.lg} style={styles.controlBar}>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.chipScroll}
                contentContainerStyle={styles.chipScrollContent}
              >
                {FILTERS.map((f) => (
                  <GlassChip
                    key={f.id}
                    active={filter === f.id}
                    icon={f.icon}
                    label={f.label}
                    accessibilityLabel={`Show ${f.label}`}
                    onPress={() => {
                      setSelectedEvent(null);
                      setFilter(f.id);
                    }}
                  />
                ))}
              </ScrollView>

              {/* Where to look: an address, or where the phone is. A map that
                  cannot be pointed somewhere is a picture. */}
              <View style={styles.searchRow}>
                {searchOpen ? (
                  <View style={styles.searchField}>
                    <LocationField
                      value={searchText}
                      onChangeText={setSearchText}
                      onResolved={onSearchResolved}
                      placeholder="Address, city, or ZIP"
                      biasLat={region.latitude}
                      biasLng={region.longitude}
                      useMyLocation={false}
                      autoFocus
                      returnKeyType="search"
                    />
                  </View>
                ) : (
                  <PressableScale
                    style={styles.searchBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Search an address"
                    onPress={() => setSearchOpen(true)}
                  >
                    <Ionicons name="search" size={18} color={colors.text} />
                    <Text style={styles.searchBtnText} numberOfLines={1}>
                      {searchText ? searchText : 'Search an address'}
                    </Text>
                  </PressableScale>
                )}
                <PressableScale
                  style={styles.roundBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Go to my location"
                  onPress={goToMyLocation}
                >
                  {locating ? (
                    <ActivityIndicator color={colors.text} />
                  ) : (
                    <Ionicons name="locate" size={20} color={colors.text} />
                  )}
                </PressableScale>
                {searchOpen && (
                  <PressableScale
                    style={styles.roundBtn}
                    accessibilityRole="button"
                    accessibilityLabel="Close search"
                    onPress={() => {
                      Keyboard.dismiss();
                      setSearchOpen(false);
                    }}
                  >
                    <Ionicons name="close" size={20} color={colors.text} />
                  </PressableScale>
                )}
              </View>

              {filter === 'storms' && (
                <View style={styles.controlBarSecond}>
                  {/* Range — the tracer's Time Travel. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {RANGE_ORDER.map((r) => (
                      <GlassChip
                        key={r}
                        active={range === r}
                        icon="time-outline"
                        label={RANGE_LABELS[r]}
                        accessibilityLabel={RANGE_LABELS[r]}
                        onPress={() => setRange(r)}
                      />
                    ))}
                  </ScrollView>
                  {/* Peril + magnitude + overlays. */}
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {(
                      [
                        { id: 'hail', label: 'Hail', icon: 'snow-outline' },
                        { id: 'wind', label: 'Wind', icon: 'flag-outline' },
                        { id: 'both', label: 'Both', icon: 'thunderstorm-outline' },
                      ] as const
                    ).map((p) => (
                      <GlassChip
                        key={p.id}
                        active={peril === p.id}
                        icon={p.icon}
                        label={p.label}
                        accessibilityLabel={`Show ${p.label.toLowerCase()} reports`}
                        onPress={() => setPeril(p.id)}
                      />
                    ))}
                    {MAGNITUDE_OPTIONS.map((m) => (
                      <GlassChip
                        key={m.id}
                        active={magnitude === m.id}
                        icon="speedometer-outline"
                        label={m.label}
                        accessibilityLabel={m.label}
                        onPress={() => setMagnitude(m.id)}
                      />
                    ))}
                    {/* Overlays toggle — the reversible half of safety mode,
                        and a plain "quiet the map" control the rest of the time. */}
                    <GlassChip
                      active={overlaysOn}
                      icon="layers-outline"
                      label="Overlays"
                      accessibilityLabel={overlaysOn ? 'Hide storm overlays' : 'Show storm overlays'}
                      onPress={() => {
                        setSelectedEvent(null);
                        setOverlaysEnabled(!overlaysOn);
                        if (!overlaysOn) setSafetyNotice(null);
                      }}
                    />
                  </ScrollView>
                  <StormLegend />
                </View>
              )}
            </GlassCard>
          </Rise>

          {loading && (
            <View style={styles.loadingShadow}>
              <GlassCard onLight onArt radius={radii.button} style={styles.loadingPill}>
                <ActivityIndicator color={colors.navy} />
              </GlassCard>
            </View>
          )}
        </View>

        {/* Cluster insight, storm detail, safety row and count float at the
            bottom edge of the map. Real numbers only — each is absent when
            there's nothing to report. */}
        <View
          style={styles.statBarWrap}
          pointerEvents="box-none"
          onLayout={(e) => setStatBarHeight(e.nativeEvent.layout.height)}
        >
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {safetyMode && !overlaysOn && (
            <PressableScale
              style={styles.safetyShadow}
              accessibilityRole="button"
              accessibilityLabel="Loaded without storm overlays after a crash. Turn them on."
              onPress={() => {
                setOverlaysEnabled(true);
                setSafetyNotice(null);
              }}
            >
              <GlassCard onLight onArt radius={radii.button} style={styles.safetyRow}>
                <Ionicons name="shield-checkmark-outline" size={22} color={colors.warn} />
                <Text style={styles.safetyText} numberOfLines={2}>
                  Loaded without storm overlays after a crash — tap to turn them on
                </Text>
                <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
              </GlassCard>
            </PressableScale>
          )}
          {filter === 'storms' && selectedEvent && selectedStillShown && (
            <View style={styles.insightShadow}>
              <StormDetailCard event={selectedEvent} onClose={() => setSelectedEvent(null)} />
            </View>
          )}
          {cluster && (
            <Rise index={4} static={safetyMode}>
              <ClusterInsight cluster={cluster} onPress={() => setFilter('leads')} />
            </Rise>
          )}
          <Rise index={5} static={safetyMode}>
            <View style={styles.statBarShadow}>
              <GlassCard onLight onArt radius={radii.button} style={styles.statBar}>
                <Text style={styles.statText}>
                  {filter === 'storms' &&
                    stormOverlayCountLine(selection, countWindow, {
                      loading,
                      unavailable: error != null,
                      overlaysOff: !overlaysOn,
                    })}
                  {filter === 'jobs' && `${jobPins.length} of ${inspections.length} jobs mapped`}
                  {filter === 'leads' && `${leadPins.length} of ${leads.length} leads mapped`}
                  {filter === 'knocks' && `${knockPins.length} knock pins`}
                </Text>
              </GlassCard>
            </View>
          </Rise>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Header action — 56pt target around a 44pt accent button (home pattern).
  knockBtn: { minHeight: touchTarget.standard, justifyContent: 'center' },
  knockBtnFill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  knockBtnText: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
  },

  // Full-bleed map under a hairline — the screen's content IS the map.
  mapWrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },

  overlayTop: {
    position: 'absolute',
    top: spacing.md,
    left: 0,
    right: 0,
  },
  // The single floating control bar. Shadow lives on the wrapper so it isn't
  // clipped by the glass card's own corner radius.
  controlBarShadow: {
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    ...shadows.float,
  },
  controlBar: { paddingVertical: spacing.xs },
  // Search + my-location row inside the glass bar. The search pill and the
  // round buttons are all ≥56pt (Drift #1).
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  searchField: { flex: 1 },
  searchBtn: {
    flex: 1,
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  searchBtnText: { flex: 1, fontSize: fontSize.bodyMd, color: colors.textMuted },
  roundBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  controlBarSecond: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
    paddingTop: spacing.xs,
  },

  chipScroll: { flexGrow: 0 },
  chipScrollContent: {
    // Tightened from `lg`/`sm` so the four layer chips clear a 390pt
    // viewport: a chip edge meets the bar, not a cut glyph.
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
  },

  // Chips inside the bar. Selected breaks to the royal RAMP + brand lift;
  // idle carries a quiet fill. The shadow lives on the PressableScale
  // wrapper so it isn't clipped by the chip's own corner radius.
  chipShadow: { borderRadius: radii.button, ...shadows.hero },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    overflow: 'hidden',
  },
  chipIdle: { backgroundColor: colors.fillQuiet },
  chipActive: { backgroundColor: colors.brand },
  chipText: {
    fontSize: fontSize.bodySm,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  chipTextActive: { color: colors.textInverse },

  // Storm legend — semantic storm tokens (Drift #11), not the raw per-event
  // hex. A row inside the control bar rather than a pill floating over (and
  // colliding with) the pins.
  legendCard: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  legendTitle: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text },
  // A 4-cell ramp echoing the deepening nested band contours.
  swathRamp: { flexDirection: 'row', borderRadius: 3, overflow: 'hidden' },
  swathCell: { width: 9, height: 10 },

  loadingShadow: {
    alignSelf: 'flex-start',
    marginLeft: spacing.lg,
    marginTop: spacing.sm,
    borderRadius: radii.button,
    ...shadows.float,
  },
  loadingPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },

  statBarWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    gap: spacing.sm,
  },

  // Floating AI-insight card — the storm-lead cluster, real counts only.
  insightShadow: { borderRadius: radii.card, ...shadows.float },
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

  // Storm detail — same card grammar as the insight, plus a 56pt close.
  detailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: touchTarget.standard,
  },
  detailRemark: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    marginTop: 2,
  },
  detailClose: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Safety-mode row: one line, one tap, ≥56pt.
  safetyShadow: { borderRadius: radii.button, ...shadows.float },
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTarget.standard,
  },
  safetyText: {
    flex: 1,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },

  statBarShadow: { borderRadius: radii.button, ...shadows.float },
  statBar: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  statText: {
    color: colors.text,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },

  errorCard: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.button,
    ...shadows.float,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, textAlign: 'center' },
});
