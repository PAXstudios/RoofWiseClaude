// Web implementation of the Map abstraction, backed by the Google Maps
// JavaScript API (loaded at runtime from maps.googleapis.com using the
// EXPO_PUBLIC_GOOGLE_MAPS_WEB_KEY env var — no other external script).
//
// Mirrors Map.tsx's export surface exactly so call sites need no platform
// checks: Map (forwardRef), MapPin, MapPolyline, MapPolygon, MapCircle,
// MapHeatmap, regionForLatLon, and the Region / MapCoordinate types.
//
// When the key is absent the friendly placeholder panel renders instead
// (Drift #5: absent, never synthesized). Script/auth failures degrade to a
// similar friendly panel — never a crash, never fake pins.

import {
  createContext,
  forwardRef,
  useContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ReactNode,
  type Ref,
} from 'react';
import { View, Text, StyleSheet, type ViewStyle } from 'react-native';
import { env } from '@/lib/env';
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
  /**
   * Web only: top-anchor the no-map fallback panel this many points from the
   * top instead of centering it. Tab roots pass this so the panel sits right
   * under their floating chip rows (centered empties are for sub-screens).
   */
  fallbackTopOffset?: number;
  children?: ReactNode;
};

// ---------------------------------------------------------------------------
// Google Maps JS API loader — singleton, callback-based, retry on failure.
// ---------------------------------------------------------------------------

type GoogleMapsApi = any;

let loaderPromise: Promise<GoogleMapsApi> | null = null;
let authFailed = false;
const authFailureListeners = new Set<() => void>();

function loadGoogleMaps(key: string): Promise<GoogleMapsApi> {
  if (loaderPromise) return loaderPromise;
  loaderPromise = new Promise((resolve, reject) => {
    const g = (globalThis as any).google;
    if (g?.maps?.Map) {
      resolve(g.maps);
      return;
    }
    // Google calls this global when the key is invalid / unauthorized.
    (globalThis as any).gm_authFailure = () => {
      authFailed = true;
      authFailureListeners.forEach((fn) => fn());
    };
    const cbName = '__roofwiseGmapsReady';
    (globalThis as any)[cbName] = () => {
      const gmaps = (globalThis as any).google?.maps;
      if (gmaps) resolve(gmaps);
      else reject(new Error('Google Maps failed to initialize'));
    };
    const params = new URLSearchParams({
      key,
      v: 'weekly',
      loading: 'async',
      callback: cbName,
    });
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?${params.toString()}`;
    script.async = true;
    script.onerror = () => {
      loaderPromise = null; // allow a later mount to retry
      reject(new Error('Google Maps script failed to load'));
    };
    document.head.appendChild(script);
  });
  return loaderPromise;
}

// ---------------------------------------------------------------------------
// Region <-> center/zoom
// ---------------------------------------------------------------------------

function zoomForRegion(region: Region): number {
  const delta = Math.max(region.longitudeDelta, 1e-4);
  const zoom = Math.round(Math.log2(360 / delta));
  return Math.min(20, Math.max(1, zoom));
}

function applyRegion(map: any, region: Region) {
  map.setCenter({ lat: region.latitude, lng: region.longitude });
  map.setZoom(zoomForRegion(region));
}

export function regionForLatLon(lat: number, lon: number, delta = 0.06): Region {
  return { latitude: lat, longitude: lon, latitudeDelta: delta, longitudeDelta: delta };
}

// Overlay children receive the live google.maps.Map instance via context.
const MapCtx = createContext<any>(null);

function useGmap(): any {
  return useContext(MapCtx);
}

function gmapsApi(): any {
  return (globalThis as any).google.maps;
}

// rgba(...) fills need to be split into color + opacity for Maps overlays.
function cssFill(color?: string): { color?: string; opacity?: number } {
  if (!color) return {};
  const m = color.match(
    /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*([\d.]+)\s*\)$/i,
  );
  if (m) return { color: `rgb(${m[1]}, ${m[2]}, ${m[3]})`, opacity: parseFloat(m[4]) };
  return { color, opacity: 1 };
}

// ---------------------------------------------------------------------------
// Map
// ---------------------------------------------------------------------------

const hasWebKey = env.GOOGLE_MAPS_WEB_KEY.length > 0;

export const Map = forwardRef(function Map(
  { style, initialRegion, region, onMapReady, onLongPress, fallbackTopOffset, children }: MapProps,
  ref: Ref<unknown>,
) {
  // Tab roots anchor the fallback under their chip rows; sub-screens center.
  const fallbackAnchor =
    fallbackTopOffset != null
      ? { justifyContent: 'flex-start' as const, paddingTop: fallbackTopOffset }
      : null;
  const divRef = useRef<HTMLDivElement | null>(null);
  const [map, setMap] = useState<any>(null);
  const [failed, setFailed] = useState(false);

  // Keep latest callbacks without tearing the map down.
  const onLongPressRef = useRef(onLongPress);
  onLongPressRef.current = onLongPress;
  const onMapReadyRef = useRef(onMapReady);
  onMapReadyRef.current = onMapReady;

  // Seed viewport captured once — `region` afterwards is handled as a
  // controlled prop below, matching react-native-maps semantics.
  const seedRef = useRef(region ?? initialRegion);

  useEffect(() => {
    if (!hasWebKey) return;
    let cancelled = false;
    let mapObj: any = null;
    const onAuthFail = () => {
      if (!cancelled) setFailed(true);
    };
    if (authFailed) {
      setFailed(true);
      return;
    }
    authFailureListeners.add(onAuthFail);
    loadGoogleMaps(env.GOOGLE_MAPS_WEB_KEY)
      .then((gmaps) => {
        if (cancelled || !divRef.current) return;
        const seed = seedRef.current;
        mapObj = new gmaps.Map(divRef.current, {
          center: seed
            ? { lat: seed.latitude, lng: seed.longitude }
            : { lat: 0, lng: 0 },
          zoom: seed ? zoomForRegion(seed) : 2,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
          clickableIcons: false,
        });
        // Long-press on touch devices and right-click on desktop both fire
        // 'contextmenu' in the Maps JS API — the closest analog to native
        // onLongPress.
        mapObj.addListener('contextmenu', (e: any) => {
          if (e?.latLng) {
            onLongPressRef.current?.({
              latitude: e.latLng.lat(),
              longitude: e.latLng.lng(),
            });
          }
        });
        gmaps.event.addListenerOnce(mapObj, 'idle', () => {
          onMapReadyRef.current?.();
        });
        setMap(mapObj);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
      authFailureListeners.delete(onAuthFail);
    };
  }, []);

  // Controlled `region` prop → recenter.
  useEffect(() => {
    if (!map || !region) return;
    applyRegion(map, region);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    map,
    region?.latitude,
    region?.longitude,
    region?.latitudeDelta,
    region?.longitudeDelta,
  ]);

  // Call sites hold a ref typed as react-native-maps' MapView; support the
  // one method the app could reasonably call.
  useImperativeHandle(
    ref,
    () => ({
      animateToRegion: (r: Region, _durationMs?: number) => {
        if (map) applyRegion(map, r);
      },
    }),
    [map],
  );

  if (!hasWebKey) {
    return (
      <View style={[styles.wrap, style as ViewStyle, fallbackAnchor]}>
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
  }

  if (failed) {
    return (
      <View style={[styles.wrap, style as ViewStyle, fallbackAnchor]}>
        <View style={styles.inner}>
          <View style={styles.pinGlyph}>
            <View style={styles.pinHead} />
            <View style={styles.pinTip} />
          </View>
          <Text style={styles.title}>Map isn&apos;t available right now</Text>
          <Text style={styles.sub}>
            The map couldn&apos;t load. Check your connection and reload — your
            jobs, leads, and reports still work here on the web.
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.wrap, style as ViewStyle]}>
      <div
        ref={divRef}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      />
      {map ? <MapCtx.Provider value={map}>{children}</MapCtx.Provider> : null}
    </View>
  );
});

// ---------------------------------------------------------------------------
// MapPin
// ---------------------------------------------------------------------------

export type MapPinProps = {
  coordinate: MapCoordinate;
  title?: string;
  description?: string;
  tone?: string;
  pinColor?: string;
  onPress?: () => void;
  onCalloutPress?: () => void;
  children?: ReactNode;
};

const TONE_COLORS: Record<string, string> = {
  navy: colors.navy,
  orange: colors.orange,
  cream: colors.cream,
  success: colors.success,
  warn: colors.warn,
  danger: colors.danger,
  info: colors.info,
};

// Classic teardrop pin, anchored at its tip (0,0).
const PIN_PATH =
  'M 0,0 C -2,-20 -10,-22 -10,-30 A 10,10 0 1 1 10,-30 C 10,-22 2,-20 0,0 z';

export function MapPin({
  coordinate,
  title,
  description,
  tone,
  pinColor,
  onPress,
  onCalloutPress,
}: MapPinProps) {
  const map = useGmap();
  const handlersRef = useRef({ onPress, onCalloutPress });
  handlersRef.current = { onPress, onCalloutPress };

  useEffect(() => {
    if (!map) return;
    const gmaps = gmapsApi();
    const color = (tone ? TONE_COLORS[tone] : undefined) ?? pinColor ?? colors.accent;
    const marker = new gmaps.Marker({
      map,
      position: { lat: coordinate.latitude, lng: coordinate.longitude },
      title,
      icon: {
        path: PIN_PATH,
        fillColor: color,
        fillOpacity: 1,
        strokeColor: colors.surface,
        strokeWeight: 1.5,
        scale: 1.1,
        anchor: new gmaps.Point(0, 0),
      },
    });
    let info: any = null;
    const clickListener = marker.addListener('click', () => {
      handlersRef.current.onPress?.();
      if (!title && !description) return;
      if (!info) {
        // DOM-built callout (textContent, never innerHTML) mirroring the
        // native marker callout; tapping it fires onCalloutPress.
        const content = document.createElement('div');
        if (title) {
          const t = document.createElement('div');
          t.textContent = title;
          t.style.fontWeight = String(fontWeight.semibold);
          content.appendChild(t);
        }
        if (description) {
          const d = document.createElement('div');
          d.textContent = description;
          content.appendChild(d);
        }
        content.style.color = colors.text;
        if (handlersRef.current.onCalloutPress) {
          content.style.cursor = 'pointer';
          content.addEventListener('click', () => {
            handlersRef.current.onCalloutPress?.();
          });
        }
        info = new gmaps.InfoWindow({ content });
      }
      info.open({ map, anchor: marker });
    });
    return () => {
      clickListener.remove();
      info?.close();
      marker.setMap(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, coordinate.latitude, coordinate.longitude, title, description, tone, pinColor]);

  return null;
}

// ---------------------------------------------------------------------------
// MapPolyline / MapPolygon / MapCircle
// ---------------------------------------------------------------------------

export type MapPolylineProps = {
  coordinates: MapCoordinate[];
  strokeColor?: string;
  strokeWidth?: number;
};

export function MapPolyline({ coordinates, strokeColor, strokeWidth }: MapPolylineProps) {
  const map = useGmap();
  const coordsKey = JSON.stringify(coordinates);

  useEffect(() => {
    if (!map || coordinates.length === 0) return;
    const gmaps = gmapsApi();
    const stroke = cssFill(strokeColor);
    const line = new gmaps.Polyline({
      map,
      path: coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
      strokeColor: stroke.color ?? colors.navy,
      strokeOpacity: stroke.opacity ?? 1,
      strokeWeight: strokeWidth ?? 2,
      clickable: false,
    });
    return () => line.setMap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, coordsKey, strokeColor, strokeWidth]);

  return null;
}

export type MapPolygonProps = {
  coordinates: MapCoordinate[];
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
};

export function MapPolygon({
  coordinates,
  strokeColor,
  strokeWidth,
  fillColor,
}: MapPolygonProps) {
  const map = useGmap();
  const coordsKey = JSON.stringify(coordinates);

  useEffect(() => {
    if (!map || coordinates.length === 0) return;
    const gmaps = gmapsApi();
    const stroke = cssFill(strokeColor);
    const fill = cssFill(fillColor);
    const polygon = new gmaps.Polygon({
      map,
      paths: coordinates.map((c) => ({ lat: c.latitude, lng: c.longitude })),
      strokeColor: stroke.color ?? colors.navy,
      strokeOpacity: stroke.opacity ?? 1,
      strokeWeight: strokeWidth ?? 2,
      fillColor: fill.color ?? colors.navy,
      fillOpacity: fill.opacity ?? 0.2,
      clickable: false,
    });
    return () => polygon.setMap(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, coordsKey, strokeColor, strokeWidth, fillColor]);

  return null;
}

export type MapCircleProps = {
  center: MapCoordinate;
  radius: number;
  strokeColor?: string;
  strokeWidth?: number;
  fillColor?: string;
};

export function MapCircle({
  center,
  radius,
  strokeColor,
  strokeWidth,
  fillColor,
}: MapCircleProps) {
  const map = useGmap();

  useEffect(() => {
    if (!map) return;
    const gmaps = gmapsApi();
    const stroke = cssFill(strokeColor);
    const fill = cssFill(fillColor);
    const circle = new gmaps.Circle({
      map,
      center: { lat: center.latitude, lng: center.longitude },
      radius,
      strokeColor: stroke.color ?? colors.navy,
      strokeOpacity: stroke.opacity ?? 1,
      strokeWeight: strokeWidth ?? 1,
      fillColor: fill.color ?? colors.navy,
      fillOpacity: fill.opacity ?? 0.2,
      clickable: false,
    });
    return () => circle.setMap(null);
  }, [map, center.latitude, center.longitude, radius, strokeColor, strokeWidth, fillColor]);

  return null;
}

// ---------------------------------------------------------------------------
// MapHeatmap — approximated with zoom-aware weighted circles (the JS API's
// visualization heatmap layer is deprecated; this keeps the dependency
// surface to the core script only).
// ---------------------------------------------------------------------------

export type MapHeatmapProps = {
  points: { latitude: number; longitude: number; weight?: number }[];
  radius?: number;
  opacity?: number;
  gradient?: { colors: string[]; startPoints?: number[]; colorMapSize?: number };
};

function metersForPixels(px: number, latitude: number, zoom: number): number {
  const metersPerPixel =
    (156543.03392 * Math.cos((latitude * Math.PI) / 180)) / Math.pow(2, zoom);
  return px * metersPerPixel;
}

export function MapHeatmap({ points, radius = 40, opacity = 0.7, gradient }: MapHeatmapProps) {
  const map = useGmap();
  const pointsKey = JSON.stringify(points);
  const gradientKey = JSON.stringify(gradient ?? null);

  useEffect(() => {
    if (!map || points.length === 0) return;
    const gmaps = gmapsApi();
    // Use the middle gradient stop as the blob color, like the native
    // heatmap's mid-intensity band.
    const gradientColors = gradient?.colors ?? [];
    const color =
      gradientColors[Math.floor((gradientColors.length - 1) / 2)] ?? colors.accent;
    const maxWeight = points.reduce((m, p) => Math.max(m, p.weight ?? 1), 1);
    const zoom = map.getZoom() ?? 6;
    const circles = points.map((p) => {
      const w = (p.weight ?? 1) / maxWeight;
      return new gmaps.Circle({
        map,
        center: { lat: p.latitude, lng: p.longitude },
        radius: metersForPixels(radius, p.latitude, zoom),
        strokeWeight: 0,
        fillColor: color,
        fillOpacity: Math.min(1, opacity * (0.25 + 0.75 * w)),
        clickable: false,
      });
    });
    // Native heatmap radius is screen-px; keep blob size steady across zooms.
    const zoomListener = map.addListener('zoom_changed', () => {
      const z = map.getZoom() ?? 6;
      circles.forEach((c: any, i: number) =>
        c.setRadius(metersForPixels(radius, points[i].latitude, z)),
      );
    });
    return () => {
      zoomListener.remove();
      circles.forEach((c: any) => c.setMap(null));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, pointsKey, radius, opacity, gradientKey]);

  return null;
}

// ---------------------------------------------------------------------------
// Styles — identical placeholder styling to the previous web fallback.
// ---------------------------------------------------------------------------

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
