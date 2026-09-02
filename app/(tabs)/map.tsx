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
import { LinearGradient } from 'expo-linear-gradient';
import { GlassCard } from '@/components/glass/GlassCard';
import { IconChip } from '@/components/ui/IconChip';
import { severityColor, magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { resolveServiceCenter } from '@/lib/services/serviceState';
import {
  fetchAddressStormHistory,
  clampLookbackYears,
  HISTORY_LOOKBACK_YEARS_DEFAULT,
  HISTORY_LOOKBACK_YEARS_MAX,
} from '@/lib/services/stormMatch';
import {
  leadsInStormCluster,
  STORM_HISTORY_BROWSE_RADIUS_MILES,
  type StormLeadCluster,
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
  gradients,
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
 * HISTORY_LOOKBACK_YEARS_MAX = 4; 3 years (36 months, hail + wind) is the
 * default per the owner — affordable now that the fetch is the per-point IEM
 * service (~0.3 MB/yr at 50 mi) rather than a state-wide pull. This is the
 * history-*browsing* window — deliberately separate from the 2-year claim
 * corroboration cap (docs/HAAG_DECISION_ENGINE.md §6).
 */
const LOOKBACK_OPTIONS = [1, 2, 3, HISTORY_LOOKBACK_YEARS_MAX] as const;
const DEFAULT_LOOKBACK_YEARS = HISTORY_LOOKBACK_YEARS_DEFAULT;

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
 *  tokens, not the raw per-magnitude hex `severityColor()` plots with). */
function StormLegend() {
  return (
    <View style={styles.legendCard}>
      <LegendSwatch color={colors.stormHail} label="Hail" />
      <LegendSwatch color={colors.stormWind} label="Wind" />
      <LegendSwatch color={colors.stormSevere} label="Severe" />
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

      {/* Density: the map fills everything under the header — the full-bleed
          cinematic moment. Controls float over the imagery as real glass. */}
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

        {/* ONE floating glass control bar — real BlurView on iOS, tinted-fill
            fallback elsewhere; glove-sized (≥56pt) either way. Layers, time
            range and legend used to stack as three separate floating rows
            down the top third of the map, and the legend pill collided with
            the pins beneath it. */}
        <View style={styles.overlayTop} pointerEvents="box-none">
          <Rise index={1} style={styles.controlBarShadow}>
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
                    onPress={() => setFilter(f.id)}
                  />
                ))}
              </ScrollView>

              {filter === 'storms' && (
                <View style={styles.controlBarSecond}>
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={styles.chipScroll}
                    contentContainerStyle={styles.chipScrollContent}
                  >
                    {LOOKBACK_OPTIONS.map((years) => (
                      <GlassChip
                        key={years}
                        active={lookbackYears === years}
                        icon="time-outline"
                        label={`${years} yr`}
                        accessibilityLabel={`Past ${years} year${years === 1 ? '' : 's'}`}
                        onPress={() => setLookbackYears(clampLookbackYears(years))}
                      />
                    ))}
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

        {/* Cluster insight + count float at the bottom edge of the map. Real
            numbers only — both are absent when there's nothing to report. */}
        <View style={styles.statBarWrap} pointerEvents="box-none">
          {error && (
            <View style={styles.errorCard}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
          {cluster && (
            <Rise index={4}>
              <ClusterInsight cluster={cluster} onPress={() => setFilter('leads')} />
            </Rise>
          )}
          <Rise index={5}>
            <View style={styles.statBarShadow}>
              <GlassCard onLight onArt radius={radii.button} style={styles.statBar}>
                <Text style={styles.statText}>
                  {filter === 'storms' &&
                    stormCountLine(events.length, stormPins.length, lookbackYears, {
                      loading,
                      unavailable: error != null,
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

/**
 * Honest count line: never claims to draw more pins than it drew, and never
 * reads "No validated storm events" over a failed request — "unavailable"
 * (NOAA/IEM unreachable) and "none found" (service answered) are different
 * facts (Drift #5).
 */
function stormCountLine(
  total: number,
  shown: number,
  years: number,
  state: { loading: boolean; unavailable: boolean },
): string {
  const window = `past ${years} yr within ${STORM_HISTORY_BROWSE_RADIUS_MILES} mi`;
  if (state.unavailable) return `Storm pins withheld — NOAA history unavailable · ${window}`;
  if (state.loading && total === 0) return `Checking NOAA storm reports · ${window}`;
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
  // The single floating control bar. Shadow lives on the wrapper so it isn't
  // clipped by the glass card's own corner radius.
  controlBarShadow: {
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    ...shadows.float,
  },
  controlBar: { paddingVertical: spacing.xs },
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
  // hex. Now a row inside the control bar rather than a pill floating over
  // (and colliding with) the pins.
  legendCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.md,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.text },

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
