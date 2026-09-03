// Tasks on a pipeline item — the job/lead pages mount this. 56pt checkboxes
// (Drift #1: a gloved thumb), an add row, and a due chip that goes amber
// once a task is overdue. Reads/writes `lib/stores/taskStore.ts` directly —
// no local state beyond the draft text field.

import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PressableScale } from '@/components/PressableScale';
import { useTaskStore } from '@/lib/stores/taskStore';
import type { Task } from '@/lib/models/types';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

type Props = {
  /** Every id this item answers to — a linked lead+job shares one list. */
  itemIds: readonly (string | undefined)[];
  /** Which id a newly added task is filed under (the lead id when there is one). */
  addToItemId: string;
  /** Hide the add row — a read-only summary context. Default false. */
  readOnly?: boolean;
};

export function TasksCard({ itemIds, addToItemId, readOnly }: Props) {
  const tasks = useTaskStore((s) => s.forItems(itemIds));
  const add = useTaskStore((s) => s.add);
  const toggle = useTaskStore((s) => s.toggle);
  const remove = useTaskStore((s) => s.remove);
  const [draft, setDraft] = useState('');

  const commit = () => {
    const title = draft.trim();
    if (!title) return;
    add({ itemId: addToItemId, title });
    setDraft('');
    Haptics.selectionAsync().catch(() => {});
  };

  if (tasks.length === 0 && readOnly) return null;

  return (
    <View style={styles.card}>
      {tasks.map((t, i) => (
        <TaskRow
          key={t.id}
          task={t}
          bordered={i > 0}
          onToggle={() => {
            toggle(t.id);
            Haptics.selectionAsync().catch(() => {});
          }}
          onRemove={() => remove(t.id)}
        />
      ))}
      {!readOnly && (
        <View style={[styles.addRow, tasks.length > 0 && styles.rowBorder]}>
          <Ionicons name="add-circle-outline" size={22} color={colors.textSubtle} />
          <TextInput
            style={styles.addInput}
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={commit}
            onBlur={commit}
            placeholder="Add a task"
            placeholderTextColor={colors.textSubtle}
            returnKeyType="done"
            accessibilityLabel="Add a task"
          />
        </View>
      )}
      {tasks.length === 0 && readOnly === undefined && (
        <Text style={styles.empty}>No tasks yet.</Text>
      )}
    </View>
  );
}

function TaskRow({
  task,
  bordered,
  onToggle,
  onRemove,
}: {
  task: Task;
  bordered: boolean;
  onToggle: () => void;
  onRemove: () => void;
}) {
  const overdue = !task.done && !!task.dueAt && new Date(task.dueAt).getTime() <= Date.now();
  return (
    <View style={[styles.row, bordered && styles.rowBorder]}>
      <PressableScale
        style={[styles.check, task.done && styles.checkDone]}
        pressedScale={0.9}
        onPress={onToggle}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: task.done }}
        accessibilityLabel={task.title}
        hitSlop={4}
      >
        {task.done && <Ionicons name="checkmark" size={18} color={colors.textInverse} />}
      </PressableScale>
      <View style={styles.rowBody}>
        <Text style={[styles.title, task.done && styles.titleDone]} numberOfLines={2}>
          {task.title}
        </Text>
        {task.dueAt && !task.done && (
          <Text style={[styles.due, overdue && styles.dueOverdue]}>
            {overdue ? 'Overdue' : 'Due'} {formatDue(task.dueAt)}
          </Text>
        )}
        {task.createdBy === 'automation' && (
          <Text style={styles.autoTag}>Added automatically</Text>
        )}
      </View>
      <PressableScale
        style={styles.remove}
        pressedScale={0.9}
        onPress={onRemove}
        accessibilityRole="button"
        accessibilityLabel={`Remove task ${task.title}`}
        hitSlop={8}
      >
        <Ionicons name="close" size={18} color={colors.textSubtle} />
      </PressableScale>
    </View>
  );
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.hairline },
  // 28pt visual box inside a 56pt row — Drift #1's target is the whole row height.
  check: {
    width: 28,
    height: 28,
    borderRadius: radii.control,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkDone: { backgroundColor: colors.success, borderColor: colors.success },
  rowBody: { flex: 1, gap: 2 },
  title: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  titleDone: { color: colors.textMuted, textDecorationLine: 'line-through' },
  due: { fontSize: fontSize.caption, color: colors.textMuted, fontVariant: ['tabular-nums'] },
  dueOverdue: { color: colors.danger, fontWeight: fontWeight.semibold },
  autoTag: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    fontStyle: 'italic',
  },
  remove: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.lg,
  },
  addInput: {
    flex: 1,
    fontSize: fontSize.bodyMd,
    color: colors.text,
    paddingVertical: spacing.sm,
  },
  empty: {
    fontSize: fontSize.bodySm,
    color: colors.textSubtle,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
});
