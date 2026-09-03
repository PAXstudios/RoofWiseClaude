import { useMemo, useState } from 'react';
import {
  ScrollView,
  View,
  Text,
  Pressable,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { PressableScale } from '@/components/PressableScale';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { ROOF_MATERIAL_LABELS, type InspectionStatus } from '@/lib/models/types';
import { CLAIM_VIABILITY_LABELS } from '@/lib/services/decisionEngine';
import { resolveEngineResult } from '@/lib/services/storedEngine';
import { summarizeInspection } from '@/components/DamageDetailSection';
import { RichCard } from '@/components/ui/RichCard';
import { IconChip, type ChipTone, type IoniconName } from '@/components/ui/IconChip';
import { Pill, type PillTone } from '@/components/ui/Pill';
import {
  colors,
  fontSize,
  fontWeight,
  motion,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STATUSES: { id: 'all' | InspectionStatus; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'in_progress', label: 'In progress' },
  { id: 'scheduled', label: 'Scheduled' },
  { id: 'complete', label: 'Complete' },
  { id: 'lead', label: 'Lead' },
];

/**
 * Per-status chrome — icon, chip colour, and pill tone all keyed off the
 * SAME status, so the leading chip and the trailing badge always agree
 * (craft rule: shared colour between a chip and its data). Mirrors the
 * PillTone map Home already ships for this exact status set.
 */
const STATUS_META: Record<
  InspectionStatus,
  { icon: IoniconName; chipTone: ChipTone; pillTone: PillTone }
> = {
  lead: { icon: 'flag-outline', chipTone: 'quiet', pillTone: 'neutral' },
  scheduled: { icon: 'calendar-outline', chipTone: 'blue', pillTone: 'info' },
  in_progress: { icon: 'construct-outline', chipTone: 'orange', pillTone: 'warn' },
  complete: { icon: 'checkmark-circle-outline', chipTone: 'green', pillTone: 'success' },
};

export default function InspectionsList() {
  const router = useRouter();
  const inspections = useInspectionStore((s) => s.inspections);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]['id']>('all');

  const filtered = useMemo(() => {
    let out = inspections;
    if (status !== 'all') out = out.filter((i) => i.status === status);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      out = out.filter(
        (i) =>
          i.customerName.toLowerCase().includes(q) ||
          i.address.toLowerCase().includes(q) ||
          i.reportId.toLowerCase().includes(q),
      );
    }
    return out;
  }, [inspections, status, search]);

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={24} color={colors.text} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Inspections</Text>
          <Text style={styles.sub}>{inspections.length} total</Text>
        </View>
        <PressableScale
          style={styles.fab}
          accessibilityLabel="New job"
          onPress={() => router.push('/new-job')}
        >
          <Ionicons name="add" size={26} color={colors.textInverse} />
        </PressableScale>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.textSubtle} />
        <TextInput
          style={styles.searchInput}
          value={search}
          onChangeText={setSearch}
          placeholder="Search name, address, or report ID"
          placeholderTextColor={colors.textSubtle}
          autoCorrect={false}
        />
        {search.length > 0 && (
          <Pressable onPress={() => setSearch('')} hitSlop={10}>
            <Ionicons name="close-circle" size={18} color={colors.textSubtle} />
          </Pressable>
        )}
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {STATUSES.map((s) => (
          <Pressable key={s.id} style={styles.chipHit} onPress={() => setStatus(s.id)}>
            <View style={[styles.chip, status === s.id && styles.chipActive]}>
              <Text style={[styles.chipText, status === s.id && styles.chipTextActive]}>
                {s.label}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.length === 0 ? (
          // Compact, top-anchored, honest — a setup panel, never a centered void.
          <Animated.View entering={FadeInDown.duration(motion.enterMs)} style={styles.empty}>
            <IconChip name="briefcase-outline" tone="quiet" size="md" />
            <Text style={styles.emptyTitle}>
              {inspections.length === 0 ? 'No inspections yet' : 'No matches'}
            </Text>
            <Text style={styles.emptyBody}>
              {inspections.length === 0
                ? 'Create your first inspection from a New Job.'
                : 'Adjust the filter or search.'}
            </Text>
            {inspections.length === 0 ? (
              <PressableScale style={styles.emptyBtn} onPress={() => router.push('/new-job')}>
                <Text style={styles.emptyBtnText}>New Job</Text>
              </PressableScale>
            ) : (
              <PressableScale
                style={styles.emptyBtn}
                onPress={() => {
                  setSearch('');
                  setStatus('all');
                }}
              >
                <Text style={styles.emptyBtnText}>Clear filters</Text>
              </PressableScale>
            )}
          </Animated.View>
        ) : (
          <Animated.View entering={FadeInDown.duration(motion.enterMs)} style={styles.list}>
            {filtered.map((ins) => {
              // Same read path as the job screen: the stored determination when
              // it still speaks for the current inputs. Showing the deprecated
              // 0-100 score here would put a different number next to the same
              // roof. `honorFreeze: false` for the same reason the job screen
              // uses it — a list of jobs describes them as they stand, not as a
              // report signed before the last edit described them.
              const { haag, decision } = resolveEngineResult(ins, Date.now(), {
                honorFreeze: false,
              });
              // A fresh job has no verdict — the engine returns one anyway,
              // and "Medium · Repair" on an unphotographed roof is invented
              // (Drift #5). Same gate the job screen applies.
              const hasEvidence = summarizeInspection(ins).analyzedPhotos > 0;
              const verdictLine = hasEvidence
                ? `${CLAIM_VIABILITY_LABELS[haag.claim_viability]} · ${decision.roofRecommendation.replace(/_/g, ' ')}`
                : 'Not assessed — analyze photos';
              const meta = STATUS_META[ins.status];
              const statusLabel = ins.status.replace(/_/g, ' ');
              return (
                <RichCard
                  key={ins.id}
                  onPress={() => router.push(`/job/${ins.id}` as any)}
                  icon={meta.icon}
                  iconTone={meta.chipTone}
                  title={ins.customerName}
                  subtitle={ins.address}
                  headerTrailing={<Pill label={statusLabel} tone={meta.pillTone} size="sm" />}
                  chevron
                  footer={
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {ins.reportId} · {ROOF_MATERIAL_LABELS[ins.material]} · {ins.ageYears}yr
                      {' · '}
                      {verdictLine}
                    </Text>
                  }
                  accessibilityLabel={`${ins.customerName}, ${ins.address}, ${statusLabel}. ${ins.reportId}.`}
                />
              );
            })}
          </Animated.View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  // Sub-screen inline bar: plain chevron, 17/semibold, hairline underline.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    gap: spacing.md,
    backgroundColor: colors.barFill,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.hairline,
  },
  headerBtn: {
    width: touchTarget.small,
    height: touchTarget.small,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold, color: colors.text },
  sub: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
  // Royal — the primary-interactive brand hue (FAB).
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.brand,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.float,
  },

  // iOS search field: quiet grey fill, no border.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.lg,
    marginTop: spacing.md,
    paddingHorizontal: spacing.md,
    height: touchTarget.standard,
    backgroundColor: colors.fillQuiet,
    borderRadius: radii.control,
  },
  searchInput: { flex: 1, fontSize: fontSize.bodyMd, color: colors.text },

  chipScroll: { maxHeight: touchTarget.standard, marginTop: spacing.xs, flexGrow: 0 },
  chipScrollContent: { paddingHorizontal: spacing.lg, alignItems: 'center' },
  // 56pt hit area wrapping a compact 36pt visual pill — glove target, iOS look.
  chipHit: {
    height: touchTarget.standard,
    justifyContent: 'center',
    paddingRight: spacing.sm,
  },
  chip: {
    height: 36,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.fillQuiet,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.brand },
  chipText: { fontSize: fontSize.bodySm, color: colors.text, fontWeight: fontWeight.semibold },
  chipTextActive: { color: colors.textInverse },

  content: { padding: spacing.lg, paddingTop: spacing.sm, paddingBottom: spacing.xxxl },

  // Individually crafted cards, not a continuous grouped list — that
  // continuous-hairline pattern is exactly the "iOS Settings" look this pass
  // exists to leave behind.
  list: { gap: spacing.md },

  rowMeta: {
    fontSize: fontSize.caption,
    color: colors.textSubtle,
    textTransform: 'capitalize',
    fontVariant: ['tabular-nums'],
  },

  // Compact top-anchored empty state — no tinted circle, one button.
  empty: {
    alignItems: 'flex-start',
    gap: spacing.sm,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.xs,
  },
  emptyTitle: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
  emptyBody: { fontSize: fontSize.bodySm, color: colors.textMuted },
  emptyBtn: {
    minHeight: touchTarget.standard,
    paddingHorizontal: spacing.xl,
    borderRadius: radii.button,
    backgroundColor: colors.fillQuiet,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xs,
  },
  emptyBtnText: { fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold, color: colors.text },
});
