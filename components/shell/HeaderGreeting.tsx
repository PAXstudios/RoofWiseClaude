import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Avatar } from '@/components/ui/Avatar';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

export function HeaderGreeting() {
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <View style={styles.avatarWrap}>
          <Avatar
            name="Alex Coleman"
            uri="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=200&q=80&auto=format&fit=crop"
            size={44}
          />
          <View style={styles.dot} />
        </View>
        <View style={{ marginLeft: spacing.md }}>
          <Text style={styles.welcome}>Welcome back</Text>
          <Text style={styles.name}>Alex Coleman</Text>
        </View>
      </View>
      <Pressable hitSlop={8} style={styles.bell}>
        <Ionicons name="notifications-outline" size={22} color={colors.text} />
        <View style={styles.bellDot} />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
  },
  left: { flexDirection: 'row', alignItems: 'center' },
  avatarWrap: { position: 'relative' },
  dot: {
    position: 'absolute',
    bottom: 1,
    right: 1,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  welcome: {
    fontSize: fontSize.sm,
    color: colors.textMuted,
    fontWeight: fontWeight.medium,
  },
  name: {
    fontSize: fontSize.md,
    fontWeight: fontWeight.bold,
    color: colors.text,
  },
  bell: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bellDot: {
    position: 'absolute',
    top: 8,
    right: 10,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
    borderWidth: 1.5,
    borderColor: colors.surface,
  },
});
