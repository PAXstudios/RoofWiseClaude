import { View, Text, ScrollView, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { Chip } from '@/components/ui/Chip';
import { US_STATES } from '@/lib/noaa';
import type { StormFilters as Filters } from './types';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function StormFilters({
  value,
  onChange,
  count,
  loading,
}: {
  value: Filters;
  onChange: (next: Filters) => void;
  count: number;
  loading: boolean;
}) {
  const set = <K extends keyof Filters>(k: K, v: Filters[K]) =>
    onChange({ ...value, [k]: v });
  const toggle = (t: 'hail' | 'wind') =>
    set(
      'types',
      value.types.includes(t)
        ? (value.types.filter((x) => x !== t) as Filters['types'])
        : ([...value.types, t] as Filters['types'])
    );

  return (
    <Card style={styles.card} elevated padded={false}>
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>4-Year Storm History</Text>
          <Text style={styles.sub}>
            {loading ? 'Fetching NOAA…' : `${count.toLocaleString()} reports`} · Source:
            NOAA / IEM LSR
          </Text>
        </View>
        <View style={styles.live}>
          <View style={[styles.dot, loading && { backgroundColor: colors.warn }]} />
          <Text style={styles.liveLabel}>{loading ? 'Loading' : 'Live'}</Text>
        </View>
      </View>

      <View style={styles.controls}>
        <View style={styles.controlBlock}>
          <Text style={styles.controlLabel}>Range</Text>
          <View style={styles.row}>
            {([1, 2, 4] as const).map((y) => (
              <Chip
                key={y}
                label={`${y}y`}
                active={value.years === y}
                onPress={() => set('years', y)}
                tone="accent"
              />
            ))}
          </View>
        </View>

        <View style={styles.controlBlock}>
          <Text style={styles.controlLabel}>Types</Text>
          <View style={styles.row}>
            <Chip
              label="Hail"
              active={value.types.includes('hail')}
              onPress={() => toggle('hail')}
              tone="brand"
            />
            <Chip
              label="Wind"
              active={value.types.includes('wind')}
              onPress={() => toggle('wind')}
              tone="accent"
            />
          </View>
        </View>
      </View>

      <View>
        <Text style={[styles.controlLabel, { paddingHorizontal: spacing.lg }]}>
          State
        </Text>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statesRow}
        >
          {US_STATES.map((s) => (
            <Pressable
              key={s.code}
              onPress={() => set('state', s.code)}
              style={[
                styles.stateChip,
                value.state === s.code && styles.stateChipActive,
              ]}
            >
              <Text
                style={[
                  styles.stateLabel,
                  value.state === s.code && styles.stateLabelActive,
                ]}
              >
                {s.code}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      <View style={styles.thresholdRow}>
        <Threshold
          icon="snow-outline"
          label={`Min hail ${value.minHail.toFixed(2)}"`}
          onMinus={() => set('minHail', Math.max(0, +(value.minHail - 0.25).toFixed(2)))}
          onPlus={() => set('minHail', +(value.minHail + 0.25).toFixed(2))}
        />
        <Threshold
          icon="speedometer-outline"
          label={`Min wind ${Math.round(value.minWind)} kt`}
          onMinus={() => set('minWind', Math.max(0, value.minWind - 5))}
          onPlus={() => set('minWind', value.minWind + 5)}
        />
      </View>
    </Card>
  );
}

function Threshold({
  icon,
  label,
  onMinus,
  onPlus,
}: {
  icon: any;
  label: string;
  onMinus: () => void;
  onPlus: () => void;
}) {
  return (
    <View style={styles.thresh}>
      <Ionicons name={icon} size={14} color={colors.textMuted} />
      <Text style={styles.threshLabel}>{label}</Text>
      <View style={{ flexDirection: 'row', gap: 4, marginLeft: 'auto' }}>
        <Pressable onPress={onMinus} style={styles.threshBtn}>
          <Ionicons name="remove" size={14} color={colors.text} />
        </Pressable>
        <Pressable onPress={onPlus} style={styles.threshBtn}>
          <Ionicons name="add" size={14} color={colors.text} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingTop: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    paddingHorizontal: spacing.lg,
    marginBottom: spacing.sm,
  },
  title: {
    fontSize: fontSize.lg,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  sub: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  live: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  liveLabel: { fontSize: fontSize.xs, color: colors.textMuted, fontWeight: fontWeight.semibold },
  controls: {
    flexDirection: 'row',
    paddingHorizontal: spacing.lg,
    gap: spacing.lg,
  },
  controlBlock: { gap: 6 },
  controlLabel: {
    fontSize: fontSize.xs,
    color: colors.textSubtle,
    fontWeight: fontWeight.semibold,
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  row: { flexDirection: 'row', gap: spacing.sm },
  statesRow: {
    paddingHorizontal: spacing.lg,
    gap: 6,
    paddingTop: 6,
  },
  stateChip: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  stateChipActive: {
    backgroundColor: colors.text,
    borderColor: colors.text,
  },
  stateLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  stateLabelActive: { color: colors.textInverse },
  thresholdRow: {
    paddingHorizontal: spacing.lg,
    flexDirection: 'row',
    gap: spacing.md,
  },
  thresh: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
  },
  threshLabel: {
    fontSize: fontSize.xs,
    color: colors.text,
    fontWeight: fontWeight.semibold,
  },
  threshBtn: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
});
