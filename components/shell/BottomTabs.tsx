import { View, Text, Pressable, StyleSheet, Platform } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { mobileBottomItems } from './navItems';
import { colors, fontSize, fontWeight, shadows, touchTarget } from '@/theme/tokens';

export function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <View style={styles.bar}>
      {mobileBottomItems.map((it) => (
        <TabButton
          key={it.name}
          icon={it.icon}
          label={it.label}
          active={isActive(pathname, it.href)}
          onPress={() => router.push(it.href as any)}
        />
      ))}
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
    <Pressable style={styles.tab} onPress={onPress} hitSlop={6}>
      <Ionicons
        name={icon}
        size={24}
        color={active ? colors.accent : colors.textMuted}
      />
      <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
    </Pressable>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

const styles = StyleSheet.create({
  bar: {
    height: touchTarget.sticky,
    flexDirection: 'row',
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingBottom: Platform.OS === 'ios' ? 16 : 0,
    ...shadows.card,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  tabLabel: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
  tabLabelActive: { color: colors.accent },
});
