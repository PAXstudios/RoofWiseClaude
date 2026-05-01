import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mobileBottomItems } from './navItems';
import { colors, fontSize, fontWeight, shadows, spacing } from '@/theme/tokens';

export function BottomTabs({ onQuickAction }: { onQuickAction?: () => void }) {
  const router = useRouter();
  const pathname = usePathname();

  const items = mobileBottomItems;
  const left = items.slice(0, 2);
  const right = items.slice(2);

  return (
    <View style={styles.wrap}>
      <View style={styles.bar}>
        {left.map((it) => (
          <TabButton
            key={it.name}
            icon={it.icon}
            label={it.label}
            active={isActive(pathname, it.href)}
            onPress={() => router.push(it.href as any)}
          />
        ))}
        <View style={styles.fabSlot} />
        {right.map((it) => (
          <TabButton
            key={it.name}
            icon={it.icon}
            label={it.label}
            active={isActive(pathname, it.href)}
            onPress={() => router.push(it.href as any)}
          />
        ))}
      </View>
      <Pressable style={styles.fab} onPress={onQuickAction}>
        <Ionicons name="add" size={28} color={colors.textInverse} />
      </Pressable>
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
  return (
    <Pressable style={styles.tab} onPress={onPress} hitSlop={4}>
      <Ionicons
        name={icon}
        size={22}
        color={active ? colors.brand : colors.textMuted}
      />
      <Text style={[styles.tabLabel, active && { color: colors.brand }]}>
        {label}
      </Text>
    </Pressable>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

const FAB_SIZE = 56;

const styles = StyleSheet.create({
  wrap: {
    position: Platform.OS === 'web' ? ('sticky' as any) : 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
  },
  bar: {
    height: 72,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 12 : 0,
    ...shadows.card,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  fabSlot: {
    width: FAB_SIZE + spacing.lg,
  },
  fab: {
    position: 'absolute',
    top: -FAB_SIZE / 2,
    alignSelf: 'center',
    width: FAB_SIZE,
    height: FAB_SIZE,
    borderRadius: FAB_SIZE / 2,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.pressed,
  },
});
