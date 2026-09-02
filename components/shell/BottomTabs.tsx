import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { mobileBottomItems, type TabBarProps } from './navItems';
import { colors, fontSize, fontWeight, motion, spacing, touchTarget } from '@/theme/tokens';

// Edge-to-edge iOS tab bar — barFill ground, hairline top border, no chrome
// beyond that. The bar handles its own bottom inset (SafeAreaView is
// position-aware, so it adds nothing when a parent already applied it).
//
// Rendered by expo-router's <Tabs tabBar={...}> in app/(tabs)/_layout.tsx, so
// it receives the navigator's live `state` (which tab is focused) and
// `navigation` (how to switch). A tap dispatches NAVIGATE to the tab's own
// router, which the TabRouter resolves as a JUMP_TO: the current tab stays
// mounted, the destination is mounted once (lazy) and then reused — no more
// stack push/pop, no NOAA re-fetch on the Map tab, no replayed entrance
// animation on Home. Re-tapping the focused tab only emits `tabPress` (a
// screen may listen and scroll to top); it never navigates.
export function BottomTabs({ state, descriptors, navigation }: TabBarProps) {
  return (
    <SafeAreaView edges={['bottom']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {mobileBottomItems.map((it) => {
          const routeIndex = state.routes.findIndex((r) => r.name === it.name);
          // Defensive: a nav item whose route file is missing renders nothing
          // rather than a dead button.
          if (routeIndex === -1) return null;
          const route = state.routes[routeIndex];
          const active = state.index === routeIndex;
          const label = descriptors[route.key]?.options.title ?? it.label;

          return (
            <TabButton
              key={route.key}
              icon={it.icon}
              label={label}
              active={active}
              onPress={() => {
                Haptics.selectionAsync().catch(() => {});
                // Same contract as react-navigation's stock BottomTabBar: emit a
                // preventable `tabPress`, then navigate only when not focused.
                const event = navigation.emit({
                  type: 'tabPress',
                  target: route.key,
                  canPreventDefault: true,
                });
                if (active || event.defaultPrevented) return;
                navigation.navigate(route.name, route.params);
              }}
              onLongPress={() => {
                navigation.emit({ type: 'tabLongPress', target: route.key });
              }}
            />
          );
        })}
      </View>
    </SafeAreaView>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
  onLongPress,
}: {
  icon: any;
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  // Filled icon variant when active (e.g. "home-outline" → "home").
  const activeIcon = String(icon).replace('-outline', '');

  // Icon pops with a small spring (1 → 1.12 → 1) when the tab becomes active.
  const iconScale = useSharedValue(1);

  useEffect(() => {
    if (active) {
      iconScale.value = withSequence(
        withSpring(1.12, motion.snappy),
        withSpring(1, motion.snappy),
      );
    }
  }, [active, iconScale]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  return (
    <Pressable
      style={styles.tab}
      onPress={onPress}
      onLongPress={onLongPress}
      hitSlop={6}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
    >
      <Animated.View style={iconStyle}>
        <Ionicons
          name={(active ? activeIcon : icon) as any}
          size={24}
          color={active ? colors.accent : colors.textMuted}
        />
      </Animated.View>
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: {
    backgroundColor: colors.barFill,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.hairline,
  },
  bar: {
    flexDirection: 'row',
  },
  tab: {
    flex: 1,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.xs,
  },
  tabLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: colors.textMuted,
  },
  tabLabelActive: { color: colors.accent },
});
