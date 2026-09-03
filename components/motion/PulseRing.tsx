import { useEffect } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

type Props = {
  /** Diameter of the dot at rest. The halo expands ~2.4× beyond it. */
  size?: number;
  /** Pass a theme token color — never a raw hex. */
  color: string;
  style?: StyleProp<ViewStyle>;
};

/**
 * A small dot with an endlessly expanding halo — the "live" indicator.
 * Used on the Storm Alert hero chip and the active door-knocking route
 * stat. Mount it only when the thing it announces is genuinely live.
 */
export function PulseRing({ size = 10, color, style }: Props) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: motion.pulseMs, easing: Easing.out(Easing.quad) }),
      -1,
      false,
    );
  }, [t]);

  const halo = useAnimatedStyle(() => ({
    transform: [{ scale: 1 + t.value * 1.4 }],
    opacity: 0.55 * (1 - t.value),
  }));

  return (
    <View
      style={[
        { width: size, height: size, alignItems: 'center', justifyContent: 'center' },
        style,
      ]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          { borderRadius: size / 2, backgroundColor: color },
          halo,
        ]}
      />
      <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color }} />
    </View>
  );
}
