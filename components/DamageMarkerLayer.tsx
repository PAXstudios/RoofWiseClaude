import { useEffect, useRef, useState } from 'react';
import {
  View,
  Image,
  StyleSheet,
  Text,
  type LayoutChangeEvent,
} from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  runOnJS,
} from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { colors, fontSize, fontWeight, radii } from '@/theme/tokens';
import type { DamageMarker, Severity } from '@/lib/models/types';

type Props = {
  photoUri: string;
  markers: DamageMarker[];
  selectedMarkerId: string | null;
  /** Called with photo coordinates (0–1) when the user taps empty space. */
  onTapPhoto: (x: number, y: number) => void;
  onSelectMarker: (id: string) => void;
};

const SEVERITY_COLORS: Record<Severity, string> = {
  none: colors.slate,
  minor: colors.info,
  moderate: colors.warn,
  severe: colors.danger,
};

const MIN_SCALE = 1;
const MAX_SCALE = 4;

export function DamageMarkerLayer({
  photoUri,
  markers,
  selectedMarkerId,
  onTapPhoto,
  onSelectMarker,
}: Props) {
  const [imgSize, setImgSize] = useState({ width: 0, height: 0 });
  const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });

  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);

  // Photo's actual rendered rect inside the container (aspect-fit).
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
  const rectRef = useRef(rect);
  rectRef.current = rect;

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

  // Tap → if we hit a marker, select; else, convert screen coords → photo (0-1) coords.
  const handleTap = (tapScreenX: number, tapScreenY: number) => {
    const r = rectRef.current;
    if (r.width === 0 || r.height === 0) return;

    // Reverse the scale + translate transform to get pre-transform screen coords.
    const sx = (tapScreenX - translateX.value) / scale.value;
    const sy = (tapScreenY - translateY.value) / scale.value;

    // Convert pre-transform screen → photo (0..1) coords.
    const lx = sx - r.left;
    const ly = sy - r.top;
    if (lx < 0 || ly < 0 || lx > r.width || ly > r.height) return;

    // Hit-test markers first
    for (const m of markers) {
      const px = r.left + m.x * r.width;
      const py = r.top + m.y * r.height;
      const radius = Math.max(18, m.radius * Math.min(r.width, r.height));
      const dx = sx - px;
      const dy = sy - py;
      if (Math.sqrt(dx * dx + dy * dy) <= radius) {
        onSelectMarker(m.id);
        return;
      }
    }
    onTapPhoto(lx / r.width, ly / r.height);
  };

  // Clamp translate so the photo doesn't fly offscreen at any scale.
  const clampTranslate = (tx: number, ty: number, s: number) => {
    'worklet';
    const r = rectRef.current;
    if (!containerSize.width || !containerSize.height) return { tx, ty };
    const scaledW = containerSize.width * s;
    const scaledH = containerSize.height * s;
    const overflowX = Math.max(0, scaledW - containerSize.width) / 2;
    const overflowY = Math.max(0, scaledH - containerSize.height) / 2;
    return {
      tx: Math.max(-overflowX, Math.min(overflowX, tx)),
      ty: Math.max(-overflowY, Math.min(overflowY, ty)),
    };
  };

  const pinch = Gesture.Pinch()
    .onStart(() => {
      'worklet';
      startScale.value = scale.value;
      startTx.value = translateX.value;
      startTy.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale.value * e.scale));
      scale.value = next;
      const c = clampTranslate(startTx.value, startTy.value, next);
      translateX.value = c.tx;
      translateY.value = c.ty;
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < MIN_SCALE + 0.01) {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      }
    });

  const pan = Gesture.Pan()
    .minPointers(1)
    .maxPointers(2)
    .onStart(() => {
      'worklet';
      startTx.value = translateX.value;
      startTy.value = translateY.value;
    })
    .onUpdate((e) => {
      'worklet';
      if (scale.value <= 1.01) return; // No pan when not zoomed in
      const c = clampTranslate(
        startTx.value + e.translationX,
        startTy.value + e.translationY,
        scale.value,
      );
      translateX.value = c.tx;
      translateY.value = c.ty;
    });

  const tap = Gesture.Tap()
    .maxDuration(300)
    .onEnd((e) => {
      'worklet';
      runOnJS(handleTap)(e.x, e.y);
    });

  const doubleTap = Gesture.Tap()
    .numberOfTaps(2)
    .onEnd((e) => {
      'worklet';
      if (scale.value > 1.01) {
        scale.value = withSpring(1);
        translateX.value = withSpring(0);
        translateY.value = withSpring(0);
      } else {
        const cx = containerSize.width / 2;
        const cy = containerSize.height / 2;
        scale.value = withSpring(2);
        translateX.value = withSpring(cx - e.x);
        translateY.value = withSpring(cy - e.y);
      }
    });

  const composed = Gesture.Race(
    doubleTap,
    Gesture.Simultaneous(pinch, pan),
    tap,
  );

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <GestureDetector gesture={composed}>
      <View style={styles.wrap} onLayout={onContainerLayout}>
        <Animated.View style={[StyleSheet.absoluteFill, animatedStyle]}>
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
        </Animated.View>
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#000', overflow: 'hidden' },
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
