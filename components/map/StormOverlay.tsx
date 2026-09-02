// Storm overlay for any RoofWise map — renders as CHILDREN of <Map>, so it
// returns only map primitives (MapCircle / MapPin) and nothing else.
//
// Why it exists (owner's device, Expo Go 54, Apple Maps under Fabric): the
// Map tab used to mount one MapCircle AND one Marker per storm event — ~900
// native overlays for Dallas / 50 mi / 3 yr. This component never hands
// native more than the caps in lib/services/stormCluster.ts, per zoom band:
//
//   far  → grid-clustered glyphs (count + strongest magnitude), ≤ 64
//   mid  → individual pins only, ≤ MAX_STORM_MARKERS
//   near → pins + hail hit-circles INSIDE the visible region,
//          ≤ MAX_STORM_MARKERS / ≤ MAX_STORM_CIRCLES
//
// Every coordinate/radius passes the one guard in stormCluster.ts before it
// gets here (`useStormOverlaySelection` sanitises); Map.tsx's MapPin/MapCircle
// re-check at the door. Keys are event ids (re-keyed when IEM collides), never
// indexes. Custom-view markers carry `tracksViewChanges={false}` and re-key
// on content change so a stale snapshot can never show a wrong count.
//
// Colours are theme tokens by tone (Drift #11) — the raw per-magnitude hex of
// `lib/noaa.severityColor` is not used here.

import { memo, useEffect, useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { MapCircle, MapPin, type Region } from '@/components/map/Map';
import type { StormOverlayProps } from '@/components/map/types';
import { magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { recordError } from '@/lib/services/diagnostics';
import {
  clusterMagnitudeLabel,
  sanitizeStormEvents,
  selectStormOverlay,
  stormCircleRadiusMeters,
  stormTone,
  zoomBandForRegion,
  type StormClusterCell,
  type StormOverlaySelection,
  type StormTone,
} from '@/lib/services/stormCluster';
import { colors, fontSize, fontWeight, shadows, spacing, touchTarget } from '@/theme/tokens';

const TONE_STROKE: Record<StormTone, string> = {
  hail: colors.stormHail,
  wind: colors.stormWind,
  severe: colors.stormSevere,
};

/** Circles are hail-only (stormCluster), so only the two hail fills exist. */
const TONE_FILL: Record<'hail' | 'severe', string> = {
  hail: colors.stormHailFill,
  severe: colors.stormSevereFill,
};

const EMPTY: StormOverlaySelection = {
  band: 'far',
  clusters: [],
  markers: [],
  circles: [],
  totalEvents: 0,
  inRegion: 0,
  capped: false,
};

/**
 * Sanitise + select for the current viewport. `enabled=false` (safety mode /
 * overlays toggled off) yields an empty selection that still carries the
 * honest `totalEvents`, so the count line can say "N storm events · overlays
 * off" without drawing a thing.
 */
export function useStormOverlaySelection(
  events: readonly StormEvent[],
  region: Region | null,
  enabled: boolean,
): StormOverlaySelection {
  const sanitized = useMemo(() => sanitizeStormEvents(events), [events]);

  useEffect(() => {
    if (sanitized.dropped > 0) {
      // Counted in Diagnostics as a non-fatal note — a bad coordinate never
      // reaches native, but the owner can see that the feed had one.
      recordError(
        `[map] dropped ${sanitized.dropped} storm event${sanitized.dropped === 1 ? '' : 's'} with an invalid coordinate before native`,
        { kind: 'console_error' },
      );
    }
  }, [sanitized]);

  return useMemo(() => {
    if (!enabled) {
      return { ...EMPTY, band: zoomBandForRegion(region), totalEvents: sanitized.events.length };
    }
    return selectStormOverlay(sanitized.events, region);
  }, [sanitized, region, enabled]);
}

function eventA11yLabel(e: StormEvent): string {
  const kind = e.type === 'hail' ? 'Hail' : 'Wind';
  const when = new Date(e.occurredAt).toLocaleDateString();
  return `${kind} ${magnitudeLabel(e)}, ${when}${e.city ? `, ${e.city}` : ''}`;
}

function clusterA11yLabel(c: StormClusterCell): string {
  const mag = clusterMagnitudeLabel(c);
  return `${c.count} storm report${c.count === 1 ? '' : 's'}${mag ? `, strongest ${mag}` : ''}. Zooms in.`;
}

const ClusterGlyph = memo(function ClusterGlyph({
  cell,
  onPress,
}: {
  cell: StormClusterCell;
  onPress?: (cell: StormClusterCell) => void;
}) {
  const label = clusterMagnitudeLabel(cell);
  return (
    <MapPin
      coordinate={{ latitude: cell.lat, longitude: cell.lon }}
      tracksViewChanges={false}
      onPress={onPress ? () => onPress(cell) : undefined}
      accessibilityLabel={clusterA11yLabel(cell)}
    >
      <View style={styles.glyphShadow}>
        <View style={[styles.glyph, { backgroundColor: TONE_STROKE[cell.tone] }]}>
          <Text style={styles.glyphCount}>{cell.count}</Text>
          {label ? (
            <Text style={styles.glyphMag} numberOfLines={1}>
              {label}
            </Text>
          ) : null}
        </View>
      </View>
    </MapPin>
  );
});

export const StormOverlay = memo(function StormOverlay({
  selection,
  onSelectEvent,
  onSelectCluster,
}: StormOverlayProps) {
  return (
    <>
      {selection.circles.map((e) => {
        const tone = stormTone(e);
        const fill = tone === 'severe' ? TONE_FILL.severe : TONE_FILL.hail;
        return (
          <MapCircle
            key={`c:${e.id}`}
            center={{ latitude: e.lat, longitude: e.lon }}
            radius={stormCircleRadiusMeters(e)}
            strokeColor={TONE_STROKE[tone]}
            strokeWidth={1}
            fillColor={fill}
          />
        );
      })}
      {selection.markers.map((e) => (
        <MapPin
          key={e.id}
          coordinate={{ latitude: e.lat, longitude: e.lon }}
          pinColor={TONE_STROKE[stormTone(e)]}
          onPress={onSelectEvent ? () => onSelectEvent(e) : undefined}
          accessibilityLabel={eventA11yLabel(e)}
        />
      ))}
      {selection.clusters.map((c) => (
        // Re-key on count so a changed glyph re-snapshots (tracksViewChanges is off).
        <ClusterGlyph key={`${c.id}:${c.count}`} cell={c} onPress={onSelectCluster} />
      ))}
    </>
  );
});

const styles = StyleSheet.create({
  // Shadow on a wrapper so the rounded glyph can clip its own corners.
  glyphShadow: { ...shadows.float },
  glyph: {
    minWidth: touchTarget.small,
    height: touchTarget.small,
    paddingHorizontal: spacing.sm,
    borderRadius: touchTarget.small / 2,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: colors.surface,
  },
  glyphCount: {
    color: colors.textInverse,
    fontSize: fontSize.bodySm,
    fontWeight: fontWeight.bold,
    fontVariant: ['tabular-nums'],
  },
  glyphMag: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    marginTop: -2,
  },
});
