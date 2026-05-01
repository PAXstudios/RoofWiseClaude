import { Ionicons } from '@expo/vector-icons';

export type NavItem = {
  name: string;
  label: string;
  href: string;
  icon: keyof typeof Ionicons.glyphMap;
  // Show in mobile bottom tab bar (other items live in a More sheet).
  primary?: boolean;
};

export const navItems: NavItem[] = [
  { name: 'index', label: 'Dashboard', href: '/', icon: 'grid', primary: true },
  { name: 'leads', label: 'Leads', href: '/leads', icon: 'people-outline', primary: true },
  { name: 'map', label: 'Map', href: '/map', icon: 'map-outline', primary: true },
  { name: 'inspections', label: 'Inspections', href: '/inspections', icon: 'camera-outline' },
  { name: 'jobs', label: 'Jobs', href: '/jobs', icon: 'hammer-outline' },
  { name: 'storms', label: 'Storm Intel', href: '/storms', icon: 'thunderstorm-outline' },
  { name: 'reports', label: 'Reports', href: '/reports', icon: 'bar-chart-outline' },
  { name: 'settings', label: 'Settings', href: '/settings', icon: 'settings-outline' },
];

// Mobile bottom nav - Plan = Schedule view
export const mobileBottomItems: NavItem[] = [
  { name: 'index', label: 'Home', href: '/', icon: 'grid', primary: true },
  { name: 'leads', label: 'Leads', href: '/leads', icon: 'people-outline', primary: true },
  { name: 'map', label: 'Map', href: '/map', icon: 'map-outline', primary: true },
  { name: 'storms', label: 'Storms', href: '/storms', icon: 'thunderstorm-outline', primary: true },
];
