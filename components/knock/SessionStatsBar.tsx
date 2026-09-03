// Live route numbers pinned above the controls: doors, answered, miles, time
// — big tabular numbers a gloved roofer reads at arm's length in sun, plus
// the stop being worked when the session runs a multi-stop plan.

import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionStats } from '@/lib/services/knockOutcomes';
import { formatElapsed, formatMiles } from '@/lib/services/knockTrip';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  stats: SessionStats;
  /** Live miles from the tracker (the stats' own figure is the settled one). */
  miles: number;
  elapsedMs: number;
  /** The current stop of a multi-stop route, when there is one. */
  stop?: { index: number; total: number; label: string } | null;
};

export function SessionStatsBar({ stats, miles, elapsedMs, stop }: Props) {
  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <View style={styles.row}>
        <Stat value={String(stats.doors)} label="Doors" />
        <Stat value={String(stats.contacts)} label={stats.doors > 0 ? `Answered · ${stats.contactRate}%` : 'Answered'} />
        <Stat value={formatMiles(miles)} label="Miles" />
        <Stat value={formatElapsed(elapsedMs)} label="Time" />
      </View>
      {stop ? (
        <View style={styles.stopRow}>
          <Ionicons name="flag" size={14} color={colors.brand} />
          <Text style={styles.stopText} numberOfLines={1}>
            Stop {stop.index + 1}/{stop.total} · {stop.label}
          </Text>
        </View>
      ) : null}
    </View>
  );
}

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.value} numberOfLines={1}>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  row: { flexDirection: 'row', minHeight: touchTarget.standard, alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  value: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  label: { fontSize: fontSize.caption, color: colors.textMuted, fontWeight: fontWeight.semibold },
  stopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingBottom: spacing.xs,
    paddingHorizontal: spacing.xs,
  },
  stopText: { flex: 1, fontSize: fontSize.bodySm, color: colors.brand, fontWeight: fontWeight.semibold },
});
