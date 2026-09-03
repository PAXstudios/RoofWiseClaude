// The compact hero's stage pill opens this — "move the pipeline stage the
// way the screenshots' 'Proposal Sent ⌄' does". Presentational only: the
// caller (app/job/[id].tsx) decides whether the rows are the linked lead's
// LeadStage ladder or, for a job with no lead, the job's own InspectionStatus
// — either way this sheet just lists rows and reports which one was tapped.

import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { colors, fontSize, fontWeight, spacing, touchTarget } from '@/theme/tokens';

export type StageRow = {
  key: string;
  label: string;
  icon: IoniconName;
  tone: ChipTone;
  /** One line under the label — what picking this row does. */
  sub?: string;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  rows: readonly StageRow[];
  current: string;
  onPick: (key: string) => void;
};

export function StageSheet({ visible, onClose, title, subtitle, rows, current, onPick }: Props) {
  return (
    <BottomSheet visible={visible} onClose={onClose} title={title} subtitle={subtitle} accessibilityLabel={title}>
      <View style={styles.list}>
        {rows.map((row) => {
          const active = row.key === current;
          return (
            <PressableScale
              key={row.key}
              style={[styles.row, active && styles.rowActive]}
              onPress={() => {
                onClose();
                if (!active) onPick(row.key);
              }}
              accessibilityRole="button"
              accessibilityLabel={row.label}
              accessibilityState={{ selected: active }}
            >
              <IconChip name={row.icon} tone={row.tone} size="sm" />
              <View style={styles.rowBody}>
                <Text style={styles.rowLabel}>{row.label}</Text>
                {row.sub ? (
                  <Text style={styles.rowSub} numberOfLines={1}>
                    {row.sub}
                  </Text>
                ) : null}
              </View>
              {active && <Ionicons name="checkmark-circle" size={22} color={colors.brand} />}
            </PressableScale>
          );
        })}
      </View>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  list: { gap: spacing.xs, paddingBottom: spacing.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.md,
    borderRadius: 14,
  },
  rowActive: { backgroundColor: colors.fillQuiet },
  rowBody: { flex: 1 },
  rowLabel: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted, marginTop: 1 },
});
