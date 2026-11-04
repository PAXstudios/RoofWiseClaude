import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';
import Animated, {
  Easing, useAnimatedProps, useAnimatedStyle, useReducedMotion, useSharedValue, withTiming,
} from 'react-native-reanimated';
import { RoofWiseBrand } from '@/components/ui/RoofWiseBrand';
import { colors, motion, spacing } from '@/theme/tokens';

const DrawnPath = Animated.createAnimatedComponent(Path);
const ROOF_LENGTH = 260;

// A short roof survey line hands off to the real app as it finishes mounting.
export function RooflineIntro() {
  const reduced = useReducedMotion();
  const progress = useSharedValue(0);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    if (reduced) return;
    const duration = motion.sceneEnterMs + motion.enterMs;
    progress.value = withTiming(1, { duration, easing: Easing.linear });
    const timeout = setTimeout(() => setVisible(false), duration);
    return () => clearTimeout(timeout);
  }, [progress, reduced]);

  const drawn = useAnimatedProps(() => ({
    strokeDashoffset: ROOF_LENGTH * (1 - Math.min(progress.value / 0.62, 1)),
  }));
  const fade = useAnimatedStyle(() => ({
    opacity: Math.min(1, (1 - progress.value) / 0.18),
  }));
  const wordmark = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (progress.value - 0.18) / 0.35)),
  }));
  if (reduced || !visible) return null;
  return (
    <Animated.View style={[StyleSheet.absoluteFill, styles.intro, fade]} accessibilityLabel="Opening RoofWise" accessibilityViewIsModal>
      <View accessible={false}>
        <Svg width={180} height={70} viewBox="0 0 180 70">
          <Path d="M8 59L63 13L94 39L115 21L172 59" fill="none" stroke={colors.headerBorder} strokeWidth={3} />
          <DrawnPath d="M8 59L63 13L94 39L115 21L172 59" animatedProps={drawn} fill="none" stroke={colors.brand} strokeWidth={4} strokeLinecap="round" strokeLinejoin="round" strokeDasharray={[ROOF_LENGTH, ROOF_LENGTH]} />
        </Svg>
      </View>
      <Animated.View style={wordmark}><RoofWiseBrand /></Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  intro: { alignItems: 'center', justifyContent: 'center', gap: spacing.md, backgroundColor: colors.surface },
});
