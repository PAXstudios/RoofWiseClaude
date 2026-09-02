import { Ionicons } from '@expo/vector-icons';

export type NavItem = {
  name: string;
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// Spec IA: 5 bottom tabs — Home / Leads / Map / Plan / Train.
//
// Home is '/(tabs)', NOT '/'. In expo-router 6, '/' resolves to the root
// redirect screen (app/index.tsx), so a Home tap pushed a blank screen onto
// the root stack which then REPLACEd itself with a brand-new tab shell —
// shells accumulated and every Home tap played a double slide transition.
// '/(tabs)' resolves to (tabs) > index and targets the existing shell.
export const navItems: NavItem[] = [
  { name: 'index', label: 'Home', href: '/(tabs)', icon: 'home-outline' },
  { name: 'leads', label: 'Leads', href: '/leads', icon: 'people-outline' },
  { name: 'map', label: 'Map', href: '/map', icon: 'map-outline' },
  { name: 'plan', label: 'Plan', href: '/plan', icon: 'calendar-outline' },
  { name: 'train', label: 'Train', href: '/train', icon: 'school-outline' },
];

export const mobileBottomItems = navItems;
