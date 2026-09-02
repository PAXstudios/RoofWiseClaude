/**
 * HourlyStrip — the next 48 hours, one cell per hour, scrolled sideways.
 *
 * Each cell is a real forecast hour from `weatherForecast.ts`: hour, condition
 * glyph, temperature, rain chance and wind. The emphasis colours come from
 * HAAG §7 (docs/HAAG_DECISION_ENGINE.md), not taste: rain chance is called
 * out at ≥20% (the line where "slight rain" becomes UNSAFE), gusts at ≥25 mph
 * (USE_CAUTION) and ≥40 mph (UNSAFE). A roofer skimming the strip should see
 * the hours that will put them off the roof before reading a number.
 *
 * Honest states: no key → "not set up"; a failed call → "not available";
 * never a row of placeholder cells. This file also exports the small
 * formatting helpers the daily list and the weather screen share.
 */

import { ScrollView, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import type { IoniconName } from '@/components/ui/IconChip';
import type { ForecastHour, ForecastStatus } from '@/lib/services/weatherForecast';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

/** HAAG §7: precipitation chance at/above this rates UNSAFE. */
export const PRECIP_UNSAFE_PERCENT = 20;
/** HAAG §7: gusts at/above this rate USE_CAUTION; at/above 40 UNSAFE. */
export const GUST_CAUTION_MPH = 25;
export const GUST_UNSAFE_MPH = 40;

const CELL_WIDTH = 64;

type Props = {
  hours: readonly ForecastHour[];
  status: ForecastStatus | 'pending';
  /** Shown when `status` is `unavailable`. */
  reason?: string;
  style?: StyleProp<ViewStyle>;
};

export function HourlyStrip({ hours, status, reason, style }: Props) {
  return (
    <RichCard icon="time-outline" iconTone="blue" title="Next 48 hours" padded={false} style={style}>
      {status === 'ok' && hours.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.strip}
          accessibilityRole="list"
        >
          {hours.map((h, i) => (
            <HourCell
              key={h.time}
              hour={h}
              first={i === 0}
              dayBreak={i > 0 && h.localDate !== undefined && h.localDate !== hours[i - 1].localDate}
            />
          ))}
        </ScrollView>
      ) : (
        <EmptyLine status={status} reason={reason} what="hourly forecast" />
      )}
    </RichCard>
  );
}

function HourCell({ hour, first, dayBreak }: { hour: ForecastHour; first: boolean; dayBreak: boolean }) {
  const precip = hour.precipChancePercent;
  const gust = hour.gustMph;
  const wind = hour.windMph;
  const wet = precip !== undefined && precip >= PRECIP_UNSAFE_PERCENT;
  const gustTone =
    gust !== undefined && gust >= GUST_UNSAFE_MPH
      ? styles.valueDanger
      : gust !== undefined && gust >= GUST_CAUTION_MPH
      ? styles.valueWarn
      : null;
  const thunder = hour.conditionType.includes('THUNDER');

  const label = first ? 'Now' : formatHourLabel(hour);

  return (
    <View
      style={[styles.cell, dayBreak && styles.cellDayBreak]}
      accessibilityRole="text"
      accessibilityLabel={[
        label,
        hour.description,
        hour.tempF !== undefined ? `${hour.tempF} degrees` : '',
        precip !== undefined ? `${precip} percent rain` : '',
        wind !== undefined ? `wind ${wind}` : '',
        gust !== undefined ? `gusts ${gust}` : '',
      ]
        .filter(Boolean)
        .join(', ')}
    >
      <Text style={[styles.hour, first && styles.hourNow]} numberOfLines={1}>
        {dayBreak && hour.localDate ? formatWeekday(hour.localDate, true) : label}
      </Text>
      <Ionicons
        name={conditionIcon(hour.conditionType, hour.isDaytime)}
        size={22}
        color={thunder ? colors.danger : wet ? colors.brand : colors.text}
      />
      <Text style={styles.temp} numberOfLines={1}>
        {hour.tempF !== undefined ? `${hour.tempF}°` : '—'}
      </Text>
      <Text style={[styles.value, wet && styles.valueWet]} numberOfLines={1}>
        {precip !== undefined ? `${precip}%` : ' '}
      </Text>
      <Text style={[styles.value, gustTone]} numberOfLines={1}>
        {gust !== undefined ? `${gust}` : wind !== undefined ? `${wind}` : ' '}
        {gust !== undefined || wind !== undefined ? (
          <Text style={styles.unit}> mph</Text>
        ) : null}
      </Text>
    </View>
  );
}

/** One honest line for the not-set-up / unavailable / pending states. */
export function EmptyLine({
  status,
  reason,
  what,
}: {
  status: ForecastStatus | 'pending';
  reason?: string;
  what: string;
}) {
  const text =
    status === 'not_configured'
      ? `Weather isn’t set up yet — add a weather key in Settings to see the ${what}.`
      : status === 'pending'
      ? `Checking the ${what}…`
      : status === 'unavailable'
      ? `The ${what} isn’t available right now.${reason ? ` (${reason})` : ''}`
      : `No ${what} came back for this location.`;
  const icon: IoniconName =
    status === 'not_configured'
      ? 'key-outline'
      : status === 'pending'
      ? 'radio-outline'
      : 'cloud-offline-outline';
  return (
    <View style={styles.empty}>
      <Ionicons name={icon} size={18} color={colors.textSubtle} />
      <Text style={styles.emptyText}>{text}</Text>
    </View>
  );
}

/* ─────────────────────────── shared helpers ──────────────────────────── */

/** Ionicons glyph for a Google Weather condition type. */
export function conditionIcon(conditionType: string, isDaytime: boolean): IoniconName {
  const t = conditionType.toUpperCase();
  if (t.includes('THUNDER')) return 'thunderstorm';
  if (t.includes('SNOW') || t.includes('FLURR') || t.includes('BLIZZARD') || t.includes('SLEET')) return 'snow';
  if (t.includes('HAIL')) return 'snow-outline';
  if (t.includes('RAIN') || t.includes('SHOWER') || t.includes('DRIZZLE')) return 'rainy';
  if (t.includes('FOG') || t.includes('HAZE') || t.includes('MIST') || t.includes('SMOKE')) return 'cloud-outline';
  if (t.includes('WIND')) return 'cloudy-outline';
  if (t === 'CLOUDY' || t === 'MOSTLY_CLOUDY') return 'cloud';
  // "PARTLY_CLOUDY" (type) and "PARTLY_SUNNY" (description, from `weather.ts`
  // which carries no type) are the same sky.
  if (t.includes('CLOUD') || t.includes('PARTLY')) return isDaytime ? 'partly-sunny' : 'cloudy-night';
  if (t.includes('CLEAR') || t.includes('SUNNY')) return isDaytime ? 'sunny' : 'moon';
  return isDaytime ? 'partly-sunny-outline' : 'cloudy-night-outline';
}

/** "3 PM" from the hour's location-local wall clock; falls back to device time. */
export function formatHourLabel(hour: ForecastHour): string {
  if (hour.localHour !== undefined) return clockFromHour(hour.localHour);
  const d = new Date(hour.time);
  return Number.isNaN(d.getTime()) ? '' : clockFromHour(d.getHours());
}

function clockFromHour(h: number): string {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * "Thu" / "Thursday" from a YYYY-MM-DD local date. Parsed at UTC noon so the
 * device's zone can never shift it across midnight.
 */
export function formatWeekday(localDate: string, short = false): string {
  const d = new Date(`${localDate}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return localDate;
  const names = short
    ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
    : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return names[d.getUTCDay()];
}

/**
 * Wall-clock time ("6:47 AM") for an ISO instant at the forecast location.
 * Uses the response's IANA zone when the runtime can honour it (Hermes ships
 * Intl on both platforms); otherwise the device's own zone.
 */
export function formatClock(iso: string | undefined, timeZone?: string): string | undefined {
  if (!iso) return undefined;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      timeZone,
    }).format(d);
  } catch {
    const h = d.getHours();
    const m = String(d.getMinutes()).padStart(2, '0');
    const twelve = h % 12 === 0 ? 12 : h % 12;
    return `${twelve}:${m} ${h < 12 ? 'AM' : 'PM'}`;
  }
}

const styles = StyleSheet.create({
  strip: { paddingHorizontal: spacing.md, paddingBottom: spacing.lg, gap: spacing.xs },
  // Each cell clears the standard target height so the strip stays easy to
  // drag with a glove; cells are readouts, not buttons.
  cell: {
    width: CELL_WIDTH,
    minHeight: touchTarget.sticky,
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    borderRadius: radii.md,
  },
  cellDayBreak: {
    borderLeftWidth: StyleSheet.hairlineWidth * 2,
    borderLeftColor: colors.borderStrong,
    borderRadius: 0,
  },
  hour: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.textSubtle,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  hourNow: { color: colors.text },
  temp: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  value: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  unit: { fontSize: fontSize.caption, color: colors.textSubtle },
  valueWet: { color: colors.brand, fontWeight: fontWeight.semibold },
  valueWarn: { color: colors.warn, fontWeight: fontWeight.semibold },
  valueDanger: { color: colors.danger, fontWeight: fontWeight.bold },

  empty: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
  },
  emptyText: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted, lineHeight: 18 },
});
