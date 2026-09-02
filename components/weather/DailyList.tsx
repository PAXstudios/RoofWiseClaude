/**
 * DailyList — the 10-day forecast as a tappable list.
 *
 * Each row: weekday, condition glyph, rain chance, and a low→high range bar
 * drawn against the whole period's span so the hot and cold days stand out
 * at a glance. Tapping a row (≥56pt) opens the day's detail — day and night
 * halves, wind + gusts, UV, thunderstorm chance, sunrise/sunset — with the
 * same HAAG §7 emphasis the hourly strip uses.
 *
 * Every number is the API's; a day with no reading shows a dash, never a
 * plausible one.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { RichCard } from '@/components/ui/RichCard';
import type { ForecastDay, ForecastDayPart, ForecastStatus } from '@/lib/services/weatherForecast';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';
import {
  conditionIcon,
  EmptyLine,
  formatClock,
  formatWeekday,
  GUST_CAUTION_MPH,
  GUST_UNSAFE_MPH,
  PRECIP_UNSAFE_PERCENT,
} from './HourlyStrip';

type Props = {
  days: readonly ForecastDay[];
  status: ForecastStatus | 'pending';
  reason?: string;
  /** IANA zone from the forecast response — sunrise/sunset are formatted in it. */
  timeZone?: string;
  style?: StyleProp<ViewStyle>;
};

export function DailyList({ days, status, reason, timeZone, style }: Props) {
  const [open, setOpen] = useState<string | null>(null);

  const highs = days.map((d) => d.highF).filter((n): n is number => n !== undefined);
  const lows = days.map((d) => d.lowF).filter((n): n is number => n !== undefined);
  const span =
    highs.length > 0 && lows.length > 0
      ? { min: Math.min(...lows), max: Math.max(...highs) }
      : null;

  return (
    <RichCard
      icon="calendar-outline"
      iconTone="purple"
      title={`${days.length > 0 ? days.length : 10}-day forecast`}
      padded={false}
      style={style}
    >
      {status === 'ok' && days.length > 0 ? (
        days.map((d, i) => (
          <DayRow
            key={d.date}
            day={d}
            first={i === 0}
            last={i === days.length - 1}
            span={span}
            expanded={open === d.date}
            onToggle={() => setOpen((cur) => (cur === d.date ? null : d.date))}
            timeZone={timeZone}
          />
        ))
      ) : (
        <EmptyLine status={status} reason={reason} what="10-day forecast" />
      )}
    </RichCard>
  );
}

function DayRow({
  day,
  first,
  last,
  span,
  expanded,
  onToggle,
  timeZone,
}: {
  day: ForecastDay;
  first: boolean;
  last: boolean;
  span: { min: number; max: number } | null;
  expanded: boolean;
  onToggle: () => void;
  timeZone?: string;
}) {
  const part = day.day ?? day.night;
  const precip = Math.max(day.day?.precipChancePercent ?? -1, day.night?.precipChancePercent ?? -1);
  const precipKnown = precip >= 0;
  const wet = precipKnown && precip >= PRECIP_UNSAFE_PERCENT;
  const gust = Math.max(day.day?.gustMph ?? -1, day.night?.gustMph ?? -1);
  const gustKnown = gust >= 0;
  const gusty = gustKnown && gust >= GUST_CAUTION_MPH;
  const thunder = (part?.conditionType ?? '').includes('THUNDER');

  const label = first ? 'Today' : formatWeekday(day.date, true);

  return (
    <View>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={[
          first ? 'Today' : formatWeekday(day.date),
          part?.description ?? '',
          day.highF !== undefined ? `high ${day.highF}` : '',
          day.lowF !== undefined ? `low ${day.lowF}` : '',
          precipKnown ? `${precip} percent rain` : '',
          gustKnown ? `gusts ${gust} miles per hour` : '',
        ]
          .filter(Boolean)
          .join(', ')}
        style={({ pressed }) => [styles.row, !first && styles.rowBorder, pressed && styles.rowPressed]}
      >
        <Text style={styles.weekday} numberOfLines={1}>
          {label}
        </Text>
        <Ionicons
          name={conditionIcon(part?.conditionType ?? '', true)}
          size={22}
          color={thunder ? colors.danger : wet ? colors.brand : colors.text}
        />
        <Text style={[styles.precip, wet && styles.precipWet]} numberOfLines={1}>
          {precipKnown ? `${precip}%` : ''}
        </Text>
        <Text style={styles.low} numberOfLines={1}>
          {day.lowF !== undefined ? `${day.lowF}°` : '—'}
        </Text>
        <RangeBar low={day.lowF} high={day.highF} span={span} />
        <Text style={styles.high} numberOfLines={1}>
          {day.highF !== undefined ? `${day.highF}°` : '—'}
        </Text>
        <Ionicons
          name={expanded ? 'chevron-up' : 'chevron-down'}
          size={16}
          color={gusty ? colors.warn : colors.textSubtle}
        />
      </Pressable>

      {expanded && (
        <View style={[styles.detail, last && styles.detailLast]}>
          <DayPartDetail title="Day" part={day.day} feelsLike={day.feelsLikeHighF} />
          <DayPartDetail title="Night" part={day.night} feelsLike={day.feelsLikeLowF} />
          {(day.sunriseTime || day.sunsetTime) && (
            <View style={styles.sunRow}>
              {day.sunriseTime && (
                <DetailChip icon="sunny-outline" label={`Sunrise ${formatClock(day.sunriseTime, timeZone)}`} />
              )}
              {day.sunsetTime && (
                <DetailChip icon="moon-outline" label={`Sunset ${formatClock(day.sunsetTime, timeZone)}`} />
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

function DayPartDetail({
  title,
  part,
  feelsLike,
}: {
  title: string;
  part?: ForecastDayPart;
  feelsLike?: number;
}) {
  if (!part) return null;
  const gustTone =
    part.gustMph !== undefined && part.gustMph >= GUST_UNSAFE_MPH
      ? 'danger'
      : part.gustMph !== undefined && part.gustMph >= GUST_CAUTION_MPH
      ? 'warn'
      : undefined;
  const thunderTone =
    part.thunderstormProbabilityPercent !== undefined && part.thunderstormProbabilityPercent >= 50
      ? 'danger'
      : undefined;
  return (
    <View style={styles.part}>
      <Text style={styles.partTitle}>
        {title}
        <Text style={styles.partDesc}>
          {part.description ? `  ·  ${part.description}` : ''}
          {feelsLike !== undefined ? `  ·  feels like ${feelsLike}°` : ''}
        </Text>
      </Text>
      <View style={styles.chips}>
        {part.windMph !== undefined && (
          <DetailChip
            icon="flag-outline"
            label={`Wind ${part.windMph} mph${part.windDirection ? ` ${cardinalShort(part.windDirection)}` : ''}`}
          />
        )}
        {part.gustMph !== undefined && (
          <DetailChip icon="warning-outline" label={`Gusts ${part.gustMph} mph`} tone={gustTone} />
        )}
        {part.precipChancePercent !== undefined && (
          <DetailChip
            icon="rainy-outline"
            label={`Rain ${part.precipChancePercent}%${
              part.precipInches !== undefined && part.precipInches > 0 ? ` · ${part.precipInches}"` : ''
            }`}
            tone={part.precipChancePercent >= PRECIP_UNSAFE_PERCENT ? 'brand' : undefined}
          />
        )}
        {part.thunderstormProbabilityPercent !== undefined && part.thunderstormProbabilityPercent > 0 && (
          <DetailChip
            icon="thunderstorm-outline"
            label={`Storms ${part.thunderstormProbabilityPercent}%`}
            tone={thunderTone}
          />
        )}
        {part.uvIndex !== undefined && <DetailChip icon="sunny-outline" label={`UV ${part.uvIndex}`} />}
        {part.humidityPercent !== undefined && (
          <DetailChip icon="water-outline" label={`Humidity ${part.humidityPercent}%`} />
        )}
      </View>
    </View>
  );
}

function DetailChip({
  icon,
  label,
  tone,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  label: string;
  tone?: 'warn' | 'danger' | 'brand';
}) {
  const ink =
    tone === 'danger' ? colors.danger : tone === 'warn' ? colors.warn : tone === 'brand' ? colors.brand : colors.textMuted;
  return (
    <View style={styles.chip}>
      <Ionicons name={icon} size={14} color={ink} />
      <Text style={[styles.chipText, { color: ink }]}>{label}</Text>
    </View>
  );
}

/**
 * Low→high bar positioned inside the period's overall span. Pure geometry
 * from real readings; with either end missing it draws nothing.
 */
function RangeBar({
  low,
  high,
  span,
}: {
  low?: number;
  high?: number;
  span: { min: number; max: number } | null;
}) {
  if (low === undefined || high === undefined || !span || span.max <= span.min) {
    return <View style={styles.track} />;
  }
  const total = span.max - span.min;
  const left = ((low - span.min) / total) * 100;
  const width = Math.max(6, ((high - low) / total) * 100);
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { left: `${left}%`, width: `${width}%` }]} />
    </View>
  );
}

function cardinalShort(cardinal: string): string {
  return cardinal
    .split('_')
    .map((w) => w.charAt(0))
    .join('');
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  rowPressed: { backgroundColor: colors.fillQuiet },
  weekday: {
    width: 54,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  precip: {
    width: 40,
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
    textAlign: 'right',
  },
  precipWet: { color: colors.brand, fontWeight: fontWeight.semibold },
  low: {
    width: 36,
    textAlign: 'right',
    fontSize: fontSize.bodyMd,
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  high: {
    width: 36,
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  track: {
    flex: 1,
    height: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    overflow: 'hidden',
  },
  fill: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
  },

  detail: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.lg,
    gap: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  detailLast: { borderBottomLeftRadius: radii.card, borderBottomRightRadius: radii.card },
  part: { gap: spacing.sm, paddingTop: spacing.md },
  partTitle: { fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.text },
  partDesc: { fontWeight: fontWeight.regular, color: colors.textMuted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    minHeight: 28,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  chipText: { fontSize: fontSize.bodySm, fontWeight: fontWeight.medium },
  sunRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingTop: spacing.sm },
});
