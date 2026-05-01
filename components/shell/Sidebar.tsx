import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Link, usePathname } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { navItems } from './navItems';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function Sidebar() {
  const pathname = usePathname();
  return (
    <View style={styles.wrap}>
      <View style={styles.brand}>
        <View style={styles.logo}>
          <Ionicons name="home" size={18} color={colors.surface} />
        </View>
        <View>
          <Text style={styles.brandName}>RoofWise</Text>
          <Text style={styles.brandSub}>Forensic AI</Text>
        </View>
      </View>

      <View style={styles.list}>
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.name} href={item.href as any} asChild>
              <Pressable style={[styles.item, active && styles.itemActive]}>
                <Ionicons
                  name={item.icon}
                  size={18}
                  color={active ? colors.accent : colors.textMuted}
                />
                <Text style={[styles.itemLabel, active && styles.itemLabelActive]}>
                  {item.label}
                </Text>
              </Pressable>
            </Link>
          );
        })}
      </View>

      <View style={styles.upsell}>
        <Text style={styles.upsellTitle}>Storm season</Text>
        <Text style={styles.upsellBody}>
          4 properties in your radius are flagged. Launch an outreach campaign in 2 taps.
        </Text>
        <Pressable style={styles.upsellBtn}>
          <Text style={styles.upsellBtnLabel}>Open Storm Intel</Text>
        </Pressable>
      </View>
    </View>
  );
}

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/' || pathname === '/index';
  return pathname.startsWith(href);
}

const styles = StyleSheet.create({
  wrap: {
    width: 248,
    backgroundColor: colors.surface,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingVertical: spacing.xl,
    paddingHorizontal: spacing.md,
  },
  brand: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.xl,
  },
  logo: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    backgroundColor: colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  brandName: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  brandSub: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  list: { gap: 4, flex: 1 },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 10,
    borderRadius: radii.md,
  },
  itemActive: {
    backgroundColor: colors.accentSoft,
  },
  itemLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  itemLabelActive: {
    color: colors.accentPressed,
    fontWeight: fontWeight.semibold,
  },
  upsell: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.card,
    padding: spacing.lg,
    marginTop: spacing.lg,
  },
  upsellTitle: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.bold,
    color: colors.text,
    marginBottom: 4,
  },
  upsellBody: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    lineHeight: 16,
    marginBottom: spacing.md,
  },
  upsellBtn: {
    backgroundColor: colors.text,
    borderRadius: radii.pill,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  upsellBtnLabel: {
    color: colors.textInverse,
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
  },
});
