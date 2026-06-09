import { useState } from 'react';
import { ScrollView, View, Text, Pressable, StyleSheet, Alert, Image, Share } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { generateHaagReport } from '@/lib/services/haagPdf';
import { thresholdFor } from '@/lib/services/haagThresholds';
import {
  CLAIM_WORTHINESS_LABELS,
  claimWorthiness,
  damageScore,
  evaluate,
} from '@/lib/services/decisionEngine';
import {
  DAMAGE_CATEGORY_LABELS,
  INSURANCE_CARRIER_LABELS,
  ROOF_MATERIAL_LABELS,
  type Inspection,
  type Slope,
  type SlopeVerdict,
} from '@/lib/models/types';
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
  const logActivity = useActivityStore((s) => s.log);
  const [generating, setGenerating] = useState(false);

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
          onPress={() =>
            router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } })
          }
        >
          <Ionicons name="scan-outline" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Start Quick Inspection</Text>
        </Pressable>

        {inspection.slopes.length === 0 ? (
          <View style={styles.placeholderBox}>
            <Ionicons name="camera-outline" size={28} color={colors.slate} />
            <Text style={styles.placeholderText}>
              No slopes captured yet. Tap Start Quick Inspection to take photos.
            </Text>
          </View>
        ) : (
          inspection.slopes.map((slope) => {
            const result = decision.perSlope.find((r) => r.slopeId === slope.id);
            return (
              <SlopeBlock
                key={slope.id}
                inspection={inspection}
                slope={slope}
                verdict={result?.verdict ?? 'repair'}
                reasoning={result?.reasoning ?? ''}
                confidenceAvg={result?.confidenceAvg ?? 0}
              />
            );
          })
        )}

        <Pressable
          style={[styles.secondaryCta, generating && { opacity: 0.5 }]}
          disabled={generating}
          onPress={async () => {
            try {
              setGenerating(true);
              const { uri } = await generateHaagReport(inspection);
              logActivity({
                kind: 'pdf_generated',
                inspectionId: inspection.id,
                message: `Generated HAAG report for ${inspection.reportId}`,
              });
              await Share.share({ url: uri, message: `RoofWise HAAG report ${inspection.reportId}` });
            } catch (e) {
              Alert.alert('Report failed', e instanceof Error ? e.message : 'Unknown error');
            } finally {
              setGenerating(false);
            }
          }}
        >
          <Ionicons name="document-text-outline" size={20} color={colors.navy} />
          <Text style={styles.secondaryCtaText}>
            {generating ? 'Generating…' : 'Generate HAAG report (PDF)'}
          </Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function SlopeBlock({
  inspection,
  slope,
  verdict,
  reasoning,
  confidenceAvg,
}: {
  inspection: Inspection;
  slope: Slope;
  verdict: SlopeVerdict;
  reasoning: string;
  confidenceAvg: number;
}) {
  const router = useRouter();
  const detected = (slope.aiFindings ?? []).filter((f) => f.detected);
  const threshold = thresholdFor(inspection.material);

  return (
    <View style={styles.card}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text style={styles.cardValue}>Slope {slope.orientation}</Text>
        <VerdictPill verdict={verdict} />
      </View>

      <Pressable
        style={styles.analyzeBtn}
        onPress={() =>
          router.push({
            pathname: '/analyze',
            params: { inspectionId: inspection.id, slopeId: slope.id },
          })
        }
      >
        <Ionicons name="analytics-outline" size={18} color={colors.navy} />
        <Text style={styles.analyzeBtnText}>Analyze photos</Text>
      </Pressable>

      {slope.photoPaths.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {slope.photoPaths.map((uri, i) => (
              <Pressable
                key={i}
                onPress={() =>
                  router.push({
                    pathname: '/edit-detection',
                    params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(i) },
                  })
                }
                style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
              >
                <Image
                  source={{ uri }}
                  style={{ width: 140, height: 100, borderRadius: radii.md }}
                />
                <View style={styles.editBadge}>
                  <Ionicons name="create-outline" size={12} color={colors.textInverse} />
                </View>
              </Pressable>
            ))}
          </View>
        </ScrollView>
      )}

      <View style={styles.testSquare}>
        <Text style={styles.testSquareLabel}>HAAG test square</Text>
        <Text style={styles.testSquareLine}>
          {slope.hailCount} hits observed · threshold {threshold.hitsPerTestSquare === 0
            ? '(penetration / crack)'
            : `${threshold.hitsPerTestSquare}+ per 10×10' square`}
        </Text>
        <Text style={styles.testSquareRule}>{threshold.rule}</Text>
      </View>

      {detected.length > 0 && (
        <View style={{ marginTop: spacing.md, gap: spacing.xs }}>
          {detected.map((f) => (
            <Text key={f.label} style={styles.cardSub}>
              • {DAMAGE_CATEGORY_LABELS[f.label]} × {f.count} ({f.confidence}%)
            </Text>
          ))}
        </View>
      )}

      {reasoning && (
        <Text style={styles.reasoning}>
          {reasoning}
          {confidenceAvg > 0 ? ` (avg confidence ${Math.round(confidenceAvg)}%)` : ''}
        </Text>
      )}
    </View>
  );
}

function VerdictPill({ verdict }: { verdict: SlopeVerdict }) {
  const tone = (() => {
    switch (verdict) {
      case 'full_replace': return { bg: colors.orange, fg: colors.textInverse, label: 'Full replace' };
      case 'partial_replace': return { bg: colors.warn, fg: colors.navy, label: 'Partial' };
      case 'verify_with_inspector': return { bg: colors.cream, fg: colors.navy, label: 'Verify' };
      default: return { bg: colors.surfaceMuted, fg: colors.slate, label: 'Repair' };
    }
  })();
  return (
    <View style={[styles.verdictPill, { backgroundColor: tone.bg }]}>
      <Text style={[styles.verdictText, { color: tone.fg }]}>{tone.label}</Text>
    </View>
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

  secondaryCta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.preferred,
    borderRadius: radii.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.navy,
    marginTop: spacing.sm,
  },
  secondaryCtaText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  editBadge: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(12,24,60,0.78)',
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },

  testSquare: {
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    padding: spacing.md,
    gap: 2,
    marginTop: spacing.md,
  },
  testSquareLabel: {
    fontSize: fontSize.caption,
    color: colors.slate,
    fontWeight: fontWeight.semibold,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  testSquareLine: { fontSize: fontSize.bodyMd, color: colors.navy, fontWeight: fontWeight.medium },
  testSquareRule: { fontSize: fontSize.bodySm, color: colors.slate },

  verdictPill: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
  },
  verdictText: { fontSize: fontSize.caption, fontWeight: fontWeight.bold, textTransform: 'uppercase', letterSpacing: 0.5 },

  analyzeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    height: touchTarget.standard,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
    borderWidth: 1,
    borderColor: colors.border,
    marginTop: spacing.md,
  },
  analyzeBtnText: { color: colors.navy, fontSize: fontSize.bodyMd, fontWeight: fontWeight.semibold },

  reasoning: {
    fontSize: fontSize.bodySm,
    color: colors.slate,
    fontStyle: 'italic',
    marginTop: spacing.sm,
  },

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
