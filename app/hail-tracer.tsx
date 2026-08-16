import { useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type MapView from 'react-native-maps';
import { Map, MapHeatmap, MapPin } from '@/components/map/Map';
import { type StormEvent } from '@/lib/noaa';
import { resolveServiceCenter } from '@/lib/services/serviceState';
import { fetchAddressStormHistory } from '@/lib/services/stormMatch';
import { STORM_HISTORY_BROWSE_RADIUS_MILES } from '@/lib/services/stormWatch';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Range = '7d' | '30d' | '6m' | '24m' | '48m';
const RANGE_LABELS: Record<Range, string> = {
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
  '6m': 'Past 6 months',
  '24m': 'Past 24 months',
  '48m': 'Past 4 years',
};

/**
 * Whole-year lookback that contains each range. `fetchAddressStormHistory`
 * expresses its window in years and clamps at 4 (HISTORY_LOOKBACK_YEARS_MAX),
 * so sub-year ranges fetch the smallest whole year that covers them and get
 * cropped client-side — flipping between the short ranges then costs no
 * further requests. Time Travel depth tops out at the same 4 years.
 */
const RANGE_LOOKBACK_YEARS: Record<Range, number> = {
  '7d': 1,
  '30d': 1,
  '6m': 1,
  '24m': 2,
  '48m': 4,
};

/**
 * Initial viewport, sized to the browse radius so the swath fills the map
 * instead of hiding in the middle of a state-wide view.
 * 1° latitude ≈ 69 mi; the 1.1 factor is margin around the circle.
 */
const BROWSE_REGION_DELTA = (STORM_HISTORY_BROWSE_RADIUS_MILES * 2 * 1.1) / 69;

type Layer = 'hail' | 'wind' | 'both';
type Magnitude = 'all' | 'hail_1' | 'hail_15' | 'wind_58';

export default function HailTracerScreen() {
  const router = useRouter();
  const mapRef = useRef<MapView>(null);
  const [range, setRange] = useState<Range>('24m');
  const [layer, setLayer] = useState<Layer>('both');
  const [magnitude, setMagnitude] = useState<Magnitude>('all');
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<StormEvent | null>(null);

  // Storm queries follow the user's saved Service Area (falling back to
  // their most recent inspection's address, then the launch market). The
  // old hardcoded 'TX' silently showed out-of-state contractors the wrong
  // state's storms — real data in the wrong place, which reads as correct.
  const areas = useServiceAreaStore((s) => s.areas);
  const inspections = useInspectionStore((s) => s.inspections);
  const { state: serviceState, ...center } = useMemo(
    () => resolveServiceCenter(),
    // Recompute when the inputs that feed resolution change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [areas, inspections],
  );

  // Shared, validation-floored, 4-year-clamped lookback (stormMatch.ts) rather
  // than a raw NOAA call — every storm surface now agrees on what counts as a
  // storm, and an unreachable service says so instead of drawing an empty map
  // (Drift #5). Hail/wind layer selection is client-side, so toggling it costs
  // no refetch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchAddressStormHistory({
      lat: center.lat,
      lng: center.lon,
      state: serviceState,
      lookbackYears: RANGE_LOOKBACK_YEARS[range],
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
        setError('Storm history not available right now.');
        setEvents([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, serviceState, center.lat, center.lon]);

  const filtered = useMemo(() => {
    const startMs = rangeStart(range).getTime();
    const inRange = events.filter((e) => {
      const at = Date.parse(e.occurredAt);
      return Number.isFinite(at) && at >= startMs;
    });
    const byLayer = layer === 'both' ? inRange : inRange.filter((e) => e.type === layer);
    return filterByMagnitude(byLayer, magnitude);
  }, [events, range, layer, magnitude]);

  const heatmapPoints = useMemo(
    () =>
      filtered
        .filter((e) => e.type === 'hail')
        .map((e) => ({
          latitude: e.lat,
          longitude: e.lon,
          // weight ∝ size²
          weight: e.magnitude ? Math.max(0.2, (e.magnitude ?? 0) ** 2) : 0.5,
        })),
    [filtered],
  );

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Hail Tracer</Text>
          <Text style={styles.sub}>
            {filtered.length} event{filtered.length === 1 ? '' : 's'} · {RANGE_LABELS[range]} ·
            within {STORM_HISTORY_BROWSE_RADIUS_MILES} mi
          </Text>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
          <Pressable
            key={r}
            style={[styles.chip, range === r && styles.chipActive]}
            onPress={() => setRange(r)}
          >
            <Text style={[styles.chipText, range === r && styles.chipTextActive]}>
              {RANGE_LABELS[r]}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.toggleRow}>
        {([
          { id: 'hail', label: 'Hail' },
          { id: 'wind', label: 'Wind' },
          { id: 'both', label: 'Both' },
        ] as const).map((t) => (
          <Pressable
            key={t.id}
            style={[styles.toggle, layer === t.id && styles.toggleActive]}
            onPress={() => setLayer(t.id)}
          >
            <Text style={[styles.toggleText, layer === t.id && styles.toggleTextActive]}>
              {t.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {([
          { id: 'all', label: 'All' },
          { id: 'hail_1', label: '≥1" hail' },
          { id: 'hail_15', label: '≥1.5" hail' },
          { id: 'wind_58', label: '≥58 mph wind' },
        ] as const).map((m) => (
          <Pressable
            key={m.id}
            style={[styles.chip, magnitude === m.id && styles.chipActive]}
            onPress={() => setMagnitude(m.id)}
          >
            <Text style={[styles.chipText, magnitude === m.id && styles.chipTextActive]}>
              {m.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.mapWrap}>
        <Map
          ref={mapRef}
          initialRegion={{
            latitude: center.lat,
            longitude: center.lon,
            latitudeDelta: BROWSE_REGION_DELTA,
            longitudeDelta: BROWSE_REGION_DELTA,
          }}
        >
          {heatmapPoints.length > 0 && (
            <MapHeatmap
              points={heatmapPoints}
              radius={40}
              opacity={0.7}
              gradient={{
                // Theme tokens, not raw hex (Drift #11).
                colors: [colors.accentSoft, colors.orange, colors.stormSevere],
                startPoints: [0.1, 0.5, 0.9],
                colorMapSize: 256,
              }}
            />
          )}
          {filtered
            .filter((e) => e.type === 'wind')
            .slice(0, 200)
            .map((e) => (
              <MapPin
                key={e.id}
                coordinate={{ latitude: e.lat, longitude: e.lon }}
                pinColor={colors.info}
                onPress={() => setSelected(e)}
              />
            ))}
          {filtered
            .filter((e) => e.type === 'hail' && (e.magnitude ?? 0) >= 1.5)
            .slice(0, 200)
            .map((e) => (
              <MapPin
                key={e.id}
                coordinate={{ latitude: e.lat, longitude: e.lon }}
                pinColor={colors.danger}
                onPress={() => setSelected(e)}
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
            <Ionicons name="warning-outline" size={18} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
          </View>
        )}
      </View>

      {selected && (
        <View style={styles.detailSheet}>
          <View style={styles.detailHead}>
            <Text style={styles.detailTitle}>
              {selected.type === 'hail' ? 'Hail event' : 'Wind event'}
              {selected.magnitude ? (
                selected.type === 'hail'
                  ? ` · ${selected.magnitude.toFixed(2)}"`
                  : ` · ${Math.round(selected.magnitude)} kt`
              ) : null}
            </Text>
            <Pressable onPress={() => setSelected(null)} hitSlop={10}>
              <Ionicons name="close" size={22} color={colors.navy} />
            </Pressable>
          </View>
          <Text style={styles.detailLine}>
            {new Date(selected.occurredAt).toLocaleString()}
          </Text>
          {selected.city && (
            <Text style={styles.detailLine}>
              {selected.city}{selected.state ? `, ${selected.state}` : ''}
            </Text>
          )}
          {selected.remarks && (
            <Text style={styles.detailRemarks}>{selected.remarks}</Text>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

/** Start of the selected range — the client-side crop over the fetched window. */
function rangeStart(r: Range, end: Date = new Date()): Date {
  const start = new Date(end.getTime());
  if (r === '7d') start.setDate(end.getDate() - 7);
  else if (r === '30d') start.setDate(end.getDate() - 30);
  else if (r === '6m') start.setMonth(end.getMonth() - 6);
  else if (r === '24m') start.setMonth(end.getMonth() - 24);
  else start.setFullYear(end.getFullYear() - 4);
  return start;
}

function filterByMagnitude(events: StormEvent[], m: Magnitude): StormEvent[] {
  if (m === 'all') return events;
  if (m === 'hail_1') return events.filter((e) => e.type === 'hail' && (e.magnitude ?? 0) >= 1);
  if (m === 'hail_15') return events.filter((e) => e.type === 'hail' && (e.magnitude ?? 0) >= 1.5);
  if (m === 'wind_58') return events.filter((e) => e.type === 'wind' && (e.magnitude ?? 0) * 1.15078 >= 58);
  return events;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  chipScroll: { maxHeight: 56 },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: fontSize.bodySm, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  toggleRow: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.sm,
  },
  toggle: {
    flex: 1,
    minHeight: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toggleActive: { backgroundColor: colors.orange },
  toggleText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  toggleTextActive: { color: colors.textInverse },

  mapWrap: {
    flex: 1,
    margin: spacing.xl,
    marginTop: spacing.sm,
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
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    bottom: spacing.md,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.md,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, flex: 1 },

  detailSheet: {
    position: 'absolute',
    bottom: spacing.lg,
    left: spacing.xl,
    right: spacing.xl,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.pressed,
  },
  detailHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  detailTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.navy },
  detailLine: { fontSize: fontSize.bodyMd, color: colors.navy },
  detailRemarks: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs },
});
