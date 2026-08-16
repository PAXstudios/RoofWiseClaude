import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Map, MapPin, MapCircle, regionForLatLon } from '@/components/map/Map';
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
      <View style={styles.header}>
        <Text style={styles.title}>Map</Text>
        <Pressable
          style={styles.knockBtn}
          onPress={() => router.push('/door-knocking')}
          hitSlop={8}
        >
          <Ionicons name="walk-outline" size={18} color={colors.textInverse} />
          <Text style={styles.knockBtnText}>Knock mode</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chipScrollContent}
        style={styles.chipScroll}
      >
        {FILTERS.map((f) => (
          <Pressable
            key={f.id}
            style={[styles.chip, filter === f.id && styles.chipActive]}
            onPress={() => setFilter(f.id)}
          >
            <Ionicons
              name={f.icon}
              size={16}
              color={filter === f.id ? colors.textInverse : colors.navy}
            />
            <Text style={[styles.chipText, filter === f.id && styles.chipTextActive]}>
              {f.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {filter === 'storms' && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.chipScrollContent}
          style={styles.chipScroll}
        >
          {LOOKBACK_OPTIONS.map((years) => (
            <Pressable
              key={years}
              hitSlop={8}
              style={[styles.chip, lookbackYears === years && styles.chipActive]}
              onPress={() => setLookbackYears(clampLookbackYears(years))}
            >
              <Ionicons
                name="time-outline"
                size={16}
                color={lookbackYears === years ? colors.textInverse : colors.navy}
              />
              <Text
                style={[styles.chipText, lookbackYears === years && styles.chipTextActive]}
              >
                {years} yr
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      )}

      <View style={styles.mapWrap}>
        <Map initialRegion={initialRegion}>
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
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.textInverse} />
          </View>
        )}
        {error && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      <View style={styles.statBar}>
        <Text style={styles.statText}>
          {filter === 'storms' && stormCountLine(events.length, stormPins.length, lookbackYears)}
          {filter === 'jobs' && `${jobPins.length} of ${inspections.length} jobs mapped`}
          {filter === 'leads' && `${leadPins.length} of ${leads.length} leads mapped`}
          {filter === 'knocks' && `${knockPins.length} knock pins`}
        </Text>
        {/* Real numbers only — the line is absent when nothing matched. */}
        {cluster && <Text style={styles.clusterText}>{cluster.headline}</Text>}
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
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  knockBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    height: touchTarget.small,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
  },
  knockBtnText: { color: colors.textInverse, fontSize: fontSize.bodySm, fontWeight: fontWeight.semibold },

  // Drift #1: the strip has to clear the chips it holds, and `touchTarget.small`
  // is explicitly "not for primary actions" — filter and lookback chips are the
  // only controls on this screen.
  chipScroll: { maxHeight: touchTarget.preferred },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: fontSize.bodySm, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  mapWrap: {
    flex: 1,
    marginHorizontal: spacing.xl,
    marginTop: spacing.md,
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    ...shadows.card,
  },
  loading: {
    position: 'absolute',
    top: spacing.md,
    left: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  errorBanner: {
    position: 'absolute',
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm },

  statBar: {
    margin: spacing.xl,
    marginTop: spacing.sm,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    ...shadows.card,
  },
  statText: { color: colors.slate, fontSize: fontSize.bodySm, textAlign: 'center' },
  clusterText: {
    color: colors.danger,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    textAlign: 'center',
    marginTop: spacing.xs,
  },
});
