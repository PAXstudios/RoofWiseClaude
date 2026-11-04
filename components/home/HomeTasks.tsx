import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter, type Href } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import type { Inspection, Task } from '@/lib/models/types';
import type { PipelineItem } from '@/lib/services/pipeline';
import { SectionHeader } from '@/components/ui/SectionHeader';
import { PressableScale } from '@/components/PressableScale';
import { colors, fontFamily, fontSize, radii, spacing, touchTarget } from '@/theme/tokens';
import { EmptyHomeSection } from './EmptyHomeSection';

const PREVIEW_COUNT = 3;

type Props = {
  tasks: readonly Task[];
  items: readonly PipelineItem[];
  inspections: readonly Inspection[];
};

export function HomeTasks({ tasks, items, inspections }: Props) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const rows = useMemo(() => {
    const owners = new Map<string, { name: string; href: Href }>();
    for (const item of items) {
      if (!item.leadId) continue;
      owners.set(item.leadId, {
        name: item.customerName || item.address,
        href: item.inspectionId
          ? { pathname: '/job/[id]', params: { id: item.inspectionId, tab: 'tasks' } }
          : { pathname: '/lead/[id]', params: { id: item.leadId } },
      });
    }
    // A pipeline card can represent several inspections. A task filed against
    // a specific inspection must open that exact job, including older visits.
    for (const inspection of inspections) {
      owners.set(inspection.id, {
        name: inspection.customerName || inspection.address,
        href: { pathname: '/job/[id]', params: { id: inspection.id, tab: 'tasks' } },
      });
    }
    return tasks.flatMap((task) => {
      const owner = owners.get(task.itemId);
      if (task.done || !owner) return [];
      const due = task.dueAt ? Date.parse(task.dueAt) : NaN;
      return [{ task, owner, due: Number.isFinite(due) ? due : Infinity }];
    }).sort((a, b) => a.due - b.due || a.task.order - b.task.order || a.task.createdAt.localeCompare(b.task.createdAt));
  }, [tasks, items, inspections]);

  if (rows.length === 0) {
    return <EmptyHomeSection title="Tasks" message="No open tasks. Add a task from a job or lead." />;
  }

  return (
    <View>
      <SectionHeader title="Tasks" style={styles.header}
        action={rows.length > PREVIEW_COUNT ? {
          label: expanded ? 'Show less' : `Show all (${rows.length})`,
          onPress: () => setExpanded((value) => !value),
        } : undefined}
      />
      <View style={styles.card}>
        {(expanded ? rows : rows.slice(0, PREVIEW_COUNT)).map(({ task, owner, due }, index) => (
          <PressableScale key={task.id} style={[styles.row, index > 0 && styles.border]}
            accessibilityRole="button"
            onPress={() => router.push(owner.href)}
          >
            <Ionicons name="list-outline" size={20} color={colors.brand} />
            <View style={styles.copy}>
              <Text style={styles.title}>{task.title}</Text>
              <Text style={styles.subtitle}>
                {[owner.name, Number.isFinite(due) && `Due ${new Date(due).toLocaleDateString()}`].filter(Boolean).join(' · ')}
              </Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textSubtle} />
          </PressableScale>
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  header: { marginBottom: spacing.sm },
  card: { borderRadius: radii.card, overflow: 'hidden', borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border, backgroundColor: colors.surface },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, minHeight: touchTarget.standard, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm },
  border: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  copy: { flex: 1, gap: spacing.xs },
  title: { color: colors.text, fontFamily: fontFamily.archivo.semibold, fontSize: fontSize.bodyMd },
  subtitle: { color: colors.textMuted, fontFamily: fontFamily.archivo.regular, fontSize: fontSize.bodySm },
});
