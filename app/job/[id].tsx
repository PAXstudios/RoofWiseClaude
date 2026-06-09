import { ScrollView, View, Text, Pressable, StyleSheet, Alert } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import {
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
} from '@/lib/models/types';
import {
  CLAIM_WORTHINESS_LABELS,
  claimWorthiness,
  damageScore,
  evaluate,
} from '@/lib/services/decisionEngine';
import {
  colors,
  fontSize,
  fontWeight,
  radii,
  shadows,
  spacing,
  touchTarget,
} from '@/theme/tokens';

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspectionStore((s) => s.inspections.find((i) => i.id === id));
  const remove = useInspectionStore((s) => s.remove);

  if (!inspection) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyTitle}>Job not found</Text>
          <Pressable style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const decision = evaluate(inspection);
  const score = damageScore(inspection);
  const worthiness = claimWorthiness(decision, score);

  const onDelete = () => {
    Alert.alert(
      'Delete job?',
      `${inspection.reportId} will be permanently removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => {
          remove(inspection.id);
          router.replace('/(tabs)');
        } },
      ],
    );
  };

  return (
    <SafeAreaView style={styles.root} edges={['top']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportId}>{inspection.reportId}</Text>
          <Text style={styles.customer}>{inspection.customerName}</Text>
        </View>
        <Pressable onPress={onDelete} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>Address</Text>
          <Text style={styles.cardValue}>{inspection.address}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Roof System</Text>
          <Text style={styles.cardValue}>{ROOF_MATERIAL_LABELS[inspection.material]}</Text>
          <Text style={styles.cardSub}>
            {inspection.geometry} · {inspection.ageYears} yr · {inspection.condition}
          </Text>
        </View>

        {inspection.carrier && (
          <View style={styles.card}>
            <Text style={styles.cardLabel}>Insurance</Text>
            <Text style={styles.cardValue}>{INSURANCE_CARRIER_LABELS[inspection.carrier]}</Text>
            {(inspection.policyNumber || inspection.claimNumber) && (
              <Text style={styles.cardSub}>
                {inspection.policyNumber && `Policy ${inspection.policyNumber}`}
                {inspection.policyNumber && inspection.claimNumber && '  ·  '}
                {inspection.claimNumber && `Claim ${inspection.claimNumber}`}
              </Text>
            )}
          </View>
        )}

        <View style={styles.statsRow}>
          <Stat label="Damage" value={score === 0 ? '—' : String(score)} />
          <Stat label="Slopes" value={String(inspection.slopes.length)} />
          <Stat label="Claim" value={CLAIM_WORTHINESS_LABELS[worthiness]} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>HAAG verdict</Text>
          <Text style={styles.cardValue}>
            {decision.roofRecommendation.replace('_', ' ')}
          </Text>
          <Text style={styles.cardSub}>{decision.roofVerdictReasoning}</Text>
        </View>

        <Pressable
          style={styles.primaryBtn}
          onPress={() => router.push('/quick-inspection')}
        >
          <Ionicons name="scan-outline" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Start Quick Inspection</Text>
        </Pressable>

        <View style={styles.placeholderBox}>
          <Ionicons name="document-text-outline" size={28} color={colors.slate} />
          <Text style={styles.placeholderText}>
            HAAG PDF report generation comes online in Phase 3.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.stat}>
      <Text style={styles.statValue}>{value}</Text>
      <Text style={styles.statLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    paddingVertical: spacing.md,
    gap: spacing.md,
  },
  headerBtn: { padding: spacing.xs },
  reportId: { fontSize: fontSize.bodySm, color: colors.slate, fontWeight: fontWeight.semibold },
  customer: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.navy },

  scroll: { padding: spacing.xl, paddingBottom: spacing.xxxl, gap: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    gap: spacing.xs,
    ...shadows.card,
  },
  cardLabel: { fontSize: fontSize.caption, color: colors.slate, fontWeight: fontWeight.semibold, textTransform: 'uppercase', letterSpacing: 0.5 },
  cardValue: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy, textTransform: 'capitalize' },
  cardSub: { fontSize: fontSize.bodyMd, color: colors.slate },

  statsRow: { flexDirection: 'row', gap: spacing.sm },
  stat: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    ...shadows.card,
  },
  statValue: { fontSize: fontSize.titleMd, fontWeight: fontWeight.bold, color: colors.orange },
  statLabel: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: spacing.xs },

  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.sticky,
    borderRadius: radii.pill,
    backgroundColor: colors.orange,
    marginTop: spacing.md,
  },
  primaryBtnText: { color: colors.textInverse, fontSize: fontSize.bodyLg, fontWeight: fontWeight.semibold },

  placeholderBox: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.card,
    padding: spacing.lg,
    alignItems: 'center',
    gap: spacing.sm,
  },
  placeholderText: { color: colors.slate, fontSize: fontSize.bodySm, textAlign: 'center' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xxl, gap: spacing.md },
  emptyTitle: { fontSize: fontSize.titleMd, fontWeight: fontWeight.semibold, color: colors.navy },
  secondaryBtn: {
    height: touchTarget.preferred,
    paddingHorizontal: spacing.xxl,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryBtnText: { color: colors.navy, fontWeight: fontWeight.semibold, fontSize: fontSize.bodyMd },
});
