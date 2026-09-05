import { useEffect, useRef, useState } from 'react';
import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  cancelAnimation,
  ReduceMotion,
  withSpring,
} from 'react-native-reanimated';
import { mobileBottomItems, type TabBarProps } from './navItems';
import { colors, fontFamily, fontSize, motion, navigationDock, radii, spacing, touchTarget } from '@/theme/tokens';

// The floating pill tab bar — docs/DESIGN_1A.md §4. Off the bottom edge with
// side margins (not edge-to-edge), full-pill radius, the active tab wearing
// a quiet paper/navy chip behind icon+label. Same tabPress/navigation contract as
// before this reskin — only the paint changed.
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
  const tabRefs = useRef<Record<string, View | null>>({});
  const [focusedKey, setFocusedKey] = useState<string | null>(null);
  const visibleItems = mobileBottomItems.flatMap((item) => {
    const route = state.routes.find((candidate) => candidate.name === item.name);
    return route ? [{ item, route }] : [];
  });
  const activeKey = state.routes[state.index]?.key;
  const entryKey = visibleItems.some(({ route }) => route.key === focusedKey)
    ? focusedKey
    : visibleItems.some(({ route }) => route.key === activeKey)
      ? activeKey
      : visibleItems[0]?.route.key;

  function activate(route: TabBarProps['state']['routes'][number]) {
    Haptics.selectionAsync().catch(() => {});
    const event = navigation.emit({
      type: 'tabPress', target: route.key, canPreventDefault: true,
    });
    if (route.key === activeKey || event.defaultPrevented) return;
    navigation.navigate(route.name, route.params);
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar} accessibilityRole="tablist" accessibilityLabel="Main navigation">
        {visibleItems.map(({ item, route }, index) => {
          const active = activeKey === route.key;
          const label = descriptors[route.key]?.options.title ?? item.label;

          return (
            <TabButton
              key={route.key}
              icon={item.icon}
              label={label}
              active={active}
              onPress={() => activate(route)}
              onFocusChange={Platform.OS === 'web'
                ? (focused) => setFocusedKey(focused ? route.key : null)
                : undefined}
              webProps={Platform.OS === 'web' ? {
                ref: (node) => { tabRefs.current[route.key] = node; },
                tabIndex: entryKey === route.key ? 0 : -1,
                onKeyDown: (event) => {
                  // RN Web activates Enter on keyup. Space is only built in
                  // for role=button, so tabs own Space exactly once here.
                  if (event.key === ' ' || event.key === 'Spacebar') {
                    event.preventDefault();
                    event.stopPropagation();
                    if (!event.repeat) activate(route);
                    return;
                  }
                  const nextIndex = event.key === 'ArrowRight'
                    ? (index + 1) % visibleItems.length
                    : event.key === 'ArrowLeft'
                      ? (index + visibleItems.length - 1) % visibleItems.length
                      : event.key === 'Home' ? 0
                        : event.key === 'End' ? visibleItems.length - 1 : null;
                  if (nextIndex === null) return;
                  event.preventDefault();
                  event.stopPropagation();
                  const next = visibleItems[nextIndex].route;
                  tabRefs.current[next.key]?.focus();
                  activate(next);
                },
              } : undefined}
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

type DockKeyboardEvent = {
  key: string;
  repeat?: boolean;
  preventDefault: () => void;
  stopPropagation: () => void;
};

type WebTabProps = {
  ref: (node: View | null) => void;
  tabIndex: 0 | -1;
  onKeyDown: (event: DockKeyboardEvent) => void;
};

function TabButton({
  icon,
  label,
  active,
  onPress,
  onLongPress,
  onFocusChange,
  webProps,
}: {
  icon: any;
  label: string;
  active: boolean;
  onPress: () => void;
  onLongPress: () => void;
  onFocusChange?: (focused: boolean) => void;
  webProps?: WebTabProps;
}) {
  // Filled icon variant when active (e.g. "home-outline" → "home").
  const activeIcon = String(icon).replace('-outline', '');

  // A quiet settling motion marks the new destination. No bounce sequence,
  // and Reduce Motion keeps the icon at its resting size.
  const reduced = useReducedMotion();
  const [focused, setFocused] = useState(false);
  const iconScale = useSharedValue(1);

  useEffect(() => {
    iconScale.value = reduced ? 1 : withSpring(
      active ? navigationDock.selectedIconScale : 1,
      { ...motion.snappy, reduceMotion: ReduceMotion.System },
    );
    return () => cancelAnimation(iconScale);
  }, [active, iconScale, reduced]);

  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
  }));

  return (
    <Pressable
      {...webProps}
      // RN Web otherwise paints the browser's rectangular focus outline on
      // top of the intentional pill-shaped ring below. Keep one clear focus
      // treatment, shaped exactly like the control.
      style={[styles.tab, Platform.OS === 'web' && ({ outlineStyle: 'none' } as any)]}
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      aria-selected={active}
      accessibilityLabel={label}
      onFocus={() => { setFocused(true); onFocusChange?.(true); }}
      onBlur={() => { setFocused(false); onFocusChange?.(false); }}
    >
      {({ pressed }) => <View style={[
        styles.tabChip,
        active && styles.tabChipActive,
        pressed && styles.tabChipPressed,
        focused && styles.tabChipFocused,
      ]}>
        <Animated.View style={iconStyle}>
          <Ionicons
            name={(active ? activeIcon : icon) as any}
            size={navigationDock.iconSize}
            color={active ? colors.text : colors.textMuted}
          />
        </Animated.View>
        <Text numberOfLines={1} style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      </View>}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  // Opaque through the home-indicator inset so the full bottom edge is warm
  // paper; a transparent wrapper exposed the orange stop in the screen mesh.
  wrap: {
    backgroundColor: navigationDock.ground,
    paddingTop: navigationDock.topInset,
    paddingHorizontal: navigationDock.edgeInset,
    alignItems: 'center',
  },
  bar: {
    flexDirection: 'row',
    width: '100%',
    maxWidth: navigationDock.maxWidth,
    marginBottom: navigationDock.bottomInset,
    minHeight: navigationDock.height,
    borderRadius: radii.pill,
    backgroundColor: navigationDock.surface,
    borderWidth: 1,
    borderColor: navigationDock.border,
    paddingHorizontal: spacing.xs / 2,
    alignItems: 'center',
    ...navigationDock.shadow,
  },
  tab: {
    flex: 1,
    minWidth: touchTarget.standard,
    minHeight: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: spacing.xs,
  },
  tabChip: {
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    minHeight: touchTarget.standard,
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    borderWidth: 2,
    borderColor: 'transparent',
    borderRadius: radii.pill,
  },
  tabChipActive: {
    backgroundColor: navigationDock.selectedFill,
  },
  tabChipPressed: { backgroundColor: navigationDock.pressedFill },
  tabChipFocused: { borderColor: navigationDock.focusRing },
  tabLabel: {
    fontFamily: fontFamily.archivo.medium,
    fontSize: fontSize.caption,
    color: colors.textMuted,
  },
  tabLabelActive: {
    fontFamily: fontFamily.archivo.bold,
    color: colors.text,
  },
});
