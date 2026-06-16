// Unified map component. All feature code (HailTracer, DoorKnocking, Leads,
// Jobs, JobDetail) imports from here, not from `react-native-maps` directly.
// Switching providers, swapping in @vis.gl on web, or adding Mapbox later
// is a one-file change.

import { forwardRef, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import MapView, {
  Marker,
  Polyline,
  Polygon,
  Circle,
  Heatmap,
  PROVIDER_GOOGLE,
  PROVIDER_DEFAULT,
  type Region,
  type MapMarkerProps,
  type MapPolylineProps,
  type MapPolygonProps,
  type MapCircleProps,
  type MapHeatmapProps,
} from 'react-native-maps';
import { colors, radii } from '@/theme/tokens';

// Expo Go on iOS does not bundle the Google Maps SDK — requesting
// PROVIDER_GOOGLE there throws "AirGoogleMaps dir must be added to your
// xCode project". Use Google on Android (default native provider) and in
// custom dev builds; fall back to Apple Maps in Expo Go on iOS.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const MAP_PROVIDER =
  Platform.OS === 'ios' && inExpoGo ? PROVIDER_DEFAULT : PROVIDER_GOOGLE;

export type MapCoordinate = { latitude: number; longitude: number };

export type MapProps = {
  initialRegion?: Region;
  region?: Region;
  showsUserLocation?: boolean;
  showsCompass?: boolean;
  style?: ViewStyle;
  children?: ReactNode;
  onMapReady?: () => void;
  onLongPress?: (coord: MapCoordinate) => void;
};

export const Map = forwardRef(function Map(
  {
    initialRegion,
    region,
    showsUserLocation = true,
    showsCompass = true,
    style,
    children,
    onMapReady,
    onLongPress,
  }: MapProps,
  ref: Ref<MapView>,
) {
  return (
    <View style={[styles.wrap, style]}>
      <MapView
        ref={ref}
        provider={MAP_PROVIDER}
        style={StyleSheet.absoluteFill}
        showsUserLocation={showsUserLocation}
        showsCompass={showsCompass}
        initialRegion={initialRegion}
        region={region}
        onMapReady={onMapReady}
        onLongPress={(e) =>
          onLongPress?.({
            latitude: e.nativeEvent.coordinate.latitude,
            longitude: e.nativeEvent.coordinate.longitude,
          })
        }
      >
        {children}
      </MapView>
    </View>
  );
});

export type MapPinProps = MapMarkerProps & {
  tone?: 'navy' | 'orange' | 'cream' | 'success' | 'warn' | 'danger' | 'info';
};

const TONE_COLORS: Record<NonNullable<MapPinProps['tone']>, string> = {
  navy: colors.navy,
  orange: colors.orange,
  cream: colors.cream,
  success: colors.success,
  warn: colors.warn,
  danger: colors.danger,
  info: colors.info,
};

export function MapPin({ tone, pinColor, ...rest }: MapPinProps) {
  const color = tone ? TONE_COLORS[tone] : pinColor;
  return <Marker {...rest} pinColor={color as string | undefined} />;
}

export function MapPolyline(props: MapPolylineProps) {
  return <Polyline {...props} />;
}

export function MapPolygon(props: MapPolygonProps) {
  return <Polygon {...props} />;
}

export function MapCircle(props: MapCircleProps) {
  return <Circle {...props} />;
}

export function MapHeatmap(props: MapHeatmapProps) {
  return <Heatmap {...props} />;
}

export function regionForLatLon(
  lat: number,
  lon: number,
  delta = 0.06,
): Region {
  return { latitude: lat, longitude: lon, latitudeDelta: delta, longitudeDelta: delta };
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    overflow: 'hidden',
  },
});

export type { Region } from 'react-native-maps';
