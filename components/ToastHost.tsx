import { useEffect } from 'react';
import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeInUp,
  FadeOutUp,
  Layout,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useToastStore, type Toast } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
} from '@/theme/tokens';

const TONE_TINT: Record<Toast['tone'], { bg: string; fg: string; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { bg: colors.success, fg: colors.textInverse, icon: 'checkmark-circle' },
  info: { bg: colors.navy, fg: colors.textInverse, icon: 'information-circle' },
  warn: { bg: colors.warn, fg: colors.navy, icon: 'warning' },
  danger: { bg: colors.danger, fg: colors.textInverse, icon: 'alert-circle' },
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  useEffect(() => {
    // Force unmount of toast component when array shrinks — Animated.View
    // already handles exit via FadeOutUp.
  }, [toasts.length]);

  if (toasts.length === 0) return null;

  return (
    <View pointerEvents="box-none" style={styles.host}>
      {toasts.map((t) => {
        const tone = TONE_TINT[t.tone];
        return (
          <Animated.View
            key={t.id}
            entering={FadeInUp.duration(220)}
            exiting={FadeOutUp.duration(180)}
            layout={Layout.springify().damping(15)}
            style={[styles.toast, { backgroundColor: tone.bg }]}
          >
            <Ionicons name={tone.icon} size={22} color={tone.fg} />
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, { color: tone.fg }]}>{t.title}</Text>
              {t.body && <Text style={[styles.body, { color: tone.fg }]}>{t.body}</Text>}
            </View>
            <Pressable onPress={() => dismiss(t.id)} hitSlop={10}>
              <Ionicons name="close" size={18} color={tone.fg} />
            </Pressable>
          </Animated.View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    top: 56,
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radii.card,
    ...shadows.pressed,
  },
  title: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },
  body: { fontSize: fontSize.bodySm, marginTop: 2, opacity: 0.92 },
});
