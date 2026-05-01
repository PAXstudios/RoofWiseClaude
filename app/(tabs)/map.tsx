import { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import StormHistoryMap from '@/components/map/StormHistoryMap';
import { ChipGroup } from '@/components/ui/ChipGroup';
import { Card } from '@/components/ui/Card';
import { fetchStormHistory, rangeYearsAgo, STATE_CENTERS, type StormEvent } from '@/lib/noaa';
import { leads } from '@/lib/mock/leads';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

type Mode = 'leads' | 'jobs' | 'storms';

export default function MapScreen() {
  const [mode, setMode] = useState<Mode>('storms');
  const [events, setEvents] = useState<StormEvent[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (mode !== 'storms') return;
    let cancelled = false;
    setLoading(true);
    const { start, end } = rangeYearsAgo(1);
    fetchStormHistory({ state: 'TX', start, end, types: ['hail', 'wind'] })
      .then((d) => !cancelled && setEvents(d))
      .catch(() => !cancelled && setEvents([]))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [mode]);

  const center = STATE_CENTERS.TX;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={styles.outer}
    >
      <View style={styles.header}>
        <Text style={styles.title}>Live Ops Map</Text>
        <ChipGroup<Mode>
          value={mode}
          onChange={setMode}
          options={[
            { value: 'leads', label: `Leads (${leads.length})` },
            { value: 'jobs', label: 'Jobs' },
            { value: 'storms', label: 'Storms' },
          ]}
        />
      </View>

      <View style={styles.mapWrap}>
        <StormHistoryMap
          events={mode === 'storms' ? events : []}
          center={{ lat: center.lat, lon: center.lon }}
          zoom={center.zoom}
        />
        {loading && (
          <View style={styles.loading}>
            <ActivityIndicator color={colors.surface} />
          </View>
        )}
      </View>

      <Card style={styles.note}>
        <Text style={styles.noteTitle}>Forensic tip</Text>
        <Text style={styles.noteBody}>
          Cross-reference recent hail clusters with your active leads and jobs to pre-position
          crews. Toggle "Storms" to overlay 12-month NOAA reports.
        </Text>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  outer: { paddingBottom: spacing.xxxl },
  header: { padding: spacing.lg, gap: spacing.md },
  title: {
    fontSize: fontSize.xxl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  mapWrap: {
    height: 480,
    marginHorizontal: spacing.lg,
    borderRadius: radii.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
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
  note: {
    margin: spacing.lg,
    gap: 4,
  },
  noteTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.brand,
  },
  noteBody: {
    fontSize: fontSize.sm,
    color: colors.text,
    lineHeight: 20,
  },
});
