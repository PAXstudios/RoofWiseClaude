// Desktop-web left rail. Renders the SAME 5 destinations as BottomTabs
// (Drift #2 — Home / Leads / Map / Plan / Train, nothing more) from the
// shared navItems list, so phone and desktop can never drift apart.
//
// Like BottomTabs, this is the tab navigator's `tabBar` (mounted on the left
// via `tabBarPosition: 'left'` in app/(tabs)/_layout.tsx), so it switches
// tabs through the navigator itself — a JUMP_TO that keeps every tab's state
// alive — rather than pushing routes.

import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { navItems, type TabBarProps } from './navItems';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export function Sidebar({ state, descriptors, navigation }: TabBarProps) {
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
          const routeIndex = state.routes.findIndex((r) => r.name === it.name);
          if (routeIndex === -1) return null;
          const route = state.routes[routeIndex];
          const active = state.index === routeIndex;
          const label = descriptors[route.key]?.options.title ?? it.label;
          // Filled icon variant when active (e.g. "home-outline" → "home"),
          // mirroring BottomTabs.
          const icon = active ? String(it.icon).replace('-outline', '') : it.icon;
          return (
            <Pressable
              key={route.key}
              style={[styles.item, active && styles.itemActive]}
              onPress={() => {
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (active || event.defaultPrevented) return;
                navigation.navigate(route.name, route.params);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Ionicons
                name={icon as any}
                size={22}
                color={active ? colors.brand : colors.textMuted}
              />
              <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                {label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
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
