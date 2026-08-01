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
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { ROOF_MATERIAL_LABELS, type InspectionStatus } from '@/lib/models/types';
import { damageScore, evaluate } from '@/lib/services/decisionEngine';
import {
  colors,
  fontSize,
  fontWeight,
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
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Inspections</Text>
          <Text style={styles.sub}>{inspections.length} total</Text>
        </View>
        <Pressable style={styles.fab} onPress={() => router.push('/new-job')}>
          <Ionicons name="add" size={24} color={colors.textInverse} />
        </Pressable>
      </View>

      <View style={styles.searchRow}>
        <Ionicons name="search" size={18} color={colors.slate} />
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
            <Ionicons name="close-circle" size={18} color={colors.slate} />
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
          <Pressable
            key={s.id}
            style={[styles.chip, status === s.id && styles.chipActive]}
            onPress={() => setStatus(s.id)}
          >
            <Text style={[styles.chipText, status === s.id && styles.chipTextActive]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        {filtered.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="briefcase-outline" size={36} color={colors.slate} />
            <Text style={styles.emptyTitle}>
              {inspections.length === 0
                ? 'No inspections yet'
                : 'No matches'}
            </Text>
            <Text style={styles.emptyBody}>
              {inspections.length === 0
                ? 'Create your first inspection from a New Job.'
                : 'Adjust the filter or search.'}
            </Text>
          </View>
        ) : (
          filtered.map((ins) => {
            const decision = evaluate(ins);
            const score = damageScore(ins);
            return (
              <Pressable
                key={ins.id}
                style={styles.jobCard}
                onPress={() => router.push(`/job/${ins.id}` as any)}
              >
                <View style={styles.jobHeader}>
                  <Text style={styles.jobReport}>{ins.reportId}</Text>
                  <View style={[styles.statusPill, statusTone(ins.status)]}>
                    <Text style={styles.statusPillText}>
                      {ins.status.replace(/_/g, ' ')}
                    </Text>
                  </View>
                </View>
                <Text style={styles.jobName}>{ins.customerName}</Text>
                <Text style={styles.jobAddress} numberOfLines={1}>
                  {ins.address}
                </Text>
                <View style={styles.jobStats}>
                  <Text style={styles.jobStat}>{ROOF_MATERIAL_LABELS[ins.material]}</Text>
                  <Text style={styles.jobStat}>· {ins.ageYears}yr</Text>
                  <Text style={styles.jobStat}>· Damage {score}</Text>
                  <Text style={styles.jobStat}>· {decision.roofRecommendation.replace(/_/g, ' ')}</Text>
                </View>
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function statusTone(status: InspectionStatus) {
  switch (status) {
    case 'complete':
      return { backgroundColor: colors.successSoft };
    case 'in_progress':
      return { backgroundColor: colors.accentSoft };
    case 'scheduled':
      return { backgroundColor: colors.brandSoft };
    default:
      return { backgroundColor: colors.surfaceMuted };
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  title: { fontSize: fontSize.titleXl, fontWeight: fontWeight.bold, color: colors.navy },
  sub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2 },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },

  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.xl,
    paddingHorizontal: spacing.md,
    height: touchTarget.standard,
    backgroundColor: colors.surface,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, fontSize: fontSize.bodyMd, color: colors.navy },

  chipScroll: { maxHeight: 56, marginTop: spacing.sm },
  chipScrollContent: { paddingHorizontal: spacing.xl, gap: spacing.sm },
  chip: {
    minHeight: touchTarget.small,
    paddingHorizontal: spacing.lg,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
  },
  chipActive: { backgroundColor: colors.navy, borderColor: colors.navy },
  chipText: { fontSize: fontSize.bodySm, color: colors.navy, fontWeight: fontWeight.medium },
  chipTextActive: { color: colors.textInverse },

  content: { padding: spacing.xl, gap: spacing.md, paddingBottom: spacing.xxxl },

  jobCard: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  jobHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  jobReport: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.semibold },
  jobName: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  jobAddress: { fontSize: fontSize.bodySm, color: colors.slate },
  jobStats: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  jobStat: { fontSize: fontSize.caption, color: colors.slate, textTransform: 'capitalize' },

  statusPill: { paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radii.pill },
  statusPillText: { fontSize: fontSize.caption, color: colors.navy, fontWeight: fontWeight.semibold, textTransform: 'capitalize' },

  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, marginTop: spacing.sm },
  emptyBody: { fontSize: fontSize.bodyMd, color: colors.slate, textAlign: 'center' },
});
