import { ScrollView, View, Text, Pressable, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { useRouter } from 'expo-router';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

const STAGES = [
  { id: 'all', label: 'All' },
  { id: 'new', label: 'New' },
  { id: 'contacted', label: 'Contacted' },
  { id: 'inspection_scheduled', label: 'Scheduled' },
  { id: 'inspected', label: 'Inspected' },
  { id: 'proposal_sent', label: 'Proposal' },
  { id: 'signed', label: 'Signed' },
] as const;

export default function LeadsScreen() {
  const router = useRouter();
  const [stage, setStage] = useState<(typeof STAGES)[number]['id']>('all');

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Leads</Text>
        <Pressable style={styles.fab} onPress={() => router.push('/new-job')} hitSlop={8}>
          <Ionicons name="add" size={24} color={colors.textInverse} />
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipScroll}
        contentContainerStyle={styles.chipScrollContent}
      >
        {STAGES.map((s) => (
          <Pressable
            key={s.id}
            style={[styles.chip, stage === s.id && styles.chipActive]}
            onPress={() => setStage(s.id)}
          >
            <Text style={[styles.chipText, stage === s.id && styles.chipTextActive]}>
              {s.label}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.empty}>
          <Ionicons name="people-outline" size={40} color={colors.slate} />
          <Text style={styles.emptyTitle}>No leads yet</Text>
          <Text style={styles.emptyBody}>
            Leads created from door knocks, inspections, or manually will appear here.
          </Text>
          <Pressable style={styles.cta} onPress={() => router.push('/new-job')}>
            <Text style={styles.ctaText}>Start a new job</Text>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.xl,
    paddingBottom: spacing.md,
  },
  title: {
    flex: 1,
    fontSize: fontSize.titleXl,
    fontWeight: fontWeight.bold,
    color: colors.navy,
  },
  fab: {
    width: touchTarget.standard,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadows.card,
  },

  chipScroll: { maxHeight: 56 },
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

  content: { padding: spacing.xl, paddingBottom: spacing.xxxl },
  empty: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.xxl,
    alignItems: 'center',
    gap: spacing.sm,
    ...shadows.card,
  },
  emptyTitle: {
    fontSize: fontSize.titleSm,
    fontWeight: fontWeight.semibold,
    color: colors.navy,
    marginTop: spacing.sm,
  },
  emptyBody: {
    fontSize: fontSize.bodyMd,
    color: colors.slate,
    textAlign: 'center',
  },
  cta: {
    marginTop: spacing.lg,
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },
});
