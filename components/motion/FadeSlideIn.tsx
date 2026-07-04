import type { PropsWithChildren } from 'react';
import type { StyleProp, ViewStyle } from 'react-native';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { motion } from '@/theme/tokens';

type Props = PropsWithChildren<{
  /** Stagger position — delay is index × motion.staggerDelayMs. */
  index?: number;
  style?: StyleProp<ViewStyle>;
}>;

/**
 * Standard entrance for screen sections: fade + slide up, staggered by
 * index. One component so every screen enters with the same rhythm.
 */
export function FadeSlideIn({ index = 0, style, children }: Props) {
  return (
    <Animated.View
      entering={FadeInDown.duration(motion.enterMs).delay(index * motion.staggerDelayMs)}
      style={style}
    >
      {children}
    </Animated.View>
  );
}
