import { View, Text, TextInput, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function TopBar() {
  return (
    <View style={styles.bar}>
      <View style={styles.search}>
        <Ionicons name="search" size={16} color={colors.textMuted} />
        <TextInput
          placeholder="Search leads, jobs, addresses, storm events…"
          placeholderTextColor={colors.textSubtle}
          style={styles.input}
        />
        <View style={styles.kbd}>
          <Text style={styles.kbdLabel}>⌘K</Text>
        </View>
      </View>
      <View style={styles.right}>
        <Pressable style={styles.filterBtn}>
          <Ionicons name="options-outline" size={16} color={colors.textMuted} />
          <Text style={styles.filterLabel}>Filters</Text>
        </Pressable>
        <Pressable style={styles.iconBtn}>
          <Ionicons name="notifications-outline" size={18} color={colors.text} />
          <View style={styles.dot} />
        </Pressable>
        <View style={styles.profile}>
          <Avatar
            name="Alex Coleman"
            uri="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&q=80&auto=format&fit=crop"
            size={32}
          />
          <View>
            <Text style={styles.profileName}>Alex Coleman</Text>
            <Text style={styles.profileRole}>Lead Adjuster</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    gap: spacing.lg,
  },
  search: {
    flex: 1,
    maxWidth: 520,
    height: 40,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.pill,
    paddingHorizontal: spacing.lg,
  },
  input: {
    flex: 1,
    fontSize: fontSize.sm,
    color: colors.text,
    // @ts-expect-error web-only
    outlineStyle: 'none',
  },
  kbd: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radii.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  kbdLabel: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  right: {
    marginLeft: 'auto',
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  filterBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    height: 36,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  filterLabel: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.semibold,
  },
  iconBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.border,
  },
  dot: {
    position: 'absolute',
    top: 8,
    right: 9,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
  profile: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingLeft: spacing.sm,
    borderLeftWidth: 1,
    borderLeftColor: colors.border,
    paddingVertical: 4,
  },
  profileName: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  profileRole: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
  },
});
