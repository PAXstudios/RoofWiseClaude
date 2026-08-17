import type { ReactNode } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import {
  colors,
  fontSize,
  fontWeight,
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
  /** Legacy orange tick accent. Accepted for compatibility; the iOS
   *  treatment renders plain ink titles, so this no longer draws. */
  accent?: boolean;
};

/**
 * Unified screen header, iOS treatment. Tab roots use it without `back`
 * and get a large 34/bold ink title sitting directly on the grouped
 * ground — no card, no accent bar. Detail screens pass `back` and get
 * the inline 17/semibold bar with a plain chevron. Touch targets stay
 * glove-sized throughout.
 */
export function ScreenHeader({ title, subtitle, back, right }: Props) {
  const router = useRouter();
  const onBack = typeof back === 'function' ? back : back ? () => router.back() : undefined;

  // Sub-screen: inline title after a plain chevron.
  if (onBack) {
    return (
      <View style={styles.inlineRow}>
        <Pressable
          onPress={onBack}
          hitSlop={8}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Ionicons name="chevron-back" size={26} color={colors.text} />
        </Pressable>
        <View style={styles.titleBlock}>
          <Text style={styles.inlineTitle} numberOfLines={1}>
            {title}
          </Text>
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

  // Tab root: large title on the grouped ground.
  return (
    <View style={styles.largeWrap}>
      <View style={styles.largeRow}>
        <Text style={styles.largeTitle} numberOfLines={1}>
          {title}
        </Text>
        {right}
      </View>
      {subtitle ? (
        <Text style={styles.subtitle} numberOfLines={1}>
          {subtitle}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  largeWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  largeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  largeTitle: {
    flex: 1,
    fontSize: fontSize.display,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.5,
  },
  inlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: touchTarget.standard,
    paddingLeft: spacing.xs,
    paddingRight: spacing.xl,
    gap: spacing.xs,
  },
  backBtn: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  titleBlock: { flex: 1 },
  inlineTitle: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.semibold,
    color: colors.text,
    letterSpacing: -0.2,
  },
  subtitle: {
    fontSize: fontSize.bodySm,
    color: colors.textMuted,
    marginTop: 2,
  },
});
