// Tasks tab — mounts the pipeline wave's TasksCard, scoped to this job's
// pipeline item(s). `components/pipeline/TasksCard.tsx` landed during this
// integration (it did not exist when this wave started — see PROMPT_LOG/the
// wave report), so this tab is wired in for real rather than left stubbed.
//
// A linked lead+job pair is ONE pipeline item (docs/PIPELINE.md): tasks are
// read for BOTH ids (`itemIds`) so nothing added on either side of the chain
// goes missing, and a NEW task is filed under the lead's id when there is
// one — matching taskStore.ts's own convention — else the job's own id.

import { ScrollView, StyleSheet, View } from 'react-native';
import { TasksCard } from '@/components/pipeline/TasksCard';
import { SectionHeader } from '@/components/ui/SectionHeader';
import type { Inspection, Lead } from '@/lib/models/types';
import { spacing } from '@/theme/tokens';

type Props = {
  inspection: Inspection;
  linkedLead?: Lead;
};

export function TasksTab({ inspection, linkedLead }: Props) {
  return (
    <ScrollView style={styles.flex} contentContainerStyle={styles.scroll}>
      <SectionHeader title="Tasks" />
      <View>
        <TasksCard itemIds={[linkedLead?.id, inspection.id]} addToItemId={linkedLead?.id ?? inspection.id} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  scroll: { padding: spacing.lg, paddingBottom: spacing.xxxl, gap: spacing.md },
});
