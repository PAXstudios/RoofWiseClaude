import { View, Text, Pressable, StyleSheet } from 'react-native';
import { colors, fontSize, fontWeight, spacing } from '@/theme/tokens';

export function SectionHeader({
  title,
  action,
  onAction,
  right,
}: {
  title: string;
  action?: string;
  onAction?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {right
        ? right
        : action && (
            <Pressable onPress={onAction} hitSlop={8}>
              <Text style={styles.action}>{action}</Text>
            </Pressable>
          )}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: fontSize.xl,
    fontWeight: fontWeight.bold,
    color: colors.text,
    letterSpacing: -0.3,
  },
  action: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.brand,
  },
});
