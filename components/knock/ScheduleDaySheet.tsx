// Put a trip day on the calendar — the sheet behind the DayCard's Schedule
// button (components/knock/PlanView.tsx) and any other surface that wants
// to schedule a day. Picks a date (Today, Tomorrow, the next 7 days) and a
// start hour, shows the stops with arrival clocks recomputed for that start,
// saves through knockFinderStore.scheduleDay and books the day-of reminder.
//
// The date chips carry a dry/rain glyph from the Google daily forecast for
// the first stop when the weather key is configured; without it the chips
// simply have no glyph (Drift #5: never a guessed sky).

import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type IoniconName } from '@/components/ui/IconChip';
import { useKnockFinderStore, type KnockPlan } from '@/lib/stores/knockFinderStore';
import { useToastStore } from '@/lib/stores/toastStore';
import { clockFromStart, fmtMinutes, type TripDay } from '@/lib/services/knockOpportunities';
import { cancelKnockDayReminder, scheduleKnockDayReminder } from '@/lib/services/pushNotifications';
import { fetchDailyForecast } from '@/lib/services/weatherForecast';
import { isWeatherConfigured } from '@/lib/env';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type ScheduleDaySheetProps = {
  visible: boolean;
  plan: KnockPlan;
  day: TripDay;
  onClose: () => void;
};

/** Start hours offered: mornings and the after-work window. */
const START_HOURS = [7, 8, 9, 10, 11, 15, 16, 17];
/** Today, Tomorrow, then seven more days. */
const DATE_CHIP_COUNT = 9;
const DEFAULT_START_HOUR = 9;
/** After this local hour "Today" no longer makes sense as the default. */
const LAST_SENSIBLE_START_HOUR = 15;
/** Forecast precip-chance bands for the chip glyph. */
const RAIN_LIKELY_PERCENT = 60;
const RAIN_POSSIBLE_PERCENT = 30;

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Local YYYY-MM-DD. */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function hourLabel(h: number): string {
  return `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "9:00 AM" from a schedule's "09:00" — the clock a card shows. */
export function startClockLabel(startTime: string): string {
  const [h, m] = startTime.split(':').map(Number);
  if (!Number.isFinite(h)) return startTime;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(Number.isFinite(m) ? m : 0).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

function hhmm(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}

function dateChips(now: Date): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  for (let i = 0; i < DATE_CHIP_COUNT; i += 1) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    out.push({
      date: localYmd(d),
      label: i === 0 ? 'Today' : i === 1 ? 'Tomorrow' : `${WEEKDAYS_SHORT[d.getDay()]} ${d.getDate()}`,
    });
  }
  return out;
}

function rainGlyph(percent: number): { name: IoniconName; color: string } {
  if (percent >= RAIN_LIKELY_PERCENT) return { name: 'rainy-outline', color: colors.warn };
  if (percent >= RAIN_POSSIBLE_PERCENT) return { name: 'partly-sunny-outline', color: colors.textMuted };
  return { name: 'sunny-outline', color: colors.success };
}

export function ScheduleDaySheet({ visible, plan, day, onClose }: ScheduleDaySheetProps) {
  const scheduleDay = useKnockFinderStore((s) => s.scheduleDay);
  const setDayReminder = useKnockFinderStore((s) => s.setDayReminder);
  const toast = useToastStore((s) => s.show);
  const existing = plan.schedule?.find((d) => d.day === day.day);
  const existingDate = existing?.date;
  const existingHour = existing ? Number(existing.startTime.slice(0, 2)) : undefined;

  // Chips are rebuilt each time the sheet opens so "Today" is today.
  const chips = useMemo(() => dateChips(new Date()), [visible]); // eslint-disable-line react-hooks/exhaustive-deps
  const [date, setDate] = useState(chips[0].date);
  const [hour, setHour] = useState(DEFAULT_START_HOUR);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const now = new Date();
    const fallbackDate = now.getHours() >= LAST_SENSIBLE_START_HOUR ? chips[1].date : chips[0].date;
    setDate(existingDate ?? fallbackDate);
    setHour(existingHour != null && Number.isFinite(existingHour) ? existingHour : DEFAULT_START_HOUR);
  }, [visible, chips, existingDate, existingHour]);

  // Dry / rain glyph per date from the daily forecast at the first stop.
  const [rain, setRain] = useState<Record<string, number>>({});
  const first = day.stops[0];
  const firstLat = first?.area.lat;
  const firstLng = first?.area.lng;
  useEffect(() => {
    if (!visible || !isWeatherConfigured || firstLat == null || firstLng == null) return;
    let cancelled = false;
    fetchDailyForecast({ lat: firstLat, lng: firstLng }, { days: DATE_CHIP_COUNT })
      .then((r) => {
        if (cancelled || r.status !== 'ok') return;
        const next: Record<string, number> = {};
        for (const d of r.items) {
          const p = d.day?.precipChancePercent;
          if (p != null) next[d.date] = p;
        }
        setRain(next);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [visible, firstLat, firstLng]);

  const firstName = first ? first.area.name ?? first.area.storm.town ?? 'Storm area' : '—';
  const isToday = date === chips[0].date;
  const startPassed = isToday && new Date().getHours() >= hour;

  const onSchedule = async () => {
    if (busy || day.stops.length === 0) return;
    setBusy(true);
    const startTime = hhmm(hour);
    try {
      if (existing?.reminderId) await cancelKnockDayReminder(existing.reminderId);
      scheduleDay(plan.id, day.day, date, startTime);
      onClose();
      const chip = chips.find((c) => c.date === date);
      toast({
        tone: 'success',
        title: `Day ${day.day} scheduled`,
        body: `${chip?.label ?? date} at ${hourLabel(hour)} · ${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} · first: ${firstName}`,
      });
      const reminderId = await scheduleKnockDayReminder({
        planId: plan.id,
        day: day.day,
        date,
        startTime,
        stops: day.stops.length,
        first: firstName,
      }).catch(() => null);
      if (reminderId) setDayReminder(plan.id, day.day, reminderId);
    } finally {
      setBusy(false);
    }
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={`Schedule day ${day.day}`}
      subtitle={`${day.stops.length} stop${day.stops.length === 1 ? '' : 's'} · ${Math.round(day.totalMiles)} mi · ${fmtMinutes(day.totalMinutes)} · ${plan.title}`}
    >
      <Text style={styles.groupLabel}>Which day</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chipRow}>
        {chips.map((c) => {
          const on = c.date === date;
          const p = rain[c.date];
          const glyph = p != null ? rainGlyph(p) : null;
          return (
            <PressableScale
              key={c.date}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => setDate(c.date)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${c.label}${p != null ? `, ${p}% chance of rain` : ''}`}
            >
              {glyph ? <Ionicons name={glyph.name} size={16} color={on ? colors.textInverse : glyph.color} /> : null}
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{c.label}</Text>
            </PressableScale>
          );
        })}
      </ScrollView>

      <Text style={styles.groupLabel}>Start</Text>
      <View style={styles.hourGrid}>
        {START_HOURS.map((h) => {
          const on = h === hour;
          return (
            <PressableScale
              key={h}
              style={[styles.hourChip, on && styles.chipOn]}
              onPress={() => setHour(h)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`Start at ${hourLabel(h)}`}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>{hourLabel(h)}</Text>
            </PressableScale>
          );
        })}
      </View>
      <Text style={styles.quiet}>4–7 pm weekdays and 10–2 weekends answer best.</Text>
      {startPassed ? <Text style={styles.warn}>That start is already behind you today — pick a later hour or tomorrow.</Text> : null}

      <Text style={styles.groupLabel}>Stops from a {hourLabel(hour)} start</Text>
      <View style={styles.stops}>
        {day.stops.map((s, i) => (
          <View key={s.area.key} style={[styles.stopRow, i > 0 && styles.stopBorder]}>
            <IconChip name="location-outline" tone={i === 0 ? 'orange' : 'quiet'} size="sm" />
            <View style={styles.stopMain}>
              <Text style={styles.stopTitle} numberOfLines={1}>
                {clockFromStart(s.startMinute, hour)} · {s.area.name ?? s.area.storm.town ?? 'Storm area'}
              </Text>
              <Text style={styles.stopSub}>
                {Math.round(s.driveMiles)} mi drive · {s.doors} doors · ~{fmtMinutes(s.workMinutes)} · ≥{s.atLeast} claim-grade
              </Text>
            </View>
            <Text style={styles.stopScore}>{s.area.knockScore}</Text>
          </View>
        ))}
      </View>

      <PressableScale
        style={[styles.primaryBtn, busy && styles.primaryBtnBusy]}
        onPress={() => void onSchedule()}
        disabled={busy || day.stops.length === 0}
        accessibilityRole="button"
        accessibilityLabel={`${existing ? 'Update' : 'Schedule'} day ${day.day}`}
      >
        {busy ? <ActivityIndicator color={colors.textInverse} /> : <Ionicons name="calendar" size={22} color={colors.textInverse} />}
        <Text style={styles.primaryBtnText}>{existing ? `Update day ${day.day}` : `Schedule day ${day.day}`}</Text>
      </PressableScale>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  groupLabel: {
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  chipRow: { gap: spacing.sm, paddingVertical: spacing.xs },
  chip: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  chipOn: { backgroundColor: colors.navy },
  chipText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  chipTextOn: { color: colors.textInverse },
  hourGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  hourChip: {
    minHeight: touchTarget.standard,
    minWidth: 76,
    paddingHorizontal: spacing.md,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quiet: { fontSize: fontSize.bodySm, color: colors.textSubtle, lineHeight: 18 },
  warn: { fontSize: fontSize.bodySm, color: colors.warn, lineHeight: 18 },
  stops: { gap: 0 },
  stopRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.sm, minHeight: touchTarget.standard },
  stopBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  stopMain: { flex: 1, gap: 2 },
  stopTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  stopSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  stopScore: { fontSize: fontSize.titleSm, fontWeight: fontWeight.bold, color: colors.accent },
  // Sticky 88pt primary (Drift #1).
  primaryBtn: {
    flexDirection: 'row',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.sm,
  },
  primaryBtnBusy: { backgroundColor: colors.accentDisabled },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
});
