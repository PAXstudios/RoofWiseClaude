// Live route numbers — doors, answered, miles, time — as the header of Knock
// mode's bottom drawer: big tabular numbers a gloved roofer reads at arm's
// length in sun (Strava's record screen), plus the stop being worked when the
// session runs a multi-stop plan. Transparent — the drawer is the surface.

import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionStats } from '@/lib/services/knockOutcomes';
import { formatElapsed, formatMiles } from '@/lib/services/knockTrip';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

type Props = {
  stats: SessionStats;
  /** Live miles from the tracker (the stats' own figure is the settled one). */
  miles: number;
  elapsedMs: number;
  /** The current stop of a multi-stop route, when there is one. */
  stop?: { index: number; total: number; label: string } | null;
  style?: StyleProp<ViewStyle>;
};

export function SessionStatsBar({ stats, miles, elapsedMs, stop, style }: Props) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="summary">
      <View style={styles.row}>
        <Stat value={String(stats.doors)} label="Doors" />
        <Divider />
        <Stat
          value={stats.doors > 0 ? `${stats.contactRate}%` : String(stats.contacts)}
          label={stats.doors > 0 ? `Answered · ${stats.contacts}` : 'Answered'}
        />
        <Divider />
        <Stat value={formatMiles(miles)} label="Miles" />
        <Divider />
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
      <Text style={styles.value} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'center' },
  stat: { flex: 1, alignItems: 'center', gap: 1 },
  divider: { width: StyleSheet.hairlineWidth, height: 28, backgroundColor: colors.hairline },
  value: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.3,
  },
  label: {
    fontSize: fontSize.caption,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, paddingTop: spacing.xs },
  stopText: { flex: 1, fontSize: fontSize.bodySm, color: colors.brand, fontWeight: fontWeight.semibold },
});
