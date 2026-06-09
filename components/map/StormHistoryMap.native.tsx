import { useEffect, useRef } from 'react';
import MapView from 'react-native-maps';
import { Map, MapPin } from './Map';
import { severityColor, magnitudeLabel } from '@/lib/noaa';
import type { StormMapProps } from './types';

export default function StormHistoryMap({ events, center, zoom }: StormMapProps) {
  const ref = useRef<MapView>(null);

  useEffect(() => {
    const span = 360 / Math.pow(2, Math.max(2, zoom));
    ref.current?.animateToRegion(
      {
        latitude: center.lat,
        longitude: center.lon,
        latitudeDelta: span,
        longitudeDelta: span,
      },
      400,
    );
  }, [center.lat, center.lon, zoom]);

  return (
    <Map
      ref={ref}
      initialRegion={{
        latitude: center.lat,
        longitude: center.lon,
        latitudeDelta: 4,
        longitudeDelta: 4,
      }}
    >
      {events.map((e) => (
        <MapPin
          key={e.id}
          coordinate={{ latitude: e.lat, longitude: e.lon }}
          title={`${e.type === 'hail' ? 'Hail' : 'Wind'} · ${magnitudeLabel(e)}`}
          description={`${new Date(e.occurredAt).toLocaleDateString()} ${e.city ?? ''}`}
          pinColor={severityColor(e)}
        />
      ))}
    </Map>
  );
}
