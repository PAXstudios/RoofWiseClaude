import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  fetchCurrentWeather,
  hasSafetySignal,
  WeatherNotConfiguredError,
  type CurrentWeather,
} from '@/lib/services/weather';
import {
  evaluateSafety,
  SAFETY_RATING_LABELS,
  type SafetyRating,
} from '@/lib/services/safetyEngine';
import { SkeletonBlock } from '@/components/motion';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

/**
 * HAAG §7 go/no-go, colour-coded. Rendered only when the forecast actually
 * carried readings — an all-missing forecast rates USE_CAUTION on absence
 * alone, which would be a placeholder, not information (Drift #5).
 */
const SAFETY_CHIP: Record<SafetyRating, { bg: string; fg: string; icon: 'shield-checkmark' | 'alert-circle' | 'warning' }> = {
  SAFE: { bg: colors.successSoft, fg: colors.success, icon: 'shield-checkmark' },
  USE_CAUTION: { bg: colors.warnSoft, fg: colors.warn, icon: 'alert-circle' },
  UNSAFE: { bg: colors.dangerSoft, fg: colors.danger, icon: 'warning' },
};

export function WeatherTile() {
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted') {
          const req = await Location.requestForegroundPermissionsAsync();
          if (req.status !== 'granted' || cancelled) return;
        }
        const pos = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        const w = await fetchCurrentWeather({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
        });
        if (!cancelled) setWeather(w);
      } catch (e) {
        if (cancelled) return;
        if (e instanceof WeatherNotConfiguredError) setError('Weather offline');
        else setError(null);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null; // Just hide rather than show a noisy error

  // Shimmer while the fetch is in flight so the tile doesn't pop the
  // layout when weather lands.
  if (loading) {
    return (
      <View style={styles.tile}>
        <SkeletonBlock style={styles.skelIcon} />
        <View style={{ flex: 1, gap: spacing.sm }}>
          <SkeletonBlock style={styles.skelLine} />
          <SkeletonBlock style={styles.skelLineShort} />
        </View>
      </View>
    );
  }

  if (!weather) return null;

  // Safety rating comes from the same response the tile is already showing —
  // no second network call, and no chip at all when the readings are missing.
  const safety = hasSafetySignal(weather.safety) ? evaluateSafety(weather.safety) : null;
  const chip = safety ? SAFETY_CHIP[safety.rating] : null;
  const meta = conditionsLine(weather);

  return (
    <View style={styles.tile}>
      <Ionicons
        name={weather.isDaytime ? 'sunny' : 'moon'}
        size={28}
        color={colors.orange}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.temp}>
          {weather.temperatureF}° <Text style={styles.feels}>· feels {weather.feelsLikeF}°</Text>
        </Text>
        <Text style={styles.desc}>{weather.description}</Text>
        {meta.length > 0 && <Text style={styles.meta}>{meta}</Text>}
      </View>
      {safety && chip && (
        <View
          style={[styles.safetyChip, { backgroundColor: chip.bg }]}
          accessibilityRole="text"
          accessibilityLabel={`Roof work safety: ${SAFETY_RATING_LABELS[safety.rating]}. ${safety.reasons[0] ?? ''}`}
        >
          <Ionicons name={chip.icon} size={14} color={chip.fg} />
          <Text style={[styles.safetyChipText, { color: chip.fg }]}>
            {SAFETY_RATING_LABELS[safety.rating].toUpperCase()}
          </Text>
        </View>
      )}
    </View>
  );
}

/** Wind / gust / rain line — only the parts the API actually reported. */
function conditionsLine(weather: CurrentWeather): string {
  const parts: string[] = [];
  if (weather.windMph !== undefined && weather.windMph > 0) {
    parts.push(`${weather.windMph} mph wind`);
  }
  if (weather.gustMph !== undefined && weather.gustMph > 0) {
    parts.push(`gusts ${weather.gustMph}`);
  }
  if (weather.precipChancePercent !== undefined && weather.precipChancePercent > 0) {
    parts.push(`${weather.precipChancePercent}% rain`);
  }
  return parts.join(' · ');
}

const styles = StyleSheet.create({
  tile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    ...shadows.card,
  },
  skelIcon: { width: 28, height: 28, borderRadius: radii.pill },
  skelLine: { height: fontSize.titleMd, width: '55%' },
  skelLineShort: { height: fontSize.bodySm, width: '35%' },
  temp: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  feels: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.regular },
  desc: { fontSize: fontSize.bodyMd, color: colors.slate, marginTop: 2 },
  meta: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },

  safetyChip: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.pill,
  },
  safetyChipText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});
