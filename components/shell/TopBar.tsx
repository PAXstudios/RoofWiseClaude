// Desktop-web top bar. Shows the current destination's context (derived
// from the same shared navItems list the Sidebar uses) plus the two primary
// quick actions — New Job and Quick Inspection — mirroring the dashboard
// hero CTAs (Drift #3).
//
// Mounted as the tab navigator's per-screen `header` (see
// app/(tabs)/_layout.tsx), so the focused route arrives as a prop — no
// pathname parsing. The quick actions push root-stack routes via expo-router.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { navItems, type TabHeaderProps } from './navItems';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export function TopBar({ route, options }: TabHeaderProps) {
  const router = useRouter();

  // Settings is a route inside the group but not a nav item, so fall back to
  // the screen's own title before the raw route name.
  const title =
    navItems.find((it) => it.name === route.name)?.label ?? options.title ?? route.name;

  return (
    <View style={styles.bar}>
      <Text style={styles.title}>{title}</Text>

      <View style={styles.actions}>
        <Pressable
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => router.push('/new-job' as any)}
          accessibilityRole="button"
          accessibilityLabel="New Job"
        >
          <Ionicons name="add" size={20} color={colors.navy} />
          <Text style={styles.btnSecondaryText}>New Job</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnPrimary]}
          onPress={() => router.push('/quick-inspection' as any)}
          accessibilityRole="button"
          accessibilityLabel="Quick Inspection"
        >
          <Ionicons name="camera-outline" size={20} color={colors.textInverse} />
          <Text style={styles.btnPrimaryText}>Quick Inspection</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.lg,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  actions: { flexDirection: 'row', gap: spacing.md },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.pill,
  },
  btnSecondary: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  btnSecondaryText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
  },
  btnPrimary: { backgroundColor: colors.accent },
  btnPrimaryText: {
    fontSize: fontSize.bodyMd,
    fontWeight: fontWeight.semibold,
    color: colors.textInverse,
  },
});
