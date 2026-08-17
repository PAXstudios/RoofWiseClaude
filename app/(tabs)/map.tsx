import { useEffect, useMemo, useState, type PropsWithChildren } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { Map, MapPin, MapCircle, regionForLatLon } from '@/components/map/Map';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
import { severityColor, magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { resolveServiceCenter } from '@/lib/services/serviceState';
import {
  fetchAddressStormHistory,
  clampLookbackYears,
  HISTORY_LOOKBACK_YEARS_MAX,
} from '@/lib/services/stormMatch';
import {
  leadsInStormCluster,
  STORM_HISTORY_BROWSE_RADIUS_MILES,
} from '@/lib/services/stormWatch';
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
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Filter = 'leads' | 'jobs' | 'storms' | 'knocks';

const FILTERS: { id: Filter; label: string; icon: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap }[] = [
  { id: 'leads', label: 'Leads', icon: 'people-outline' },
  { id: 'jobs', label: 'Jobs', icon: 'hammer-outline' },
  { id: 'storms', label: 'Storms', icon: 'thunderstorm-outline' },
  { id: 'knocks', label: 'Knocks', icon: 'walk-outline' },
];

/**
 * Time Travel lookbacks (years). The service clamps to
 * HISTORY_LOOKBACK_YEARS_MAX = 4; 1 year stays the default so opening the tab
 * doesn't pull four years of state-wide reports over cellular. This is the
 * history-*browsing* window — deliberately separate from the 2-year claim
 * corroboration cap (docs/HAAG_DECISION_ENGINE.md §6).
 */
const LOOKBACK_OPTIONS = [1, 2, HISTORY_LOOKBACK_YEARS_MAX] as const;
const DEFAULT_LOOKBACK_YEARS = 1;

/** Storm pins drawn at once. The count line always reports the real total. */
const MAX_STORM_PINS = 300;

/**
 * Deep-link target for the dashboard storm-alert hero: land on the Leads
 * filter with the storm-matched pins already highlighted.
 * `router.push({ pathname: '/(tabs)/map', params: { focus: FOCUS_STORM_LEADS } })`
 */
export const FOCUS_STORM_LEADS = 'storm-leads';

// First-paint-only entrance gate — same pattern as Home. Returning to the
// Map tab (remounted under expo-router's Slot) renders statically instead of
// replaying the stagger. Dev fast-refresh resets it, which is fine.
let mapEntrancePlayed = false;

/**
 * Subtle iOS entrance: 8pt rise + fade on the snappy spring, staggered by
 * index. Same reanimated primitives the repo already ships on web.
 */
function Rise({
  index = 0,
  style,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(mapEntrancePlayed ? 1 : 0);

  useEffect(() => {
    if (progress.value === 1) return;
    const id = setTimeout(() => {
      progress.value = withSpring(1, motion.snappy);
    }, index * motion.staggerDelayMs);
    return () => clearTimeout(id);
    // Entrance runs once per mount by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const anim = useAnimatedStyle(() => ({
    opacity: Math.min(1, progress.value),
    transform: [{ translateY: (1 - progress.value) * spacing.sm }],
  }));

  return <Animated.View style={[style, anim]}>{children}</Animated.View>;
}

export default function MapScreen() {
  const router = useRouter();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const serviceAreas = useServiceAreaStore((s) => s.areas);
  const alerts = useStormAlertStore((s) => s.alerts);

  const [filter, setFilter] = useState<Filter>(
    focus === FOCUS_STORM_LEADS ? 'leads' : 'storms',
  );
  const [lookbackYears, setLookbackYears] = useState<number>(DEFAULT_LOOKBACK_YEARS);
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Flip the entrance gate after the first mount's children have scheduled
  // their animations (child effects run before this parent effect).
  useEffect(() => {
    mapEntrancePlayed = true;
  }, []);

  // Follows the saved Service Area rather than assuming Texas.
  const { state: serviceState, ...center } = useMemo(
    () => resolveServiceCenter(),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [serviceAreas, inspections],
  );
  const initialRegion = regionForLatLon(center.lat, center.lon, 4);

  // The Map tab is pre-mounted by the tab navigator, so a deep link can arrive
  // while this screen is already alive — react to the param, don't rely on the
  // initial state alone.
  useEffect(() => {
    if (focus === FOCUS_STORM_LEADS) setFilter('leads');
  }, [focus]);

  // Storm history now runs through the shared, 4-year-clamped address lookback
  // (stormMatch.fetchAddressStormHistory) instead of a raw NOAA call: same
  // published validation floors as every other storm surface, and an explicit
  // "unavailable" result rather than a silent empty map (Drift #5).
  useEffect(() => {
    if (filter !== 'storms') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAddressStormHistory({
      lat: center.lat,
      lng: center.lon,
      state: serviceState,
      lookbackYears,
      radiusMiles: STORM_HISTORY_BROWSE_RADIUS_MILES,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 'ok') {
          setEvents(res.events);
        } else {
          setEvents([]);
          setError('Storm history not available right now.');
        }
      })
      .catch(() => {
        if (cancelled) return;
        setEvents([]);
        setError('Storm history not available right now.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [filter, serviceState, lookbackYears, center.lat, center.lon]);

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

  const stormPins = useMemo(() => events.slice(0, MAX_STORM_PINS), [events]);

  return (
    <View style={styles.root}>
      {/* Large title on the grouped ground. Knock mode is this screen's single
          accent action — everything else over the map goes quiet. */}
      <Rise index={0}>
        <ScreenHeader
          title="Map"
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

      {/* Density: the map fills everything under the header; controls float
          over the imagery on barFill so they stay readable in sun. */}
      <View style={styles.mapWrap}>
        <Map
          initialRegion={initialRegion}
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
        >
          {serviceAreas
            .filter((a) => typeof a.centroidLat === 'number' && typeof a.centroidLng === 'number')
            .map((a) => (
              <MapCircle
                key={a.id}
                center={{ latitude: a.centroidLat!, longitude: a.centroidLng! }}
                radius={8047}  // 5 mi in meters
                strokeColor={colors.navy}
                strokeWidth={2}
                fillColor={glass.lightFill}
              />
            ))}
          {filter === 'storms' &&
            stormPins.map((e) => (
              <MapPin
                key={e.id}
                coordinate={{ latitude: e.lat, longitude: e.lon }}
                title={`${e.type === 'hail' ? 'Hail' : 'Wind'} · ${magnitudeLabel(e)}`}
                description={`${new Date(e.occurredAt).toLocaleDateString()} ${e.city ?? ''}`}
                pinColor={severityColor(e)}
              />
            ))}
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

        {/* Floating control chips — barFill ground + hairline + float shadow
            so they read over imagery; glove-sized (≥56pt). */}
        <View style={styles.overlayTop} pointerEvents="box-none">
          <Rise index={1}>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={styles.chipScroll}
              contentContainerStyle={styles.chipScrollContent}
            >
              {FILTERS.map((f) => (
                <PressableScale
                  key={f.id}
                  style={[styles.chip, filter === f.id && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: filter === f.id }}
                  accessibilityLabel={`Show ${f.label}`}
                  onPress={() => setFilter(f.id)}
                >
                  <Ionicons
                    name={f.icon}
                    size={16}
                    color={filter === f.id ? colors.textInverse : colors.text}
                  />
                  <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
                    {f.label}
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          </Rise>

          {filter === 'storms' && (
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              style={[styles.chipScroll, styles.chipScrollSecond]}
              contentContainerStyle={styles.chipScrollContent}
            >
              {LOOKBACK_OPTIONS.map((years) => (
                <PressableScale
                  key={years}
                  style={[styles.chip, lookbackYears === years && styles.chipActive]}
                  accessibilityRole="button"
                  accessibilityState={{ selected: lookbackYears === years }}
                  accessibilityLabel={`Past ${years} year${years === 1 ? '' : 's'}`}
                  onPress={() => setLookbackYears(clampLookbackYears(years))}
                >
                  <Ionicons
                    name="time-outline"
                    size={16}
                    color={lookbackYears === years ? colors.textInverse : colors.text}
                  />
                  <Text
                    style={[styles.chipText, lookbackYears === years && styles.chipTextActive]}
                  >
                    {years} yr
                  </Text>
                </PressableScale>
              ))}
            </ScrollView>
          )}

          {loading && (
            <View style={styles.loadingPill}>
              <ActivityIndicator color={colors.navy} />
            </View>
          )}
        </View>

        {/* Count line + error float at the bottom edge of the map. Real
            numbers only — the cluster line is absent when nothing matched. */}
        <View style={styles.statBarWrap} pointerEvents="none">
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          <Rise index={2}>
            <View style={styles.statBar}>
              <Text style={styles.statText}>
                {filter === 'storms' && stormCountLine(events.length, stormPins.length, lookbackYears)}
                {filter === 'jobs' && `${jobPins.length} of ${inspections.length} jobs mapped`}
                {filter === 'leads' && `${leadPins.length} of ${leads.length} leads mapped`}
                {filter === 'knocks' && `${knockPins.length} knock pins`}
              </Text>
              {cluster && <Text style={styles.clusterText}>{cluster.headline}</Text>}
            </View>
          </Rise>
        </View>
      </View>
    </View>
  );
}

/** Honest count line: never claims to draw more pins than it drew. */
function stormCountLine(total: number, shown: number, years: number): string {
  const window = `past ${years} yr within ${STORM_HISTORY_BROWSE_RADIUS_MILES} mi`;
  if (total === 0) return `No validated storm events · ${window}`;
  const head =
    shown < total
      ? `${shown} most recent of ${total} storm events`
      : `${total} storm event${total === 1 ? '' : 's'}`;
  return `${head} · ${window}`;
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
  chipScroll: { flexGrow: 0 },
  chipScrollSecond: { marginTop: spacing.sm },
  chipScrollContent: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    gap: spacing.sm,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.barFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.float,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: {
    fontSize: fontSize.bodySm,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  chipTextActive: { color: colors.textInverse },

  loadingPill: {
    alignSelf: 'flex-start',
    marginLeft: spacing.lg,
    marginTop: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.button,
    backgroundColor: colors.barFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    ...shadows.float,
  },

  statBarWrap: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    bottom: spacing.md,
    gap: spacing.sm,
  },
  statBar: {
    backgroundColor: colors.barFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radii.button,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    ...shadows.float,
  },
  statText: {
    color: colors.text,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.medium,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  clusterText: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    marginTop: spacing.xs,
  },

  errorCard: {
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.button,
    ...shadows.float,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, textAlign: 'center' },
});
