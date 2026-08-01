import { PressableScale } from '@/components/PressableScale';
import { formatDate } from '@/lib/format/date';
import { useState } from 'react';
import { ScrollView, View, Text, StyleSheet, Alert, Image, Share, TextInput } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useInspectionStore } from '@/lib/stores/inspectionStore';
import { useActivityStore } from '@/lib/stores/activityStore';
import { useProposalStore } from '@/lib/stores/proposalStore';
import { generateHaagReport } from '@/lib/services/haagPdf';
import { SignaturePad } from '@/components/SignaturePad';
import { VoiceNoteRecorder } from '@/components/VoiceNoteRecorder';
import { DamageScoreBar } from '@/components/DamageScoreBar';
import { transcribeAudio } from '@/lib/services/transcribeAudio';
import { useToastStore } from '@/lib/stores/toastStore';
import { isGeminiConfigured } from '@/lib/env';
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

const COLLATERAL_ITEMS = [
  { key: 'brittleness_observed', label: 'Brittleness observed on test shingles' },
  { key: 'mat_exposed', label: 'Mat exposure visible on damaged slopes' },
  { key: 'multi_layer', label: 'Multi-layer roof system (2+ layers)' },
  { key: 'metal_collateral', label: 'Collateral damage on metal (vents, flashing, AC)' },
  { key: 'window_screens', label: 'Hail damage on window screens / siding' },
  { key: 'gutters_dented', label: 'Dents in gutters or downspouts' },
];

export default function JobDetail() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const inspection = useInspectionStore((s) => s.inspections.find((i) => i.id === id));
  const remove = useInspectionStore((s) => s.remove);
  const setStatus = useInspectionStore((s) => s.setStatus);
  const setInspectorSignature = useInspectionStore((s) => s.setInspectorSignature);
  const setCollateralItem = useInspectionStore((s) => s.setCollateralItem);
  const setNotes = useInspectionStore((s) => s.setNotes);
  const addAudioNote = useInspectionStore((s) => s.addAudioNote);
  const removeAudioNote = useInspectionStore((s) => s.removeAudioNote);
  const setAudioNoteLabel = useInspectionStore((s) => s.setAudioNoteLabel);
  const toast = useToastStore((s) => s.show);
  const logActivity = useActivityStore((s) => s.log);
  const proposal = useProposalStore((s) => (id ? s.getByJob(id) : undefined));
  const [generating, setGenerating] = useState(false);

  if (!inspection) {
    return (
      <SafeAreaView style={styles.root}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.empty}>
          <Ionicons name="alert-circle-outline" size={36} color={colors.slate} />
          <Text style={styles.emptyTitle}>Job not found</Text>
          <PressableScale style={styles.secondaryBtn} onPress={() => router.back()}>
            <Text style={styles.secondaryBtnText}>Back</Text>
          </PressableScale>
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
        <PressableScale onPress={() => router.back()} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="chevron-back" size={26} color={colors.navy} />
        </PressableScale>
        <View style={{ flex: 1 }}>
          <Text style={styles.reportId}>{inspection.reportId}</Text>
          <Text style={styles.customer}>{inspection.customerName}</Text>
        </View>
        <PressableScale
          onPress={() => {
            const next =
              inspection.status === 'complete'
                ? 'in_progress'
                : inspection.status === 'in_progress'
                ? 'complete'
                : 'in_progress';
            setStatus(inspection.id, next);
            logActivity({
              kind: next === 'complete' ? 'inspection_completed' : 'job_created',
              inspectionId: inspection.id,
              message:
                next === 'complete'
                  ? `Marked ${inspection.reportId} complete`
                  : `Reopened ${inspection.reportId}`,
            });
          }}
          hitSlop={10}
          style={[
            styles.statusToggle,
            inspection.status === 'complete' && styles.statusToggleComplete,
          ]}
        >
          <Ionicons
            name={
              inspection.status === 'complete'
                ? 'checkmark-circle'
                : 'ellipse-outline'
            }
            size={18}
            color={
              inspection.status === 'complete' ? colors.textInverse : colors.navy
            }
          />
          <Text
            style={[
              styles.statusToggleText,
              inspection.status === 'complete' && { color: colors.textInverse },
            ]}
          >
            {inspection.status === 'complete' ? 'Complete' : 'Mark complete'}
          </Text>
        </PressableScale>
        <PressableScale onPress={onDelete} hitSlop={10} style={styles.headerBtn}>
          <Ionicons name="trash-outline" size={22} color={colors.danger} />
        </PressableScale>
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

        {inspection.event && (
          <View style={[styles.card, styles.stormCard]}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
              <Ionicons name="thunderstorm" size={20} color={colors.orange} />
              <Text style={styles.cardLabel}>Storm match</Text>
            </View>
            <Text style={styles.cardValue}>
              {inspection.event.kind === 'hail'
                ? `${inspection.event.hailSizeInches?.toFixed(2) ?? ''}" hail`
                : `${inspection.event.windSpeedMph ?? ''} mph wind`}
            </Text>
            <Text style={styles.cardSub}>
              {formatDate(inspection.event.date, 'Date unavailable')}
              {inspection.event.distanceMiles
                ? ` · ${inspection.event.distanceMiles.toFixed(1)} mi away`
                : ''}
              {' · '}
              {inspection.event.source}
              {inspection.event.noaaEventId ? ` · ${inspection.event.noaaEventId}` : ''}
            </Text>
          </View>
        )}

        <View style={styles.card}>
          <DamageScoreBar score={score} />
        </View>

        <View style={styles.statsRow}>
          <Stat label="Slopes" value={String(inspection.slopes.length)} />
          <Stat label="Photos" value={String(inspection.slopes.reduce((a, sl) => a + sl.photoPaths.length, 0))} />
          <Stat label="Claim" value={CLAIM_WORTHINESS_LABELS[worthiness]} />
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>HAAG verdict</Text>
          <Text style={styles.cardValue}>
            {decision.roofRecommendation.replace('_', ' ')}
          </Text>
          <Text style={styles.cardSub}>{decision.roofVerdictReasoning}</Text>
        </View>

        <PressableScale
          style={styles.primaryBtn}
          onPress={() =>
            router.push({ pathname: '/quick-inspection', params: { jobId: inspection.id } })
          }
        >
          <Ionicons name="scan-outline" size={20} color={colors.textInverse} />
          <Text style={styles.primaryBtnText}>Start Quick Inspection</Text>
        </PressableScale>

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

        <PressableScale
          style={styles.proposalCard}
          onPress={() => router.push(`/proposal/${inspection.id}` as any)}
        >
          <Ionicons name="document-attach-outline" size={22} color={colors.orange} />
          <View style={{ flex: 1 }}>
            <Text style={styles.proposalTitle}>
              {proposal ? `Proposal · $${proposal.total.toLocaleString()}` : 'Generate proposal'}
            </Text>
            <Text style={styles.proposalSub}>
              {proposal ? `${proposal.status} · ${proposal.lineItems.length} line items` : 'From Decision Engine + Solar squares + regional pricing'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.slate} />
        </PressableScale>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Collateral checklist</Text>
          {COLLATERAL_ITEMS.map((item) => {
            const checked = !!inspection.collateralChecklist[item.key];
            return (
              <PressableScale
                key={item.key}
                style={styles.collateralRow}
                onPress={() => setCollateralItem(inspection.id, item.key, !checked)}
              >
                <Ionicons
                  name={checked ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={checked ? colors.success : colors.slate}
                />
                <Text style={[styles.collateralLabel, checked && styles.collateralChecked]}>
                  {item.label}
                </Text>
              </PressableScale>
            );
          })}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Notes</Text>
          <TextInput
            value={inspection.notes ?? ''}
            onChangeText={(t) => setNotes(inspection.id, t)}
            placeholder="Anything the AI shouldn't miss?"
            placeholderTextColor={colors.textSubtle}
            style={styles.notesInput}
            multiline
            textAlignVertical="top"
          />
        </View>

        <VoiceNoteRecorder
          notes={inspection.audioNotes ?? []}
          onRecorded={(note) => addAudioNote(inspection.id, note)}
          onRemove={(noteId) => removeAudioNote(inspection.id, noteId)}
          onTranscribe={async (noteId) => {
            if (!isGeminiConfigured) {
              toast({
                tone: 'warn',
                title: 'AI not connected',
                body: 'Add EXPO_PUBLIC_GEMINI_API_KEY in .env.local to transcribe.',
              });
              return;
            }
            const note = (inspection.audioNotes ?? []).find((n) => n.id === noteId);
            if (!note) return;
            try {
              const text = await transcribeAudio(note.uri);
              setAudioNoteLabel(inspection.id, noteId, text || 'Transcription unavailable');
              toast({ tone: 'success', title: 'Note transcribed' });
            } catch (e) {
              toast({
                tone: 'danger',
                title: 'Transcription failed',
                body: e instanceof Error ? e.message.slice(0, 80) : undefined,
              });
            }
          }}
        />

        <View style={styles.card}>
          <Text style={styles.cardLabel}>Inspector signature</Text>
          <Text style={styles.cardSub}>Sign below to seal the HAAG report.</Text>
          <View style={{ alignItems: 'center', marginTop: spacing.md }}>
            <SignaturePad
              onChange={(svg) => {
                if (svg) setInspectorSignature(inspection.id, svg);
              }}
            />
          </View>
          {inspection.inspectorSignatureSvg && (
            <View style={styles.signedBadge}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.signedBadgeText}>Signed</Text>
            </View>
          )}
        </View>

        <PressableScale
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
        </PressableScale>
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

      <PressableScale
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
      </PressableScale>

      {slope.photoPaths.length > 0 && (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: spacing.sm }}>
          <View style={{ flexDirection: 'row', gap: spacing.sm }}>
            {slope.photoPaths.map((uri, i) => (
              <PressableScale
                key={i}
                onPress={() =>
                  router.push({
                    pathname: '/edit-detection',
                    params: { inspectionId: inspection.id, slopeId: slope.id, photoIndex: String(i) },
                  })
                }
              >
                <Image
                  source={{ uri }}
                  style={{ width: 140, height: 100, borderRadius: radii.md }}
                />
                <View style={styles.editBadge}>
                  <Ionicons name="create-outline" size={12} color={colors.textInverse} />
                </View>
              </PressableScale>
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
  statusToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.surfaceMuted,
  },
  statusToggleComplete: { backgroundColor: colors.success },
  statusToggleText: { fontSize: fontSize.caption, fontWeight: fontWeight.semibold, color: colors.navy },

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

  proposalCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radii.card,
    padding: spacing.lg,
    minHeight: touchTarget.preferred,
    ...shadows.card,
  },
  proposalTitle: { fontSize: fontSize.titleSm, fontWeight: fontWeight.semibold, color: colors.navy },
  proposalSub: { fontSize: fontSize.bodySm, color: colors.slate, marginTop: 2, textTransform: 'capitalize' },

  signedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.successSoft,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radii.pill,
    marginTop: spacing.sm,
  },
  signedBadgeText: { color: colors.success, fontSize: fontSize.caption, fontWeight: fontWeight.semibold },

  collateralRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    minHeight: touchTarget.small,
  },
  collateralLabel: { flex: 1, fontSize: fontSize.bodyMd, color: colors.navy },
  collateralChecked: { textDecorationLine: 'line-through', color: colors.slate },

  stormCard: { borderLeftWidth: 4, borderLeftColor: colors.orange },

  notesInput: {
    minHeight: 96,
    fontSize: fontSize.bodyMd,
    color: colors.navy,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
    borderRadius: radii.md,
    marginTop: spacing.sm,
  },

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
