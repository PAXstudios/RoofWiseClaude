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
import { useLeadStore } from '@/lib/stores/leadStore';
import { colors, fontSize, fontWeight, radii, spacing, touchTarget } from '@/theme/tokens';

export type AddPhotosChoice =
  | { kind: 'new_customer' }
  | { kind: 'existing'; inspectionId: string }
  /** A pipeline lead with no job yet — the capture starts one (docs/PIPELINE.md §3). */
  | { kind: 'lead'; leadId: string }
  | { kind: 'later' };

type Props = {
  visible: boolean;
  onChoose: (choice: AddPhotosChoice) => void;
  onCancel: () => void;
};

type PickingMode = 'jobs' | 'leads' | null;

export function AddPhotosToSheet({ visible, onChoose, onCancel }: Props) {
  const inspections = useInspectionStore((s) => s.inspections);
  const leads = useLeadStore((s) => s.leads);
  const [picking, setPicking] = useState<PickingMode>(null);
  const [query, setQuery] = useState('');

  const openJobs = useMemo(() => inspections.filter((i) => i.status !== 'complete'), [inspections]);
  // Leads with no job yet — a lead already converted shows up as "Existing
  // Customer" instead (docs/PIPELINE.md: one item, never two entry points).
  const openLeads = useMemo(() => leads.filter((l) => !l.inspectionId), [leads]);

  const jobCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? openJobs.filter((i) => `${i.customerName} ${i.address}`.toLowerCase().includes(q)) : openJobs;
    return list.slice(0, 30);
  }, [openJobs, query]);

  const leadCandidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? openLeads.filter((l) => `${l.customerName} ${l.address}`.toLowerCase().includes(q)) : openLeads;
    return list.slice(0, 30);
  }, [openLeads, query]);

  const close = () => {
    setPicking(null);
    setQuery('');
    onCancel();
  };

  const title = picking === 'jobs' ? 'Which customer?' : picking === 'leads' ? 'Which lead?' : 'Add Photos To…';
  const subtitle =
    picking === 'jobs'
      ? `${jobCandidates.length} open job${jobCandidates.length === 1 ? '' : 's'} in your pipeline.`
      : picking === 'leads'
      ? `${leadCandidates.length} lead${leadCandidates.length === 1 ? '' : 's'} with no job yet.`
      : "Choose where this inspection's photos and findings should be saved.";

  return (
    <BottomSheet visible={visible} onClose={close} title={title} subtitle={subtitle} accessibilityLabel="Add photos to">
      {picking === null ? (
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
            badge={String(openJobs.length)}
            sub="Add photos to a customer already in your pipeline."
            onPress={() => setPicking('jobs')}
          />
          <Option
            icon="thunderstorm-outline"
            tone="purple"
            title="Existing Lead"
            badge={String(openLeads.length)}
            sub="Start the job for a lead that hasn't been inspected yet."
            onPress={() => setPicking('leads')}
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
      ) : picking === 'jobs' ? (
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
            {jobCandidates.length === 0 ? (
              <Text style={styles.empty}>
                {openJobs.length === 0 ? 'No jobs yet — start with New Customer.' : 'No open job matches that.'}
              </Text>
            ) : (
              jobCandidates.map((ins) => (
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
          <PressableScale style={styles.back} onPress={() => setPicking(null)} accessibilityRole="button">
            <Ionicons name="chevron-back" size={18} color={colors.text} />
            <Text style={styles.backText}>Back</Text>
          </PressableScale>
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
            {leadCandidates.length === 0 ? (
              <Text style={styles.empty}>
                {openLeads.length === 0 ? 'No leads without a job yet.' : 'No lead matches that.'}
              </Text>
            ) : (
              leadCandidates.map((lead) => (
                <PressableScale
                  key={lead.id}
                  style={styles.row}
                  accessibilityRole="button"
                  accessibilityLabel={`${lead.customerName}, ${lead.address}`}
                  onPress={() => onChoose({ kind: 'lead', leadId: lead.id })}
                >
                  <IconChip name="person-outline" tone="purple" size="sm" />
                  <View style={styles.rowMain}>
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {lead.customerName}
                    </Text>
                    <Text style={styles.rowSub} numberOfLines={1}>
                      {lead.address}
                    </Text>
                  </View>
                  <Ionicons name="chevron-forward" size={18} color={colors.textSubtle} />
                </PressableScale>
              ))
            )}
          </ScrollView>
          <PressableScale style={styles.back} onPress={() => setPicking(null)} accessibilityRole="button">
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
