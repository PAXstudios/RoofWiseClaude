// Google imagery over the Apple base — Expo Go on iOS only (mounted by
// components/map/Map.tsx, never imported by feature code).
//
// Two pieces, because react-native-maps children must be map primitives:
//   <GoogleTileLayer>        — a UrlTile for the active Map Tiles session.
//                              Child of MapView. Renders nothing without a
//                              session, so the Apple base simply shows.
//   <GoogleTileAttribution>  — the "Google · Map data ©…" chip Google's terms
//                              require. Sibling of MapView, absolute-positioned
//                              in the map's corner, non-interactive.
//
// The UrlTile is deliberately keyed on nothing that changes with the viewport:
// react-native-maps' MKTileOverlay keeps its own tile cache, and every tile
// re-fetched is a metered request. Only a new session token changes its
// props. Region changes reach ONLY the attribution chip, debounced.

import { useEffect, useRef, useState } from 'react';
import { AppState, StyleSheet, Text, View } from 'react-native';
import { UrlTile } from 'react-native-maps';
import {
  ensureSession,
  fetchViewportAttribution,
  tileUrlTemplate,
  viewportForRegion,
  GOOGLE_TILES_MAX_ZOOM,
  GOOGLE_TILES_TILE_SIZE,
  RETRY_AFTER_FAILURE_MS,
  type TileMapType,
} from '@/lib/services/mapTiles';
import { isTileSessionValid, useMapTilesStore } from '@/lib/stores/mapTilesStore';
import { colors, fontSize, fontWeight, glass, radii, spacing } from '@/theme/tokens';

/** How often a mounted map re-asks for a session while it has none — this is
 *  what makes imagery light up on its own once the key allows the API. The
 *  service throttles the actual network call, so two mounted maps still cost
 *  at most one createSession per RETRY_AFTER_FAILURE_MS. */
const KEEPALIVE_INTERVAL_MS = RETRY_AFTER_FAILURE_MS;

/** Attribution re-query settles this long after the last region change. */
const ATTRIBUTION_DEBOUNCE_MS = 700;

type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

/**
 * Keeps a session alive for this map type while any map is mounted: first
 * ask on mount, then every KEEPALIVE_INTERVAL_MS, and again whenever the app
 * returns to the foreground (a roofer flips to Google Cloud, allows the API,
 * flips back — the next tick paints Google).
 */
function useSessionKeepalive(mapType: TileMapType) {
  useEffect(() => {
    let cancelled = false;
    const attempt = () => {
      if (!cancelled) void ensureSession(mapType);
    };
    attempt();
    const timer = setInterval(attempt, KEEPALIVE_INTERVAL_MS);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') attempt();
    });
    return () => {
      cancelled = true;
      clearInterval(timer);
      sub.remove();
    };
  }, [mapType]);
}

export function GoogleTileLayer({ mapType }: { mapType: TileMapType }) {
  useSessionKeepalive(mapType);
  const session = useMapTilesStore((s) => s.sessions[mapType]);

  if (!isTileSessionValid(session)) return null;

  return (
    <UrlTile
      urlTemplate={tileUrlTemplate(session)}
      maximumZ={GOOGLE_TILES_MAX_ZOOM}
      tileSize={GOOGLE_TILES_TILE_SIZE}
      zIndex={-1}
      opacity={1}
    />
  );
}

export type GoogleTileAttributionProps = {
  mapType: TileMapType;
  /** Current viewport (last onRegionChangeComplete, seeded from the initial region). */
  region: MapRegion | null;
  /** Map width in pt — used only to estimate the zoom for the copyright query. */
  viewportWidth: number;
  /** Corner offsets, so a host screen with its own bottom chrome can lift the chip. */
  inset?: { bottom?: number; left?: number };
};

export function GoogleTileAttribution({
  mapType,
  region,
  viewportWidth,
  inset,
}: GoogleTileAttributionProps) {
  const session = useMapTilesStore((s) => s.sessions[mapType]);
  const sessionToken = isTileSessionValid(session) ? session.session : null;
  const live = sessionToken != null;

  const [copyright, setCopyright] = useState<string | null>(null);
  // Skip a re-query when the viewport hasn't materially moved (sub-metre
  // deltas from a rubber-band settle).
  const lastKeyRef = useRef<string | null>(null);

  useEffect(() => {
    if (!sessionToken || !region) return;
    const viewport = viewportForRegion(region, viewportWidth);
    const key = [
      sessionToken,
      viewport.zoom,
      viewport.north.toFixed(3),
      viewport.south.toFixed(3),
      viewport.east.toFixed(3),
      viewport.west.toFixed(3),
    ].join('|');
    if (lastKeyRef.current === key) return;

    let cancelled = false;
    const timer = setTimeout(() => {
      lastKeyRef.current = key;
      fetchViewportAttribution(mapType, viewport).then((text) => {
        if (cancelled) return;
        // A failed attribution query keeps the last real string (or the bare
        // mark) rather than blanking — never an empty credit over imagery.
        if (text) setCopyright(text);
      });
    }, ATTRIBUTION_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [sessionToken, mapType, region, viewportWidth]);

  if (!live) return null;

  return (
    <View
      pointerEvents="none"
      accessibilityRole="text"
      accessibilityLabel={`Map imagery by Google. ${copyright ?? ''}`}
      style={[
        styles.chip,
        { bottom: inset?.bottom ?? spacing.sm, left: inset?.left ?? spacing.sm },
      ]}
    >
      <Text style={styles.mark}>Google</Text>
      {copyright ? (
        <Text style={styles.copyright} numberOfLines={1}>
          {copyright}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Frost over imagery: the credit has to read on satellite and on a pale
  // roadmap alike (Drift #1 sun-readability applies to legal text too).
  chip: {
    position: 'absolute',
    maxWidth: '78%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.sm,
    backgroundColor: glass.frostFill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: glass.frostBorder,
  },
  mark: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: 0.2,
  },
  copyright: {
    flexShrink: 1,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
  },
});
