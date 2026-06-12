import { type ComponentProps } from 'react';
import { Pressable, type ViewStyle, type StyleProp } from 'react-native';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

type Props = ComponentProps<typeof Pressable> & {
  style?: StyleProp<ViewStyle>;
  /** Scale factor while pressed. Default 0.97. */
  pressedScale?: number;
};

/**
 * Pressable that compresses with a spring while pressed — the spec's
 * "anticipation + follow-through" press feedback. Drop-in replacement
 * for Pressable on cards and CTAs.
 */
export function PressableScale({
  style,
  pressedScale = 0.97,
  onPressIn,
  onPressOut,
  ...rest
}: Props) {
  const scale = useSharedValue(1);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
  }));

  return (
    <AnimatedPressable
      {...rest}
      style={[style, animatedStyle]}
      onPressIn={(e) => {
        scale.value = withSpring(pressedScale, motion.quick);
        onPressIn?.(e);
      }}
      onPressOut={(e) => {
        scale.value = withSpring(1, motion.bouncy);
        onPressOut?.(e);
      }}
    />
  );
}
