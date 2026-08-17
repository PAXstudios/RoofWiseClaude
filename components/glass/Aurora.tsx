import { useEffect } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Circle, Defs, RadialGradient, Stop } from 'react-native-svg';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { brand, motion } from '@/theme/tokens';

type Orb = {
  color: string;
  /** Fractions of the shorter screen edge. */
  size: number;
  x: number;
  y: number;
  drift: { x: number; y: number };
  delayMs: number;
};

// Two brand orbs plus a deep-blue anchor. Kept few and large: the point is
// a slow wash of brand color behind glass, not a particle field.
const ORBS: Orb[] = [
  { color: brand.royal, size: 1.5, x: -0.25, y: -0.05, drift: { x: 26, y: 34 }, delayMs: 0 },
  { color: brand.burnt, size: 1.15, x: 0.55, y: 0.30, drift: { x: -30, y: -22 }, delayMs: 1400 },
  { color: brand.royalDeep, size: 1.3, x: 0.05, y: 0.62, drift: { x: 18, y: -28 }, delayMs: 2800 },
];

function AuroraOrb({ orb, base }: { orb: Orb; base: number }) {
  const t = useSharedValue(0);

  useEffect(() => {
    const id = setTimeout(() => {
      t.value = withRepeat(
        withTiming(1, { duration: motion.ambientMs, easing: Easing.inOut(Easing.sin) }),
        -1,
        true, // reverse, so the drift never snaps back
      );
    }, orb.delayMs);
    return () => clearTimeout(id);
  }, [t, orb.delayMs]);

  const style = useAnimatedStyle(() => ({
    transform: [
      { translateX: t.value * orb.drift.x },
      { translateY: t.value * orb.drift.y },
      { scale: 1 + t.value * 0.08 },
    ],
  }));

  const d = base * orb.size;
  const id = `orb-${orb.color.replace('#', '')}`;

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        { position: 'absolute', left: base * orb.x, top: base * orb.y, width: d, height: d },
        style,
      ]}
    >
      <Svg width={d} height={d}>
        <Defs>
          <RadialGradient id={id} cx="50%" cy="50%" r="50%">
            <Stop offset="0%" stopColor={orb.color} stopOpacity={0.55} />
            <Stop offset="55%" stopColor={orb.color} stopOpacity={0.16} />
            <Stop offset="100%" stopColor={orb.color} stopOpacity={0} />
          </RadialGradient>
        </Defs>
        <Circle cx={d / 2} cy={d / 2} r={d / 2} fill={`url(#${id})`} />
      </Svg>
    </Animated.View>
  );
}

/**
 * Slow-drifting brand-colored light behind the onboarding glass. Gives the
 * black background depth without ever competing with the foreground copy —
 * the orbs are low-opacity radial gradients, not shapes you'd read as objects.
 *
 * `transparent` drops the black ground so the orbs can be layered OVER a
 * gradient (e.g. `gradients.stormNight`) instead of replacing it — that's how
 * the in-app heroes quote the onboarding sky without losing the ramp under it.
 */
export function Aurora({ transparent = false }: { transparent?: boolean } = {}) {
  const { width, height } = useWindowDimensions();
  const base = Math.min(width, height);

  return (
    <View
      style={[StyleSheet.absoluteFill, styles.root, transparent && styles.transparent]}
      pointerEvents="none"
    >
      {ORBS.map((orb) => (
        <AuroraOrb key={orb.color} orb={orb} base={base} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { backgroundColor: brand.black, overflow: 'hidden' },
  transparent: { backgroundColor: 'transparent' },
});
