import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import StormHistoryMap from '@/components/map/StormHistoryMap';
import { fetchStormHistory, rangeYearsAgo, STATE_CENTERS, type StormEvent } from '@/lib/noaa';
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

const FILTERS: Array<{ id: Filter; label: string; icon: keyof typeof import('@expo/vector-icons/build/Ionicons').default.glyphMap }> = [
  { id: 'leads', label: 'Leads', icon: 'people-outline' },
  { id: 'jobs', label: 'Jobs', icon: 'hammer-outline' },
  { id: 'storms', label: 'Storms', icon: 'thunderstorm-outline' },
  { id: 'knocks', label: 'Knocks', icon: 'walk-outline' },
];

export default function MapScreen() {
  const [filter, setFilter] = useState<Filter>('storms');
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (filter !== 'storms') return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { start, end } = rangeYearsAgo(1);
    fetchStormHistory({ state: 'TX', start, end, types: ['hail', 'wind'] })
      .then((d) => !cancelled && setEvents(d))
      .catch((e) => {
        if (cancelled) return;
        setEvents([]);
        setError(e?.message ?? 'Could not load storm history.');
      })
      .finally(() => !cancelled && setLoading(false));
    return () => { cancelled = true; };
  }, [filter]);

  const center = STATE_CENTERS.TX;

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Map</Text>
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
        <StormHistoryMap
          events={filter === 'storms' ? events : []}
          center={{ lat: center.lat, lon: center.lon }}
          zoom={center.zoom}
        />
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

      {filter !== 'storms' && (
        <View style={styles.empty}>
          <Ionicons name="information-circle-outline" size={20} color={colors.slate} />
          <Text style={styles.emptyText}>
            {filter === 'leads' && 'Leads will appear on the map once you create them.'}
            {filter === 'jobs' && 'Jobs will appear on the map once you create them.'}
            {filter === 'knocks' && 'Door-knock pins appear during an active route session.'}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.xl, paddingBottom: spacing.md },
  title: {
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },

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

  empty: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'center',
    margin: spacing.xl,
    padding: spacing.lg,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    ...shadows.card,
  },
  emptyText: { flex: 1, fontSize: fontSize.bodySm, color: colors.slate },
});
