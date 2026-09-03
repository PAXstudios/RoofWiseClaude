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
import { Ionicons } from '@expo/vector-icons';
import { MapCircle, MapPin, MapPolygon, type Region } from '@/components/map/Map';
import type { StormOverlayProps } from '@/components/map/types';
import { magnitudeLabel, type StormEvent } from '@/lib/noaa';
import { recordError } from '@/lib/services/diagnostics';
import {
  clusterMagnitudeLabel,
  sanitizeStormEvents,
  selectStormOverlay,
  stormCircleRadiusMeters,
  stormTone,
  quantizeRegion,
  zoomBandForRegion,
  type StormClusterCell,
  type StormOverlaySelection,
  type StormTone,
} from '@/lib/services/stormCluster';
import {
  computeStormSwaths,
  scaledInfluenceRadiusKm,
  swathPointsFromEvents,
  type StormSwath,
  type SwathPeril,
} from '@/lib/services/stormSwath';
import { colors, fontSize, fontWeight, shadows, spacing, touchTarget } from '@/theme/tokens';

const TONE_STROKE: Record<StormTone, string> = {
  hail: colors.stormHail,
  wind: colors.stormWind,
  severe: colors.stormSevere,
};

// -----------------------------------------------------------------------------
// Impacted-area swaths (HailTrace-style) — filled contours UNDER the pins.
// -----------------------------------------------------------------------------

/** Peril hue for the swath fill/stroke, straight from the storm tokens
 *  (Drift #11) — blue for hail, orange for wind. */
const SWATH_HUE: Record<SwathPeril, string> = {
  hail: colors.stormHail,
  wind: colors.stormWind,
};

/**
 * Derive a translucent fill from a theme hex token — the hue is the token's,
 * only the alpha is set here, so no raw colour is introduced (Drift #11). The
 * band contours are NESTED (band-≥-t), so stacking these low-alpha fills builds
 * the intensity read a HailTrace map has, without needing a distinct colour per
 * band. Higher bands carry a touch more alpha so the core is unmistakable.
 */
function hexWithAlpha(hex: string, alpha: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const int = parseInt(m[1], 16);
  const r = (int >> 16) & 255;
  const g = (int >> 8) & 255;
  const b = int & 255;
  const a = Math.max(0, Math.min(1, alpha));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

/** Fill alpha per band index — modest so nested bands stack into a gradient. */
const SWATH_FILL_ALPHA = [0.13, 0.17, 0.22, 0.28];
const SWATH_STROKE_ALPHA = 0.55;

/**
 * Compute impacted-area swaths for the current data. Recomputed on the storm
 * data changing and on crossing a coarse zoom bucket (so the cell size can
 * adapt) — NOT on every pan. `enabled=false` (overlays off / wrong filter)
 * yields nothing. The heavy pure work lives in lib/services/stormSwath.ts.
 */
export function useStormSwaths(
  events: readonly StormEvent[],
  region: Region | null,
  enabled: boolean,
): StormSwath[] {
  const points = useMemo(() => swathPointsFromEvents(events), [events]);
  // Coarse zoom bucket: pan within a bucket reuses the memo; only a zoom that
  // crosses a threshold recomputes. Larger spans get larger cells so the
  // vertex cap is reached less often.
  const bucket = useMemo(() => {
    const span = region ? Math.max(region.longitudeDelta, region.latitudeDelta) : 2;
    if (!Number.isFinite(span)) return 1;
    if (span < 0.4) return 0;
    if (span < 1.2) return 1;
    return 2;
  }, [region]);
  return useMemo(() => {
    if (!enabled || points.length === 0) return [];
    // Cell size AND smoothing radius grow with the view. At the far bucket
    // (the 50-mile browse view) the radius is 2.5x so corroborating reports
    // merge into one graded area instead of each drawing its own cell — the
    // confetti the owner saw. Near, both come back down and detail returns.
    const cellSizeKm = bucket === 0 ? 1.2 : bucket === 1 ? 1.8 : 2.6;
    const radiusScale = bucket === 0 ? 1 : bucket === 1 ? 1.6 : 2.5;
    return computeStormSwaths(points, {
      cellSizeKm,
      influenceRadiusFor: scaledInfluenceRadiusKm(radiusScale),
    });
  }, [points, bucket, enabled]);
}

/**
 * How boldly to fill the swaths for a viewport: a 50-mile view needs the
 * areas to read as areas, a street view should let the imagery through.
 */
export function swathEmphasisForRegion(region: Region | null): number {
  const span = region ? Math.max(region.longitudeDelta, region.latitudeDelta) : 2;
  if (!Number.isFinite(span)) return 1.4;
  if (span < 0.4) return 1;
  if (span < 1.2) return 1.2;
  return 1.6;
}

/**
 * The filled contours. Rendered FIRST (under circles/pins) and as MapPolygons,
 * which are overlays MapKit/Google stack beneath marker annotations — so the
 * area shows through while every pin stays on top and tappable. Every ring goes
 * through Map.tsx's MapPolygon guard (invalid coords dropped before native).
 * Non-interactive: taps fall through to the pins above.
 */
export const StormSwathLayer = memo(function StormSwathLayer({
  swaths,
  emphasis = 1,
}: {
  swaths: StormSwath[];
  /** Fill-alpha multiplier (see `swathEmphasisForRegion`). */
  emphasis?: number;
}) {
  const k = Number.isFinite(emphasis) && emphasis > 0 ? emphasis : 1;
  return (
    <>
      {swaths.map((s) => {
        const hue = SWATH_HUE[s.peril];
        const fill = hexWithAlpha(
          hue,
          Math.min(0.6, SWATH_FILL_ALPHA[Math.min(s.bandIndex, SWATH_FILL_ALPHA.length - 1)] * k),
        );
        const stroke = hexWithAlpha(hue, Math.min(0.8, SWATH_STROKE_ALPHA * k));
        return s.rings.map((ring, ri) => (
          <MapPolygon
            key={`swath:${s.peril}:${s.bandIndex}:${ri}`}
            coordinates={ring.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
            fillColor={fill}
            strokeColor={stroke}
            strokeWidth={1}
          />
        ));
      })}
    </>
  );
});

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

  // Quantised: a pan inside a screen-quarter reuses the previous selection,
  // so native children do not churn mid-gesture (the crash on the owner's
  // device). Memo on the snapped key, not the raw region object.
  const snapped = useMemo(() => quantizeRegion(region), [region]);
  const snapKey = snapped
    ? `${snapped.latitude}:${snapped.longitude}:${snapped.latitudeDelta}:${snapped.longitudeDelta}`
    : 'none';
  return useMemo(() => {
    if (!enabled) {
      return { ...EMPTY, band: zoomBandForRegion(snapped), totalEvents: sanitized.events.length };
    }
    return selectStormOverlay(sanitized.events, snapped);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sanitized, snapKey, enabled]);
}

function eventA11yLabel(e: StormEvent, selected?: boolean): string {
  const kind = e.type === 'hail' ? 'Hail' : 'Wind';
  const when = new Date(e.occurredAt).toLocaleDateString();
  const base = `${kind} ${magnitudeLabel(e)}, ${when}${e.city ? `, ${e.city}` : ''}`;
  return selected ? `${base}. Selected.` : base;
}

function clusterA11yLabel(c: StormClusterCell, selected?: boolean): string {
  const mag = clusterMagnitudeLabel(c);
  const base = `${c.count} storm report${c.count === 1 ? '' : 's'}${mag ? `, strongest ${mag}` : ''}`;
  return selected ? `${base}. Selected.` : `${base}. Zooms in.`;
}

/**
 * One storm report's pin. Plain native `pinColor` marker in the common
 * (unselected) case — the cheap path every other pin already uses. Selected
 * (Select mode's multi-pick) swaps in a custom-view ring + checkmark, same
 * `tracksViewChanges={false}` snapshot-once discipline as `ClusterGlyph` —
 * it only re-snapshots because the key changes with the selected flag, never
 * per frame.
 */
const EventGlyph = memo(function EventGlyph({
  event,
  selected,
  onPress,
}: {
  event: StormEvent;
  selected: boolean;
  onPress?: (event: StormEvent) => void;
}) {
  const tone = stormTone(event);
  if (!selected) {
    return (
      <MapPin
        coordinate={{ latitude: event.lat, longitude: event.lon }}
        pinColor={TONE_STROKE[tone]}
        onPress={onPress ? () => onPress(event) : undefined}
        accessibilityLabel={eventA11yLabel(event)}
      />
    );
  }
  return (
    <MapPin
      coordinate={{ latitude: event.lat, longitude: event.lon }}
      tracksViewChanges={false}
      onPress={onPress ? () => onPress(event) : undefined}
      accessibilityLabel={eventA11yLabel(event, true)}
      accessibilityState={{ selected: true }}
    >
      <View style={styles.eventGlyphShadow}>
        <View style={[styles.eventGlyphRing, { borderColor: TONE_STROKE[tone] }]}>
          <View style={[styles.eventGlyphDot, { backgroundColor: TONE_STROKE[tone] }]}>
            <Ionicons name="checkmark" size={12} color={colors.textInverse} />
          </View>
        </View>
      </View>
    </MapPin>
  );
});

const ClusterGlyph = memo(function ClusterGlyph({
  cell,
  onPress,
  selected,
}: {
  cell: StormClusterCell;
  onPress?: (cell: StormClusterCell) => void;
  /** Every member event is in the Select-mode selection. */
  selected?: boolean;
}) {
  const label = clusterMagnitudeLabel(cell);
  return (
    <MapPin
      coordinate={{ latitude: cell.lat, longitude: cell.lon }}
      tracksViewChanges={false}
      onPress={onPress ? () => onPress(cell) : undefined}
      accessibilityLabel={clusterA11yLabel(cell, selected)}
      accessibilityState={selected ? { selected: true } : undefined}
    >
      <View style={styles.glyphShadow}>
        <View
          style={[
            styles.glyph,
            { backgroundColor: TONE_STROKE[cell.tone] },
            selected && styles.glyphSelected,
          ]}
        >
          {selected ? (
            <Ionicons name="checkmark" size={14} color={colors.textInverse} />
          ) : (
            <>
              <Text style={styles.glyphCount}>{cell.count}</Text>
              {label ? (
                <Text style={styles.glyphMag} numberOfLines={1}>
                  {label}
                </Text>
              ) : null}
            </>
          )}
        </View>
      </View>
    </MapPin>
  );
});

export const StormOverlay = memo(function StormOverlay({
  selection,
  swaths,
  swathEmphasis,
  onSelectEvent,
  onSelectCluster,
  selected,
}: StormOverlayProps & {
  swaths?: StormSwath[];
  /** Fill boldness for the swaths, from `swathEmphasisForRegion`. */
  swathEmphasis?: number;
}) {
  return (
    <>
      {/* Impacted-area contours FIRST so they sit under the circles and pins. */}
      {swaths && swaths.length > 0 ? <StormSwathLayer swaths={swaths} emphasis={swathEmphasis} /> : null}
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
      {selection.markers.map((e) => {
        const isSelected = selected?.has(e.id) ?? false;
        return (
          <EventGlyph
            key={isSelected ? `${e.id}:sel` : e.id}
            event={e}
            selected={isSelected}
            onPress={onSelectEvent}
          />
        );
      })}
      {selection.clusters.map((c) => {
        const allSelected =
          !!selected && c.eventIds.length > 0 && c.eventIds.every((id) => selected.has(id));
        return (
          // Re-key on count/selected so a changed glyph re-snapshots (tracksViewChanges is off).
          <ClusterGlyph
            key={`${c.id}:${c.count}:${allSelected}`}
            cell={c}
            onPress={onSelectCluster}
            selected={allSelected}
          />
        );
      })}
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
  // Select mode, every member selected: a touch bigger and a thicker ring so
  // a fully-picked cluster reads distinct from a plain count glyph.
  glyphSelected: { borderWidth: 3, transform: [{ scale: 1.15 }] },
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

  // A selected storm pin (Select mode): a white ring around the tone dot
  // with a checkmark — distinct from the plain pinColor teardrop at a
  // glance, and still centred on the report's coordinate.
  eventGlyphShadow: { ...shadows.float },
  eventGlyphRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 3,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  eventGlyphDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
