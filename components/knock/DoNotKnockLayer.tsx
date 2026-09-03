// Do-not-knock overlay for Knock mode's map: zones as a muted danger fill
// (a drawn polygon, or a circle for a centre + radius) and homes as danger
// pins. Reads the store directly, so the integrator mounts it as one child
// of `<Map>` and never threads entries through. `useDoNotKnockCount` is the
// badge for the layers sheet row.

import { MapCircle, MapPin, MapPolygon } from '@/components/map/Map';
import { useDoNotKnockStore } from '@/lib/stores/doNotKnockStore';
import { colors } from '@/theme/tokens';

const ZONE_STROKE_WIDTH = 1.5;

export function DoNotKnockLayer({ homes = true }: { homes?: boolean }) {
  const entries = useDoNotKnockStore((s) => s.entries);
  return (
    <>
      {entries.map((e) => {
        if (e.kind === 'zone') {
          if (e.polygon && e.polygon.length >= 3) {
            return (
              <MapPolygon
                key={e.id}
                coordinates={e.polygon.map((p) => ({ latitude: p.lat, longitude: p.lng }))}
                fillColor={colors.stormSevereFill}
                strokeColor={colors.danger}
                strokeWidth={ZONE_STROKE_WIDTH}
              />
            );
          }
          if (e.lat != null && e.lng != null && (e.radiusMeters ?? 0) > 0) {
            return (
              <MapCircle
                key={e.id}
                center={{ latitude: e.lat, longitude: e.lng }}
                radius={e.radiusMeters as number}
                fillColor={colors.stormSevereFill}
                strokeColor={colors.danger}
                strokeWidth={ZONE_STROKE_WIDTH}
              />
            );
          }
          return null;
        }
        if (!homes || e.lat == null || e.lng == null) return null;
        return (
          <MapPin
            key={e.id}
            coordinate={{ latitude: e.lat, longitude: e.lng }}
            tone="danger"
            title={e.label}
            description="Do not knock"
          />
        );
      })}
    </>
  );
}

/** Entries on the list — the layers-sheet badge. */
export function useDoNotKnockCount(): number {
  return useDoNotKnockStore((s) => s.entries.length);
}
