import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import {
  fetchCurrentWeather,
  WeatherNotConfiguredError,
  type CurrentWeather,
} from '@/lib/services/weather';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

export function WeatherTile() {
  const [weather, setWeather] = useState<CurrentWeather | null>(null);
  const [error, setError] = useState<string | null>(null);

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
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (error) return null; // Just hide rather than show a noisy error
  if (!weather) return null;

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
        {weather.windMph !== undefined && weather.windMph > 0 && (
          <Text style={styles.meta}>{weather.windMph} mph wind</Text>
        )}
      </View>
    </View>
  );
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
  temp: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },
  feels: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.regular },
  desc: { fontSize: fontSize.bodyMd, color: colors.slate, marginTop: 2 },
  meta: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
});
