// Web fallback for the Map abstraction. react-native-maps has no web
// implementation, so on web every map surface renders a friendly
// placeholder panel instead (Drift #5: absent, never synthesized).
// Mirrors Map.tsx's export surface so call sites need no platform checks.
import { forwardRef, type ReactNode, type Ref } from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export type MapCoordinate = { latitude: number; longitude: number };

export type Region = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapProps = {
  style?: ViewStyle | ViewStyle[];
  showsUserLocation?: boolean;
  showsCompass?: boolean;
  initialRegion?: Region;
  region?: Region;
  onMapReady?: () => void;
  onLongPress?: (coord: MapCoordinate) => void;
  children?: ReactNode;
};

export const Map = forwardRef(function Map(
  { style }: MapProps,
  _ref: Ref<unknown>,
) {
  return (
    <View style={[styles.wrap, style as ViewStyle]}>
      <View style={styles.inner}>
        <View style={styles.pinGlyph}>
          <View style={styles.pinHead} />
          <View style={styles.pinTip} />
        </View>
        <Text style={styles.title}>Map runs on the mobile app</Text>
        <Text style={styles.sub}>
          Pins, storm history, and routes render on iOS and Android. This web
          preview shows every other screen.
        </Text>
      </View>
    </View>
  );
});

export type MapPinProps = {
  coordinate: MapCoordinate;
  title?: string;
  description?: string;
  tone?: string;
  pinColor?: string;
  onPress?: () => void;
  children?: ReactNode;
};

export function MapPin(_props: MapPinProps) { return null; }
export function MapPolyline(_props: Record<string, unknown>) { return null; }
export function MapPolygon(_props: Record<string, unknown>) { return null; }
export function MapCircle(_props: Record<string, unknown>) { return null; }
export function MapHeatmap(_props: Record<string, unknown>) { return null; }

export function regionForLatLon(lat: number, lon: number, delta = 0.06): Region {
  return { latitude: lat, longitude: lon, latitudeDelta: delta, longitudeDelta: delta };
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inner: { alignItems: 'center', gap: spacing.sm, padding: spacing.xxl, maxWidth: 420 },
  pinGlyph: { alignItems: 'center', marginBottom: spacing.sm },
  pinHead: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.orange,
    borderWidth: 4,
    borderColor: colors.surface,
  },
  pinTip: {
    width: 0,
    height: 0,
    borderLeftWidth: 8,
    borderRightWidth: 8,
    borderTopWidth: 12,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
    borderTopColor: colors.orange,
    marginTop: -3,
  },
  title: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, textAlign: 'center' },
  sub: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center', lineHeight: 20 },
});
