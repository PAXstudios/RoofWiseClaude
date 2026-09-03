import { useRef, useState } from 'react';
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
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

/**
 * Ink length (points) below which a drawing is a smudge, not a signature. A
 * real signature on a 320×200 pad runs into the hundreds; one accidental
 * stroke with a gloved knuckle is a few dozen.
 */
export const SIGNATURE_MIN_PATH_LENGTH = 150;

export type SignatureMeta = {
  /** Drawn ink length ≥ `minPathLength` — the drawing could be a signature. */
  meaningful: boolean;
  /** Total drawn ink length in points, across every stroke. */
  pathLength: number;
};

type Props = {
  width?: number;
  height?: number;
  /**
   * Fires after every stroke (and with `''` on Clear). The pad only REPORTS —
   * it never decides that a drawing is a signature. Callers that record the
   * path on this callback must check `meta.meaningful`; callers that sign a
   * contract must use `onAccept` instead.
   */
  onChange?: (svgPath: string, meta: SignatureMeta) => void;
  /**
   * When provided, renders an 88pt "Accept & sign" primary under the pad,
   * enabled only once the drawing is meaningful. One accidental stroke can
   * therefore never sign anything — the signature is an explicit act.
   */
  onAccept?: (svgPath: string) => void;
  /** Label for the accept button. Default "Accept & sign". */
  acceptLabel?: string;
  /** Override the ink-length gate. Default `SIGNATURE_MIN_PATH_LENGTH`. */
  minPathLength?: number;
};

/**
 * Lightweight signature pad backed by react-native-svg + PanResponder.
 * Emits an SVG path string ("M x y L x y L x y …") that can be embedded
 * directly in HTML or rendered back via <Path d={…} />.
 *
 * Every stroke is kept in refs as well as state: the PanResponder is created
 * once, so a release handler that read `strokes` from render scope saw the
 * first render's empty array and emitted only the LAST stroke of a
 * multi-stroke signature.
 */
export function SignaturePad({
  width = 320,
  height = 200,
  onChange,
  onAccept,
  acceptLabel = 'Accept & sign',
  minPathLength = SIGNATURE_MIN_PATH_LENGTH,
}: Props) {
  const [strokes, setStrokes] = useState<string[]>([]);
  const [pathLength, setPathLength] = useState(0);
  const strokesRef = useRef<string[]>([]);
  const current = useRef<string>('');
  const lengthRef = useRef(0);
  const lastPoint = useRef<{ x: number; y: number } | null>(null);

  const meaningful = pathLength >= minPathLength;

  const publish = (strokeList: string[], length: number) => {
    const joined = strokeList.join(' ');
    onChange?.(joined, { meaningful: length >= minPathLength, pathLength: length });
  };

  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e: GestureResponderEvent) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        current.current = `M${x.toFixed(1)},${y.toFixed(1)}`;
        lastPoint.current = { x, y };
        // A stroke exists from its first touch so the live render shows it.
        strokesRef.current = [...strokesRef.current, current.current];
        setStrokes(strokesRef.current);
      },
      onPanResponderMove: (e: GestureResponderEvent) => {
        const { locationX: x, locationY: y } = e.nativeEvent;
        current.current = `${current.current} L${x.toFixed(1)},${y.toFixed(1)}`;
        const last = lastPoint.current;
        if (last) lengthRef.current += Math.hypot(x - last.x, y - last.y);
        lastPoint.current = { x, y };
        const next = [...strokesRef.current];
        next[next.length - 1] = current.current;
        strokesRef.current = next;
        setStrokes(next);
        setPathLength(lengthRef.current);
      },
      onPanResponderRelease: () => {
        current.current = '';
        lastPoint.current = null;
        publish(strokesRef.current, lengthRef.current);
      },
      onPanResponderTerminate: () => {
        current.current = '';
        lastPoint.current = null;
        publish(strokesRef.current, lengthRef.current);
      },
    }),
  ).current;

  const clear = () => {
    strokesRef.current = [];
    current.current = '';
    lengthRef.current = 0;
    lastPoint.current = null;
    setStrokes([]);
    setPathLength(0);
    onChange?.('', { meaningful: false, pathLength: 0 });
  };

  const accept = () => {
    if (!meaningful) return;
    onAccept?.(strokesRef.current.join(' '));
  };

  return (
    <View style={styles.wrap}>
      <View
        {...responder.panHandlers}
        style={[styles.pad, { width, height }]}
        accessibilityLabel="Signature pad"
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
          <View style={styles.placeholder} pointerEvents="none">
            <Ionicons name="finger-print-outline" size={24} color={colors.slate} />
            <Text style={styles.placeholderText}>Sign here</Text>
          </View>
        )}
      </View>

      {onAccept ? (
        // Explicit acceptance: Clear beside an 88pt primary that only wakes
        // up once there is a signature's worth of ink (Drift #1 — a contract
        // needs a deliberate press, never a mis-stroke).
        <View style={[styles.acceptRow, { width }]}>
          <Pressable
            style={styles.clearBtn}
            onPress={clear}
            accessibilityRole="button"
            accessibilityLabel="Clear signature"
          >
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
          <Pressable
            style={[styles.acceptBtn, !meaningful && styles.acceptBtnDisabled]}
            onPress={accept}
            disabled={!meaningful}
            accessibilityRole="button"
            accessibilityLabel={acceptLabel}
            accessibilityState={{ disabled: !meaningful }}
          >
            <Ionicons
              name="checkmark-circle-outline"
              size={22}
              color={meaningful ? colors.textInverse : colors.textMuted}
            />
            <Text style={[styles.acceptText, !meaningful && styles.acceptTextDisabled]}>
              {acceptLabel}
            </Text>
          </Pressable>
        </View>
      ) : (
        <Pressable
          style={styles.clearBtn}
          onPress={clear}
          accessibilityRole="button"
          accessibilityLabel="Clear signature"
        >
          <Text style={styles.clearText}>Clear</Text>
        </Pressable>
      )}
      {onAccept && strokes.length > 0 && !meaningful && (
        <Text style={styles.hint}>Keep going — that is not a full signature yet.</Text>
      )}
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
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  placeholderText: { color: colors.slate, fontSize: fontSize.bodySm },
  clearBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    alignItems: 'center',
    justifyContent: 'center',
  },
  clearText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  acceptRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  acceptBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    ...shadows.card,
  },
  // Neutral ink wash while disabled — a washed accent still reads as live
  // and white-on-it fails contrast in sun (see colors.fillDisabled).
  acceptBtnDisabled: { backgroundColor: colors.fillDisabled },
  acceptText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.bold },
  acceptTextDisabled: { color: colors.textMuted },
  hint: { color: colors.textMuted, fontSize: fontSize.bodySm, textAlign: 'center' },
});
