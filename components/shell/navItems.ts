import type { ComponentProps } from 'react';
import type { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

export type NavItem = {
  /** Route name inside app/(tabs)/ — the key the tab navigator's state uses. */
  name: string;
  label: string;
  /** Href for imperative callers outside the tab navigator (deep links, Home CTAs). */
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// Spec IA: 5 bottom tabs — Home / Leads / Map / Plan / Train (Drift #2).
//
// The shell chrome (BottomTabs / Sidebar) no longer navigates by href: it is
// rendered by expo-router's <Tabs tabBar={...}> and switches tabs through the
// navigator's own `navigation.navigate(route.name)`, which the TabRouter
// treats as a JUMP_TO — the destination screen stays mounted between visits.
// `href` is kept for callers OUTSIDE the navigator (router.push / navigate /
// dismissTo from Home, the storm-alert sheet, notification taps). Home is
// '/(tabs)', NOT '/': in expo-router 6 '/' resolves to the root redirect
// screen (app/index.tsx), which would push a blank screen onto the root stack.
export const navItems: NavItem[] = [
  { name: 'index', label: 'Home', href: '/(tabs)', icon: 'home-outline' },
  { name: 'leads', label: 'Leads', href: '/(tabs)/leads', icon: 'people-outline' },
  { name: 'map', label: 'Map', href: '/(tabs)/map', icon: 'map-outline' },
  { name: 'plan', label: 'Plan', href: '/(tabs)/plan', icon: 'calendar-outline' },
  { name: 'train', label: 'Train', href: '/(tabs)/train', icon: 'school-outline' },
];

export const mobileBottomItems = navItems;

// Prop types for the custom chrome, derived from expo-router's own <Tabs>
// signature rather than imported from @react-navigation/bottom-tabs directly:
// expo-router drops its public react-navigation dependency in SDK 56
// (components/map/Map.tsx carries the same note), so the shell must not take
// one on either.
type TabsProps = ComponentProps<typeof Tabs>;

/** What `<Tabs tabBar={(props) => ...}>` hands the bar: state, descriptors, navigation, insets. */
export type TabBarProps = Parameters<NonNullable<TabsProps['tabBar']>>[0];

type TabScreenOptions = Exclude<
  NonNullable<TabsProps['screenOptions']>,
  (...args: never[]) => unknown
>;

/** What a custom `header` option receives: layout, route, navigation, options. */
export type TabHeaderProps = Parameters<NonNullable<TabScreenOptions['header']>>[0];
