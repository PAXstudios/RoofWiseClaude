import { useEffect } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from 'react-native-reanimated';
import { colors, motion, radii } from '@/theme/tokens';

/**
 * Shimmering placeholder block for loading states. Size it with `style`
 * (width/height); it pulses between 45% and 80% opacity until unmounted.
 * Use instead of blank space so async tiles don't pop the layout.
 */
export function SkeletonBlock({ style }: { style?: StyleProp<ViewStyle> }) {
  const t = useSharedValue(0);

  useEffect(() => {
    t.value = withRepeat(
      withTiming(1, { duration: motion.shimmerMs, easing: Easing.inOut(Easing.quad) }),
      -1,
      true,
    );
  }, [t]);

  const anim = useAnimatedStyle(() => ({ opacity: 0.45 + t.value * 0.35 }));

  return (
    <Animated.View
      style={[{ backgroundColor: colors.border, borderRadius: radii.sm }, style, anim]}
    />
  );
}
