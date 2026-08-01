import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Map, MapPin, MapCircle, regionForLatLon } from '@/components/map/Map';
import { fetchStormHistory, rangeYearsAgo, severityColor, magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { resolveServiceCenter } from '@/lib/services/serviceState';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useLeadStore } from '@/lib/stores/leadStore';
import { useKnockSessionStore } from '@/lib/stores/knockSessionStore';
import { useServiceAreaStore } from '@/lib/stores/serviceAreaStore';
import {
  colors,
  fontSize,
  fontWeight,
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

export default function MapScreen() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const archive = useKnockSessionStore((s) => s.archive);
  const active = useKnockSessionStore((s) => s.activeSession);
  const serviceAreas = useServiceAreaStore((s) => s.areas);

  const [filter, setFilter] = useState<Filter>('storms');
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

  useEffect(() => {
    if (filter !== 'storms') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { start, end } = rangeYearsAgo(1);
    fetchStormHistory({ state: serviceState, start, end, types: ['hail', 'wind'] })
      .then((d) => !cancelled && setEvents(d))
      .catch((e) => {
        if (cancelled) return;
        setEvents([]);
        setError(e?.message ?? 'Could not load storm history.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [filter, serviceState]);

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
                fillColor="rgba(12,24,60,0.08)"
              />
            ))}
          {filter === 'storms' &&
            events.map((e) => (
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
            leadPins.map((lead) => (
              <MapPin
                key={lead.id}
                coordinate={{ latitude: lead.lat!, longitude: lead.lng! }}
                title={lead.customerName}
                description={`Stage: ${lead.stage.replace('_', ' ')}`}
                tone="info"
              />
            ))}
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
          {filter === 'storms' && `${events.length} storm events`}
          {filter === 'jobs' && `${jobPins.length} of ${inspections.length} jobs mapped`}
          {filter === 'leads' && `${leadPins.length} of ${leads.length} leads mapped`}
          {filter === 'knocks' && `${knockPins.length} knock pins`}
        </Text>
      </View>
    </View>
  );
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

  chipScroll: { maxHeight: 56 },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: touchTarget.small,
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
});
