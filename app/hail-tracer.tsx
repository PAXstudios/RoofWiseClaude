import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ActivityIndicator,
  ScrollView,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import type MapView from 'react-native-maps';
import { Map, MapHeatmap, MapPin } from '@/components/map/Map';
import { ScreenHeader } from '@/components/ScreenHeader';
import { PressableScale } from '@/components/PressableScale';
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
  motion,
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

/**
 * Subtle iOS entrance: 8pt rise + fade on the snappy spring, staggered by
 * index — same pattern as the tab roots. A pushed screen mounts fresh, so
 * it plays on each visit (its own first paint).
 */
function Rise({
  index = 0,
  style,
  children,
}: PropsWithChildren<{ index?: number; style?: StyleProp<ViewStyle> }>) {
  const progress = useSharedValue(0);

  useEffect(() => {
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

// iOS-17 segmented control: fillQuiet track, white thumb sliding on the
// snappy spring. 56pt wrapper + vertical hitSlop keeps the glove floor.
const SEG_PAD = spacing.xs;

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: readonly { id: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const [trackW, setTrackW] = useState(0);
  const idx = Math.max(0, options.findIndex((o) => o.id === value));
  const segW = trackW > 0 ? (trackW - SEG_PAD * 2) / options.length : 0;
  const x = useSharedValue(0);
  const laidOut = useRef(false);

  useEffect(() => {
    if (segW <= 0) return;
    if (!laidOut.current) {
      // First layout: place the thumb without animating.
      laidOut.current = true;
      x.value = idx * segW;
      return;
    }
    x.value = withSpring(idx * segW, motion.snappy);
  }, [idx, segW, x]);

  const thumbStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: x.value }],
  }));

  return (
    <View style={styles.segWrap}>
      <View
        style={styles.segTrack}
        onLayout={(e) => setTrackW(e.nativeEvent.layout.width)}
      >
        {segW > 0 && (
          <Animated.View style={[styles.segThumb, { width: segW }, thumbStyle]} />
        )}
        {options.map((o) => (
          <Pressable
            key={o.id}
            style={styles.segBtn}
            hitSlop={{ top: 8, bottom: 8 }}
            accessibilityRole="button"
            accessibilityState={{ selected: value === o.id }}
            accessibilityLabel={o.label}
            onPress={() => onChange(o.id)}
          >
            <Text style={[styles.segLabel, value === o.id && styles.segLabelActive]}>
              {o.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

export default function HailTracerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
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
      {/* Inline sub-screen header — plain chevron, honest count subtitle. */}
      <Rise index={0}>
        <ScreenHeader
          title="Hail Tracer"
          subtitle={`${filtered.length} event${filtered.length === 1 ? '' : 's'} · ${RANGE_LABELS[range]} · within ${STORM_HISTORY_BROWSE_RADIUS_MILES} mi`}
          back={() => router.back()}
        />
      </Rise>

      <Rise index={1} style={styles.segmentedWrap}>
        <Segmented
          options={[
            { id: 'hail', label: 'Hail' },
            { id: 'wind', label: 'Wind' },
            { id: 'both', label: 'Both' },
          ] as const}
          value={layer}
          onChange={setLayer}
        />
      </Rise>

      {/* Density: the map fills everything below the layer control; range and
          magnitude chips float over the imagery on barFill. */}
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

        {/* Floating control chips — barFill + hairline + float shadow so
            they read over imagery; glove-sized (≥56pt). */}
        <View style={styles.overlayTop} pointerEvents="box-none">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.chipScroll}
            contentContainerStyle={styles.chipScrollContent}
          >
            {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
              <PressableScale
                key={r}
                style={[styles.chip, range === r && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: range === r }}
                accessibilityLabel={RANGE_LABELS[r]}
                onPress={() => setRange(r)}
              >
                <Text style={[styles.chipText, range === r && styles.chipTextActive]}>
                  {RANGE_LABELS[r]}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={[styles.chipScroll, styles.chipScrollSecond]}
            contentContainerStyle={styles.chipScrollContent}
          >
            {([
              { id: 'all', label: 'All' },
              { id: 'hail_1', label: '≥1" hail' },
              { id: 'hail_15', label: '≥1.5" hail' },
              { id: 'wind_58', label: '≥58 mph wind' },
            ] as const).map((m) => (
              <PressableScale
                key={m.id}
                style={[styles.chip, magnitude === m.id && styles.chipActive]}
                accessibilityRole="button"
                accessibilityState={{ selected: magnitude === m.id }}
                accessibilityLabel={m.label}
                onPress={() => setMagnitude(m.id)}
              >
                <Text style={[styles.chipText, magnitude === m.id && styles.chipTextActive]}>
                  {m.label}
                </Text>
              </PressableScale>
            ))}
          </ScrollView>

          {loading && (
            <View style={styles.loadingPill}>
              <ActivityIndicator color={colors.navy} />
            </View>
          )}
        </View>

        {/* Bottom overlays clear the home indicator — the map runs to the
            screen edge, so the sheet carries the inset itself. */}
        <View
          style={[styles.overlayBottom, { bottom: insets.bottom + spacing.md }]}
          pointerEvents="box-none"
        >
          {error && (
            <View style={styles.errorCard}>
              <Ionicons name="warning-outline" size={18} color={colors.danger} />
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}
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
              {/* Real 56pt close target floated over the sheet corner. */}
              <Pressable
                style={styles.detailClose}
                accessibilityRole="button"
                accessibilityLabel="Close event details"
                onPress={() => setSelected(null)}
              >
                <Ionicons name="close" size={22} color={colors.text} />
              </Pressable>
            </View>
          )}
        </View>
      </View>
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

  // iOS-17 segmented control on the grouped ground.
  segmentedWrap: { paddingHorizontal: spacing.xl },
  segWrap: { minHeight: touchTarget.standard, justifyContent: 'center' },
  segTrack: {
    flexDirection: 'row',
    height: 44,
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
  segBtn: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  segLabel: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  segLabelActive: { color: colors.text },

  // Full-bleed map under a hairline — the screen's content IS the map.
  mapWrap: {
    flex: 1,
    marginTop: spacing.sm,
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
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.barFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    justifyContent: 'center',
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

  overlayBottom: {
    position: 'absolute',
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
  },

  errorCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.dangerSoft,
    padding: spacing.md,
    borderRadius: radii.button,
    ...shadows.float,
  },
  errorText: { color: colors.danger, fontSize: fontSize.bodySm, flex: 1 },

  detailSheet: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.float,
  },
  detailHead: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: touchTarget.standard,
  },
  detailClose: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  detailTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  detailLine: { fontSize: fontSize.bodyMd, color: colors.text },
  detailRemarks: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: spacing.xs },
});
