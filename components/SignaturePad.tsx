import { useState, useRef } from 'react';
import {
  View,
  Pressable,
  StyleSheet,
  Text,
  PanResponder,
  type GestureResponderEvent,
} from 'react-native';
import Svg, { Path } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Props = {
  width?: number;
  height?: number;
  onChange?: (svgPath: string) => void;
};

/**
 * Lightweight signature pad backed by react-native-svg + PanResponder.
 * Emits an SVG path string ("M x y L x y L x y …") that can be embedded
 * directly in HTML or rendered back via <Path d={…} />.
 */
export function SignaturePad({ width = 320, height = 200, onChange }: Props) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const current = useRef<string>('');

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        current.current = `M${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        current.current = `${current.current} L${e.nativeEvent.locationX.toFixed(1)},${e.nativeEvent.locationY.toFixed(1)}`;
        setStrokes((prev) => {
          const next = [...prev];
          next[next.length - 1] = current.current;
          return next;
        });
      },
      onPanResponderStart: () => {
        setStrokes((prev) => [...prev, current.current]);
      },
      onPanResponderRelease: () => {
        const joined = [...strokes, current.current].join(' ');
        onChange?.(joined);
        current.current = '';
      },
    }),
  ).current;

  const clear = () => {
    setStrokes([]);
    current.current = '';
    onChange?.('');
  };

  return (
    <View style={styles.wrap}>
      <View
        {...responder.panHandlers}
        style={[styles.pad, { width, height }]}
      >
        <Svg width={width} height={height}>
          {strokes.map((d, i) => (
            <Path
              key={i}
              d={d}
              stroke={colors.navy}
              strokeWidth={3}
              fill="none"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}
        </Svg>
        {strokes.length === 0 && (
          <View style={styles.placeholder}>
            <Ionicons name="finger-print-outline" size={24} color={colors.slate} />
            <Text style={styles.placeholderText}>Sign here</Text>
          </View>
        )}
      </View>
      <Pressable style={styles.clearBtn} onPress={clear}>
        <Text style={styles.clearText}>Clear</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm, alignItems: 'center' },
  pad: {
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  placeholderText: { color: colors.slate, fontSize: fontSize.bodySm },
  clearBtn: {
    height: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
});
