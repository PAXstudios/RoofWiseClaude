import { useState, useRef, useEffect } from 'react';
import {
  View,
  Image,
  Pressable,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
} from 'react-native';
import { colors, fontSize, fontWeight, radii } from '@/theme/tokens';
import type { DamageMarker, Severity } from '@/lib/models/types';

type Props = {
  photoUri: string;
  markers: DamageMarker[];
  selectedMarkerId: string | null;
  /** Called with the photo coordinates (0-1) when the user taps empty space. */
  onTapPhoto: (x: number, y: number) => void;
  onSelectMarker: (id: string) => void;
};

const SEVERITY_COLORS: Record<Severity, string> = {
  none: colors.slate,
  minor: colors.info,
  moderate: colors.warn,
  severe: colors.danger,
};

export function DamageMarkerLayer({
  photoUri,
  markers,
  selectedMarkerId,
  onTapPhoto,
  onSelectMarker,
}: Props) {
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
  const tapStartRef = useRef<{ x: number; y: number } | null>(null);

  // Compute the photo's actual rendered rect inside the container (aspect-fit).
  const rect = (() => {
    if (!imgSize.width || !imgSize.height || !containerSize.width || !containerSize.height) {
      return { left: 0, top: 0, width: containerSize.width, height: containerSize.height };
    }
    const imgAspect = imgSize.width / imgSize.height;
    const containerAspect = containerSize.width / containerSize.height;
    if (imgAspect > containerAspect) {
      const w = containerSize.width;
      const h = w / imgAspect;
      return { left: 0, top: (containerSize.height - h) / 2, width: w, height: h };
    } else {
      const h = containerSize.height;
      const w = h * imgAspect;
      return { left: (containerSize.width - w) / 2, top: 0, width: w, height: h };
    }
  })();

  useEffect(() => {
    Image.getSize(
      photoUri,
      (w, h) => setImgSize({ width: w, height: h }),
      () => setImgSize({ width: 1, height: 1 }),
    );
  }, [photoUri]);

  const onContainerLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setContainerSize({ width, height });
  };

  return (
    <View
      style={styles.wrap}
      onLayout={onContainerLayout}
      onTouchStart={(e) => {
        tapStartRef.current = {
          x: e.nativeEvent.locationX,
          y: e.nativeEvent.locationY,
        };
      }}
      onTouchEnd={(e) => {
        const start = tapStartRef.current;
        tapStartRef.current = null;
        if (!start) return;
        const dx = e.nativeEvent.locationX - start.x;
        const dy = e.nativeEvent.locationY - start.y;
        if (Math.sqrt(dx * dx + dy * dy) > 8) return; // it was a drag

        // Convert screen coords → photo (0-1) coords inside rect
        const lx = e.nativeEvent.locationX - rect.left;
        const ly = e.nativeEvent.locationY - rect.top;
        if (lx < 0 || ly < 0 || lx > rect.width || ly > rect.height) return;
        if (rect.width === 0 || rect.height === 0) return;

        // Tapped within photo bounds — check if we hit a marker first
        for (const m of markers) {
          const px = rect.left + m.x * rect.width;
          const py = rect.top + m.y * rect.height;
          const r = Math.max(18, m.radius * Math.min(rect.width, rect.height));
          const distance = Math.sqrt(
            Math.pow(e.nativeEvent.locationX - px, 2) +
              Math.pow(e.nativeEvent.locationY - py, 2),
          );
          if (distance <= r) {
            onSelectMarker(m.id);
            return;
          }
        }

        onTapPhoto(lx / rect.width, ly / rect.height);
      }}
    >
      <Image source={{ uri: photoUri }} style={styles.image} resizeMode="contain" />

      {markers.map((m) => {
        const px = rect.left + m.x * rect.width;
        const py = rect.top + m.y * rect.height;
        const size = Math.max(36, m.radius * Math.min(rect.width, rect.height) * 2);
        const tint = SEVERITY_COLORS[m.severity];
        const selected = m.id === selectedMarkerId;
        return (
          <View
            key={m.id}
            pointerEvents="none"
            style={[
              styles.marker,
              {
                left: px - size / 2,
                top: py - size / 2,
                width: size,
                height: size,
                borderRadius: size / 2,
                borderColor: tint,
                backgroundColor: `${tint}33`,
              },
              selected && styles.markerSelected,
            ]}
          >
            <View style={[styles.confidenceBubble, { backgroundColor: tint }]}>
              <Text style={styles.confidenceText}>{m.confidence}</Text>
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000' },
  image: { ...StyleSheet.absoluteFillObject, width: '100%', height: '100%' },
  marker: {
    position: 'absolute',
    borderWidth: 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  markerSelected: { borderWidth: 4 },
  confidenceBubble: {
    position: 'absolute',
    top: -10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: radii.pill,
  },
  confidenceText: {
    color: colors.textInverse,
    fontSize: fontSize.caption,
    fontWeight: fontWeight.bold,
  },
});
