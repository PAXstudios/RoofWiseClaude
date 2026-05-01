import { Ionicons } from '@expo/vector-icons';

export type Activity = {
  id: string;
  icon: keyof typeof Ionicons.glyphMap;
  tone: 'brand' | 'accent' | 'success' | 'warn';
  text: string;
  meta: string;
};

export const recentActivity: Activity[] = [
  { id: 'a1', icon: 'sparkles', tone: 'accent', text: 'AI flagged 3 hail strikes at 901 Birch Dr', meta: '12 min ago' },
  { id: 'a2', icon: 'checkmark-done', tone: 'success', text: 'Smith Residence inspection completed', meta: '1 hr ago' },
  { id: 'a3', icon: 'cloud-outline', tone: 'warn', text: 'Severe hail warning issued for Sangamon County', meta: '2 hrs ago' },
  { id: 'a4', icon: 'person-add', tone: 'brand', text: 'New lead: Carla Reyes — 88 Elm Court', meta: 'Today, 8:14 AM' },
  { id: 'a5', icon: 'document-text', tone: 'brand', text: 'Proposal sent to David Park ($22,500)', meta: 'Yesterday' },
];
