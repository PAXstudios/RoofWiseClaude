// Unified map component. All feature code (HailTracer, DoorKnocking, Leads,
// Jobs, JobDetail) imports from here, not from `react-native-maps` directly.
// Switching providers, swapping in @vis.gl on web, or adding Mapbox later
// is a one-file change.
//
// Hardening for Apple Maps under the New Architecture (react-native-maps
// 1.20.1, Expo Go on iOS — the owner's only runtime today):
//   - Location permission is resolved BEFORE the native MapView mounts when
//     `showsUserLocation` is on (a not-yet-determined permission at mount is a
//     known assertion path in AIRMap's CLLocationManager wiring). Denied →
//     the map mounts without the blue dot; it never blocks the screen.
//   - Children (markers / circles / tiles) mount only after `onMapReady`
//     (Apple fires it from -mapViewWillStartRenderingMap:), with a timed
//     fallback so a map that never reports ready still gets its overlays.
//   - MapPin / MapCircle are the door every coordinate/radius passes through:
//     an invalid one renders nothing and is counted in Diagnostics.
//   - Only props react-native-maps documents for the active provider are
//     sent; Google-only ones (Heatmap, customMapStyle, …) are gated or absent.

import {
  forwardRef,
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import {
  Platform,
  StyleSheet,
  UIManager,
  View,
  type LayoutChangeEvent,
  type ViewStyle,
} from 'react-native';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import * as Location from 'expo-location';
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
  type MapPressEvent,
  type MapPolylineProps,
  type MapPolygonProps,
  type MapCircleProps,
  type MapHeatmapProps,
} from 'react-native-maps';
import { GoogleTileAttribution, GoogleTileLayer } from '@/components/map/GoogleTileLayer';
import { MeshBackground } from '@/components/ui/MeshBackground';
import { recordError } from '@/lib/services/diagnostics';
import { isValidLatLon, isValidRadius } from '@/lib/services/stormCluster';
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

/**
 * If the native map never reports ready (an unknown provider quirk, a map
 * hidden behind another view), overlays still mount after this — a map with
 * pins beats a map that waits forever. Apple fires onMapReady in
 * -mapViewWillStartRenderingMap:, well inside this window.
 */
const MAP_READY_FALLBACK_MS = 2500;

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
  /** Native map reported ready (children mount on this). */
  onMapReady?: () => void;
  /**
   * A plain tap on the map itself (not on a marker) — the door-knocking
   * "drop a pin on this house". Marker taps are delivered to the marker's
   * own onPress and never reach this.
   */
  onPress?: (coord: MapCoordinate) => void;
  onLongPress?: (coord: MapCoordinate) => void;
  /** The viewport settled after a pan/zoom. Debounce in the caller. */
  onRegionChangeComplete?: (region: Region) => void;
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

type LocationGate = 'pending' | 'granted' | 'denied';

/**
 * Resolve foreground location BEFORE the native map mounts. Asks once when
 * the permission is undetermined and the screen is visible; never re-prompts
 * a denial (iOS wouldn't show the sheet again anyway).
 */
function useLocationGate(wanted: boolean, visible: boolean): LocationGate {
  const [gate, setGate] = useState<LocationGate>(wanted ? 'pending' : 'denied');

  useEffect(() => {
    if (!wanted) {
      setGate('denied');
      return;
    }
    if (!visible) return;
    let cancelled = false;
    (async () => {
      let next: LocationGate = 'denied';
      try {
        let perm = await Location.getForegroundPermissionsAsync();
        if (perm.status !== 'granted' && perm.canAskAgain) {
          perm = await Location.requestForegroundPermissionsAsync();
        }
        next = perm.status === 'granted' ? 'granted' : 'denied';
      } catch {
        next = 'denied';
      }
      if (!cancelled) setGate(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [wanted, visible]);

  return gate;
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
    onPress,
    onLongPress,
    onRegionChangeComplete,
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

  // Viewport + width feed the attribution chip (debounced inside it) and the
  // caller's optional onRegionChangeComplete. The tile layer itself never
  // re-keys on region — every re-fetched tile is a metered request, and the
  // native overlay already caches.
  const [viewport, setViewport] = useState<Region | null>(null);
  const [mapWidth, setMapWidth] = useState(0);
  const handleRegionChangeComplete = useCallback(
    (next: Region) => {
      if (wantGoogleTiles) setViewport(next);
      onRegionChangeComplete?.(next);
    },
    [wantGoogleTiles, onRegionChangeComplete],
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

  // Permission before mount (see useLocationGate). The map mounts either way
  // once the answer is in; only the blue dot depends on "granted".
  const locationGate = useLocationGate(showsUserLocation, isFocused);
  const mountMap = isFocused && locationGate !== 'pending';

  // Children mount only once the native map says it's ready (or the fallback
  // timer fires). Reset whenever the MapView itself unmounts so a re-focus
  // re-runs the gate against the NEW native instance.
  const [mapReady, setMapReady] = useState(false);
  useEffect(() => {
    if (!mountMap) {
      setMapReady(false);
      return;
    }
    const timer = setTimeout(() => setMapReady(true), MAP_READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [mountMap]);
  const handleMapReady = useCallback(() => {
    setMapReady(true);
    onMapReady?.();
  }, [onMapReady]);

  return (
    <View style={[styles.wrap, style]} onLayout={wantGoogleTiles ? onLayout : undefined}>
      {/* The 1A "dark map ground" (docs/DESIGN_1A.md §2/§6) — desaturated,
          no orange stop, so pin colours stay the only warm note. Shows only
          in the gap before the native map mounts (a real MapView is opaque
          once up); a cheap, on-brand upgrade over a flat grey box either
          way. */}
      <MeshBackground variant="map" grain={false} style={StyleSheet.absoluteFill} />
      {mountMap ? (
        <MapView
          ref={ref}
          provider={MAP_PROVIDER}
          style={StyleSheet.absoluteFill}
          // Only send mapType when a caller set one — an explicit `undefined`
          // still crosses the bridge as a prop update on Fabric.
          {...(mapType ? { mapType } : null)}
          showsUserLocation={showsUserLocation && locationGate === 'granted'}
          showsCompass={showsCompass}
          // Apple-only chrome, off while Google tiles cover the base so
          // Apple's POI pins and building extrusions don't poke through at
          // tile seams or while a tile is still loading. Defaults otherwise
          // (and on PROVIDER_GOOGLE these are no-ops / their own defaults).
          showsPointsOfInterests={!tilesLive}
          showsBuildings={!tilesLive}
          showsTraffic={false}
          initialRegion={initialRegion}
          {...(region ? { region } : null)}
          onMapReady={handleMapReady}
          onRegionChangeComplete={
            wantGoogleTiles || onRegionChangeComplete ? handleRegionChangeComplete : undefined
          }
          // Only sent when a caller listens — an `undefined` handler still
          // crosses the bridge as a prop on Fabric. Marker presses carry
          // action 'marker-press' on both providers and are filtered out so
          // a tap on a pin never doubles as a tap on the map beneath it.
          {...(onPress
            ? {
                onPress: (e: MapPressEvent) => {
                  if (e.nativeEvent.action === 'marker-press') return;
                  onPress({
                    latitude: e.nativeEvent.coordinate.latitude,
                    longitude: e.nativeEvent.coordinate.longitude,
                  });
                },
              }
            : null)}
          onLongPress={
            onLongPress
              ? (e) =>
                  onLongPress({
                    latitude: e.nativeEvent.coordinate.latitude,
                    longitude: e.nativeEvent.coordinate.longitude,
                  })
              : undefined
          }
        >
          {/* Nothing native-overlay-shaped until the map is ready. Tile layer
              first so it sits beneath the caller's markers. */}
          {mapReady && wantGoogleTiles ? <GoogleTileLayer mapType={tileMapType} /> : null}
          {mapReady ? children : null}
        </MapView>
      ) : null}
      {/* Required by Google's terms. A sibling of MapView (not a child —
          MapView children must be map primitives), non-interactive, and it
          only exists while Google imagery is actually on screen. */}
      {wantGoogleTiles && mountMap ? (
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

// -----------------------------------------------------------------------------
// The one door to native for coordinates and radii
// -----------------------------------------------------------------------------

// Once per kind per session: Diagnostics gets the fact, not a flood.
const reportedInvalid = new Set<string>();
function reportInvalidOverlay(kind: 'marker' | 'circle' | 'polyline' | 'polygon'): void {
  if (reportedInvalid.has(kind)) return;
  reportedInvalid.add(kind);
  recordError(`[map] dropped a ${kind} with an invalid coordinate/radius before native`, {
    kind: 'console_error',
  });
}

function validCoordinate(c: { latitude: unknown; longitude: unknown } | null | undefined): boolean {
  return !!c && isValidLatLon(c.latitude, c.longitude);
}

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

/**
 * Marker with a tone from the theme. `tracksViewChanges` defaults to false —
 * a custom-view marker that keeps re-snapshotting every frame is the single
 * biggest marker cost on iOS; pass `tracksViewChanges` explicitly for the
 * rare marker whose child view animates.
 */
export function MapPin({ tone, pinColor, tracksViewChanges = false, coordinate, ...rest }: MapPinProps) {
  if (!validCoordinate(coordinate)) {
    reportInvalidOverlay('marker');
    return null;
  }
  const color = tone ? TONE_COLORS[tone] : pinColor;
  return (
    <Marker
      {...rest}
      coordinate={coordinate}
      tracksViewChanges={tracksViewChanges}
      pinColor={color as string | undefined}
    />
  );
}

export function MapPolyline({ coordinates, ...rest }: MapPolylineProps) {
  const clean = (coordinates ?? []).filter(validCoordinate);
  if (clean.length !== (coordinates ?? []).length) reportInvalidOverlay('polyline');
  if (clean.length < 2) return null;
  return <Polyline {...rest} coordinates={clean} />;
}

export function MapPolygon({ coordinates, ...rest }: MapPolygonProps) {
  const clean = (coordinates ?? []).filter(validCoordinate);
  if (clean.length !== (coordinates ?? []).length) reportInvalidOverlay('polygon');
  if (clean.length < 3) return null;
  return <Polygon {...rest} coordinates={clean} />;
}

export function MapCircle({ center, radius, ...rest }: MapCircleProps) {
  if (!validCoordinate(center) || !isValidRadius(radius)) {
    reportInvalidOverlay('circle');
    return null;
  }
  return <Circle {...rest} center={center} radius={radius} />;
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
