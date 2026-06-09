import { Ionicons } from '@expo/vector-icons';

export type NavItem = {
  name: string;
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
};

// Spec IA: 5 bottom tabs — Home / Leads / Map / Plan / Train.
export const navItems: NavItem[] = [
  { name: 'index', label: 'Home', href: '/', icon: 'home-outline' },
  { name: 'leads', label: 'Leads', href: '/leads', icon: 'people-outline' },
  { name: 'map', label: 'Map', href: '/map', icon: 'map-outline' },
  { name: 'plan', label: 'Plan', href: '/plan', icon: 'calendar-outline' },
  { name: 'train', label: 'Train', href: '/train', icon: 'school-outline' },
];

export const mobileBottomItems = navItems;
