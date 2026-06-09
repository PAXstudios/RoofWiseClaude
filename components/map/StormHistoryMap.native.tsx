import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { severityColor, magnitudeLabel } from '@/lib/noaa';
import type { StormMapProps } from './types';
import { colors, radii } from '@/theme/tokens';

export default function StormHistoryMap({ events, center, zoom }: StormMapProps) {
  const ref = useRef<MapView>(null);

  useEffect(() => {
    const span = 360 / Math.pow(2, Math.max(2, zoom));
    ref.current?.animateToRegion(
      {
        latitude: center.lat,
        longitude: center.lon,
        latitudeDelta: span,
        longitudeDelta: span,
      },
      400,
    );
  }, [center.lat, center.lon, zoom]);

  return (
    <View style={styles.wrap}>
      <MapView
        ref={ref}
        style={StyleSheet.absoluteFill}
        showsUserLocation
        initialRegion={{
          latitude: center.lat,
          longitude: center.lon,
          latitudeDelta: 4,
          longitudeDelta: 4,
        }}
      >
        {events.map((e) => (
          <Marker
            key={e.id}
            coordinate={{ latitude: e.lat, longitude: e.lon }}
            title={`${e.type === 'hail' ? 'Hail' : 'Wind'} · ${magnitudeLabel(e)}`}
            description={`${new Date(e.occurredAt).toLocaleDateString()} ${e.city ?? ''}`}
            pinColor={severityColor(e)}
          />
        ))}
      </MapView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
});
