// "Add Photos To…" — asked before a standalone capture starts.
//
// A photo has to belong to somebody. Until now, opening the camera from Home
// silently created a job called "Quick inspection" at "Address pending" on the
// first shutter, and the roofer found it later with no name. This sheet asks
// first: a new customer (the job wizard, then the camera), one already in the
// pipeline (pick, then the camera attaches to it), or capture now and attach
// later — an explicit choice, never a silent placeholder.

import { useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { PressableScale } from '@/components/PressableScale';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill } from '@/components/ui/Pill';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type AddPhotosChoice =
  | { kind: 'new_customer' }
  | { kind: 'existing'; inspectionId: string }
  | { kind: 'later' };

type Props = {
  visible: boolean;
  onChoose: (choice: AddPhotosChoice) => void;
  onCancel: () => void;
};

export function AddPhotosToSheet({ visible, onChoose, onCancel }: Props) {
  const inspections = useInspectionStore((s) => s.inspections);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState('');

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const open = inspections.filter((i) => i.status !== 'complete');
    const list = q
      ? open.filter((i) => `${i.customerName} ${i.address}`.toLowerCase().includes(q))
      : open;
    return list.slice(0, 30);
  }, [inspections, query]);

  const close = () => {
    setPicking(false);
    setQuery('');
    onCancel();
  };

  return (
    <BottomSheet
      visible={visible}
      onClose={close}
      title={picking ? 'Which customer?' : 'Add Photos To…'}
      subtitle={
        picking
          ? `${candidates.length} open job${candidates.length === 1 ? '' : 's'} in your pipeline.`
          : "Choose where this inspection's photos and findings should be saved."
      }
      accessibilityLabel="Add photos to"
    >
      {!picking ? (
        <View style={styles.options}>
          <Option
            icon="person-add-outline"
            tone="blue"
            title="New Customer"
            sub="Create a customer profile, then capture photos."
            onPress={() => onChoose({ kind: 'new_customer' })}
          />
          <Option
            icon="people-outline"
            tone="green"
            title="Existing Customer"
            badge={String(inspections.filter((i) => i.status !== 'complete').length)}
            sub="Add photos to a customer already in your pipeline."
            onPress={() => setPicking(true)}
          />
          <Option
            icon="download-outline"
            tone="orange"
            title="Save Without Customer"
            tag="LATER"
            sub="Capture now, attach a property later."
            onPress={() => onChoose({ kind: 'later' })}
          />
        </View>
      ) : (
        <View style={styles.picker}>
          <View style={styles.search}>
            <Ionicons name="search" size={18} color={colors.textSubtle} />
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Name or address"
              placeholderTextColor={colors.textSubtle}
              style={styles.searchInput}
              autoFocus
              autoCorrect={false}
            />
          </View>
          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {candidates.length === 0 ? (
              <Text style={styles.empty}>
                {inspections.length === 0
                  ? 'No jobs yet — start with New Customer.'
                  : 'No open job matches that.'}
              </Text>
            ) : (
              candidates.map((ins) => (
                <PressableScale
                  key={ins.id}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={`${ins.customerName}, ${ins.address}`}
                  onPress={() => onChoose({ kind: 'existing', inspectionId: ins.id })}
                >
                  <IconChip name="home-outline" tone="blue" size="sm" />
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {ins.customerName}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {ins.address} · {ins.reportId}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </PressableScale>
              ))
            )}
          </ScrollView>
          <PressableScale style={styles.back} onPress={() => setPicking(false)} accessibilityRole="button">
            <Ionicons name="chevron-back" size={18} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </PressableScale>
        </View>
      )}
    </BottomSheet>
  );
}

function Option({
  icon,
  tone,
  title,
  sub,
  badge,
  tag,
  onPress,
}: {
  icon: IoniconName;
  tone: ChipTone;
  title: string;
  sub: string;
  badge?: string;
  tag?: string;
  onPress: () => void;
}) {
  return (
    <PressableScale style={styles.option} onPress={onPress} accessibilityRole="button" accessibilityLabel={`${title}. ${sub}`}>
      <IconChip name={icon} tone={tone} size="md" />
      <View style={styles.optionMain}>
        <View style={styles.optionTitleRow}>
          <Text style={styles.optionTitle}>{title}</Text>
          {badge != null && <Pill label={badge} tone="success" size="sm" />}
          {tag && <Pill label={tag} tone="warn" size="sm" />}
        </View>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <Ionicons name="chevron-forward" size={20} color={colors.textSubtle} />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  options: { gap: spacing.md },
  // 88pt cards — the sticky-CTA height, the easiest thing to hit on a roof.
  option: {
    minHeight: touchTarget.sticky,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    padding: spacing.lg,
    borderRadius: radii.card,
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.hairline,
  },
  optionMain: { flex: 1, gap: 2 },
  optionTitleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  optionTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.brand },
  optionSub: { fontSize: fontSize.bodyMd, color: colors.textMuted, lineHeight: 20 },
  picker: { gap: spacing.md, maxHeight: 460 },
  search: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
  },
  searchInput: { flex: 1, fontSize: fontSize.bodyLg, color: colors.text, paddingVertical: spacing.sm },
  list: { flexGrow: 0 },
  row: {
    minHeight: touchTarget.standard,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  rowMain: { flex: 1, gap: 2 },
  rowTitle: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  rowSub: { fontSize: fontSize.bodySm, color: colors.textMuted },
  empty: { fontSize: fontSize.bodyMd, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  back: { minHeight: touchTarget.standard, flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  backText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
});
