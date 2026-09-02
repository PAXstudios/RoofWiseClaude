// Unified map component. All feature code (HailTracer, DoorKnocking, Leads,
// Jobs, JobDetail) imports from here, not from `react-native-maps` directly.
// Switching providers, swapping in @vis.gl on web, or adding Mapbox later
// is a one-file change.

import { forwardRef, useCallback, useState, type ReactNode, type Ref } from 'react';
import {
  Platform,
  StyleSheet,
  UIManager,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
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
import { GoogleTileAttribution, GoogleTileLayer } from '@/components/map/GoogleTileLayer';
import { isTileSessionValid, useMapTilesStore, type TileMapType } from '@/lib/stores/mapTilesStore';
import { colors, radii } from '@/theme/tokens';

// Expo Go on iOS does not bundle the Google Maps SDK — requesting
// PROVIDER_GOOGLE there throws "AirGoogleMaps dir must be added to your
// xCode project". Use Google on Android (default native provider) and in
// custom dev builds; fall back to Apple Maps in Expo Go on iOS.
const inExpoGo = Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
const MAP_PROVIDER =
  Platform.OS === 'ios' && inExpoGo ? PROVIDER_DEFAULT : PROVIDER_GOOGLE;

/**
 * The owner wants Google Maps, not Apple Maps. Where the native Google SDK
 * can't load (Expo Go on iOS — the only place MAP_PROVIDER is Apple), Google's
 * real road/satellite imagery is drawn over the Apple base as an opaque
 * UrlTile from the Map Tiles API (lib/services/mapTiles.ts). It lights up on
 * its own the moment the owner's key allows that API; until then, and on any
 * failure, the Apple base simply stays and Diagnostics carries the reason.
 * Native builds and Android already render PROVIDER_GOOGLE and are untouched.
 */
const USE_GOOGLE_TILE_LAYER = Platform.OS === 'ios' && inExpoGo;

/**
 * Heatmap is Google-Maps-only. react-native-maps ships AIRGoogleMapHeatmap
 * under ios/AirGoogleMaps and NO Apple Maps equivalent, yet MapHeatmap.js
 * still calls requireNativeComponent('AIRMapHeatmap') under the default
 * provider — a render-time "View config not found for component
 * `AIRMapHeatmap`" invariant that takes the whole screen down (Hail Tracer in
 * Expo Go on iOS, the moment any hail event exists). Gate on the native
 * registration itself — the same check react-native-maps uses for
 * `googleMapIsInstalled` — not on the provider constant: a dev build that
 * requests PROVIDER_GOOGLE without AirGoogleMaps linked would otherwise
 * render `<undefined>` and throw 'Element type is invalid' instead.
 */
export const MAP_SUPPORTS_HEATMAP =
  Platform.OS === 'android' ||
  (MAP_PROVIDER === PROVIDER_GOOGLE && UIManager.hasViewManagerConfig('AIRGoogleMapHeatmap'));

export type MapCoordinate = { latitude: number; longitude: number };

/** Base imagery. `standard` is roads; `satellite`/`hybrid` are aerial. */
export type MapImageryType = 'standard' | 'satellite' | 'hybrid';

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
  /** Road map (default) or aerial imagery. Drives both the native map type
   *  and, in Expo Go on iOS, which Google tile set is drawn over Apple. */
  mapType?: MapImageryType;
  /**
   * Expo Go on iOS only: draw Google's imagery over the Apple base (default
   * true). Opt OUT on a screen whose MapCircle / MapPolygon / MapPolyline
   * layers carry the information — MapKit stacks tile overlays ABOVE those
   * vector overlays, so an opaque Google tile hides them. Markers and
   * callouts are annotations and always stay on top.
   */
  googleImagery?: boolean;
  /** Lifts the "Google · Map data ©…" attribution chip clear of a host
   *  screen's own bottom-left chrome. Defaults to a small corner inset. */
  attributionInset?: { bottom?: number; left?: number };
};

function tileMapTypeFor(mapType: MapImageryType | undefined): TileMapType {
  return mapType === 'satellite' || mapType === 'hybrid' ? 'satellite' : 'roadmap';
}

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
    mapType,
    googleImagery = true,
    attributionInset,
  }: MapProps,
  ref: Ref<MapView>,
) {
  // Google imagery over Apple (Expo Go on iOS). `tilesLive` is true only
  // while a real Map Tiles session exists — it flips the Apple base's own
  // labels/POIs off so nothing bleeds at tile seams, and back on the moment
  // the session lapses so the fallback map is a complete map.
  const wantGoogleTiles = USE_GOOGLE_TILE_LAYER && googleImagery;
  const tileMapType = tileMapTypeFor(mapType);
  const tileSession = useMapTilesStore((s) => s.sessions[tileMapType]);
  const tilesLive = wantGoogleTiles && isTileSessionValid(tileSession);

  // Viewport + width feed ONLY the attribution chip (debounced inside it).
  // The tile layer itself never re-keys on region — every re-fetched tile is
  // a metered request, and the native overlay already caches.
  const [viewport, setViewport] = useState<Region | null>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const onRegionChangeComplete = useCallback(
    (next: Region) => {
      if (wantGoogleTiles) setViewport(next);
    },
    [wantGoogleTiles],
  );
  const onLayout = useCallback((e: LayoutChangeEvent) => {
    setMapWidth(e.nativeEvent.layout.width);
  }, []);
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
    <View style={[styles.wrap, style]} onLayout={wantGoogleTiles ? onLayout : undefined}>
      {isFocused ? (
        <MapView
          ref={ref}
          provider={MAP_PROVIDER}
          style={StyleSheet.absoluteFill}
          mapType={mapType}
          showsUserLocation={showsUserLocation}
          showsCompass={showsCompass}
          // Apple-only chrome, off while Google tiles cover the base so
          // Apple's POI pins and building extrusions don't poke through at
          // tile seams or while a tile is still loading. Defaults otherwise
          // (and on PROVIDER_GOOGLE these are no-ops / their own defaults).
          showsPointsOfInterest={!tilesLive}
          showsBuildings={!tilesLive}
          showsTraffic={false}
          initialRegion={initialRegion}
          region={region}
          onMapReady={onMapReady}
          onRegionChangeComplete={wantGoogleTiles ? onRegionChangeComplete : undefined}
          onLongPress={(e) =>
            onLongPress?.({
              latitude: e.nativeEvent.coordinate.latitude,
              longitude: e.nativeEvent.coordinate.longitude,
            })
          }
        >
          {/* First child so the native overlay is inserted beneath the
              caller's markers. Renders nothing without a session. */}
          {wantGoogleTiles ? <GoogleTileLayer mapType={tileMapType} /> : null}
          {children}
        </MapView>
      ) : null}
      {/* Required by Google's terms. A sibling of MapView (not a child —
          MapView children must be map primitives), non-interactive, and it
          only exists while Google imagery is actually on screen. */}
      {wantGoogleTiles && isFocused ? (
        <GoogleTileAttribution
          mapType={tileMapType}
          region={viewport ?? region ?? initialRegion ?? null}
          viewportWidth={mapWidth}
          inset={attributionInset}
        />
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
  // Never mount the native Heatmap where it has no view manager (Apple Maps /
  // Expo Go iOS) — see MAP_SUPPORTS_HEATMAP. Callers draw MapCircle instead.
  if (!MAP_SUPPORTS_HEATMAP) return null;
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
