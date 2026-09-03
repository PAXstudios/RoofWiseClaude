// A photo with its drawing on it — the one component every surface should
// use to show an inspection photo, so an arrow drawn on the roof shows on
// the job page tile, in the review strip, on the photo report, everywhere.
//
// An expo-image <Image> with the SVG annotation layer scaled to the rendered
// size (`onLayout`), a small pencil badge with the count, and an optional
// press. `zoomable` adds pinch + two-finger pan for the read-only photo
// report; the overlay lives inside the transformed view so it follows the
// zoom. Drawing never happens here — that is app/annotate.tsx.

import { useEffect, useState, type ReactNode } from 'react';
import {
  Image as RNImage,
  Pressable,
  StyleSheet,
  Text,
  View,
  type LayoutChangeEvent,
  type StyleProp,
  type ViewStyle,
} from 'react-native';
import { Image } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import type { DamageMarker } from '@/lib/models/types';
import { describeAnnotations, fitRect } from '@/lib/services/annotationSvg';
import { reportWorkletError } from '@/lib/services/uiRuntimeGuard';
import { useAnnotationStore, useAnnotationsFor } from '@/lib/stores/annotationStore';
import { colors, fontSize, fontWeight, motion, radii, spacing } from '@/theme/tokens';
import { AnnotationLayer } from './AnnotationLayer';

const MIN_SCALE = 1;
const MAX_SCALE = 4;

type Props = {
  uri: string;
  /** The container — size it here (a tile, a card); the photo fills it. */
  style?: StyleProp<ViewStyle>;
  /** How the photo fills the container. Default `cover` (tiles); `contain` for a full view. */
  contentFit?: 'cover' | 'contain';
  /** Existing damage markers to draw underneath the annotations. */
  markers?: readonly DamageMarker[];
  /** The pencil badge with the count. Default true. */
  badge?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  /** Pinch to zoom, two fingers to pan (the photo report). Default false. */
  zoomable?: boolean;
  /** expo-image cross-fade, ms. */
  transition?: number;
  accessibilityLabel?: string;
  /** Anything to float over the photo (a tag, a state pill) — under the badge. */
  children?: ReactNode;
};

export function AnnotatedPhoto({
  uri,
  style,
  contentFit = 'cover',
  markers,
  badge = true,
  onPress,
  onLongPress,
  zoomable = false,
  transition = 150,
  accessibilityLabel,
  children,
}: Props) {
  const items = useAnnotationsFor(uri);
  const record = useAnnotationStore((s) => s.byUri[uri]);
  const [box, setBox] = useState({ width: 0, height: 0 });
  const [img, setImg] = useState<{ width: number; height: number }>(() =>
    record && record.imageW > 0 && record.imageH > 0 ? { width: record.imageW, height: record.imageH } : { width: 0, height: 0 },
  );

  // The overlay only needs the image's aspect, and only when there is
  // something to draw — an un-annotated tile never pays for getSize.
  const needsSize = items.length > 0 || (markers?.length ?? 0) > 0;
  useEffect(() => {
    if (!needsSize) return;
    if (record && record.imageW > 0 && record.imageH > 0) {
      setImg({ width: record.imageW, height: record.imageH });
      return;
    }
    let live = true;
    RNImage.getSize(
      uri,
      (w, h) => { if (live) setImg({ width: w, height: h }); },
      () => { if (live) setImg({ width: 0, height: 0 }); },
    );
    return () => { live = false; };
  }, [uri, needsSize, record]);

  const onLayout = (e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setBox({ width, height });
  };

  // ── Zoom (opt-in) ───────────────────────────────────────────────────────
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const startScale = useSharedValue(1);
  const startTx = useSharedValue(0);
  const startTy = useSharedValue(0);
  const boxW = useSharedValue(0);
  const boxH = useSharedValue(0);
  boxW.value = box.width;
  boxH.value = box.height;

  const pinch = Gesture.Pinch()
    .enabled(zoomable)
    .onStart(() => {
      'worklet';
      startScale.value = scale.value;
    })
    .onUpdate((e) => {
      'worklet';
      try {
        const next = Math.max(MIN_SCALE, Math.min(MAX_SCALE, startScale.value * e.scale));
        scale.value = next;
        const ox = (boxW.value * (next - 1)) / 2;
        const oy = (boxH.value * (next - 1)) / 2;
        tx.value = Math.max(-ox, Math.min(ox, tx.value));
        ty.value = Math.max(-oy, Math.min(oy, ty.value));
      } catch (error) {
        reportWorkletError(error, 'photo.AnnotatedPhoto.pinch');
      }
    })
    .onEnd(() => {
      'worklet';
      if (scale.value < MIN_SCALE + 0.01) {
        scale.value = withSpring(1, motion.snappy);
        tx.value = withSpring(0, motion.snappy);
        ty.value = withSpring(0, motion.snappy);
      }
    });

  const pan = Gesture.Pan()
    .enabled(zoomable)
    .minPointers(2)
    .maxPointers(2)
    .onStart(() => {
      'worklet';
      startTx.value = tx.value;
      startTy.value = ty.value;
    })
    .onUpdate((e) => {
      'worklet';
      try {
        const s = scale.value;
        const ox = (boxW.value * (s - 1)) / 2;
        const oy = (boxH.value * (s - 1)) / 2;
        tx.value = Math.max(-ox, Math.min(ox, startTx.value + e.translationX));
        ty.value = Math.max(-oy, Math.min(oy, startTy.value + e.translationY));
      } catch (error) {
        reportWorkletError(error, 'photo.AnnotatedPhoto.pan');
      }
    });

  const tap = Gesture.Tap()
    .enabled(zoomable && !!onPress)
    .maxDuration(300)
    .runOnJS(true)
    .onEnd((_e, success) => {
      if (success) onPress?.();
    });

  const longPress = Gesture.LongPress()
    .enabled(zoomable && !!onLongPress)
    .runOnJS(true)
    .onStart(() => onLongPress?.());

  const zoomGesture = Gesture.Race(Gesture.Simultaneous(pinch, pan), longPress, tap);

  const zoomStyle = useAnimatedStyle(() => {
    try {
      const s = scale.value;
      const x = tx.value;
      const y = ty.value;
      const ok = (v: number) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
      return { transform: [{ translateX: ok(x) }, { translateY: ok(y) }, { scale: ok(s) || 1 }] };
    } catch (error) {
      reportWorkletError(error, 'photo.AnnotatedPhoto.zoomStyle');
      return { transform: [{ translateX: 0 }, { translateY: 0 }, { scale: 1 }] };
    }
  });

  const rect = fitRect(img.width, img.height, box.width, box.height, contentFit);
  const canDraw = box.width > 0 && box.height > 0 && img.width > 0 && img.height > 0;
  const n = items.length;
  const a11y =
    accessibilityLabel ?? (n > 0 ? `Photo with ${describeAnnotations(items).toLowerCase()}` : 'Photo');

  const body = (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, zoomable && zoomStyle]}>
        <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit={contentFit} transition={transition} />
        {canDraw && (n > 0 || (markers?.length ?? 0) > 0) && (
          <AnnotationLayer width={box.width} height={box.height} rect={rect} items={items} markers={markers} />
        )}
      </Animated.View>
      {children}
      {badge && n > 0 && (
        <View style={styles.badge} pointerEvents="none" accessibilityElementsHidden importantForAccessibility="no">
          <Ionicons name="brush" size={11} color={colors.textInverse} />
          <Text style={styles.badgeText}>{n}</Text>
        </View>
      )}
    </>
  );

  if (zoomable) {
    return (
      <GestureDetector gesture={zoomGesture}>
        <View style={[styles.wrap, style]} onLayout={onLayout} accessibilityLabel={a11y} accessible>
          {body}
        </View>
      </GestureDetector>
    );
  }

  if (onPress || onLongPress) {
    return (
      <Pressable
        style={({ pressed }) => [styles.wrap, style, pressed && styles.pressed]}
        onLayout={onLayout}
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole={onPress ? 'button' : 'image'}
        accessibilityLabel={a11y}
      >
        {body}
      </Pressable>
    );
  }

  return (
    <View style={[styles.wrap, style]} onLayout={onLayout} accessibilityLabel={a11y} accessibilityRole="image">
      {body}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { overflow: 'hidden', backgroundColor: colors.surfaceMuted },
  pressed: { opacity: 0.85 },
  // Bottom-right, on the dark scrim the camera chrome uses — readable on any
  // roof. Not a target: the whole photo is the tap.
  badge: {
    position: 'absolute',
    right: spacing.xs,
    bottom: spacing.xs,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.pill,
    backgroundColor: colors.scrim,
  },
  badgeText: { color: colors.textInverse, fontSize: fontSize.caption, fontWeight: fontWeight.bold },
});
