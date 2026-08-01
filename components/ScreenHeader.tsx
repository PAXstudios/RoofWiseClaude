import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

type Props = {
  title: string;
  subtitle?: string;
  /** Render a back chevron. Defaults to router.back when `true`. */
  back?: boolean | (() => void);
  /** Right-aligned actions (icon buttons, pills). */
  right?: ReactNode;
  /** Show the orange tick accent before the title. Default true. */
  accent?: boolean;
};

/**
 * Unified screen header — tab screens use it without `back`, detail
 * screens with it. Keeps title typography, the orange tick accent, and
 * touch targets consistent across the app.
 */
export function ScreenHeader({ title, subtitle, back, right, accent = true }: Props) {
  const router = useRouter();
  const onBack = typeof back === 'function' ? back : back ? () => router.back() : undefined;

  return (
    <View style={styles.row}>
      {onBack && (
        <Pressable
          onPress={onBack}
          hitSlop={10}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={24} color={colors.navy} />
        </Pressable>
      )}
      <View style={styles.titleBlock}>
        <View style={styles.titleRow}>
          {accent && <View style={styles.tick} />}
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
        </View>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  backBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tick: { width: 4, height: 22, borderRadius: 2, backgroundColor: colors.orange },
  title: {
    flex: 1,
    fontSize: fontSize.titleLg,
    fontWeight: fontWeight.bold,
    color: colors.navy,
    letterSpacing: -0.4,
  },
  subtitle: {
    fontSize: fontSize.bodySm,
    color: colors.slate,
    marginTop: 2,
    marginLeft: spacing.sm + 4,
  },
});
