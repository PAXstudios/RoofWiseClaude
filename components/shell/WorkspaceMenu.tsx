import { useState } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useCanGoBack, useRouter, type Href } from 'expo-router';
import { GlassCard } from '@/components/glass/GlassCard';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useAuthStore } from '@/lib/auth/authStore';
import { colors, fontFamily, fontSize, radii, spacing, touchTarget } from '@/theme/tokens';
import { navItems } from './navItems';

const destinations = [
  ...navItems,
  { label: 'Settings', href: '/settings', icon: 'settings-outline' },
  { label: 'RoofWise tour', href: '/onboarding', icon: 'compass-outline' },
] as const;
const signIn = { label: 'Sign in', href: '/welcome', icon: 'log-in-outline' } as const;

type ExitGuard = (leave: () => void) => void;

export function WorkspaceMenu({ beforeLeave }: { beforeLeave?: ExitGuard } = {}) {
  const [open, setOpen] = useState(false);
  const session = useAuthStore((state) => state.session);
  const router = useRouter();
  const items = session ? destinations : [...destinations, signIn];

  function choose(href: string) {
    const leave = () => {
      setOpen(false);
      router.navigate(href as Href);
    };
    if (beforeLeave) beforeLeave(leave);
    else leave();
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open navigation menu"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.hit, pressed && styles.pressed]}
      >
        <GlassCard onLight onArt radius={radii.pill} style={styles.glass}>
          <Ionicons name="menu-outline" size={23} color={colors.navy} />
        </GlassCard>
      </Pressable>
      {open && (
        <BottomSheet visible onClose={() => setOpen(false)} title="Menu" accessibilityLabel="Navigation menu">
          <View style={styles.list}>
            {items.map((item) => (
              <Pressable
                key={item.href}
                onPress={() => choose(item.href)}
                accessibilityRole="button"
                accessibilityLabel={item.label}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              >
                <Ionicons name={item.icon} size={21} color={colors.brand} />
                <Text style={styles.label}>{item.label}</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
              </Pressable>
            ))}
          </View>
        </BottomSheet>
      )}
    </>
  );
}

/** Directly opened detail routes have no history entry to pop. */
export function BackOrMenu({
  onBack,
  color = colors.navy,
  style,
  icon = 'chevron-back',
  hasLocalBack = false,
  beforeLeave,
}: {
  onBack?: () => void;
  color?: string;
  style?: StyleProp<ViewStyle>;
  icon?: 'chevron-back' | 'close';
  hasLocalBack?: boolean;
  beforeLeave?: ExitGuard;
}) {
  const canGoBack = useCanGoBack();
  const router = useRouter();
  if (!canGoBack && !hasLocalBack) return <WorkspaceMenu beforeLeave={beforeLeave} />;
  return (
    <Pressable
      onPress={onBack ?? (() => router.back())}
      accessibilityRole="button"
      accessibilityLabel={icon === 'close' ? 'Close' : 'Go back'}
      style={({ pressed }) => [style, styles.hit, pressed && styles.pressed]}
    >
      <Ionicons name={icon} size={24} color={color} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  hit: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    alignItems: 'center',
    justifyContent: 'center',
  },
  glass: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
    borderColor: colors.border,
  },
  pressed: { opacity: 0.75 },
  list: { borderRadius: radii.card, backgroundColor: colors.surfaceMuted, overflow: 'hidden' },
  row: {
    minHeight: touchTarget.standard,
    alignItems: 'center',
    flexDirection: 'row',
    gap: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  rowPressed: { backgroundColor: colors.brandSoft },
  label: { flex: 1, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd, color: colors.text },
});
