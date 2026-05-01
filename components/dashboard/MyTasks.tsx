import { View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card } from '@/components/ui/Card';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { tasks } from '@/lib/mock/tasks';
import { colors, fontSize, fontWeight, radii, spacing } from '@/theme/tokens';

export function MyTasks() {
  return (
    <View style={styles.section}>
      <View style={{ paddingHorizontal: spacing.lg }}>
        <SectionHeader title="My Tasks" action="Add task" />
      </View>
      <Card style={styles.card}>
        {tasks.map((t, idx) => (
          <View
            key={t.id}
            style={[
              styles.row,
              idx < tasks.length - 1 && styles.rowDivider,
            ]}
          >
            <Pressable style={[styles.check, t.done && styles.checkOn]}>
              {t.done && <Ionicons name="checkmark" size={14} color={colors.surface} />}
            </Pressable>
            <View style={{ flex: 1 }}>
              <Text style={[styles.title, t.done && styles.titleDone]}>{t.title}</Text>
              {t.context && <Text style={styles.context}>{t.context}</Text>}
            </View>
            <View style={styles.due}>
              <Text style={styles.dueLabel}>{t.due}</Text>
            </View>
          </View>
        ))}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginBottom: spacing.lg },
  card: { marginHorizontal: spacing.lg, paddingVertical: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  rowDivider: {
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  check: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkOn: {
    backgroundColor: colors.success,
    borderColor: colors.success,
  },
  title: {
    fontSize: fontSize.sm,
    fontWeight: fontWeight.semibold,
    color: colors.text,
  },
  titleDone: {
    color: colors.textMuted,
    textDecorationLine: 'line-through',
  },
  context: {
    fontSize: fontSize.xs,
    color: colors.textMuted,
    marginTop: 2,
  },
  due: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  dueLabel: {
    fontSize: fontSize.xs,
    fontWeight: fontWeight.semibold,
    color: colors.textMuted,
  },
});
