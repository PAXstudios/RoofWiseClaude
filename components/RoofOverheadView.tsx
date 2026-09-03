// The property from above, with the roof drawn on.
//
// Owner: "show an overhead of the home from Google Maps with an overlay color
// over the roof." Satellite imagery under one coloured rectangle per roof
// plane, from the same aerial measurement the squares come from — so what the
// roofer sees IS what was measured, not an illustration. Non-interactive: it
// is a picture of the measurement, not a map to wander.
//
// The planes are the imagery's own per-face rectangles (Solar
// `roofSegmentStats[].boundingBox`). They are axis-aligned boxes, not traced
// outlines — honest enough to show which faces were counted and how big; the
// traced outline is a follow-up (BACKLOG: Solar dataLayers mask).
//
// Native only: the Map abstraction's web build renders its fallback panel, so
// the legend beneath carries the numbers everywhere.

import { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Map, MapPolygon, type Region } from '@/components/map/Map';
import { regionForBounds, unionBounds } from '@/lib/services/roofOverhead';
import type { PropertyIntelSlope, SlopeOrientation } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

type Bounds = { sw: { lat: number; lng: number }; ne: { lat: number; lng: number } };

type Props = {
  planes: PropertyIntelSlope[];
  /** Building footprint; frames the view. Falls back to the union of planes. */
  bounds?: Bounds;
  center?: { lat: number; lng: number };
  height?: number;
  /** Show the per-plane legend under the imagery. Default true. */
  legend?: boolean;
};

/** One hue per compass direction, from the theme's storm/brand set (Drift #11). */
const PLANE_HUE: Record<SlopeOrientation, string> = {
  N: colors.info,
  NE: colors.info,
  E: colors.accent,
  SE: colors.accent,
  S: colors.warn,
  SW: colors.warn,
  W: colors.success,
  NW: colors.success,
  Flat: colors.textSubtle,
  Unknown: colors.textSubtle,
};

function withAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

export function RoofOverheadView({ planes, bounds, center, height = 260, legend = true }: Props) {
  const frame = useMemo(() => bounds ?? unionBounds(planes), [bounds, planes]);
  const region = useMemo<Region | null>(() => {
    if (frame) return regionForBounds(frame);
    if (center) return { latitude: center.lat, longitude: center.lng, latitudeDelta: 0.0012, longitudeDelta: 0.0012 };
    return null;
  }, [frame, center]);

  const drawable = planes.filter((p) => p.bounds);

  return (
    <View style={styles.wrap}>
      <View style={[styles.mapWrap, { height }]}>
        {region ? (
          <Map
            initialRegion={region}
            mapType="satellite"
            showsUserLocation={false}
            showsCompass={false}
            style={styles.map}
          >
            {drawable.map((p, i) => (
              <MapPolygon
                key={`${p.orientation}-${i}`}
                coordinates={[
                  { latitude: p.bounds!.sw.lat, longitude: p.bounds!.sw.lng },
                  { latitude: p.bounds!.sw.lat, longitude: p.bounds!.ne.lng },
                  { latitude: p.bounds!.ne.lat, longitude: p.bounds!.ne.lng },
                  { latitude: p.bounds!.ne.lat, longitude: p.bounds!.sw.lng },
                ]}
                fillColor={withAlpha(PLANE_HUE[p.orientation], 0.35)}
                strokeColor={PLANE_HUE[p.orientation]}
                strokeWidth={2}
              />
            ))}
          </Map>
        ) : (
          <View style={styles.noFrame}>
            <Text style={styles.noFrameText}>No imagery frame for this measurement.</Text>
          </View>
        )}
        <View style={styles.badge} pointerEvents="none">
          <Text style={styles.badgeText}>Aerial · {drawable.length} roof face{drawable.length === 1 ? '' : 's'} drawn</Text>
        </View>
      </View>

      {legend && planes.length > 0 && (
        <View style={styles.legend}>
          {planes
            .slice()
            .sort((a, b) => b.squares - a.squares)
            .map((p, i) => (
              <View key={`${p.orientation}-${i}`} style={styles.legendRow}>
                <View style={[styles.swatch, { backgroundColor: PLANE_HUE[p.orientation] }]} />
                <Text style={styles.legendDir}>{p.orientation}</Text>
                <Text style={styles.legendSquares}>{p.squares.toFixed(1)} sq</Text>
                <Text style={styles.legendPitch}>{p.pitchRatio}</Text>
                {!p.bounds && <Text style={styles.legendNote}>no frame</Text>}
              </View>
            ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  mapWrap: {
    borderRadius: radii.card,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
  },
  map: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  noFrame: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg },
  noFrameText: { fontSize: fontSize.bodySm, color: colors.textMuted, textAlign: 'center' },
  badge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  badgeText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },
  legend: { gap: spacing.xs },
  legendRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  legendDir: { width: 40, fontSize: fontSize.bodySm, fontWeight: fontWeight.bold, color: colors.text },
  legendSquares: { width: 64, fontSize: fontSize.bodySm, color: colors.text, fontVariant: ['tabular-nums'] },
  legendPitch: { flex: 1, fontSize: fontSize.bodySm, color: colors.textMuted },
  legendNote: { fontSize: fontSize.caption, color: colors.textSubtle },
});
