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
import { RoofWiseBrand } from '@/components/ui/RoofWiseBrand';
import { navItems, type TabBarProps } from './navItems';
import { fontFamily,
  colors,
  fontSize,
  fontWeight,
  radii,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export function Sidebar({ state, descriptors, emitter, navigateToTab }: TabBarProps) {
  return (
    <View style={styles.rail}>
      <View style={styles.brandRow}>
        <RoofWiseBrand inverse />
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
                const event = emitter.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (active || event.defaultPrevented) return;
                navigateToTab(route.key);
              }}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              accessibilityLabel={label}
            >
              <Ionicons
                name={icon as any}
                size={22}
                color={active ? colors.textInverse : colors.onDarkMuted}
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
    backgroundColor: colors.navy,
    borderRightWidth: 1,
    borderRightColor: colors.navyBorder,
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
  nav: { gap: spacing.xs },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.md,
  },
  itemActive: { backgroundColor: colors.brand },
  itemLabel: { fontFamily: fontFamily.archivo.medium,
    fontSize: fontSize.bodyLg,
    fontWeight: fontWeight.medium,
    color: colors.onDarkMuted,
  },
  itemLabelActive: {
    color: colors.textInverse,
    fontWeight: fontWeight.semibold,
  },
});
