import { useEffect, useMemo, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import StormHistoryMap from '@/components/map/StormHistoryMap';
import { StormFilters } from '@/components/map/StormFilters';
import { StormLegend } from '@/components/map/StormLegend';
import {
  fetchStormHistory,
  rangeYearsAgo,
  STATE_CENTERS,
  type StormEvent,
} from '@/lib/noaa';
import type { StormFilters as Filters } from '@/components/map/types';
import { useResponsive } from '@/theme/useResponsive';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

const DEFAULTS: Filters = {
  state: 'TX',
  years: 4,
  types: ['hail', 'wind'],
  minHail: 0.75,
  minWind: 50,
};

export default function StormIntelScreen() {
  const { isWide } = useResponsive();
  const [filters, setFilters] = useState<Filters>(DEFAULTS);
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const { start, end } = rangeYearsAgo(filters.years);
    fetchStormHistory({
      state: filters.state,
      start,
      end,
      types: filters.types,
    })
      .then((data) => {
        if (!cancelled) setEvents(data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message ?? 'Failed to load NOAA data');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters.state, filters.years, filters.types.join(',')]);

  const filtered = useMemo(() => {
    return events.filter((e) => {
      if (!filters.types.includes(e.type)) return false;
      if (e.type === 'hail' && (e.magnitude ?? 0) < filters.minHail) return false;
      if (e.type === 'wind' && (e.magnitude ?? 0) < filters.minWind) return false;
      return true;
    });
  }, [events, filters.minHail, filters.minWind, filters.types]);

  const center = STATE_CENTERS[filters.state] ?? { lat: 39.5, lon: -98.35, zoom: 4 };

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.outer}
      stickyHeaderIndices={[0]}
    >
      <View style={[styles.headerStuck, isWide && { paddingTop: spacing.xl }]}>
        <View style={[styles.headerInner, isWide && styles.headerWide]}>
          <View style={styles.titleRow}>
            <Text style={styles.title}>Storm Intel</Text>
            <Text style={styles.subtitle}>
              4 years of hail & wind reports — live from NOAA
            </Text>
          </View>
          <StormFilters
            value={filters}
            onChange={setFilters}
            count={filtered.length}
            loading={loading}
          />
        </View>
      </View>

      <View style={[styles.mapWrap, isWide && styles.mapWrapWide]}>
        {error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorTitle}>Couldn't reach NOAA</Text>
            <Text style={styles.errorBody}>{error}</Text>
          </View>
        ) : (
          <StormHistoryMap
            events={filtered}
            center={{ lat: center.lat, lon: center.lon }}
            zoom={center.zoom}
          />
        )}
        {loading && (
          <View style={styles.loadingBadge}>
            <ActivityIndicator color={colors.surface} size="small" />
            <Text style={styles.loadingLabel}>Fetching {filters.years} years…</Text>
          </View>
        )}
      </View>

      <View style={[styles.legendWrap, isWide && styles.legendWrapWide]}>
        <StormLegend />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: {
    paddingBottom: spacing.xxxl,
    backgroundColor: colors.bg,
  },
  headerStuck: {
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing.md,
  },
  headerInner: { gap: spacing.md },
  headerWide: {
    width: '100%',
    maxWidth: 1280,
    alignSelf: 'center',
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
  },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  subtitle: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  mapWrap: {
    height: 480,
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  mapWrapWide: {
    width: '96%',
    maxWidth: 1280,
    alignSelf: 'center',
    height: 600,
  },
  loadingBadge: {
    position: 'absolute',
    bottom: spacing.md,
    left: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  loadingLabel: {
    color: colors.surface,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
  legendWrap: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  legendWrapWide: {
    width: '96%',
    maxWidth: 1280,
    alignSelf: 'center',
  },
  errorBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  errorTitle: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  errorBody: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
