// Desktop-web left rail. Renders the SAME 5 destinations as BottomTabs
// (Drift #2 — Home / Leads / Map / Plan / Train, nothing more) from the
// shared navItems list, so phone and desktop can never drift apart.
// Presentational: navigation goes through expo-router.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { navItems } from './navItems';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.rail}>
      <View style={styles.brandRow}>
        <View style={styles.brandMark}>
          <Ionicons name="home" size={20} color={colors.textInverse} />
        </View>
        <Text style={styles.brandName}>RoofWise</Text>
      </View>

      <View style={styles.nav}>
        {navItems.map((it) => {
          const active = isActive(pathname, it.href);
          // Filled icon variant when active (e.g. "home-outline" → "home"),
          // mirroring BottomTabs.
          const icon = active ? String(it.icon).replace('-outline', '') : it.icon;
          return (
            <Pressable
              key={it.name}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => router.push(it.href as any)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={it.label}
            >
              <Ionicons
                name={icon as any}
                size={22}
                color={active ? colors.brand : colors.textMuted}
              />
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                {it.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

function isActive(pathname: string, href: string): boolean {
  // Home's href is '/(tabs)' (see navItems.ts); usePathname() reports it as '/'.
  if (href === '/(tabs)' || href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

const SIDEBAR_WIDTH = 248;

const styles = StyleSheet.create({
  rail: {
    width: SIDEBAR_WIDTH,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xl,
  },
  brandRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.sm,
    marginBottom: spacing.xxl,
  },
  brandMark: {
    width: 40,
    height: 40,
    borderRadius: radii.md,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: fontSize.titleMd,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  nav: { gap: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  itemActive: { backgroundColor: colors.brandSoft },
  itemLabel: {
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
  },
  itemLabelActive: {
    color: colors.brand,
    fontWeight: fontWeight.semibold,
  },
});
