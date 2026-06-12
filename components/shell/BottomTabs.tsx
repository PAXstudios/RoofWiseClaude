import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { mobileBottomItems } from './navItems';
import { colors, fontSize, fontWeight, radii, shadows, spacing } from '@/theme/tokens';

export function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.bar}>
        {mobileBottomItems.map((it) => (
          <TabButton
            key={it.name}
            icon={it.icon}
            label={it.label}
            active={isActive(pathname, it.href)}
            onPress={() => {
              Haptics.selectionAsync().catch(() => {});
              router.push(it.href as any);
            }}
          />
        ))}
      </View>
    </View>
  );
}

function TabButton({
  icon,
  label,
  active,
  onPress,
}: {
  icon: any;
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  // Filled icon variant when active (e.g. "home-outline" → "home").
  const activeIcon = String(icon).replace('-outline', '');
  return (
    <Pressable style={styles.tab} onPress={onPress} hitSlop={6}>
      <View style={[styles.tabInner, active && styles.tabInnerActive]}>
        <Ionicons
          name={(active ? activeIcon : icon) as any}
          size={22}
          color={active ? colors.orange : 'rgba(240,240,228,0.6)'}
        />
        <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
      </View>
    </Pressable>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.lg,
    paddingBottom: Platform.OS === 'ios' ? spacing.xs : spacing.md,
    paddingTop: spacing.sm,
    backgroundColor: 'transparent',
  },
  bar: {
    flexDirection: 'row',
    backgroundColor: colors.navy,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.xs,
    ...shadows.pressed,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tabInner: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radii.pill,
    minWidth: 56,
  },
  tabInnerActive: {
    backgroundColor: 'rgba(252,96,24,0.16)',
  },
  tabLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.medium,
    color: 'rgba(240,240,228,0.6)',
  },
  tabLabelActive: { color: colors.orange, fontWeight: fontWeight.bold },
});
