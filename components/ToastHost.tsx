import { View, Text, StyleSheet, Pressable } from 'react-native';
import Animated, {
  FadeInDown,
  FadeOutUp,
  Layout,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useToastStore, type Toast } from '@/lib/stores/toastStore';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

// Toasts are white iOS cards; the tone lives in a slim left accent bar and
// the icon, not in a full-bleed colored background.
const TONE_TINT: Record<Toast['tone'], { tint: string; icon: keyof typeof Ionicons.glyphMap }> = {
  success: { tint: colors.success, icon: 'checkmark-circle' },
  info: { tint: colors.brand, icon: 'information-circle' },
  warn: { tint: colors.warn, icon: 'warning' },
  danger: { tint: colors.danger, icon: 'alert-circle' },
};

export function ToastHost() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);
  const insets = useSafeAreaInsets();

  if (toasts.length === 0) return null;

  return (
    <View
      pointerEvents="box-none"
      style={[styles.host, { top: insets.top + spacing.sm }]}
    >
      {toasts.map((t) => {
        const tone = TONE_TINT[t.tone];
        return (
          <Animated.View
            key={t.id}
            entering={FadeInDown.springify()
              .mass(motion.snappy.mass)
              .damping(motion.snappy.damping)
              .stiffness(motion.snappy.stiffness)}
            exiting={FadeOutUp.duration(180)}
            layout={Layout.springify()
              .damping(motion.snappy.damping)
              .stiffness(motion.snappy.stiffness)}
            style={styles.toast}
          >
            <View style={[styles.accentBar, { backgroundColor: tone.tint }]} />
            <Ionicons name={tone.icon} size={22} color={tone.tint} />
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>{t.title}</Text>
              {t.body && <Text style={styles.body}>{t.body}</Text>}
            </View>
            <Pressable
              onPress={() => dismiss(t.id)}
              hitSlop={8}
              style={styles.closeBtn}
              accessibilityRole="button"
              accessibilityLabel="Dismiss"
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
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
    left: spacing.lg,
    right: spacing.lg,
    gap: spacing.sm,
    zIndex: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
    minHeight: touchTarget.standard,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    borderRadius: radii.card,
    ...shadows.float,
  },
  accentBar: {
    width: 4,
    borderRadius: 2,
    alignSelf: 'stretch',
    marginVertical: 2,
  },
  title: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  body: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },
  closeBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
