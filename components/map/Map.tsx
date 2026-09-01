// Unified map component. All feature code (HailTracer, DoorKnocking, Leads,
// Jobs, JobDetail) imports from here, not from `react-native-maps` directly.
// Switching providers, swapping in @vis.gl on web, or adding Mapbox later
// is a one-file change.

import { forwardRef, useCallback, useState, type ReactNode, type Ref } from 'react';
import { Platform, StyleSheet, View, type ViewStyle } from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { useFocusEffect, useNavigation } from 'expo-router';
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
  /** Web only (Map.web.tsx): top-anchors the no-map fallback panel. The
   *  native map fills the screen, so this is a no-op here. */
  fallbackTopOffset?: number;
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
  // The Map tab is one of the 5 tab roots and gets pre-mounted by the tab
  // navigator. On iOS Simulator the underlying MKMapView (Apple Maps) fires
  // -mapViewWillStartRenderingMap: into react-native-maps' AIRMapManager
  // during init, hits a stale pointer, and SIGSEGVs — killing whichever
  // screen the user is actually on. Gate the native MapView on screen
  // focus so it only mounts when its host screen is visible.
  //
  // expo-router's useFocusEffect instead of @react-navigation/native's
  // useIsFocused: expo-router drops its react-navigation dependency in SDK 56.
  // Seeded from the navigator's current focus so a screen that mounts already
  // focused (a pushed route, not a pre-mounted tab) renders the MapView on its
  // first commit — exactly what useIsFocused did — so a parent's mount-effect
  // `ref.current?.animateToRegion(...)` still finds a live ref.
  const navigation = useNavigation();
  const [isFocused, setIsFocused] = useState(() => navigation.isFocused());
  useFocusEffect(
    useCallback(() => {
      setIsFocused(true);
      return () => setIsFocused(false);
    }, []),
  );

  return (
    <View style={[styles.wrap, style]}>
      {isFocused ? (
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
      ) : null}
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
