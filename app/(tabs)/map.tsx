// Storm Tracer — the Map tab. One map, four layers (Leads / Jobs / Storms /
// Knocks), and the shared map control system (components/map/controls):
//
//   top-left   SummaryChip — "Storms · 36 months · Hail + wind · All days";
//              tap → the Layers & filters sheet. Search expands here.
//   top-right  ControlRail — search, my location (hold: follow), layers
//              (badge = active filters), legend, satellite; chevron tucks
//              the stack. Tucks itself on a hand pan; remembered per screen.
//   bottom     MapDrawer — peek: the stat line + Knock Planner + the one
//              primary CTA (Knock mode, 88pt); half/full: the selected
//              storm's report, the storm-matched lead cluster, the storm-day
//              list. The crash-recovery row and errors sit in its header so
//              they are visible at every detent.
//
// Everything that used to be a chip row over the imagery lives in the sheet;
// nothing was removed, and every control is within two taps of the map.

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
  type ReactNode,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  AppState,
  Keyboard,
  Pressable,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import * as Location from 'expo-location';
import * as Haptics from 'expo-haptics';
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
import {
  StormOverlay,
  swathEmphasisForRegion,
  useStormOverlaySelection,
  useStormSwaths,
} from '@/components/map/StormOverlay';
import {
  ControlRail,
  LayersSheet,
  LegendStrip,
  MapDrawer,
  SummaryChip,
  useMapPanTuck,
  type LayersRow,
  type LayersSection,
  type LegendItem,
  type RailItem,
} from '@/components/map/controls';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SettingsAffordance } from '@/components/ui/SettingsAffordance';
import { PressableScale } from '@/components/PressableScale';
import { GlassCard } from '@/components/glass/GlassCard';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { ConfirmSheet } from '@/components/sheets/ConfirmSheet';
import { openDirections } from '@/components/pipeline/contact';
import { magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { LocationField, type ResolvedLocation } from '@/components/LocationField';
import { KnockPinMarker } from '@/components/knock/KnockPinMarker';
import { outcomeColor, outcomeIcon } from '@/components/knock/outcomeStyle';
import { startRoute } from '@/components/knock/sessionTracker';
import { list as listDiagnostics } from '@/lib/services/diagnostics';
import { KNOCK_OUTCOMES } from '@/lib/services/knockOutcomes';
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
import { eventsOnDay, stormDayLabel, stormDays, type StormDay } from '@/lib/services/stormDays';
import {
  isValidLatLon,
  isValidRegion,
  stormOverlayCountLine,
  type StormClusterCell,
} from '@/lib/services/stormCluster';
import { fetchAddressStormHistory } from '@/lib/services/stormMatch';
import {
  stormEventToRouteTarget,
  stormEventToSavedArea,
  savedAreaToRouteTarget,
} from '@/lib/services/stormTracerSelection';
import { KNOCK_ROUTE_RADIUS_MILES, leadsInStormCluster, type StormLeadCluster } from '@/lib/services/stormWatch';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useMapChrome } from '@/lib/stores/mapChromeStore';
import { useSavedAreaStore, useSavedAreas, type SavedArea } from '@/lib/stores/savedAreaStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useStormAlertStore } from '@/lib/stores/stormAlertStore';
import { useToastStore } from '@/lib/stores/toastStore';
import type { Inspection, KnockRouteTarget, Lead } from '@/lib/models/types';
import {
  colors,
  dataLabel,
  fontFamily,
  fontSize,
  fontWeight,
  glass,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Filter = 'leads' | 'jobs' | 'storms' | 'knocks' | 'saved';

const FILTERS: { id: Filter; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'leads', label: 'Leads', icon: 'people-outline' },
  { id: 'jobs', label: 'Jobs', icon: 'hammer-outline' },
  { id: 'storms', label: 'Storms', icon: 'thunderstorm-outline' },
  { id: 'knocks', label: 'Knocks', icon: 'walk-outline' },
  { id: 'saved', label: 'Saved', icon: 'bookmark-outline' },
];

const PERILS: { id: Peril; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { id: 'hail', label: 'Hail', icon: 'snow-outline' },
  { id: 'wind', label: 'Wind', icon: 'flag-outline' },
  { id: 'both', label: 'Both', icon: 'thunderstorm-outline' },
];

/** Sentinel id for "every storm day" in the sheet's day list. */
const ALL_DAYS = '__all__';

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
/** Storm-day rows shown in the drawer and the sheet (newest first). */
const STORM_DAY_CHIPS = 12;

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
// Either ⇒ the Map tab opens with overlays OFF and says so in one line. In
// safety mode this screen's own chrome runs NO worklets: the entrance is
// static, the rail cuts instead of fading, the drawer has no gesture.

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
  pointerEvents,
  children,
}: PropsWithChildren<{
  index?: number;
  style?: StyleProp<ViewStyle>;
  static?: boolean;
  pointerEvents?: 'box-none' | 'none' | 'auto';
}>) {
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

  if (isStatic) {
    return (
      <View style={style} pointerEvents={pointerEvents}>
        {children}
      </View>
    );
  }
  return (
    <Animated.View style={[style, anim]} pointerEvents={pointerEvents}>
      {children}
    </Animated.View>
  );
}

/** Hail/wind/severe swatches for the semantic storm palette (Drift #11: theme
 *  tokens, not the raw per-magnitude hex `severityColor()` plots with), plus
 *  the impacted-area band scale. The title says "from storm reports" — this is
 *  the buffered contour of real NOAA LSRs, NEVER radar (Drift #5). */
const STORM_LEGEND: LegendItem[] = [
  { label: 'Hail  < 1"  ·  1–1.5"  ·  1.5–2"  ·  2"+', ramp: colors.stormHail },
  { label: 'Wind  58–70  ·  70–86  ·  86+ mph', ramp: colors.stormWind },
  { label: 'Hail report', color: colors.stormHail },
  { label: 'Wind report', color: colors.stormWind },
  { label: 'Severe', color: colors.stormSevere },
];
const STORM_LEGEND_TITLE = 'Impacted area — hail / wind (from storm reports)';

/** Every knock outcome in its pin colour — the same disc Knock mode draws. */
const KNOCK_LEGEND: LegendItem[] = KNOCK_OUTCOMES.map((m) => ({
  label: m.short,
  color: outcomeColor(m.id),
  icon: outcomeIcon(m.id),
}));

/**
 * The reference's floating AI-insight pattern — the real storm-matched lead
 * cluster, now a row in the drawer. Only ever mounted with a genuine cluster
 * (Drift #5): the caller gates on `cluster`.
 */
function ClusterInsight({ cluster, onPress }: { cluster: StormLeadCluster; onPress: () => void }) {
  return (
    <PressableScale
      style={styles.insightCard}
      accessibilityRole="button"
      accessibilityLabel={`${cluster.headline}. Shows the matched leads on the map.`}
      onPress={onPress}
    >
      <IconChip name="thunderstorm" tone="orange" size="md" />
      <View style={styles.insightText}>
        <Text style={styles.insightLabel}>STORM MATCH</Text>
        <Text style={styles.insightHeadline} numberOfLines={2}>
          {cluster.headline}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
    </PressableScale>
  );
}

/**
 * One 56pt action inside a detail card's action row — Directions, Open,
 * Start route here, Remove. Tokens only (Drift #1 / #11); `tone="danger"`
 * is Remove's only use, never a confirm on its own (the caller shows
 * `ConfirmSheet` first).
 */
function DetailAction({
  icon,
  label,
  onPress,
  tone = 'default',
}: {
  icon: IoniconName;
  label: string;
  onPress: () => void;
  tone?: 'default' | 'danger';
}) {
  return (
    <PressableScale
      style={[styles.detailActionBtn, tone === 'danger' && styles.detailActionBtnDanger]}
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
    >
      <Ionicons name={icon} size={18} color={tone === 'danger' ? colors.danger : colors.brand} />
      <Text
        style={[styles.detailActionText, tone === 'danger' && styles.detailActionTextDanger]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </PressableScale>
  );
}

/** Wraps a detail card's `DetailAction` row — wraps to a second line on a
 *  narrow screen rather than squeezing three 56pt targets thin. */
function DetailActionsRow({ children }: { children: ReactNode }) {
  return <View style={styles.detailActionsRow}>{children}</View>;
}

/**
 * The one grammar every tapped pin's drawer card shares: chip, eyebrow,
 * title, an optional line of real data, a close button, and whatever action
 * row the caller passes as children — Directions everywhere (Feature 2),
 * plus Open / Start route / Remove where each pin kind offers them.
 */
function PinDetailCard({
  icon,
  tone,
  eyebrow,
  title,
  subtitle,
  subtitleLines = 2,
  onClose,
  children,
  testID,
}: {
  icon: IoniconName;
  tone: ChipTone;
  eyebrow: string;
  title: string;
  subtitle?: string;
  subtitleLines?: number;
  onClose: () => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.detailCardWrap} testID={testID}>
      <View style={styles.detailCard}>
        <IconChip name={icon} tone={tone} size="md" />
        <View style={styles.insightText}>
          <Text style={styles.insightLabel}>{eyebrow}</Text>
          <Text style={styles.insightHeadline} numberOfLines={2}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.detailRemark} numberOfLines={subtitleLines}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <PressableScale
          style={styles.detailClose}
          accessibilityRole="button"
          accessibilityLabel="Close details"
          onPress={onClose}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </PressableScale>
      </View>
      {children}
    </View>
  );
}

/**
 * Tap-a-pin detail: the real report, nothing inferred. Date, magnitude,
 * place, and the NWS remark when there is one — plus Directions out to the
 * phone's own navigation app (Feature 2; storm reports carry coordinates,
 * never a street address, so `openDirections` gets coords only).
 */
function StormDetailCard({
  event,
  onClose,
  onDirections,
}: {
  event: StormEvent;
  onClose: () => void;
  onDirections: () => void;
}) {
  const kind = event.type === 'hail' ? 'Hail' : 'Wind';
  const when = new Date(event.occurredAt);
  const where = [event.city, event.state].filter(Boolean).join(', ');
  return (
    <PinDetailCard
      testID="storm-detail"
      icon={event.type === 'hail' ? 'snow-outline' : 'flag-outline'}
      tone={event.type === 'hail' ? 'blue' : 'orange'}
      eyebrow={`${kind.toUpperCase()} · ${magnitudeLabel(event)}`}
      title={`${when.toLocaleDateString()} ${when.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}${where ? ` · ${where}` : ''}`}
      subtitle={event.remarks || undefined}
      subtitleLines={3}
      onClose={onClose}
    >
      <DetailActionsRow>
        <DetailAction icon="navigate-outline" label="Directions" onPress={onDirections} />
      </DetailActionsRow>
    </PinDetailCard>
  );
}

/** A lead pin's drawer card — Open (in-app, the existing callout nav) and
 *  Directions (Feature 2), so a tap on the pin itself offers the same two
 *  actions the callout balloon does. */
function LeadDetailCard({
  lead,
  inCore,
  onClose,
  onOpen,
  onDirections,
}: {
  lead: Lead;
  inCore: boolean;
  onClose: () => void;
  onOpen: () => void;
  onDirections: () => void;
}) {
  const miles = lead.lastStormMatch?.distanceMiles;
  const subtitle =
    inCore && miles != null
      ? `In storm core · ${miles.toFixed(1)} mi · ${lead.stage.replace('_', ' ')}`
      : `Stage: ${lead.stage.replace('_', ' ')}`;
  return (
    <PinDetailCard
      testID="lead-detail"
      icon="person-outline"
      tone={inCore ? 'orange' : 'blue'}
      eyebrow="LEAD"
      title={lead.customerName}
      subtitle={subtitle}
      onClose={onClose}
    >
      <DetailActionsRow>
        <DetailAction icon="open-outline" label="Open" onPress={onOpen} />
        <DetailAction icon="navigate-outline" label="Directions" onPress={onDirections} />
      </DetailActionsRow>
    </PinDetailCard>
  );
}

/** A job pin's drawer card — same Open + Directions pair as a lead. */
function JobDetailCard({
  job,
  onClose,
  onOpen,
  onDirections,
}: {
  job: Inspection;
  onClose: () => void;
  onOpen: () => void;
  onDirections: () => void;
}) {
  return (
    <PinDetailCard
      testID="job-detail"
      icon="hammer-outline"
      tone="orange"
      eyebrow="JOB"
      title={job.customerName}
      subtitle={`${job.reportId} · ${job.status.replace('_', ' ')}`}
      onClose={onClose}
    >
      <DetailActionsRow>
        <DetailAction icon="open-outline" label="Open" onPress={onOpen} />
        <DetailAction icon="navigate-outline" label="Directions" onPress={onDirections} />
      </DetailActionsRow>
    </PinDetailCard>
  );
}

/** A saved area's drawer card (the Saved layer) — Directions, start a route
 *  right here, or remove it (behind a `ConfirmSheet` — destructive action). */
function SavedAreaDetailCard({
  area,
  onClose,
  onDirections,
  onStartHere,
  onRemove,
}: {
  area: SavedArea;
  onClose: () => void;
  onDirections: () => void;
  onStartHere: () => void;
  onRemove: () => void;
}) {
  const storm = area.storm;
  const stormLine = storm
    ? [
        storm.town,
        storm.hailInches != null ? `Hail ${storm.hailInches.toFixed(2)}"` : null,
        storm.windMph != null ? `${Math.round(storm.windMph)} mph` : null,
      ]
        .filter(Boolean)
        .join(' · ')
    : null;
  return (
    <PinDetailCard
      testID="saved-area-detail"
      icon="bookmark"
      tone="green"
      eyebrow={`SAVED AREA · ${area.radiusMiles} MI CANVASS`}
      title={area.label}
      subtitle={stormLine || undefined}
      onClose={onClose}
    >
      <DetailActionsRow>
        <DetailAction icon="navigate-outline" label="Directions" onPress={onDirections} />
        <DetailAction icon="walk-outline" label="Start route" onPress={onStartHere} />
        <DetailAction icon="trash-outline" label="Remove" tone="danger" onPress={onRemove} />
      </DetailActionsRow>
    </PinDetailCard>
  );
}

/** The knock finder's canvass-ring pin (`?ring&ringLabel`) — its callout
 *  already opens the plan; this drawer card offers the same tap plus
 *  Directions when the roofer taps the pin itself instead of the callout. */
function RingDetailCard({
  label,
  radiusMiles,
  onClose,
  onOpenPlan,
  onDirections,
}: {
  label: string;
  radiusMiles: number;
  onClose: () => void;
  onOpenPlan: () => void;
  onDirections: () => void;
}) {
  return (
    <PinDetailCard
      testID="ring-detail"
      icon="compass-outline"
      tone="orange"
      eyebrow={`KNOCK AREA · ${radiusMiles} MI CANVASS`}
      title={label}
      onClose={onClose}
    >
      <DetailActionsRow>
        <DetailAction icon="open-outline" label="Open plan" onPress={onOpenPlan} />
        <DetailAction icon="navigate-outline" label="Directions" onPress={onDirections} />
      </DetailActionsRow>
    </PinDetailCard>
  );
}

/** One storm day in the drawer's list: newest first, the active one checked. */
function StormDayRow({ day, active, onPress }: { day: StormDay; active: boolean; onPress: () => void }) {
  const label = stormDayLabel(day);
  return (
    <Pressable
      style={({ pressed }) => [styles.dayRow, pressed && styles.rowPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? `Show every storm day` : `Show only ${label}`}
      accessibilityState={{ selected: active }}
    >
      <IconChip
        name={day.hailCount > 0 ? 'snow-outline' : 'flag-outline'}
        tone={day.hailCount > 0 ? 'blue' : 'orange'}
        size="sm"
      />
      <Text style={[styles.dayText, active && styles.dayTextActive]} numberOfLines={2}>
        {label}
      </Text>
      {active ? <Ionicons name="checkmark-circle" size={22} color={colors.brand} /> : null}
    </Pressable>
  );
}

function shortDayLabel(day: StormDay): string {
  return new Date(day.startMs).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function MapScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const {
    focus,
    filter: filterParam,
    lat: latParam,
    lng: lngParam,
    ring: ringParam,
    ringLabel: ringLabelParam,
  } = useLocalSearchParams<{
    focus?: string;
    filter?: string;
    lat?: string;
    lng?: string;
    /** Canvass radius in miles to draw around `lat,lng` (the knock finder). */
    ring?: string;
    ringLabel?: string;
  }>();
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const startSession = useKnockSessionStore((s) => s.start);
  const setRouteStops = useKnockSessionStore((s) => s.setRouteStops);
  const serviceAreas = useServiceAreaStore((s) => s.areas);
  const alerts = useStormAlertStore((s) => s.alerts);
  // Saved storm areas (Feature 1) — pinned from Select mode, kept for later.
  const savedAreas = useSavedAreas();
  const addSavedAreas = useSavedAreaStore((s) => s.addMany);
  const removeSavedArea = useSavedAreaStore((s) => s.remove);
  const toast = useToastStore((s) => s.show);

  // Chrome memory: rail tucked, drawer detent, satellite — per screen.
  const chrome = useMapChrome('storm');
  const panTuck = useMapPanTuck(chrome.tucked, chrome.setTucked);

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
  // Select mode (Feature 1): pick one or many storm pins, then save them or
  // start a knock route from them. Only meaningful on the Storms filter —
  // the rail button only shows there, and leaving the filter clears it.
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  // The other pin kinds' drawer cards (Feature 2's Directions lives here
  // too). At most one of these — plus `selectedEvent` above — is non-null;
  // switching the filter or tapping a new pin resets the others.
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [selectedSavedAreaId, setSelectedSavedAreaId] = useState<string | null>(null);
  const [ringDetailOpen, setRingDetailOpen] = useState(false);
  // "Remove this saved area?" — a destructive action gets a confirm sheet
  // (Drift #1), never a bare tap.
  const [confirmRemoveSavedId, setConfirmRemoveSavedId] = useState<string | null>(null);
  // Address search + my-location. The map was a viewport with no way to say
  // where to look; these are the two ways a real map does.
  const [searchText, setSearchText] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  // Follow-me: hold "my location". The camera rides along with the phone
  // until the roofer pans by hand.
  const [follow, setFollow] = useState(false);
  // The legend is a key over the map. Behind the rail's legend button, off by
  // default: a roofer in gloves wants the map, not a key to it.
  const [legendOpen, setLegendOpen] = useState(false);
  const [layersOpen, setLayersOpen] = useState(false);
  // Map area + drawer height, so the drawer sizes its detents and the Google
  // attribution chip (Expo Go iOS) stays above the drawer — Google requires
  // the credit visible.
  const [mapHeight, setMapHeight] = useState(0);
  const [drawerHeight, setDrawerHeight] = useState(0);

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
  // remounts on it. A settle that was not one of our own camera moves is a
  // hand pan: follow-me stops and the rail tucks (Apple Maps).
  const [region, setRegion] = useState<Region>(initialRegion);
  const regionRef = useRef(region);
  regionRef.current = region;
  const regionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onRegionChangeComplete = useCallback(
    (next: Region) => {
      if (!isValidRegion(next)) return;
      if (!panTuck.isAutoMove()) {
        setFollow(false);
        panTuck.onUserRegionSettled();
      }
      if (regionTimer.current) clearTimeout(regionTimer.current);
      regionTimer.current = setTimeout(() => {
        regionTimer.current = null;
        setRegion(next);
      }, REGION_DEBOUNCE_MS);
    },
    [panTuck],
  );
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
  // `?lat&lng` — a storm alert's core, the weather page's "storms near here",
  // a knock-finder area: land the camera on the point. With `?ring` (miles)
  // the area's canvass ring stays drawn, labelled, until the filter changes.
  // Consumed once applied.
  const [focusRing, setFocusRing] = useState<{ lat: number; lng: number; radiusMiles: number; label: string } | null>(null);
  useEffect(() => {
    const lat = Number(latParam);
    const lng = Number(lngParam);
    if (latParam && lngParam && isValidLatLon(lat, lng)) {
      // jumpTo is declared below; the effect runs after render so it exists.
      jumpToRef.current?.(lat, lng);
      const radiusMiles = Number(ringParam);
      if (ringParam && Number.isFinite(radiusMiles) && radiusMiles > 0) {
        setFocusRing({ lat, lng, radiusMiles, label: ringLabelParam || 'Knock area' });
      }
      router.setParams({ lat: '', lng: '', ring: '', ringLabel: '' });
    }
  }, [latParam, lngParam, ringParam, ringLabelParam, router]);
  const jumpToRef = useRef<((lat: number, lon: number) => void) | null>(null);

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
  const controlledEvents = useMemo(
    () => applyStormControls(browsedEvents(browse), { range, peril, magnitude }),
    [browse, range, peril, magnitude],
  );

  // Date scrubber (owner: "show me only the storms from June 14"). Storm days
  // are derived from what the controls leave; a chosen day that the current
  // controls no longer contain falls back to all days rather than an empty
  // map that looks like "no storms".
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const days = useMemo(() => stormDays(controlledEvents), [controlledEvents]);
  const activeDay = selectedDay && days.some((d) => d.day === selectedDay) ? selectedDay : null;
  const activeDayInfo = useMemo(() => days.find((d) => d.day === activeDay) ?? null, [days, activeDay]);
  const events = useMemo(
    () => (activeDay ? eventsOnDay(controlledEvents, activeDay) : controlledEvents),
    [controlledEvents, activeDay],
  );
  // Select mode resolves a chosen id back to its event (Save / Start route
  // need the real point, not just the id the overlay handed back). Built
  // from the same list `useStormOverlaySelection` sanitises, so every id it
  // can hand back resolves here — bar the rare duplicate-coordinate id that
  // sanitizeStormEvents re-keys (a few in a few thousand for a busy area);
  // that one drops out of a save/route silently rather than crashing one.
  const eventsById = useMemo(() => {
    // `Map` here is the JS built-in — this file's own `Map` (the map
    // component, imported from components/map/Map) shadows the global name.
    const map = new globalThis.Map<string, StormEvent>();
    for (const e of events) map.set(e.id, e);
    return map;
  }, [events]);

  /** Jump the camera. Search, my-location, a storm day and follow-me land here. */
  const jumpTo = useCallback(
    (lat: number, lon: number, delta: number = JUMP_REGION_DELTA) => {
      const next = regionForLatLon(lat, lon, delta);
      if (!isValidRegion(next)) return;
      panTuck.markAutoMove();
      mapRef.current?.animateToRegion(next, 450);
      // The settled-region callback fires after the animation; set it now too
      // so the fetch starts without waiting on the camera.
      setRegion(next);
    },
    [panTuck],
  );

  jumpToRef.current = jumpTo;

  const selectDay = useCallback(
    (day: string | null) => {
      if (day == null || day === activeDay) {
        setSelectedDay(null);
        return;
      }
      const info = days.find((d) => d.day === day);
      setSelectedDay(day);
      setSelectedEvent(null);
      if (info) jumpTo(info.centerLat, info.centerLon);
    },
    [activeDay, days, jumpTo],
  );

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

  const toggleFollow = useCallback(() => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    setFollow((v) => !v);
  }, []);

  // Follow-me rides the phone's fixes while on and focused; a denied
  // permission or any failure simply turns it back off (Drift #5: never a
  // pretend position).
  useEffect(() => {
    if (!follow || !isFocused) return;
    let cancelled = false;
    let sub: Location.LocationSubscription | null = null;
    (async () => {
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        if (perm.status !== 'granted') {
          if (!cancelled) {
            setFollow(false);
            setError('Location access is off — turn it on in Settings to follow your location.');
          }
          return;
        }
        sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, distanceInterval: 15, timeInterval: 3000 },
          (fix) => {
            if (cancelled) return;
            const delta = Math.min(regionRef.current.latitudeDelta, JUMP_REGION_DELTA);
            const next = regionForLatLon(fix.coords.latitude, fix.coords.longitude, delta);
            if (!isValidRegion(next)) return;
            panTuck.markAutoMove();
            mapRef.current?.animateToRegion(next, 400);
          },
        );
        if (cancelled) sub.remove();
      } catch {
        if (!cancelled) setFollow(false);
      }
    })();
    return () => {
      cancelled = true;
      sub?.remove();
    };
  }, [follow, isFocused, panTuck]);

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
  const { detent, setDetent } = chrome;

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
      panTuck.markAutoMove();
      mapRef.current?.animateToRegion(next, 350);
    },
    [region.latitudeDelta, region.longitudeDelta, panTuck],
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
  const activeKnockIds = useMemo(() => new Set((active?.knocks ?? []).map((k) => k.id)), [active]);

  // Storm-matched lead cluster for the live alert — "3 leads within 1.4 mi of
  // the Apr 18 hail core". Rebuilt from the leads Storm Watch stamped, so it
  // survives a restart. Null when nothing matched: no line, no highlight.
  const activeAlert = useMemo(() => alerts.find((a) => a.status === 'new'), [alerts]);
  const cluster = useMemo(
    () => (activeAlert ? leadsInStormCluster(leads, activeAlert) : null),
    [leads, activeAlert],
  );
  const clusterLeadIds = useMemo(() => new Set(cluster?.leadIds ?? []), [cluster]);

  // Feature 2's other tapped-pin cards: resolved from the id state so a
  // store change (a lead re-staged, a saved area removed elsewhere) never
  // leaves a stale object on screen — the card just disappears with its data.
  const selectedLead = useMemo(
    () => (selectedLeadId ? leadPins.find((l) => l.id === selectedLeadId) ?? null : null),
    [selectedLeadId, leadPins],
  );
  const selectedJob = useMemo(
    () => (selectedJobId ? jobPins.find((j) => j.id === selectedJobId) ?? null : null),
    [selectedJobId, jobPins],
  );
  const selectedSavedArea = useMemo(
    () => (selectedSavedAreaId ? savedAreas.find((a) => a.id === selectedSavedAreaId) ?? null : null),
    [selectedSavedAreaId, savedAreas],
  );

  // A tapped pin raises the drawer to half so its card is in view; closing it
  // lowers the drawer again only if this raise put it there. One card shows
  // at a time — the filter already keeps storm/lead/job/saved mutually
  // exclusive, and the canvass-ring pin only takes the slot when nothing
  // else has it.
  const raisedForDetail = useRef(false);
  const showStormDetail = filter === 'storms' && !!selectedEvent && selectedStillShown;
  const showLeadDetail = filter === 'leads' && !!selectedLead;
  const showJobDetail = filter === 'jobs' && !!selectedJob;
  const showSavedDetail = filter === 'saved' && !!selectedSavedArea;
  const showRingDetail =
    ringDetailOpen && !!focusRing && !showStormDetail && !showLeadDetail && !showJobDetail && !showSavedDetail;
  const showDetail = showStormDetail || showLeadDetail || showJobDetail || showSavedDetail || showRingDetail;
  useEffect(() => {
    if (showDetail && detent === 'peek') {
      raisedForDetail.current = true;
      setDetent('half');
    }
    // Only the selection should raise the drawer, not a hand-set detent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showDetail]);
  const closeDetail = useCallback(() => {
    setSelectedEvent(null);
    setSelectedLeadId(null);
    setSelectedJobId(null);
    setSelectedSavedAreaId(null);
    setRingDetailOpen(false);
    if (raisedForDetail.current) {
      raisedForDetail.current = false;
      if (chrome.detent === 'half') chrome.setDetent('peek');
    }
  }, [chrome]);

  // Select mode (Feature 1): toggle one pin, or every event in a tapped
  // cluster, into the running selection.
  const toggleSelectMode = useCallback(() => {
    setSelectMode((v) => {
      const next = !v;
      if (next) {
        // Entering select mode closes any open storm detail card — a pin tap
        // now toggles a selection instead of opening one.
        setSelectedEvent(null);
      } else {
        setSelectedIds(new Set());
      }
      return next;
    });
  }, []);
  const toggleEventSelected = useCallback((event: StormEvent) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(event.id)) next.delete(event.id);
      else next.add(event.id);
      return next;
    });
  }, []);
  const selectClusterMembers = useCallback((cell: StormClusterCell) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      const allSelected = cell.eventIds.length > 0 && cell.eventIds.every((id) => next.has(id));
      for (const id of cell.eventIds) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelectedIds(new Set()), []);

  // Start a route the proper way — permission → GPS watcher → mileage trip →
  // session (sessionTracker.startRoute), same as PlanView.startDay. A denied
  // permission still sets the plan on a fresh session (Drift #5: nothing the
  // roofer chose is lost) — Knock mode shows the permission card from there.
  const startKnockRoute = useCallback(
    async (stops: KnockRouteTarget[]) => {
      if (stops.length === 0) return;
      let ok = true;
      if (active) {
        setRouteStops(stops);
      } else {
        const r = await startRoute({ routeStops: stops });
        if (!r.ok) {
          startSession(undefined, stops[0], { routeStops: stops });
          ok = false;
        }
      }
      toast(
        ok
          ? {
              tone: 'success',
              title: 'Knock route started',
              body: `${stops.length} stop${stops.length === 1 ? '' : 's'} · first: ${stops[0].label}`,
            }
          : {
              tone: 'warn',
              title: 'Location is off',
              body: 'The route is set. Turn location on in Knock mode to place pins and count miles.',
            },
      );
      router.push('/door-knocking');
    },
    [active, setRouteStops, startSession, router, toast],
  );

  const saveSelectedAreas = useCallback(() => {
    const chosen = Array.from(selectedIds)
      .map((id) => eventsById.get(id))
      .filter((e): e is StormEvent => !!e);
    if (chosen.length === 0) return;
    const added = addSavedAreas(chosen.map((e) => stormEventToSavedArea(e, KNOCK_ROUTE_RADIUS_MILES)));
    toast({
      tone: 'success',
      title: `${added.length} area${added.length === 1 ? '' : 's'} saved`,
      body:
        added.length < chosen.length
          ? `${chosen.length - added.length} already saved nearby · find them on the Saved layer`
          : 'Find them on the Saved layer',
    });
  }, [selectedIds, eventsById, addSavedAreas, toast]);

  const startRouteFromSelection = useCallback(() => {
    const chosen = Array.from(selectedIds)
      .map((id) => eventsById.get(id))
      .filter((e): e is StormEvent => !!e);
    if (chosen.length === 0) return;
    const stops = chosen.map((e) => stormEventToRouteTarget(e, KNOCK_ROUTE_RADIUS_MILES));
    setSelectMode(false);
    setSelectedIds(new Set());
    void startKnockRoute(stops);
  }, [selectedIds, eventsById, startKnockRoute]);

  const startRouteFromSaved = useCallback(() => {
    if (savedAreas.length === 0) return;
    void startKnockRoute(savedAreas.map(savedAreaToRouteTarget));
  }, [savedAreas, startKnockRoute]);

  const startRouteFromOneSavedArea = useCallback(
    (area: SavedArea) => {
      void startKnockRoute([savedAreaToRouteTarget(area)]);
    },
    [startKnockRoute],
  );

  const toggleOverlays = useCallback(
    (next: boolean) => {
      setSelectedEvent(null);
      setOverlaysEnabled(next);
      if (next) setSafetyNotice(null);
    },
    [],
  );

  const resetStormControls = useCallback(() => {
    setRange(DEFAULT_RANGE);
    setPeril('both');
    setMagnitude('all');
    setSelectedDay(null);
    setSelectedEvent(null);
  }, []);

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

  const statLine =
    filter === 'storms'
      ? stormOverlayCountLine(selection, countWindow, {
          loading,
          unavailable: error != null,
          overlaysOff: !overlaysOn,
        })
      : filter === 'jobs'
        ? `${jobPins.length} of ${inspections.length} jobs mapped`
        : filter === 'leads'
          ? `${leadPins.length} of ${leads.length} leads mapped`
          : filter === 'saved'
            ? `${savedAreas.length} saved area${savedAreas.length === 1 ? '' : 's'}`
            : `${knockPins.length} knock pins`;

  // ---- the summary chip: what the map is showing, in one line -------------
  const filterLabel = FILTERS.find((f) => f.id === filter)?.label ?? 'Map';
  const rangeShort = RANGE_LABELS[range].replace(/^Past /, '');
  const perilShort = peril === 'both' ? 'Hail + wind' : peril === 'hail' ? 'Hail' : 'Wind';
  const magShort =
    magnitude === 'all' ? '' : ` ${MAGNITUDE_OPTIONS.find((m) => m.id === magnitude)?.label ?? ''}`;
  const dayShort = activeDayInfo ? shortDayLabel(activeDayInfo) : 'All days';
  const summary =
    filter === 'storms'
      ? `${filterLabel} · ${rangeShort} · ${perilShort}${magShort} · ${dayShort}${overlaysOn ? '' : ' · Overlays off'}${selectMode ? ' · Select mode' : ''}`
      : filter === 'leads'
        ? `${filterLabel} · ${leadPins.length} mapped`
        : filter === 'jobs'
          ? `${filterLabel} · ${jobPins.length} mapped`
          : filter === 'saved'
            ? `${filterLabel} · ${savedAreas.length} saved`
            : `${filterLabel} · ${knockPins.length} pins`;

  // Active-filter count for the layers badge: anything off its default.
  const activeFilterCount =
    (filter === 'storms'
      ? (range !== DEFAULT_RANGE ? 1 : 0) +
        (peril !== 'both' ? 1 : 0) +
        (magnitude !== 'all' ? 1 : 0) +
        (activeDay ? 1 : 0) +
        (overlaysOn ? 0 : 1)
      : 0) + (chrome.satellite ? 1 : 0);

  const legendAvailable = filter === 'storms' || filter === 'knocks';

  // ---- the rail ------------------------------------------------------------
  const rail: RailItem[] = [
    {
      key: 'search',
      icon: 'search',
      label: 'Search an address',
      active: searchOpen,
      onPress: () => setSearchOpen((v) => !v),
    },
    {
      key: 'locate',
      icon: follow ? 'navigate' : 'locate',
      label: 'Go to my location',
      longPressHint: follow ? 'Hold to stop following your location' : 'Hold to follow your location',
      onLongPress: toggleFollow,
      active: follow,
      busy: locating,
      onPress: goToMyLocation,
    },
    {
      key: 'layers',
      icon: 'layers-outline',
      label: 'Layers and filters',
      badge: activeFilterCount,
      onPress: () => setLayersOpen(true),
    },
  ];
  if (filter === 'storms') {
    // Select mode (Feature 1) — only meaningful on the Storms filter, where
    // there are storm pins to pick. Off elsewhere; leaving the filter turns
    // it back off too (see the layers sheet's filter row below).
    rail.push({
      key: 'select',
      icon: 'checkmark-circle-outline',
      label: selectMode ? 'Turn off select mode' : 'Select storm areas',
      active: selectMode,
      onPress: toggleSelectMode,
    });
  }
  if (legendAvailable) {
    rail.push({
      key: 'legend',
      icon: 'information-circle-outline',
      label: legendOpen ? 'Hide the legend' : 'Show the legend',
      active: legendOpen,
      onPress: () => setLegendOpen((v) => !v),
    });
  }
  rail.push({
    key: 'satellite',
    icon: chrome.satellite ? 'map-outline' : 'earth-outline',
    label: chrome.satellite ? 'Switch to the road map' : 'Switch to satellite',
    active: chrome.satellite,
    onPress: () => chrome.setSatellite(!chrome.satellite),
  });

  // ---- the layers & filters sheet -----------------------------------------
  const sections: LayersSection[] = [
    {
      key: 'show',
      title: 'Show on the map',
      rows: [
        {
          kind: 'choice',
          key: 'filter',
          options: FILTERS.map((f) => ({ id: f.id, label: f.label, icon: f.icon, a11yLabel: `Show ${f.label}` })),
          value: filter,
          onChange: (id) => {
            setSelectedEvent(null);
            setSelectedLeadId(null);
            setSelectedJobId(null);
            setSelectedSavedAreaId(null);
            setRingDetailOpen(false);
            if (id !== 'storms') {
              setSelectMode(false);
              setSelectedIds(new Set());
            }
            setFilter(id as Filter);
          },
        },
      ],
    },
  ];
  if (filter === 'storms') {
    sections.push({
      key: 'range',
      title: 'Time range',
      rows: [
        {
          kind: 'choice',
          key: 'range',
          options: RANGE_ORDER.map((r) => ({ id: r, label: RANGE_LABELS[r], icon: 'time-outline' })),
          value: range,
          onChange: (id) => setRange(id as Range),
        },
      ],
    });
    if (days.length > 0) {
      sections.push({
        key: 'day',
        title: 'Storm day',
        hint: "Isolate one event's footprint",
        rows: [
          {
            kind: 'choice',
            key: 'day',
            layout: 'list',
            options: [
              { id: ALL_DAYS, label: 'All days', icon: 'calendar-outline', a11yLabel: 'Show every storm day' },
              ...days.slice(0, STORM_DAY_CHIPS).map((d) => ({
                id: d.day,
                label: stormDayLabel(d),
                icon: (d.hailCount > 0 ? 'snow-outline' : 'flag-outline') as 'snow-outline' | 'flag-outline',
                a11yLabel: `Show only ${stormDayLabel(d)}`,
              })),
            ],
            value: activeDay ?? ALL_DAYS,
            onChange: (id) => selectDay(id === ALL_DAYS ? null : id),
          },
        ],
      });
    }
    sections.push(
      {
        key: 'peril',
        title: 'Peril',
        rows: [
          {
            kind: 'choice',
            key: 'peril',
            options: PERILS.map((p) => ({ id: p.id, label: p.label, icon: p.icon, a11yLabel: `Show ${p.label.toLowerCase()} reports` })),
            value: peril,
            onChange: (id) => setPeril(id as Peril),
          },
        ],
      },
      {
        key: 'magnitude',
        title: 'Magnitude',
        rows: [
          {
            kind: 'choice',
            key: 'magnitude',
            options: MAGNITUDE_OPTIONS.map((m) => ({ id: m.id, label: m.label, icon: 'speedometer-outline' })),
            value: magnitude,
            onChange: (id) => setMagnitude(id as Magnitude),
          },
        ],
      },
    );
  }
  const mapRows: LayersRow[] = [];
  if (filter === 'storms') {
    // Overlays toggle — the reversible half of safety mode, and a plain
    // "quiet the map" control the rest of the time.
    mapRows.push({
      kind: 'toggle',
      key: 'overlays',
      label: 'Storm overlays',
      hint: 'Impacted-area swaths and report pins',
      icon: 'layers-outline',
      value: overlaysOn,
      onChange: toggleOverlays,
      a11yOn: 'Show storm overlays',
      a11yOff: 'Hide storm overlays',
    });
  }
  mapRows.push({
    kind: 'toggle',
    key: 'satellite',
    label: 'Satellite imagery',
    hint: 'Aerial photos instead of the road map',
    icon: 'earth-outline',
    value: chrome.satellite,
    onChange: chrome.setSatellite,
    a11yOn: 'Switch to satellite',
    a11yOff: 'Switch to the road map',
  });
  if (legendAvailable) {
    mapRows.push({
      kind: 'toggle',
      key: 'legend',
      label: 'Legend',
      hint: filter === 'storms' ? 'Hail / wind bands and report colours' : 'Every pin colour',
      icon: 'information-circle-outline',
      value: legendOpen,
      onChange: setLegendOpen,
      a11yOn: 'Show the legend',
      a11yOff: 'Hide the legend',
    });
  }
  sections.push(
    { key: 'map', title: 'Map', rows: mapRows },
    {
      key: 'tools',
      title: 'Tools',
      rows: [
        {
          kind: 'link',
          key: 'planner',
          label: 'Knock Planner',
          hint: 'Find the best storm-hit streets',
          icon: 'compass-outline',
          a11yLabel: 'Knock Planner — find the best storm-hit streets',
          onPress: () => {
            setLayersOpen(false);
            router.push('/knock-finder');
          },
        },
      ],
    },
  );

  const dayRows = days.slice(0, STORM_DAY_CHIPS);

  return (
    <View style={styles.root}>
      {/* Large title on the grouped ground. Settings is one tap from this
          root too (shared affordance on every tab). Knock mode — this
          screen's single accent action — lives in the drawer's thumb zone. */}
      <Rise index={0} static={safetyMode}>
        <ScreenHeader
          title={filter === 'storms' ? 'Storm Tracer' : 'Map'}
          right={<SettingsAffordance />}
        />
      </Rise>

      {/* Density: the map fills everything under the header — the full-bleed
          cinematic moment. Controls float over the imagery as real glass. */}
      <View
        style={styles.mapWrap}
        onLayout={(e) => setMapHeight(Math.round(e.nativeEvent.layout.height))}
      >
        {/* A touch that MOVES over the map tucks the rail (see useMapPanTuck);
            the chrome is a sibling, so its own taps never count. */}
        <View
          style={StyleSheet.absoluteFill}
          onTouchStart={panTuck.onTouchStart}
          onTouchMove={panTuck.onTouchMove}
          onTouchEnd={panTuck.onTouchEnd}
          onTouchCancel={panTuck.onTouchEnd}
        >
          <Map
            ref={mapRef}
            initialRegion={initialRegion}
            onRegionChangeComplete={onRegionChangeComplete}
            mapType={chrome.satellite ? 'satellite' : 'standard'}
            // Web preview only: the fallback panel top-anchors under the
            // floating chip row (list-screen empty-state pattern) instead of
            // centering in the void.
            fallbackTopOffset={spacing.md + touchTarget.standard + spacing.xl}
            attributionInset={{ bottom: drawerHeight + spacing.sm }}
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
            {/* The knock finder's chosen area: its 3-mi canvass ring and a
                labelled pin whose callout goes back to the plan; a tap on the
                pin itself opens the same card in the drawer (Feature 2's
                Directions lives there — the callout keeps its own nav too). */}
            {focusRing && (
              <>
                <MapCircle
                  center={{ latitude: focusRing.lat, longitude: focusRing.lng }}
                  radius={focusRing.radiusMiles * 1609.34}
                  strokeColor={colors.accent}
                  strokeWidth={3}
                  fillColor={colors.accentSoft}
                />
                <MapPin
                  coordinate={{ latitude: focusRing.lat, longitude: focusRing.lng }}
                  title={focusRing.label}
                  description={`${focusRing.radiusMiles} mi canvass radius · tap for the plan`}
                  tone="orange"
                  onPress={() => setRingDetailOpen(true)}
                  onCalloutPress={() => router.push('/knock-finder')}
                />
              </>
            )}
            {filter === 'storms' && overlaysOn && (
              <StormOverlay
                selection={selection}
                swaths={swaths}
                swathEmphasis={swathEmphasisForRegion(region)}
                // Select mode intercepts the tap: a pin toggles into the
                // running selection, a cluster toggles its whole membership,
                // instead of opening the detail card / zooming in.
                onSelectEvent={selectMode ? toggleEventSelected : setSelectedEvent}
                onSelectCluster={selectMode ? selectClusterMembers : onSelectCluster}
                selected={selectMode ? selectedIds : undefined}
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
                  onPress={() => setSelectedJobId(ins.id)}
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
                    // The pin itself opens the drawer's Open + Directions card
                    // (Feature 2); the callout keeps its own in-app nav too.
                    onPress={() => setSelectedLeadId(lead.id)}
                    onCalloutPress={() => router.push(`/lead/${lead.id}` as any)}
                    tone={inCore ? 'danger' : 'info'}
                  />
                );
              })}
            {/* Every knocked house in its outcome colour + glyph — the same disc
                Knock mode draws, so the two maps never disagree. Earlier
                routes' pins are muted; a tap opens Knock mode, where the pin's
                sheet lives (history, follow-up, lead). */}
            {filter === 'knocks' &&
              knockPins.map((k) => (
                <KnockPinMarker
                  key={k.id}
                  knock={k}
                  muted={!activeKnockIds.has(k.id)}
                  onPress={() => router.push('/door-knocking')}
                />
              ))}
            {/* Saved areas (Feature 1) — every pin Select mode saved, kept for
                a later day: its canvass ring plus a pin that opens the
                drawer's Directions / Start route here / Remove card. */}
            {filter === 'saved' &&
              savedAreas.map((a) => (
                <Fragment key={a.id}>
                  <MapCircle
                    center={{ latitude: a.lat, longitude: a.lng }}
                    radius={a.radiusMiles * 1609.34}
                    strokeColor={colors.success}
                    strokeWidth={2}
                    fillColor={colors.successSoft}
                  />
                  <MapPin
                    coordinate={{ latitude: a.lat, longitude: a.lng }}
                    title={a.label}
                    description={`${a.radiusMiles} mi canvass · saved ${new Date(a.savedAt).toLocaleDateString()}`}
                    tone="success"
                    onPress={() => setSelectedSavedAreaId(a.id)}
                  />
                </Fragment>
              ))}
          </Map>
        </View>

        {/* Top chrome: the summary chip (or the expanded search) on the left,
            the control rail on the right. Everything is glass (real BlurView
            on iOS, tinted-fill fallback elsewhere), glove-sized either way. */}
        <Rise index={1} static={safetyMode} style={styles.overlayTop} pointerEvents="box-none">
          <View style={styles.overlayLeft} pointerEvents="box-none">
            {searchOpen ? (
              // Where to look: an address. A map that cannot be pointed
              // somewhere is a picture.
              <View style={styles.searchShadow}>
                <GlassCard onLight onArt radius={radii.lg} style={styles.searchCard}>
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
                  <PressableScale
                    style={styles.searchClose}
                    accessibilityRole="button"
                    accessibilityLabel="Close search"
                    onPress={() => {
                      Keyboard.dismiss();
                      setSearchOpen(false);
                    }}
                  >
                    <Ionicons name="close" size={22} color={colors.text} />
                  </PressableScale>
                </GlassCard>
              </View>
            ) : (
              <SummaryChip text={summary} onPress={() => setLayersOpen(true)} testID="map-summary" />
            )}
            {loading && (
              <View style={styles.loadingShadow}>
                <GlassCard onLight onArt radius={radii.pill} style={styles.loadingPill}>
                  <ActivityIndicator color={colors.navy} />
                  <Text style={styles.loadingText}>Loading storms</Text>
                </GlassCard>
              </View>
            )}
            {legendOpen && legendAvailable && (
              <LegendStrip
                title={filter === 'storms' ? STORM_LEGEND_TITLE : 'Knock pins'}
                items={filter === 'storms' ? STORM_LEGEND : KNOCK_LEGEND}
                testID="map-legend"
              />
            )}
          </View>
          <ControlRail
            items={rail}
            tucked={chrome.tucked}
            onTuckedChange={chrome.setTucked}
            hidden={chrome.detent !== 'peek'}
            animated={!safetyMode}
            testID="map-rail"
          />
        </Rise>

        {/* The drawer: stat line + Knock Planner at peek, the report / cluster /
            storm days above the one primary CTA when raised. Real numbers
            only — each row is absent when there's nothing to report. */}
        <MapDrawer
          detent={chrome.detent}
          onDetentChange={chrome.setDetent}
          containerHeight={mapHeight}
          animated={!safetyMode}
          onHeightChange={setDrawerHeight}
          accessibilityLabel="Storm Tracer panel"
          testID="map-drawer"
          header={
            <View style={styles.drawerHead}>
              {safetyMode && !overlaysOn && (
                <PressableScale
                  style={styles.safetyRow}
                  accessibilityRole="button"
                  accessibilityLabel="Loaded without storm overlays after a crash. Turn them on."
                  onPress={() => {
                    setOverlaysEnabled(true);
                    setSafetyNotice(null);
                  }}
                >
                  <Ionicons name="shield-checkmark-outline" size={22} color={colors.warn} />
                  <Text style={styles.safetyText} numberOfLines={2}>
                    Loaded without storm overlays after a crash — tap to turn them on
                  </Text>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </PressableScale>
              )}
              {error && (
                <View style={styles.errorRow}>
                  <Ionicons name="cloud-offline-outline" size={16} color={colors.danger} />
                  <Text style={styles.errorText} numberOfLines={2}>
                    {error}
                  </Text>
                </View>
              )}
              {/* Select mode's action bar (Feature 1): visible at every detent,
                  same as the safety/error rows above, so it is never buried
                  under whatever the drawer is showing at half or full. */}
              {selectMode && selectedIds.size > 0 && (
                <View style={styles.selectionBar} testID="map-selection-bar">
                  <Text style={styles.selectionCount} numberOfLines={1}>
                    {selectedIds.size} area{selectedIds.size === 1 ? '' : 's'} selected
                  </Text>
                  <View style={styles.selectionActions}>
                    <PressableScale
                      style={styles.selectionBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Save selected areas"
                      onPress={saveSelectedAreas}
                    >
                      <Ionicons name="bookmark-outline" size={18} color={colors.brand} />
                      <Text style={styles.selectionBtnText}>Save</Text>
                    </PressableScale>
                    <PressableScale
                      style={[styles.selectionBtn, styles.selectionBtnPrimary]}
                      accessibilityRole="button"
                      accessibilityLabel="Start a knock route from selected areas"
                      onPress={startRouteFromSelection}
                    >
                      <Ionicons name="walk-outline" size={18} color={colors.textInverse} />
                      <Text style={[styles.selectionBtnText, styles.selectionBtnPrimaryText]}>Start route</Text>
                    </PressableScale>
                    <PressableScale
                      style={styles.selectionClearBtn}
                      accessibilityRole="button"
                      accessibilityLabel="Clear selection"
                      onPress={clearSelection}
                    >
                      <Ionicons name="close" size={20} color={colors.text} />
                    </PressableScale>
                  </View>
                </View>
              )}
              {/* The Saved layer's one-tap route (Feature 1): every saved area
                  becomes a stop, in one route, the moment the roofer is ready
                  to canvass what Select mode picked earlier. */}
              {filter === 'saved' && savedAreas.length > 0 && (
                <PressableScale
                  style={styles.savedRouteBar}
                  accessibilityRole="button"
                  accessibilityLabel={`Start a knock route from ${savedAreas.length} saved areas`}
                  onPress={startRouteFromSaved}
                >
                  <Ionicons name="walk-outline" size={18} color={colors.textInverse} />
                  <Text style={styles.savedRouteBarText} numberOfLines={1}>
                    Start route from {savedAreas.length} saved area{savedAreas.length === 1 ? '' : 's'}
                  </Text>
                </PressableScale>
              )}
              <View style={styles.drawerHeadRow}>
                <Text style={styles.statText} numberOfLines={2} testID="map-stat">
                  {statLine}
                </Text>
                {/* The one-button opportunity finder — the map's data, scored
                    and turned into a day plan. */}
                <PressableScale
                  style={styles.plannerBtn}
                  accessibilityRole="button"
                  accessibilityLabel="Knock Planner — find the best storm-hit streets"
                  onPress={() => router.push('/knock-finder')}
                >
                  <Ionicons name="compass-outline" size={18} color={colors.brand} />
                  <Text style={styles.plannerText}>Planner</Text>
                </PressableScale>
              </View>
            </View>
          }
          footer={
            <PressableScale
              style={styles.cta}
              accessibilityRole="button"
              accessibilityLabel="Knock mode"
              onPress={() => router.push('/door-knocking')}
            >
              <Ionicons name="walk-outline" size={24} color={colors.textInverse} />
              <Text style={styles.ctaText}>Knock mode</Text>
            </PressableScale>
          }
        >
          {showStormDetail && selectedEvent && (
            <StormDetailCard
              event={selectedEvent}
              onClose={closeDetail}
              onDirections={() => openDirections('', { lat: selectedEvent.lat, lng: selectedEvent.lon })}
            />
          )}
          {showLeadDetail && selectedLead && (
            <LeadDetailCard
              lead={selectedLead}
              inCore={clusterLeadIds.has(selectedLead.id)}
              onClose={closeDetail}
              onOpen={() => router.push(`/lead/${selectedLead.id}` as any)}
              onDirections={() => openDirections(selectedLead.address, { lat: selectedLead.lat, lng: selectedLead.lng })}
            />
          )}
          {showJobDetail && selectedJob && (
            <JobDetailCard
              job={selectedJob}
              onClose={closeDetail}
              onOpen={() => router.push(`/job/${selectedJob.id}` as any)}
              onDirections={() => openDirections(selectedJob.address, { lat: selectedJob.lat, lng: selectedJob.lng })}
            />
          )}
          {showSavedDetail && selectedSavedArea && (
            <SavedAreaDetailCard
              area={selectedSavedArea}
              onClose={closeDetail}
              onDirections={() => openDirections('', { lat: selectedSavedArea.lat, lng: selectedSavedArea.lng })}
              onStartHere={() => startRouteFromOneSavedArea(selectedSavedArea)}
              onRemove={() => setConfirmRemoveSavedId(selectedSavedArea.id)}
            />
          )}
          {showRingDetail && focusRing && (
            <RingDetailCard
              label={focusRing.label}
              radiusMiles={focusRing.radiusMiles}
              onClose={closeDetail}
              onOpenPlan={() => router.push('/knock-finder')}
              onDirections={() => openDirections('', { lat: focusRing.lat, lng: focusRing.lng })}
            />
          )}
          {cluster && <ClusterInsight cluster={cluster} onPress={() => setFilter('leads')} />}
          {filter === 'storms' && dayRows.length > 0 && (
            <View style={styles.daysBlock}>
              <SectionHeader
                title={`Storm days · ${days.length}`}
                action={activeDay ? { label: 'All days', icon: null, onPress: () => selectDay(null) } : undefined}
              />
              <View style={styles.dayList}>
                {dayRows.map((d) => (
                  <StormDayRow key={d.day} day={d} active={activeDay === d.day} onPress={() => selectDay(d.day)} />
                ))}
              </View>
            </View>
          )}
          {filter !== 'storms' && !cluster && !showDetail && (
            <Text style={styles.drawerHint}>
              {filter === 'knocks'
                ? 'Tap a knock pin to open it in Knock mode.'
                : filter === 'saved'
                  ? savedAreas.length > 0
                    ? 'Tap a saved pin for directions, to start a route there, or to remove it.'
                    : 'Select storm pins on the Storms filter, then Save — they show up here.'
                  : `Tap a pin for directions, or its callout to open the ${filter === 'leads' ? 'lead' : 'job'}.`}
            </Text>
          )}
        </MapDrawer>
      </View>

      <ConfirmSheet
        visible={confirmRemoveSavedId != null}
        title="Remove this saved area?"
        body={savedAreas.find((a) => a.id === confirmRemoveSavedId)?.label}
        confirmLabel="Remove"
        cancelLabel="Keep"
        onClose={() => setConfirmRemoveSavedId(null)}
        onConfirm={() => {
          if (!confirmRemoveSavedId) return;
          removeSavedArea(confirmRemoveSavedId);
          if (selectedSavedAreaId === confirmRemoveSavedId) setSelectedSavedAreaId(null);
          setConfirmRemoveSavedId(null);
        }}
      />

      <LayersSheet
        visible={layersOpen}
        onClose={() => setLayersOpen(false)}
        subtitle={summary}
        sections={sections}
        onReset={filter === 'storms' ? resetStormControls : undefined}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },

  // Full-bleed map under a hairline — the screen's content IS the map.
  mapWrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },

  // Top chrome row: left column (chip / search / legend), right rail.
  overlayTop: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
  },
  overlayLeft: { flex: 1, gap: spacing.sm, alignItems: 'flex-start' },

  // Expanded search: the field + a 56pt close, in one glass panel.
  searchShadow: { alignSelf: 'stretch', borderRadius: radii.lg, ...shadows.float },
  searchCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingLeft: spacing.sm,
    paddingRight: spacing.xs,
    paddingVertical: spacing.xs,
  },
  searchField: { flex: 1 },
  searchClose: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },

  loadingShadow: { borderRadius: radii.pill, ...shadows.float },
  loadingPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  loadingText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text },

  // Drawer header: the stat line beside the Planner button (56pt).
  drawerHead: { gap: spacing.sm },
  drawerHeadRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  statText: {
    flex: 1,
    color: colors.text,
    fontFamily: fontFamily.archivo.medium,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    fontVariant: ['tabular-nums'],
  },
  plannerBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.brandSoft,
  },
  plannerText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.brand },

  // Select mode's action bar — "N areas selected" + Save / Start route /
  // Clear. Lives in the drawer header so it is visible at every detent, same
  // grammar as the safety/error rows above it.
  selectionBar: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.brandSoft,
  },
  selectionCount: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.text },
  selectionActions: { flexDirection: 'row', gap: spacing.sm },
  selectionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    flexGrow: 1,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },
  selectionBtnPrimary: { backgroundColor: colors.brand },
  selectionBtnText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.brand },
  selectionBtnPrimaryText: { color: colors.textInverse },
  selectionClearBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radii.button,
    backgroundColor: colors.surface,
  },

  // The Saved layer's "Start route from N saved areas" — one full-width 56pt
  // bar, the same burnt accent Knock mode's own CTA wears.
  savedRouteBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    borderRadius: radii.button,
    backgroundColor: colors.accent,
  },
  savedRouteBarText: { fontFamily: fontFamily.archivo.bold, fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.textInverse },

  // The one primary CTA — 88pt, burnt, in the thumb zone at every detent.
  // Full-pill radius: the same floating-pill family as the tab bar and every
  // other 1A primary action (docs/DESIGN_1A.md §4).
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    ...shadows.card,
  },
  ctaText: { color: colors.textInverse, fontFamily: fontFamily.archivo.bold, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },

  // Safety-mode row: one line, one tap, ≥56pt.
  safetyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: touchTarget.standard,
    borderRadius: radii.card,
    backgroundColor: colors.warnSoft,
  },
  safetyText: {
    flex: 1,
    fontFamily: fontFamily.archivo.semibold,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  errorRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.card,
    backgroundColor: colors.dangerSoft,
  },
  // Ink, not danger, for the words: danger-on-dangerSoft is 3.7:1, ink is
  // 15:1 (Drift #1). The icon carries the tone.
  errorText: { flex: 1, color: colors.text, fontFamily: fontFamily.archivo.medium, fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },

  // Storm-lead cluster row (real counts only) and the storm detail card share
  // one grammar: chip, two-line text, trailing affordance.
  insightCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    minHeight: touchTarget.standard,
    borderRadius: radii.card,
    backgroundColor: colors.accentSoft,
  },
  insightText: { flex: 1, gap: 1 },
  // "STORM MATCH" / "LEAD" / "SAVED AREA · 3 MI CANVASS" — the mock's mono
  // eyebrow convention for a storm-event citation (docs/DESIGN_1A.md §3).
  insightLabel: { ...dataLabel, color: colors.accent },
  insightHeadline: {
    fontFamily: fontFamily.archivo.semibold,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  // A tapped pin's card: the chip/text/close header (unchanged look) plus an
  // action row underneath — Directions everywhere, Open / Start route /
  // Remove where each pin kind offers them (Feature 2 / Feature 1).
  detailCardWrap: { gap: spacing.sm },
  detailCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: touchTarget.standard,
    borderRadius: radii.card,
    backgroundColor: colors.brandSoft,
  },
  detailRemark: {
    fontFamily: fontFamily.archivo.regular,
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
  // Wraps rather than squeezing three 56pt targets thin on a narrow phone.
  detailActionsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  detailActionBtn: {
    flexGrow: 1,
    flexBasis: 108,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  detailActionBtnDanger: { backgroundColor: colors.dangerSoft },
  detailActionText: { fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold, color: colors.brand },
  detailActionTextDanger: { color: colors.danger },

  // Storm days — one 56pt row per day, newest first.
  daysBlock: { gap: spacing.sm },
  dayList: { borderRadius: radii.card, backgroundColor: colors.fillQuiet, overflow: 'hidden' },
  dayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  rowPressed: { opacity: 0.7 },
  dayText: { flex: 1, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodyMd, color: colors.text },
  dayTextActive: { fontFamily: fontFamily.archivo.semibold, fontWeight: fontWeight.semibold, color: colors.brand },

  drawerHint: { fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm, color: colors.textMuted, paddingVertical: spacing.sm },
});
