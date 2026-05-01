import { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
// react-leaflet is web-only and only imported via this .web.tsx shim, so Metro
// will skip it on iOS/Android.
import { MapContainer, TileLayer, CircleMarker, Tooltip, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { severityColor, magnitudeLabel } from '@/lib/noaa';
import type { StormMapProps } from './types';
import { colors, radii } from '@/theme/tokens';

function Recenter({ lat, lon, zoom }: { lat: number; lon: number; zoom: number }) {
  const map = useMap();
  useEffect(() => {
    map.flyTo([lat, lon], zoom, { duration: 0.6 });
  }, [lat, lon, zoom, map]);
  return null;
}

export default function StormHistoryMap({ events, center, zoom }: StormMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  return (
    <View style={styles.wrap}>
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }}>
        <MapContainer
          center={[center.lat, center.lon]}
          zoom={zoom}
          style={{ height: '100%', width: '100%' }}
          scrollWheelZoom
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; OpenStreetMap'
          />
          <Recenter lat={center.lat} lon={center.lon} zoom={zoom} />
          {events.map((e) => (
            <CircleMarker
              key={e.id}
              center={[e.lat, e.lon]}
              radius={e.type === 'hail' ? 5 + (e.magnitude ?? 0) * 2 : 5 + ((e.magnitude ?? 0) - 40) / 8}
              pathOptions={{
                color: severityColor(e),
                fillColor: severityColor(e),
                fillOpacity: 0.55,
                weight: 1,
              }}
            >
              <Tooltip>
                <strong>{e.type === 'hail' ? 'Hail' : 'Wind'}</strong>{' '}
                {magnitudeLabel(e)}
                <br />
                {new Date(e.occurredAt).toLocaleDateString()}
                {e.city ? ` · ${e.city}` : ''}
              </Tooltip>
            </CircleMarker>
          ))}
        </MapContainer>
      </div>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.lg,
    overflow: 'hidden',
    minHeight: 360,
  },
});
