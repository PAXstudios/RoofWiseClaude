import { useEffect } from 'react';
import { View, Text, Pressable, StyleSheet } from 'react-native';
import { useRouter, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
} from 'react-native-reanimated';
import { mobileBottomItems } from './navItems';
import { colors, fontSize, fontWeight, motion, spacing, touchTarget } from '@/theme/tokens';

// Edge-to-edge iOS tab bar — barFill ground, hairline top border, no chrome
// beyond that. The bar handles its own bottom inset (SafeAreaView is
// position-aware, so it adds nothing when a parent already applied it).
export function BottomTabs() {
  const router = useRouter();
  const pathname = usePathname();

  return (
    <SafeAreaView edges={['bottom']} style={styles.wrap} pointerEvents="box-none">
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
    </SafeAreaView>
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

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
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
